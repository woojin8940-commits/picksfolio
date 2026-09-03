/**
 * 디엠(DM) 자동화 이용 권한.
 *
 * 디엠 자동화는 **프로 플랜(월 18,700원)** 전용 기능이다. 프로 플랜은 모든 멤버십 플랜의
 * 기능에 디엠 자동화까지 포함하는 최상위 티어이므로, 하위 티어(스탠다드 / AI 협업 / 커머스)
 * 구독자와 미구독자는 자동화를 만들거나 발송할 수 없다.
 *
 * 기업(비즈니스) 계정은 예외다 — 협업 워크스페이스에 포함된 기능으로 제공하며, 인플루언서
 * 멤버십 티어로 값을 매기지 않는다(협업 AI 게이트와 동일한 원칙). 기업 계정은 사용자명이
 * `biz/` 로 시작하고 디엠 설정도 그 키에 저장된다.
 *
 * 설정 저장(api-dm-automation), 실제 발송(instagram-webhook) 양쪽에서 같은 판정을 쓴다.
 */

import { getStore } from '@netlify/blobs'
import { applyComplimentaryMembership } from './complimentary-memberships.mts'
import { applyOperatorMembershipGrant, getOperatorMembershipGrant } from './operator-membership-grants.mts'
import { tierAtLeast, type MembershipTier } from './membership-billing.mts'

/** 디엠 자동화에 필요한 최소 티어. */
export const DM_AUTOMATION_TIER: MembershipTier = 'pro'

export const DM_AUTOMATION_REQUIRED_MESSAGE =
  '디엠 자동화는 프로 플랜(월 18,700원) 전용 기능이에요. 프로 플랜을 구독하면 바로 사용할 수 있습니다.'

/** 기업(비즈니스) 계정인지 — 이 계정들은 멤버십 게이트를 적용하지 않는다. */
export const isBusinessAccountName = (username: string | null | undefined): boolean =>
  !!username && username.toLowerCase().startsWith('biz/')

/** 이 사용자가 디엠 자동화를 이용할 수 있는지. */
export const dmAutomationAllowed = async (
  username: string | null | undefined,
  authUserId?: string | null,
): Promise<boolean> => {
  if (!username) return false
  if (isBusinessAccountName(username)) return true

  const clean = username.toLowerCase().replace(/^biz\//, '')
  try {
    const store = getStore('seller-verification')
    const stored = (await store
      .get(`seller_${clean}`, { type: 'json' })
      .catch(() => null)) as Record<string, any> | null
    const complimentary = applyComplimentaryMembership(clean, stored)
    const grant = await getOperatorMembershipGrant({ authUserId, username: clean })
    const record = applyOperatorMembershipGrant(complimentary, grant)
    return !!record?.membership_active && tierAtLeast(record?.membership_plan, DM_AUTOMATION_TIER)
  } catch (e) {
    console.warn('[dm-access] membership lookup failed:', (e as Error)?.message)
    return false
  }
}
