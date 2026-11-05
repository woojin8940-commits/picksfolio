import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireOperator } from "./_shared/manager-auth.mts";
import {
  STORE_TESTERS,
  FEE_SETTING_KEYS,
  brandSettlement,
  currentFeeRates,
  businessDaysSince,
  inquiriesLink,
  orderLink,
  sendBuyerSms,
  cancelOrderFully,
  checkoutOpen,
  logEvent,
  notify,
  trackingUrl,
} from "./_shared/affiliate-store-orders.mts";

/**
 * 어필리에이트 스토어 주문 운영 — 브랜드 주문 관리 · 취소 · 교환/반품 · 문의, 운영자 미처리 목록.
 *
 *   GET  ?scope=brand          브랜드: 내 주문(반품 포함) · 문의 · 알림
 *   GET  ?scope=admin-issues   운영자: 3영업일 넘게 처리되지 않은 반품 · 문의 + 결제 가드 + 처리 기록
 *   POST { action, ... }
 *     브랜드  prepare · ship · deliver · cancel · return_approve · return_reject · return_refund
 *             · answer_inquiry · read_notifications · mark_seen
 *     운영자  admin_refund · admin_remind · set_checkout_open · set_fee_rates
 *
 * 브랜드는 자기 브랜드 주문만, 운영자는 전체를 본다. 환불은 모두 cancelOrderFully
 * (포트원 취소 → 재고 복구 → 수수료 취소, 멱등)를 거친다.
 */

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const err = (message: string, status = 400) => Response.json({ error: message }, { status });
const OVERDUE_BUSINESS_DAYS = 3;
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
    } : null,
  };
}

// ─────────────────────────── 브랜드 ───────────────────────────

