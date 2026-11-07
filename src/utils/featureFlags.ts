/**
 * 어필리에이트 스토어(ZVZO 방식 — 입점 신청 → 운영자 승인 → 상품 등록 → 인플루언서 신청).
 *
 * 전체 공개 여부는 두 곳에만 있다: 화면은 이 파일의 AFFILIATE_STORE_OPEN, 서버는
 * netlify/functions/_shared/store-testers.mts 의 STORE_OPEN. 둘을 함께 고친다.
 * 공개를 끄면(false) 아래 테스트 계정에만 메뉴가 보인다.
 */
export const AFFILIATE_STORE_OPEN = true;

export const AFFILIATE_STORE_TESTERS = ['dnwlsdnwls', 'inplace'];

export function canSeeAffiliateStore(username: string | null | undefined): boolean {
  if (AFFILIATE_STORE_OPEN) return true;
  const name = String(username || '').trim().toLowerCase().replace(/^biz\//, '');
  return AFFILIATE_STORE_TESTERS.includes(name);
}
