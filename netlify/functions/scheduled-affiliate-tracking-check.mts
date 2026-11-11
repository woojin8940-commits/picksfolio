import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { logEvent, notify } from "./_shared/affiliate-store-orders.mts";
import { loadCompanyCodes, lookupTracking, resolveCompanyCode, trackingApiKey } from "./_shared/delivery-tracking.mts";

/**
 * 송장 배송 조회 자동 배송 완료(하루 한 번 · 한국 시간 오후 2시).
 *
 * 배송 중(shipped)인 어필리에이트 주문의 송장을 택배사에 조회해서, 배송 완료로 나오면
 * 브랜드가 "배송 완료"를 누른 것과 똑같이 배송 완료로 바꾸고 구매자에게 알린다.
 * 반품 가능 기간(7일)은 이 처리 시점부터 센다. 반품 요청 중인 주문은 건드리지 않는다.
 * 조회가 안 되는 송장(택배사 코드 없음 · 조회 실패)은 그대로 두고, 기존 14일 자동 배송 완료가 처리한다.
 */

const MAX_PER_RUN = 1000;

/** 협찬 상품이 발송된 뒤 이 날수가 지나도 수령 확인이 없으면 받은 것으로 본다(업로드 일정 기준일). */
const SELECTION_AUTO_RECEIVED_DAYS = 5;

/**
 * 어필리에이트 협찬 상품(선정된 인플루언서에게 보낸 샘플)의 수령일.
 * 인플루언서가 직접 수령 확인하지 않았으면 송장을 조회해 배송 완료 시각을 넣고,
 * 조회가 안 되면 발송 5일 뒤를 수령일로 둔다. 업로드 마감 = 수령일 + 10일.
 */
async function checkSelectionDeliveries(db: any, key: string) {
  const auto = (await db.sql`
    UPDATE affiliate_store_requests
    SET ship_delivered_at = shipped_at + (${SELECTION_AUTO_RECEIVED_DAYS} * INTERVAL '1 day'), updated_at = NOW()
    WHERE shipping_status = 'shipped' AND ship_delivered_at IS NULL AND shipped_at IS NOT NULL
      AND shipped_at < NOW() - (${SELECTION_AUTO_RECEIVED_DAYS} * INTERVAL '1 day')
    RETURNING id
  `) as any[];
  let tracked = 0;
  if (key) {
    const rows = (await db.sql`
      SELECT id, ship_tracking_company, ship_tracking_number FROM affiliate_store_requests
      WHERE shipping_status = 'shipped' AND ship_delivered_at IS NULL AND ship_tracking_number <> ''
      ORDER BY shipped_at LIMIT ${MAX_PER_RUN}
    `) as any[];
    if (rows.length) {
      const list = await loadCompanyCodes(key);
      if (!list.keyInvalid) {
        for (const r of rows) {
          const code = resolveCompanyCode(r.ship_tracking_company, list);
          if (!code) continue;
          const t = await lookupTracking(key, code, r.ship_tracking_number);
          if (!t.ok || !t.delivered) continue;
          const at = t.deliveredAt && !Number.isNaN(t.deliveredAt.getTime()) ? t.deliveredAt.toISOString() : new Date().toISOString();
          await db.sql`
            UPDATE affiliate_store_requests SET ship_delivered_at = ${at}::timestamptz, updated_at = NOW()
            WHERE id = ${r.id} AND ship_delivered_at IS NULL
          `;
          tracked++;
        }
      }
    }
  }
  console.log("[tracking-check] selections", JSON.stringify({ autoReceived: auto.length, tracked }));
}

export default async () => {
  const key = trackingApiKey();
  const db = getDatabase();
  await checkSelectionDeliveries(db, key).catch((e) => console.error("[tracking-check] selections failed", e));
  if (!key) {
    console.warn("[tracking-check] SWEETTRACKER_API_KEY not set · skipped");
    return;
  }
  const rows = (await db.sql`
    SELECT id, tracking_company, tracking_number FROM affiliate_store_orders
    WHERE status = 'shipped' AND tracking_number <> '' AND shipped_at IS NOT NULL
    ORDER BY shipped_at LIMIT ${MAX_PER_RUN}
  `) as any[];
  if (!rows.length) { console.log("[tracking-check]", JSON.stringify({ checked: 0 })); return; }

  const list = await loadCompanyCodes(key);
  if (list.keyInvalid) {
    // 키가 무효면 모든 조회가 실패하므로 바로 멈춘다(주문은 기존 14일 자동 배송 완료가 처리한다).
    console.error("[tracking-check] SWEETTRACKER_API_KEY rejected (code 101 · 종료됐거나 유효하지 않은 키) · skipped");
    return;
  }
  let checked = 0, delivered = 0, failed = 0, noCode = 0;
  const errors: Record<string, number> = {};
  for (const r of rows) {
    const code = resolveCompanyCode(r.tracking_company, list);
    if (!code) { noCode++; continue; }
    const t = await lookupTracking(key, code, r.tracking_number);
    checked++;
    if (!t.ok) { failed++; errors[t.error] = (errors[t.error] || 0) + 1; continue; }
    if (!t.delivered) continue;

    const done = (await db.sql`
      UPDATE affiliate_store_orders SET status = 'delivered', delivered_at = NOW(), delivered_auto = TRUE, updated_at = NOW()
      WHERE id = ${r.id} AND status = 'shipped'
        AND NOT EXISTS (SELECT 1 FROM affiliate_store_returns x WHERE x.order_id = affiliate_store_orders.id AND x.status IN ('requested', 'approved'))
      RETURNING id, buyer_user_id, product_name
    `) as any[];
    const o = done[0];
    if (!o) continue;
    delivered++;
    const when = t.deliveredAt ? ` (택배사 완료 시각 ${t.deliveredAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })})` : "";
    await logEvent(db, o.id, "system", "", "delivered", `송장 조회 결과 배송 완료 · 자동 배송 완료${when}`).catch(() => {});
    let pushUsername = "";
    try {
      const b = (await db.sql`SELECT username FROM affiliate_buyers WHERE user_id = ${o.buyer_user_id}`) as any[];
      pushUsername = b[0]?.username || "";
    } catch { /* 푸시만 빠진다 */ }
    await notify(db, {
      recipientType: "buyer", recipient: o.buyer_user_id, kind: "delivered",
      title: "배송이 완료되었어요", body: `${o.product_name} · 7일 이내 반품을 요청할 수 있어요.`,
      link: `/my/orders/${encodeURIComponent(o.id)}`, pushUsername,
    });
  }
  console.log("[tracking-check]", JSON.stringify({ total: rows.length, checked, delivered, failed, noCode, errors }));
};

export const config: Config = {
  // 매일 05:00 UTC = 한국 시간 오후 2시
  schedule: "0 5 * * *",
};
