/**
 * 어필리에이트 스토어 테스트 계정(정식 오픈 전 메뉴 · 결제를 쓸 수 있는 계정).
 *
 * 서버는 이 파일 하나만 본다. 화면은 src/utils/featureFlags.ts 의 AFFILIATE_STORE_TESTERS 를 본다.
 * 명단을 바꾸거나 오픈할 때는 이 두 곳을 함께 고친다.
 */
export const STORE_TESTER_LIST = ["dnwlsdnwls", "inplace"] as const;

export const STORE_TESTERS: ReadonlySet<string> = new Set<string>(STORE_TESTER_LIST);

export const isStoreTester = (username: string | null | undefined) =>
  STORE_TESTERS.has(String(username || "").trim().toLowerCase().replace(/^biz\//, ""));
