import { getDatabase } from "@picks/netlify-database";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { createHash, randomBytes } from "node:crypto";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";
import { resolveContentType, safeExtension } from "./_shared/upload-media.mts";
import {
  BUYER_CANCELLABLE,
  LIVE_ORDER_STATUSES,
  RETURN_WINDOW_DAYS,
  cancelOrderFully,
  logEvent,
  notify,
  trackingUrl,
} from "./_shared/affiliate-store-orders.mts";

/**
 * 구매자 마이페이지(/my/orders) API. 카카오 로그인한 사용자 본인 것만 다룬다.
 *
 *   GET  ?scope=me              구매자 계정(처음이면 만든다) · 저장된 배송지 · 안 읽은 알림 수
 *   GET  ?scope=orders          내 주문(최신순)
 *   GET  ?scope=order&id=       주문 상세(처리 내역 · 반품 · 문의 · 판매자 · 추천 인플루언서)
 *   GET  ?scope=inquiries       내 문의
 *   GET  ?scope=notifications   내 알림
 *   POST { action: cancel | confirm | return_request | inquiry | read_notifications }
 *   POST multipart(photo)       반품 사진 업로드
 *
 * 남의 주문 ID 로 부르면 404 다(있다는 것도 알려 주지 않는다).
 */

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const err = (message: string, status = 400) => Response.json({ error: message }, { status });
const newId = (p: string) => `${p}_${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;

const CANCEL_REASONS = ["단순 변심", "옵션 잘못 선택", "배송 지연", "기타"];
const RETURN_REASONS = ["단순 변심", "상품 불량", "오배송", "기타"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const daysSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400_000 : Infinity);

function shapeListOrder(o: any) {
  return {
    id: o.id,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    productName: o.product_name,
    productImage: Array.isArray(o.image_urls) ? o.image_urls[0] || "" : "",
    optionName: o.option_name,
    quantity: o.quantity,
    totalAmount: o.total_amount,
    status: o.status,
  };
}

async function loadOwnOrder(db: any, id: string, userId: string) {
  const rows = (await db.sql`
    SELECT o.*, p.image_urls, p.deleted_at AS product_deleted_at, a.brand_name, a.business_name, a.business_number,
           a.ceo_name, a.business_address, a.cs_phone, a.contact_phone
    FROM affiliate_store_orders o
    JOIN affiliate_store_products p ON p.id = o.product_id
    LEFT JOIN affiliate_store_applications a ON a.business_username = o.business_username
    WHERE o.id = ${id} AND o.buyer_user_id = ${userId} AND o.status = ANY(${LIVE_ORDER_STATUSES}::text[])
  `) as any[];
  return rows[0] || null;
}

async function orderDetail(db: any, id: string, userId: string) {
  const o = await loadOwnOrder(db, id, userId);
  if (!o) return err("주문을 찾을 수 없습니다.", 404);
  const [events, returns, inquiries] = await Promise.all([
    db.sql`SELECT actor_type, action, note, created_at FROM affiliate_store_order_events WHERE order_id = ${id} ORDER BY created_at` as Promise<any[]>,
    db.sql`SELECT * FROM affiliate_store_returns WHERE order_id = ${id}` as Promise<any[]>,
    db.sql`SELECT * FROM affiliate_store_inquiries WHERE order_id = ${id} AND buyer_user_id = ${userId} ORDER BY created_at DESC` as Promise<any[]>,
  ]);
  const ret = returns[0];
  const inWindow = daysSince(o.delivered_at) <= RETURN_WINDOW_DAYS;
  return Response.json({
    order: {
      ...shapeListOrder(o),
      code: o.link_code,
      productId: o.product_id,
      unitPrice: o.unit_price,
      productAmount: o.unit_price * o.quantity,
      shippingFee: o.shipping_fee,
      payMethod: o.pay_method === "KAKAOPAY" ? "카카오페이" : "신용·체크카드",
      recipientName: o.recipient_name,
      recipientPhone: o.recipient_phone,
      postcode: o.postcode,
      address1: o.address1,
      address2: o.address2,
      deliveryMemo: o.delivery_memo,
      trackingCompany: o.tracking_company,
      trackingNumber: o.tracking_number,
      trackingUrl: o.tracking_number ? trackingUrl(o.tracking_company, o.tracking_number) : "",
      shippedAt: o.shipped_at,
      deliveredAt: o.delivered_at,
      confirmedAt: o.confirmed_at,
      cancelledAt: o.cancelled_at,
      cancelledBy: o.cancelled_by,
      cancelReason: o.cancel_reason,
      refundAmount: o.refund_amount,
      influencer: o.influencer_username,
      seller: {
        brandName: o.brand_name || "",
        businessName: o.business_name || "",
        businessNumber: o.business_number || "",
        ceoName: o.ceo_name || "",
        phone: o.cs_phone || o.contact_phone || "",
        address: o.business_address || "",
      },
      // 화면이 버튼을 고르는 기준. 서버에서도 같은 조건으로 다시 막는다.
      canCancel: BUYER_CANCELLABLE.includes(o.status) && !o.tracking_number,
      canReturn: o.status === "delivered" && inWindow && (!ret || ret.status === "rejected"),
      returnExpired: o.status === "delivered" && !inWindow,
      canConfirm: o.status === "delivered",
    },
    events: events.map((e) => ({ actorType: e.actor_type, action: e.action, note: e.note, createdAt: e.created_at })),
    returnRequest: ret ? {
      reason: ret.reason, memo: ret.memo, photoUrls: ret.photo_urls || [], status: ret.status,
      returnAddress: ret.return_address, pickupMessage: ret.pickup_message, rejectReason: ret.reject_reason,
      requestedAt: ret.requested_at, decidedAt: ret.decided_at, refundedAt: ret.refunded_at,
    } : null,
    inquiries: inquiries.map(shapeInquiry),
  });
}

function shapeInquiry(q: any) {
  return {
    id: q.id, productName: q.product_name, orderId: q.order_id, body: q.body, answer: q.answer,
    answeredAt: q.answered_at, createdAt: q.created_at, brandName: q.brand_name ?? undefined,
  };
}

async function buyerCancel(db: any, userId: string, body: any) {
  const id = clip(body.id, 120);
  const reason = CANCEL_REASONS.includes(body.reason) ? body.reason : "";
  if (!reason) return err("취소 사유를 선택해 주세요.");
  const memo = clip(body.memo, 500);
  if (reason === "기타" && !memo) return err("기타 사유를 적어 주세요.");
  // 송장이 들어간 주문은 바로 취소하지 않는다(배송이 시작됨).
  const cur = await loadOwnOrder(db, id, userId);
  if (!cur) return err("주문을 찾을 수 없습니다.", 404);
  if (cur.tracking_number && cur.status !== "cancelled") return err("배송이 시작되어 바로 취소할 수 없어요. 판매자에게 문의해 주세요.");
  const r = await cancelOrderFully(db, id, {
    actorType: "buyer", actor: userId, reason, memo, allowed: BUYER_CANCELLABLE, buyerUserId: userId,
  });
  if (r.ok === false) return err(r.error, r.status);
  if (!r.alreadyCancelled) {
    await notify(db, {
      recipientType: "brand", recipient: r.order.business_username, kind: "buyer_cancel",
      title: "구매자가 주문을 취소했어요",
      body: `${r.order.product_name} ${r.order.quantity}개 · ${reason} · 전액 환불 완료`,
      link: "/business-admin?tab=affiliate",
    });
  }
  return Response.json({ ok: true });
}

async function buyerConfirm(db: any, userId: string, body: any) {
  const id = clip(body.id, 120);
  const rows = (await db.sql`
    UPDATE affiliate_store_orders SET status = 'confirmed', confirmed_at = NOW(),
      commission_status = 'confirmed', commission_confirmed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND buyer_user_id = ${userId} AND status = 'delivered'
    RETURNING id
  `) as any[];
  if (!rows[0]) return err("배송 완료된 주문만 구매확정할 수 있어요.");
  await logEvent(db, id, "buyer", userId, "confirmed", "구매확정");
  return Response.json({ ok: true });
}

async function buyerReturn(db: any, userId: string, body: any) {
  const id = clip(body.id, 120);
  const reason = RETURN_REASONS.includes(body.reason) ? body.reason : "";
  if (!reason) return err("반품 사유를 선택해 주세요.");
  const memo = clip(body.memo, 1000);
  const photos = (Array.isArray(body.photoUrls) ? body.photoUrls : [])
    .map((u: unknown) => clip(u, 500))
    .filter((u: string) => u.startsWith("/api/images/affiliate-returns/"))
    .slice(0, 5);
  const o = await loadOwnOrder(db, id, userId);
  if (!o) return err("주문을 찾을 수 없습니다.", 404);
  if (o.status !== "delivered") return err("배송 완료된 주문만 교환·반품을 요청할 수 있어요.");
  if (daysSince(o.delivered_at) > RETURN_WINDOW_DAYS) return err("반품 가능 기간이 지났어요. 판매자에게 문의해 주세요.");

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const locked = (await client.query(`SELECT status FROM affiliate_store_orders WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (locked?.status !== "delivered") { await client.query("ROLLBACK"); return err("이미 요청했거나 처리할 수 없는 주문입니다."); }
    const existing = (await client.query(`SELECT status FROM affiliate_store_returns WHERE order_id = $1`, [id])).rows[0];
    if (existing && existing.status !== "rejected") { await client.query("ROLLBACK"); return err("이미 교환·반품을 요청한 주문입니다."); }
    await client.query(
      `INSERT INTO affiliate_store_returns (id, order_id, business_username, buyer_user_id, reason, memo, photo_urls)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (order_id) DO UPDATE SET reason = EXCLUDED.reason, memo = EXCLUDED.memo, photo_urls = EXCLUDED.photo_urls,
         status = 'requested', return_address = '', pickup_message = '', reject_reason = '', requested_at = NOW(),
         decided_at = NULL, refunded_at = NULL, updated_at = NOW()`,
      [newId("ret"), id, o.business_username, userId, reason, memo, JSON.stringify(photos)],
    );
    // 반품 요청 중인 주문은 구매확정(자동 포함)되지 않는다.
    await client.query(`UPDATE affiliate_store_orders SET status = 'return_requested', brand_seen_at = NULL, updated_at = NOW() WHERE id = $1`, [id]);
    await logEvent(client, id, "buyer", userId, "return_requested", `${reason}${memo ? ` · ${memo}` : ""}${photos.length ? ` · 사진 ${photos.length}장` : ""}`);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await notify(db, {
    recipientType: "brand", recipient: o.business_username, kind: "return_requested",
    title: "교환·반품 요청이 들어왔어요",
    body: `${o.product_name} · ${reason}`,
    link: "/business-admin?tab=affiliate",
  });
  return Response.json({ ok: true });
}

