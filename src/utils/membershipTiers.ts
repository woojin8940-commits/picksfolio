/**
 * 멤버십 티어(플랜) 정의 — 화면 공용.
 *
 * 서버(netlify/functions/_shared/membership-billing.mts)의 티어·가격·라벨과 반드시 같은
 * 값을 유지한다. 상위 티어는 하위 티어의 기능을 모두 포함하며(등급 비교는 tierAtLeast),
 * 최상위 프로 플랜만 디엠 자동화를 사용할 수 있다.
 *
 *   스탠다드(4,900) ⊂ AI 협업(6,900) ⊂ 프로(18,700)
 *
 * 라이브 커머스 멤버십(별도 구독)은 판매를 종료했다 — 결제·구독 경로가 모두 없어졌으므로
 * 여기에도 플랜이 없다. 커머스(13,900) 티어는 예전 구독자의 등급 비교를 위해서만 남는다
 * (신규 판매 없음).
 *
 * 모든 가격은 부가세(VAT 10%) 포함 금액이다.
 */

export type MembershipTier = 'standard' | 'standard_ai' | 'commerce' | 'pro';

export const STANDARD_PRICE = 4900;
export const STANDARD_AI_PRICE = 6900;
export const COMMERCE_PRICE = 13900;
export const PRO_PRICE = 18700;

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

