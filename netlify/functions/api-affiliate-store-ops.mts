import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireOperator } from "./_shared/manager-auth.mts";
import { canUseStore } from "./_shared/store-testers.mts";
import {
  DELIVER_MIN_HOURS_AFTER_SHIP,
  FEE_SETTING_KEYS,
  PARTIAL_REFUND_REASONS,
  returnRefundPlan,
  PLATFORM_RATE,
  brandSettlement,
  currentFeeRates,
  businessDaysSince,
  inquiriesLink,
  orderLink,
  sendBuyerSms,
  cancelOrderFully,
  logEvent,
  notify,
  trackingUrl,
} from "./_shared/affiliate-store-orders.mts";

/**
 * 어필리에이트 스토어 주문 운영 — 브랜드 주문 관리 · 취소 · 반품, 운영자 미처리 목록.
 *
 *   GET  ?scope=brand          브랜드: 내 주문(취소 · 반품 이력 포함) · 알림
 *   GET  ?scope=admin-issues   운영자: 3영업일 넘게 처리되지 않은 반품 + 처리 기록
 *   POST { action, ... }
 *     브랜드  prepare · ship · deliver · cancel · return_approve · return_reject · return_refund
 *             · answer_inquiry(예전 문의 답변 · 화면에서는 숨김) · read_notifications · mark_seen
 *     운영자  admin_refund · admin_return_reject · admin_remind · set_fee_rates
 *
 * 반품 규칙(구매자 신청 → 브랜드 승인 · 거절 → 승인 시 브랜드가 주문 배송지로 직접 회수 → 브랜드 "환불 처리")
 *   - 승인은 입력 없이 바로 된다. 회수 방법 · 일정 연락은 브랜드가 진행하고 플랫폼은 관여하지 않는다.
 *   - 브랜드는 요청(requested)된 반품만 승인 · 거절한다(거절 사유는 선택). 승인 뒤에는 거절로 바꿀 수 없다
 *     (return_reject 는 approved 에서 막힌다). 승인 뒤 분쟁은 운영자 환불로 처리한다.
 *   - 거절하면 주문은 원래 단계(배송 중 · 배송 완료)로 돌아가고, 반품 기간 · 구매확정 기준일은 거절 시점부터 다시 센다.
 *   - 환불: 반품 사유와 관계없이 상품 금액 전액(판매가 × 수량)만 환불한다(포트원 부분 취소).
 *     주문 배송비는 환불하지 않고 PG 수수료(남은 배송비 × pg_rate)만 떼고 브랜드에 정산된다. 왕복 배송비는 브랜드와 구매자가 플랫폼 밖에서 협의.
 *     인플루언서 수수료는 0원(취소). 배송비가 0원이면 전액 취소와 같다. 예전 shippingDeduction 값은 무시한다.
 *   - 운영자는 구매확정된 주문도 환불할 수 있고, 이때 수수료는 취소된다.
 *
 * 브랜드는 자기 브랜드 주문만, 운영자는 전체를 본다. 환불은 모두 cancelOrderFully
 * (포트원 취소 → 재고 복구 → 수수료 취소, 멱등)를 거친다.
 */

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const err = (message: string, status = 400) => Response.json({ error: message }, { status });
const OVERDUE_BUSINESS_DAYS = 3;
const BRAND_ORDER_PAGE_SIZE = 40;

const BRAND_LINK = "/business-admin?tab=affiliate";

/** 주문의 구매자에게 문자(실패해도 처리는 계속된다). */
async function smsForOrder(db: any, orderId: string, text: string) {
  let o: any = null;
  try { o = ((await db.sql`SELECT id, buyer_phone FROM affiliate_store_orders WHERE id = ${orderId}`) as any[])[0]; } catch { /* 문자만 빠진다 */ }
  if (o) await sendBuyerSms(o, text, orderLink(orderId));
}

/** 구매자에게 알림. 구매자가 아이디(인플루언서 · 브랜드)를 가진 경우 푸시도 간다. */
async function notifyBuyer(db: any, userId: string, kind: string, title: string, body: string, orderId: string) {
  let b: any[] = [];
  try { b = (await db.sql`SELECT username FROM affiliate_buyers WHERE user_id = ${userId}`) as any[]; } catch { /* 푸시만 빠진다 */ }
  await notify(db, {
    recipientType: "buyer", recipient: userId, kind, title, body,
    link: `/my/orders/${encodeURIComponent(orderId)}`, pushUsername: b[0]?.username || "",
  });
}

