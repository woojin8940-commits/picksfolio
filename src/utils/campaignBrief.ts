/**
 * 캠페인 브리프 — 등록 화면이 쓰는 기준값.
 *
 * 예전에는 패키지 세 개를 만들어 두고 브랜드가 하나를 고르게 했다. 고르면 1인 단가와
 * 진행 단계가 따라오고, 모집 인원은 예산 ÷ 단가로 계산했다. 문제는 그 계산이 실제
 * 섭외와 맞지 않는다는 점이었다. 5,000만원을 나노 단가로 나누면 500명이 나오는데
 * 그렇게 섭외하는 캠페인은 없다. 브랜드가 실제로 정하고 싶은 것은 "메가 1명 + 마이크로
 * 10명"처럼 규모별 구성이었다.
 *
 * 그래서 축을 두 개로 바꿨다.
 *
 *   ① 진행 방식(rewardMode) — 광고비를 지급하는지, 제품 협찬만으로 하는지
 *   ② 규모별 인원 배분(tierCounts) — 나노 / 마이크로 / 매크로 / 메가에 몇 명씩
 *
 * 예산은 브랜드가 직접 적고, 인원은 브랜드가 직접 배분한다. 대신 각 규모의 최소
 * 단가를 기준으로 배분액을 계산해 예산을 넘기지 못하게 막는다. 예산이 5,000만원이면
 * 메가 1명(최소 300만) + 매크로 5명(최소 500만)까지 담아도 잔액이 남는 것이 바로
 * 보인다. 인원을 계산해 주는 것보다, 예산 안에서 직접 굴려 보게 하는 쪽이 실제 섭외에
 * 가깝다.
 *
 * 진행 단계는 진행 방식이 정한다. 광고비를 지급하면 구성안·콘텐츠 검수를 거치고
 * 정산이 붙는다. 제품 협찬형은 가이드를 주고 업로드를 확인하는 데서 끝난다 — 지급할
 * 광고비가 없으니 정산 단계도 없다. 서버 쪽 짝은
 * netlify/functions/_shared/collab-workflow.mts 의 stage template 이고, 한쪽을 바꾸면
 * 다른 쪽도 같이 바꿔야 한다.
 */

import { formatKoreanWon } from './formatters';

// ---------------------------------------------------------------------------
// 진행 방식
// ---------------------------------------------------------------------------

export type RewardMode = 'paid' | 'barter';

export type RewardModeDef = {
  value: RewardMode;
  label: string;
  tagline: string;
  lines: [string, string];
  /** 협업 조건에 그대로 들어가는 2차 활용 범위. */
  secondUseNote: string;
};

export const REWARD_MODES: RewardModeDef[] = [
  {
    value: 'paid',
    label: '광고비 지급형',
    tagline: '제품 + 광고비',
    lines: ['광고비를 지급하고 콘텐츠를 의뢰합니다.', '구성안·콘텐츠를 확인하고 업로드합니다.'],
    secondUseNote: '2차 활용 범위는 담당자와 협의합니다',
  },
  {
    value: 'barter',
    label: '제품 협찬형',
    tagline: '제품만 제공',
    lines: ['광고비 없이 제품 협찬만으로 진행합니다.', '가이드를 전달하고 업로드를 확인합니다.'],
    secondUseNote: '2차 활용은 별도 동의가 필요합니다',
  },
];

export const rewardModeOf = (value: string | null | undefined): RewardModeDef =>
  REWARD_MODES.find(m => m.value === value) || REWARD_MODES[0];

// ---------------------------------------------------------------------------
// 인플루언서 규모
// ---------------------------------------------------------------------------

export type TierKey = 'nano' | 'micro' | 'macro' | 'mega';

export type TierDef = {
  key: TierKey;
  label: string;
  /** 카드에 적는 팔로워 구간. */
  followers: string;
  /** 1인 광고비 하단. 예산 배분은 이 값을 기준으로 계산한다. */
  minFee: number;
  /** 1인 광고비 상단. 실제 금액은 담당자가 후보를 확정할 때 이 사이에서 정해진다. */
  maxFee: number;
  /** 상단이 열려 있는 구간(메가)인지. 화면에 '+' 를 붙인다. */
  openEnded: boolean;
  /** 카드 하단 한 줄 — 이 규모를 쓰는 이유. */
  note: string;
};

