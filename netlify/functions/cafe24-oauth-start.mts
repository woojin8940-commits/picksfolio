import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { cafe24ConfigReady, cleanMallId, tokenKeyReady } from "./_shared/cafe24-credentials.mts";
import {
  authorizeUrl,
  connectionOwnership,
  issueState,
  peekState,
  redirectTo,
  shopSettingsUrl,
  stateMatchesBrowser,
  verifyLaunch,
} from "./_shared/cafe24-oauth.mts";

/**
 * 카페24 연동 시작.
 *
 *   POST { mall_id } | { launch }  (로그인한 브랜드, Bearer)
 *     → 브랜드 · 몰에 묶인 1회용 state(10분)를 저장하고 이동할 주소를 돌려준다.
 *       launch 는 /cafe24/app 이 hmac 검증 뒤 발급한 서명 값이다(몰 아이디가 들어 있다).
 *   GET ?mall_id=&state=
 *     → state 가 그 몰의 미사용 · 미만료 값이고 같은 브라우저(쿠키)면 카페24 동의 화면으로 302.
 *   GET ?mall_id=  (state 없음)
 *     → 브라우저 이동에는 로그인 토큰이 실리지 않는다. 쇼핑몰 연동 화면으로 보내 거기서
 *       로그인 확인 후 위 POST 를 거치게 한다.
 *
 * 서버는 카페24 authorize 를 직접 부르지 않는다 — 동의는 브랜드 브라우저에서 일어나야 한다.
 */
export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mallId = cleanMallId(url.searchParams.get("mall_id"));
    const state = String(url.searchParams.get("state") || "");
    if (!mallId) return redirectTo(shopSettingsUrl({ cafe24_error: "invalid_mall" }));
    if (!state) return redirectTo(shopSettingsUrl({ cafe24_mall: mallId }));
    if (!cafe24ConfigReady()) return redirectTo(shopSettingsUrl({ cafe24_error: "config" }));
    if (!stateMatchesBrowser(req, state) || !(await peekState(db, state, mallId))) {
      return redirectTo(shopSettingsUrl({ cafe24_error: "state_invalid" }));
    }
    return redirectTo(authorizeUrl(mallId, state));
  }

  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller.response;
  const business = caller.username;
  if (!business) return Response.json({ error: "브랜드 계정으로 로그인해 주세요." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const fromLaunch = Boolean(body?.launch);
  const mallId = fromLaunch ? verifyLaunch(String(body.launch)) : cleanMallId(body?.mall_id);
  if (!mallId) {
    return Response.json(
      fromLaunch
        ? { error: "카페24에서 앱을 다시 실행해 주세요. (실행 정보가 만료되었습니다)", code: "LAUNCH_EXPIRED" }
        : { error: "쇼핑몰 아이디는 영문 소문자와 숫자로만 입력해 주세요.", code: "INVALID_MALL" },
      { status: 400 },
    );
  }

  if (!cafe24ConfigReady()) {
    console.error("[cafe24-oauth-start] CAFE24_CLIENT_ID / CAFE24_CLIENT_SECRET / CAFE24_REDIRECT_URI 미설정");
    return Response.json({ error: "카페24 연동 설정이 준비되지 않았습니다.", code: "CONFIG" }, { status: 503 });
  }
  // 받은 토큰을 암호화할 키가 없으면 동의까지 받아 놓고 저장하지 못한다. 시작부터 막는다.
  if (!tokenKeyReady()) {
    console.error("[cafe24-oauth-start] AFFILIATE_PII_KEY 미설정 — 연동을 시작하지 않는다");
    return Response.json({ error: "카페24 연동 설정이 준비되지 않았습니다.", code: "KEY_MISSING" }, { status: 503 });
  }

  const owner = await connectionOwnership(db, business, mallId);
  if (owner.takenByOther) {
    return Response.json({ error: "이미 다른 브랜드 계정에 연동된 쇼핑몰입니다.", code: "MALL_TAKEN" }, { status: 409 });
  }
  // 카페24 관리자에서 앱을 열 때마다 동의 화면을 다시 띄우지 않는다. 버튼으로 누른 재연동은 그대로 진행.
  if (fromLaunch && owner.healthy) return Response.json({ alreadyConnected: true, mallId });

  const issued = await issueState(db, business, mallId);
  const next = `/api/cafe24-oauth-start?mall_id=${encodeURIComponent(mallId)}&state=${encodeURIComponent(issued.state)}`;
  return Response.json({ url: next, mallId }, { headers: { "Set-Cookie": issued.cookie, "Cache-Control": "no-store" } });
};

export const config: Config = {
  path: "/api/cafe24-oauth-start",
};
