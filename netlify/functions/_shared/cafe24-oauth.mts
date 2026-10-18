/**
 * 카페24 몰 연동(OAuth 2.0) 흐름.
 *
 *   브랜드 화면 "카페24 연동하기" → 쇼핑몰 아이디 입력 → POST /api/cafe24-oauth-start(로그인 확인,
 *   state 발급) → GET /api/cafe24-oauth-start?mall_id&state → 302 카페24 동의 화면
 *   → GET /api/cafe24/callback?code&state → 즉시 토큰 교환 → cafe24_connections 저장
 *   → 추적 스크립트 자동 설치 → /business-admin?tab=shop-settings
 *
 * 카페24 관리자에서 앱을 실행하면 /cafe24/app 으로 들어온다. 문서('앱 실행 권한') 방식대로
 * hmac · timestamp 를 검증한 뒤, 검증된 몰 아이디를 짧은 서명 값(launch)에 담아 같은 흐름으로 보낸다.
 *
 * 토큰 갱신은 여기서 하지 않는다 — _shared/cafe24-api.mts 의 refreshConnection 한 곳뿐이다.
 * 로그 원칙: 토큰 · 인증코드 · 시크릿 · 카페24 응답 원문은 남기지 않는다.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  CAFE24_REQUIRED_SCOPES,
  type Cafe24Connection,
  connectionForMall,
  connectionFromRow,
  connectionHealth,
  findScriptTag,
  installScriptTag,
  removeScriptTag,
} from "./cafe24-api.mts";
import {
  type Cafe24TokenSet,
  cafe24AppConfig,
  cleanMallId,
  decryptToken,
  encryptToken,
  isGrantFailure,
  parseTokenResponse,
  postOAuth,
} from "./cafe24-credentials.mts";
import { publicOrigin } from "./affiliate.mts";

export const SHOP_SETTINGS_PATH = "/business-admin?tab=shop-settings";

const STATE_TTL_MS = 10 * 60 * 1000;
const LAUNCH_TTL_MS = 10 * 60 * 1000;
/** 앱 실행 요청의 timestamp 허용 범위. 문서 심사 기준(2시간)보다 좁게 둔다. */
const LAUNCH_MAX_SKEW_SEC = 5 * 60;

const STATE_COOKIE = "pf_cafe24_state";

export const norm = (raw: unknown) => String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

const sha256 = (v: string) => createHash("sha256").update(v).digest();

/** 길이가 달라도 시간 차이가 나지 않게 해시끼리 비교한다. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b)) && a.length === b.length;
}

export function shopSettingsUrl(params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params).toString();
  return q ? `${SHOP_SETTINGS_PATH}&${q}` : SHOP_SETTINGS_PATH;
}

export const redirectTo = (location: string, headers: Record<string, string> = {}) =>
  new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", ...headers } });

export function readCookie(req: Request, name: string): string {
  for (const part of String(req.headers.get("cookie") || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}

// ── state ───────────────────────────────────────────────────────────────────

/**
 * 추측할 수 없는 state(32바이트)를 만들어 브랜드 · 몰에 묶어 저장한다. 10분 뒤 만료.
 * 같은 값을 HttpOnly 쿠키로도 심는다 — 콜백은 연동을 시작한 브라우저에서만 통과한다
 * (링크만 넘겨받은 다른 사람이 자기 몰로 동의해 남의 계정에 붙이는 것을 막는다).
 */