/**
 * 네 구간. 금액은 1인 기준이고, 배분 계산은 항상 minFee 로 한다.
 *
 * 상단(maxFee)으로 계산하면 예산 5,000만원에 메가 1명을 담는 순간 잔액이 4,000만원이
 * 되어 대부분의 구성이 불가능해 보인다. 실제로는 그 구간 안에서 협의하므로, 브랜드가
 * 구성을 짜 볼 때는 하단이 기준이어야 한다. 상단은 "여기까지 늘어날 수 있다"는
 * 정보로만 보여 준다.
 */
export const TIERS: TierDef[] = [
  {
    key: 'nano',
    label: '나노',
    followers: '팔로워 1만 이하',
    minFee: 100_000,
    maxFee: 300_000,
    openEnded: false,
    note: '여러 명이 같은 시기에 올려 초기 반응을 만듭니다',
  },
  {
    key: 'micro',
    label: '마이크로',
    followers: '팔로워 1만 ~ 10만',
    minFee: 500_000,
    maxFee: 1_000_000,
    openEnded: false,
    note: '팬층이 뚜렷해 반응률이 가장 안정적입니다',
  },
  {
    key: 'macro',
    label: '매크로',
    followers: '팔로워 10만 ~ 50만',
    minFee: 1_000_000,
    maxFee: 5_000_000,
    openEnded: false,
    note: '한 편으로 도달을 크게 끌어올립니다',
  },
  {
    key: 'mega',
    label: '메가',
    followers: '팔로워 50만 이상',
    minFee: 3_000_000,
    maxFee: 10_000_000,
    openEnded: true,
    note: '캠페인의 얼굴이 되는 대표 콘텐츠를 만듭니다',
  },
];

export const tierOf = (key: string | null | undefined): TierDef | undefined =>
  TIERS.find(t => t.key === key);

/** '10만 ~ 30만원' / '300만 ~ 1,000만원+' */
export const tierFeeLabel = (t: TierDef): string =>
  `${formatKoreanWon(t.minFee).replace(/원$/, '')} ~ ${formatKoreanWon(t.maxFee)}${t.openEnded ? '+' : ''}`;

// ---------------------------------------------------------------------------
// 규모별 인원 배분
// ---------------------------------------------------------------------------

/**
 * 규모별 인원. 키가 있으면 "고른 구간"이고, 값이 인원이다.
 *
 * 고르기만 하고 인원을 0 으로 둔 상태와 아예 고르지 않은 상태를 구분해야 한다 —
 * 화면에서 인원 조절 줄을 보여줄지 말지가 그 차이로 정해진다. 그래서 값이 0 이어도
 * 키는 남겨 둔다.
 */
export type TierCounts = Partial<Record<TierKey, number>>;

