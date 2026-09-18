import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { issueSignedState, sanitizeReturnPath } from "./_shared/oauth-state.mts";
import {
  GRAPH_VERSION,
  META_ADS_SCOPES,
  metaAdsAppId,
  metaAdsConfigId,
  metaAdsRedirectUri,
} from "./_shared/meta-ads.mts";

/**
 * 메타 광고 계정 연동 시작 — 페이스북 로그인 대화상자 URL 발급.
 *
 * 광고 현황의 'Meta 계정 연동하기' 가 누르는 자리다. 예전에는 화면이 곧바로 연동 상태를
 * 켰다(mock). 그래서 버튼을 눌러도 동의 화면이 뜨지 않고 '연동됨' 으로 바뀌었고, 그 다음
 * 화면에 뜨는 광고 계정 목록도 실제 계정이 아니었다 — 연동을 눌러 본 사람은 연동이 끝났다고
 * 읽지만 메타 쪽에는 아무 일도 일어나지 않은 상태였다.
 *
 * 인스타그램 연동(instagram-oauth-start)과 같은 규칙을 따른다: **인증된 POST** 로만
 * state 를 발급하고(본인 계정 확인 + HMAC 서명 + 10분 TTL + 1회용 nonce), 클라이언트는
 * 응답받은 URL 로 스스로 이동한다. GET 링크로 바로 리다이렉트하면 누구나 임의의
 * 사용자명이 박힌 authorize 링크를 만들 수 있어 계정 연동 CSRF 가 성립한다.
 *
 * 다른 점은 요청하는 권한과 대화상자 주소다. 광고 권한은 페이스북 로그인에서만 받을 수
 * 있어 facebook.com 의 대화상자를 쓴다(인스타그램 연동은 instagram.com).
 */
export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);

  if (req.method !== "POST") {
    return Response.json(
      { error: "이 경로는 POST 로만 사용할 수 있습니다." },
      { status: 405 },
    );
  }

  const body = await req.json().catch(() => ({} as any));
  const username = String(body?.username || "")
    .replace(/^biz\//, "")
    .toLowerCase()
    .trim();
  if (!username) {
    return Response.json({ error: "username은 필수입니다." }, { status: 400 });
  }

  // 광고 연동은 계정 단위 설정이다. 남의 브랜드 계정에 광고 계정을 붙일 수 없어야 한다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const appId = metaAdsAppId();
  if (!appId) {
    return Response.json(
      { error: "메타 앱 설정이 준비되지 않았습니다. (FACEBOOK_APP_ID)" },
      { status: 503 },
    );
  }

  // 연동을 마치면 시작한 화면으로 돌려보낸다. 광고 현황은 URL 이 아니라 화면 상태로
  // 열리는 하위 화면이라, 복귀 경로가 없으면 대시보드 첫 화면에 떨어진다.
  const issued = await issueSignedState(
    username,
    auth.userId,
    sanitizeReturnPath(body?.returnTo) || "/business/admin",
    "ads",
  );
  if (!issued.ok) {
    return Response.json(
      {
        error: "연동 요청을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        code: issued.error,
      },
      { status: 503 },
    );
  }

  const redirectUri = metaAdsRedirectUri(url.origin);
  const configId = metaAdsConfigId();

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    state: issued.state,
  });

  if (configId) {
    // 비즈니스용 페이스북 로그인. 권한 묶음은 설정 ID 안에 들어 있어 scope 를 보내지 않는다.
    params.set("config_id", configId);
    params.set("override_default_response_type", "true");
  } else {
    params.set("scope", META_ADS_SCOPES.join(","));
    // 지난번에 권한을 껐던 사람에게도 그 권한을 다시 물어본다. 없으면 한 번 거부한
    // 권한은 동의 화면에 아예 뜨지 않아, 다시 연동해도 같은 진단 결과가 나온다.
    params.set("auth_type", "rerequest");
  }

  return Response.json({
    url: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`,
    // 화면이 "무엇을 물어보는 중인지" 안내할 때 쓴다. 설정 ID 방식이면 권한 묶음이
    // 메타 쪽 설정에 있어 여기서 알 수 없으므로 비워 보낸다.
    scopes: configId ? [] : META_ADS_SCOPES,
    redirectUri,
  });
};

export const config: Config = {
  path: "/api/meta-ads/oauth/start",
};
