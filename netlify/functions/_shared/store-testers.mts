/**
 * 어필리에이트 스토어 공개 여부 · 테스트 계정.
 *
 * 서버는 이 파일 하나만 본다. 화면은 src/utils/featureFlags.ts 의 AFFILIATE_STORE_OPEN 을 본다.
 * 공개 여부를 바꿀 때는 이 두 곳을 함께 고친다.
 *
 * STORE_OPEN 이 true 이면 누구나 메뉴(브랜드 · 인플루언서 · 정산)를 쓸 수 있다.
 * 결제는 항상 누구나 할 수 있다(테스트 계정과 상관없음).
 */
export const STORE_OPEN = true;

export const STORE_TESTER_LIST = ["dnwlsdnwls", "inplace"] as const;

export const STORE_TESTERS: ReadonlySet<string> = new Set<string>(STORE_TESTER_LIST);

export const isStoreTester = (username: string | null | undefined) =>
  STORE_TESTERS.has(String(username || "").trim().toLowerCase().replace(/^biz\//, ""));

/** 스토어 메뉴 · API 를 쓸 수 있는 계정인지(전체 공개면 누구나). */
export const canUseStore = (username: string | null | undefined) => STORE_OPEN || isStoreTester(username);
