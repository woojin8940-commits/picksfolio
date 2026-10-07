/**
 * 멤버십 티어로 기능을 여닫는 공통 판정.
 *
 * 티어를 보고 막는 기능이 하나였을 때는 디엠 자동화 쪽(dm-automation-access)에 판정이
 * 같이 들어 있었다. 인사이트도 같은 프로 플랜 게이트를 쓰게 되면서 그 조회를 두 번
 * 적을 수는 없다 — 멤버십은 세 곳(결제 기록 · 무상 부여 명단 · 운영자 부여)을 겹쳐
 * 읽어야 답이 나오고, 그 겹치는 순서가 기능마다 어긋나면 같은 사람이 한 화면에서는
 * 구독자, 다른 화면에서는 미구독자가 된다.
 *
 * 그래서 "이 사람이 이 티어 이상인가"만 여기서 답하고, 어떤 기능이 어떤 티어를
 * 요구하는지는 기능별 파일(dm-automation-access · creator-insights-access)이 각자
 * 적는다.
 */

import { getStore } from '@netlify/blobs'
import { applyComplimentaryMembership } from './complimentary-memberships.mts'
import { applyOperatorMembershipGrant, getOperatorMembershipGrant } from './operator-membership-grants.mts'
import { normalizeTier, tierAtLeast, type MembershipTier } from './membership-billing.mts'

/**
 * 이 사용자의 멤버십이 지금 살아 있고, `required` 이상 티어인지.
 *
 * 구독이 멈춘 계정(`membership_active === false`)은 티어가 남아 있어도 통과시키지
 * 않는다 — 결제가 끊긴 뒤에도 마지막 티어로 계속 쓰이면 구독을 유지할 이유가 없다.
 *
 * 조회가 실패하면 막는다(fail-closed). 블롭이 한 번 흔들린 것으로 전용 기능이 열리는
 * 쪽보다, 구독자가 잠시 안내 화면을 보고 다시 열어 보는 쪽이 낫다.
 *
 * 기업(비즈니스) 계정도 예외가 아니다. 한동안 사용자명이 `biz/` 로 시작하면 무조건
 * 통과시키는 분기가 있었는데, 브랜드 사용자명은 로그인 응답(business-auth)부터
 * 화면·API 요청까지 접두사 없는 평문으로 흐르므로 그 분기는 한 번도 타지 않았다.
 * 실제로 적용되던 규칙(브랜드도 같은 티어를 구독해야 한다)만 남기고 지웠다 —
 * 도달하지 않는 면제가 남아 있으면 "브랜드는 무료"라는 잘못된 전제로 다른 기능이
 * 얹힌다. 접두사 제거는 그대로 둔다. 블롭·화면 쪽에는 `biz/` 를 붙여 쓰는 자리가
 * 남아 있어, 그런 이름이 들어와도 같은 멤버십 기록을 읽어야 한다.
 */
/**
 * 이 사용자의 멤버십 기록(결제 기록 · 무상 부여 명단 · 운영자 부여를 겹친 결과).
 * 조회가 실패하면 null — 호출부는 막는 쪽으로 읽는다(fail-closed).
 */
const readMembershipRecord = async (
  username: string | null | undefined,
  authUserId: string | null | undefined,
): Promise<Record<string, any> | null> => {
  if (!username) return null

  const clean = username.toLowerCase().replace(/^biz\//, '')
  try {
    const store = getStore('seller-verification')
    const stored = (await store
      .get(`seller_${clean}`, { type: 'json' })
      .catch(() => null)) as Record<string, any> | null
    const complimentary = applyComplimentaryMembership(clean, stored)
    const grant = await getOperatorMembershipGrant({ authUserId, username: clean })
    return applyOperatorMembershipGrant(complimentary, grant)
  } catch (e) {
    console.warn('[membership-access] membership lookup failed:', (e as Error)?.message)
    return null
  }
}

export const hasMembershipTier = async (
  username: string | null | undefined,
  authUserId: string | null | undefined,
  required: MembershipTier,
): Promise<boolean> => {
  const record = await readMembershipRecord(username, authUserId)
  return !!record?.membership_active && tierAtLeast(record?.membership_plan, required)
}

/**
 * 멤버십이 살아 있고, 플랜이 `plans` 중 하나인지.
 *
 * 등급(tierAtLeast)이 아니라 이름으로 본다. 자동 디엠 플랜은 예전 플랜 위에 얹힌
 * 상위 등급이 아니라 따로 파는 단일 기능이라, 등급으로 견주면 예전 스탠다드 구독자가
 * 자동 디엠까지 받게 된다.
 */
export const hasMembershipPlan = async (
  username: string | null | undefined,
  authUserId: string | null | undefined,
  plans: readonly MembershipTier[],
): Promise<boolean> => {
  const record = await readMembershipRecord(username, authUserId)
  const plan = normalizeTier(record?.membership_plan)
  return !!record?.membership_active && !!plan && plans.includes(plan)
}

/**
 * hasMembershipPlan 과 같은 판정이지만, 조회 실패를 "구독 없음"과 구분해 돌려준다.
 *
 * 자동 발송처럼 판정 결과로 이벤트를 버리는 곳이 쓴다. 블롭·DB 가 잠깐 흔들린 것을
 * "구독 없음"으로 읽으면 그동안 들어온 댓글이 재시도 없이 버려진다 — 호출부는
 * 'unknown' 을 받으면 막은 채로 나중에 다시 확인해야 한다.
 */
export const membershipPlanState = async (
  username: string | null | undefined,
  authUserId: string | null | undefined,
  plans: readonly MembershipTier[],
): Promise<'yes' | 'no' | 'unknown'> => {
  if (!username) return 'no'
  const clean = username.toLowerCase().replace(/^biz\//, '')

  let stored: Record<string, any> | null
  try {
    stored = (await getStore('seller-verification').get(`seller_${clean}`, { type: 'json' })) as
      | Record<string, any>
      | null
  } catch {
    return 'unknown'
  }

  let grant: Awaited<ReturnType<typeof getOperatorMembershipGrant>> = null
  try {
    grant = await getOperatorMembershipGrant({ authUserId, username: clean })
  } catch (e) {
    // 운영자 부여 표가 아직 없는 환경(마이그레이션 전)은 "부여 없음"이다. 그 밖의 오류는
    // 판정할 수 없다.
    if ((e as { code?: string })?.code !== '42P01') return 'unknown'
  }

  const record = applyOperatorMembershipGrant(applyComplimentaryMembership(clean, stored), grant)
  const plan = normalizeTier(record?.membership_plan)
  return record?.membership_active && plan && plans.includes(plan) ? 'yes' : 'no'
}
