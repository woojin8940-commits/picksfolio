/**
 * 카페24 Admin API 호출부.
 *
 * 몰 연결은 연동 흐름(cafe24-oauth-start → cafe24-callback, _shared/cafe24-oauth.mts)이
 * `cafe24_connections` 에 만든다. 이 파일은 그 행을 읽어 API 를 부르고, **토큰 갱신은
 * 이 파일 한 곳에서만** 한다(refreshConnection). 카페24 는 refresh token 을 한 번 쓰면
 * 바꿔 주고 이전 것을 바로 폐기하므로, 두 곳이 같은 refresh token 을 쓰면 한쪽 토큰이
 * 곧바로 무효가 된다. 같은 몰의 갱신은 행 잠금(SELECT … FOR UPDATE)으로 줄을 세우고,
 * 잠금을 기다린 요청은 앞 요청이 바꿔 둔 토큰을 다시 읽어 쓴다.
 *
 * 토큰은 암호화돼 저장된다(_shared/cafe24-credentials.mts). 행을 읽을 때 푼다.
 * 표가 아직 없는 환경(마이그레이션 전)에서는 "미연결"로 처리하고 오류를 올리지 않는다.
 *
 * 로그 원칙: 토큰·응답 원문·고객 정보는 남기지 않는다. 실패 시 상태 코드 · 경로와, 카페24 오류
 * 응답의 error.code · error.message(일반 안내 문구라 몰·고객 정보가 없다)만 남긴다.
 */
import { getDatabase } from "@picks/netlify-database";
import {
  decryptToken,
  encryptToken,
  isGrantFailure,
  parseScopeList,
  parseTokenResponse,
  postOAuth,
  tokenKeyReady,
} from "./cafe24-credentials.mts";

export const CAFE24_REQUIRED_SCOPES = [
  "mall.read_order",
  "mall.read_product",
  "mall.read_store",
  "mall.read_application",
  "mall.write_application",
];

const API_VERSION = process.env.CAFE24_API_VERSION || "2026-09-01";

export type Cafe24Connection = {
  mallId: string;
  businessUsername: string;
  accessToken: string;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
  scopes: string[];
  status: "active" | "expired" | "revoked";
  active: boolean;
  shopNo: string;
  shopName: string;
  shopDomain: string;
};

const norm = (raw: unknown) => String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