export async function issueState(db: any, business: string, mallId: string): Promise<{ state: string; cookie: string }> {
  const state = randomBytes(32).toString("base64url");
  await db.sql`
    INSERT INTO cafe24_oauth_states (state, business_username, mall_id, expires_at)
    VALUES (${state}, ${business}, ${mallId}, ${new Date(Date.now() + STATE_TTL_MS).toISOString()})
  `;
  const cookie = `${STATE_COOKIE}=${state}; Path=/api/; Max-Age=${STATE_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
  return { state, cookie };
}

export const clearStateCookie = () => `${STATE_COOKIE}=; Path=/api/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** 브라우저 결속 확인. oauth-state 와 같은 비상 스위치(OAUTH_BROWSER_BINDING=off)를 따른다. */
export function stateMatchesBrowser(req: Request, state: string): boolean {
  const cookie = readCookie(req, STATE_COOKIE);
  if (cookie && safeEqual(cookie, state)) return true;
  if (String(process.env.OAUTH_BROWSER_BINDING || "").trim().toLowerCase() === "off") {
    console.warn("[cafe24-oauth] browser binding mismatch ignored (OAUTH_BROWSER_BINDING=off)");
    return true;
  }
  return false;
}

/** 아직 쓰이지 않았고 만료 전인 state 인지(사용 처리하지 않는다 — 동의 화면으로 보낼 때). */
export async function peekState(db: any, state: string, mallId: string): Promise<boolean> {
  if (!state) return false;
  const rows = (await db.sql`
    SELECT 1 FROM cafe24_oauth_states
    WHERE state = ${state} AND mall_id = ${mallId} AND used_at IS NULL AND expires_at > NOW()
  `) as any[];
  return rows.length > 0;
}

/** 콜백: 한 문장으로 사용 처리하고 묶인 브랜드 · 몰을 돌려준다. 없음 · 만료 · 이미 사용이면 null. */
export async function consumeState(db: any, state: string): Promise<{ business: string; mallId: string } | null> {
  if (!state || state.length > 128) return null;
  const rows = (await db.sql`
    UPDATE cafe24_oauth_states SET used_at = NOW()
    WHERE state = ${state} AND used_at IS NULL AND expires_at > NOW()
    RETURNING business_username, mall_id
  `) as any[];
  const row = rows[0];
  return row ? { business: norm(row.business_username), mallId: String(row.mall_id) } : null;
}

/** 카페24 동의 화면 주소. 모든 값을 URL 인코딩하고 scope 는 공백으로 잇는다(%20). */
export function authorizeUrl(mallId: string, state: string): string {
  const { clientId, redirectUri } = cafe24AppConfig();
  const params: [string, string][] = [
    ["response_type", "code"],
    ["client_id", clientId],
    ["state", state],
    ["redirect_uri", redirectUri],
    ["scope", CAFE24_REQUIRED_SCOPES.join(" ")],
  ];
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `https://${mallId}.cafe24api.com/api/v2/oauth/authorize?${query}`;
}

// ── 앱 실행(/cafe24/app) ─────────────────────────────────────────────────────

const decodeComponent = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};
const decodeForm = (v: string) => decodeComponent(v.replace(/\+/g, "%20"));

/**
 * 카페24 개발자센터 '앱 실행 권한' 문서의 무결성 검증.
 *
 *   1) 전달된 파라미터 중 hmac 을 뺀 나머지(대표 운영자 9개, 부운영자 · 공급사 운영자는
 *      auth_config 포함 10개)를 파라미터명 알파벳순으로 정렬해 URL 인코딩된 query string 으로 만든다.
 *   2) 클라이언트 시크릿을 키로 HMAC-SHA256 → Base64.
 *   3) 전달된 hmac(URL 디코딩한 값)과 비교한다. 상수 시간 비교.
 *   + timestamp 가 지금과 5분 넘게 차이 나면 거부(재전송 공격 방지).
 *
 * 받은 query 를 다시 조립하지 않고 **받은 그대로의 인코딩**으로 정렬해 쓰는 것이 기본이다
 * (문서 샘플 코드도 원문에서 '&hmac=…' 만 잘라 낸다). 중간 프록시가 인코딩 표기를
 * 바꿔 놓은 경우에 대비해 같은 값을 표준 인코딩으로 다시 만든 문자열도 함께 대조한다.
 */
export function verifyAppLaunch(
  rawSearch: string,
  nowMs = Date.now(),
): { ok: true; mallId: string; shopNo: string; userType: string } | { ok: false; reason: string } {
  const { clientSecret } = cafe24AppConfig();
  if (!clientSecret) return { ok: false, reason: "config" };

  const parts = rawSearch.replace(/^\?/, "").split("&").filter(Boolean);
  let hmacRaw: string | null = null;
  const rest: { name: string; raw: string; value: string }[] = [];
  for (const p of parts) {
    const eq = p.indexOf("=");
    const name = decodeComponent(eq < 0 ? p : p.slice(0, eq));
    const rawValue = eq < 0 ? "" : p.slice(eq + 1);
    if (name === "hmac") {
      if (hmacRaw !== null) return { ok: false, reason: "duplicate_hmac" };
      hmacRaw = rawValue;
      continue;
    }
    if (rest.some((r) => r.name === name)) return { ok: false, reason: "duplicate_param" };
    rest.push({ name, raw: p, value: decodeForm(rawValue) });
  }
  if (!hmacRaw) return { ok: false, reason: "missing_hmac" };

  const get = (n: string) => rest.find((r) => r.name === n)?.value || "";
  const mallId = cleanMallId(get("mall_id"));
  const timestamp = get("timestamp");
  if (!mallId) return { ok: false, reason: "invalid_mall" };
  if (!/^\d{9,11}$/.test(timestamp)) return { ok: false, reason: "invalid_timestamp" };

  // '+' 는 Base64 문자다. 폼 디코딩(+→공백)을 하지 않는다.
  const provided = decodeComponent(hmacRaw).replace(/ /g, "+");
  const sorted = [...rest].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const candidates = new Set<string>([
    sorted.map((r) => r.raw).join("&"),
    sorted.map((r) => `${encodeURIComponent(r.name)}=${encodeURIComponent(r.value)}`).join("&"),
    new URLSearchParams(sorted.map((r) => [r.name, r.value] as [string, string])).toString(),
  ]);
  let matched = false;
  for (const plain of candidates) {
    const expected = createHmac("sha256", clientSecret).update(plain, "utf8").digest("base64");
    if (safeEqual(expected, provided)) matched = true;
  }
  if (!matched) return { ok: false, reason: "bad_hmac" };

  const skew = Math.abs(Math.floor(nowMs / 1000) - Number(timestamp));
  if (skew > LAUNCH_MAX_SKEW_SEC) return { ok: false, reason: "stale_timestamp" };

  return { ok: true, mallId, shopNo: get("shop_no") || "1", userType: get("user_type") };
}

