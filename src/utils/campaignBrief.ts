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
 * 광고비가 없으니 정산 단계도 없다. 공동구매는 판매 콘텐츠라 검수를 거치고 수수료
 * 정산이 붙는다. 서버 쪽 짝은
 * netlify/functions/_shared/collab-workflow.mts 의 stage template 이고, 한쪽을 바꾸면
 * 다른 쪽도 같이 바꿔야 한다.
 *
 * 진행 방식은 "누가 인플루언서를 정하는가"도 함께 정한다. 광고비 지급형은 담당자가
 * 조건에 맞는 후보를 찾아 리스트업하고, 제품 협찬형·공동구매는 캠페인 협업 목록에
 * 걸어 두고 지원을 받는다. 그래서 규모별 인원 배분(희망 인플루언서)은 광고비 지급형에만
 * 있다 — 누가 지원할지 모르는 상태에서 "메가 1명"을 못 박아 두면 지킬 수 없다.
 */

import { formatKoreanWon } from './formatters';

// ---------------------------------------------------------------------------
// 진행 방식
// ---------------------------------------------------------------------------

export type RewardMode = 'paid' | 'barter' | 'groupbuy';

export type RewardModeDef = {
  value: RewardMode;
  label: string;
  tagline: string;
  lines: [string, string];
  /** 협업 조건에 그대로 들어가는 2차 활용 범위. */
  secondUseNote: string;
  /**
   * 캠페인 협업 목록에 걸어 두고 인플루언서가 직접 지원하는 방식인지.
   *
   * 광고비 지급형은 담당자가 조건에 맞는 후보를 찾아 리스트업하는 길이라, 목록에
   * 걸어 두면 지원해도 그 지원이 섭외로 이어지지 않는다. 그래서 노출하지 않는다.
   * 제품 협찬형과 공동구매는 반대다 — 지원한 사람 중에서 브랜드가 고르는 방식이므로
   * 목록에 보여야 지원이 들어온다.
   *
   * 브랜드 상세 화면의 지원자 목록 자리도 이 값이 정한다. 지원을 받지 않는 방식에서
   * 빈 지원자 목록을 띄워 두면 브랜드는 오지 않을 지원을 기다리고, 담당자가 올린
   * 명단이 화면의 곁가지처럼 보인다 — 광고비 지급형에서 사람을 고르는 자리는
   * 리스트업 하나뿐이어야 한다.
   */
  openApply: boolean;
  /**
   * 담당자가 인플루언서 후보 명단(리스트업)을 만들어 주는 방식인지.
   *
   * openApply 와 반대말이 아니다. 공동구매는 목록에 걸어 두고 지원을 받으면서
   * 동시에 담당자가 판매력 있는 후보를 찾아 올린다 — 둘 다 켜져 있다. 제품 협찬형은
   * 지원자만 받는다: 광고비가 없는 협업에 담당자가 후보를 찾아 제안하면 성사율이
   * 낮고, 그 시간은 광고비가 걸린 캠페인에 써야 한다.
   *
   * 이 값이 꺼진 진행 방식에서는 브랜드 화면에 리스트업 자리가 아예 없어야 한다.
   * 비어 있는 리스트업 칸은 "담당자가 아직 안 올렸다"로 읽히고, 브랜드는 오지 않을
   * 명단을 기다리게 된다.
   */
  managerListup: boolean;
  /**
   * 희망 인플루언서(규모별 인원 배분)를 브랜드가 직접 정하는지.
   *
   * 지원을 받아 고르는 방식에서는 나노·매크로처럼 규모를 미리 못 박을 수 없다.
   * 누가 지원할지 모르는 상태에서 정한 구성은 지킬 수 없는 약속이 된다.
   */
  pickInfluencer: boolean;
  /**
   * 정산이 붙는 방식인지.
   *
   * 제품 협찬형은 지급할 돈이 없다 — 광고비도, 판매 수수료도 없다. 그런 캠페인에
   * 정산 탭을 열어 두면 브랜드는 "언젠가 채워지는 칸"으로 읽고 지급 일정을 기다리게
   * 된다. 진행 단계에도 정산 자리가 생기지 않는다 — 정산은 업로드를 확인하는 시점에
   * 예약되는데, 지급액이 0원이면 그 예약을 만들지 않는다(api-collab-workflow.mts).
   */
  hasSettlement: boolean;
  /** 지원/모집 인원 칸에 붙는 이름. 진행 방식마다 세는 대상이 다르다. */
  headcountLabel: string;
  /** 캠페인 유형(type) 컬럼에 저장할 값. 협업 단계 묶음이 이 값으로 갈린다. */
  campaignType: string;
};

