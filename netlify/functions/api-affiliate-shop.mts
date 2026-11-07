import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { randomBytes } from "node:crypto";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { finalizePaidOrder, pgRateFor, platformRate } from "./_shared/affiliate-store-orders.mts";

/**
 * 어필리에이트 공개 상품 페이지(/shop/<코드>)의 주문 · 결제. 로그인 없이 쓴다.
 *
 *   GET  /api/affiliate-shop?code=<코드>                 상품 · 브랜드 · 인플루언서
 *   GET  /api/affiliate-shop?code=<코드>&order=<주문번호>  주문 상태(결제 후 돌아온 화면 · 구매자 본인)
 *   POST { action: 'click', code }                       방문 기록
 *   POST { action: 'create_order', code, ... }           (로그인) 결제 전 주문서 → 주문번호 · 금액
 *   POST { action: 'complete', orderId }                 (로그인) 포트원 결제 검증 → 결제완료 · 재고 차감
 *
 * 결제 확인은 포트원 웹훅(portone-webhook)과 시간별 점검(scheduled-affiliate-store-confirm)도
 * 같은 함수(finalizePaidOrder)로 한다 — 구매자가 결제 후 창을 닫아도 주문이 빠지지 않는다.
 *
 * 상품 페이지는 로그인 없이 보지만, 주문은 카카오 로그인한 구매자 계정(Supabase user id)에
 * 묶어 저장한다. 로그인한 구매자는 누구나 결제할 수 있다.
 *
 * 주문번호가 곧 포트원 paymentId 다. 금액은 서버가 계산해 저장하고, 결제 검증 때 포트원에
 * 실제로 결제된 금액이 그 값과 같아야만 결제완료로 바꾼다 — 화면이 보낸 금액은 믿지 않는다.
 * 결제완료된 주문은 링크 코드의 인플루언서 판매로 잡힌다(수수료는 주문 시점 값으로 고정).
 */

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const err = (message: string, status = 400) => Response.json({ error: message }, { status });
const CODE_RE = /^[A-Za-z0-9]{6,32}$/;
/** 한 번에 고를 수 있는 수량 상한. 재고와 상관없이 고정이며, 재고 부족은 주문서 · 결제 단계에서만 알린다. */
const MAX_QUANTITY = 10;

/** 링크가 살아 있는 조건: 승인된 신청(운영자가 닫지 않은 링크) · 판매중 상품 · 승인된 브랜드. */
async function loadLink(db: any, code: string) {
  if (!CODE_RE.test(code)) return null;
  const rows = (await db.sql`
    SELECT r.id AS request_id, r.influencer_username, r.link_code, r.status AS request_status,
           p.*, a.brand_name, a.business_name, a.business_number, a.ceo_name, a.business_address,
           a.cs_phone, a.contact_phone, a.mail_order_number, a.inquiry_url
    FROM affiliate_store_requests r
    JOIN affiliate_store_products p ON p.id = r.product_id
    JOIN affiliate_store_applications a ON a.business_username = p.business_username
    WHERE r.link_code = ${code}
      AND r.status = 'approved' AND r.manager_status = 'done' AND a.status = 'approved'
      AND p.deleted_at IS NULL
  `) as any[];
  return rows[0] || null;
}

function publicProduct(r: any) {
  return {
    code: r.link_code,
    influencer: r.influencer_username,
    brandName: r.brand_name,
    id: r.id,
    name: r.name,
    category: r.category,
    subcategory: r.subcategory || "",
    summary: r.summary,
    description: r.description,
    imageUrls: Array.isArray(r.image_urls) ? r.image_urls : [],
    detailImageUrls: Array.isArray(r.detail_image_urls) ? r.detail_image_urls : [],
    sizeGuide: r.size_guide || "",
    deliveryGuide: r.delivery_guide || "",
    descriptionImageUrls: Array.isArray(r.description_image_urls) ? r.description_image_urls : [],
    sizeGuideImageUrls: Array.isArray(r.size_guide_image_urls) ? r.size_guide_image_urls : [],
    deliveryGuideImageUrls: Array.isArray(r.delivery_guide_image_urls) ? r.delivery_guide_image_urls : [],
    options: (Array.isArray(r.options) ? r.options : []).map((o: any) => ({ name: String(o.name), soldOut: !(Number(o.stock) > 0) })),
    retailPrice: Number(r.retail_price) || 0,
    salePrice: Number(r.sale_price) || 0,
    shippingFee: Number(r.shipping_fee) || 0,
    onSale: r.status === "on_sale" && Number(r.stock) > 0,
    // 재고 수량이 화면에 드러나지 않도록 고정 상한을 준다. 재고 부족은 주문 · 결제 때 안내한다.
    maxQuantity: MAX_QUANTITY,
    // 상품 페이지 "판매자 정보 보기"(전자상거래법 표시 항목). 입점 신청서 · 판매자 정보 값.
    seller: {
      businessName: r.business_name || "",
      businessNumber: r.business_number || "",
      ceoName: r.ceo_name || "",
      address: r.business_address || "",
      phone: r.cs_phone || "",
      mailOrderNumber: r.mail_order_number || "",
    },
    // 구매자 "문의하기" → 브랜드 자사몰 · 고객센터(https:// 주소만 저장된다).
    inquiryUrl: /^https:\/\//i.test(String(r.inquiry_url || "")) ? r.inquiry_url : "",
  };
}

