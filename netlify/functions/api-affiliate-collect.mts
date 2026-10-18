import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";
import { connectionForMall } from "./_shared/cafe24-api.mts";
import { maskOrderNo, newId, norm, syncOrder } from "./_shared/affiliate.mts";

/**
 * 주문 신호 수신 — 브랜드 몰의 추적 스크립트(/t/pf.js)가 주문완료 페이지에서 보낸다.
 *
 *   POST /api/affiliate/collect  { m: mallId, o: orderId, a: amount, c: code }
 *
 * 스크립트가 보낸 값은 믿지 않는다. 여기서 하는 일은 셋뿐이다.
 *   1) 코드가 그 몰 캠페인의 링크인지 확인하고 주문을 "미검증"으로 장부에 넣는다.
 *      같은 주문번호는 UNIQUE 제약으로 한 번만 들어간다(중복 수신 무시).
 *   2) 곧바로 카페24 주문 API 로 조회해 실제 결제 · 품목 · 상태를 확인한다(syncOrder).
 *      확인된 주문만 금액이 붙고 정산 대상이 된다. 조회가 실패하면 미검증으로 두고
 *      매일 동기화에서 다시 시도한다.
 *   3) 스크립트 수신 시각을 남겨 브랜드 연동 화면의 "최근 24시간 수신" 에 쓴다.
 *
 * 브라우저가 sendBeacon 으로 보내므로 본문은 text/plain 일 수 있다(프리플라이트 회피).
 * 응답은 늘 짧게 — 고객 화면을 붙잡지 않는다. 로그에 주문번호 전체를 남기지 않는다.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const done = (status = 204) => new Response(null, { status, headers: CORS });

export default async (req: Request) => {
  if (req.method === "OPTIONS") return done(204);
  if (req.method !== "POST") return done(405);

  const limited = await checkRateLimit({ bucket: "affiliate-collect", key: clientIp(req), limit: 30, windowSeconds: 60 });
  if (!limited.ok) return done(429);

  let body: any = {};
  try {
    body = JSON.parse((await req.text()).slice(0, 2000));
  } catch {
    return done(400);
  }
  const mallId = String(body?.m || "").trim().toLowerCase();
  const orderId = String(body?.o || "").trim();
  const code = String(body?.c || "").trim().toLowerCase();
  const reported = Math.max(0, Math.round(Number(body?.a || 0))) || 0;
  if (!/^[a-z0-9_-]{2,40}$/.test(mallId) || !/^[A-Za-z0-9-]{4,40}$/.test(orderId) || !/^[a-z0-9]{6,20}$/.test(code)) {
    return done(400);
  }

  const db = getDatabase();
  try {
    const link = ((await db.sql`
      SELECT l.code, l.campaign_id, l.influencer_username, c.business_username, c.mall_id, c.shop_type
      FROM affiliate_links l JOIN affiliate_campaigns c ON c.id = l.campaign_id
      WHERE l.code = ${code} AND c.deleted_at IS NULL
    `) as any[])[0];
    if (!link || String(link.mall_id).toLowerCase() !== mallId) return done(202);

    // 몰이 실제로 그 브랜드에 연동돼 있어야 한다. 연결 정보가 없으면 받지 않는다.
    const conn = await connectionForMall(db, mallId);
    if (!conn || (conn.businessUsername && conn.businessUsername !== norm(link.business_username))) return done(202);

    await db.sql`
      UPDATE affiliate_shop_scripts SET last_received_at = NOW(), updated_at = NOW()
      WHERE shop_type = 'cafe24' AND mall_id = ${link.mall_id}
    `;

    const inserted = (await db.sql`
      INSERT INTO affiliate_orders
        (id, shop_type, mall_id, shop_order_id, code, campaign_id, influencer_username, business_username, reported_amount)
      VALUES (${newId("afo")}, 'cafe24', ${link.mall_id}, ${orderId}, ${code}, ${link.campaign_id},
              ${link.influencer_username}, ${norm(link.business_username)}, ${reported})
      ON CONFLICT (shop_type, mall_id, shop_order_id) DO NOTHING
      RETURNING id
    `) as any[];
    if (!inserted[0]) return done(200); // 같은 주문번호 — 이미 받았다.

    const result = await syncOrder(db, inserted[0].id, { conn });
    console.log(
      `[affiliate-collect] mall ${mallId} order ${maskOrderNo(orderId)} → ${result.verification}/${result.status} (${result.reason})`,
    );
    return done(202);
  } catch (e) {
    console.error("[affiliate-collect] failed", e instanceof Error ? e.message : "");
    return done(202);
  }
};

export const config: Config = {
  path: "/api/affiliate/collect",
};
