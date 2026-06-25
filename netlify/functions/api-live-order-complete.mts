import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { splitLiveCommission, LIVE_COMMISSION_RATE } from './_shared/live-pricing.mts'
import { persistLiveOrderToDatabase } from './_shared/live-order-persistence.mts'

/**
 * Live-commerce product purchase completion — verifies a PortOne V2 payment
 * server-side against the PortOne REST API, then stores an order record keyed
 * by the seller's username. Each verified order is split into the 8.5% live
 * commission and the seller's net amount via `splitLiveCommission` so the
 * settlement layer can later reconcile what to pay out.
 *
 * Flow:
 *   1. Viewer taps "바로 결제" on a live product; chooses Toss/Kakao/Card.
 *   2. Client calls PortOne.requestPayment(...) with a merchant-generated paymentId.
 *   3. On success, client POSTs order details here for verification.
 *   4. We GET /payments/{paymentId}, confirm status=PAID + amount match,
 *      and append the order to the seller's live-orders blob.
 */

const PORTONE_API_BASE = 'https://api.portone.io'

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

interface CompleteOrderBody {
  paymentId?: string
  username?: string
  expectedAmount?: number
  product?: {
    id?: string
    name?: string
    link?: string
    image?: string
    selectedOptions?: Record<string, string>
  }
  viewer?: {
    viewerId?: string
    nickname?: string
    profileImage?: string
  }
  shipping?: ShippingInfo
}

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

interface OrderRecord {
  paymentId: string
  pgTxId?: string
  amount: number
  paidAt: string
  status: 'PAID'
  orderName?: string
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

  let body: CompleteOrderBody
  try {
    body = (await req.json()) as CompleteOrderBody
  } catch {
    return Response.json(
      { success: false, error: '요청 본문을 해석할 수 없습니다.' },
      { status: 400 },
    )
  }

  const paymentId = (body.paymentId || '').trim()
  const username = (body.username || '').trim().toLowerCase()
  const expectedAmount = Number(body.expectedAmount)
  if (!paymentId || !username || !Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return Response.json(
      { success: false, error: 'paymentId, username, expectedAmount가 모두 필요합니다.' },
      { status: 400 },
    )
  }

  if (!body.product?.id || !body.product?.name) {
    return Response.json(
      { success: false, error: '상품 정보가 누락되었습니다.' },
      { status: 400 },
    )
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

  // Verification passed — append the order to the seller's live-orders blob.
  const store = getStore({ name: 'live-orders', consistency: 'strong' })
  const now = new Date().toISOString()

  const existing = ((await store.get(username, { type: 'json' })) as LiveOrdersData | null) || {
    orders: [],
    updatedAt: now,
  }

  // Idempotency: if this paymentId was already recorded, don't duplicate.
  const alreadyRecorded = existing.orders.some((o) => o.paymentId === paymentId)
  if (alreadyRecorded) {
    return Response.json({ success: true, alreadyProcessed: true })
  }

  const split = splitLiveCommission(paidAmount)

  const order: OrderRecord = {
    paymentId,
    pgTxId: payment.pgTxId,
    amount: paidAmount,
    paidAt: payment.paidAt || now,
    status: 'PAID',
    orderName: payment.orderName,
    commissionRate: LIVE_COMMISSION_RATE,
    commissionAmount: split.commissionAmount,
    sellerNetAmount: split.sellerNetAmount,
    product: {
      id: body.product.id,
      name: body.product.name,
      link: body.product.link,
      image: body.product.image,
      selectedOptions: body.product.selectedOptions,
    },
    viewer: {
      viewerId: body.viewer?.viewerId || 'anonymous',
      nickname: body.viewer?.nickname,
      profileImage: body.viewer?.profileImage,
    },
    shipping: normalizeShipping(body.shipping),
  }

  existing.orders.unshift(order)
  existing.updatedAt = now
  await store.setJSON(username, existing)
  await persistLiveOrderToDatabase({
    id: paymentId,
    username,
    paymentId,
    amount: paidAmount,
    paidAt: order.paidAt,
    status: order.status,
    orderName: order.orderName,
    commissionRate: order.commissionRate,
    commissionAmount: order.commissionAmount,
    sellerNetAmount: order.sellerNetAmount,
    product: order.product,
    viewer: order.viewer,
    shipping: order.shipping,
  })

  return Response.json({ success: true, order })
}

export const config: Config = {
  path: '/api/live-order-complete',
  method: ['POST'],
}
