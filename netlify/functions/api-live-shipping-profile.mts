import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

/**
 * Per-viewer orderer & shipping profile storage for live-commerce checkout.
 *
 * A viewer fills in their orderer info (이름/연락처) and shipping address
 * (배송지) once before paying; we persist it so the next checkout is pre-filled.
 * This is a convenience cache of the last-used delivery details — the
 * authoritative copy of each purchase's shipping snapshot is still stored on the
 * order record by api-live-order-complete / api-live-order-batch.
 *
 *   GET  /api/live-shipping-profile?profileKey=xxx  -> { profile | null }
 *   POST /api/live-shipping-profile                 -> { profileKey, profile }
 *
 * 시청자는 로그인하지 않으므로 이 기록을 지켜주는 것은 열쇠(profileKey) 하나뿐이다.
 * 예전에는 viewerId 를 열쇠로 썼는데, viewerId 는 판매자 화면(장바구니·주문 목록)에
 * 그대로 보이는 값이라 그것만 알면 남의 이름·연락처·주소를 읽을 수 있었다. 그래서
 * 열쇠를 viewerId 와 분리해, 브라우저에만 저장되고 이 API 로만 오가는 난수로 바꿨다.
 * 추측이 불가능해야 하므로 짧은 값은 아예 거부한다.
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

const MIN_KEY_LENGTH = 24
const MAX_KEY_LENGTH = 128
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/

/** 열쇠를 검증하고 블롭 키로 바꾼다. 형식이 어긋나면 null. */
function profileKeyFrom(raw: unknown): string | null {
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) return null
  if (!KEY_PATTERN.test(key)) return null
  return `profile_${key}`
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
    const key = profileKeyFrom(url.searchParams.get('profileKey'))
    if (!key) {
      return Response.json({ success: false, error: 'profileKey가 필요합니다.' }, { status: 400 })
    }
    const profile = (await store.get(key, { type: 'json' })) as StoredProfile | null
    return Response.json({ success: true, profile: profile || null })
  }

  if (req.method === 'POST') {
    let body: { profileKey?: string; profile?: any }
    try {
      body = (await req.json()) as { profileKey?: string; profile?: any }
    } catch {
      return Response.json({ success: false, error: '요청 본문을 해석할 수 없습니다.' }, { status: 400 })
    }

    const key = profileKeyFrom(body.profileKey)
    if (!key) {
      return Response.json({ success: false, error: 'profileKey가 필요합니다.' }, { status: 400 })
    }

    const clean = sanitize(body.profile)
    if (!clean) {
      return Response.json({ success: false, error: '배송지 정보가 올바르지 않습니다.' }, { status: 400 })
    }

    const stored: StoredProfile = { ...clean, updatedAt: new Date().toISOString() }
    await store.setJSON(key, stored)
    return Response.json({ success: true, profile: stored })
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: '/api/live-shipping-profile',
  method: ['GET', 'POST'],
}
