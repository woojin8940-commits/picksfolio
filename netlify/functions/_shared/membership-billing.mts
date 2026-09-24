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

/**
 * 라이브 커머스 멤버십(별도 구독)은 판매를 종료했다 — 결제·구독·정기청구 경로가
 * 모두 없어졌으므로 여기에도 플랜이 없다. 커머스(13,900) 티어는 예전 구독자의
 * 등급 비교를 위해서만 남는다(신규 판매 없음).
 */

// Keep these in sync with the prices shown in src/components/MembershipPlan.tsx.
// 표시가는 모두 부가세(VAT 10%) 포함 금액이다 — 결제도 이 금액 그대로 청구한다.
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
 * 라이브 커머스를 쓸 수 있는 상태인지 — 레거시 판정 전용.
 * 라이브 커머스 멤버십은 판매를 종료했으므로 새로 통과하는 경로는 없고,
 * 예전에 결제한 기록(live_plan_active) 또는 예전 커머스(구 'live') 멤버십을
 * 유지 중인 기존 구독자만 true 가 된다. 그 밖에는 모두 차단된다(fail-closed).
 */
export const hasLiveCommerceAccess = (
  record:
    | {
        membership_active?: boolean
        membership_plan?: unknown
        live_plan_active?: boolean
      }
    | null
    | undefined,
): boolean => {
  if (!record) return false
  if (record.live_plan_active) return true
  return Boolean(record.membership_active) && normalizeTier(record.membership_plan) === 'commerce'
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
 * Add `months` calendar months to an ISO timestamp, preserving the day-of-month
 * where possible and clamping to the last day of shorter months (e.g. Jan 31 →
 * Feb 28, Aug 31 → Sep 30). Returns an ISO string at the same UTC time-of-day.
 *
 * 매월 청구(1개월)와 출시 혜택 무료 기간(6개월)이 같은 날짜 계산을 쓴다 — 무료
 * 기간은 "첫 청구일을 6개월 뒤로 미룬 구독"이므로, 그 뒤의 매월 청구가 같은
 * 날짜에 이어지려면 두 계산이 어긋나지 않아야 한다.
 */
export const addMonths = (fromIso: string, months: number): string => {
  const base = new Date(fromIso)
  const step = Math.trunc(months)
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth()
  const day = base.getUTCDate()

  // Last day of the target month (day 0 = last day of the preceding month in JS).
  const lastDayOfTarget = new Date(Date.UTC(year, month + step + 1, 0)).getUTCDate()
  const targetDay = Math.min(day, lastDayOfTarget)

  const next = new Date(base)
  next.setUTCFullYear(year, month + step, targetDay)
  return next.toISOString()
}

/** Add one calendar month — the monthly billing anniversary step. */
export const addOneMonth = (fromIso: string): string => addMonths(fromIso, 1)

/** True when `dueIso` is now or in the past (the charge is due). */
export const isDue = (dueIso: string | null | undefined, now: Date): boolean => {
  if (!dueIso) return false
  const due = new Date(dueIso).getTime()
  return Number.isFinite(due) && due <= now.getTime()
}

// ── PortOne billing-key charge ───────────────────────────────────────────────
// storeId is the public PortOne V2 identifier (same one the browser SDK uses);
// the API secret is server-only.

const PORTONE_API_BASE = 'https://api.portone.io'
const PORTONE_STORE_ID = 'store-1e85edf9-8f37-490c-9419-5a1f15db9ab5'

const asciiSafe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'user'
const sdkCustomerId = (s: string) => s.replace(/[^\x00-\x7F]/g, (ch) => `_${(ch.codePointAt(0) ?? 0).toString(36)}`)

const ownerName = (username: string) =>
  String(username || '').trim().toLowerCase().replace(/^biz\//, '')

const ownedByAccount = (customerId: unknown, username: string): boolean => {
  const base = ownerName(username)
  if (!base) return false
  const actual = String(customerId || '').trim().toLowerCase()
  if (!actual) return false
  return actual === asciiSafe(base) || actual === sdkCustomerId(base)
}

export type MembershipChargePending = {
  paymentId: string
  billingKey: string
  tier: MembershipTier
  kind: 'initial' | 'recurring'
  startedAt: string
  scheduledDate?: string
  method?: 'card' | 'easypay'
}

export const verifyMembershipBillingKey = async (username: string, billingKey: string): Promise<boolean | null> => {
  const apiSecret = process.env.PORTONE_V2_API_SECRET
  if (!apiSecret) return null
  try {
    const res = await fetch(`${PORTONE_API_BASE}/billing-keys/${encodeURIComponent(billingKey)}?storeId=${encodeURIComponent(PORTONE_STORE_ID)}`, {
      headers: { Authorization: `PortOne ${apiSecret}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404) return false
    if (!res.ok) return null
    const info = await res.json() as any
    return info?.status === 'ISSUED' && info?.billingKey === billingKey &&
      info?.storeId === PORTONE_STORE_ID && ownedByAccount(info?.customer?.id, username)
  } catch {
    return null
  }
}

type ChargeResult = { success: boolean; uncertain?: boolean; paymentId: string; amountKrw: number; error?: string }

const readCharge = async (
  apiSecret: string,
  paymentId: string,
  username: string,
  billingKey: string,
  amountKrw: number,
): Promise<'paid' | 'failed' | 'missing' | 'unknown'> => {
  try {
    const res = await fetch(`${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${apiSecret}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404) return 'missing'
    if (!res.ok) return 'unknown'
    const payment = await res.json() as any
    if (payment?.id !== paymentId || payment?.storeId !== PORTONE_STORE_ID ||
      payment?.currency !== 'KRW' || payment?.amount?.total !== amountKrw ||
      !ownedByAccount(payment?.customer?.id, username) ||
      (payment?.billingKey && payment.billingKey !== billingKey)) return 'unknown'
    if (payment.status === 'PAID') return 'paid'
    if (payment.status === 'FAILED' || payment.status === 'CANCELLED') return 'failed'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export const readMembershipCharge = async (
  pending: MembershipChargePending,
  username: string,
): Promise<'paid' | 'failed' | 'missing' | 'unknown'> => {
  const apiSecret = process.env.PORTONE_V2_API_SECRET
  if (!apiSecret) return 'unknown'
  return readCharge(
    apiSecret,
    pending.paymentId,
    username,
    pending.billingKey,
    TIER_PRICE_KRW[pending.tier],
  )
}

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
  paymentId: string,
): Promise<ChargeResult> => {
  const apiSecret = process.env.PORTONE_V2_API_SECRET
  const amountKrw = TIER_PRICE_KRW[tier]
  if (!apiSecret) return { success: false, paymentId, amountKrw, error: '결제 설정이 완료되지 않았습니다.' }
  const before = await readCharge(apiSecret, paymentId, username, billingKey, amountKrw)
  if (before === 'paid') return { success: true, paymentId, amountKrw }
  if (before === 'failed') return { success: false, paymentId, amountKrw, error: '결제에 실패했습니다.' }
  try {
    await fetch(
      `${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}/billing-key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `PortOne ${apiSecret}`,
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          billingKey,
          storeId: PORTONE_STORE_ID,
          orderName: `픽스폴리오 ${TIER_LABEL[tier]} 월 구독료`,
          customer: { id: asciiSafe(username) },
          amount: { total: amountKrw },
          currency: 'KRW',
        }),
      },
    )
    const after = await readCharge(apiSecret, paymentId, username, billingKey, amountKrw)
    if (after === 'paid') return { success: true, paymentId, amountKrw }
    if (after === 'failed') {
      return { success: false, paymentId, amountKrw, error: '결제에 실패했습니다. 결제 수단을 확인해 주세요.' }
    }
    return { success: false, uncertain: true, paymentId, amountKrw, error: '결제 결과를 확인할 수 없습니다.' }
  } catch {
    const after = await readCharge(apiSecret, paymentId, username, billingKey, amountKrw)
    if (after === 'paid') return { success: true, paymentId, amountKrw }
    if (after === 'failed') return { success: false, paymentId, amountKrw, error: '결제에 실패했습니다.' }
    return { success: false, uncertain: true, paymentId, amountKrw, error: '결제 결과를 확인할 수 없습니다.' }
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

// 멤버십 청구 기록 한 건. 첫 결제(initial)와 매월 자동결제(recurring) 모두 같은 형태로
// 레코드의 billing_history 앞에 쌓인다(최대 50건). 화면 쪽 타입은 src/types.ts 의
// MembershipBillingHistoryEntry 와 대응한다.
export interface MembershipBillingEntry {
  at: string
  // 'live_plan' 은 판매 종료된 라이브 커머스 멤버십의 과거 청구 기록에만 남는다.
  tier: MembershipTier | 'live_plan'
  amountKrw: number
  // 'promo' 는 출시 혜택 코드로 시작한 구독의 첫 기록이다 — 청구가 없었으므로
  // amountKrw 는 0 이고, 무료 기간이 끝나는 날부터 'recurring' 이 이어진다.
  kind: 'initial' | 'recurring' | 'promo'
  success: boolean
  paymentId?: string
  error?: string
}

// 해지 처리 방식을 정한다. 결제한 이용 기간이 남아 있으면 그 기간이 끝나는 날(=다음 결제일)
// 종료되도록 예약하고, 남은 기간이 없으면(증정 멤버십처럼 결제일이 없거나 이미 지난 경우)
// 즉시 종료한다.
export const resolveCancellation = (
  record:
    | { membership_active?: boolean; next_billing_date?: string | null }
    | null
    | undefined,
  now: Date,
): { mode: 'scheduled'; endsAt: string } | { mode: 'immediate' } => {
  if (!record?.membership_active || !record.next_billing_date) return { mode: 'immediate' }
  const endsAt = new Date(record.next_billing_date).getTime()
  if (!Number.isFinite(endsAt) || endsAt <= now.getTime()) return { mode: 'immediate' }
  return { mode: 'scheduled', endsAt: new Date(endsAt).toISOString() }
}