/** 'nano:10,micro:3' ↔ { nano: 10, micro: 3 }. 저장은 한 칸에 한다. */
export const parseTierCounts = (raw: unknown): TierCounts => {
  const out: TierCounts = {};
  String(raw ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(part => {
      const [key, value] = part.split(':').map(s => s.trim());
      if (!TIERS.some(t => t.key === key)) return;
      const n = Number(value);
      out[key as TierKey] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    });
  return out;
};

export const serializeTierCounts = (counts: TierCounts): string =>
  TIERS.filter(t => counts[t.key] !== undefined)
    .map(t => `${t.key}:${counts[t.key] ?? 0}`)
    .join(',');

/** 고른 구간만, TIERS 순서대로. */
export const chosenTiers = (counts: TierCounts): TierDef[] =>
  TIERS.filter(t => counts[t.key] !== undefined);

export const totalHeadcount = (counts: TierCounts): number =>
  TIERS.reduce((sum, t) => sum + (counts[t.key] || 0), 0);

/** 최소 단가 기준 배분액. 예산과 비교하는 값은 항상 이것이다. */
export const allocatedFloor = (counts: TierCounts): number =>
  TIERS.reduce((sum, t) => sum + (counts[t.key] || 0) * t.minFee, 0);

/** 상단 단가로 다 채웠을 때의 금액. "여기까지 늘어날 수 있다"는 표시용. */
export const allocatedCeiling = (counts: TierCounts): number =>
  TIERS.reduce((sum, t) => sum + (counts[t.key] || 0) * t.maxFee, 0);

export const remainingBudget = (budgetKrw: number, counts: TierCounts): number =>
  Math.max(0, budgetKrw) - allocatedFloor(counts);

/**
 * 이 구간에 한 명 더 넣을 수 있는지.
 *
 * 광고비 지급형은 예산이 기준이고, 제품 협찬형은 협찬 가능 수량이 기준이다. 넣을 수
 * 없을 때 버튼을 눌리게 두면 브랜드는 예산을 넘긴 구성을 다 짜 놓고 마지막에
 * 거절당한다.
 */
export const canAddOne = (
  tier: TierDef,
  mode: RewardMode,
  budgetKrw: number,
  supplyCount: number,
  counts: TierCounts,
): boolean => {
  if (mode === 'barter') {
    return supplyCount <= 0 || totalHeadcount(counts) < supplyCount;
  }
  if (budgetKrw <= 0) return false;
  return allocatedFloor(counts) + tier.minFee <= budgetKrw;
};

/** 남은 예산으로 이 구간을 몇 명 더 넣을 수 있는지. 카드에 안내로 적는다. */
export const affordableCount = (tier: TierDef, budgetKrw: number, counts: TierCounts): number => {
  const left = remainingBudget(budgetKrw, counts);
  return left <= 0 ? 0 : Math.floor(left / tier.minFee);
};

// ---------------------------------------------------------------------------
// 진행 단계 표시
// ---------------------------------------------------------------------------

export type StageMark = { label: string; included: boolean };

/**
 * 등록 화면·상세 화면이 보여 주는 진행 단계.
 *
 * 협업에 실제로 생기는 단계와 짝을 맞춰야 한다. "콘텐츠 검수 포함"이라고 보여 주고
 * 협업에 그 단계가 없으면 그 표시는 거짓말이 된다.
 */
export const stageMarksFor = (mode: RewardMode): StageMark[] => [
  { label: '조건 확정', included: true },
  { label: '가이드 전달', included: true },
  { label: '구성안 검수', included: mode === 'paid' },
  { label: '콘텐츠 검수', included: mode === 'paid' },
  { label: '업로드 확인', included: true },
  { label: '광고비 정산', included: mode === 'paid' },
];

// ---------------------------------------------------------------------------
// 선택지
// ---------------------------------------------------------------------------

export const PRODUCT_PROVIDE = [
  { value: 'provide', label: '제품 발송', hint: '주소를 받아 제품을 보내 드립니다' },
  { value: 'rent', label: '대여 후 회수', hint: '촬영이 끝나면 반납받습니다' },
  { value: 'app', label: '앱 · 서비스 계정', hint: '배송 없이 이용권을 발급합니다' },
  { value: 'visit', label: '현장 방문', hint: '매장·장소에서 직접 촬영합니다' },
] as const;

export const AD_OBJECTIVES = [
  {
    value: 'awareness',
    label: '인지도',
    icon: '📢',
    lines: ['처음 알리는 제품이에요.', '조회수와 도달을 먼저 봅니다'],
    tip: '같은 시기에 여러 편이 올라가도록 구성을 짜 드려요',
  },
  {
    value: 'engagement',
    label: '반응',
    icon: '💬',
    lines: ['댓글과 저장이 남으면 좋겠어요.', '반응률과 카테고리를 먼저 봅니다'],
    tip: '팬층과 제품 카테고리가 겹치는 후보를 찾아 드려요',
  },
  {
    value: 'conversion',
    label: '구매',
    icon: '🛒',
    lines: ['링크 클릭과 구매로 이어져야 해요.', '판매 이력과 2차 활용을 먼저 봅니다'],
    tip: '판매로 이어진 이력이 있는 후보를 찾아 드려요',
  },
] as const;

export const CHANNELS = ['인스타그램', '유튜브', '틱톡'] as const;

export const GENDERS = [
  { value: 'female', label: '여성' },
  { value: 'male', label: '남성' },
  { value: 'any', label: '성별 무관' },
] as const;

export const AGE_BANDS = ['20대', '30대', '40대', '50대 이상'] as const;

export const INFLUENCER_STYLES = [
  '고급스러운', '청량한', '사랑스러운', '에너지 넘치는', '스타일링이 좋은',
  '설명이 명확한', '차분한', '감성적인', '분위기 있는', '트렌드에 밝은',
  '자연스러운', '유쾌한', '솔직한', '건강한', '군더더기 없는',
  '편안한', '위로가 되는',
] as const;

export const EXCLUDE_KEYWORDS = [
  '노출 수위가 높음', '보정이 과함', '댓글 응대 없음', '광고 비중이 높음',
  '구성 완성도가 낮음', '음성 설명 없음', '자막 미사용',
] as const;

// ---------------------------------------------------------------------------
// 파생값 — 브랜드에게 묻지 않고 만드는 것들
// ---------------------------------------------------------------------------

/** 캠페인 제목. 브랜드가 제목을 고민하지 않도록 제품명에서 만든다. */
export const derivedTitle = (productName: string, brandName: string): string => {
  const product = productName.trim();
  const brand = brandName.trim();
  if (product && brand) return `[${brand}] ${product} 캠페인`;
  if (product) return `${product} 캠페인`;
  return brand ? `${brand} 캠페인` : '';
};

/**
 * 인플루언서 화면에 보여 줄 1인 광고비.
 *
 * 규모를 섞으면 단가가 하나로 정해지지 않는다. 가장 낮은 구간의 하단을 쓴다 —
 * 실제 금액은 담당자가 후보별로 확정하므로, 여기서 높은 쪽을 적어 두면 지키지 못하는
 * 숫자가 된다. 구간별 금액은 지원 조건 문장에 그대로 남겨 둔다.
 */
export const derivedUnitFee = (mode: RewardMode, counts: TierCounts): number => {
  if (mode === 'barter') return 0;
  const fees = chosenTiers(counts)
    .filter(t => (counts[t.key] || 0) > 0)
    .map(t => t.minFee);
  return fees.length ? Math.min(...fees) : 0;
};

/**
 * 지원 조건 문장. 희망 인플루언서에서 고른 값을 그대로 문장으로 만든다.
 *
 * 인플루언서 지원 화면과 담당자 리스트업 화면은 requirements 를 읽어 왔다. 조건을
 * 칩으로 받게 바꿨으니 그 값을 사람이 읽는 문장으로도 남겨 둔다 — 그러지 않으면
 * 기존 화면에서 지원 조건이 갑자기 비어 보인다.
 */
export const derivedRequirements = (input: {
  mode: RewardMode;
  gender: string;
  ages: string[];
  snsCategory: string;
  tierCounts: TierCounts;
  minViews: number;
  styles: string[];
  excludes: string[];
}): string => {
  const lines: string[] = [];
  lines.push(`진행 방식: ${rewardModeOf(input.mode).label}`);
  const genderLabel = GENDERS.find(g => g.value === input.gender)?.label;
  const who = [genderLabel && genderLabel !== '성별 무관' ? genderLabel : '', input.ages.join('·')]
    .filter(Boolean)
    .join(' ');
  if (who) lines.push(`희망 인플루언서: ${who}`);
  if (input.snsCategory) lines.push(`채널 카테고리: ${input.snsCategory}`);

  const picked = chosenTiers(input.tierCounts).filter(t => (input.tierCounts[t.key] || 0) > 0);
  if (picked.length) {
    lines.push(
      `모집 구성: ${picked
        .map(t =>
          input.mode === 'barter'
            ? `${t.label} ${input.tierCounts[t.key]}명`
            : `${t.label} ${input.tierCounts[t.key]}명(1인 ${tierFeeLabel(t)})`,
        )
        .join(' · ')}`,
    );
  }
  if (input.minViews > 0) lines.push(`희망 최소 조회수: ${input.minViews.toLocaleString('ko-KR')}회 이상`);
  if (input.styles.length) lines.push(`선호 스타일: ${input.styles.join(', ')}`);
  if (input.excludes.length) lines.push(`제외 조건: ${input.excludes.join(', ')}`);
  return lines.join('\n');
};
