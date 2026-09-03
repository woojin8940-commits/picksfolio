import type { Config } from "@netlify/functions";

/**
 * 카카오 간편로그인 인가 코드를 토큰으로 바꿔 준다.
 *
 * 카카오 JS SDK 의 `Auth.authorize()` 는 카카오톡 앱으로 넘어가는 간편로그인을
 * 띄우는 대신(모바일 웹에서 앱 연동이 되는 유일한 경로다) 토큰이 아니라 인가
 * 코드만 돌려준다. 코드를 토큰으로 바꾸는 요청에는 REST API 키와 (활성화한
 * 경우) Client Secret 이 필요해서 브라우저에서 할 수 없다 — 그래서 여기서 한다.
 *
 * 돌려주는 ID 토큰은 곧바로 `supabase.auth.signInWithIdToken({ provider: 'kakao' })`
 * 로 들어간다. 그래서 세션·identity 는 기존 OAuth 로그인과 완전히 같은 모양이고,
 * 로그인 뒤 프로필 연동(`kakao-profile-setup`)도 그대로 동작한다.
 *
 * 토큰은 요청한 브라우저(=본인)에게만 돌려준다. 응답을 캐시하지 않고, 값 자체는
 * 로그에 남기지 않는다.
 */

const KAKAO_TOKEN_ENDPOINT = "https://kauth.kakao.com/oauth/token";

function fail(error: string, status = 200) {
  return Response.json({ success: false, error }, { status });
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return fail("Method not allowed", 405);
  }

  let body: { code?: unknown; redirect_uri?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("잘못된 요청입니다.", 400);
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const redirectUri =
    typeof body.redirect_uri === "string" ? body.redirect_uri.trim() : "";
  if (!code || !redirectUri) {
    return fail("인가 코드가 없습니다.", 400);
  }

  // Redirect URI 는 이 사이트 안의 주소여야 한다. 우리 앱의 키로 다른 사이트가
  // 받은 코드를 바꿔 주는 통로가 되지 않게 막는다.
  try {
    const requested = new URL(redirectUri);
    const self = new URL(req.url);
    if (requested.origin !== self.origin) {
      return fail("허용되지 않은 redirect_uri 입니다.", 400);
    }
  } catch {
    return fail("허용되지 않은 redirect_uri 입니다.", 400);
  }

  const restApiKey = Netlify.env.get("KAKAO_REST_API_KEY");
  if (!restApiKey) {
    return fail("KAKAO_REST_API_KEY 환경 변수가 설정되지 않았습니다.");
  }
  // 카카오 콘솔에서 Client Secret 을 켜 두었다면 반드시 함께 보내야 한다.
  const clientSecret = Netlify.env.get("KAKAO_CLIENT_SECRET") || "";

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: restApiKey,
    redirect_uri: redirectUri,
    code,
  });
  if (clientSecret) form.set("client_secret", clientSecret);

  let payload: Record<string, any>;
  try {
    const res = await fetch(KAKAO_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: form.toString(),
    });
    payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 카카오가 주는 진단 메시지는 설정 실수(Redirect URI 미등록, Client Secret
      // 누락 등)를 그대로 알려 준다. 키 값은 담기지 않으므로 그대로 전달한다.
      const reason =
        payload?.error_description || payload?.error || `HTTP ${res.status}`;
      console.error("[kakao-token-exchange] 토큰 발급 실패:", reason);
      return fail(`카카오 토큰 발급에 실패했습니다: ${reason}`);
    }
  } catch (err: any) {
    console.error("[kakao-token-exchange] 카카오 요청 오류:", err?.message);
    return fail("카카오 서버와 통신하지 못했습니다.");
  }

  const idToken = payload?.id_token;
  if (!idToken) {
    return fail(
      "카카오가 ID 토큰을 발급하지 않았습니다. 카카오 개발자 콘솔에서 OpenID Connect 를 활성화해 주세요.",
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      id_token: idToken,
      access_token: payload?.access_token || "",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
};

export const config: Config = {
  path: "/api/kakao-token-exchange",
};
