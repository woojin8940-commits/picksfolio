import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { CAFE24_REQUIRED_SCOPES } from "./_shared/cafe24-api.mts";
import { cafe24ConfigReady, cleanMallId, tokenKeyReady } from "./_shared/cafe24-credentials.mts";
import {
  autoInstallScript,
  clearStateCookie,
  consumeState,
  exchangeCode,
  redirectTo,
  revokeToken,
  saveConnection,
  shopSettingsUrl,
  stateMatchesBrowser,
} from "./_shared/cafe24-oauth.mts";

/**
 * 카페24 동의 후 돌아오는 곳(개발자센터 Redirect URI: https://picks-folio.com/api/cafe24/callback).
 *
 *   1) state 검증 — 없음 · 만료 · 이미 사용 · 다른 브라우저면 거부. 통과하면 그 자리에서 사용 처리.
 *   2) 인증코드는 1분 유효 · 1회용이라 곧바로 토큰으로 바꾼다.
 *   3) 응답의 mall_id 가 state 의 몰과 다르면 거부(받은 토큰은 폐기).
 *   4) 암호화해 저장 → 추적 스크립트 자동 설치 → 쇼핑몰 연동 화면으로.
 *
 * 실패하면 같은 화면으로 돌아가 사유 코드(cafe24_error)를 붙인다. 화면이 문구로 바꿔 보인다.
 * 인증코드 · 토큰 · 응답 원문은 로그에 남기지 않는다.
 */
export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);
  const fail = (code: string) => redirectTo(shopSettingsUrl({ cafe24_error: code }), { "Set-Cookie": clearStateCookie() });

  const state = String(url.searchParams.get("state") || "");
  const code = String(url.searchParams.get("code") || "");
  const denied = url.searchParams.get("error");

  if (!state) return fail("state_invalid");
  // 링크만 넘겨받은 다른 브라우저의 시도로 본인의 state 를 태우지 않도록 사용 처리 전에 본다.
  if (!stateMatchesBrowser(req, state)) return fail("state_invalid");
  const bound = await consumeState(db, state);
  if (!bound) return fail("state_invalid");

  // 콜백에 몰 아이디가 실려 오면 state 의 몰과 같아야 한다.
  const echoedMall = url.searchParams.get("mall_id");
  if (echoedMall && cleanMallId(echoedMall) !== bound.mallId) return fail("mall_mismatch");
  if (denied) return fail(denied === "access_denied" ? "denied" : "token_failed");
  if (!code) return fail("token_failed");
  if (!cafe24ConfigReady()) return fail("config");
  if (!tokenKeyReady()) {
    console.error("[cafe24-callback] AFFILIATE_PII_KEY 미설정 — 토큰을 저장하지 않는다");
    return fail("config");
  }

  const exchanged = await exchangeCode(bound.mallId, code);
  if (!exchanged.ok) return fail(exchanged.code);
  const tokens = exchanged.tokens;

  let saved;
  try {
    saved = await saveConnection(db, bound.business, tokens);
  } catch (e) {
    console.error("[cafe24-callback] save failed", e instanceof Error ? e.name : "");
    await revokeToken(bound.mallId, tokens.accessToken);
    return fail("save_failed");
  }
  if (!saved.ok) {
    await revokeToken(bound.mallId, tokens.accessToken);
    return fail(saved.code);
  }

  const missing = CAFE24_REQUIRED_SCOPES.filter((s) => !tokens.scopes.includes(s));
  const script = await autoInstallScript(db, saved.conn, bound.business);
  console.log(
    `[cafe24-callback] mall ${bound.mallId} connected (missing scopes: ${missing.length ? missing.join(",") : "none"}, script: ${script})`,
  );

  return redirectTo(shopSettingsUrl({ cafe24: "connected", mall: bound.mallId }), { "Set-Cookie": clearStateCookie() });
};

export const config: Config = {
  path: ["/api/cafe24/callback", "/api/cafe24/callback/"],
};
