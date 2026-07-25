/**
 * Recurring billing for the paid memberships (스탠다드 / AI 협업 / 커머스 / 프로).
 *
 * Unlike the Claude plan — which is a prepaid credit wallet topped up by balance,
 * NOT by a calendar cycle, and is intentionally EXCLUDED from this module — the
 * memberships are true monthly subscriptions. Each member pays on the anniversary
 * of the day they subscribed (가입일 기준): subscribe on the 8th → next charge on
 * the 8th of the following month, and so on.
 *
 * The flow has two halves that share this module:
 *   1. On subscribe (`api-billing-issue`), the first month is charged immediately
 *      against the freshly issued PortOne billing key, anchoring the billing day.
 *   2. A daily scheduler (`scheduled-membership-billing`) finds every subscription
 *      whose next billing day has arrived and charges it again, rolling the date
 *      forward by one month on success.
 *
 * Money lives in ₩ (the membership price); there are no credits here.
 */

// 'pro' 는 모든 멤버십 기능 + 디엠 자동화까지 포함하는 최상위 티어다.
export type MembershipTier = 'standard' | 'standard_ai' | 'commerce' | 'pro'

// Keep these in sync with the prices shown in src/components/MembershipPlan.tsx.
export const TIER_PRICE_KRW: Record<MembershipTier, number> = {
  standard: 4900,
  standard_ai: 6900,
  commerce: 13900,
  pro: 18700,
}

export const TIER_LABEL: Record<MembershipTier, string> = {
  standard: '스탠다드 멤버십',
  standard_ai: 'AI 협업 멤버십',
  commerce: '커머스 멤버십',
  pro: '프로 플랜',
}

/** Normalise a stored plan value to a billable tier, or null if it isn't one.
 * Legacy 'live' installs map to the current 'commerce' tier. */
export const normalizeTier = (plan: unknown): MembershipTier | null => {
  if (plan === 'standard' || plan === 'standard_ai' || plan === 'commerce' || plan === 'pro') {
    return plan
  }
  if (plan === 'live') return 'commerce'
  return null
}

/**
 * 티어 포함 관계. 상위 티어는 하위 티어의 기능을 모두 포함한다.
 *   standard  ⊂ standard_ai(AI 협업) ⊂ commerce(커머스) ⊂ pro(프로)
 * 프로 플랜만 디엠 자동화를 사용할 수 있다(featureTiers.dmAutomation).
 */
export const TIER_RANK: Record<MembershipTier, number> = {
  standard: 1,
  standard_ai: 2,
  commerce: 3,
  pro: 4,
}

/** `plan` 이 `required` 티어 이상인지(= 해당 기능을 쓸 수 있는지). */
export const tierAtLeast = (plan: unknown, required: MembershipTier): boolean => {
  const tier = normalizeTier(plan)
  if (!tier) return false
  return TIER_RANK[tier] >= TIER_RANK[required]
}

// After this many consecutive failed charge attempts the subscription is paused
// (membership_active → false). The member can re-subscribe to register a new card.
export const MAX_BILLING_FAILURES = 3

// ── Anniversary date math ────────────────────────────────────────────────────
/**
 * Add one calendar month to an ISO timestamp, preserving the day-of-month where
 * possible and clamping to the last day of shorter months (e.g. Jan 31 → Feb 28,
 * Aug 31 → Sep 30). Returns an ISO string at the same UTC time-of-day.
 */
export const addOneMonth = (fromIso: string): string => {
  const base = new Date(fromIso)
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth()
  const day = base.getUTCDate()

  // Last day of the target month (month+1, day 0 = last day of month+1 in JS).
  const lastDayOfTarget = new Date(Date.UTC(year, month + 2, 0)).getUTCDate()
  const targetDay = Math.min(day, lastDayOfTarget)

  const next = new Date(base)
  next.setUTCFullYear(year, month + 1, targetDay)
  return next.toISOString()
}

