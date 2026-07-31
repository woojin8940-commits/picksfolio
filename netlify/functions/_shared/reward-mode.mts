/**
 * 진행 방식(리워드 모드)의 서버 쪽 정의.
 *
 * 클라이언트 쪽 짝은 src/utils/campaignBrief.ts 다. 두 곳이 같은 값을 알아야 하는데,
 * 목록 노출 규칙("이 방식은 지원을 받는다")을 함수마다 복사해 두면 한쪽만 고쳐졌을 때
 * 브랜드 화면에는 수락 버튼이 보이는데 서버는 403 을 주는 상태가 된다. 그래서 판단을
 * 이 파일 한 곳으로 모은다.
 */

export const REWARD_MODES = ["paid", "barter", "groupbuy"] as const;
export type RewardModeValue = (typeof REWARD_MODES)[number];

/** 모르는 값·빈 값은 예전 캠페인과 같게 'paid' 로 본다. */
export const normalizeRewardMode = (raw: unknown): RewardModeValue => {
  const value = String(raw ?? "");
  return (REWARD_MODES as readonly string[]).includes(value)
    ? (value as RewardModeValue)
    : "paid";
};

/**
 * 지원을 받아 브랜드가 그중에서 고르는 방식.
 *
 * 광고비 지급형은 담당자가 조건에 맞는 후보를 찾아 리스트업하는 길이다. 지원이 섭외로
 * 이어지지 않으니 캠페인 협업 목록에 걸지 않고, 브랜드도 지원자를 직접 수락하지 않는다.
 * 제품 협찬형·공동구매는 반대로 지원자 명단이 곧 후보 명단이다 — 그래서 목록 노출과
 * 브랜드 수락이 같은 조건에 걸린다.
 */
export const OPEN_APPLY_MODES: RewardModeValue[] = ["barter", "groupbuy"];

export const isOpenApplyMode = (raw: unknown): boolean =>
  OPEN_APPLY_MODES.includes(normalizeRewardMode(raw));
