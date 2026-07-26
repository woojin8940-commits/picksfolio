import { getStore } from '@netlify/blobs'
import { requireAccountOwner } from './_shared/user-auth.mts'
import type { Config, Context } from '@netlify/functions'

/**
 * 라이브 주문 내역(셀러 대시보드).
 *
 * 응답에 주문자·수령인 이름과 연락처, 우편번호, 주소, 배송 메모까지 그대로 들어간다.
 * 즉 셀러의 **구매자 개인정보** 전체다. 무인증으로 열려 있으면 사용자명만 알면 누구나
 * 남의 고객 명단을 긁어갈 수 있으므로(개인정보 유출), 채널 주인만 읽을 수 있게 한다.
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

interface OrderRecord {
  paymentId?: string
  amount?: number
  paidAt?: string
  status?: string
  orderName?: string
  batchPaymentId?: string
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

interface LiveOrdersData {
  orders?: OrderRecord[]
  updatedAt?: string
}

const cleanText = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value.trim().slice(0, 240) : fallback

export default async (req: Request, context: Context) => {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const username = cleanText(context.params.username).toLowerCase()
  if (!username) {
    return Response.json({ success: false, error: 'Missing username' }, { status: 400 })
  }

  const auth = await requireAccountOwner(req, username)
  if (!auth.ok) return auth.response

  const store = getStore({ name: 'live-orders', consistency: 'strong' })
  const data = ((await store.get(username, { type: 'json' })) as LiveOrdersData | null) || {}
  const rawOrders = Array.isArray(data.orders) ? data.orders : []
  const batchItemIds = new Set(
    rawOrders
      .filter((order) => order.batchPaymentId && order.paymentId?.startsWith(`${order.batchPaymentId}#`))
      .map((order) => order.batchPaymentId),
  )

  const orders = rawOrders
    .filter((order) => {
      if (!order.paymentId) return false
      return !(order.batchPaymentId && order.paymentId === order.batchPaymentId && batchItemIds.has(order.batchPaymentId))
    })
    .map((order) => ({
      paymentId: cleanText(order.paymentId),
      amount: Number.isFinite(Number(order.amount)) ? Number(order.amount) : 0,
      paidAt: cleanText(order.paidAt),
      status: cleanText(order.status),
      orderName: cleanText(order.orderName),
      batchPaymentId: cleanText(order.batchPaymentId),
      product: {
        id: cleanText(order.product?.id),
        name: cleanText(order.product?.name, '상품명 없음'),
        link: cleanText(order.product?.link),
        image: cleanText(order.product?.image),
        selectedOptions: order.product?.selectedOptions || {},
      },
      viewer: {
        viewerId: cleanText(order.viewer?.viewerId, 'anonymous'),
        nickname: cleanText(order.viewer?.nickname),
        profileImage: cleanText(order.viewer?.profileImage),
      },
      shipping: order.shipping || {},
    }))

  return Response.json({ success: true, orders, updatedAt: data.updatedAt || null })
}

export const config: Config = {
  path: '/api/live-orders/:username',
  method: ['GET'],
}
