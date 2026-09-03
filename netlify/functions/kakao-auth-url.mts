import type { Config } from "@netlify/functions";

/**
 * 카카오 간편로그인을 시작할 주소를 만들어 준다.
 *
 * 원래 웹에서는 카카오 JS SDK(`Kakao.Auth.authorize`)로만 간편로그인을 시작했다.
 * 그 SDK 는 자바스크립트 키(`VITE_KAKAO_JS_KEY`)가 있어야 초기화되는데, 키가
 * 들어가 있지 않으면 조용히 실패해서 로그인이 전부 예전 Supabase OAuth
 * 리다이렉트로 흘렀다 — 카카오계정 아이디·비밀번호 입력 화면이 뜨고, 카카오톡
 * 연동 로그인은 아예 보이지 않았다.
 *
 * 그래서 자바스크립트 키가 없어도 간편로그인을 쓸 수 있는 경로를 하나 더 둔다.
 * 카카오 인가 주소는 REST API 키를 client_id 로 쓰는데 그 키는 서버 전용
 * 환경변수라 브라우저에서 만들 수 없다 — 그래서 여기서 만들어 준다. 돌려주는
 * 주소로 이동하면 카카오 로그인 화면이 뜨고, 그 화면이 기기에 맞는 간편로그인을
 * 제공한다(휴대폰은 카카오톡 앱, PC 는 카카오톡 QR 로그인).
 *
 * 콜백은 우리 도메인의 `/auth-callback` 으로 돌아온다. 즉 이어지는 처리는 기존
 * 간편로그인과 완전히 같다 — `kakao-token-exchange` 가 코드를 ID 토큰으로 바꾸고,
 * 웹앱이 `signInWithIdToken` 으로 Supabase 세션을 만든다. 여기서 만든 인가 코드는
 * REST API 키로 발급되므로 그 교환 요청과 키가 정확히 맞는다.
 *
 * 되돌리는 스위치도 하나 둔다. 카카오 콘솔의 Redirect URI 목록에 이 사이트의
 * `/auth-callback` 이 등록돼 있지 않으면 카카오가 로그인을 마친 뒤 KOE006 오류
 * 화면을 띄운다(카카오가 그 검증을 로그인 뒤에 하기 때문에 미리 알 방법이 없다).
 * 그럴 때 환경변수 `KAKAO_SIMPLE_LOGIN=off` 를 넣으면 이 함수가 거절하고, 웹앱은
 * 곧바로 기존 Supabase OAuth 로그인으로 되돌아간다 — 코드 배포 없이 복구된다.
 */

const KAKAO_AUTHORIZE_ENDPOINT = "https://kauth.kakao.com/oauth/authorize";

/**
 * 요청할 동의 항목. 클라이언트(`src/utils/kakaoLogin.ts` 의 KAKAO_SCOPES)와 같은
 * 목록을 유지한다. 알림톡에 쓰는 전화번호·이름이 여기서 들어오고, `openid` 가
 * 있어야 ID 토큰(OpenID Connect)이 발급된다.
 */
const KAKAO_SCOPES = "openid,profile_nickname,account_email,phone_number,name";

/** 우리 사이트 안의 콜백 경로만 허용한다. */
const CALLBACK_PATH = "/auth-callback";

function fail(error: string, status = 200) {
  return Response.json(
    { success: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return fail("Method not allowed", 405);
  }

  let body: { redirect_uri?: unknown; state?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("잘못된 요청입니다.", 400);
  }

  const redirectUri =
    typeof body.redirect_uri === "string" ? body.redirect_uri.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
  if (!redirectUri || !state) {
    return fail("요청 값이 부족합니다.", 400);
  }
  // state 는 그대로 카카오 주소에 실린다. 우리가 만든 형식(base64url)만 통과시켜
  // 남의 값이 끼어들지 못하게 한다.
  if (!/^[A-Za-z0-9_-]{8,512}$/.test(state)) {
    return fail("허용되지 않은 state 입니다.", 400);
  }

  // 이 앱의 키로 다른 사이트가 로그인 코드를 받아 가는 통로가 되지 않게, 콜백은
  // 이 사이트의 `/auth-callback` 이어야 한다.
  try {
    const requested = new URL(redirectUri);
    const self = new URL(req.url);
    if (requested.origin !== self.origin || requested.pathname !== CALLBACK_PATH) {
      return fail("허용되지 않은 redirect_uri 입니다.", 400);
    }
  } catch {
    return fail("허용되지 않은 redirect_uri 입니다.", 400);
  }

  // 되돌리는 스위치. 값이 off/0/false 면 웹앱이 기존 OAuth 경로로 폴백한다.
  const toggle = (Netlify.env.get("KAKAO_SIMPLE_LOGIN") || "").trim().toLowerCase();
  if (toggle === "off" || toggle === "0" || toggle === "false") {
    return fail("간편로그인이 비활성화되어 있습니다.");
  }

  const restApiKey = Netlify.env.get("KAKAO_REST_API_KEY");
  if (!restApiKey) {
    return fail("KAKAO_REST_API_KEY 환경 변수가 설정되지 않았습니다.");
  }

  const url = new URL(KAKAO_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", restApiKey);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", KAKAO_SCOPES);
  url.searchParams.set("state", state);
  // prompt 는 주지 않는다. `prompt=login` 은 카카오계정 재인증을 강제해서 간편로그인
  // 선택지를 감춘다.

  return new Response(JSON.stringify({ success: true, url: url.toString() }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};

export const config: Config = {
  path: "/api/kakao-auth-url",
};
