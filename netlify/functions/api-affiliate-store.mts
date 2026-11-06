import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireManager, requireOperator } from "./_shared/manager-auth.mts";
import { CREATOR_APPROVAL_REQUIRED_MESSAGE, readCreatorAccess } from "./_shared/creator-access.mts";
import { randomBytes } from "node:crypto";
import { SALE_STATUSES, STORE_TESTERS, currentFeeRates } from "./_shared/affiliate-store-orders.mts";
import { buildSnapshots, withoutRegisteredPrices } from "./_shared/campaign-listup.mts";

/**
 * 어필리에이트 스토어(ZVZO 방식) — 카페24 연동 없이 플랫폼 안에서 상품을 올리고
 * 인플루언서가 판매 신청을 내는 흐름.
 *
 *   GET  /api/affiliate-store?scope=brand     브랜드: 입점 신청서 + (승인 시) 내 상품 + 받은 판매 신청
 *   GET  /api/affiliate-store?scope=creator   인플루언서: 판매중인 상품(&category &sub &q &brand &page)
 *   GET  /api/affiliate-store?scope=brands    인플루언서: 입점 브랜드 전체(&q &page)
 *   GET  /api/affiliate-store?scope=my-requests 인플루언서: 내 판매 신청
 *   GET  /api/affiliate-store?scope=my-affiliate 인플루언서: 선정된 상품 + 전용 링크 + 판매 성과
 *   GET  /api/affiliate-store?scope=admin     운영자: 입점 신청 목록
 *   POST /api/affiliate-store  { action, ... }
 *     브랜드    apply · save_product · delete_product · review_request · update_seller_info
 *     (주문 · 취소 · 반품 · 문의는 api-affiliate-store-ops)
 *     인플루언서 request · cancel_request
 *     운영자    review_application
 *     담당자    manager_update  (GET scope=selections: 브랜드가 선정한 신청 — 담당자 연락 큐)
 *
 * 선정 이후 흐름: 브랜드가 선정(approve)하면 담당자 연락 없이 바로 manager_status = 'done' 이 되고
 * 인플루언서 전용 링크가 열린다. (예전 흐름: 'waiting' 이 되고, 픽스폴리오
 * 담당자가 양쪽에 연락해 조건을 맞춘 뒤 'done' 으로 바꾸면 링크가 열렸다.)
 * 인플루언서 쪽 기능(상품 · 브랜드 · 신청 · MY)은 크리에이터 승인을 받은 계정만 쓴다.
 *
 * 정식 오픈 전이라 브랜드 · 인플루언서 쪽은 테스트 계정(TESTERS)만 쓸 수 있다.
 * 오픈할 때는 TESTERS 검사를 없애면 된다(프론트의 utils/featureFlags 도 같이).
 */

const TESTERS = STORE_TESTERS;

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;
const norm = (raw: unknown) => String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

/**
 * 상품 카테고리. 인플루언서 화면은 상위 → 하위 순서로 걸러 본다.
 * 화면은 이 목록을 API 응답(taxonomy)으로 받아 그대로 그린다 — 바꿀 곳은 여기 하나다.
 */
const TAXONOMY: { name: string; subs: string[] }[] = [
  { name: "뷰티", subs: ["메이크업", "베이스", "립", "아이", "헤어", "바디", "향수", "네일"] },
  { name: "패션", subs: ["TOP", "BOTTOM", "OUTER", "DRESS", "SHOES", "BAG", "ACC"] },
  { name: "스킨케어", subs: ["스킨·토너", "에센스·세럼", "크림", "클렌징", "선케어", "마스크팩"] },
  { name: "라이프스타일", subs: ["리빙", "주방", "푸드", "건강식품", "디지털", "반려동물", "캠핑·레저"] },
];

/** 입점 신청서의 "주요 카테고리"(브랜드 성격을 넓게 고르는 칸). */
const CATEGORIES = [
  "우먼 패션", "리빙", "잡화", "뷰티", "라이프", "푸드",
  "키즈", "맨 패션", "건강식품", "인테리어", "캠핑", "기타",
];

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const int = (v: unknown, min = 0, max = 1_000_000_000) => {
  const n = Math.round(Number(String(v ?? "").replace(/,/g, "")));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : NaN;
};
const err = (message: string, status = 400) => Response.json({ error: message }, { status });
const isUrl = (v: string) => /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v);