/**
 * 검증을 마친 몰 아이디를 브랜드 화면으로 넘기는 짧은 서명 값. 화면이 로그인을 마친 뒤
 * 이 값을 다시 보내면 서버가 서명 · 만료를 확인하고 그 몰로 연동을 시작한다.
 */
const launchKey = () => {
  const { clientSecret } = cafe24AppConfig();
  return clientSecret ? createHmac("sha256", clientSecret).update("picksfolio-cafe24-app-launch-v1").digest() : null;
};

export function signLaunch(mallId: string): string {
  const key = launchKey();
  if (!key) return "";
  const body = Buffer.from(JSON.stringify({ m: mallId, e: Date.now() + LAUNCH_TTL_MS })).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

export function verifyLaunch(token: string): string {
  const key = launchKey();
  const [body, mac] = String(token || "").split(".");
  if (!key || !body || !mac) return "";
  if (!safeEqual(mac, createHmac("sha256", key).update(body).digest("base64url"))) return "";
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!(Number(payload?.e) > Date.now())) return "";
    return cleanMallId(payload?.m);
  } catch {
    return "";
  }
}

// ── 토큰 교환 · 저장 ─────────────────────────────────────────────────────────

export type ExchangeResult = { ok: true; tokens: Cafe24TokenSet } | { ok: false; code: string };

