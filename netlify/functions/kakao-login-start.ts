import { Handler } from "@netlify/functions";

const handler: Handler = async (event) => {
  const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
  const siteUrl = process.env.URL || `https://${event.headers.host}`;

  if (!KAKAO_REST_API_KEY) {
    console.error("[kakao-login-start] KAKAO_REST_API_KEY not configured");
    return {
      statusCode: 302,
      headers: { Location: `${siteUrl}/login?error=kakao_not_configured` },
      body: "",
    };
  }

  const redirectUri = process.env.KAKAO_REDIRECT_URI || `${siteUrl}/api/kakao/callback`;
  console.log("[kakao-login-start] Using redirect_uri:", redirectUri);
  console.log("[kakao-login-start] process.env.URL:", process.env.URL);

  const params = new URLSearchParams({
    client_id: KAKAO_REST_API_KEY,
    redirect_uri: redirectUri,
    response_type: "code",
    prompt: "login",
  });

  return {
    statusCode: 302,
    headers: { Location: `https://kauth.kakao.com/oauth/authorize?${params.toString()}` },
    body: "",
  };
};

export { handler };
