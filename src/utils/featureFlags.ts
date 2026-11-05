/**
 * 어필리에이트 스토어(ZVZO 방식 — 입점 신청 → 운영자 승인 → 상품 등록 → 인플루언서 신청).
 *
 * 정식 오픈 전 테스트 기간에는 아래 계정에만 메뉴가 보인다. 서버
 * (netlify/functions/api-affiliate-store.mts 의 TESTERS)도 같은 명단으로 막는다.
 * 오픈할 때는 두 곳의 명단 검사를 함께 없앤다.
 */
export const AFFILIATE_STORE_TESTERS = ['dnwlsdnwls', 'inplace'];

export function canSeeAffiliateStore(username: string | null | undefined): boolean {
  const name = String(username || '').trim().toLowerCase().replace(/^biz\//, '');
  return AFFILIATE_STORE_TESTERS.includes(name);
}
