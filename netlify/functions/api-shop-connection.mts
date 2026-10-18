import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import {
  type Cafe24Connection,
  connectionHealth,
  connectionsForBusiness,
  findScriptTag,
  installScriptTag,
  listProducts,
  removeScriptTag,
} from "./_shared/cafe24-api.mts";
import { TRACKING_NOTICE, jsonError, publicOrigin } from "./_shared/affiliate.mts";

/**
 * 브랜드 쇼핑몰 연동 상태와 추적 스크립트.
 *
 *   GET  /api/shop-connection                     연결 상태 · 스크립트 · 최근 24시간 수신
 *   POST /api/shop-connection { action, mallId }  install_script | remove_script | mark_manual
 *   GET  /api/shop-connection/products?mallId=&q=&offset=   카페24 상품 목록
 *
 * 몰 연결(OAuth)은 별도 연동 작업이 맡는다. 여기서는 그 연결로 상품을 읽고, 몰에
 * 추적 스크립트를 심고(ScriptTags, 전체 페이지), 주문 신호가 들어오고 있는지 보여 준다.
 * 스크립트가 심겨 있어도 신호가 0건이면 브랜드가 바로 알아챌 수 있어야 한다.
 */

const scriptSrc = (mallId: string) => `${publicOrigin()}/t/pf.js?m=${encodeURIComponent(mallId)}`;
const snippet = (mallId: string) => `<script async src="${scriptSrc(mallId)}"></script>`;
const CONNECT_URL = process.env.CAFE24_CONNECT_URL || "/api/cafe24-oauth-start";

async function statusFor(db: any, conn: Cafe24Connection, business: string) {
  const health = connectionHealth(conn);
  const [scriptRows, orderRows, clickRows] = await Promise.all([
    db.sql`SELECT * FROM affiliate_shop_scripts WHERE shop_type = 'cafe24' AND mall_id = ${conn.mallId}` as Promise<any[]>,
    db.sql`
      SELECT COUNT(*)::int AS n, MAX(received_at) AS last FROM affiliate_orders
      WHERE shop_type = 'cafe24' AND mall_id = ${conn.mallId} AND received_at > NOW() - INTERVAL '24 hours'
    ` as Promise<any[]>,
    db.sql`
      SELECT COUNT(*)::int AS n FROM affiliate_clicks k
      JOIN affiliate_campaigns c ON c.id = k.campaign_id
      WHERE c.mall_id = ${conn.mallId} AND c.business_username = ${business}
        AND k.counted AND k.clicked_at > NOW() - INTERVAL '24 hours'
    ` as Promise<any[]>,
  ]);
  const script = scriptRows[0];
  const lastReceived = script?.last_received_at || orderRows[0]?.last || null;
  return {
    shopType: "cafe24" as const,
    state: health.usable ? (health.missingScopes.length ? "reconnect" : "connected") : conn ? "reconnect" : "none",
    mallId: conn.mallId,
    shopName: conn.shopName || conn.mallId,
    shopDomain: conn.shopDomain || `${conn.mallId}.cafe24.com`,
    missingScopes: health.missingScopes,
    script: {
      mode: (script?.mode || "none") as "auto" | "manual" | "none",
      installedAt: script?.installed_at ? new Date(script.installed_at).toISOString() : null,
      lastError: String(script?.last_error || ""),
      snippet: snippet(conn.mallId),
    },
    received24h: Number(orderRows[0]?.n || 0),
    lastReceivedAt: lastReceived ? new Date(lastReceived).toISOString() : null,
    clicks24h: Number(clickRows[0]?.n || 0),
  };
}

const imwebPlaceholder = {
  shopType: "imweb" as const,
  state: "unavailable" as const,
  mallId: "",
  shopName: "아임웹",
  shopDomain: "",
  missingScopes: [],
  script: { mode: "none" as const, installedAt: null, lastError: "", snippet: "" },
  received24h: 0,
  lastReceivedAt: null,
  clicks24h: 0,
};