function shapeBrandOrder(o: any) {
  return {
    id: o.id,
    productId: o.product_id,
    productName: o.product_name,
    optionName: o.option_name,
    quantity: o.quantity,
    unitPrice: o.unit_price,
    shippingFee: o.shipping_fee,
    totalAmount: o.total_amount,
    commissionRate: Number(o.commission_rate) || 0,
    commissionAmount: o.commission_amount,
    commissionStatus: o.commission_status,
    platformRate: Number(o.platform_rate) || 0,
    pgRate: Number(o.pg_rate) || 0,
    payMethod: o.pay_method,
    settlement: brandSettlement(o),
    influencerUsername: o.influencer_username,
    status: o.status,
    paidAt: o.paid_at,
    preparingAt: o.preparing_at,
    trackingCompany: o.tracking_company,
    trackingNumber: o.tracking_number,
    trackingUrl: o.tracking_number ? trackingUrl(o.tracking_company, o.tracking_number) : "",
    shippedAt: o.shipped_at,
    deliveredAt: o.delivered_at,
    confirmedAt: o.confirmed_at,
    cancelledAt: o.cancelled_at,
    cancelledBy: o.cancelled_by,
    cancelReason: o.cancel_reason,
    cancelMemo: o.cancel_memo,
    refundAmount: o.refund_amount,
    isNew: !o.brand_seen_at,
    createdAt: o.created_at,
    buyerName: o.buyer_name,
    buyerPhone: o.buyer_phone,
    buyerEmail: o.buyer_email,
    recipientName: o.recipient_name,
    recipientPhone: o.recipient_phone,
    postcode: o.postcode,
    address1: o.address1,
    address2: o.address2,
    deliveryMemo: o.delivery_memo,
    returnRequest: o.ret_status ? {
      status: o.ret_status, reason: o.ret_reason, memo: o.ret_memo, photoUrls: o.ret_photos || [],
      returnAddress: o.ret_address, pickupMessage: o.ret_pickup, rejectReason: o.ret_reject,
      requestedAt: o.ret_requested_at, decidedAt: o.ret_decided_at, refundedAt: o.ret_refunded_at,
      refundAmount: Number(o.ret_refund_amount) || 0, shippingDeduction: Number(o.ret_shipping_deduction) || 0,
      partialAllowed: PARTIAL_REFUND_REASONS.includes(o.ret_reason),
    } : null,
    // 브랜드 '배송 완료' 버튼: 송장 입력 후 하루가 지나야 누를 수 있다.
    deliverableAt: o.shipped_at ? new Date(new Date(o.shipped_at).getTime() + DELIVER_MIN_HOURS_AFTER_SHIP * 3600_000).toISOString() : null,
  };
}

// ─────────────────────────── 브랜드 ───────────────────────────