async function buyerInquiry(db: any, userId: string, username: string, body: any) {
  const text = clip(body.body, 2000);
  if (text.length < 2) return err("문의 내용을 적어 주세요.");
  const orderId = clip(body.orderId, 120);
  const code = clip(body.code, 40);
  let brand = "", productId = "", productName = "", buyerName = "";
  if (orderId) {
    const o = await loadOwnOrder(db, orderId, userId);
    if (!o) return err("주문을 찾을 수 없습니다.", 404);
    brand = o.business_username; productId = o.product_id; productName = o.product_name; buyerName = o.buyer_name;
  } else if (code) {
    const rows = (await db.sql`
      SELECT p.id, p.name, p.business_username FROM affiliate_store_requests r
      JOIN affiliate_store_products p ON p.id = r.product_id
      WHERE r.link_code = ${code} AND r.status = 'approved' AND p.deleted_at IS NULL
    `) as any[];
    if (!rows[0]) return err("상품을 찾을 수 없습니다.", 404);
    brand = rows[0].business_username; productId = rows[0].id; productName = rows[0].name;
  } else {
    return err("문의할 상품이나 주문을 찾을 수 없습니다.");
  }
  if (!buyerName) {
    const b = (await db.sql`SELECT buyer_name FROM affiliate_buyers WHERE user_id = ${userId}`) as any[];
    buyerName = b[0]?.buyer_name || username || "구매자";
  }
  const id = newId("inq");
  await db.sql`
    INSERT INTO affiliate_store_inquiries (id, buyer_user_id, buyer_name, business_username, product_id, product_name, order_id, body)
    VALUES (${id}, ${userId}, ${buyerName}, ${brand}, ${productId}, ${productName}, ${orderId}, ${text})
  `;
  await notify(db, {
    recipientType: "brand", recipient: brand, kind: "new_inquiry",
    title: "새 구매자 문의가 있어요", body: `${productName} · ${text.slice(0, 60)}`, link: "/business-admin?tab=affiliate",
  });
  return Response.json({ ok: true, id }, { status: 201 });
}

