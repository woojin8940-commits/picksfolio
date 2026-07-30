/**
 * 캠페인 패키지 — 등록 화면이 브랜드에게 물어보는 것을 줄이기 위한 기준값.
 *
 * 캠페인을 처음 올리는 브랜드가 스스로 정할 수 있는 것은 많지 않다. 제품이 무엇이고
 * 얼마를 쓸 수 있는지 정도다. 1인 단가, 검수를 몇 번 할지, 2차 활용을 어떻게 할지는
 * 물어봐도 "잘 모르겠다"는 답이 돌아온다. 그래서 그 값들을 패키지 세 개로 굳혀 두고
 * 브랜드는 하나를 고르게 한다.
 *
 * 고르면 따라오는 것:
 *   - 1인 단가(unitPrice) 와 최소 예산(minBudget)
 *   - 진행 단계(stages) — 어떤 검수를 거치는지
 *   - 2차 활용 조건(secondUseNote)
 *
 * 진행 단계는 실제 협업 단계와 짝을 맞춰야 한다. 화면에서 "대본 피드백 포함"이라고
 * 보여주고 협업에는 대본 단계가 없으면 그 표시는 거짓말이 된다. 서버 쪽 짝은
 * netlify/functions/_shared/collab-workflow.mts 의 stage template 세 묶음이다.
 * 한쪽을 바꾸면 다른 쪽도 같이 바꿔야 한다.
 */

export type PackageTier = 'full' | 'lite' | 'seeding';

/** 등록 화면의 진행 단계 표시. 협업 단계 키와 1:1로 짝을 맞춰 둔다. */
export type StageMark = { label: string; included: boolean };

export type PackageDef = {
  tier: PackageTier;
  /** 카드 좌상단 배지 — 이 패키지가 주로 쓰이는 인플루언서 규모. */
  badge: string;
  name: string;
  lines: [string, string];
  /** 인플루언서 1명 단가(원). */
  unitPrice: number;
  /** 단가가 고정인지, 규모에 따라 올라가는지. */
  priceNote: '부터~' | '고정';
  /** 최소 집행 금액(원). 이 밑으로는 담당자를 붙여 진행할 수 없다. */
  minBudget: number;
  /** 카드 하단 한 줄 — 2차 활용 가능 여부. */
  usageNote: string;
  /** 협업 조건에 그대로 들어가는 2차 활용 범위. */
  secondUseNote: string;
  /** 진행 단계 표시. */
  stages: StageMark[];
};

/**
 * 세 패키지.
 *
 * 단가 차이는 "검수를 몇 번 거치는지"에서 나온다. 풀패키지는 대본부터 최종본까지
 * 세 번 확인하므로 담당자 손이 가장 많이 가고, 시딩은 가이드만 주고 올린다.
 */
export const PACKAGES: PackageDef[] = [
  {
    tier: 'full',
    badge: '전체등급',
    name: '올인원 풀패키지',
    lines: ['대본부터 결과 확인까지', '체계적인 관리가 필요할 때'],
    unitPrice: 500_000,
    priceNote: '부터~',
    minBudget: 3_000_000,
    usageNote: '가이드 포함 / 2차 활용 별도',
    secondUseNote: '2차 활용 별도 협의',
    stages: [
      { label: '가이드라인', included: true },
      { label: '대본 피드백', included: true },
      { label: '영상 피드백', included: true },
      { label: '최종본 피드백', included: true },
      { label: 'SNS 업로드', included: true },
    ],
  },
  {
    tier: 'lite',
    badge: '마이크로',
    name: '알뜰 패키지',
    lines: ['대본 없이 빠르게!', '2차 활용에 최적화된 광고형 상품'],
    unitPrice: 300_000,
    priceNote: '고정',
    minBudget: 1_000_000,
    usageNote: '가이드 포함 / 2차 활용 포함 (6개월)',
    secondUseNote: '자사 채널·유료 광고 6개월 포함',
    stages: [
      { label: '가이드라인', included: true },
      { label: '대본 피드백', included: false },
      { label: '영상 피드백', included: true },
      { label: '최종본 피드백', included: true },
      { label: 'SNS 업로드', included: true },
    ],
  },
  {
    tier: 'seeding',
    badge: '나노',
    name: '유가 시딩',
    lines: ['회수율 80% 보장 상품', '시딩으로 대세감을 형성하세요'],
    unitPrice: 100_000,
    priceNote: '고정',
    minBudget: 1_000_000,
    usageNote: '가이드 제공 / 2차 활용 불가',
    secondUseNote: '2차 활용 불가',
    stages: [
      { label: '가이드라인', included: true },
      { label: '대본 피드백', included: false },
      { label: '영상 피드백', included: false },
      { label: '최종본 피드백', included: false },
      { label: 'SNS 업로드', included: true },
    ],
  },
];

export const packageOf = (tier: string | null | undefined): PackageDef =>
  PACKAGES.find(p => p.tier === tier) || PACKAGES[0];

// ---------------------------------------------------------------------------
// 선택지
// ---------------------------------------------------------------------------

export const PRODUCT_PROVIDE = [
  { value: 'provide', label: '제품 제공', hint: '인플루언서에게 제품을 보내 드립니다' },
  { value: 'rent', label: '제품 대여', hint: '촬영 후 반납받습니다' },
  { value: 'app', label: '앱 · 서비스', hint: '배송 없이 계정·이용권을 제공합니다' },
  { value: 'visit', label: '방문형', hint: '매장·장소에 방문해 촬영합니다' },
] as const;

