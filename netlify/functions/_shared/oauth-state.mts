/**
 * OAuth `state` 서명 · 검증.
 *
 * 예전에는 state 가 `base64url(JSON({u: username}))` 이라 아무나 만들 수 있었다. 공격자가
 * 피해자의 사용자명을 넣은 state 로 authorize 링크를 만들어 넘기면, 피해자가 자기 인스타그램
 * 계정으로 동의하는 순간 그 토큰이 **공격자가 지정한 계정**에 저장된다(계정 연동 CSRF).
 * 반대로 공격자가 자기 인스타그램으로 동의하면 피해자 계정에 공격자의 IG 가 붙어, 피해자
 * 이름으로 나가는 DM 자동화를 공격자가 통제하게 된다.
 *
 * 방어:
 *   1) HMAC-SHA256 서명 — 서버만 state 를 만들 수 있다.
 *   2) TTL(10분) — 유출된 state 의 재사용 창을 좁힌다.
 *   3) 1회용 nonce — 콜백에서 소비(삭제)하므로 같은 state 를 두 번 쓸 수 없다.
 *   4) 세션 결속 — state 발급은 인증된(POST) 경로에서만 하고, 발급 요청자의
 *      Supabase user id 를 서명 대상에 포함한다.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getStore } from '@netlify/blobs'

const STATE_TTL_MS = 10 * 60 * 1000
const NONCE_STORE = 'oauth-state'

/**
 * 서명 키. 전용 키(OAUTH_STATE_SECRET)가 있으면 그걸 쓰고, 없으면 이미 두 함수 모두가
 * 갖고 있는 인스타그램 앱 시크릿을 유도 키로 쓴다. 값 자체는 절대 응답에 싣지 않는다.
 */
function signingKey(): string | null {
  return process.env.OAUTH_STATE_SECRET || process.env.INSTAGRAM_APP_SECRET || null
}

const sign = (payload: string, key: string) =>
  createHmac('sha256', key).update(payload).digest('base64url')

const safeEqual = (a: string, b: string) => {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export interface StatePayload {
  /** 연동 대상 사용자명(우리 시스템 계정). */
  u: string
  /** 발급을 요청한 인증 사용자 id — 세션 결속. */
  s: string
  /** 1회용 nonce. */
  n: string
  /** 만료 시각(epoch ms). */
  e: number
  /**
   * 연동을 마친 뒤 돌아갈 우리 사이트 내부 경로. 없으면 콜백이 기본값을 쓴다.
   *
   * 값은 서명 대상 안에 들어가므로 위조할 수 없지만, 발급 시점에 한 번 더 검증한다
   * (`/`로 시작하고 `//`·스킴이 없어야 한다). 서명만 믿고 임의 문자열을 그대로
   * `Response.redirect` 에 넘기면 우리가 서명해 준 오픈 리다이렉트가 된다.
   */
  r?: string
  /**
   * 이 연동이 무엇을 위한 것인지. 'collab' = 캠페인(브랜드 매칭) 등록 화면,
   * 그 밖에는 디엠 자동화. 콜백이 토큰을 어느 보관함에 넣을지를 이 값으로 정한다.
   *
   * 클라이언트가 보낸 값이지만 서명 안에 들어가므로 발급 뒤에는 바꿀 수 없고,
   * 발급 시점에 아는 사람은 본인뿐이다(인증된 POST 경로에서만 발급한다).
   */
  p?: 'collab'
}

/**
 * 콜백 복귀 경로로 허용할 수 있는 값인지 검사한다.
 * 내부 절대 경로만 통과시킨다 — 외부 도메인(`//evil.com`, `https://…`)은 거부.
 */
export function sanitizeReturnPath(raw: unknown): string {
  const value = String(raw || '').trim()
  if (!value) return ''
  if (!value.startsWith('/')) return ''
  if (value.startsWith('//')) return ''
  // 개행·역슬래시 등으로 브라우저 파싱을 흔드는 값은 받지 않는다.
  if (/[\\\s]/.test(value)) return ''
  if (value.length > 256) return ''
  return value
}

/**
 * 서명된 state 를 발급한다. 반드시 인증을 마친 경로에서만 호출할 것.
 * nonce 를 블롭에 기록해 콜백에서 1회만 소비되게 한다.
 */
export async function issueSignedState(
  username: string,
  sessionUserId: string,
  returnTo?: string,
  purpose?: string,
): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
  const key = signingKey()
  if (!key) return { ok: false, error: 'missing_state_secret' }

  const payload: StatePayload = {
    u: username.toLowerCase().trim(),
    s: sessionUserId,
    n: randomBytes(16).toString('base64url'),
    e: Date.now() + STATE_TTL_MS,
  }
  const safeReturn = sanitizeReturnPath(returnTo)
  if (safeReturn) payload.r = safeReturn
  if (purpose === 'collab') payload.p = 'collab'
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const state = `${body}.${sign(body, key)}`

  try {
    const store = getStore({ name: NONCE_STORE, consistency: 'strong' })
    await store.setJSON(`nonce_${payload.n}`, { u: payload.u, e: payload.e })
  } catch (e) {
    // nonce 를 남기지 못하면 1회용 보장이 깨지므로 발급을 중단한다(fail-closed).
    console.warn('[oauth-state] nonce store write failed:', (e as Error)?.message)
    return { ok: false, error: 'state_store_unavailable' }
  }

  return { ok: true, state }
}

/**
 * state 를 검증하고 소비한다. 서명 불일치 / 만료 / 이미 사용된 nonce 는 모두 거부.
 */
export async function consumeSignedState(
  raw: string,
): Promise<{ ok: true; payload: StatePayload } | { ok: false; error: string }> {
  const key = signingKey()
  if (!key) return { ok: false, error: 'missing_state_secret' }

  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return { ok: false, error: 'bad_state' }

  const body = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  if (!safeEqual(mac, sign(body, key))) return { ok: false, error: 'bad_state_signature' }

  let payload: StatePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, error: 'bad_state' }
  }
  if (!payload?.u || !payload?.n || !payload?.e) return { ok: false, error: 'bad_state' }
  if (Date.now() > payload.e) return { ok: false, error: 'state_expired' }

  // 1회용 nonce 소비 — 없으면 이미 쓴 state 이거나 우리가 발급하지 않은 것.
  try {
    const store = getStore({ name: NONCE_STORE, consistency: 'strong' })
    const found = await store.get(`nonce_${payload.n}`, { type: 'json' })
    if (!found) return { ok: false, error: 'state_used' }
    await store.delete(`nonce_${payload.n}`)
  } catch (e) {
    console.warn('[oauth-state] nonce consume failed:', (e as Error)?.message)
    return { ok: false, error: 'state_store_unavailable' }
  }

  return { ok: true, payload }
}
