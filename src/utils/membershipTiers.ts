/**
 * 멤버십 티어(플랜) 정의 — 화면 공용.
 *
 * 서버(netlify/functions/_shared/membership-billing.mts)의 티어·가격·라벨과 반드시 같은
 * 값을 유지한다.
 *
 * 지금 새로 판매하는 플랜은 브랜드(기업) 계정 전용 멤버십 두 등급이다 — 라이트(179,000 ·
 * 월 캠페인 2건 · 선정 20명), 그로스(399,000 · 5건 · 50명). 엔터프라이즈는 별도 문의.
 * 관리자 계정 1개 · 리스트업 · 이력/성과 · 자동 디엠이 포함되고, 직원 좌석은 1석당
 * 49,000원으로 결제한 만큼 늘린다. 자동 디엠 플랜(5,900)은 판매를 종료했다(예전 구독자는 다음 결제일까지 이용).
 * 스탠다드(4,900) · AI 협업(6,900) · 프로(18,700)도 예전 구독 기록을 읽기 위해서만 남는다.
 *
 * 라이브 커머스 멤버십(별도 구독)은 판매를 종료했다 — 결제·구독 경로가 모두 없어졌으므로
 * 여기에도 플랜이 없다. 커머스(13,900) 티어는 예전 구독자의 등급 비교를 위해서만 남는다
 * (신규 판매 없음).
 *
 * 모든 가격은 부가세(VAT 10%) 포함 금액이다.
 */

export type MembershipTier = 'standard' | 'standard_ai' | 'commerce' | 'pro' | 'brand_dm' | 'brand_campaign' | 'brand_growth';
export type BrandPlanTier = 'brand_campaign' | 'brand_growth';
export const isBrandPlanTier = (t: unknown): t is BrandPlanTier => t === 'brand_campaign' || t === 'brand_growth';

/**
 * 출시 혜택 코드 자릿수(숫자). 서버의 netlify/functions/_shared/membership-promo.mts
 * PROMO_CODE_LENGTH 와 같은 값을 유지한다.
 */
export const PROMO_CODE_LENGTH = 9;

export const STANDARD_PRICE = 4900;
export const STANDARD_AI_PRICE = 6900;
export const COMMERCE_PRICE = 13900;
export const PRO_PRICE = 18700;
/** 판매 종료된 브랜드 자동 디엠 플랜(예전 구독 기록용). */
export const BRAND_DM_PRICE = 5900;
/** 브랜드 라이트 멤버십 월 이용료(관리자 계정 1개 · 자동 디엠 포함). */
export const BRAND_CAMPAIGN_PRICE = 179000;
/** 브랜드 그로스 멤버십 월 이용료. */
export const BRAND_GROWTH_PRICE = 399000;
/** 등급별 월 한도(캠페인 건수 · 선정 인플루언서 수). 서버 BRAND_PLAN_LIMITS 와 같다. */
export const BRAND_PLAN_LIMITS: Record<BrandPlanTier, { campaigns: number; selected: number }> = {
  brand_campaign: { campaigns: 2, selected: 20 },
  brand_growth: { campaigns: 5, selected: 50 },
};
/** 등급에 처음부터 들어 있는 직원 좌석. 서버 BRAND_PLAN_INCLUDED_SEATS 와 같다. */
export const BRAND_PLAN_INCLUDED_SEATS: Record<BrandPlanTier, number> = {
  brand_campaign: 0,
  brand_growth: 1,
};
/** 추가 구매(이번 결제 주기만). */
export const ADDON_SELECTED_UNIT = 10;
export const ADDON_SELECTED_PRICE = 49000;
/** 직원 좌석 1석의 월 금액. */
export const BRAND_SEAT_PRICE = 49000;

export const TIER_PRICE: Record<MembershipTier, number> = {
  standard: STANDARD_PRICE,
  standard_ai: STANDARD_AI_PRICE,
  commerce: COMMERCE_PRICE,
  pro: PRO_PRICE,
  brand_dm: BRAND_DM_PRICE,
  brand_campaign: BRAND_CAMPAIGN_PRICE,
  brand_growth: BRAND_GROWTH_PRICE,
};

export const TIER_LABEL: Record<MembershipTier, string> = {
  standard: '스탠다드 멤버십',
  standard_ai: 'AI 협업 멤버십',
  commerce: '커머스 멤버십',
  pro: '프로 플랜',
  brand_dm: '자동 디엠 플랜',
  brand_campaign: '라이트 멤버십',
  brand_growth: '그로스 멤버십',
};

export const TIER_RANK: Record<MembershipTier, number> = {
  standard: 1,
  standard_ai: 2,
  commerce: 3,
  pro: 4,
  brand_dm: 5,
  brand_campaign: 6,
  brand_growth: 7,
};

/** 저장된 플랜 값을 현재 티어로 환산한다(과거 'live' 는 커머스로 취급). */
export const normalizeTier = (plan: unknown): MembershipTier | null => {
  if (
    plan === 'standard' || plan === 'standard_ai' || plan === 'commerce' || plan === 'pro' ||
    plan === 'brand_dm' || plan === 'brand_campaign' || plan === 'brand_growth'
  ) {
    return plan;
  }
  if (plan === 'live') return 'commerce';
  return null;
};

/** 플랜이 required 티어 이상인지(= 해당 기능을 쓸 수 있는지). */
export const tierAtLeast = (plan: unknown, required: MembershipTier): boolean => {
  const tier = normalizeTier(plan);
  return !!tier && TIER_RANK[tier] >= TIER_RANK[required];
};

/** 멤버십이 활성이고 required 티어 이상인지. */
export const membershipCovers = (
  membership: { membership_active?: boolean; membership_plan?: unknown } | null | undefined,
  required: MembershipTier,
): boolean => !!membership?.membership_active && tierAtLeast(membership?.membership_plan, required);

