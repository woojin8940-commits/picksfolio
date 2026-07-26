/**
 * Complimentary memberships granted outside the paid subscription flow.
 *
 * Usernames listed here are treated as having an active membership of the
 * given tier whenever the seller-verification record is read, even if the
 * Netlify Blob does not carry an `membership_active` flag (e.g. the user has
 * never gone through the PortOne checkout). Used for partner / staff /
 * comp accounts that the operator has decided to grant access to.
 *
 * Keys are matched case-insensitively against the lowercase username used
 * everywhere else in the membership read/write paths.
 */

import { TIER_RANK, normalizeTier, type MembershipTier } from './membership-billing.mts'

export type ComplimentaryTier = MembershipTier

// 'pro'(프로 플랜) 는 모든 멤버십 기능 + 디엠 자동화를 포함하는 최상위 티어다. 운영/QA 계정은
// 기능 점검을 위해 전부 사용할 수 있어야 하므로 프로 플랜으로 부여한다.
const COMPLIMENTARY: Record<string, ComplimentaryTier> = {
  dnwlsdnwls: 'pro',
  dnwlsdnwls123: 'pro',
  // QA / test accounts — granted the top tier so every plan feature is available.
  tester_508070: 'pro',
  tester_711872: 'pro',
}

export function getComplimentaryMembership(username: string | null | undefined): ComplimentaryTier | null {
  if (!username) return null
  const clean = username.toLowerCase().replace(/^biz\//, '')
  return COMPLIMENTARY[clean] || null
}

export interface MembershipOverlayInput {
  membership_active?: boolean
  membership_plan?: 'standard' | 'standard_ai' | 'commerce' | 'pro' | 'live' | null
  membership_started_at?: string | null
  live_plan_active?: boolean
  [key: string]: any
}

/**
 * Overlay a complimentary tier onto an existing seller-verification record.
 * - If the stored record already has an active membership at an equal or
 *   higher tier, leaves it alone (don't downgrade a paid commerce member to
 *   complimentary standard).
 * - Otherwise upgrades the record so reads see `membership_active: true`
 *   and the comp tier, preserving any business/settlement data already on
 *   the record.
 * - 라이브 커머스는 멤버십 티어와 별개로 결제하는 구독이라 티어만으로는 열리지
 *   않는다. 운영/QA 계정은 라이브도 점검해야 하므로 함께 켜 준다.
 */
export function applyComplimentaryMembership<T extends MembershipOverlayInput | null | undefined>(
  username: string | null | undefined,
  record: T,
): T extends null | undefined ? MembershipOverlayInput | T : T {
  const tier = getComplimentaryMembership(username)
  if (!tier) return record as any

  const base: MembershipOverlayInput = record ? { ...record } : {}
  // 무상 계정은 라이브 커머스도 열어 준다(별도 결제 대상이지만 QA 목적).
  base.live_plan_active = true
  // 'live' 등 과거 플랜 값도 현재 티어로 환산해 등급을 비교한다.
  const currentTier = normalizeTier(base.membership_plan)
  const alreadyEqualOrHigher =
    !!base.membership_active && !!currentTier && TIER_RANK[currentTier] >= TIER_RANK[tier]

  if (alreadyEqualOrHigher) return base as any

  base.membership_active = true
  base.membership_plan = tier
  base.membership_started_at = base.membership_started_at || new Date().toISOString()
  return base as any
}