async function brandGet(db: any, brand: string, url: URL) {
  const view = url.searchParams.get("view") === "claims" ? "claims" : "orders";
  const orderId = clip(url.searchParams.get("orderId"), 120);
  const cursorId = clip(url.searchParams.get("cursorId"), 120);
  const cursorTimeRaw = clip(url.searchParams.get("cursorAt"), 60);
  const cursorTimeValue = Date.parse(cursorTimeRaw);
  const hasCursor = !!cursorId && Number.isFinite(cursorTimeValue);
  const cursorAt = hasCursor ? new Date(cursorTimeValue).toISOString() : "1970-01-01T00:00:00.000Z";
  const ordersQuery = orderId ? db.sql`
      SELECT o.*, r.status AS ret_status, r.reason AS ret_reason, r.memo AS ret_memo, r.photo_urls AS ret_photos,
             r.return_address AS ret_address, r.pickup_message AS ret_pickup, r.reject_reason AS ret_reject,
             r.requested_at AS ret_requested_at, r.decided_at AS ret_decided_at, r.refunded_at AS ret_refunded_at,
             r.refund_amount AS ret_refund_amount, r.shipping_deduction AS ret_shipping_deduction
      FROM affiliate_store_orders o
      LEFT JOIN affiliate_store_returns r ON r.order_id = o.id
      WHERE o.business_username = ${brand} AND o.id = ${orderId}
        AND o.status NOT IN ('pending_payment', 'expired')
        AND (${view === "orders"} OR o.status = 'cancelled' OR r.order_id IS NOT NULL)
      LIMIT 1
    ` as Promise<any[]> : view === "claims" ? db.sql`
      SELECT o.*, r.status AS ret_status, r.reason AS ret_reason, r.memo AS ret_memo, r.photo_urls AS ret_photos,
             r.return_address AS ret_address, r.pickup_message AS ret_pickup, r.reject_reason AS ret_reject,
             r.requested_at AS ret_requested_at, r.decided_at AS ret_decided_at, r.refunded_at AS ret_refunded_at,
             r.refund_amount AS ret_refund_amount, r.shipping_deduction AS ret_shipping_deduction
      FROM affiliate_store_orders o
      LEFT JOIN affiliate_store_returns r ON r.order_id = o.id
      WHERE o.business_username = ${brand} AND o.status NOT IN ('pending_payment', 'expired')
        AND (o.status = 'cancelled' OR r.order_id IS NOT NULL)
        AND (NOT ${hasCursor} OR
          (COALESCE(r.requested_at, o.cancelled_at, o.created_at) < ${cursorAt}::timestamptz OR
           (COALESCE(r.requested_at, o.cancelled_at, o.created_at) = ${cursorAt}::timestamptz AND o.id < ${cursorId})))
      ORDER BY COALESCE(r.requested_at, o.cancelled_at, o.created_at) DESC, o.id DESC
      LIMIT ${BRAND_ORDER_PAGE_SIZE + 1}
    ` as Promise<any[]> : db.sql`
      SELECT o.*, r.status AS ret_status, r.reason AS ret_reason, r.memo AS ret_memo, r.photo_urls AS ret_photos,
             r.return_address AS ret_address, r.pickup_message AS ret_pickup, r.reject_reason AS ret_reject,
             r.requested_at AS ret_requested_at, r.decided_at AS ret_decided_at, r.refunded_at AS ret_refunded_at,
             r.refund_amount AS ret_refund_amount, r.shipping_deduction AS ret_shipping_deduction
      FROM affiliate_store_orders o
      LEFT JOIN affiliate_store_returns r ON r.order_id = o.id
      WHERE o.business_username = ${brand} AND o.status NOT IN ('pending_payment', 'expired')
        AND (NOT ${hasCursor} OR o.created_at < ${cursorAt}::timestamptz OR
          (o.created_at = ${cursorAt}::timestamptz AND o.id < ${cursorId}))
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${BRAND_ORDER_PAGE_SIZE + 1}
    ` as Promise<any[]>;
  const [orders, metrics, notifications] = await Promise.all([
    ordersQuery,
    !hasCursor ? db.sql`
      WITH base AS (
        SELECT o.status, o.commission_status, o.commission_amount, o.platform_rate, o.pg_rate,
               o.unit_price::numeric * o.quantity::numeric AS product,
               COALESCE(NULLIF(o.total_amount, 0)::numeric,
                 o.unit_price::numeric * o.quantity::numeric + o.shipping_fee::numeric) AS payment,
               COALESCE(o.refund_amount, 0)::numeric AS refund,
               r.order_id AS return_order_id, r.status AS ret_status
        FROM affiliate_store_orders o
        LEFT JOIN affiliate_store_returns r ON r.order_id = o.id
        WHERE o.business_username = ${brand} AND o.status NOT IN ('pending_payment', 'expired')
      ), calc AS (
        SELECT *,
               CASE WHEN status = 'cancelled' THEN payment - refund ELSE payment END AS kept_payment,
               CASE WHEN status = 'cancelled' THEN GREATEST(0, product - refund) ELSE product END AS kept_product,
               CASE WHEN status <> 'cancelled' THEN TRUE ELSE refund > 0 AND payment - refund > 0 END AS included
        FROM base
      )
      SELECT
        COUNT(*) FILTER (WHERE status = 'paid')::int AS new_orders,
        COUNT(*) FILTER (WHERE status = 'preparing')::int AS preparing_orders,
        COUNT(*) FILTER (WHERE status = 'shipped')::int AS shipped_orders,
        COUNT(*) FILTER (WHERE status IN ('delivered', 'confirmed'))::int AS delivered_orders,
        COUNT(*)::int AS all_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled' OR return_order_id IS NOT NULL)::int AS claims_all,
        COUNT(*) FILTER (WHERE status = 'cancelled' AND return_order_id IS NULL)::int AS claims_cancel,
        COUNT(*) FILTER (WHERE return_order_id IS NOT NULL)::int AS claims_return,
        COUNT(*) FILTER (WHERE ret_status = 'requested' OR (ret_status = 'approved' AND status = 'return_requested'))::int AS claims_action,
        (SELECT COUNT(*)::int FROM affiliate_store_notifications
         WHERE recipient_type = 'brand' AND recipient = ${brand} AND read_at IS NULL) AS unread,
        COALESCE(SUM(CASE WHEN included THEN kept_payment ELSE 0 END), 0)::bigint AS settlement_payment,
        COALESCE(SUM(CASE WHEN included THEN
          CASE WHEN status = 'cancelled' AND commission_status = 'cancelled' THEN 0 ELSE commission_amount END
          ELSE 0 END), 0)::bigint AS settlement_commission,
        COALESCE(SUM(CASE WHEN included THEN FLOOR(kept_payment * pg_rate / 100) ELSE 0 END), 0)::bigint AS settlement_pg_fee,
        COALESCE(SUM(CASE WHEN included THEN FLOOR(kept_product * platform_rate / 100) ELSE 0 END), 0)::bigint AS settlement_platform_fee,
        COALESCE(SUM(CASE WHEN included THEN kept_payment
          - CASE WHEN status = 'cancelled' AND commission_status = 'cancelled' THEN 0 ELSE commission_amount END
          - FLOOR(kept_payment * pg_rate / 100)
          - FLOOR(kept_product * platform_rate / 100)
          ELSE 0 END), 0)::bigint AS settlement_amount,
        COALESCE(SUM(CASE WHEN included AND commission_status = 'confirmed' THEN kept_payment
          - CASE WHEN status = 'cancelled' AND commission_status = 'cancelled' THEN 0 ELSE commission_amount END
          - FLOOR(kept_payment * pg_rate / 100)
          - FLOOR(kept_product * platform_rate / 100)
          ELSE 0 END), 0)::bigint AS settlement_confirmed_amount
      FROM calc
    ` as Promise<any[]> : Promise.resolve([]),
    !hasCursor ? db.sql`
      SELECT id, kind, title, body, read_at, created_at FROM affiliate_store_notifications
      WHERE recipient_type = 'brand' AND recipient = ${brand} ORDER BY created_at DESC LIMIT 50
    ` as Promise<any[]> : Promise.resolve([]),
  ]);
  const pageOrders = orders.slice(0, BRAND_ORDER_PAGE_SIZE);
  const lastOrder = pageOrders[pageOrders.length - 1];
  const nextCursor = orders.length > BRAND_ORDER_PAGE_SIZE && lastOrder ? {
    cursorAt: new Date(view === "claims" ? lastOrder.ret_requested_at || lastOrder.cancelled_at || lastOrder.created_at : lastOrder.created_at).toISOString(),
    cursorId: String(lastOrder.id),
  } : null;
  const m = metrics[0] || {};
  const summary = {
    orderCounts: {
      new: Number(m.new_orders) || 0,
      preparing: Number(m.preparing_orders) || 0,
      shipped: Number(m.shipped_orders) || 0,
      delivered: Number(m.delivered_orders) || 0,
      all: Number(m.all_orders) || 0,
    },
    claimCounts: {
      all: Number(m.claims_all) || 0,
      cancel: Number(m.claims_cancel) || 0,
      return: Number(m.claims_return) || 0,
      action: Number(m.claims_action) || 0,
    },
    opsCounts: {
      newOrders: Number(m.new_orders) || 0,
      claimsNeedAction: Number(m.claims_action) || 0,
      unread: Number(m.unread) || 0,
    },
    settlement: {
      payment: Number(m.settlement_payment) || 0,
      commission: Number(m.settlement_commission) || 0,
      pgFee: Number(m.settlement_pg_fee) || 0,
      platformFee: Number(m.settlement_platform_fee) || 0,
      amount: Number(m.settlement_amount) || 0,
      confirmedAmount: Number(m.settlement_confirmed_amount) || 0,
    },
  };
  return Response.json({
    orders: pageOrders.map(shapeBrandOrder),
    hasMore: orders.length > BRAND_ORDER_PAGE_SIZE,
    nextCursor,
    ...(hasCursor ? {} : { summary, notifications }),
  });
}

