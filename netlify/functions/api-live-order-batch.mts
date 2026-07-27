import type { Config, Context } from '@netlify/functions'
import { splitLiveCommission, LIVE_COMMISSION_RATE } from './_shared/live-pricing.mts'
import { persistLiveOrdersToDatabase } from './_shared/live-order-persistence.mts'
import { verifyLivePortOnePayment } from './_shared/portone-live-payment.mts'
import { mutateBlobJSON } from './_shared/blob-write.mts'

/**
 * Batch checkout for all items a viewer has added to their live cart.
 * One PortOne V2 payment authorises the combined total; on server-side
 * verification we fan it out into one order record per cart item and
 * then clear that viewer's cart so the UI flips back to empty.
 *
 * POST /api/live-order-batch
 *   { paymentId, username, expectedAmount, viewer, items: [...] }
 */

interface ShippingInfo {
  ordererName?: string
  ordererPhone?: string
  recipientName?: string
  recipientPhone?: string
  postcode?: string
  address1?: string
  address2?: string
  memo?: string
}

// Trim and length-cap a shipping snapshot so an oversized/garbage payload can't
// bloat the seller's orders blob. Returns undefined when nothing usable is set.
function normalizeShipping(raw: any): ShippingInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const cap = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const s: ShippingInfo = {
    ordererName: cap(raw.ordererName, 60),
    ordererPhone: cap(raw.ordererPhone, 30),
    recipientName: cap(raw.recipientName, 60),
    recipientPhone: cap(raw.recipientPhone, 30),
    postcode: cap(raw.postcode, 20),
    address1: cap(raw.address1, 200),
    address2: cap(raw.address2, 200),
    memo: cap(raw.memo, 200),
  }
  if (!s.recipientName && !s.address1 && !s.ordererName) return undefined
  return s
}

interface BatchItem {
  productId?: string
  productName?: string
  productLink?: string
  productImage?: string
  selectedOptions?: Record<string, string>
  amount?: number
}

interface BatchBody {
  paymentId?: string
  username?: string
  expectedAmount?: number
  viewer?: {
    viewerId?: string
    nickname?: string
    profileImage?: string
  }
  items?: BatchItem[]
  shipping?: ShippingInfo
}

interface OrderRecord {
  paymentId: string
  pgTxId?: string
  amount: number
  paidAt: string
  status: 'PAID'
  orderName?: string
  batchPaymentId?: string
  batchTotal?: number
  commissionRate?: number
  commissionAmount?: number
  sellerNetAmount?: number
  product: {
    id: string
    name: string
    link?: string
    image?: string
    selectedOptions?: Record<string, string>
  }
  viewer: {
    viewerId: string
    nickname?: string
    profileImage?: string
  }
  shipping?: ShippingInfo
}

interface LiveOrdersData {
  orders: OrderRecord[]
  updatedAt: string
}

interface CartItem {
  productId: string
  productName: string
  productPrice?: string
  productImage?: string
  productLink: string
  selectedOptions?: Record<string, string>
  addedAt: string
}

interface ViewerCart {
  viewerId: string
  viewerNickname: string
  viewerProfileImage?: string
  items: CartItem[]
  kakaoSent: boolean
}

interface CartData {
  carts: ViewerCart[]
  updatedAt: string
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let body: BatchBody
  try {
    body = (await req.json()) as BatchBody
  } catch {
    return Response.json(
      { success: false, error: '요청 본문을 해석할 수 없습니다.' },
      { status: 400 },
    )
  }

  const paymentId = (body.paymentId || '').trim()
  const username = (body.username || '').trim().toLowerCase()
  const expectedAmount = Number(body.expectedAmount)
  const items = Array.isArray(body.items) ? body.items : []
  if (!paymentId || !username || !Number.isFinite(expectedAmount) || expectedAmount <= 0 || items.length === 0) {
    return Response.json(
      { success: false, error: 'paymentId, username, expectedAmount, items가 모두 필요합니다.' },
      { status: 400 },
    )
  }

