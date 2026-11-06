import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import {
  PENDING_PAYMENT_EXPIRE_MINUTES,
  RETURN_WINDOW_DAYS,
  businessDaysSince,
  cancelOrderFully,
  fetchPortOnePayment,
  finalizePaidOrder,
  logEvent,
  notify,
} from "./_shared/affiliate-store-orders.mts";

/**
 * 어필리에이트 스토어 자동 처리(매시간).
 *
 *   0) 결제 누락 점검: 만든 지 30분이 지난 결제 대기(pending_payment) 주문을 포트원에 조회해서
 *      결제됐으면 결제 확인 함수(finalizePaidOrder — 구매자 화면 · 웹훅과 같은 함수)로 완료 처리하고,
 *      결제되지 않았으면(결제창만 열고 닫음 · 실패 · 취소) expired 로 정리한다.
 *      입금 대기 등 아직 결과가 정해지지 않은 결제는 다음 점검까지 둔다.
 *   1) 송장 미입력 자동 취소: 결제 후 3영업일(주말 제외) 안에 송장이 없으면 공유 환불 루틴
 *      (포트원 취소 → 재고 복구 → 수수료 취소)으로 전액 취소하고 구매자에게 문자를 보낸다.
 *      하루 전(3영업일째)에 브랜드에 알림을 보낸다.
 *   2) 자동 배송 완료: 송장 입력 후 14일이 지나도 "배송 완료"가 눌리지 않으면 자동으로 배송 완료로
 *      바꾼다. 반품 가능 기간(7일)은 이 자동 처리일부터 센다.
 *   3) 자동 구매확정: 배송 완료(브랜드가 누른 날 또는 자동 처리일) 후 7일이 지나면 구매확정하고
 *      수수료를 예정 → 확정으로 바꾼다. 반품 요청 중인 주문은 상태가 다르므로 걸리지 않는다.
 *      반품이 거절된 주문은 거절 시점(return_window_from)부터 7일을 다시 센다.
 *
 * 테스트용 시간 단축(Netlify 환경변수, 분 단위 · 운영에서는 비워 둔다):
 *   AFFILIATE_TEST_AUTO_CANCEL_MINUTES   설정하면 영업일 대신 결제 후 N분에 자동 취소(알림은 N의 2/3 시점)
 *   AFFILIATE_TEST_AUTO_DELIVER_MINUTES  송장 입력 후 N분에 자동 배송 완료
 *   AFFILIATE_TEST_AUTO_CONFIRM_MINUTES  배송 완료 후 N분에 자동 구매확정
 */

const AUTO_CANCEL_BUSINESS_DAYS = 3;
const AUTO_DELIVER_DAYS = 14;
const BRAND_LINK = "/business-admin?tab=affiliate";

