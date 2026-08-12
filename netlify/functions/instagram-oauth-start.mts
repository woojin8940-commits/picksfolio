import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { issueSignedState, sanitizeReturnPath } from "./_shared/oauth-state.mts";

/**
 * 인스타그램 계정 연동 시작 (OAuth authorize URL 발급).
 *
 * "Instagram API with Instagram Login" 방식(페이스북 페이지 불필요)을 사용한다.
 * - INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET 환경변수가 필요하다.
 * - state 에 사용자명(username)을 실어 콜백에서 어떤 계정에 저장할지 식별한다.
 * - redirect_uri 는 현재 배포 도메인 기준으로 동적 생성한다
 *   (Meta 앱 대시보드의 "유효한 OAuth 리디렉션 URI"에 아래 경로가 등록돼 있어야 한다).
 *
 * 연동을 시작하는 화면이 두 곳이라 `returnTo` 로 복귀 경로를 함께 서명한다.
 * 디엠 자동화(관리자)와 브랜드 매칭 등록(크리에이터 대시보드)이 같은 authorize 흐름을
 * 쓰는데, 복귀 지점이 고정돼 있으면 매칭 등록 도중에 연동한 사람이 관리자 화면으로
 * 튕겨 나가 작성 중이던 등록서를 잃는다. 값은 내부 경로만 허용한다.
 *
 * 보안: 예전에는 GET 으로 `?username=` 만 받아 서명 없는 state 를 만들어 곧장
 * 리다이렉트했다. 그러면 누구나 임의의 사용자명이 박힌 authorize 링크를 만들어
 * 계정 연동 CSRF 가 성립한다. 지금은 **인증된 POST** 로만 state 를 발급하고
 * (본인 계정 확인 + HMAC 서명 + 10분 TTL + 1회용 nonce), 클라이언트가 응답받은
 * URL 로 스스로 이동한다. GET 은 더 이상 지원하지 않는다.
 */

/**
 * 요청 권한.
 *
 * instagram_business_manage_insights 는 릴스 조회수를 받기 위한 것이다. 조회수는
 * 미디어 일반 필드가 아니라 인사이트 지표라서, 이 권한 없이는 팔로워·릴스 목록만
 * 오고 평균 조회수가 0 으로 남는다(브랜드 매칭 명단에서 가장 중요한 숫자다).
 * 메타 앱 심사에서 이 권한이 승인돼야 실제 사용자 계정에서도 값이 내려온다.
 */
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
  "instagram_business_manage_insights",
].join(",");

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);

  if (req.method !== "POST") {
    return Response.json(
      { error: "이 경로는 POST 로만 사용할 수 있습니다." },
      { status: 405 },
    );
  }

  const body = await req.json().catch(() => ({} as any));
  const username = String(body?.username || "").toLowerCase().trim();
  if (!username) {
    return Response.json({ error: "username은 필수입니다." }, { status: 400 });
  }

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) {
    return Response.json(
      { error: "인스타그램 앱 설정이 준비되지 않았습니다." },
      { status: 503 },
    );
  }

  const issued = await issueSignedState(
    username,
    auth.userId,
    sanitizeReturnPath(body?.returnTo),
  );
  if (!issued.ok) {
    return Response.json(
      { error: "연동 요청을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: issued.error },
      { status: 503 },
    );
  }

  const redirectUri = `${url.origin}/api/instagram/oauth/callback`;
  const authorizeUrl =
    `https://www.instagram.com/oauth/authorize` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${encodeURIComponent(issued.state)}`;

  return Response.json({ url: authorizeUrl });
};

export const config: Config = {
  path: "/api/instagram/oauth/start",
};