export const REWARD_MODES: RewardModeDef[] = [
  {
    value: 'paid',
    label: '광고비 지급형',
    tagline: '제품 + 광고비',
    lines: ['광고비를 지급하고 콘텐츠를 의뢰합니다.', '담당자가 조건에 맞는 후보를 찾아 드립니다.'],
    secondUseNote: '2차 활용 범위는 담당자와 협의합니다',
    openApply: false,
    managerListup: true,
    pickInfluencer: true,
    hasSettlement: true,
    headcountLabel: '모집 인원',
    campaignType: 'ad_collab',
  },
  {
    value: 'barter',
    label: '제품 협찬형',
    tagline: '제품만 제공',
    lines: ['광고비 없이 제품 협찬만으로 진행합니다.', '지원한 인플루언서 중에서 골라 진행합니다.'],
    secondUseNote: '2차 활용은 별도 동의가 필요합니다',
    openApply: true,
    managerListup: false,
    pickInfluencer: false,
    hasSettlement: false,
    headcountLabel: '협찬 인원',
    campaignType: 'ad_collab',
  },
  {
    value: 'groupbuy',
    label: '공동구매형',
    tagline: '판매 수수료',
    lines: ['제품을 함께 팔고 판매 수수료를 지급합니다.', '지원한 인플루언서 중에서 골라 진행합니다.'],
    secondUseNote: '판매 기간과 수수료 지급은 담당자가 정리합니다',
    openApply: true,
    managerListup: true,
    pickInfluencer: false,
    hasSettlement: true,
    headcountLabel: '모집 인원',
    campaignType: 'group_buy',
  },
];

export const rewardModeOf = (value: string | null | undefined): RewardModeDef =>
  REWARD_MODES.find(m => m.value === value) || REWARD_MODES[0];

/** 저장·전송할 진행 방식 값. 모르는 값은 예전 캠페인과 같게 'paid' 로 본다. */
export const normalizeRewardMode = (value: unknown): RewardMode =>
  rewardModeOf(typeof value === 'string' ? value : '').value;

/** 캠페인 협업 목록에 노출되는 진행 방식들. 서버 필터와 짝이다. */
export const OPEN_APPLY_MODES: RewardMode[] = REWARD_MODES.filter(m => m.openApply).map(m => m.value);

/**
 * 담당자 리스트업이 붙는 진행 방식들. 서버(_shared/reward-mode.mts) 의 같은 이름과 짝이다.
 *
 * 화면에서만 감추면 리스트업 자리는 사라지지만 후보는 그대로 올라갈 수 있다.
 * 그래서 서버도 같은 목록으로 명단 등록을 막는다.
 */
export const MANAGER_LISTUP_MODES: RewardMode[] = REWARD_MODES.filter(m => m.managerListup).map(m => m.value);

/** 이 캠페인에 담당자 리스트업이 붙는지. reward_mode 값을 그대로 넘겨도 된다. */
export const isManagerListupMode = (value: unknown): boolean =>
  rewardModeOf(typeof value === 'string' ? value : '').managerListup;

/** 공동구매 판매 수수료(%) 의 허용 범위. */
export const COMMISSION_RANGE = { min: 1, max: 90 } as const;

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
 * 규모별 배분은 광고비 지급형에만 있다(다른 방식은 지원을 받아 고른다). 그래서 기준은
 * 예산이다. 넣을 수 없을 때 버튼을 눌리게 두면 브랜드는 예산을 넘긴 구성을 다 짜 놓고
 * 마지막에 거절당한다.
 */
