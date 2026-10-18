/**
 * 카페24 Admin API 호출부.
 *
 * 몰 연결(OAuth · 토큰 저장 · 자동 갱신)은 별도 연동 작업이 `cafe24_connections` 에
 * 갖는다. 이 파일은 그 행을 읽어 쓰기만 한다 — 토큰을 새로 받거나 갱신하지 않는다.
 * 갱신까지 여기서 하면 두 곳이 같은 refresh token 을 동시에 쓰게 되고, 카페24 는
 * refresh token 을 한 번 쓰면 바꿔 주므로 한쪽의 토큰이 곧바로 무효가 된다.
 *
 * 연결 표의 컬럼 이름은 그 작업이 정한다. 그래서 행을 JSON 으로 읽고 흔히 쓰는 이름
 * 몇 가지를 차례로 본다(connectionFromRow). 이름이 확정되면 그 함수만 고치면 된다.
 * 표가 아직 없는 환경(연동 작업 배포 전)에서는 "미연결"로 처리하고 오류를 올리지 않는다.
 *
 * 로그 원칙: 토큰·응답 원문·고객 정보는 남기지 않는다. 실패 시 상태 코드와 경로만 남긴다.
 */

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
  scopes: string[];
  active: boolean;
  shopName: string;
  shopDomain: string;
};

const norm = (raw: unknown) => String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

const pick = (row: Record<string, any>, keys: string[]): any => {
  for (const k of keys) {
    const v = row?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

function parseScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(/[\s,]+/).filter(Boolean);
  return [];
}

export function connectionFromRow(row: Record<string, any> | null | undefined): Cafe24Connection | null {
  if (!row) return null;
  const mallId = String(pick(row, ["mall_id", "mallid", "mall"]) || "").trim();
  if (!mallId) return null;
  const expiresRaw = pick(row, ["access_token_expires_at", "expires_at", "token_expires_at"]);
  const expiresAt = expiresRaw ? Date.parse(String(expiresRaw)) : NaN;
  const status = String(pick(row, ["status", "state"]) || "active").toLowerCase();
  const revoked = Boolean(pick(row, ["revoked_at", "disconnected_at", "deleted_at"]));
  return {
    mallId,
    businessUsername: norm(pick(row, ["business_username", "username", "owner_username"])),
    accessToken: String(pick(row, ["access_token", "token"]) || ""),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    scopes: parseScopes(pick(row, ["scopes", "scope"])),
    active: !revoked && !["revoked", "disconnected", "inactive", "error", "expired"].includes(status),
    shopName: String(pick(row, ["shop_name", "mall_name", "store_name"]) || ""),
    shopDomain: String(pick(row, ["primary_domain", "shop_domain", "domain", "base_domain"]) || ""),
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
  // 갱신은 연동 작업이 한다. 만료된 토큰을 그대로 쓰면 401 이 되므로 "재연동 필요"로 본다.
  if (conn.expiresAt && conn.expiresAt < Date.now()) return { usable: false, missingScopes, reason: "token_expired" };
  return { usable: true, missingScopes, reason: "" };
}

export class Cafe24Error extends Error {
  constructor(public status: number, public path: string) {
    super(`cafe24 ${status} ${path}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Admin API 호출. 호출 한도(초당 2회 회복, 버킷 40)를 넘기면 429 가 오므로 간격을
 * 늘려 두 번까지 다시 시도한다.
 */
export async function cafe24Request(
  conn: Cafe24Connection,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<any> {
  const url = `https://${conn.mallId}.cafe24api.com/api/v2/admin${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 8000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method || "GET",
        headers: {
          Authorization: `Bearer ${conn.accessToken}`,
          "Content-Type": "application/json",
          "X-Cafe24-Api-Version": API_VERSION,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 && attempt < 2) {
      await sleep(600 * 2 ** attempt);
      continue;
    }
    if (!res.ok) {
      // 응답 본문에는 몰 정보가 섞일 수 있어 남기지 않는다.
      console.warn(`[cafe24] ${init.method || "GET"} ${path.split("?")[0]} → ${res.status} (mall ${conn.mallId})`);
      throw new Cafe24Error(res.status, path.split("?")[0]);
    }
    return await res.json().catch(() => ({}));
  }
  throw new Cafe24Error(429, path.split("?")[0]);
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

export async function installScriptTag(conn: Cafe24Connection, src: string): Promise<string> {
  const json = await cafe24Request(conn, "/scripttags", {
    method: "POST",
    body: { shop_no: 1, request: { src, display_location: ["all"] } },
  });
  return String(json?.scripttag?.script_no || "");
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
