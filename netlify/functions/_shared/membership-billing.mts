/**
 * Recurring billing for the paid memberships (스탠다드 / 스탠다드 AI / 커머스).
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

export type MembershipTier = 'standard' | 'standard_ai' | 'commerce'

// Keep these in sync with the prices shown in src/components/MembershipPlan.tsx.
export const TIER_PRICE_KRW: Record<MembershipTier, number> = {
  standard: 4900,
  standard_ai: 6900,
  commerce: 13900,
}

export const TIER_LABEL: Record<MembershipTier, string> = {
  standard: '스탠다드 멤버십',
  standard_ai: '스탠다드 AI 멤버십',
  commerce: '커머스 멤버십',
}

/** Normalise a stored plan value to a billable tier, or null if it isn't one.
 * Legacy 'live' installs map to the current 'commerce' tier. */
export const normalizeTier = (plan: unknown): MembershipTier | null => {
  if (plan === 'standard' || plan === 'standard_ai' || plan === 'commerce') return plan
  if (plan === 'live') return 'commerce'
  return null
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
