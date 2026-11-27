/**
 * 어필리에이트 스토어(ZVZO 방식 — 입점 신청 → 운영자 승인 → 상품 등록 → 인플루언서 신청).
 *
 * 전체 공개 여부는 두 곳에만 있다: 화면은 이 파일의 AFFILIATE_STORE_OPEN, 서버는
 * netlify/functions/_shared/store-testers.mts 의 STORE_OPEN. 둘을 함께 고친다.
 * 공개를 끄면(false) 아래 테스트 계정에만 메뉴가 보인다.
 */
export const AFFILIATE_STORE_OPEN = true;

export const AFFILIATE_STORE_TESTERS = ['dnwlsdnwls', 'inplace'];

/**
 * 어필리에이트 메뉴를 화면에 보일지.
 *
 * 지금은 캠페인 기능에 집중하려고 브랜드 · 인플루언서 대시보드의 어필리에이트 · MY
 * 어필리에이트 메뉴와 홈의 어필리에이트 소개를 모두 숨긴다(테스트 계정 포함). 서버
 * (store-testers.mts 의 STORE_OPEN)는 그대로 두므로, 이미 생긴 주문 · 환불 · 정산과
 * 구매자 주문 내역은 계속 동작한다. 다시 열 때는 이 값만 true 로 바꾼다.
 */
export const AFFILIATE_MENUS_VISIBLE = false;

/** 구매자 주문 내역 링크(개인 페이지 바닥). 메뉴를 숨겨도 이미 산 사람은 주문을 확인해야 한다. */
export function canSeeAffiliateOrders(username: string | null | undefined): boolean {
  if (AFFILIATE_STORE_OPEN) return true;
  const name = String(username || '').trim().toLowerCase().replace(/^biz\//, '');
  return AFFILIATE_STORE_TESTERS.includes(name);
}

export function canSeeAffiliateStore(username: string | null | undefined): boolean {
  if (!AFFILIATE_MENUS_VISIBLE) return false;
  if (AFFILIATE_STORE_OPEN) return true;
  const name = String(username || '').trim().toLowerCase().replace(/^biz\//, '');
  return AFFILIATE_STORE_TESTERS.includes(name);
}
