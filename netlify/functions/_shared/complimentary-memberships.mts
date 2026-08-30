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
  //
  // 키는 **로그인 아이디(profiles.username)** 다. 화면 인사말에 보이는 이름은
  // profiles.full_name(비즈니스 계정에서는 상호명)이라 아이디와 다를 수 있다 —
  // 점검 계정 '테스트123' 의 실제 로그인 아이디는 'tester123' 이다. 인사말만 보고
  // 'test123' 을 넣으면 어디에도 걸리지 않아 그대로 미구독으로 보인다.
  //
  // 아래 키는 'biz/' 접두사를 떼고 비교하므로 같은 아이디로 쓰는 비즈니스 계정
  // (biz/tester123)도 같은 티어를 받는다.
  tester123: 'pro',
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
 */
export function applyComplimentaryMembership<T extends MembershipOverlayInput | null | undefined>(
  username: string | null | undefined,
  record: T,
): T extends null | undefined ? MembershipOverlayInput | T : T {
  const tier = getComplimentaryMembership(username)
  if (!tier) return record as any

  const base: MembershipOverlayInput = record ? { ...record } : {}
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
