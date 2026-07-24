import type { Config, Context } from "@netlify/functions";

/**
 * 인스타그램 계정 연동 시작 (OAuth authorize 로 리다이렉트).
 *
 * "Instagram API with Instagram Login" 방식(페이스북 페이지 불필요)을 사용한다.
 * - INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET 환경변수가 필요하다.
 * - state 에 사용자명(username)을 실어 콜백에서 어떤 계정에 저장할지 식별한다.
 * - redirect_uri 는 현재 배포 도메인 기준으로 동적 생성한다
 *   (Meta 앱 대시보드의 "유효한 OAuth 리디렉션 URI"에 아래 경로가 등록돼 있어야 한다).
 */

const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
].join(",");

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const username = (url.searchParams.get("username") || "").toLowerCase().trim();

  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) {
    return Response.redirect(`${url.origin}/?ig_error=missing_app_config`, 302);
  }
  if (!username) {
    return Response.redirect(`${url.origin}/?ig_error=missing_username`, 302);
  }

  const redirectUri = `${url.origin}/api/instagram/oauth/callback`;
  // state = 사용자명(우리 시스템 계정) — 콜백에서 저장 대상 식별용.
  const state = Buffer.from(JSON.stringify({ u: username })).toString("base64url");

  const authorizeUrl =
    `https://www.instagram.com/oauth/authorize` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${encodeURIComponent(state)}`;

  return Response.redirect(authorizeUrl, 302);
};

export const config: Config = {
  path: "/api/instagram/oauth/start",
};