function shapeApplication(r: any) {
  if (!r) return null;
  return {
    id: r.id,
    businessUsername: r.business_username,
    businessName: r.business_name,
    businessNumber: r.business_number,
    brandName: r.brand_name,
    channelUrl: r.channel_url,
    categories: Array.isArray(r.categories) ? r.categories : [],
    contactName: r.contact_name,
    contactPosition: r.contact_position,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    ceoName: r.ceo_name || "",
    businessAddress: r.business_address || "",
    csPhone: r.cs_phone || "",
    status: r.status,
    rejectReason: r.reject_reason,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function shapeProduct(r: any, forCreator = false) {
  const base = {
    id: r.id,
    businessUsername: r.business_username,
    brandName: r.brand_name ?? undefined,
    name: r.name,
    category: r.category,
    subcategory: r.subcategory || "",
    summary: r.summary,
    description: r.description,
    imageUrls: Array.isArray(r.image_urls) ? r.image_urls : [],
    detailImageUrls: Array.isArray(r.detail_image_urls) ? r.detail_image_urls : [],
    sizeGuide: r.size_guide || "",
    deliveryGuide: r.delivery_guide || "",
    options: Array.isArray(r.options) ? r.options : [],
    retailPrice: Number(r.retail_price) || 0,
    salePrice: Number(r.sale_price) || 0,
    commissionRate: Number(r.commission_rate) || 0,
    stock: Number(r.stock) || 0,
    shippingFee: Number(r.shipping_fee) || 0,
    productUrl: r.product_url,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (forCreator) {
    // 재고 수량 · 배송비는 브랜드만 보고 관리한다. 인플루언서에게는 옵션 이름과 품절 여부만 준다.
    const { stock: _stock, shippingFee: _shippingFee, ...rest } = base;
    return {
      ...rest,
      options: base.options.map((o: any) => ({ name: String(o?.name ?? ""), soldOut: !(Number(o?.stock) > 0) })),
    };
  }
  return { ...base, requestCounts: { pending: Number(r.pending_count) || 0, approved: Number(r.approved_count) || 0 } };
}

function shapeRequest(r: any) {
  return {
    id: r.id,
    productId: r.product_id,
    productName: r.product_name ?? undefined,
    productImage: Array.isArray(r.image_urls) ? r.image_urls[0] || "" : "",
    brandName: r.brand_name ?? undefined,
    influencerUsername: r.influencer_username,
    message: r.message,
    channelUrl: r.channel_url,
    status: r.status,
    brandNote: r.brand_note,
    /** 선정 뒤 담당자 연락 단계: '' | 'waiting' | 'contacting' | 'done' */
    managerStatus: r.manager_status || "",
    linkCode: r.manager_status === "done" ? r.link_code || "" : "",
    clickCount: Number(r.click_count) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 인플루언서 전용 링크 코드. 주소에 그대로 들어가므로 영문 · 숫자만 쓴다. */
const linkCode = () => {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
};

/** 승인된 신청에 링크 코드가 없으면 붙인다(코드가 겹치면 다시 뽑는다). */
async function ensureLinkCode(db: any, requestId: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    try {
      const rows = (await db.sql`
        UPDATE affiliate_store_requests SET link_code = COALESCE(link_code, ${linkCode()})
        WHERE id = ${requestId} RETURNING link_code
      `) as any[];
      return rows[0]?.link_code || "";
    } catch (e: any) {
      if (e?.code !== "23505") throw e; // 고유값 충돌이면 다시
    }
  }
  return "";
}

function shapeOrder(o: any, forBrand: boolean) {
  const base = {
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
    influencerUsername: o.influencer_username,
    status: o.status,
    paidAt: o.paid_at,
    trackingCompany: o.tracking_company,
    trackingNumber: o.tracking_number,
    shippedAt: o.shipped_at,
    commissionStatus: o.commission_status,
    createdAt: o.created_at,
  };
  if (!forBrand) return base;
  return {
    ...base,
    buyerName: o.buyer_name,
    buyerPhone: o.buyer_phone,
    buyerEmail: o.buyer_email,
    recipientName: o.recipient_name,
    recipientPhone: o.recipient_phone,
    postcode: o.postcode,
    address1: o.address1,
    address2: o.address2,
    deliveryMemo: o.delivery_memo,
  };
}

async function loadApplication(db: any, username: string) {
  const rows = (await db.sql`
    SELECT * FROM affiliate_store_applications WHERE business_username = ${username}
  `) as any[];
  return rows[0] || null;
}

// ─────────────────────────── 브랜드 ───────────────────────────

async function brandGet(db: any, username: string) {
  const app = await loadApplication(db, username);
  if (!app || app.status !== "approved") {
    return Response.json({ application: shapeApplication(app), products: [], requests: [], categories: CATEGORIES, taxonomy: TAXONOMY });
  }
  const [products, requests] = await Promise.all([
    db.sql`
      SELECT p.*,
        (SELECT COUNT(*) FROM affiliate_store_requests r WHERE r.product_id = p.id AND r.status = 'pending')::int AS pending_count,
        (SELECT COUNT(*) FROM affiliate_store_requests r WHERE r.product_id = p.id AND r.status = 'approved')::int AS approved_count
      FROM affiliate_store_products p
      WHERE p.business_username = ${username} AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
    ` as Promise<any[]>,
    db.sql`
      SELECT r.*, p.name AS product_name, p.image_urls
      FROM affiliate_store_requests r JOIN affiliate_store_products p ON p.id = r.product_id
      WHERE r.business_username = ${username} AND r.status <> 'cancelled'
      ORDER BY r.created_at DESC LIMIT 500
    ` as Promise<any[]>,
  ]);
  // 지원한 인플루언서의 인스타 프로필 · 최근 릴스. 캠페인 지원자 목록과 같은 스냅샷을 쓴다.
  // 브랜드에게는 인플루언서가 등록한 단가를 보내지 않는다(캠페인 지원자와 같은 규칙).
  const snapshots = await buildSnapshots(db, requests.map((r) => r.influencer_username))
    .catch((e) => { console.error("[affiliate-store] snapshot load failed", e); return new Map(); });
  return Response.json({
    application: shapeApplication(app),
    products: products.map((p) => shapeProduct(p)),
    requests: requests.map((r) => ({
      ...shapeRequest(r),
      insights: withoutRegisteredPrices(snapshots.get(norm(r.influencer_username)) || null),
    })),
    categories: CATEGORIES,
    taxonomy: TAXONOMY,
    // 상품 등록 화면의 "1개 판매 시 예상 정산액" 계산용(지금 설정값).
    feeRates: await currentFeeRates(db),
  });
}

/** 판매자 정보(대표자 · 사업장 주소 · 고객 문의 연락처). 승인 뒤에도 고칠 수 있다. */
async function brandUpdateSeller(db: any, username: string, body: any) {
  const ceoName = clip(body.ceoName, 50);
  const businessAddress = clip(body.businessAddress, 300);
  const csPhone = clip(body.csPhone, 20);
  if (!ceoName) return err("대표자 이름을 입력해 주세요.");
  if (!businessAddress) return err("사업장 주소를 입력해 주세요.");
  if (csPhone.replace(/\D/g, "").length < 8) return err("고객 문의 연락처를 정확히 입력해 주세요.");
  const rows = (await db.sql`
    UPDATE affiliate_store_applications SET ceo_name = ${ceoName}, business_address = ${businessAddress},
      cs_phone = ${csPhone}, updated_at = NOW()
    WHERE business_username = ${username} RETURNING *
  `) as any[];
  if (!rows[0]) return err("입점 신청서를 찾을 수 없습니다.", 404);
  return Response.json({ application: shapeApplication(rows[0]) });
}

async function brandApply(db: any, username: string, body: any) {
  const existing = await loadApplication(db, username);
  if (existing && existing.status !== "rejected") {
    return err(existing.status === "approved" ? "이미 입점 승인된 계정입니다." : "입점 신청을 검토 중입니다.");
  }
  const businessName = clip(body.businessName, 100);
  const businessNumber = String(body.businessNumber ?? "").replace(/\D/g, "");
  const brandName = clip(body.brandName, 100);
  const channelUrl = clip(body.channelUrl, 500);
  const categories = (Array.isArray(body.categories) ? body.categories : [])
    .map((c: unknown) => String(c))
    .filter((c: string) => CATEGORIES.includes(c));
  const contactName = clip(body.contactName, 50);
  const contactPosition = clip(body.contactPosition, 50);
  const contactPhone = clip(body.contactPhone, 20);
  const contactEmail = clip(body.contactEmail, 200);
  const ceoName = clip(body.ceoName, 50);
  const businessAddress = clip(body.businessAddress, 300);
  const csPhone = clip(body.csPhone, 20);

  if (!businessName) return err("사업자명을 입력해 주세요.");
  if (businessNumber.length !== 10) return err("사업자 등록번호 10자리를 입력해 주세요.");
  if (!ceoName) return err("대표자 이름을 입력해 주세요.");
  if (!businessAddress) return err("사업장 주소를 입력해 주세요.");
  if (csPhone.replace(/\D/g, "").length < 8) return err("고객 문의 연락처를 정확히 입력해 주세요.");
  if (!brandName) return err("대표 브랜드명을 입력해 주세요.");
  if (!isUrl(channelUrl)) return err("대표 판매 채널 주소를 https:// 로 시작하는 주소로 입력해 주세요.");
  if (categories.length === 0) return err("주요 카테고리를 하나 이상 선택해 주세요.");
  if (!contactName) return err("담당자 이름을 입력해 주세요.");
  if (contactPhone.replace(/\D/g, "").length < 9) return err("담당자 연락처를 정확히 입력해 주세요.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return err("담당자 이메일을 정확히 입력해 주세요.");

  const cats = JSON.stringify(categories);
  const rows = (await db.sql`
    INSERT INTO affiliate_store_applications
      (id, business_username, business_name, business_number, brand_name, channel_url, categories,
       contact_name, contact_position, contact_phone, contact_email, ceo_name, business_address, cs_phone, status)
    VALUES
      (${newId("asa")}, ${username}, ${businessName}, ${businessNumber}, ${brandName}, ${channelUrl}, ${cats}::jsonb,
       ${contactName}, ${contactPosition}, ${contactPhone}, ${contactEmail}, ${ceoName}, ${businessAddress}, ${csPhone}, 'pending')
    ON CONFLICT (business_username) DO UPDATE SET
      business_name = EXCLUDED.business_name, business_number = EXCLUDED.business_number,
      brand_name = EXCLUDED.brand_name, channel_url = EXCLUDED.channel_url, categories = EXCLUDED.categories,
      contact_name = EXCLUDED.contact_name, contact_position = EXCLUDED.contact_position,
      contact_phone = EXCLUDED.contact_phone, contact_email = EXCLUDED.contact_email,
      ceo_name = EXCLUDED.ceo_name, business_address = EXCLUDED.business_address, cs_phone = EXCLUDED.cs_phone,
      status = 'pending', reject_reason = '', reviewed_by = '', reviewed_at = NULL, updated_at = NOW()
    WHERE affiliate_store_applications.status = 'rejected'
    RETURNING *
  `) as any[];
  if (!rows[0]) return err("입점 신청을 검토 중입니다.");
  return Response.json({ application: shapeApplication(rows[0]) }, { status: 201 });
}

async function requireApproved(db: any, username: string) {
  const app = await loadApplication(db, username);
  return app?.status === "approved";
}

async function brandSaveProduct(db: any, username: string, body: any) {
  if (!(await requireApproved(db, username))) return err("입점 승인 후 상품을 등록할 수 있습니다.", 403);
  const p = body.product || {};
  const name = clip(p.name, 120);
  if (!name) return err("상품명을 입력해 주세요.");
  const top = TAXONOMY.find((t) => t.name === String(p.category));
  if (!top) return err("상위 카테고리를 선택해 주세요.");
  const category = top.name;
  const subcategory = top.subs.includes(String(p.subcategory)) ? String(p.subcategory) : "";
  if (!subcategory) return err("하위 카테고리를 선택해 주세요.");
  const summary = clip(p.summary, 200);
  const description = clip(p.description, 5000);
  // 예전 화면처럼 칸을 보내지 않은 저장은 기존 값을 그대로 둔다.
  const keepGuides = typeof p.sizeGuide !== "string" && typeof p.deliveryGuide !== "string";
  const sizeGuide = clip(p.sizeGuide, 5000);
  const deliveryGuide = clip(p.deliveryGuide, 5000);
  const imageUrls = (Array.isArray(p.imageUrls) ? p.imageUrls : [])
    .map((u: unknown) => clip(u, 1000))
    .filter((u: string) => u.startsWith("/") || /^https:\/\//.test(u))
    .slice(0, 10);
  if (imageUrls.length === 0) return err("대표 이미지를 한 장 이상 올려 주세요.");
  const detailImageUrls = (Array.isArray(p.detailImageUrls) ? p.detailImageUrls : [])
    .map((u: unknown) => clip(u, 1000))
    .filter((u: string) => u.startsWith("/") || /^https:\/\//.test(u))
    .slice(0, 20);
  const options = (Array.isArray(p.options) ? p.options : [])
    .map((o: any) => ({ name: clip(o?.name, 80), stock: int(o?.stock, 0, 1_000_000) }))
    .filter((o: any) => o.name && Number.isFinite(o.stock))
    .slice(0, 50);
  const retailPrice = int(p.retailPrice);
  const salePrice = int(p.salePrice);
  const commissionRate = Math.round(Number(p.commissionRate) * 100) / 100;
  const shippingFee = int(p.shippingFee ?? 0);
  let stock = int(p.stock, 0, 1_000_000);
  if (options.length > 0) stock = options.reduce((s: number, o: any) => s + o.stock, 0);
  const productUrl = clip(p.productUrl, 1000);
  const status = ["draft", "on_sale", "paused"].includes(p.status) ? p.status : "draft";

  if (!Number.isFinite(salePrice) || salePrice <= 0) return err("판매가를 입력해 주세요.");
  if (!Number.isFinite(retailPrice) || retailPrice < salePrice) return err("정가는 판매가보다 같거나 커야 합니다.");
  if (!Number.isFinite(commissionRate) || commissionRate <= 0 || commissionRate > 90) return err("인플루언서 수수료율은 0% 초과 90% 이하로 입력해 주세요.");
  if (!Number.isFinite(shippingFee)) return err("배송비를 확인해 주세요.");
  if (!Number.isFinite(stock)) return err("재고 수량을 입력해 주세요.");
  if (productUrl && !isUrl(productUrl)) return err("상품 상세 주소는 https:// 로 시작하는 주소로 입력해 주세요.");
  if (status === "on_sale" && stock <= 0) return err("재고가 0개인 상품은 판매중으로 둘 수 없습니다.");
  if (status === "on_sale" && Array.isArray(p.detailImageUrls) && detailImageUrls.length === 0 && !description) {
    return err("판매중으로 두려면 상품 설명을 적거나 상세페이지 이미지를 1장 이상 올려 주세요.");
  }

  const imgs = JSON.stringify(imageUrls);
  const detailImgs = JSON.stringify(detailImageUrls);
  // 상세페이지 칸을 보내지 않은 저장(예: 예전 화면)은 기존 상세페이지를 그대로 둔다.
  const keepDetail = !Array.isArray(p.detailImageUrls);
  const opts = JSON.stringify(options);
  const id = clip(p.id, 60);
  let rows: any[];
  if (id) {
    rows = (await db.sql`
      UPDATE affiliate_store_products SET
        name = ${name}, category = ${category}, subcategory = ${subcategory}, summary = ${summary}, description = ${description},
        image_urls = ${imgs}::jsonb, detail_image_urls = CASE WHEN ${keepDetail}::boolean THEN detail_image_urls ELSE ${detailImgs}::jsonb END, options = ${opts}::jsonb, retail_price = ${retailPrice}, sale_price = ${salePrice},
        commission_rate = ${commissionRate}, stock = ${stock}, shipping_fee = ${shippingFee},
        size_guide = CASE WHEN ${keepGuides}::boolean THEN size_guide ELSE ${sizeGuide} END,
        delivery_guide = CASE WHEN ${keepGuides}::boolean THEN delivery_guide ELSE ${deliveryGuide} END,
        product_url = ${productUrl}, status = ${status}, updated_at = NOW()
      WHERE id = ${id} AND business_username = ${username} AND deleted_at IS NULL
      RETURNING *
    `) as any[];
    if (!rows[0]) return err("상품을 찾을 수 없습니다.", 404);
  } else {
    rows = (await db.sql`
      INSERT INTO affiliate_store_products
        (id, business_username, name, category, subcategory, summary, description, image_urls, detail_image_urls, options,
         retail_price, sale_price, commission_rate, stock, shipping_fee, product_url, status, size_guide, delivery_guide)
      VALUES
        (${newId("asp")}, ${username}, ${name}, ${category}, ${subcategory}, ${summary}, ${description}, ${imgs}::jsonb, ${detailImgs}::jsonb, ${opts}::jsonb,
         ${retailPrice}, ${salePrice}, ${commissionRate}, ${stock}, ${shippingFee}, ${productUrl}, ${status}, ${sizeGuide}, ${deliveryGuide})
      RETURNING *
    `) as any[];
  }
  return Response.json({ product: shapeProduct(rows[0]) });
}

async function brandDeleteProduct(db: any, username: string, body: any) {
  const id = clip(body.id, 60);
  const rows = (await db.sql`
    UPDATE affiliate_store_products SET deleted_at = NOW(), status = 'paused', updated_at = NOW()
    WHERE id = ${id} AND business_username = ${username} AND deleted_at IS NULL
    RETURNING id
  `) as any[];
  if (!rows[0]) return err("상품을 찾을 수 없습니다.", 404);
  return Response.json({ ok: true });
}

async function brandReviewRequest(db: any, username: string, body: any) {
  const id = clip(body.id, 60);
  const decision = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "";
  if (!decision) return err("승인 또는 반려를 선택해 주세요.");
  const note = clip(body.note, 500);
  // 선정하면 담당자 연락 없이 바로 진행 확정(done)이 되고 인플루언서 전용 링크가 열린다.
  // 반려하면 신청 상태가 'rejected' 라 링크는 닫힌다(다시 선정하면 같은 링크가 살아난다).
  // 운영자가 링크를 잠시 닫은('contacting') 신청은 브랜드가 다시 선정해도 닫힌 채로 둔다.
  const rows = (await db.sql`
    UPDATE affiliate_store_requests SET status = ${decision}, brand_note = ${note},
      manager_status = CASE WHEN ${decision}::text = 'approved' AND manager_status <> 'contacting' THEN 'done' ELSE manager_status END,
      manager_updated_at = CASE WHEN ${decision}::text = 'approved' AND manager_status <> 'done' THEN NOW() ELSE manager_updated_at END,
      updated_at = NOW()
    WHERE id = ${id} AND business_username = ${username} AND status IN ('pending', 'approved', 'rejected')
    RETURNING *
  `) as any[];
  if (!rows[0]) return err("신청을 찾을 수 없습니다.", 404);
  if (decision === "approved" && !rows[0].link_code) rows[0].link_code = await ensureLinkCode(db, rows[0].id);
  return Response.json({ request: shapeRequest(rows[0]) });
}

// ─────────────────────────── 인플루언서 ───────────────────────────

/**
 * MY 어필리에이트 — 선정(승인)된 상품과 내 전용 링크 · 성과.
 * 판매는 결제완료 이후 주문(paid · shipped · delivered)만 센다.
 */
async function creatorMyAffiliate(db: any, username: string) {
  const rows = (await db.sql`
    SELECT r.*, p.name AS product_name, p.image_urls, p.sale_price, p.commission_rate, p.status AS product_status,
           p.deleted_at AS product_deleted_at, p.stock, a.brand_name
    FROM affiliate_store_requests r
    JOIN affiliate_store_products p ON p.id = r.product_id
    LEFT JOIN affiliate_store_applications a ON a.business_username = r.business_username
    WHERE r.influencer_username = ${username} AND r.status = 'approved' AND r.manager_status = 'done'
    ORDER BY r.updated_at DESC
  `) as any[];
  for (const r of rows) if (!r.link_code) r.link_code = await ensureLinkCode(db, r.id);

  const stats = (await db.sql`
    SELECT request_id, COUNT(*)::int AS orders, COALESCE(SUM(quantity), 0)::int AS units,
           COALESCE(SUM(total_amount - shipping_fee), 0)::bigint AS sales,
           COALESCE(SUM(commission_amount), 0)::bigint AS commission,
           COALESCE(SUM(commission_amount) FILTER (WHERE commission_status = 'pending'), 0)::bigint AS pending,
           COALESCE(SUM(commission_amount) FILTER (WHERE commission_status = 'confirmed'), 0)::bigint AS confirmed
    FROM affiliate_store_orders
    WHERE influencer_username = ${username} AND status = ANY(${SALE_STATUSES}::text[])
      AND commission_status IN ('pending', 'confirmed')
    GROUP BY request_id
  `) as any[];
  const byReq = new Map(stats.map((s) => [s.request_id, s]));
  // 취소된 판매의 수수료(표시용).
  const cancelledRows = (await db.sql`
    SELECT COALESCE(SUM(commission_amount), 0)::bigint AS n FROM affiliate_store_orders
    WHERE influencer_username = ${username} AND commission_status = 'cancelled' AND status <> 'pending_payment'
  `) as any[];
  const orders = (await db.sql`
    SELECT * FROM affiliate_store_orders
    WHERE influencer_username = ${username} AND status <> 'pending_payment'
    ORDER BY created_at DESC LIMIT 300
  `) as any[];

  const items = rows.map((r) => {
    const st = byReq.get(r.id);
    return {
      ...shapeRequest(r),
      salePrice: Number(r.sale_price) || 0,
      commissionRate: Number(r.commission_rate) || 0,
      live: !r.product_deleted_at && r.product_status === "on_sale" && Number(r.stock) > 0,
      stats: {
        orders: st?.orders || 0,
        units: st?.units || 0,
        sales: Number(st?.sales || 0),
        commission: Number(st?.commission || 0),
        pending: Number(st?.pending || 0),
        confirmed: Number(st?.confirmed || 0),
      },
    };
  });
  const totals = items.reduce(
    (t, i) => ({
      clicks: t.clicks + i.clickCount,
      orders: t.orders + i.stats.orders,
      sales: t.sales + i.stats.sales,
      commission: t.commission + i.stats.commission,
      pending: t.pending + i.stats.pending,
      confirmed: t.confirmed + i.stats.confirmed,
      cancelled: t.cancelled,
    }),
    { clicks: 0, orders: 0, sales: 0, commission: 0, pending: 0, confirmed: 0, cancelled: Number(cancelledRows[0]?.n || 0) },
  );
  return Response.json({ items, totals, orders: orders.map((o) => shapeOrder(o, false)) });
}

const PAGE_SIZE = 40;
const BRAND_PAGE_SIZE = 30;

/** LIKE 패턴 안에서 %, _ 를 글자 그대로 찾게 한다. */
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/**
 * 인플루언서 상품 목록. 상위 · 하위 카테고리, 검색어(상품명 · 브랜드명), 브랜드로 거른다.
 * 상품이 많아질 것이라 페이지로 나눠 내려보낸다.
 */
async function creatorProducts(db: any, url: URL) {
  const category = clip(url.searchParams.get("category"), 40);
  const sub = clip(url.searchParams.get("sub"), 40);
  const q = clip(url.searchParams.get("q"), 80);
  const brand = norm(url.searchParams.get("brand"));
  const page = Math.max(1, int(url.searchParams.get("page") || 1, 1, 10_000) || 1);
  const like = q ? likeOf(q) : "";
  const offset = (page - 1) * PAGE_SIZE;

  const rows = (await db.sql`
    SELECT p.*, a.brand_name, COUNT(*) OVER()::int AS total_count
    FROM affiliate_store_products p
    JOIN affiliate_store_applications a ON a.business_username = p.business_username AND a.status = 'approved'
    WHERE p.deleted_at IS NULL AND p.status = 'on_sale'
      AND (${category} = '' OR p.category = ${category})
      AND (${sub} = '' OR p.subcategory = ${sub})
      AND (${brand} = '' OR p.business_username = ${brand})
      AND (${like} = '' OR p.name ILIKE ${like} OR a.brand_name ILIKE ${like})
    ORDER BY p.created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `) as any[];
  const total = rows[0]?.total_count ?? 0;

  let brandInfo = null;
  if (brand) {
    const b = (await db.sql`
      SELECT business_username, brand_name, channel_url, categories FROM affiliate_store_applications
      WHERE business_username = ${brand} AND status = 'approved'
    `) as any[];
    if (b[0]) brandInfo = { username: b[0].business_username, brandName: b[0].brand_name, channelUrl: b[0].channel_url, categories: b[0].categories || [] };
  }
  return Response.json({
    products: rows.map((p) => shapeProduct(p, true)),
    total,
    page,
    hasMore: offset + rows.length < total,
    brand: brandInfo,
    taxonomy: TAXONOMY,
  });
}

/** 입점(승인)된 브랜드 전체. 수천 개가 될 것이라 검색 + 페이지로 내려보낸다. */
async function creatorBrands(db: any, url: URL) {
  const q = clip(url.searchParams.get("q"), 80);
  const page = Math.max(1, int(url.searchParams.get("page") || 1, 1, 10_000) || 1);
  const like = q ? likeOf(q) : "";
  const offset = (page - 1) * BRAND_PAGE_SIZE;
  const rows = (await db.sql`
    SELECT a.business_username, a.brand_name, a.categories,
      COUNT(p.id)::int AS product_count,
      (ARRAY_AGG(p.image_urls->>0 ORDER BY p.created_at DESC) FILTER (WHERE p.id IS NOT NULL))[1:3] AS thumbs,
      COUNT(*) OVER()::int AS total_count
    FROM affiliate_store_applications a
    LEFT JOIN affiliate_store_products p
      ON p.business_username = a.business_username AND p.deleted_at IS NULL AND p.status = 'on_sale'
    WHERE a.status = 'approved'
      AND (${like} = '' OR a.brand_name ILIKE ${like})
    GROUP BY a.business_username, a.brand_name, a.categories
    ORDER BY COUNT(p.id) DESC, lower(a.brand_name)
    LIMIT ${BRAND_PAGE_SIZE} OFFSET ${offset}
  `) as any[];
  const total = rows[0]?.total_count ?? 0;
  return Response.json({
    brands: rows.map((r) => ({
      username: r.business_username,
      brandName: r.brand_name,
      categories: Array.isArray(r.categories) ? r.categories : [],
      productCount: Number(r.product_count) || 0,
      thumbs: (Array.isArray(r.thumbs) ? r.thumbs : []).filter(Boolean),
    })),
    total,
    page,
    hasMore: offset + rows.length < total,
  });
}

/** 내 판매 신청. */
async function creatorRequests(db: any, username: string) {
  const requests = (await db.sql`
    SELECT r.*, p.name AS product_name, p.image_urls, a.brand_name
    FROM affiliate_store_requests r
    JOIN affiliate_store_products p ON p.id = r.product_id
    LEFT JOIN affiliate_store_applications a ON a.business_username = r.business_username
    WHERE r.influencer_username = ${username}
    ORDER BY r.created_at DESC LIMIT 500
  `) as any[];
  return Response.json({ requests: requests.map(shapeRequest) });
}

async function creatorRequest(db: any, username: string, body: any) {
  const productId = clip(body.productId, 60);
  const message = clip(body.message, 1000);
  const channelUrl = clip(body.channelUrl, 500);
  if (channelUrl && !isUrl(channelUrl)) return err("채널 주소는 https:// 로 시작하는 주소로 입력해 주세요.");
  const prows = (await db.sql`
    SELECT p.id, p.business_username FROM affiliate_store_products p
    JOIN affiliate_store_applications a ON a.business_username = p.business_username AND a.status = 'approved'
    WHERE p.id = ${productId} AND p.deleted_at IS NULL AND p.status = 'on_sale'
  `) as any[];
  const product = prows[0];
  if (!product) return err("판매중인 상품이 아닙니다.", 404);
  if (product.business_username === username) return err("내 브랜드 상품에는 신청할 수 없습니다.");
  const rows = (await db.sql`
    INSERT INTO affiliate_store_requests (id, product_id, business_username, influencer_username, message, channel_url)
    VALUES (${newId("asr")}, ${productId}, ${product.business_username}, ${username}, ${message}, ${channelUrl})
    ON CONFLICT (product_id, influencer_username) DO UPDATE SET
      message = EXCLUDED.message, channel_url = EXCLUDED.channel_url, status = 'pending', brand_note = '', updated_at = NOW()
    WHERE affiliate_store_requests.status = 'cancelled'
    RETURNING *
  `) as any[];
  if (!rows[0]) return err("이미 신청한 상품입니다.");
  return Response.json({ request: shapeRequest(rows[0]) }, { status: 201 });
}

async function creatorCancel(db: any, username: string, body: any) {
  const id = clip(body.id, 60);
  const rows = (await db.sql`
    UPDATE affiliate_store_requests SET status = 'cancelled', updated_at = NOW()
    WHERE id = ${id} AND influencer_username = ${username} AND status = 'pending'
    RETURNING id
  `) as any[];
  if (!rows[0]) return err("대기 중인 신청만 취소할 수 있습니다.", 404);
  return Response.json({ ok: true });
}

// ─────────────────────────── 운영자 ───────────────────────────

async function adminGet(db: any) {
  const rows = (await db.sql`
    SELECT a.*,
      (SELECT COUNT(*) FROM affiliate_store_products p WHERE p.business_username = a.business_username AND p.deleted_at IS NULL)::int AS product_count
    FROM affiliate_store_applications a
    ORDER BY (a.status = 'pending') DESC, a.created_at DESC
    LIMIT 1000
  `) as any[];
  return Response.json({
    applications: rows.map((r) => ({ ...shapeApplication(r), productCount: Number(r.product_count) || 0 })),
  });
}

async function adminReview(db: any, operator: string, body: any) {
  const id = clip(body.id, 60);
  const decision = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "";
  if (!decision) return err("승인 또는 반려를 선택해 주세요.");
  const reason = decision === "rejected" ? clip(body.reason, 500) : "";
  const rows = (await db.sql`
    UPDATE affiliate_store_applications
    SET status = ${decision}, reject_reason = ${reason}, reviewed_by = ${operator}, reviewed_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `) as any[];
  if (!rows[0]) return err("신청서를 찾을 수 없습니다.", 404);
  return Response.json({ application: shapeApplication(rows[0]) });
}

// ─────────────────────────── 담당자(선정 후 연락) ───────────────────────────

const MANAGER_STATUSES = ["waiting", "contacting", "done"] as const;

/** 브랜드가 선정한 신청 — 담당자가 양쪽에 연락해 진행한다. 연락처를 함께 내려준다. */
async function managerSelections(db: any) {
  const rows = (await db.sql`
    SELECT r.*, p.name AS product_name, p.image_urls, p.sale_price, p.commission_rate,
           a.brand_name, a.contact_name AS brand_contact_name, a.contact_phone AS brand_contact_phone,
           a.contact_email AS brand_contact_email,
           c.name AS creator_name, c.contact AS creator_contact, c.instagram_url AS creator_instagram
    FROM affiliate_store_requests r
    JOIN affiliate_store_products p ON p.id = r.product_id
    LEFT JOIN affiliate_store_applications a ON a.business_username = r.business_username
    LEFT JOIN creator_applications c ON c.username = r.influencer_username
    WHERE r.status = 'approved' AND r.manager_status IN ('waiting', 'contacting', 'done')
    ORDER BY (r.manager_status = 'waiting') DESC, (r.manager_status = 'contacting') DESC, r.updated_at DESC
    LIMIT 500
  `) as any[];
  return Response.json({
    selections: rows.map((r) => ({
      ...shapeRequest(r),
      linkCode: r.link_code || "",
      businessUsername: r.business_username,
      salePrice: Number(r.sale_price) || 0,
      commissionRate: Number(r.commission_rate) || 0,
      managerUsername: r.manager_username || "",
      managerNote: r.manager_note || "",
      managerUpdatedAt: r.manager_updated_at,
      brandContact: { name: r.brand_contact_name || "", phone: r.brand_contact_phone || "", email: r.brand_contact_email || "" },
      creatorContact: { name: r.creator_name || "", phone: r.creator_contact || "", instagramUrl: r.creator_instagram || "" },
    })),
  });
}

async function managerUpdate(db: any, manager: string, body: any) {
  const id = clip(body.id, 60);
  const next = String(body.managerStatus || "");
  if (!(MANAGER_STATUSES as readonly string[]).includes(next)) return err("진행 상태를 선택해 주세요.");
  const note = body.note === undefined ? null : clip(body.note, 2000);
  const rows = (await db.sql`
    UPDATE affiliate_store_requests
    SET manager_status = ${next}, manager_note = COALESCE(${note}, manager_note),
        manager_username = ${manager}, manager_updated_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND status = 'approved'
    RETURNING *
  `) as any[];
  if (!rows[0]) return err("선정된 신청을 찾을 수 없습니다.", 404);
  // 운영 콘솔에서 링크를 다시 열거나(done) 잠시 닫는다(contacting). done 이면 링크 코드를 붙인다.
  if (next === "done") rows[0].link_code = await ensureLinkCode(db, rows[0].id);
  return Response.json({ request: { ...shapeRequest(rows[0]), managerNote: rows[0].manager_note } });
}

// ─────────────────────────── 진입 ───────────────────────────

export default async (req: Request) => {
  const url = new URL(req.url);
  const db = getDatabase();
  let body: any = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  else if (req.method !== "GET") return err("Method not allowed", 405);

  const scope = req.method === "GET" ? url.searchParams.get("scope") : null;
  const action = String(body?.action || "");

  if (scope === "admin" || action === "review_application") {
    const op = await requireOperator(req);
    if (!op.ok) return op.response;
    return scope === "admin" ? adminGet(db) : adminReview(db, op.username, body);
  }

  if (scope === "selections" || action === "manager_update") {
    const mgr = await requireManager(req);
    if (!mgr.ok) return mgr.response;
    try {
      return scope === "selections" ? await managerSelections(db) : await managerUpdate(db, mgr.managerUsername, body);
    } catch (e) {
      console.error("[affiliate-store]", action || scope, e);
      return err("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
    }
  }

  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller.response;
  const username = norm(caller.username);
  if (!username) return err("로그인이 필요합니다.", 401);
  if (!TESTERS.has(username) && !caller.isAdmin) return err("아직 오픈 전인 메뉴입니다.", 403);

  // 인플루언서 쪽 기능은 크리에이터 승인을 받은 계정만 쓴다(기존 계정은 자동 승인).
  const creatorScope = ["creator", "brands", "my-requests", "my-affiliate"].includes(String(scope || ""))
    || action === "request" || action === "cancel_request";
  if (creatorScope && !caller.isAdmin) {
    const creator = await readCreatorAccess(username);
    if (!creator) return err("크리에이터 승인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
    if (!creator.approved) {
      return Response.json(
        { error: CREATOR_APPROVAL_REQUIRED_MESSAGE, code: "CREATOR_APPROVAL_REQUIRED", creatorStatus: creator.status },
        { status: 403 },
      );
    }
  }

  try {
    if (req.method === "GET") {
      if (scope === "brand") return await brandGet(db, username);
      if (scope === "creator") return await creatorProducts(db, url);
      if (scope === "brands") return await creatorBrands(db, url);
      if (scope === "my-requests") return await creatorRequests(db, username);
      if (scope === "my-affiliate") return await creatorMyAffiliate(db, username);
      return err("알 수 없는 요청입니다.");
    }
    switch (action) {
      case "apply": return await brandApply(db, username, body);
      case "save_product": return await brandSaveProduct(db, username, body);
      case "delete_product": return await brandDeleteProduct(db, username, body);
      case "review_request": return await brandReviewRequest(db, username, body);
      case "update_seller_info": return await brandUpdateSeller(db, username, body);
      case "request": return await creatorRequest(db, username, body);
      case "cancel_request": return await creatorCancel(db, username, body);
      default: return err("알 수 없는 요청입니다.");
    }
  } catch (e) {
    console.error("[affiliate-store]", action || scope, e);
    return err("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
};

export const config: Config = {
  path: "/api/affiliate-store",
};
