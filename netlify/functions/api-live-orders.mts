import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

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
