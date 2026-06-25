import { getDatabase } from '@netlify/database'

export interface PersistedLiveOrder {
  id: string
  username: string
  paymentId: string
  amount: number
  status: string
  paidAt: string
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
  shipping?: {
    ordererName?: string
    ordererPhone?: string
    recipientName?: string
    recipientPhone?: string
    postcode?: string
    address1?: string
    address2?: string
    memo?: string
  }
}

const clean = (value: unknown, max = 240) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const addressFromShipping = (shipping: PersistedLiveOrder['shipping']) => {
  if (!shipping) return ''
  return [shipping.postcode, shipping.address1, shipping.address2].map((v) => clean(v, 200)).filter(Boolean).join(' ')
}

export async function persistLiveOrderToDatabase(order: PersistedLiveOrder): Promise<void> {
  const db = getDatabase()
  const viewerPhone = clean(order.shipping?.ordererPhone || order.shipping?.recipientPhone, 30)
  const items = [
    {
      productId: order.product.id,
      productName: order.product.name,
      productLink: order.product.link || '',
      productImage: order.product.image || '',
      selectedOptions: order.product.selectedOptions || {},
      amount: order.amount,
      paymentId: order.paymentId,
      orderName: order.orderName || '',
      batchPaymentId: order.batchPaymentId || '',
      batchTotal: order.batchTotal || 0,
      commissionRate: order.commissionRate || 0,
      commissionAmount: order.commissionAmount || 0,
      sellerNetAmount: order.sellerNetAmount || order.amount,
      paidAt: order.paidAt,
      customer: {
        ordererName: clean(order.shipping?.ordererName, 60),
        ordererPhone: viewerPhone,
        recipientName: clean(order.shipping?.recipientName, 60),
        recipientPhone: clean(order.shipping?.recipientPhone, 30),
      },
    },
  ]

  await db.sql`
    INSERT INTO live_orders (
      id,
      username,
      viewer_id,
      viewer_name,
      viewer_phone,
      items,
      total_amount,
      status,
      payment_id,
      address,
      memo,
      created_at,
      updated_at
    )
    VALUES (
      ${order.id},
      ${order.username},
      ${order.viewer.viewerId},
      ${clean(order.viewer.nickname || order.shipping?.ordererName || order.shipping?.recipientName, 80)},
      ${viewerPhone},
      ${JSON.stringify(items)}::jsonb,
      ${Math.max(0, Math.floor(Number(order.amount) || 0))},
      ${order.status},
      ${order.paymentId},
      ${addressFromShipping(order.shipping)},
      ${clean(order.shipping?.memo, 200)},
      ${order.paidAt},
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      viewer_id = EXCLUDED.viewer_id,
      viewer_name = EXCLUDED.viewer_name,
      viewer_phone = EXCLUDED.viewer_phone,
      items = EXCLUDED.items,
      total_amount = EXCLUDED.total_amount,
      status = EXCLUDED.status,
      payment_id = EXCLUDED.payment_id,
      address = EXCLUDED.address,
      memo = EXCLUDED.memo,
      updated_at = now()
  `
}

export async function persistLiveOrdersToDatabase(orders: PersistedLiveOrder[]): Promise<void> {
  for (const order of orders) {
    await persistLiveOrderToDatabase(order)
  }
}
