/**
 * 멤버십 티어(플랜) 정의 — 화면 공용.
 *
 * 서버(netlify/functions/_shared/membership-billing.mts)의 티어·가격·라벨과 반드시 같은
 * 값을 유지한다. 상위 티어는 하위 티어의 기능을 모두 포함하며(등급 비교는 tierAtLeast),
 * 최상위 프로 플랜만 디엠 자동화를 사용할 수 있다.
 *
 *   스탠다드(4,900) ⊂ AI 협업(6,900) ⊂ 프로(18,700)
 *
 * 라이브 커머스(13,900)는 이 사다리에 들어 있지 않은 **별도 구독**이다. 프로를 결제해도
 * 라이브는 열리지 않으며, 라이브만 따로 결제해야 한다(hasLiveCommerceAccess 참고).
 * 예전 '커머스' 티어(구 'live')를 쓰던 기존 구독자는 그대로 라이브를 쓸 수 있게 남겨 둔다.
 *
 * 모든 가격은 부가세(VAT 10%) 포함 금액이다.
 */

export type MembershipTier = 'standard' | 'standard_ai' | 'commerce' | 'pro';

/** 결제 가능한 플랜 = 멤버십 티어 + 라이브 커머스 별도 구독. */
export type BillingPlan = MembershipTier | 'live_plan';

export const STANDARD_PRICE = 4900;
export const STANDARD_AI_PRICE = 6900;
export const COMMERCE_PRICE = 13900;
export const PRO_PRICE = 18700;
/** 라이브 커머스 별도 구독료(부가세 포함). */
export const LIVE_PLAN_PRICE = 13900;

export const TIER_PRICE: Record<MembershipTier, number> = {
  standard: STANDARD_PRICE,
  standard_ai: STANDARD_AI_PRICE,
  commerce: COMMERCE_PRICE,
  pro: PRO_PRICE,
};

export const TIER_LABEL: Record<MembershipTier, string> = {
  standard: '스탠다드 멤버십',
  standard_ai: 'AI 협업 멤버십',
  commerce: '커머스 멤버십',
  pro: '프로 플랜',
};

export const LIVE_PLAN_LABEL = '라이브 커머스 멤버십';

export const PLAN_PRICE: Record<BillingPlan, number> = {
  ...TIER_PRICE,
  live_plan: LIVE_PLAN_PRICE,
};

export const PLAN_LABEL: Record<BillingPlan, string> = {
  ...TIER_LABEL,
  live_plan: LIVE_PLAN_LABEL,
};

export const TIER_RANK: Record<MembershipTier, number> = {
  standard: 1,
  standard_ai: 2,
  commerce: 3,
  pro: 4,
};

/** 저장된 플랜 값을 현재 티어로 환산한다(과거 'live' 는 커머스로 취급). */
export const normalizeTier = (plan: unknown): MembershipTier | null => {
  if (plan === 'standard' || plan === 'standard_ai' || plan === 'commerce' || plan === 'pro') {
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

/**
 * 라이브 커머스를 쓸 수 있는 상태인지.
 * - 라이브 별도 구독(live_plan_active)이 살아 있거나,
 * - 예전 커머스(구 'live') 멤버십을 유지 중인 기존 구독자.
 * 프로 플랜은 더 이상 라이브를 포함하지 않는다.
 * 서버 `_shared/membership-billing.mts` 의 hasLiveCommerceAccess 와 규칙을 맞춘다.
 */
export const hasLiveCommerceAccess = (
  record:
    | { membership_active?: boolean; membership_plan?: unknown; live_plan_active?: boolean }
    | null
    | undefined,
): boolean => {
  if (!record) return false;
  if (record.live_plan_active) return true;
  return !!record.membership_active && normalizeTier(record.membership_plan) === 'commerce';
};
