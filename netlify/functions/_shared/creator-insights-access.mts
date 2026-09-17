/**
 * 인사이트 이용 권한.
 *
 * 인사이트(본인 계정 성과 · 팔로워 분석 · 벤치마킹)는 **프로 플랜(월 18,700원)** 전용
 * 기능이다. 디엠 자동화와 같은 티어를 요구한다 — 둘 다 연동한 인스타그램 계정을
 * 밑절미로 돌아가는 기능이라, 하나는 열고 하나는 막으면 "연동은 됐는데 왜 여기만
 * 안 되나"를 매번 설명해야 한다.
 *
 * 판정은 조회 경로(api-creator-insights)의 네 갈래 모두에 같은 자리에서 걸린다.
 * 요약만 막고 팔로워 추이나 벤치마킹을 열어 두면, 화면 한 칸만 가린 셈이 된다.
 */

import { hasMembershipTier } from './membership-access.mts'
import type { MembershipTier } from './membership-billing.mts'

/** 인사이트에 필요한 최소 티어. */
export const CREATOR_INSIGHTS_TIER: MembershipTier = 'pro'

export const CREATOR_INSIGHTS_REQUIRED_MESSAGE =
  '인사이트는 프로 플랜(월 18,700원) 전용 기능이에요. 프로 플랜을 구독하면 바로 사용할 수 있습니다.'

/** 이 사용자가 인사이트를 볼 수 있는지. */
export const creatorInsightsAllowed = (
  username: string | null | undefined,
  authUserId?: string | null,
): Promise<boolean> => hasMembershipTier(username, authUserId, CREATOR_INSIGHTS_TIER)
