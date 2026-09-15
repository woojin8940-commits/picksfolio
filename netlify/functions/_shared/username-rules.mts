/**
 * 아이디(= 개인페이지 주소) 규칙. 가입 화면의 "중복확인"과 실제 가입이 같은 판정을
 * 쓰기 위한 한 벌이다.
 *
 * 규칙이 두 군데에 흩어져 있으면 중복확인이 "사용 가능"이라 해 놓고 가입은 거절하는
 * 화면이 된다 — 사용자가 고칠 수 있는 것이 아무것도 없는 막다른 길이다. 그래서
 * 형식 검사 · 예약어 목록 · 정규화를 이 모듈 하나에 두고, auth-check-username ·
 * auth-signup · business-auth 가 모두 이것만 본다.
 */

/** 영문 소문자 · 숫자 · 밑줄 3~20자. profiles.username 에 저장되는 형태다. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/**
 * 크리에이터 아이디로 줄 수 없는 이름.
 *
 * 아이디는 그대로 페이지 주소(picks-folio.com/아이디)가 된다. 라우터가 첫 칸을
 * 화면 이름으로 먼저 읽기 때문에(src/App.tsx 의 TOP_LEVEL_VIEWS · RESERVED_PATHS,
 * netlify/edge-functions/og-image.ts 의 같은 목록), 이 이름으로 가입한 사람의
 * 페이지는 아무도 열 수 없다. 그 사실을 가입 시점에 알려 주는 편이 낫다.
 *
 * 목록은 위 두 목록에서 실제로 입력 가능한 이름(영문 소문자·숫자·밑줄)만 옮긴 것이다
 * — 'business-login' 처럼 하이픈이 든 주소는 형식 검사에서 이미 걸러진다.
 */
export const RESERVED_USERNAMES = new Set([
  "signup",
  "login",
  "admin",
  "operator",
  "manager",
  "membership",
  "settings",
  "terms",
  "privacy",
  "business",
  "profile",
  "api",
  "assets",
  "vendor",
  "checkout",
  "success",
  "fail",
  "toss",
  "portone",
]);

/** 입력값을 저장 형태(소문자, 앞뒤 공백 없음)로 맞춘다. */
export function normalizeUsername(input: unknown): string {
  return String(input ?? "").trim().toLowerCase();
}

export type UsernameRuleResult = { ok: true } | { ok: false; reason: "format" | "reserved"; error: string };

/**
 * 형식과 예약어를 함께 본다. 중복(이미 쓰는 사람이 있는지)은 DB 를 봐야 하므로
 * 호출하는 쪽에서 이어서 확인한다.
 */
export function checkUsernameRules(username: string): UsernameRuleResult {
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      reason: "format",
      error: "아이디는 영문 소문자, 숫자, 밑줄로 3~20자까지 입력해 주세요.",
    };
  }
  if (RESERVED_USERNAMES.has(username)) {
    return {
      ok: false,
      reason: "reserved",
      error: "서비스에서 사용 중인 주소라 아이디로 쓸 수 없습니다. 다른 아이디를 입력해 주세요.",
    };
  }
  return { ok: true };
}
