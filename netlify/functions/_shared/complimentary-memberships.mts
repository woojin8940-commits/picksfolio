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

export type ComplimentaryTier = 'standard' | 'commerce'

const COMPLIMENTARY: Record<string, ComplimentaryTier> = {
  dnwlsdnwls: 'commerce',
  dnwlsdnwls123: 'commerce',
}

export function getComplimentaryMembership(username: string | null | undefined): ComplimentaryTier | null {
  if (!username) return null
  const clean = username.toLowerCase().replace(/^biz\//, '')
  return COMPLIMENTARY[clean] || null
}

export interface MembershipOverlayInput {
  membership_active?: boolean
  membership_plan?: 'standard' | 'commerce' | 'live' | null
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
  const currentTier = base.membership_plan === 'live' ? 'commerce' : base.membership_plan
  const alreadyEqualOrHigher =
    base.membership_active &&
    (currentTier === 'commerce' || (currentTier === tier))

  if (alreadyEqualOrHigher) return base as any

  base.membership_active = true
  base.membership_plan = tier
  base.membership_started_at = base.membership_started_at || new Date().toISOString()
  return base as any
}
