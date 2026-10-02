/**
 * 인사이트 이용 권한.
 *
 * 인사이트(본인 계정 성과 · 팔로워 분석 · 벤치마킹)는 예전에 프로 플랜 전용이었지만,
 * 멤버십으로 잠겨 있던 기능을 모두 무료로 열면서 지금은 누구나 쓴다. 남는 조건은
 * 인스타그램 연동뿐이고, 그건 조회 경로(api-creator-insights)가 따로 본다.
 *
 * 판정 함수는 그대로 둔다 — 조회 경로의 네 갈래가 같은 자리에서 이 함수를 부르므로,
 * 나중에 조건이 다시 생기면 여기 한 곳만 고치면 된다.
 */

/** 예전 화면 호환용 — 이제 어떤 티어도 요구하지 않는다. */
export const CREATOR_INSIGHTS_TIER = null

export const CREATOR_INSIGHTS_REQUIRED_MESSAGE = '인사이트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'

/** 이 사용자가 인사이트를 볼 수 있는지. 로그인한 본인이면 누구나 볼 수 있다. */
export const creatorInsightsAllowed = async (
  username: string | null | undefined,
  _authUserId?: string | null,
): Promise<boolean> => !!username