export const canAddOne = (
  tier: TierDef,
  mode: RewardMode,
  budgetKrw: number,
  supplyCount: number,
  counts: TierCounts,
): boolean => {
  if (mode !== 'paid') {
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
 * 협업에 그 단계가 없으면 그 표시는 거짓말이 된다. 공동구매는 단계 이름 자체가 다르므로
 * (가이드 전달 → 상품 정보 전달, 업로드 → 판매 시작) 목록을 따로 둔다.
 *
 * 공동구매가 아닌 캠페인은 전부 다섯 단계로 진행한다
 * (collab-workflow.mts 의 CAMPAIGN_PROCESS). 정산은 단계로 두지 않는다 — 업로드를
 * 확인하는 시점에 자동으로 예약되고, 광고비가 없는 협찬형이면 예약 자체가 없다.
 */
export const stageMarksFor = (mode: RewardMode): StageMark[] => {
  if (mode === 'groupbuy') {
    return [
      { label: '조건 확정', included: true },
      { label: '상품 정보 전달', included: true },
      { label: '콘텐츠 검수', included: true },
      { label: '판매 시작', included: true },
      { label: '게시 확인', included: true },
      { label: '수수료 정산', included: true },
    ];
  }
  return [
    { label: '콘텐츠 가이드', included: true },
    { label: '제품 배송', included: true },
    { label: '기획안 피드백', included: true },
    { label: '영상 피드백', included: true },
    { label: '업로드', included: true },
  ];
};

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

/**
 * 업로드 채널.
 *
 * 우선 인스타그램만 받는다. 유튜브·틱톡은 산출물 규격과 검수 기준이 달라, 채널만
 * 열어 두면 브랜드가 고른 채널로 진행할 준비가 되지 않은 상태에서 캠페인이 올라간다.
 * 채널이 늘어나면 이 목록에 더하면 된다 — 등록 화면은 목록을 그대로 그린다.
 */
export const CHANNELS = ['인스타그램'] as const;

/**
 * 콘텐츠 형식 — 숏폼(릴스)인가 피드 게시물인가.
 *
 * 예전에는 이 값을 묻지 않고 등록 화면이 늘 'shortform' 을 보냈다. 그래서 피드
 * 게시물로 진행할 캠페인도 서버에는 숏폼으로 남았고, 그 값이 두 곳에서 실제 금액을
 * 정한다 — 인플루언서는 피드 단가와 릴스 단가를 따로 등록하는데, 담당자가 명단을 올릴
 * 때 채워지는 지급 단가가 캠페인 형식을 보고 골라진다(registeredPayoutFee). 형식이
 * 전부 숏폼이면 피드 캠페인에도 릴스 단가가 들어가고, 그 숫자로 제안이 나간다.
 *
 * 값은 서버가 단가를 고를 때 읽는 문자열이므로 바꾸지 않는다. 화면에 보일 이름은
 * contentFormatLabel() 로 따로 만든다.
 */
export const CONTENT_FORMATS = [
  {
    value: 'shortform',
    label: '숏폼 (릴스)',
    hint: '세로 영상 한 편. 인플루언서의 릴스 단가로 계산합니다',
  },
  {
    value: 'feed',
    label: '피드 게시물',
    hint: '피드에 남는 사진·이미지 게시물. 인플루언서의 피드 단가로 계산합니다',
  },
] as const;

/**
 * 저장된 형식 값을 사람이 읽는 이름으로.
 *
 * 목록에 없는 값도 그대로 돌려준다 — 담당자가 제안서에 형식을 직접 적는 자리가 있고
 * (콘텐츠 형식 입력칸), 예전 캠페인에는 임의의 문자열이 들어 있다. 빈 값은 빈 문자열로
 * 남겨 부르는 쪽이 줄 자체를 그리지 않게 한다.
 */
export const contentFormatLabel = (value?: string | null): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const hit = CONTENT_FORMATS.find(f => f.value === raw.toLowerCase());
  return hit ? hit.label : raw;
};

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
  if (mode !== 'paid') return 0;
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
 *
 * 지원을 받아 고르는 방식(제품 협찬형·공동구매)은 규모나 성별로 지원을 막지 않는다.
 * 그 방식에서 조건 문장에 "여성 20대 나노"를 적어 두면, 목록을 보는 인플루언서는
 * 자기가 지원 대상이 아니라고 읽는다. 그래서 인원과 진행 조건만 남긴다.
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
  /** 지원을 받아 고르는 방식의 모집·협찬 인원. */
  headcount?: number;
  /** 업로드 채널. 지원 전에 알아야 하는 조건이다. */
  channel?: string;
}): string => {
  const def = rewardModeOf(input.mode);
  const lines: string[] = [];
  lines.push(`진행 방식: ${def.label}`);
  if (input.channel) lines.push(`업로드 채널: ${input.channel}`);

  if (!def.pickInfluencer) {
    if (input.headcount && input.headcount > 0) {
      lines.push(`${def.headcountLabel}: ${input.headcount}명`);
    }
    // 공동구매 수수료율은 요구사항 문구에 넣지 않는다. 이 문구는 캠페인 상세에
    // 그대로 박히는데, 실제 수수료는 담당자가 인플루언서와 조율해 정한다. 등록 시
    // 적힌 숫자가 먼저 박히면 조율 결과가 그와 달라졌을 때 말이 바뀐 것이 된다.
    if (input.mode === 'groupbuy') {
      lines.push('판매 수수료: 담당자와 협의');
    }
    lines.push('지원해 주신 인플루언서 중에서 브랜드가 함께할 분을 고릅니다.');
    return lines.join('\n');
  }

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
        .map(t => `${t.label} ${input.tierCounts[t.key]}명(1인 ${tierFeeLabel(t)})`)
        .join(' · ')}`,
    );
  }
  if (input.minViews > 0) lines.push(`희망 최소 조회수: ${input.minViews.toLocaleString('ko-KR')}회 이상`);
  if (input.styles.length) lines.push(`선호 스타일: ${input.styles.join(', ')}`);
  if (input.excludes.length) lines.push(`제외 조건: ${input.excludes.join(', ')}`);
  return lines.join('\n');
};
