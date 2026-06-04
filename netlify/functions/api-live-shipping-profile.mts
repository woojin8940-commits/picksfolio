import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

/**
 * Per-viewer orderer & shipping profile storage for live-commerce checkout.
 *
 * A viewer fills in their orderer info (이름/연락처) and shipping address
 * (배송지) once before paying; we persist it keyed by their stable viewerId so
 * the next checkout (on any device they log into) is pre-filled. This is a
 * convenience cache of the last-used delivery details — the authoritative copy
 * of each purchase's shipping snapshot is still stored on the order record by
 * api-live-order-complete / api-live-order-batch.
 *
 *   GET  /api/live-shipping-profile?viewerId=xxx  -> { profile | null }
 *   POST /api/live-shipping-profile               -> { viewerId, profile }
 */

interface ShippingProfile {
  ordererName: string
  ordererPhone: string
  recipientName: string
  recipientPhone: string
  postcode?: string
  address1: string
  address2?: string
  memo?: string
}

interface StoredProfile extends ShippingProfile {
  updatedAt: string
}

const MAX = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '')

function sanitize(raw: any): ShippingProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const profile: ShippingProfile = {
    ordererName: MAX(raw.ordererName, 60),
    ordererPhone: MAX(raw.ordererPhone, 30),
    recipientName: MAX(raw.recipientName, 60),
    recipientPhone: MAX(raw.recipientPhone, 30),
    postcode: MAX(raw.postcode, 20),
    address1: MAX(raw.address1, 200),
    address2: MAX(raw.address2, 200),
    memo: MAX(raw.memo, 200),
  }
  // Require at least a name, a contact and a base address to be worth saving.
  if (!profile.ordererName || !profile.recipientName || !profile.address1) return null
  return profile
}

export default async (req: Request, _context: Context) => {
  const store = getStore({ name: 'live-shipping-profiles', consistency: 'strong' })

  if (req.method === 'GET') {
    const url = new URL(req.url)
    const viewerId = (url.searchParams.get('viewerId') || '').trim()
    if (!viewerId) {
      return Response.json({ success: false, error: 'viewerId가 필요합니다.' }, { status: 400 })
    }
    const profile = (await store.get(viewerId, { type: 'json' })) as StoredProfile | null
    return Response.json({ success: true, profile: profile || null })
  }

  if (req.method === 'POST') {
    let body: { viewerId?: string; profile?: any }
    try {
      body = (await req.json()) as { viewerId?: string; profile?: any }
    } catch {
      return Response.json({ success: false, error: '요청 본문을 해석할 수 없습니다.' }, { status: 400 })
    }

    const viewerId = (body.viewerId || '').trim()
    if (!viewerId) {
      return Response.json({ success: false, error: 'viewerId가 필요합니다.' }, { status: 400 })
    }

    const clean = sanitize(body.profile)
    if (!clean) {
      return Response.json({ success: false, error: '배송지 정보가 올바르지 않습니다.' }, { status: 400 })
    }

    const stored: StoredProfile = { ...clean, updatedAt: new Date().toISOString() }
    await store.setJSON(viewerId, stored)
    return Response.json({ success: true, profile: stored })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/live-shipping-profile',
  method: ['GET', 'POST'],
}