async function setStatus(db: any, brand: string, id: string, from: string[], to: string, extra: "preparing" | "delivered") {
  const rows = (extra === "preparing"
    ? await db.sql`
        UPDATE affiliate_store_orders SET status = ${to}, preparing_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND business_username = ${brand} AND status = ANY(${from}::text[]) RETURNING *`
    : await db.sql`
        UPDATE affiliate_store_orders SET status = ${to}, delivered_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND business_username = ${brand} AND status = ANY(${from}::text[]) RETURNING *`) as any[];
  return rows[0] || null;
}

/**
 * 반품 거절(브랜드: 요청 단계만 · 운영자: 승인 뒤 분쟁도). 주문은 원래 단계로 돌린다
 * (배송 완료 전이면 배송 중, 아니면 배송 완료). 반품 기간 · 구매확정 기준일은 거절 시점부터 다시 센다.
 * 성공하면 null, 실패하면 오류 응답을 돌려준다.
 */
async function rejectReturn(
  db: any,
  id: string,
  opt: { actorType: "brand" | "operator"; actor: string; reason: string; businessUsername?: string; allowed: string[] },
): Promise<Response | null> {
  // 거절 사유는 선택이다(빈칸 허용).
  const brand = opt.businessUsername || "";
  const client = await db.pool.connect();
  let buyerUserId = "";
  try {
    await client.query("BEGIN");
    const ret = (await client.query(
      `UPDATE affiliate_store_returns SET status = 'rejected', reject_reason = $3, decided_at = NOW(), updated_at = NOW()
       WHERE order_id = $1 AND ($2 = '' OR business_username = $2) AND status = ANY($4::text[]) RETURNING buyer_user_id, status`,
      [id, brand, opt.reason, opt.allowed],
    )).rows[0];
    if (!ret) {
      await client.query("ROLLBACK");
      const cur = ((await db.sql`SELECT status FROM affiliate_store_returns WHERE order_id = ${id} AND (${brand} = '' OR business_username = ${brand})`) as any[])[0];
      if (cur?.status === "approved" && opt.actorType === "brand") return err("승인한 반품은 거절로 바꿀 수 없어요. 문제가 있으면 픽스폴리오 고객센터로 문의해 주세요.");
      return err("거절할 반품 요청이 없습니다.");
    }
    buyerUserId = ret.buyer_user_id;
    await client.query(
      `UPDATE affiliate_store_orders SET status = CASE WHEN delivered_at IS NULL THEN 'shipped' ELSE 'delivered' END,
         return_window_from = NOW(), brand_seen_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'return_requested'`,
      [id],
    );
    await logEvent(client, id, opt.actorType, opt.actor, "return_rejected", opt.reason || "사유 없음");
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await notifyBuyer(db, buyerUserId, "return_rejected", "반품 요청이 거절되었어요",
    opt.reason ? `판매자가 따로 연락드릴 거예요. 사유: ${opt.reason}` : "판매자가 따로 연락드릴 거예요.", id);
  await smsForOrder(db, id, `반품 요청이 거절되었습니다. 판매자가 따로 연락드릴 거예요.${opt.reason ? ` 사유: ${opt.reason}` : ""}`);
  return null;
}

async function brandAction(db: any, brand: string, body: any) {
  const id = clip(body.id, 120);
  const action = String(body.action || "");

  if (action === "prepare") {
    const o = await setStatus(db, brand, id, ["paid"], "preparing", "preparing");
    if (!o) return err("결제 완료 주문만 배송 준비로 바꿀 수 있어요.");
    await logEvent(db, id, "brand", brand, "preparing", "배송 준비");
    await notifyBuyer(db, o.buyer_user_id, "preparing", "상품을 준비하고 있어요", o.product_name, id);
    return Response.json({ ok: true });
  }

  if (action === "ship") {
    const company = clip(body.trackingCompany, 40);
    const number = clip(body.trackingNumber, 60);
    if (!company || !number) return err("택배사와 송장번호를 입력해 주세요.");
    const rows = (await db.sql`
      UPDATE affiliate_store_orders SET status = 'shipped', tracking_company = ${company}, tracking_number = ${number},
        shipped_at = COALESCE(shipped_at, NOW()), updated_at = NOW()
      WHERE id = ${id} AND business_username = ${brand} AND status IN ('paid', 'preparing', 'shipped')
        AND cancel_lock_at IS NULL
      RETURNING *
    `) as any[];
    const o = rows[0];
    if (!o) return err("송장을 입력할 수 없는 주문입니다.");
    await logEvent(db, id, "brand", brand, "shipped", `${company} ${number}`);
    await notifyBuyer(db, o.buyer_user_id, "shipped", "상품이 발송되었어요", `${o.product_name} · ${company} ${number}`, id);
    await sendBuyerSms(o, `${o.product_name} 상품이 발송되었습니다. ${company} 송장번호 ${number}`, orderLink(id));
    return Response.json({ ok: true });
  }

  if (action === "deliver") {
    // 송장 입력 후 최소 하루가 지나야 브랜드가 직접 배송 완료로 바꿀 수 있다(바로 눌러 반품 기간을 앞당기지 않게).
    const rows = (await db.sql`
      UPDATE affiliate_store_orders SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND business_username = ${brand} AND status = 'shipped'
        AND shipped_at IS NOT NULL AND shipped_at <= NOW() - (${String(DELIVER_MIN_HOURS_AFTER_SHIP)} || ' hours')::interval
      RETURNING *
    `) as any[];
    const o = rows[0];
    if (!o) {
      const cur = ((await db.sql`SELECT status, shipped_at FROM affiliate_store_orders WHERE id = ${id} AND business_username = ${brand}`) as any[])[0];
      if (cur?.status === "shipped") return err("송장 입력 후 하루가 지나야 배송 완료로 바꿀 수 있어요.");
      return err("배송 중인 주문만 배송 완료로 바꿀 수 있어요.");
    }
    await logEvent(db, id, "brand", brand, "delivered", "배송 완료");
    await notifyBuyer(db, o.buyer_user_id, "delivered", "배송이 완료되었어요", `${o.product_name} · 7일 이내 반품을 요청할 수 있어요.`, id);
    return Response.json({ ok: true });
  }

  if (action === "cancel") {
    const reason = clip(body.reason, 100) || "판매자 취소";
    const r = await cancelOrderFully(db, id, {
      actorType: "brand", actor: brand, reason, memo: clip(body.memo, 500),
      allowed: ["paid", "preparing"], businessUsername: brand,
    });
    if (r.ok === false) return err(r.error, r.status);
    if (!r.alreadyCancelled) await notifyBuyer(db, r.order.buyer_user_id, "cancelled", "주문이 취소되고 전액 환불되었어요", `${r.order.product_name} · ${reason}`, id);
    return Response.json({ ok: true });
  }

  if (action === "return_approve") {
    // 입력 없이 바로 승인한다. 승인하면 브랜드가 주문 배송지로 직접 회수하고(연락 · 일정은 브랜드가 진행),
    // 회수 뒤 "환불 처리"를 누른다. 반품 주소 · 회수 안내 칸은 더 받지 않는다(DB 컬럼은 남겨 둔다).
    const rows = (await db.sql`
      UPDATE affiliate_store_returns SET status = 'approved', decided_at = NOW(), updated_at = NOW()
      WHERE order_id = ${id} AND business_username = ${brand} AND status = 'requested' RETURNING buyer_user_id
    `) as any[];
    if (!rows[0]) return err("승인할 반품 요청이 없습니다.");
    await logEvent(db, id, "brand", brand, "return_approved", "반품 승인 · 판매자가 주문 배송지로 회수 예정");
    await notifyBuyer(db, rows[0].buyer_user_id, "return_approved", "반품 요청이 승인되었어요", "판매자가 주문하신 주소로 상품을 회수할 예정이에요.", id);
    await smsForOrder(db, id, "반품 요청이 승인되었습니다. 판매자가 주문하신 배송지로 상품을 회수할 예정이에요. 회수가 확인되면 환불됩니다.");
    return Response.json({ ok: true });
  }

  if (action === "return_reject") {
    // 브랜드는 아직 승인하지 않은(requested) 반품만 거절할 수 있다. 승인 뒤 분쟁은 운영자가 처리한다.
    const r = await rejectReturn(db, id, { actorType: "brand", actor: brand, reason: clip(body.rejectReason, 500), businessUsername: brand, allowed: ["requested"] });
    if (r) return r;
    return Response.json({ ok: true });
  }

  if (action === "return_refund") {
    const ret = (await db.sql`SELECT status, reason FROM affiliate_store_returns WHERE order_id = ${id} AND business_username = ${brand}`) as any[];
    if (!ret[0]) return err("반품 요청을 찾을 수 없습니다.", 404);
    if (ret[0].status === "requested") return err("반품을 먼저 승인하고, 상품 회수를 확인한 뒤 환불해 주세요.");
    if (ret[0].status !== "approved" && ret[0].status !== "refunded") return err("환불할 수 없는 반품 요청입니다.");

    // 반품 환불 = 상품 금액 전액(사유 무관). 주문 배송비는 환불하지 않는다. 예전 shippingDeduction 값은 무시한다.
    // 배송비가 0원이면 상품 금액 = 결제 금액이므로 전액 취소로 처리한다.
    const o = ((await db.sql`SELECT product_name, unit_price, quantity, total_amount FROM affiliate_store_orders WHERE id = ${id} AND business_username = ${brand}`) as any[])[0];
    if (!o) return err("주문을 찾을 수 없습니다.", 404);
    const plan = returnRefundPlan(o);
    if (plan.refundAmount <= 0) return err("환불 금액을 확인해 주세요.");
    const partial = plan.full ? undefined : { refundAmount: plan.refundAmount, deduction: plan.keptShipping };
    const r = await cancelOrderFully(db, id, {
      actorType: "brand", actor: brand, reason: "반품 환불", allowed: ["return_requested"], businessUsername: brand, partial,
      // 배송비 0원 주문(전액 취소)도 반품 환불 문구로 보낸다. 배송비가 있으면 공통 반품 문구(상품 금액 · 배송비 협의)를 쓴다.
      ...(plan.full ? { buyerSms: `${o.product_name} 반품 환불(상품 금액) ${plan.refundAmount.toLocaleString("ko-KR")}원이 처리되었습니다.` } : {}),
      inTransaction: async (client, order) => {
        await client.query(
          `UPDATE affiliate_store_returns SET status = 'refunded', refunded_at = NOW(), refund_amount = $2, shipping_deduction = $3, updated_at = NOW() WHERE order_id = $1`,
          // shipping_deduction 에는 환불하지 않은 주문 배송비(브랜드 정산분)를 남긴다.
          [id, Number(order.refund_amount) || 0, partial ? partial.deduction : 0],
        );
      },
    });
    if (r.ok === false) return err(r.error, r.status);
    if (!r.alreadyCancelled) {
      const refunded = Number(r.order.refund_amount) || 0;
      await notifyBuyer(db, r.order.buyer_user_id, "refunded", "반품 환불이 완료되었어요",
        `${r.order.product_name} · 상품 금액 ${refunded.toLocaleString("ko-KR")}원 환불${partial ? " · 배송비는 판매자와 협의해 주세요" : ""}`, id);
    }
    return Response.json({ ok: true });
  }

  if (action === "answer_inquiry") {
    const answer = clip(body.answer, 2000);
    if (!answer) return err("답변을 입력해 주세요.");
    const rows = (await db.sql`
      UPDATE affiliate_store_inquiries SET answer = ${answer}, answered_by = 'brand', answered_at = NOW(), buyer_seen_at = NULL
      WHERE id = ${id} AND business_username = ${brand} RETURNING buyer_user_id, order_id, product_name
    `) as any[];
    // 문의 답변 문자: 주문 문의면 그 주문의 연락처, 상품 문의면 저장된 구매자 연락처.
    let phone = "";
    try {
      const p = rows[0]?.order_id
        ? ((await db.sql`SELECT buyer_phone FROM affiliate_store_orders WHERE id = ${rows[0].order_id}`) as any[])[0]?.buyer_phone
        : ((await db.sql`SELECT buyer_phone FROM affiliate_buyers WHERE user_id = ${rows[0]?.buyer_user_id || ""}`) as any[])[0]?.buyer_phone;
      phone = p || "";
    } catch { /* 문자만 빠진다 */ }
    if (rows[0]) await sendBuyerSms({ id: `inquiry:${id}`, buyer_phone: phone }, `${rows[0].product_name} 문의에 판매자 답변이 등록되었습니다.`, inquiriesLink());
    if (!rows[0]) return err("문의를 찾을 수 없습니다.", 404);
    const b = (await db.sql`SELECT username FROM affiliate_buyers WHERE user_id = ${rows[0].buyer_user_id}`) as any[];
    await notify(db, {
      recipientType: "buyer", recipient: rows[0].buyer_user_id, kind: "inquiry_answered",
      title: "문의에 답변이 등록되었어요", body: rows[0].product_name, link: "/my/inquiries", pushUsername: b[0]?.username || "",
    });
    return Response.json({ ok: true });
  }

  if (action === "read_notifications") {
    await db.sql`UPDATE affiliate_store_notifications SET read_at = NOW() WHERE recipient_type = 'brand' AND recipient = ${brand} AND read_at IS NULL`;
    return Response.json({ ok: true });
  }
  if (action === "mark_seen") {
    await db.sql`UPDATE affiliate_store_orders SET brand_seen_at = NOW() WHERE business_username = ${brand} AND brand_seen_at IS NULL AND status NOT IN ('pending_payment', 'expired')`;
    return Response.json({ ok: true });
  }
  return err("알 수 없는 요청입니다.");
}

// ─────────────────────────── 운영자 ───────────────────────────

async function adminIssues(db: any) {
  const [returns, inquiries, actions, feeRates, feeHistory] = await Promise.all([
    db.sql`
      SELECT r.*, o.product_name, o.total_amount, o.status AS order_status, o.buyer_name, a.brand_name
      FROM affiliate_store_returns r
      JOIN affiliate_store_orders o ON o.id = r.order_id
      LEFT JOIN affiliate_store_applications a ON a.business_username = r.business_username
      WHERE r.status IN ('requested', 'approved') AND r.requested_at < NOW() - INTERVAL '3 days'
      ORDER BY r.requested_at
    ` as Promise<any[]>,
    db.sql`
      SELECT q.*, a.brand_name FROM affiliate_store_inquiries q
      LEFT JOIN affiliate_store_applications a ON a.business_username = q.business_username
      WHERE q.answered_at IS NULL AND q.created_at < NOW() - INTERVAL '3 days'
      ORDER BY q.created_at
    ` as Promise<any[]>,
    db.sql`
      SELECT order_id, actor, action, note, created_at FROM affiliate_store_order_events
      WHERE actor_type = 'operator' ORDER BY created_at DESC LIMIT 100
    ` as Promise<any[]>,
    currentFeeRates(db),
    db.sql`
      SELECT key, old_value, new_value, changed_by, changed_at FROM platform_setting_history
      WHERE key = ANY(${Object.values(FEE_SETTING_KEYS)}::text[]) ORDER BY changed_at DESC LIMIT 50
    ` as Promise<any[]>,
  ]);
  // 기준 시각: 반품은 아직 승인 전이면 요청 시각, 승인 뒤 환불이 멈춰 있으면 승인 시각.
  const overdueReturns = returns
    .map((r) => ({ r, since: r.status === "approved" && r.decided_at ? r.decided_at : r.requested_at }))
    .filter(({ since }) => businessDaysSince(since) > OVERDUE_BUSINESS_DAYS)
    .map(({ r, since }) => ({
      orderId: r.order_id, brand: r.business_username, brandName: r.brand_name || r.business_username,
      productName: r.product_name, totalAmount: r.total_amount, buyerName: r.buyer_name,
      status: r.status, reason: r.reason, memo: r.memo, requestedAt: r.requested_at, decidedAt: r.decided_at,
      businessDays: businessDaysSince(since),
    }));
  const overdueInquiries = inquiries
    .filter((q) => businessDaysSince(q.created_at) > OVERDUE_BUSINESS_DAYS)
    .map((q) => ({
      id: q.id, brand: q.business_username, brandName: q.brand_name || q.business_username, productName: q.product_name,
      orderId: q.order_id, body: q.body, createdAt: q.created_at, businessDays: businessDaysSince(q.created_at),
    }));
  return Response.json({
    returns: overdueReturns, inquiries: overdueInquiries, operatorActions: actions,
    feeRates, feeHistory: feeHistory.map((h) => ({ key: h.key, oldValue: h.old_value, newValue: h.new_value, changedBy: h.changed_by, changedAt: h.changed_at })),
  });
}

/**
 * 수수료율 변경(플랫폼 · PG 카드 · PG 카카오페이). 바뀐 값만 저장하고 platform_setting_history 에
 * 누가 언제 무엇을 바꿨는지 남긴다. 이미 생긴 주문은 주문에 고정된 수수료율을 쓰므로 영향이 없다.
 */
async function setFeeRates(db: any, operator: string, body: any) {
  // 픽스폴리오(플랫폼) 수수료는 5% 고정이라 바꾸지 않는다. PG 수수료만 바꾼다.
  const input: Record<string, unknown> = { pgCard: body.pgCard, pgKakaopay: body.pgKakaopay };
  if (body.platform !== undefined && body.platform !== null && body.platform !== "" && Number(body.platform) !== PLATFORM_RATE) {
    return err(`픽스폴리오 수수료는 ${PLATFORM_RATE}%로 고정되어 있어요.`);
  }
  const current = await currentFeeRates(db);
  const changes: { key: string; oldValue: string; newValue: string }[] = [];
  for (const [field, key] of Object.entries(FEE_SETTING_KEYS)) {
    if (field === "platform") continue;
    if (input[field] === undefined || input[field] === null || input[field] === "") continue;
    const n = Math.round(Number(input[field]) * 100) / 100;
    if (!Number.isFinite(n) || n < 0 || n >= 50) return err("수수료율은 0 이상 50 미만의 숫자로 입력해 주세요.");
    const old = (current as any)[field];
    if (n !== old) changes.push({ key, oldValue: String(old), newValue: String(n) });
  }
  if (changes.length === 0) return Response.json({ ok: true, feeRates: current });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of changes) {
      await client.query(
        `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [c.key, c.newValue, operator],
      );
      await client.query(
        `INSERT INTO platform_setting_history (key, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4)`,
        [c.key, c.oldValue, c.newValue, operator],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return Response.json({ ok: true, feeRates: await currentFeeRates(db) });
}

async function adminAction(db: any, operator: string, body: any) {
  const action = String(body.action || "");
  if (action === "set_fee_rates") return await setFeeRates(db, operator, body);

  if (action === "admin_refund") {
    const id = clip(body.orderId, 120);
    const reason = clip(body.reason, 200) || "운영자 환불";
    // 운영자는 구매확정된 주문도 환불할 수 있다(이때 수수료는 취소된다).
    const r = await cancelOrderFully(db, id, {
      actorType: "operator", actor: operator, reason,
      allowed: ["paid", "preparing", "shipped", "delivered", "return_requested", "confirmed"],
      inTransaction: async (client) => {
        await client.query(
          `UPDATE affiliate_store_returns SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
           WHERE order_id = $1 AND status IN ('requested', 'approved')`, [id]);
      },
    });
    if (r.ok === false) return err(r.error, r.status);
    if (!r.alreadyCancelled) {
      await notifyBuyer(db, r.order.buyer_user_id, "refunded", "주문이 전액 환불되었어요", `${r.order.product_name} · 픽스폴리오 고객센터 처리`, id);
      await notify(db, {
        recipientType: "brand", recipient: r.order.business_username, kind: "operator_refund",
        title: "운영팀이 주문을 환불 처리했어요", body: `${r.order.product_name} · ${reason}`, link: BRAND_LINK,
      });
    }
    return Response.json({ ok: true });
  }

  if (action === "admin_return_reject") {
    // 승인 뒤 분쟁 처리: 운영자는 승인된 반품도 거절할 수 있다.
    const r = await rejectReturn(db, clip(body.orderId, 120), {
      actorType: "operator", actor: operator, reason: clip(body.reason, 500), allowed: ["requested", "approved"],
    });
    if (r) return r;
    return Response.json({ ok: true });
  }

  if (action === "admin_remind") {
    const kind = body.kind === "inquiry" ? "inquiry" : "return";
    const id = clip(body.id, 120);
    let brand = "", label = "";
    if (kind === "return") {
      const rows = (await db.sql`
        SELECT r.business_username, o.product_name FROM affiliate_store_returns r JOIN affiliate_store_orders o ON o.id = r.order_id
        WHERE r.order_id = ${id}`) as any[];
      if (!rows[0]) return err("반품 요청을 찾을 수 없습니다.", 404);
      brand = rows[0].business_username; label = rows[0].product_name;
    } else {
      const rows = (await db.sql`SELECT business_username, product_name FROM affiliate_store_inquiries WHERE id = ${id}`) as any[];
      if (!rows[0]) return err("문의를 찾을 수 없습니다.", 404);
      brand = rows[0].business_username; label = rows[0].product_name;
    }
    await notify(db, {
      recipientType: "brand", recipient: brand, kind: `remind_${kind}`,
      title: kind === "return" ? "처리되지 않은 반품 요청이 있어요" : "답변하지 않은 구매자 문의가 있어요",
      body: `${label} · 3영업일이 지났어요. 빠르게 처리해 주세요.`, link: BRAND_LINK,
    });
    await logEvent(db, kind === "return" ? id : `inquiry:${id}`, "operator", operator, `remind_${kind}`, `${brand} 재알림`);
    return Response.json({ ok: true });
  }
  return err("알 수 없는 요청입니다.");
}

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  else if (req.method !== "GET") return err("Method not allowed", 405);
  const scope = req.method === "GET" ? url.searchParams.get("scope") : null;
  const action = String(body?.action || "");

  try {
    if (scope === "admin-issues" || action.startsWith("admin_") || action === "set_fee_rates") {
      const op = await requireOperator(req);
      if (op.ok === false) return op.response;
      if (scope === "admin-issues") return await adminIssues(db);
      return await adminAction(db, op.username || "operator", body);
    }

    const caller = await requireSignedInUser(req);
    if (caller.ok === false) return caller.response;
    const brand = String(caller.username || "").toLowerCase().replace(/^biz\//, "");
    if (!brand) return err("브랜드 계정으로 로그인해 주세요.", 403);
    if (!canUseStore(brand) && !caller.isAdmin) return err("아직 오픈 전인 메뉴입니다.", 403);
    const app = (await db.sql`SELECT status FROM affiliate_store_applications WHERE business_username = ${brand}`) as any[];
    if (app[0]?.status !== "approved") return err("입점 승인 후 이용할 수 있어요.", 403);

      if (scope === "brand") return await brandGet(db, brand, url);
    if (req.method === "POST") return await brandAction(db, brand, body);
    return err("알 수 없는 요청입니다.");
  } catch (e: any) {
    console.error("[affiliate-store-ops] failed", action || scope, e?.code || e?.name || "");
    return err("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
};

export const config: Config = {
  path: "/api/affiliate-store-ops",
};
