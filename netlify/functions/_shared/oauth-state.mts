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
 *   5) 브라우저 결속 — 발급한 브라우저에만 비밀값을 쿠키로 심고(state 에는 그 해시만
 *      싣는다), 콜백에서 같은 쿠키가 있는지 본다. 서명·1회용 nonce 만으로는 "누가 이
 *      링크를 열었는가"를 가리지 못한다 — 공격자가 자기 계정으로 연동을 시작해 받은
 *      authorize 링크를 피해자에게 보내고 피해자가 자기 인스타그램으로 동의하면, 피해자의
 *      토큰이 공격자 계정에 저장됐다. 링크를 받은 다른 브라우저에는 이 쿠키가 없다.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getStore } from '@netlify/blobs'

const STATE_TTL_MS = 10 * 60 * 1000
const NONCE_STORE = 'oauth-state'

/** 브라우저 결속 쿠키 이름. 연동마다 nonce 로 이름을 나눠 두 탭에서 동시에 연동해도 서로 덮지 않는다. */
const bindingCookieName = (nonce: string) => `picks_oauth_${nonce}`

const hashBinding = (value: string) => createHash('sha256').update(value).digest('base64url')

/** Cookie 요청 헤더에서 값 하나를 꺼낸다. */
function readCookie(header: string | null | undefined, name: string): string {
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return ''
}

/**
 * 서명 키. 전용 키(OAUTH_STATE_SECRET)가 있으면 그걸 쓰고, 없으면 이미 두 함수 모두가
 * 갖고 있는 인스타그램 앱 시크릿을 유도 키로 쓴다. 값 자체는 절대 응답에 싣지 않는다.
 */
function signingKey(): string | null {
  return process.env.OAUTH_STATE_SECRET || process.env.INSTAGRAM_APP_SECRET || null
}

/**
 * 브라우저 결속을 끄는 비상 스위치. 환경 변수 `OAUTH_BROWSER_BINDING=off` 일 때만 꺼진다.
 *
 * 기기에 따라 동의 화면이 다른 브라우저로 넘어가 끝나는 경우가 있다(인스타그램 앱이 동의를
 * 가져간 뒤 콜백을 기본 브라우저로 여는 경우 등). 그런 기기가 많아 연동이 막히면 코드를
 * 고치지 않고 이 값만 바꿔 다시 배포해 연동을 살린다. 끄면 위 5) 의 방어가 빠지므로 원인을
 * 확인한 뒤 바로 되돌린다. 서명 · 만료 · 1회용 nonce 검사는 그대로 남는다.
 */
function browserBindingEnforced(): boolean {
  return String(process.env.OAUTH_BROWSER_BINDING || '').trim().toLowerCase() !== 'off'
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
  /** 발급한 브라우저에 심은 결속 값의 해시(브라우저 결속). */
  b: string
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
   * 'ads' = 광고 현황의 메타 광고 계정 연동, 그 밖에는 디엠 자동화. 콜백이 토큰을
   * 어느 보관함에 넣을지를 이 값으로 정한다.
   *
   * 'ads' 는 인스타그램 연동과 **다른 앱·다른 콜백**을 쓴다. 두 흐름이 state 서명 키를
   * 함께 쓰기 때문에, 이 표시가 없으면 한쪽에서 발급한 state 를 다른 쪽 콜백에 넣어도
   * 서명을 통과한다 — 콜백마다 자기 용도의 state 만 받게 하려고 남긴다.
   *
   * 클라이언트가 보낸 값이지만 서명 안에 들어가므로 발급 뒤에는 바꿀 수 없고,
   * 발급 시점에 아는 사람은 본인뿐이다(인증된 POST 경로에서만 발급한다).
   */
  p?: 'collab' | 'ads'
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
 *
 * 돌려주는 `cookie` 는 발급 응답의 Set-Cookie 로 그대로 내보내야 한다(브라우저 결속).
 */
export async function issueSignedState(
  username: string,
  sessionUserId: string,
  returnTo?: string,
  purpose?: string,
): Promise<{ ok: true; state: string; cookie: string } | { ok: false; error: string }> {
  const key = signingKey()
  if (!key) return { ok: false, error: 'missing_state_secret' }

  const binding = randomBytes(32).toString('base64url')
  const payload: StatePayload = {
    u: username.toLowerCase().trim(),
    s: sessionUserId,
    n: randomBytes(16).toString('base64url'),
    e: Date.now() + STATE_TTL_MS,
    b: hashBinding(binding),
  }
  const safeReturn = sanitizeReturnPath(returnTo)
  if (safeReturn) payload.r = safeReturn
  if (purpose === 'collab' || purpose === 'ads') payload.p = purpose
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

  // 콜백(/api/... 아래)으로 돌아오는 최상위 이동에서만 쓰인다. 다른 사이트에서 돌아오는
  // GET 이동이라 SameSite=Lax 여야 실린다.
  const cookie = `${bindingCookieName(payload.n)}=${binding}; Path=/api/; Max-Age=${Math.floor(STATE_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`

  return { ok: true, state, cookie }
}

/**
 * state 를 검증하고 소비한다. 서명 불일치 / 만료 / 다른 브라우저 / 이미 사용된 nonce 는
 * 모두 거부. `cookieHeader` 는 콜백 요청의 Cookie 헤더다.
 */
export async function consumeSignedState(
  raw: string,
  cookieHeader: string | null | undefined,
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

  // 연동을 시작한 브라우저인지. nonce 를 소비하기 전에 본다 — 링크만 받은 다른 브라우저의
  // 시도가 본인의 연동을 못 쓰게 만들지 않도록.
  const binding = readCookie(cookieHeader, bindingCookieName(String(payload.n)))
  if (!binding || typeof payload.b !== 'string' || !safeEqual(hashBinding(binding), payload.b)) {
    if (!browserBindingEnforced()) {
      console.warn('[oauth-state] browser binding mismatch ignored (OAUTH_BROWSER_BINDING=off)')
    } else {
      return { ok: false, error: 'state_browser_mismatch' }
    }
  }

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