/** True when `dueIso` is now or in the past (the charge is due). */
export const isDue = (dueIso: string | null | undefined, now: Date): boolean => {
  if (!dueIso) return false
  const due = new Date(dueIso).getTime()
  return Number.isFinite(due) && due <= now.getTime()
}

// ── PortOne billing-key charge ───────────────────────────────────────────────
// storeId is the public PortOne V2 identifier (same one the browser SDK uses);
// the API secret is server-only.
import { chargeTossBillingKey } from './toss-payments.mts'

const PORTONE_API_BASE = 'https://api.portone.io'
const PORTONE_STORE_ID = 'store-1e85edf9-8f37-490c-9419-5a1f15db9ab5'

const asciiSafe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'user'

/**
 * Charge one month of a membership against its stored PortOne billing key. Used
 * for both the first charge on subscribe and the recurring monthly charges.
 * Returns the verified paymentId on success; fails softly so the caller decides
 * whether to retry (scheduler) or surface the error (subscribe).
 */
export const chargeMembershipBillingKey = async (
  username: string,
  billingKey: string,
  tier: MembershipTier,
): Promise<{ success: boolean; paymentId?: string; amountKrw?: number; error?: string }> => {
  const apiSecret = process.env.PORTONE_V2_API_SECRET
  if (!apiSecret) return { success: false, error: 'PORTONE_V2_API_SECRET 미설정' }

  const amountKrw = TIER_PRICE_KRW[tier]
  const paymentId = `membership-${asciiSafe(username)}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
  try {
    const res = await fetch(
      `${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}/billing-key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `PortOne ${apiSecret}`,
        },
        body: JSON.stringify({
          billingKey,
          storeId: PORTONE_STORE_ID,
          orderName: `픽스폴리오 ${TIER_LABEL[tier]} 월 구독료`,
          customer: { customerId: asciiSafe(username) },
          amount: { total: amountKrw },
          currency: 'KRW',
        }),
      },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { success: false, amountKrw, error: `PortOne ${res.status}: ${detail.slice(0, 200)}` }
    }
    return { success: true, paymentId, amountKrw }
  } catch (e: any) {
    return { success: false, amountKrw, error: e?.message || 'PortOne 정기결제 요청 실패' }
  }
}

// ── 카드(나이스정보통신) 정기결제 빌링키 발급 (수기/키인) ─────────────────────────
// NICE V2 는 브라우저 SDK(requestIssueBillingKey)로 카드 빌링키를 발급할 수 없고
// (간편결제만 지원), 카드 정기결제는 REST API `POST /billing-keys` 수기(키인) 방식만
// 지원한다 — PortOne V2 NICE 문서 기준. 카드 정보를 서버에서 PortOne 으로 전달해
// 빌링키를 발급받고, 이후에는 발급된 빌링키로 매월 자동결제한다(카드 정보는 저장하지 않음).
//
// 카드 정기결제 채널(정기결제 전용 MID)은 일반결제(단건) 채널과 다르다. PortOne 실연동 승인으로
// 발급된 나이스정보통신 정기결제(수기/키인) 전용 채널(MID IM0029309m)의 채널 키를 사용한다.
// 채널 키는 브라우저에도 공개되는 식별자이며(시크릿 아님 — 서버 전용 값은 PORTONE_V2_API_SECRET),
// 환경변수 PORTONE_NICE_BILLING_CHANNEL_KEY 로 재정의할 수 있다.
const PORTONE_NICE_BILLING_CHANNEL_KEY =
  process.env.PORTONE_NICE_BILLING_CHANNEL_KEY?.trim() ||
  'channel-key-e5f534a5-d7a5-46de-8c92-2528d5e49e02'

export const isNiceCardBillingConfigured = () => !!PORTONE_NICE_BILLING_CHANNEL_KEY

export interface NiceCardCredential {
  number: string // 카드번호 (숫자만)
  expiryYear: string // 'YY'
  expiryMonth: string // 'MM'
  birthOrBusinessRegistrationNumber: string // 생년월일 6자리(개인) 또는 사업자등록번호 10자리
  passwordTwoDigits: string // 카드 비밀번호 앞 2자리
}

