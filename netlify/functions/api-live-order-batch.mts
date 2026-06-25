import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { splitLiveCommission, LIVE_COMMISSION_RATE } from './_shared/live-pricing.mts'
import { persistLiveOrdersToDatabase } from './_shared/live-order-persistence.mts'

/**
 * Batch checkout for all items a viewer has added to their live cart.
 * One PortOne V2 payment authorises the combined total; on server-side
 * verification we fan it out into one order record per cart item and
 * then clear that viewer's cart so the UI flips back to empty.
 *
 * POST /api/live-order-batch
 *   { paymentId, username, expectedAmount, viewer, items: [...] }
 */

const PORTONE_API_BASE = 'https://api.portone.io'

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

  const apiSecret = process.env.PORTONE_V2_API_SECRET
  if (!apiSecret) {
    return Response.json(
      { success: false, error: 'PORTONE_V2_API_SECRET 환경 변수가 설정되지 않았습니다.' },
      { status: 500 },
    )
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

  let portoneRes: Response
  try {
    portoneRes = await fetch(
      `${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`,
      { method: 'GET', headers: { Authorization: `PortOne ${apiSecret}` } },
    )
  } catch {
    return Response.json(
      { success: false, error: 'PortOne API 호출에 실패했습니다.' },
      { status: 502 },
    )
  }

  if (!portoneRes.ok) {
    const errText = await portoneRes.text().catch(() => '')
    return Response.json(
      {
        success: false,
        error: `PortOne 결제 조회 실패 (${portoneRes.status}): ${errText.slice(0, 200)}`,
      },
      { status: 502 },
    )
  }

  const payment = (await portoneRes.json()) as {
    id?: string
    status?: string
    orderName?: string
    amount?: { total?: number; paid?: number }
    currency?: string
    paidAt?: string
    pgTxId?: string
  }

  if (payment.status !== 'PAID') {
    return Response.json(
      {
        success: false,
        error: `결제가 완료되지 않았습니다. (상태: ${payment.status || 'UNKNOWN'})`,
      },
      { status: 400 },
    )
  }

  const paidAmount = payment.amount?.total ?? payment.amount?.paid ?? 0
  if (paidAmount !== expectedAmount) {
    return Response.json(
      {
        success: false,
        error: `결제 금액이 일치하지 않습니다. (기대: ${expectedAmount}, 실제: ${paidAmount})`,
      },
      { status: 400 },
    )
  }

  if (payment.currency && payment.currency !== 'KRW') {
    return Response.json(
      { success: false, error: `통화가 일치하지 않습니다. (${payment.currency})` },
      { status: 400 },
    )
  }

  const ordersStore = getStore({ name: 'live-orders', consistency: 'strong' })
  const now = new Date().toISOString()
  const existing =
    ((await ordersStore.get(username, { type: 'json' })) as LiveOrdersData | null) || {
      orders: [],
      updatedAt: now,
    }

  // Idempotency: if this paymentId was already recorded, don't duplicate.
  const alreadyRecorded = existing.orders.some((o) => o.paymentId === paymentId)
  if (alreadyRecorded) {
    return Response.json({ success: true, alreadyProcessed: true })
  }

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

  // Anchor the batch under the original paymentId too so idempotency checks hit.
  existing.orders.unshift({
    ...records[0],
    paymentId,
  })
  for (const r of records) existing.orders.unshift(r)
  existing.updatedAt = now
  await ordersStore.setJSON(username, existing)
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
  const viewerId = body.viewer?.viewerId
  if (viewerId) {
    const cartStore = getStore({ name: 'live-cart', consistency: 'strong' })
    const cartData = (await cartStore.get(username, { type: 'json' })) as CartData | null
    if (cartData) {
      const paidKeys = new Set(
        items.map((it) => `${it.productId}|${JSON.stringify(it.selectedOptions || {})}`),
      )
      const cart = cartData.carts.find((c) => c.viewerId === viewerId)
      if (cart) {
        cart.items = cart.items.filter(
          (i) => !paidKeys.has(`${i.productId}|${JSON.stringify(i.selectedOptions || {})}`),
        )
        if (cart.items.length === 0) {
          cartData.carts = cartData.carts.filter((c) => c.viewerId !== viewerId)
        }
        cartData.updatedAt = now
        await cartStore.setJSON(username, cartData)
      }
    }
  }

  return Response.json({ success: true, count: records.length })
}

export const config: Config = {
  path: '/api/live-order-batch',
  method: ['POST'],
}
