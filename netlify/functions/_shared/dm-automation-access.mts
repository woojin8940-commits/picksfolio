/**
 * 디엠(DM) 자동화 이용 권한.
 *
 * 디엠 자동화는 **프로 플랜(월 18,700원)** 전용 기능이다. 프로 플랜은 모든 멤버십 플랜의
 * 기능에 디엠 자동화까지 포함하는 최상위 티어이므로, 하위 티어(스탠다드 / AI 협업 / 커머스)
 * 구독자와 미구독자는 자동화를 만들거나 발송할 수 없다.
 *
 * 기업(비즈니스) 계정도 같은 게이트를 지난다 — 브랜드가 자동 디엠을 쓰려면 브랜드
 * 워크스페이스에서 프로 플랜을 구독해야 한다. 예외로 두던 분기는 접두사(`biz/`)에
 * 기대고 있었고 그 접두사가 서버까지 오지 않아 실제로는 한 번도 적용되지 않았다
 * (membership-access 주석 참고).
 *
 * 게이트가 막는 것은 **자동화 저장과 DM 발송뿐**이다. 인스타그램 계정 연동과 브랜드의
 * 콘텐츠 성과(태그된 콘텐츠 · api-business-tagged-media)는 이 판정을 보지 않는다 —
 * 캠페인 성과 확인은 유가시딩 운영에 필요한 일이라 디엠 구독 여부로 잠그지 않는다.
 *
 * 설정 저장(api-dm-automation), 실제 발송(instagram-webhook) 양쪽에서 같은 판정을 쓴다.
 *
 * 멤버십을 읽어 티어를 견주는 일 자체는 membership-access 가 한다. 인사이트도 같은
 * 프로 플랜 게이트를 쓰는데, 그 조회를 각자 적어 두면 겹쳐 읽는 순서가 어긋나면서
 * 같은 사람이 화면마다 다른 답을 받을 수 있다.
 */

import { hasMembershipTier } from './membership-access.mts'
import type { MembershipTier } from './membership-billing.mts'

/** 디엠 자동화에 필요한 최소 티어. */
export const DM_AUTOMATION_TIER: MembershipTier = 'pro'

export const DM_AUTOMATION_REQUIRED_MESSAGE =
  '디엠 자동화는 프로 플랜(월 18,700원) 전용 기능이에요. 프로 플랜을 구독하면 바로 사용할 수 있습니다.'

/** 이 사용자가 디엠 자동화를 이용할 수 있는지. */
export const dmAutomationAllowed = (
  username: string | null | undefined,
  authUserId?: string | null,
): Promise<boolean> => hasMembershipTier(username, authUserId, DM_AUTOMATION_TIER)