export const AD_OBJECTIVES = [
  {
    value: 'awareness',
    label: '인지도',
    icon: '📢',
    lines: ['브랜드·제품을 알리고 싶어요.', '조회수·도달에 최적화'],
    tip: '타겟 도달률이 높은 인플루언서를 추천해 드려요',
  },
  {
    value: 'engagement',
    label: '참여',
    icon: '💬',
    lines: ['댓글·저장·공유 등 반응이 중요해요.', 'ER·카테고리에 최적화'],
    tip: '반응률이 꾸준한 인플루언서를 추천해 드려요',
  },
  {
    value: 'conversion',
    label: '전환',
    icon: '🛒',
    lines: ['구매·링크 클릭을 이끌고 싶어요.', '2차 활용에 최적화'],
    tip: '판매 전환 이력이 있는 인플루언서를 추천해 드려요',
  },
] as const;

export const CHANNELS = ['인스타그램', '유튜브', '틱톡'] as const;

export const GENDERS = [
  { value: 'female', label: '여성' },
  { value: 'male', label: '남성' },
  { value: 'any', label: '성별 무관' },
] as const;

export const AGE_BANDS = ['20대', '30대', '40대', '50대 이상'] as const;

export const FOLLOWER_TIERS = [
  { value: 'nano', badge: '가성비', label: '나노', range: '1만 이하', unit: '인당 10 - 50만원' },
  { value: 'micro', badge: '최적', label: '마이크로', range: '1만 - 10만', unit: '인당 50 - 100만원' },
  { value: 'macro', badge: '최적', label: '매크로', range: '10만 - 50만', unit: '인당 100 - 300만원' },
  { value: 'mega', badge: '가성비', label: '메가', range: '50만 - 100만+', unit: '인당 300 - 3,000만원' },
] as const;

export const INFLUENCER_STYLES = [
  '우아하고 고급진', '맑고 청순한', '귀여운', '발랄한', '잘 꾸미는', '똑부러지는',
  '차분한', '감성적인', '무드있는', '트렌디한', '꾸안꾸', '유머러스한',
  '진정성있는', '건강한', '미니멀한', '친근한', '힐링되는/편안한',
] as const;

export const EXCLUDE_KEYWORDS = [
  '선정성/노출', '과보정/필터', '소통 부재', '광고 비중 높음',
  '기획력 부족', '나레이션 없음', '자막 없음',
] as const;

// ---------------------------------------------------------------------------
// 파생값 — 브랜드에게 묻지 않고 계산하는 것들
// ---------------------------------------------------------------------------

/** 총 예산(원). 시딩은 건수 × 단가, 나머지는 입력한 예산. */
export const totalBudget = (
  tier: PackageTier,
  budgetKrw: number,
  seedingCount: number,
): number =>
  tier === 'seeding' ? Math.max(0, seedingCount) * packageOf(tier).unitPrice : Math.max(0, budgetKrw);

/**
 * 모집 인원 = 예산 / 1인 단가.
 *
 * 예전에는 브랜드가 직접 적었다. 그런데 예산과 인원을 따로 받으면 둘이 맞지 않는
 * 캠페인이 그대로 등록된다(예산 300만원 · 모집 30명). 하나를 받아 다른 하나를
 * 계산하면 어긋날 수가 없다.
 */
export const derivedHeadcount = (
  tier: PackageTier,
  budgetKrw: number,
  seedingCount: number,
): number => {
  if (tier === 'seeding') return Math.max(0, seedingCount);
  const unit = packageOf(tier).unitPrice;
  return unit > 0 ? Math.floor(Math.max(0, budgetKrw) / unit) : 0;
};

/** 캠페인 제목. 브랜드가 제목을 고민하지 않도록 제품명에서 만든다. */
export const derivedTitle = (productName: string, brandName: string): string => {
  const product = productName.trim();
  const brand = brandName.trim();
  if (product && brand) return `[${brand}] ${product} 캠페인`;
  if (product) return `${product} 캠페인`;
  return brand ? `${brand} 캠페인` : '';
};

/**
 * 지원 조건 문장. 희망 인플루언서에서 고른 값을 그대로 문장으로 만든다.
 *
 * 인플루언서 지원 화면과 담당자 리스트업 화면은 requirements 를 읽어 왔다. 조건을
 * 칩으로 받게 바꿨으니 그 값을 사람이 읽는 문장으로도 남겨 둔다 — 그러지 않으면
 * 기존 화면에서 지원 조건이 갑자기 비어 보인다.
 */
export const derivedRequirements = (input: {
  gender: string;
  ages: string[];
  snsCategory: string;
  followerTiers: string[];
  minViews: number;
  styles: string[];
  excludes: string[];
}): string => {
  const lines: string[] = [];
  const genderLabel = GENDERS.find(g => g.value === input.gender)?.label;
  const who = [genderLabel && genderLabel !== '성별 무관' ? genderLabel : '', input.ages.join('·')]
    .filter(Boolean)
    .join(' ');
  if (who) lines.push(`희망 인플루언서: ${who}`);
  if (input.snsCategory) lines.push(`채널 카테고리: ${input.snsCategory}`);
  if (input.followerTiers.length) {
    const labels = input.followerTiers
      .map(t => FOLLOWER_TIERS.find(f => f.value === t)?.label || t)
      .join(', ');
    lines.push(`채널 규모: ${labels}`);
  }
  if (input.minViews > 0) lines.push(`희망 최소 조회수: ${input.minViews.toLocaleString('ko-KR')}회 이상`);
  if (input.styles.length) lines.push(`선호 스타일: ${input.styles.join(', ')}`);
  if (input.excludes.length) lines.push(`제외 조건: ${input.excludes.join(', ')}`);
  return lines.join('\n');
};