export default async (req: Request) => {
  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller.response;
  const business = caller.username;
  const db = getDatabase();
  const url = new URL(req.url);
  const conns = await connectionsForBusiness(db, business);

  if (req.method === "GET" && url.pathname.endsWith("/products")) {
    const mallId = String(url.searchParams.get("mallId") || "").trim().toLowerCase();
    const conn = conns.find((c) => c.mallId.toLowerCase() === mallId);
    if (!conn) return jsonError("연동된 쇼핑몰이 아닙니다.", 404);
    if (!connectionHealth(conn).usable) return jsonError("쇼핑몰 재연동이 필요합니다.", 409, { code: "RECONNECT" });
    try {
      const result = await listProducts(conn, {
        q: String(url.searchParams.get("q") || "").trim(),
        offset: Number(url.searchParams.get("offset") || 0),
      });
      return Response.json(result);
    } catch {
      return jsonError("쇼핑몰 상품을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
    }
  }

  if (req.method === "GET") {
    const connections = [];
    for (const c of conns) connections.push(await statusFor(db, c, business));
    if (connections.length === 0) {
      connections.push({ ...imwebPlaceholder, shopType: "cafe24" as const, state: "none" as const, shopName: "카페24" });
    }
    connections.push(imwebPlaceholder);
    return Response.json({ connections, cafe24ConnectUrl: CONNECT_URL, trackingNotice: TRACKING_NOTICE });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const mallId = String(body?.mallId || "").trim().toLowerCase();
    const conn = conns.find((c) => c.mallId.toLowerCase() === mallId);
    if (!conn) return jsonError("연동된 쇼핑몰이 아닙니다.", 404);
    const existing = ((await db.sql`
      SELECT * FROM affiliate_shop_scripts WHERE shop_type = 'cafe24' AND mall_id = ${conn.mallId}
    `) as any[])[0];

    const save = async (mode: string, scriptNo: string, error: string, installed: boolean) => {
      await db.sql`
        INSERT INTO affiliate_shop_scripts (shop_type, mall_id, business_username, mode, script_no, installed_at, last_error, updated_at)
        VALUES ('cafe24', ${conn.mallId}, ${business}, ${mode}, ${scriptNo}, ${installed ? new Date().toISOString() : null}, ${error}, NOW())
        ON CONFLICT (shop_type, mall_id) DO UPDATE SET
          business_username = EXCLUDED.business_username, mode = EXCLUDED.mode, script_no = EXCLUDED.script_no,
          installed_at = EXCLUDED.installed_at, last_error = EXCLUDED.last_error, updated_at = NOW()
      `;
    };

    if (action === "mark_manual") {
      await save("manual", String(existing?.script_no || ""), "", true);
    } else if (action === "install_script" || action === "remove_script") {
      if (!connectionHealth(conn).usable) return jsonError("쇼핑몰 재연동이 필요합니다.", 409, { code: "RECONNECT" });
      try {
        // 이미 심은 것이 있으면 지우고 다시 심는다(같은 스크립트가 두 번 돌면 신호가 두 번 간다).
        const prefix = `${publicOrigin()}/t/pf.js`;
        const current = String(existing?.script_no || "") || (await findScriptTag(conn, prefix));
        if (current) await removeScriptTag(conn, current);
        if (action === "install_script") {
          const scriptNo = await installScriptTag(conn, scriptSrc(conn.mallId));
          await save("auto", scriptNo, "", true);
        } else {
          await save("none", "", "", false);
        }
      } catch (e: any) {
        const status = Number(e?.status || 0);
        const message =
          status === 403
            ? "앱 권한(mall.write_application)이 없어 자동 설치하지 못했습니다. 재연동하거나 아래 코드를 직접 붙여 주세요."
            : "자동 설치에 실패했습니다. 아래 코드를 쇼핑몰 공통 영역에 직접 붙여 주세요.";
        await save(String(existing?.mode || "none"), String(existing?.script_no || ""), message, Boolean(existing?.installed_at));
      }
    } else {
      return jsonError("알 수 없는 요청입니다.");
    }
    return Response.json({ connection: await statusFor(db, conn, business) });
  }

  return jsonError("Method not allowed", 405);
};


export const config: Config = {
  path: ["/api/shop-connection", "/api/shop-connection/products"],
};