  const itemsSum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0)
  if (itemsSum !== expectedAmount) {
    return Response.json(
      {
        success: false,
        error: `항목 금액 합계(${itemsSum})가 결제 금액(${expectedAmount})과 일치하지 않습니다.`,
      },
      { status: 400 },
    )
  }

  for (const it of items) {
    if (!it.productId || !it.productName || !Number.isFinite(Number(it.amount)) || Number(it.amount) <= 0) {
      return Response.json(
        { success: false, error: '상품 정보가 누락되었거나 잘못되었습니다.' },
        { status: 400 },
      )
    }
  }

  const verified = await verifyLivePortOnePayment({ paymentId, expectedKrw: expectedAmount })
  if (!verified.ok) {
    return Response.json(
      { success: false, error: verified.error },
      { status: verified.status },
    )
  }
  const { payment, paidAmount } = verified

  const now = new Date().toISOString()

  const records: OrderRecord[] = items.map((it, idx) => {
    const itemAmount = Number(it.amount)
    const split = splitLiveCommission(itemAmount)
    return {      paymentId: `${paymentId}#${idx + 1}`,
      pgTxId: payment.pgTxId,
      amount: itemAmount,
      paidAt: payment.paidAt || now,
      status: 'PAID',
      orderName: payment.orderName,
      batchPaymentId: paymentId,
      batchTotal: paidAmount,
      commissionRate: LIVE_COMMISSION_RATE,
      commissionAmount: split.commissionAmount,
      sellerNetAmount: split.sellerNetAmount,
      product: {
        id: it.productId!,
        name: it.productName!,
        link: it.productLink,
        image: it.productImage,
        selectedOptions: it.selectedOptions,
      },
      viewer: {
        viewerId: body.viewer?.viewerId || 'anonymous',
        nickname: body.viewer?.nickname,
        profileImage: body.viewer?.profileImage,
      },
      shipping: normalizeShipping(body.shipping),
    }
  })

  // 동시 결제로 주문이 유실되지 않도록 조건부 쓰기로 반영한다. 중복(같은 paymentId)
  // 검사도 최신 목록을 기준으로 해야 하므로 같은 블록 안에서 한다.
  let alreadyRecorded = false
  await mutateBlobJSON<LiveOrdersData>('live-orders', username, (current) => {
    const orders = Array.isArray(current?.orders) ? current!.orders : []
    if (orders.some((o) => o.paymentId === paymentId)) {
      alreadyRecorded = true
      return null
    }
    alreadyRecorded = false
    // Anchor the batch under the original paymentId too so idempotency checks hit.
    const anchor: OrderRecord = { ...records[0], paymentId }
    return {
      orders: [...[...records].reverse(), anchor, ...orders],
      updatedAt: now,
    }
  })

  if (alreadyRecorded) {
    return Response.json({ success: true, alreadyProcessed: true })
  }

  await persistLiveOrdersToDatabase(
    records.map((record) => ({
      id: record.paymentId,
      username,
      paymentId: record.paymentId,
      amount: record.amount,
      paidAt: record.paidAt,
      status: record.status,
      orderName: record.orderName,
      batchPaymentId: record.batchPaymentId,
      batchTotal: record.batchTotal,
      commissionRate: record.commissionRate,
      commissionAmount: record.commissionAmount,
      sellerNetAmount: record.sellerNetAmount,
      product: record.product,
      viewer: record.viewer,
      shipping: record.shipping,
    })),
  )

  // Remove just the paid items from this viewer's cart so the seller's
  // live-cart view updates but any unpriceable leftover items remain visible.
  // 다른 시청자의 담기가 동시에 들어와도 지워지지 않도록 조건부 쓰기로 반영한다.
  const viewerId = body.viewer?.viewerId
  if (viewerId) {
    const paidKeys = new Set(
      items.map((it) => `${it.productId}|${JSON.stringify(it.selectedOptions || {})}`),
    )
    await mutateBlobJSON<CartData>('live-cart', username, (cartData) => {
      const carts = Array.isArray(cartData?.carts) ? cartData!.carts : []
      const cart = carts.find((c) => c.viewerId === viewerId)
      if (!cart) return null

      const remaining = cart.items.filter(
        (i) => !paidKeys.has(`${i.productId}|${JSON.stringify(i.selectedOptions || {})}`),
      )
      const nextCarts =
        remaining.length === 0
          ? carts.filter((c) => c.viewerId !== viewerId)
          : carts.map((c) => (c.viewerId === viewerId ? { ...c, items: remaining } : c))

      return { carts: nextCarts, updatedAt: now }
    })
  }

  return Response.json({ success: true, count: records.length })
}

export const config: Config = {
  path: '/api/live-order-batch',
  method: ['POST'],
}
