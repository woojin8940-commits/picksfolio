/**
 * 어필리에이트 스토어(ZVZO 방식 — 입점 신청 → 운영자 승인 → 상품 등록 → 인플루언서 신청).
 *
 * 정식 오픈 전 테스트 기간에는 아래 계정에만 메뉴가 보인다.
 * 테스트 계정 명단은 두 곳에만 있다: 화면은 이 상수 하나, 서버는 netlify/functions/_shared/store-testers.mts 하나.
 * 다른 파일은 여기서 가져다 쓴다. 명단을 바꾸거나 오픈할 때는 이 두 곳을 함께 고친다.
 */
export const AFFILIATE_STORE_TESTERS = ['dnwlsdnwls', 'inplace'];

export function canSeeAffiliateStore(username: string | null | undefined): boolean {
  const name = String(username || '').trim().toLowerCase().replace(/^biz\//, '');
  return AFFILIATE_STORE_TESTERS.includes(name);
}