const time = (raw: unknown): number | null => {
  const t = raw ? Date.parse(String(raw)) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** `cafe24_connections` 행(to_jsonb) → 연결. 토큰은 여기서 복호화한다. */
export function connectionFromRow(row: Record<string, any> | null | undefined): Cafe24Connection | null {
  if (!row) return null;
  const mallId = String(row.mall_id || "").trim().toLowerCase();
  if (!mallId) return null;
  const raw = String(row.status || "active").toLowerCase();
  const status = raw === "expired" || raw === "revoked" ? raw : "active";
  return {
    mallId,
    businessUsername: norm(row.business_username),
    accessToken: decryptToken(row.access_token, mallId),
    expiresAt: time(row.access_token_expires_at),
    refreshExpiresAt: time(row.refresh_token_expires_at),
    scopes: parseScopeList(row.scopes),
    status,
    active: status === "active",
    shopNo: String(row.shop_no || "1"),
    shopName: "",
    shopDomain: "",
  };
}

/** 브랜드 계정의 카페24 연결들. 표가 없으면 빈 목록. */
export async function connectionsForBusiness(db: any, businessUsername: string): Promise<Cafe24Connection[]> {
  const who = norm(businessUsername);
  if (!who) return [];
  try {
    const rows = (await db.sql`
      SELECT to_jsonb(c) AS row FROM cafe24_connections c
      WHERE LOWER(REGEXP_REPLACE(COALESCE(
        to_jsonb(c)->>'business_username', to_jsonb(c)->>'username', to_jsonb(c)->>'owner_username', ''
      ), '^biz/', '')) = ${who}
    `) as any[];
    return rows.map((r) => connectionFromRow(r.row)).filter((c): c is Cafe24Connection => !!c);
  } catch {
    return [];
  }
}

/** 몰 아이디로 연결을 찾는다(주문 수신·동기화용). */
export async function connectionForMall(db: any, mallId: string): Promise<Cafe24Connection | null> {
  const mall = String(mallId || "").trim().toLowerCase();
  if (!mall) return null;
  try {
    const rows = (await db.sql`
      SELECT to_jsonb(c) AS row FROM cafe24_connections c
      WHERE LOWER(COALESCE(to_jsonb(c)->>'mall_id', to_jsonb(c)->>'mallid', to_jsonb(c)->>'mall', '')) = ${mall}
      LIMIT 1
    `) as any[];
    return connectionFromRow(rows[0]?.row);
  } catch {
    return null;
  }
}

/** 연결이 지금 API 를 부를 수 있는 상태인지. 아니면 그 이유. */
export function connectionHealth(conn: Cafe24Connection | null): { usable: boolean; missingScopes: string[]; reason: string } {
  if (!conn) return { usable: false, missingScopes: [], reason: "not_connected" };
  const missingScopes = conn.scopes.length
    ? CAFE24_REQUIRED_SCOPES.filter((s) => !conn.scopes.includes(s))
    : [];
  if (!conn.active || !conn.accessToken) return { usable: false, missingScopes, reason: "reconnect" };
  // 액세스 토큰 만료는 호출 직전에 갱신된다(cafe24Request). 리프레시 토큰까지 지나면 재연동뿐이다.
  if (conn.refreshExpiresAt && conn.refreshExpiresAt < Date.now()) return { usable: false, missingScopes, reason: "token_expired" };
  return { usable: true, missingScopes, reason: "" };
}

export class Cafe24Error extends Error {
  /** true 면 갱신까지 실패했다 — 브랜드가 다시 연동해야 한다. */
  public reconnect: boolean;
  /** 카페24 오류 응답의 error.code · error.message. 응답이 없었으면 code 가 timeout · network 다. */
  public apiCode: string;
  public apiMessage: string;
  constructor(
    public status: number,
    public path: string,
    reconnect = false,
    detail: { code?: string; message?: string } = {},
  ) {
    super(`cafe24 ${status} ${path}`);
    this.reconnect = reconnect;
    this.apiCode = detail.code || "";
    this.apiMessage = detail.message || "";
  }
}

/** 로그 · 화면에 남길 오류 문구. 혹시 섞여 온 토큰 모양 문자열은 지우고 짧게 자른다. */
const clipDetail = (v: unknown) =>
  String(v ?? "")
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/[A-Za-z0-9_\-]{32,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** 실패 응답 본문 → { code, message }. 본문 원문은 돌려주지 않는다. */
async function readApiError(res: Response): Promise<{ code: string; message: string }> {
  const json = await res.json().catch(() => null);
  const err = json?.error && typeof json.error === "object" ? json.error : {};
  return { code: clipDetail(err.code), message: clipDetail(err.message) };
}

const describeApiError = (d: { code: string; message: string }) =>
  d.code || d.message ? ` error.code=${d.code || "-"} error.message="${d.message}"` : "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 토큰 갱신 ───────────────────────────────────────────────────────────────

/** 액세스 토큰이 이 시간 안에 만료되면 호출 전에 미리 갱신한다. */
const REFRESH_AHEAD_MS = 5 * 60 * 1000;

export type RefreshOutcome =
  | { ok: true; conn: Cafe24Connection; refreshed: boolean }
  | { ok: false; reason: "not_connected" | "reconnect" | "unavailable" };

/**
 * 몰 하나의 토큰을 갱신한다. 이 함수 밖에서는 refresh token 을 쓰지 않는다.
 *
 * 행을 FOR UPDATE 로 잠근 뒤 `needsRefresh` 를 **잠금 안에서 다시** 본다. 잠금을 기다리는
 * 동안 앞선 요청이 이미 갱신했다면 여기서 false 가 되고, 새로 읽은 토큰을 그대로 돌려준다.
 * 카페24 응답의 새 access/refresh token · 만료 시각은 같은 트랜잭션 안에서 교체 저장한다.
 *
 * 갱신 거부(invalid_grant) · 리프레시 만료면 status='expired' 로 바꾸고 재연동을 요구한다.
 * 네트워크 · 5xx 같은 일시 오류는 상태를 바꾸지 않는다(다음 호출에서 다시 시도).
 */
export async function refreshConnection(
  mallId: string,
  needsRefresh: (current: Cafe24Connection) => boolean,
  db: any = getDatabase(),
): Promise<RefreshOutcome> {
  const mall = String(mallId || "").trim().toLowerCase();
  if (!mall) return { ok: false, reason: "not_connected" };
  const client = await db.pool.connect();
  let finished = false;
  const end = async (sql: "COMMIT" | "ROLLBACK") => {
    finished = true;
    await client.query(sql).catch(() => {});
  };
  try {
    await client.query("BEGIN");
    // 다른 요청이 카페24 응답을 기다리며 잠금을 쥐고 있을 수 있다. 무한정 기다리지 않는다.
    await client.query("SET LOCAL lock_timeout = '20s'");
    const row = (await client.query(
      "SELECT to_jsonb(c) AS row, c.refresh_token FROM cafe24_connections c WHERE c.mall_id = $1 FOR UPDATE",
      [mall],
    )).rows[0];
    const current = connectionFromRow(row?.row);
    if (!current) {
      await end("ROLLBACK");
      return { ok: false, reason: "not_connected" };
    }
    if (!current.active) {
      await end("ROLLBACK");
      return { ok: false, reason: "reconnect" };
    }
    if (!needsRefresh(current)) {
      await end("COMMIT");
      return { ok: true, conn: current, refreshed: false };
    }
    // 키가 빠진 배포에서는 토큰을 풀 수도 새로 저장할 수도 없다. 연결을 만료시키지 않는다.
    if (!tokenKeyReady()) {
      await end("ROLLBACK");
      console.error("[cafe24] AFFILIATE_PII_KEY 미설정 — 토큰을 갱신하지 않는다");
      return { ok: false, reason: "unavailable" };
    }

    const markExpired = async (why: string) => {
      await client.query(
        "UPDATE cafe24_connections SET status = 'expired', updated_at = NOW() WHERE mall_id = $1",
        [mall],
      );
      await end("COMMIT");
      console.warn(`[cafe24] token refresh failed (${why}) — mall ${mall} marked expired`);
      return { ok: false as const, reason: "reconnect" as const };
    };

    const refreshToken = decryptToken(row.refresh_token, mall);
    if (!refreshToken) return await markExpired("no_refresh_token");
    if (current.refreshExpiresAt && current.refreshExpiresAt <= Date.now()) return await markExpired("refresh_expired");

    const res = await postOAuth(mall, "token", { grant_type: "refresh_token", refresh_token: refreshToken });
    const tokens = res.status === 200 ? parseTokenResponse(res.json) : null;
    if (!tokens || (tokens.mallId && tokens.mallId !== mall)) {
      if (res.status !== 200 && isGrantFailure(res)) return await markExpired(`status_${res.status}`);
      await end("ROLLBACK");
      console.warn(`[cafe24] token refresh → ${res.status || "network"} (mall ${mall})`);
      return { ok: false, reason: "unavailable" };
    }

    const scopes = tokens.scopes.length ? tokens.scopes : current.scopes;
    const updated = (await client.query(
      `UPDATE cafe24_connections SET
         access_token = $2, refresh_token = $3,
         access_token_expires_at = $4, refresh_token_expires_at = $5,
         scopes = $6, issued_at = COALESCE($7, NOW()), status = 'active', updated_at = NOW()
       WHERE mall_id = $1
       RETURNING to_jsonb(cafe24_connections) AS row`,
      [
        mall,
        encryptToken(tokens.accessToken, mall),
        encryptToken(tokens.refreshToken, mall),
        tokens.accessExpiresAt.toISOString(),
        tokens.refreshExpiresAt.toISOString(),
        scopes,
        tokens.issuedAt ? tokens.issuedAt.toISOString() : null,
      ],
    )).rows[0];
    await end("COMMIT");
    const conn = connectionFromRow(updated?.row);
    return conn ? { ok: true, conn, refreshed: true } : { ok: false, reason: "unavailable" };
  } catch (e) {
    if (!finished) await client.query("ROLLBACK").catch(() => {});
    console.warn(`[cafe24] token refresh error (mall ${mall}):`, e instanceof Error ? e.name : "error");
    return { ok: false, reason: "unavailable" };
  } finally {
    client.release();
  }
}

/** 갱신된 값을 호출부가 쥐고 있는 연결 객체에 반영한다(이후 호출도 새 토큰을 쓰게). */
const adopt = (conn: Cafe24Connection, fresh: Cafe24Connection) =>
  Object.assign(conn, {
    accessToken: fresh.accessToken,
    expiresAt: fresh.expiresAt,
    refreshExpiresAt: fresh.refreshExpiresAt,
    scopes: fresh.scopes,
    status: fresh.status,
    active: fresh.active,
  });

/** 호출 전: 액세스 토큰이 5분 안에 만료되면 갱신한다. */
async function ensureFreshToken(conn: Cafe24Connection, path: string): Promise<void> {
  const dueSoon = (c: Cafe24Connection) => !c.accessToken || !c.expiresAt || c.expiresAt - Date.now() <= REFRESH_AHEAD_MS;
  if (!dueSoon(conn)) return;
  const out = await refreshConnection(conn.mallId, dueSoon);
  if (out.ok) {
    adopt(conn, out.conn);
    return;
  }
  if (out.reason === "unavailable" && conn.accessToken && conn.expiresAt && conn.expiresAt > Date.now()) return;
  conn.active = false;
  throw new Cafe24Error(401, path, true);
}

/** 401 을 받은 뒤: 그 토큰이 아직 저장돼 있는 토큰일 때만 갱신한다(다른 요청이 이미 바꿨으면 그걸 쓴다). */
async function refreshAfterUnauthorized(conn: Cafe24Connection, stale: string): Promise<boolean> {
  const out = await refreshConnection(conn.mallId, (c) => c.accessToken === stale);
  if (!out.ok) return false;
  adopt(conn, out.conn);
  return out.conn.accessToken !== stale;
}

/**
 * Admin API 호출. 호출 한도(초당 2회 회복, 버킷 40)를 넘기면 429 가 오므로 간격을
 * 늘려 두 번까지 다시 시도한다. 401 이면 토큰을 한 번 갱신해 다시 부르고, 그래도
 * 안 되면 재연동이 필요한 오류(reconnect)로 올린다.
 */
export async function cafe24Request(
  conn: Cafe24Connection,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<any> {
  const cleanPath = path.split("?")[0];
  const method = init.method || "GET";
  const url = `https://${conn.mallId}.cafe24api.com/api/v2/admin${path}`;
  await ensureFreshToken(conn, cleanPath);
  let retried401 = false;
  for (let attempt = 0; attempt < 3; ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 8000);
    const token = conn.accessToken;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Cafe24-Api-Version": API_VERSION,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch (e) {
      // 응답 자체가 없었다(시간 초과 · 네트워크). 상태 코드 0 으로 올려 화면이 사유를 알 수 있게 한다.
      const kind = e instanceof Error && e.name === "AbortError" ? "timeout" : "network";
      console.warn(`[cafe24] ${method} ${cleanPath} → ${kind} (mall ${conn.mallId})`);
      throw new Cafe24Error(0, cleanPath, false, { code: kind });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 && !retried401) {
      retried401 = true;
      if (await refreshAfterUnauthorized(conn, token)) continue;
      const detail = await readApiError(res);
      console.warn(`[cafe24] ${method} ${cleanPath} → 401, refresh failed (mall ${conn.mallId})${describeApiError(detail)}`);
      throw new Cafe24Error(401, cleanPath, true, detail);
    }
    if (res.status === 429 && attempt < 2) {
      await sleep(600 * 2 ** attempt);
      attempt++;
      continue;
    }
    if (!res.ok) {
      // 본문 원문은 남기지 않고 error.code · error.message 만 남긴다.
      const detail = await readApiError(res);
      console.warn(`[cafe24] ${method} ${cleanPath} → ${res.status} (mall ${conn.mallId})${describeApiError(detail)}`);
      throw new Cafe24Error(res.status, cleanPath, res.status === 401, detail);
    }
    return await res.json().catch(() => ({}));
  }
  throw new Cafe24Error(429, cleanPath);
}

// ── 상점 · 상품 ────────────────────────────────────────────────────────────

export async function fetchStoreDomain(conn: Cafe24Connection): Promise<{ name: string; domain: string }> {
  try {
    const json = await cafe24Request(conn, "/store");
    const store = json?.store || {};
    const domain = String(store.primary_domain || store.base_domain || conn.shopDomain || `${conn.mallId}.cafe24.com`)
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
    return { name: String(store.shop_name || store.mall_name || conn.shopName || conn.mallId), domain };
  } catch {
    return { name: conn.shopName || conn.mallId, domain: conn.shopDomain || `${conn.mallId}.cafe24.com` };
  }
}

export type Cafe24Product = {
  shopProductId: string;
  name: string;
  price: number;
  imageUrl: string;
  productUrl: string;
  selling: boolean;
  display: boolean;
};

export async function listProducts(
  conn: Cafe24Connection,
  opts: { q?: string; offset?: number; limit?: number },
): Promise<{ products: Cafe24Product[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit || 30, 1), 100);
  const params = new URLSearchParams({
    limit: String(limit + 1),
    offset: String(Math.max(0, opts.offset || 0)),
    fields: "product_no,product_name,price,list_image,detail_image,small_image,selling,display",
  });
  if (opts.q) params.set("product_name", opts.q.slice(0, 100));
  const [json, store] = await Promise.all([
    cafe24Request(conn, `/products?${params.toString()}`),
    fetchStoreDomain(conn),
  ]);
  const rows = Array.isArray(json?.products) ? json.products : [];
  const products = rows.slice(0, limit).map((p: any) => ({
    shopProductId: String(p.product_no),
    name: String(p.product_name || ""),
    price: Math.round(Number(p.price || 0)),
    imageUrl: String(p.list_image || p.detail_image || p.small_image || ""),
    productUrl: `https://${store.domain}/product/detail.html?product_no=${encodeURIComponent(String(p.product_no))}`,
    selling: p.selling !== "F",
    display: p.display !== "F",
  }));
  return { products, hasMore: rows.length > limit };
}