/** 인증코드(1분 유효 · 1회용) → 토큰. redirect_uri 는 동의 요청 때와 같은 값이어야 한다. */
export async function exchangeCode(mallId: string, code: string): Promise<ExchangeResult> {
  const { redirectUri, clientId } = cafe24AppConfig();
  const res = await postOAuth(mallId, "token", { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (res.status !== 200) {
    console.warn(`[cafe24-oauth] token exchange → ${res.status || "network"} (mall ${mallId})`);
    return { ok: false, code: isGrantFailure(res) ? "invalid_grant" : "token_failed" };
  }
  const tokens = parseTokenResponse(res.json);
  if (!tokens) return { ok: false, code: "token_failed" };
  // 응답의 몰이 state 에 묶인 몰과 다르면 받지 않는다.
  if (tokens.mallId !== mallId) {
    await revokeToken(tokens.mallId || mallId, tokens.accessToken);
    return { ok: false, code: "mall_mismatch" };
  }
  if (tokens.clientId && clientId && tokens.clientId !== clientId) {
    await revokeToken(mallId, tokens.accessToken);
    return { ok: false, code: "token_failed" };
  }
  return { ok: true, tokens };
}

/** 토큰 폐기. 액세스 토큰을 폐기하면 짝인 refresh token 도 함께 폐기된다. */
export async function revokeToken(mallId: string, token: string, hint: "access_token" | "refresh_token" = "access_token") {
  if (!token || !cleanMallId(mallId)) return false;
  const res = await postOAuth(mallId, "revoke", { token, token_hint: hint });
  if (res.status !== 200) console.warn(`[cafe24-oauth] revoke → ${res.status || "network"} (mall ${mallId})`);
  return res.status === 200;
}

/**
 * 연결을 저장한다(몰 하나당 한 행). 다른 브랜드가 쓰고 있는(active) 몰이면 덮어쓰지 않는다 —
 * 그 브랜드의 판매 캠페인이 이 연결로 주문을 검증하고 있다.
 */
export async function saveConnection(
  db: any,
  business: string,
  tokens: Cafe24TokenSet,
): Promise<{ ok: true; conn: Cafe24Connection } | { ok: false; code: "mall_taken" }> {
  const mall = tokens.mallId;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '20s'");
    const existing = (await client.query(
      "SELECT business_username, status FROM cafe24_connections WHERE mall_id = $1 FOR UPDATE",
      [mall],
    )).rows[0];
    if (existing && norm(existing.business_username) !== business && existing.status === "active") {
      await client.query("ROLLBACK");
      return { ok: false, code: "mall_taken" };
    }
    const row = (await client.query(
      `INSERT INTO cafe24_connections
         (business_username, mall_id, user_id, shop_no, access_token, refresh_token,
          access_token_expires_at, refresh_token_expires_at, scopes, issued_at, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()), 'active', NOW())
       ON CONFLICT (mall_id) DO UPDATE SET
         business_username = EXCLUDED.business_username, user_id = EXCLUDED.user_id, shop_no = EXCLUDED.shop_no,
         access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
         scopes = EXCLUDED.scopes, issued_at = EXCLUDED.issued_at, status = 'active', updated_at = NOW()
       RETURNING to_jsonb(cafe24_connections) AS row`,
      [
        business,
        mall,
        tokens.userId,
        tokens.shopNo,
        encryptToken(tokens.accessToken, mall),
        encryptToken(tokens.refreshToken, mall),
        tokens.accessExpiresAt.toISOString(),
        tokens.refreshExpiresAt.toISOString(),
        tokens.scopes,
        tokens.issuedAt ? tokens.issuedAt.toISOString() : null,
      ],
    )).rows[0];
    await client.query("COMMIT");
    const conn = connectionFromRow(row?.row);
    if (!conn) throw new Error("connection row unreadable");
    return { ok: true, conn };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 연동 시작 전 확인: 다른 브랜드가 쓰고 있는 몰인지, 이 브랜드가 이미 문제없이 연결했는지. */
export async function connectionOwnership(db: any, business: string, mallId: string) {
  const conn = await connectionForMall(db, mallId);
  if (!conn) return { takenByOther: false, healthy: false };
  const health = connectionHealth(conn);
  return {
    takenByOther: conn.active && !!conn.businessUsername && conn.businessUsername !== business,
    healthy: conn.businessUsername === business && health.usable && health.missingScopes.length === 0,
  };
}

// ── 추적 스크립트 ────────────────────────────────────────────────────────────

/** api-shop-connection 과 같은 주소 · 같은 표(affiliate_shop_scripts)를 쓴다. */
const scriptPrefix = () => `${publicOrigin()}/t/pf.js`;
const scriptSrc = (mallId: string) => `${scriptPrefix()}?m=${encodeURIComponent(mallId)}`;

/** installed: 'now' 설치 시각 기록 · 'keep' 그대로 · 'clear' 지움 */
async function saveScript(
  db: any, mallId: string, business: string, mode: string, scriptNo: string, error: string,
  installed: "now" | "keep" | "clear",
) {
  const at = installed === "now" ? new Date().toISOString() : null;
  const keep = installed === "keep";
  await db.sql`
    INSERT INTO affiliate_shop_scripts (shop_type, mall_id, business_username, mode, script_no, installed_at, last_error, updated_at)
    VALUES ('cafe24', ${mallId}, ${business}, ${mode}, ${scriptNo}, ${at}, ${error}, NOW())
    ON CONFLICT (shop_type, mall_id) DO UPDATE SET
      business_username = EXCLUDED.business_username, mode = EXCLUDED.mode, script_no = EXCLUDED.script_no,
      installed_at = CASE WHEN ${keep} THEN affiliate_shop_scripts.installed_at ELSE EXCLUDED.installed_at END,
      last_error = EXCLUDED.last_error, updated_at = NOW()
  `;
}

/**
 * 연동 직후 ScriptTags 로 추적 스크립트를 심는다. 브랜드가 직접 붙였다고 표시한 몰(manual)은
 * 건드리지 않는다. 이미 심어 둔 것이 몰에 남아 있으면 다시 심지 않는다(두 번 돌면 신호도 두 번 간다).
 * 실패해도 연동은 성공으로 두고, 쇼핑몰 연동 화면에 사유와 수동 설치 코드를 보인다.
 */
export async function autoInstallScript(db: any, conn: Cafe24Connection, business: string): Promise<"installed" | "kept" | "skipped" | "failed"> {
  try {
    const existing = ((await db.sql`
      SELECT * FROM affiliate_shop_scripts WHERE shop_type = 'cafe24' AND mall_id = ${conn.mallId}
    `) as any[])[0];
    if (existing?.mode === "manual") return "skipped";
    if (!conn.scopes.includes("mall.write_application")) {
      await saveScript(db, conn.mallId, business, "none", "", "앱 권한(mall.write_application)이 없어 자동 설치하지 못했습니다. 재연동하거나 아래 코드를 직접 붙여 주세요.", "clear");
      return "failed";
    }
    const found = await findScriptTag(conn, scriptPrefix());
    if (found) {
      await saveScript(db, conn.mallId, business, "auto", found, "", existing?.installed_at ? "keep" : "now");
      return "kept";
    }
    const scriptNo = await installScriptTag(conn, scriptSrc(conn.mallId));
    await saveScript(db, conn.mallId, business, "auto", scriptNo, "", "now");
    return "installed";
  } catch (e: any) {
    const status = Number(e?.status || 0);
    console.warn(`[cafe24-oauth] script auto-install failed → ${status || "error"} (mall ${conn.mallId})`);
    await saveScript(
      db, conn.mallId, business, "none", "",
      status === 403
        ? "앱 권한(mall.write_application)이 없어 자동 설치하지 못했습니다. 재연동하거나 아래 코드를 직접 붙여 주세요."
        : "자동 설치에 실패했습니다. 아래 코드를 쇼핑몰 공통 영역에 직접 붙여 주세요.",
      "clear",
    ).catch(() => {});
    return "failed";
  }
}

// ── 연동 해제 ───────────────────────────────────────────────────────────────

/**
 * 연동 해제: ① ScriptTags 로 심은 추적 스크립트 제거 → ② 액세스 토큰 폐기(짝인 refresh
 * token 도 폐기된다) → ③ status='revoked', 토큰 값 삭제.
 *
 * ②③은 행을 잠근 채 한다. 그 사이 갱신이 끼어들어 새 토큰을 써 넣으면, 폐기하지 않은
 * 토큰이 남는다. ①은 API 호출 중 토큰 갱신(같은 행 잠금)이 일어날 수 있어 잠금 밖에서 한다.
 */
export async function disconnectConnection(
  db: any,
  conn: Cafe24Connection,
  business: string,
): Promise<{ scriptRemoved: boolean; revoked: boolean }> {
  let scriptRemoved = true;
  const script = ((await db.sql`
    SELECT * FROM affiliate_shop_scripts WHERE shop_type = 'cafe24' AND mall_id = ${conn.mallId}
  `) as any[])[0];
  if (connectionHealth(conn).usable) {
    try {
      const current = (script?.mode === "auto" && String(script?.script_no || "")) || (await findScriptTag(conn, scriptPrefix()));
      if (current) await removeScriptTag(conn, current);
    } catch (e: any) {
      scriptRemoved = false;
      console.warn(`[cafe24-oauth] script removal on disconnect failed → ${Number(e?.status || 0) || "error"} (mall ${conn.mallId})`);
    }
  } else if (script?.mode === "auto") {
    scriptRemoved = false;
  }

  let revoked = false;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '20s'");
    const row = (await client.query(
      "SELECT access_token, refresh_token, access_token_expires_at FROM cafe24_connections WHERE mall_id = $1 FOR UPDATE",
      [conn.mallId],
    )).rows[0];
    if (row) {
      const access = decryptToken(row.access_token, conn.mallId);
      const accessAlive = access && row.access_token_expires_at && new Date(row.access_token_expires_at).getTime() > Date.now();
      revoked = accessAlive
        ? await revokeToken(conn.mallId, access, "access_token")
        : await revokeToken(conn.mallId, decryptToken(row.refresh_token, conn.mallId), "refresh_token");
      await client.query(
        `UPDATE cafe24_connections
         SET status = 'revoked', access_token = '', refresh_token = '', updated_at = NOW()
         WHERE mall_id = $1`,
        [conn.mallId],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  await saveScript(
    db, conn.mallId, business, scriptRemoved ? "none" : String(script?.mode || "none"),
    scriptRemoved ? "" : String(script?.script_no || ""),
    scriptRemoved ? "" : "연동을 해제했지만 추적 스크립트를 지우지 못했습니다. 카페24 관리자에서 직접 삭제해 주세요.",
    scriptRemoved ? "clear" : "keep",
  ).catch(() => {});
  return { scriptRemoved, revoked };
}