const testMinutes = (key: string) => {
  const n = Number(process.env[key] || "");
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const UNSETTLED_PAYMENT_STATUSES = new Set(["READY", "FAILED", "CANCELLED"]);

async function reconcilePendingPayments(db: any) {
  const rows = (await db.sql`
    SELECT id FROM affiliate_store_orders
    WHERE status = 'pending_payment'
      AND created_at < NOW() - (${String(PENDING_PAYMENT_EXPIRE_MINUTES)} || ' minutes')::interval
    ORDER BY created_at LIMIT 200
  `) as any[];
  let paid = 0, expired = 0, skipped = 0;
  for (const { id } of rows) {
    const p = await fetchPortOnePayment(id);
    let expire = false;
    if (p.ok) {
      const st = String(p.payment?.status || "");
      if (st === "PAID") {
        const r = await finalizePaidOrder(db, id, { source: "reconcile" });
        if (r.ok) { if (r.justPaid) paid++; continue; }
        // 검증 실패(금액 · 주문자 불일치) · 품절 취소는 그대로 둔다(품절이면 이미 취소됨). 운영자 확인용으로 주문번호만 남긴다.
        console.warn("[affiliate-auto] reconcile finalize failed", id, r.status, r.code || "");
        skipped++;
        continue;
      }
      expire = UNSETTLED_PAYMENT_STATUSES.has(st);
    } else {
      // 결제창을 열지 않았거나 결제 요청 전에 닫으면 포트원에 결제 건 자체가 없다(404).
      expire = p.status === 404;
    }
    if (!expire) { skipped++; continue; }
    const done = (await db.sql`
      UPDATE affiliate_store_orders SET status = 'expired', updated_at = NOW()
      WHERE id = ${id} AND status = 'pending_payment' RETURNING id
    `) as any[];
    if (done[0]) {
      expired++;
      await logEvent(db, id, "system", "", "expired", `결제 대기 ${PENDING_PAYMENT_EXPIRE_MINUTES}분 경과 · 결제되지 않아 주문서 정리`).catch(() => {});
    }
  }
  return { paid, expired, skipped };
}

async function autoCancelUnshipped(db: any) {
  const testMin = testMinutes("AFFILIATE_TEST_AUTO_CANCEL_MINUTES");
  const rows = (await db.sql`
    SELECT id, business_username, product_name, quantity, paid_at, auto_cancel_warned_at
    FROM affiliate_store_orders
    WHERE status IN ('paid', 'preparing') AND tracking_number = '' AND paid_at IS NOT NULL
      AND cancel_lock_at IS NULL
    ORDER BY paid_at LIMIT 500
  `) as any[];
  let warned = 0, cancelled = 0;
  for (const o of rows) {
    const elapsedMin = (Date.now() - new Date(o.paid_at).getTime()) / 60_000;
    const due = testMin ? elapsedMin >= testMin : businessDaysSince(o.paid_at) > AUTO_CANCEL_BUSINESS_DAYS;
    const warnTime = testMin ? elapsedMin >= (testMin * 2) / 3 : businessDaysSince(o.paid_at) >= AUTO_CANCEL_BUSINESS_DAYS;

    if (due) {
      const r = await cancelOrderFully(db, o.id, {
        actorType: "system", actor: "", reason: "송장 미입력 자동 취소", allowed: ["paid", "preparing"],
        buyerSms: `${o.product_name} 주문이 판매자의 발송 지연(3영업일 내 송장 미입력)으로 자동 취소되어 전액 환불되었습니다.`,
      });
      if (r.ok) {
        cancelled++;
        await notify(db, {
          recipientType: "brand", recipient: o.business_username, kind: "auto_cancelled",
          title: "송장 미입력으로 주문이 자동 취소되었어요",
          body: `${o.product_name} ${o.quantity}개 · 결제 후 3영업일 안에 송장이 입력되지 않았어요.`, link: BRAND_LINK,
        });
      } else {
        console.error("[affiliate-auto] auto cancel failed", o.id, r.status);
      }
      continue;
    }
    if (warnTime && !o.auto_cancel_warned_at) {
      const claimed = (await db.sql`
        UPDATE affiliate_store_orders SET auto_cancel_warned_at = NOW()
        WHERE id = ${o.id} AND auto_cancel_warned_at IS NULL RETURNING id
      `) as any[];
      if (claimed[0]) {
        warned++;
        await notify(db, {
          recipientType: "brand", recipient: o.business_username, kind: "auto_cancel_warning",
          title: "내일 자동 취소될 주문이 있어요",
          body: `${o.product_name} ${o.quantity}개 · 송장을 입력하지 않으면 내일 자동으로 전액 환불됩니다.`, link: BRAND_LINK,
        });
      }
    }
  }
  return { warned, cancelled };
}

async function autoDeliver(db: any) {
  const testMin = testMinutes("AFFILIATE_TEST_AUTO_DELIVER_MINUTES");
  const minutes = String(testMin || AUTO_DELIVER_DAYS * 24 * 60);
  const rows = (await db.sql`
    UPDATE affiliate_store_orders SET status = 'delivered', delivered_at = NOW(), delivered_auto = TRUE, updated_at = NOW()
    WHERE status = 'shipped' AND shipped_at IS NOT NULL
      AND shipped_at < NOW() - (${minutes} || ' minutes')::interval
      AND NOT EXISTS (SELECT 1 FROM affiliate_store_returns r WHERE r.order_id = affiliate_store_orders.id AND r.status IN ('requested', 'approved'))
    RETURNING id
  `) as any[];
  for (const r of rows) {
    await db.sql`
      INSERT INTO affiliate_store_order_events (order_id, actor_type, actor, action, note)
      VALUES (${r.id}, 'system', '', 'delivered', '송장 입력 14일 경과 · 자동 배송 완료(반품 가능 기간은 오늘부터 7일)')
    `;
  }
  return rows.length;
}

async function autoConfirm(db: any) {
  const testMin = testMinutes("AFFILIATE_TEST_AUTO_CONFIRM_MINUTES");
  const minutes = String(testMin || RETURN_WINDOW_DAYS * 24 * 60);
  const rows = (await db.sql`
    UPDATE affiliate_store_orders SET status = 'confirmed', confirmed_at = NOW(),
      commission_status = 'confirmed', commission_confirmed_at = NOW(), updated_at = NOW()
    WHERE status = 'delivered' AND delivered_at IS NOT NULL
      AND GREATEST(return_window_from, delivered_at) < NOW() - (${minutes} || ' minutes')::interval
      AND NOT EXISTS (SELECT 1 FROM affiliate_store_returns r WHERE r.order_id = affiliate_store_orders.id AND r.status IN ('requested', 'approved'))
    RETURNING id
  `) as any[];
  for (const r of rows) {
    await db.sql`
      INSERT INTO affiliate_store_order_events (order_id, actor_type, actor, action, note)
      VALUES (${r.id}, 'system', '', 'confirmed', '반품 가능 기간(7일) 경과 · 자동 구매확정(수수료 확정)')
    `;
  }
  return rows.length;
}

export default async () => {
  const db = getDatabase();
  const result: Record<string, unknown> = {};
  // 단계마다 따로 잡는다 — 한 단계가 실패해도 나머지는 돈다.
  try { result.payments = await reconcilePendingPayments(db); } catch (e: any) { console.error("[affiliate-auto] reconcile step failed", e?.code || ""); }
  try { result.cancel = await autoCancelUnshipped(db); } catch (e: any) { console.error("[affiliate-auto] cancel step failed", e?.code || ""); }
  try { result.delivered = await autoDeliver(db); } catch (e: any) { console.error("[affiliate-auto] deliver step failed", e?.code || ""); }
  try { result.confirmed = await autoConfirm(db); } catch (e: any) { console.error("[affiliate-auto] confirm step failed", e?.code || ""); }
  console.log("[affiliate-auto]", JSON.stringify(result));
};

export const config: Config = {
  schedule: "@hourly",
};