/**
 * 상품 번호로 직접 조회한다. 캠페인 등록 때 화면이 보낸 상품을 그대로 믿지 않고
 * 몰에 실제로 있는 상품인지, URL 이 그 몰의 상품 페이지인지 서버에서 다시 만든다 —
 * 추적 링크는 이 URL 로 리다이렉트하므로 남의 사이트 주소가 들어가면 안 된다.
 */
export async function fetchProductsByIds(conn: Cafe24Connection, ids: string[]): Promise<Cafe24Product[]> {
  const clean = Array.from(new Set(ids.map((s) => String(s).trim()).filter((s) => /^\d+$/.test(s)))).slice(0, 100);
  if (clean.length === 0) return [];
  const params = new URLSearchParams({
    product_no: clean.join(","),
    limit: String(clean.length),
    fields: "product_no,product_name,price,list_image,detail_image,small_image,selling,display",
  });
  const [json, store] = await Promise.all([cafe24Request(conn, `/products?${params.toString()}`), fetchStoreDomain(conn)]);
  return (Array.isArray(json?.products) ? json.products : []).map((p: any) => ({
    shopProductId: String(p.product_no),
    name: String(p.product_name || ""),
    price: Math.round(Number(p.price || 0)),
    imageUrl: String(p.list_image || p.detail_image || p.small_image || ""),
    productUrl: `https://${store.domain}/product/detail.html?product_no=${encodeURIComponent(String(p.product_no))}`,
    selling: p.selling !== "F",
    display: p.display !== "F",
  }));
}