function publicOrder(o: any) {
  return {
    id: o.id,
    status: o.status,
    productName: o.product_name,
    optionName: o.option_name,
    quantity: o.quantity,
    totalAmount: o.total_amount,
    recipientName: o.recipient_name,
    paidAt: o.paid_at,
  };
}

async function createOrder(db: any, body: any, buyer: { userId: string; username: string }) {
  const link = await loadLink(db, clip(body.code, 40));
  if (!link) return err("판매가 끝났거나 없는 링크입니다.", 404);
  if (link.status !== "on_sale") return err("지금은 판매하지 않는 상품입니다.");
  // 인플루언서가 자기 링크로 사면 수수료가 그대로 본인에게 돌아간다(브랜드 부담 할인). 막는다.
  const self = buyer.username.replace(/^biz\//, "");
  if (self && self === String(link.influencer_username || "").toLowerCase()) {
    return err("내 링크로는 구매할 수 없어요. 다른 판매 경로를 이용해 주세요.", 403);
  }

  const quantity = Math.round(Number(body.quantity));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return err(`수량은 1~${MAX_QUANTITY}개로 선택해 주세요.`);

  const options = Array.isArray(link.options) ? link.options : [];
  let optionName = "";
  if (options.length > 0) {
    const opt = options.find((o: any) => String(o.name) === String(body.option || ""));
    if (!opt) return err("옵션을 선택해 주세요.");
    if (Number(opt.stock) < quantity) return err(`선택한 옵션의 재고가 부족합니다. (남은 수량 ${Number(opt.stock) || 0}개)`);
    optionName = String(opt.name);
  } else if (Number(link.stock) < quantity) {
    return err(`재고가 부족합니다. (남은 수량 ${Number(link.stock) || 0}개)`);
  }

  const buyerName = clip(body.buyerName, 50);
  const buyerPhone = clip(body.buyerPhone, 20);
  const buyerEmail = clip(body.buyerEmail, 200);
  const recipientName = clip(body.recipientName, 50) || buyerName;
  const recipientPhone = clip(body.recipientPhone, 20) || buyerPhone;
  const postcode = clip(body.postcode, 10);
  const address1 = clip(body.address1, 300);
  const address2 = clip(body.address2, 200);
  const deliveryMemo = clip(body.deliveryMemo, 200);
  const payMethod = body.payMethod === "KAKAOPAY" ? "KAKAOPAY" : "CARD";

  if (!buyerName) return err("주문자 이름을 입력해 주세요.");
  if (buyerPhone.replace(/\D/g, "").length < 9) return err("주문자 연락처를 정확히 입력해 주세요.");
  if (buyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) return err("이메일 주소를 확인해 주세요.");
  if (recipientPhone.replace(/\D/g, "").length < 9) return err("받는 분 연락처를 정확히 입력해 주세요.");
  if (!address1) return err("배송 주소를 입력해 주세요.");
  if (body.agreeTerms !== true) return err("구매 조건 확인에 동의해 주세요.");
  if (body.agreeProvide !== true) return err("판매자에게 배송 목적 개인정보 제공에 동의해 주세요.");

  const unitPrice = Number(link.sale_price) || 0;
  const shippingFee = Number(link.shipping_fee) || 0;
  const totalAmount = unitPrice * quantity + shippingFee;
  if (totalAmount < 100) return err("결제 금액이 올바르지 않습니다.");
  const commissionRate = Number(link.commission_rate) || 0;
  // 수수료는 상품 금액에만 붙인다(배송비 제외).
  const commissionAmount = Math.floor((unitPrice * quantity * commissionRate) / 100);

  // 포트원 paymentId 는 ASCII 만 받는다. 코드 · 시각 · 난수로 만든다.
  const id = `aff-${link.link_code}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  await db.sql`
    INSERT INTO affiliate_store_orders
      (id, request_id, product_id, business_username, influencer_username, link_code, product_name, option_name,
       quantity, unit_price, shipping_fee, total_amount, commission_rate, commission_amount,
       buyer_name, buyer_phone, buyer_email, recipient_name, recipient_phone, postcode, address1, address2,
       delivery_memo, pay_method, buyer_user_id, platform_rate, pg_rate, commission_status)
    VALUES
      (${id}, ${link.request_id}, ${link.id}, ${link.business_username}, ${link.influencer_username}, ${link.link_code},
       ${link.name}, ${optionName}, ${quantity}, ${unitPrice}, ${shippingFee}, ${totalAmount}, ${commissionRate},
       ${commissionAmount}, ${buyerName}, ${buyerPhone}, ${buyerEmail}, ${recipientName}, ${recipientPhone},
       ${postcode}, ${address1}, ${address2}, ${deliveryMemo}, ${payMethod}, ${buyer.userId}, ${await platformRate(db)}, ${await pgRateFor(db, payMethod)}, 'pending')
  `;
  // 배송지를 계정에 저장해 다음 구매 때 불러온다.
  await db.sql`
    INSERT INTO affiliate_buyers (user_id, username, buyer_name, buyer_phone, buyer_email,
      recipient_name, recipient_phone, postcode, address1, address2, delivery_memo)
    VALUES (${buyer.userId}, ${buyer.username}, ${buyerName}, ${buyerPhone}, ${buyerEmail},
      ${recipientName}, ${recipientPhone}, ${postcode}, ${address1}, ${address2}, ${deliveryMemo})
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username, buyer_name = EXCLUDED.buyer_name, buyer_phone = EXCLUDED.buyer_phone,
      buyer_email = EXCLUDED.buyer_email, recipient_name = EXCLUDED.recipient_name,
      recipient_phone = EXCLUDED.recipient_phone, postcode = EXCLUDED.postcode, address1 = EXCLUDED.address1,
      address2 = EXCLUDED.address2, delivery_memo = EXCLUDED.delivery_memo, updated_at = NOW()
  `;
  const orderName = `${link.name}${optionName ? ` (${optionName})` : ""}${quantity > 1 ? ` x${quantity}` : ""}`.slice(0, 100);
  return Response.json({
    orderId: id,
    orderName,
    totalAmount,
    payMethod,
    // customerId = 구매자 user id. 결제 확인 때 이 값으로 주문자 본인 결제인지 확인한다(expectedOwner).
    customer: { customerId: buyer.userId, fullName: buyerName, phoneNumber: buyerPhone.replace(/\D/g, ""), email: buyerEmail || undefined },
  }, { status: 201 });
}

/** 결제 확인(구매자 화면). 웹훅 · 시간별 점검과 같은 함수로 처리한다 — 이미 처리된 주문이면 그대로 돌려준다. */
async function completeOrder(db: any, body: any, buyerUserId: string) {
  const orderId = clip(body.orderId, 120);
  const r = await finalizePaidOrder(db, orderId, { buyerUserId, source: "buyer" });
  if (r.ok === false) {
    return r.code ? Response.json({ error: r.error, code: r.code }, { status: r.status }) : err(r.error, r.status);
  }
  // 품절로 자동 환불됐거나 이미 취소된 주문이면 완료 화면 대신 안내를 보여 준다.
  if (r.order?.status === "cancelled") {
    return err("주문이 취소되어 결제 금액이 환불되었어요. 품절 등으로 주문을 진행할 수 없었어요.", 409);
  }
  if (r.order?.status === "expired" || r.order?.status === "pending_payment") {
    return err("결제를 확인하지 못했습니다.", 409);
  }
  return Response.json({ order: publicOrder(r.order) });
}

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const code = clip(url.searchParams.get("code"), 40);
      const orderId = clip(url.searchParams.get("order"), 120);
      if (orderId) {
        const caller = await requireSignedInUser(req);
        if (!caller.ok) return caller.response;
        const rows = (await db.sql`SELECT * FROM affiliate_store_orders WHERE id = ${orderId} AND link_code = ${code} AND buyer_user_id = ${caller.userId}`) as any[];
        if (!rows[0]) return err("주문을 찾을 수 없습니다.", 404);
        return Response.json({ order: publicOrder(rows[0]) });
      }
      const link = await loadLink(db, code);
      if (!link) return err("판매가 끝났거나 없는 링크입니다.", 404);
      return Response.json({ product: publicProduct(link) });
    }
    if (req.method !== "POST") return err("Method not allowed", 405);

    const body = (await req.json().catch(() => ({}))) as any;
    const action = String(body?.action || "");

    if (action === "click") {
      const limited = await checkRateLimit({ bucket: "aff-shop-click", key: clientIp(req), limit: 60, windowSeconds: 600, message: "잠시 후 다시 시도해 주세요." });
      if (!limited.ok) return Response.json({ ok: true });
      const code = clip(body.code, 40);
      if (CODE_RE.test(code)) {
        await db.sql`UPDATE affiliate_store_requests SET click_count = click_count + 1 WHERE link_code = ${code} AND status = 'approved' AND manager_status = 'done'`;
      }
      return Response.json({ ok: true });
    }
    if (action === "create_order") {
      const limited = await checkRateLimit({ bucket: "aff-shop-order", key: clientIp(req), limit: 20, windowSeconds: 600, message: "주문 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." });
      if (!limited.ok) return limited.response;
      const caller = await requireSignedInUser(req);
      if (!caller.ok) return caller.response;
      return await createOrder(db, body, { userId: caller.userId, username: String(caller.username || "").toLowerCase() });
    }
    if (action === "complete") {
      const caller = await requireSignedInUser(req);
      if (!caller.ok) return caller.response;
      return await completeOrder(db, body, caller.userId);
    }
    return err("알 수 없는 요청입니다.");
  } catch (e) {
    console.error("[affiliate-shop] failed", (e as any)?.code || (e as any)?.name || "");
    return err("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
};

export const config: Config = {
  path: "/api/affiliate-shop",
};