export const issueNiceCardBillingKey = async (
  username: string,
  card: NiceCardCredential,
): Promise<{ ok: true; billingKey: string } | { ok: false; error: string }> => {
  const apiSecret = process.env.PORTONE_V2_API_SECRET
  const channelKey = PORTONE_NICE_BILLING_CHANNEL_KEY
  if (!apiSecret) return { ok: false, error: '결제 설정이 완료되지 않았습니다.' }
  if (!channelKey)
    return {
      ok: false,
      error: '카드 정기결제(빌링) 채널이 아직 연결되지 않았습니다. 관리자에게 문의해 주세요.',
    }

  try {
    const res = await fetch(`${PORTONE_API_BASE}/billing-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `PortOne ${apiSecret}` },
      body: JSON.stringify({
        storeId: PORTONE_STORE_ID,
        channelKey,
        customer: { id: asciiSafe(username) },
        method: {
          card: {
            credential: {
              number: card.number,
              expiryYear: card.expiryYear,
              expiryMonth: card.expiryMonth,
              birthOrBusinessRegistrationNumber: card.birthOrBusinessRegistrationNumber,
              passwordTwoDigits: card.passwordTwoDigits,
            },
          },
        },
      }),
    })
    const data = (await res.json().catch(() => ({}))) as any
    if (!res.ok) {
      return { ok: false, error: data?.message || `카드 등록 실패 (${res.status})` }
    }
    const billingKey: string | undefined = data?.billingKeyInfo?.billingKey || data?.billingKey
    if (!billingKey) return { ok: false, error: '빌링키를 발급받지 못했습니다.' }
    return { ok: true, billingKey }
  } catch (e: any) {
    return { ok: false, error: e?.message || '카드 등록 요청에 실패했습니다.' }
  }
}

/**
 * Charge one month of a membership against a stored TossPayments billing key
 * (토스페이먼츠 카드, 토스페이먼츠 직접 연동). Mirrors `chargeMembershipBillingKey`
 * but uses the TossPayments billing API; requires the customerKey captured when the
 * billing key was issued.
 */
export const chargeTossMembershipBillingKey = async (
  username: string,
  billingKey: string,
  customerKey: string,
  tier: MembershipTier,
): Promise<{ success: boolean; paymentId?: string; amountKrw?: number; error?: string }> => {
  const amountKrw = TIER_PRICE_KRW[tier]
  const orderId = `membership-${asciiSafe(username)}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
  const charge = await chargeTossBillingKey(
    billingKey,
    customerKey,
    amountKrw,
    orderId,
    `픽스폴리오 ${TIER_LABEL[tier]} 월 구독료`,
  )
  if (!charge.ok) return { success: false, amountKrw, error: charge.error }
  return { success: true, paymentId: charge.paymentKey || orderId, amountKrw }
}

/**
 * Charge one month of a membership using whichever provider issued the billing key.
 * `provider === 'toss'` uses TossPayments (and needs `tossCustomerKey`); anything
 * else uses PortOne. Recurring billing (the daily scheduler) calls this so it never
 * has to know which provider a member used at subscribe time.
 */
export const chargeMembershipMonthly = async (
  username: string,
  billingKey: string,
  tier: MembershipTier,
  provider?: string | null,
  tossCustomerKey?: string | null,
): Promise<{ success: boolean; paymentId?: string; amountKrw?: number; error?: string }> => {
  if (provider === 'toss') {
    if (!tossCustomerKey) return { success: false, amountKrw: TIER_PRICE_KRW[tier], error: '토스페이먼츠 customerKey 누락' }
    return chargeTossMembershipBillingKey(username, billingKey, tossCustomerKey, tier)
  }
  return chargeMembershipBillingKey(username, billingKey, tier)
}

// ── Subscription record shape (stored on the seller-verification blob) ────────
export interface MembershipBillingEntry {
  at: string
  tier: MembershipTier
  amountKrw: number
  kind: 'initial' | 'recurring'
  success: boolean
  paymentId?: string
  error?: string
}