async function brandGet(db: any, brand: string) {
  const [orders, inquiries, notifications] = await Promise.all([
    db.sql`
      SELECT o.*, r.status AS ret_status, r.reason AS ret_reason, r.memo AS ret_memo, r.photo_urls AS ret_photos,
             r.return_address AS ret_address, r.pickup_message AS ret_pickup, r.reject_reason AS ret_reject,
             r.requested_at AS ret_requested_at, r.decided_at AS ret_decided_at, r.refunded_at AS ret_refunded_at
      FROM affiliate_store_orders o
      LEFT JOIN affiliate_store_returns r ON r.order_id = o.id
      WHERE o.business_username = ${brand} AND o.status <> 'pending_payment'
      ORDER BY o.created_at DESC LIMIT 1000
    ` as Promise<any[]>,
    db.sql`
      SELECT * FROM affiliate_store_inquiries WHERE business_username = ${brand}
      ORDER BY (answered_at IS NULL) DESC, created_at DESC LIMIT 500
    ` as Promise<any[]>,
    db.sql`
      SELECT id, kind, title, body, read_at, created_at FROM affiliate_store_notifications
      WHERE recipient_type = 'brand' AND recipient = ${brand} ORDER BY created_at DESC LIMIT 50
    ` as Promise<any[]>,
  ]);
  return Response.json({
    orders: orders.map(shapeBrandOrder),
    inquiries: inquiries.map((q) => ({
      id: q.id, buyerName: q.buyer_name, productName: q.product_name, orderId: q.order_id, body: q.body,
      answer: q.answer, answeredAt: q.answered_at, createdAt: q.created_at,
    })),
    notifications,
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
    const o = await setStatus(db, brand, id, ["shipped"], "delivered", "delivered");
    if (!o) return err("배송 중인 주문만 배송 완료로 바꿀 수 있어요.");
    await logEvent(db, id, "brand", brand, "delivered", "배송 완료");
    await notifyBuyer(db, o.buyer_user_id, "delivered", "배송이 완료되었어요", `${o.product_name} · 7일 이내 교환·반품을 요청할 수 있어요.`, id);
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
    const address = clip(body.returnAddress, 300);
    const message = clip(body.pickupMessage, 1000);
    if (!address) return err("반품 받을 주소를 입력해 주세요.");
    const rows = (await db.sql`
      UPDATE affiliate_store_returns SET status = 'approved', return_address = ${address}, pickup_message = ${message},
        decided_at = NOW(), updated_at = NOW()
      WHERE order_id = ${id} AND business_username = ${brand} AND status = 'requested' RETURNING buyer_user_id
    `) as any[];
    if (!rows[0]) return err("승인할 반품 요청이 없습니다.");
    await logEvent(db, id, "brand", brand, "return_approved", `반품 주소: ${address}${message ? ` · ${message}` : ""}`);
    await notifyBuyer(db, rows[0].buyer_user_id, "return_approved", "반품 요청이 승인되었어요", "주문 상세에서 반품 주소와 회수 안내를 확인해 주세요.", id);
    await smsForOrder(db, id, `반품 요청이 승인되었습니다. 반품 주소: ${address}${message ? ` / ${message}` : ""}`);
    return Response.json({ ok: true });
  }

  if (action === "return_reject") {
    const reason = clip(body.rejectReason, 500);
    if (!reason) return err("거절 사유를 입력해 주세요.");
    const client = await db.pool.connect();
    let buyerUserId = "";
    try {
      await client.query("BEGIN");
      const ret = (await client.query(
        `UPDATE affiliate_store_returns SET status = 'rejected', reject_reason = $3, decided_at = NOW(), updated_at = NOW()
         WHERE order_id = $1 AND business_username = $2 AND status IN ('requested', 'approved') RETURNING buyer_user_id`,
        [id, brand, reason],
      )).rows[0];
      if (!ret) { await client.query("ROLLBACK"); return err("거절할 반품 요청이 없습니다."); }
      buyerUserId = ret.buyer_user_id;
      // 주문은 배송 완료로 되돌린다. 반품 기간이 지났으면 자동 구매확정 대상이 된다.
      await client.query(`UPDATE affiliate_store_orders SET status = 'delivered', updated_at = NOW() WHERE id = $1 AND status = 'return_requested'`, [id]);
      await logEvent(client, id, "brand", brand, "return_rejected", reason);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    await notifyBuyer(db, buyerUserId, "return_rejected", "반품 요청이 거절되었어요", reason, id);
    await smsForOrder(db, id, `반품 요청이 거절되었습니다. 사유: ${reason}`);
    return Response.json({ ok: true });
  }

  if (action === "return_refund") {
    const ret = (await db.sql`SELECT status FROM affiliate_store_returns WHERE order_id = ${id} AND business_username = ${brand}`) as any[];
    if (!ret[0]) return err("반품 요청을 찾을 수 없습니다.", 404);
    if (ret[0].status === "requested") return err("반품을 먼저 승인하고, 상품 회수를 확인한 뒤 환불해 주세요.");
    if (ret[0].status !== "approved" && ret[0].status !== "refunded") return err("환불할 수 없는 반품 요청입니다.");
    const r = await cancelOrderFully(db, id, {
      actorType: "brand", actor: brand, reason: "반품 환불", allowed: ["return_requested"], businessUsername: brand,
      inTransaction: async (client) => {
        await client.query(`UPDATE affiliate_store_returns SET status = 'refunded', refunded_at = NOW(), updated_at = NOW() WHERE order_id = $1`, [id]);
      },
    });
    if (r.ok === false) return err(r.error, r.status);
    if (!r.alreadyCancelled) await notifyBuyer(db, r.order.buyer_user_id, "refunded", "반품 환불이 완료되었어요", `${r.order.product_name} · ${Number(r.order.total_amount).toLocaleString("ko-KR")}원`, id);
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
    await db.sql`UPDATE affiliate_store_orders SET brand_seen_at = NOW() WHERE business_username = ${brand} AND brand_seen_at IS NULL AND status <> 'pending_payment'`;
    return Response.json({ ok: true });
  }
  return err("알 수 없는 요청입니다.");
}

// ─────────────────────────── 운영자 ───────────────────────────

async function adminIssues(db: any) {
  const [returns, inquiries, actions, open, feeRates, feeHistory] = await Promise.all([
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
    checkoutOpen(db),
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
    returns: overdueReturns, inquiries: overdueInquiries, operatorActions: actions, checkoutOpen: open,
    feeRates, feeHistory: feeHistory.map((h) => ({ key: h.key, oldValue: h.old_value, newValue: h.new_value, changedBy: h.changed_by, changedAt: h.changed_at })),
  });
}

/**
 * 수수료율 변경(플랫폼 · PG 카드 · PG 카카오페이). 바뀐 값만 저장하고 platform_setting_history 에
 * 누가 언제 무엇을 바꿨는지 남긴다. 이미 생긴 주문은 주문에 고정된 수수료율을 쓰므로 영향이 없다.
 */
async function setFeeRates(db: any, operator: string, body: any) {
  const input: Record<string, unknown> = { platform: body.platform, pgCard: body.pgCard, pgKakaopay: body.pgKakaopay };
  const current = await currentFeeRates(db);
  const changes: { key: string; oldValue: string; newValue: string }[] = [];
  for (const [field, key] of Object.entries(FEE_SETTING_KEYS)) {
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
  if (action === "set_checkout_open") {
    const open = body.open === true ? "true" : "false";
    await db.sql`
      INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('affiliate_store_checkout_open', ${open}, ${operator}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    `;
    await logEvent(db, "settings", "operator", operator, "checkout_open", open);
    return Response.json({ ok: true, checkoutOpen: open === "true" });
  }

  if (action === "admin_refund") {
    const id = clip(body.orderId, 120);
    const reason = clip(body.reason, 200) || "운영자 환불";
    const r = await cancelOrderFully(db, id, {
      actorType: "operator", actor: operator, reason,
      allowed: ["paid", "preparing", "shipped", "delivered", "return_requested"],
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
    if (scope === "admin-issues" || action.startsWith("admin_") || action === "set_checkout_open" || action === "set_fee_rates") {
      const op = await requireOperator(req);
      if (op.ok === false) return op.response;
      if (scope === "admin-issues") return await adminIssues(db);
      return await adminAction(db, op.username || "operator", body);
    }

    const caller = await requireSignedInUser(req);
    if (caller.ok === false) return caller.response;
    const brand = String(caller.username || "").toLowerCase().replace(/^biz\//, "");
    if (!brand) return err("브랜드 계정으로 로그인해 주세요.", 403);
    if (!STORE_TESTERS.has(brand) && !caller.isAdmin) return err("아직 오픈 전인 메뉴입니다.", 403);
    const app = (await db.sql`SELECT status FROM affiliate_store_applications WHERE business_username = ${brand}`) as any[];
    if (app[0]?.status !== "approved") return err("입점 승인 후 이용할 수 있어요.", 403);

    if (scope === "brand") return await brandGet(db, brand);
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