async function uploadPhoto(req: Request, userId: string) {
  const limited = await checkRateLimit({ bucket: "aff-return-photo", key: clientIp(req), limit: 30, windowSeconds: 600, message: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." });
  if (!limited.ok) return limited.response;
  const form = await req.formData();
  const file = form.get("photo") as File | null;
  if (!file) return err("사진을 선택해 주세요.");
  if (file.size > MAX_PHOTO_BYTES) return err("사진은 5MB 이하로 올려 주세요.", 413);
  const contentType = resolveContentType(file.name, file.type);
  if (!contentType || !contentType.startsWith("image/")) return err("이미지 파일만 올릴 수 있어요.", 415);
  // 구매자 ID 원문은 경로에 넣지 않는다.
  const owner = createHash("sha256").update(userId).digest("hex").slice(0, 16);
  const key = `affiliate-returns/${owner}/${Date.now()}-${randomBytes(4).toString("hex")}.${safeExtension(file.name) || "jpg"}`;
  await getStore("images").set(key, await file.arrayBuffer(), { metadata: { contentType } });
  return Response.json({ url: `/api/images/${key}` });
}

export default async (req: Request) => {
  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller.response;
  const userId = caller.userId;
  const username = String(caller.username || "").toLowerCase();
  const db: any = getDatabase();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const scope = url.searchParams.get("scope");
      if (scope === "me") {
        // 처음 들어온 구매자는 여기서 구매자 기록(배송지 · 알림)이 만들어진다. 같은 카카오 계정이
        // 구매자이면서 인플루언서일 수 있다 — 아이디 생성은 막지 않는다.
        const accountType = username ? "member" : "buyer";
        await db.sql`
          INSERT INTO affiliate_buyers (user_id, username, account_type) VALUES (${userId}, ${username}, ${accountType})
          ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username,
            account_type = CASE WHEN EXCLUDED.username <> '' THEN 'member' ELSE affiliate_buyers.account_type END
        `;
        const [b, unread] = await Promise.all([
          db.sql`SELECT * FROM affiliate_buyers WHERE user_id = ${userId}` as Promise<any[]>,
          db.sql`SELECT COUNT(*)::int AS n FROM affiliate_store_notifications WHERE recipient_type = 'buyer' AND recipient = ${userId} AND read_at IS NULL` as Promise<any[]>,
        ]);
        const r = b[0] || {};
        return Response.json({
          username,
          unreadNotifications: unread[0]?.n || 0,
          saved: {
            buyerName: r.buyer_name || "", buyerPhone: r.buyer_phone || "", buyerEmail: r.buyer_email || "",
            recipientName: r.recipient_name || "", recipientPhone: r.recipient_phone || "", postcode: r.postcode || "",
            address1: r.address1 || "", address2: r.address2 || "", deliveryMemo: r.delivery_memo || "",
          },
        });
      }
      if (scope === "orders") {
        const rows = (await db.sql`
          SELECT o.*, p.image_urls FROM affiliate_store_orders o JOIN affiliate_store_products p ON p.id = o.product_id
          WHERE o.buyer_user_id = ${userId} AND o.status = ANY(${LIVE_ORDER_STATUSES}::text[])
          ORDER BY o.created_at DESC LIMIT 300
        `) as any[];
        return Response.json({ orders: rows.map(shapeListOrder) });
      }
      if (scope === "order") return await orderDetail(db, clip(url.searchParams.get("id"), 120), userId);
      if (scope === "inquiries") {
        const rows = (await db.sql`
          SELECT q.*, a.brand_name FROM affiliate_store_inquiries q
          LEFT JOIN affiliate_store_applications a ON a.business_username = q.business_username
          WHERE q.buyer_user_id = ${userId} ORDER BY q.created_at DESC LIMIT 300
        `) as any[];
        await db.sql`UPDATE affiliate_store_inquiries SET buyer_seen_at = NOW() WHERE buyer_user_id = ${userId} AND answered_at IS NOT NULL AND buyer_seen_at IS NULL`;
        return Response.json({ inquiries: rows.map(shapeInquiry) });
      }
      if (scope === "notifications") {
        const rows = (await db.sql`
          SELECT id, kind, title, body, link, read_at, created_at FROM affiliate_store_notifications
          WHERE recipient_type = 'buyer' AND recipient = ${userId} ORDER BY created_at DESC LIMIT 100
        `) as any[];
        return Response.json({ notifications: rows });
      }
      return err("알 수 없는 요청입니다.");
    }
    if (req.method !== "POST") return err("Method not allowed", 405);

    if ((req.headers.get("content-type") || "").startsWith("multipart/form-data")) return await uploadPhoto(req, userId);

    const body = (await req.json().catch(() => ({}))) as any;
    switch (String(body?.action || "")) {
      case "cancel": return await buyerCancel(db, userId, body);
      case "confirm": return await buyerConfirm(db, userId, body);
      case "return_request": return await buyerReturn(db, userId, body);
      case "inquiry": {
        const limited = await checkRateLimit({ bucket: "aff-inquiry", key: userId, limit: 20, windowSeconds: 3600, message: "문의가 너무 많습니다. 잠시 후 다시 시도해 주세요." });
        if (!limited.ok) return limited.response;
        return await buyerInquiry(db, userId, username, body);
      }
      case "read_notifications":
        await db.sql`UPDATE affiliate_store_notifications SET read_at = NOW() WHERE recipient_type = 'buyer' AND recipient = ${userId} AND read_at IS NULL`;
        return Response.json({ ok: true });
      default: return err("알 수 없는 요청입니다.");
    }
  } catch (e: any) {
    console.error("[affiliate-buyer] failed", e?.code || e?.name || "");
    return err("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
};

export const config: Config = {
  path: "/api/affiliate-buyer",
};