// ── 스크립트(ScriptTags) ─────────────────────────────────────────────────────

/** 카페24에 넘기기 전에 본 스크립트 주소 문제. 카페24 오류와 구분해 "스크립트 주소 오류"로 보인다. */
export class ScriptSrcError extends Error {
  constructor(public problem: string) {
    super(`script src: ${problem}`);
  }
}

/**
 * 스크립트 주소가 https 절대 주소이고 밖에서 실제로 JS 로 열리는지 본다. 문제가 없으면 "".
 * 파일이 빠진 배포에서는 SPA catch-all 이 index.html 을 200 으로 돌려주므로 형식까지 본다.
 */
export async function checkScriptSrc(src: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return "절대 주소가 아닙니다";
  }
  if (url.protocol !== "https:") return "https 주소가 아닙니다";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return `주소가 HTTP ${res.status} 를 돌려줍니다`;
    const type = String(res.headers.get("content-type") || "");
    if (!/javascript|ecmascript/i.test(type)) return `JS 파일이 아닌 응답입니다(${type.split(";")[0] || "형식 없음"})`;
    return "";
  } catch {
    return "주소에 연결하지 못했습니다";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 몰 전체 페이지(display_location: all)에 스크립트를 심는다. 카페24 규격(2026-09-01):
 * shop_no + request.{ src(절대 주소), display_location(필수) }. skin_no 를 빼면 모든 스킨,
 * integrity(SRI)는 선택이라 보내지 않는다 — 파일이 바뀔 때마다 해시를 다시 등록해야 해서다.
 */
export async function installScriptTag(conn: Cafe24Connection, src: string): Promise<string> {
  const problem = await checkScriptSrc(src);
  if (problem) throw new ScriptSrcError(problem);
  const shopNo = Number(conn.shopNo) > 0 ? Number(conn.shopNo) : 1;
  const json = await cafe24Request(conn, "/scripttags", {
    method: "POST",
    body: { shop_no: shopNo, request: { src, display_location: ["all"] } },
  });
  const scriptNo = String(json?.scripttag?.script_no || "");
  if (!scriptNo) {
    console.warn(`[cafe24] POST /scripttags → ok but no script_no (mall ${conn.mallId})`);
    throw new Cafe24Error(200, "/scripttags", false, { code: "no_script_no", message: "응답에 script_no 가 없습니다" });
  }
  return scriptNo;
}

/**
 * 스크립트 설치 · 제거 실패 → 화면 문구. "[사유] 안내 (카페24 상태 · error.code · error.message)" 모양이다.
 * 화면은 대괄호 안을 사유 배지로 보인다. 카페24 오류는 cafe24Request 가 이미 로그를 남겼고,
 * 그 밖의 오류만 여기서 남긴다.
 */
export function scriptTagFailure(e: unknown, mallId: string, op: "install" | "remove" = "install"): string {
  const manual = op === "install"
    ? "아래 코드를 쇼핑몰 공통 영역에 직접 붙여 주세요."
    : "카페24 관리자 > 앱 > 스크립트 관리에서 직접 삭제해 주세요.";
  if (e instanceof ScriptSrcError) {
    console.warn(`[cafe24] script ${op} skipped — src check failed: ${e.problem} (mall ${mallId})`);
    return `[스크립트 주소 오류] 추적 스크립트 주소를 열 수 없습니다(${e.problem}). 잠시 후 다시 시도하거나 ${manual}`;
  }
  if (!(e instanceof Cafe24Error)) {
    const name = e instanceof Error ? e.name : "error";
    const msg = e instanceof Error ? clipDetail(e.message) : "";
    console.warn(`[cafe24] script ${op} failed — ${name}${msg ? `: ${msg}` : ""} (mall ${mallId})`);
    return `[내부 오류] 처리 중 오류가 났습니다. 잠시 후 다시 시도해 주세요. 계속되면 ${manual}`;
  }
  const parts = [e.status ? String(e.status) : "", e.apiCode === String(e.status) ? "" : e.apiCode, e.apiMessage].filter(Boolean);
  const detail = parts.length ? ` (카페24 ${parts.join(" · ")})` : "";
  const text = `${e.apiCode} ${e.apiMessage}`.toLowerCase();
  if (e.reconnect || e.status === 401) {
    return `[연동 만료] 카페24 연동이 만료되었습니다. 다시 연동한 뒤 설치해 주세요.${detail}`;
  }
  if (e.status === 403) {
    return `[권한 부족] 앱 권한(mall.write_application)이 없어 처리하지 못했습니다. 재연동하거나 ${manual}${detail}`;
  }
  if (e.status === 400 || e.status === 422) {
    if (/src|url|uri|domain|script/.test(text)) {
      return `[스크립트 주소 오류] 카페24가 스크립트 주소를 받아들이지 않았습니다. ${manual}${detail}`;
    }
    if (/display_location|location/.test(text)) {
      return `[표시 위치 오류] 카페24가 스크립트 표시 위치를 받아들이지 않았습니다. ${manual}${detail}`;
    }
    return `[요청 거부] 카페24가 설치 요청을 거부했습니다. ${manual}${detail}`;
  }
  if (e.status === 404) return `[대상 없음] 카페24에서 요청한 스크립트 · 쇼핑몰을 찾지 못했습니다. ${manual}${detail}`;
  if (e.status === 429) return `[요청 한도 초과] 카페24 호출이 잠시 막혔습니다. 1분 뒤 다시 시도해 주세요.${detail}`;
  if (e.status >= 500) return `[카페24 서버 오류] 카페24 쪽 일시 오류입니다. 잠시 후 다시 시도해 주세요.${detail}`;
  if (e.status === 0) return `[카페24 응답 없음] 카페24가 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.${detail}`;
  return `[설치 실패] 카페24 처리에 실패했습니다. ${manual}${detail}`;
}

export async function removeScriptTag(conn: Cafe24Connection, scriptNo: string): Promise<void> {
  if (!scriptNo) return;
  try {
    await cafe24Request(conn, `/scripttags/${encodeURIComponent(scriptNo)}`, { method: "DELETE" });
  } catch (e) {
    // 이미 지워졌으면 404 — 목표 상태와 같다.
    if (!(e instanceof Cafe24Error && e.status === 404)) throw e;
  }
}

/** 이 앱이 이미 심은 같은 스크립트가 있는지(중복 설치 방지). */
export async function findScriptTag(conn: Cafe24Connection, srcPrefix: string): Promise<string> {
  try {
    const json = await cafe24Request(conn, "/scripttags");
    const hit = (json?.scripttags || []).find((s: any) => String(s?.src || "").startsWith(srcPrefix));
    return hit ? String(hit.script_no || "") : "";
  } catch {
    return "";
  }
}

// ── 주문 ────────────────────────────────────────────────────────────────────

/**
 * 주문을 정산에 필요한 최소 모양으로 줄인다. 이름·연락처·주소·회원 아이디는 여기서
 * 버려지고 위로 올라가지 않는다.
 */
export type Cafe24OrderItem = {
  itemCode: string;
  productNo: string;
  quantity: number;
  /** 품목 실결제액(할인 후, 배송비 제외) */
  paidAmount: number;
  claimQuantity: number;
  /** N1 정상 · C1/C2 취소 · C3 반품 · E1 교환 */
  statusCode: string;
  orderStatus: string;
  purchaseConfirmedAt: string | null;
  deliveredAt: string | null;
};

export type Cafe24Order = {
  orderId: string;
  orderedAt: string | null;
  paid: boolean;
  canceled: boolean;
  items: Cafe24OrderItem[];
};

const amount = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

const dateOrNull = (v: unknown) => {
  const s = String(v || "").trim();
  return s && !s.startsWith("0000") ? s : null;
};

function shapeItem(it: any): Cafe24OrderItem {
  const quantity = Math.max(0, Math.trunc(Number(it?.quantity || 0)));
  // payment_amount 가 품목 실결제액이다. 없는 버전에서는 판매가에서 품목 할인을 뺀다.
  const fallback =
    (amount(it?.product_price) + amount(it?.option_price)) * quantity -
    amount(it?.additional_discount_price) -
    amount(it?.coupon_discount_price) -
    amount(it?.app_item_discount_amount);
  const paid = it?.payment_amount !== undefined && it?.payment_amount !== null ? amount(it.payment_amount) : fallback;
  return {
    itemCode: String(it?.order_item_code || it?.item_no || ""),
    productNo: String(it?.product_no || ""),
    quantity,
    paidAmount: Math.max(0, paid),
    claimQuantity: Math.max(0, Math.trunc(Number(it?.claim_quantity || 0))),
    statusCode: String(it?.status_code || ""),
    orderStatus: String(it?.order_status || ""),
    purchaseConfirmedAt: dateOrNull(it?.purchaseconfirmation_date),
    deliveredAt: dateOrNull(it?.delivered_date || it?.shipped_end_date),
  };
}

/** 주문 하나를 조회한다. 없으면 null(404). */
export async function fetchOrder(conn: Cafe24Connection, orderId: string): Promise<Cafe24Order | null> {
  try {
    const json = await cafe24Request(conn, `/orders/${encodeURIComponent(orderId)}?embed=items`);
    const o = json?.order;
    if (!o) return null;
    return {
      orderId: String(o.order_id || orderId),
      orderedAt: dateOrNull(o.order_date),
      paid: o.paid === "T" || o.paid === true,
      canceled: o.canceled === "T",
      items: (Array.isArray(o.items) ? o.items : []).map(shapeItem),
    };
  } catch (e) {
    if (e instanceof Cafe24Error && e.status === 404) return null;
    throw e;
  }
}
