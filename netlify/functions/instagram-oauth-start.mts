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
 * 두 화면은 흐름만 공유하고 연동 자체는 나눈다. `purpose:'collab'` 로 시작한 연동은
 * 캠페인 전용 보관함에 저장되고(콜백 참고), 인스타그램 로그인도 매번 새로 받는다.
 * 디엠 자동화에 붙여 둔 계정이 캠페인 등록서에 자동으로 따라 붙지 않게 하기 위해서다.
 *
 * 보안: 예전에는 GET 으로 `?username=` 만 받아 서명 없는 state 를 만들어 곧장
 * 리다이렉트했다. 그러면 누구나 임의의 사용자명이 박힌 authorize 링크를 만들어
 * 계정 연동 CSRF 가 성립한다. 지금은 **인증된 POST** 로만 state 를 발급하고
 * (본인 계정 확인 + HMAC 서명 + 10분 TTL + 1회용 nonce), 클라이언트가 응답받은
 * URL 로 스스로 이동한다. GET 은 더 이상 지원하지 않는다.
 */

/**
 * 요청 권한. 네 개 모두 2026-08-30 메타 앱 심사를 통과했다(insights·comments 신규
 * 승인, basic·messages 갱신). 하나라도 빼면 그 기능이 조용히 멈추므로 목록을 줄이지
 * 않는다.
 *
 *   instagram_business_basic            계정 기본 정보와 미디어 목록.
 *   instagram_business_manage_messages  디엠 자동화(발송·수신 웹훅).
 *   instagram_business_manage_comments  댓글 자동 답글과 댓글 이벤트 웹훅.
 *   instagram_business_manage_insights  조회수·도달·저장수. 이 셋은 미디어 일반
 *     필드가 아니라 인사이트 지표라서, 권한 없이는 팔로워·릴스 목록만 오고 숫자가
 *     0 또는 빈 값으로 남는다(브랜드 매칭 명단의 평균 조회수, 인사이트 화면의
 *     도달·저장수가 여기에 걸린다).
 *
 * 주의: 승인 전에 발급된 토큰에는 새로 승인된 범위가 붙어 있지 않고, 장기 토큰
 * 갱신으로도 범위는 늘어나지 않는다. 그 계정들은 사람이 이 동의 화면을 한 번 더
 * 지나야 한다(인사이트 화면이 그 경우를 감지해 재연동을 권한다).
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

  // 캠페인(브랜드 매칭) 등록 화면에서 시작한 연동인지. 디엠 자동화 연동과는 보관함도,
  // 로그인 방식도 다르다 — 아래 force_reauth 와 콜백의 저장 위치가 이 값으로 갈린다.
  const isCollab = String(body?.purpose || "") === "collab";

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
    isCollab ? "collab" : undefined,
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
    // 캠페인 등록은 "지금 이 계정으로 등록한다"를 매번 다시 고르는 자리다. 브라우저에
    // 남아 있는 인스타그램 세션으로 조용히 통과시키면, 등록하는 사람은 어떤 계정이
    // 붙었는지 확인할 기회 없이 남의(혹은 예전) 계정으로 등록서를 내게 된다.
    (isCollab ? `&force_reauth=true` : ``) +
    `&state=${encodeURIComponent(issued.state)}`;

  return Response.json({ url: authorizeUrl });
};

export const config: Config = {
  path: "/api/instagram/oauth/start",
};
