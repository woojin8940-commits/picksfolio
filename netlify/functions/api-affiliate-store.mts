import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireManager, requireOperator } from "./_shared/manager-auth.mts";
import { CREATOR_APPROVAL_REQUIRED_MESSAGE, readCreatorAccess } from "./_shared/creator-access.mts";
import { randomBytes } from "node:crypto";
import { SALE_STATUSES, currentFeeRates, notify } from "./_shared/affiliate-store-orders.mts";
import { canUseStore } from "./_shared/store-testers.mts";
import { buildSnapshots, withoutRegisteredPrices } from "./_shared/campaign-listup.mts";
import { pageOf, readCursor } from "./_shared/list-cursor.mts";
import { dateOnly, kstToday, parseDateInput, saleStateOf } from "./_shared/affiliate-sale-period.mts";

/**
 * 어필리에이트 스토어(ZVZO 방식) — 카페24 연동 없이 플랫폼 안에서 상품을 올리고
 * 인플루언서가 판매 신청을 내는 흐름.
 *
 * 목록은 모두 최신순 커서(?cursorAt=&cursorId= · 응답 hasMore · nextCursor, _shared/list-cursor.mts)로 나눠 준다.
 * 첫 페이지(커서 없음)에만 건수 · 숫자를 함께 주고, "더 보기"(커서 있음)는 목록만 준다.
 *
 *   GET  /api/affiliate-store?scope=brand                    브랜드: 입점 신청서 + 숫자 + 내 상품(30개씩)
 *   GET  /api/affiliate-store?scope=brand&section=requests   브랜드: 받은 판매 신청(30개씩 · &productId &status 로 상품별)
 *   GET  /api/affiliate-store?scope=brand&section=request-products  브랜드: 신청을 받은 상품별 묶음(대기 · 선정 · 반려 · 새 신청 수)
 *   GET  /api/affiliate-store?scope=brand&section=counts     브랜드: 숫자만(상품 · 판매중 · 신청 · 주문 운영 배지)
 *   GET  /api/affiliate-store?scope=creator                  인플루언서: 판매중인 상품(&category &sub &q &brand · 40개씩)
 *   GET  /api/affiliate-store?scope=product-detail&id=       인플루언서: 상품 상세(이미지 · 안내 전체)
 *   GET  /api/affiliate-store?scope=brands                   인플루언서: 입점 브랜드 전체(&q &page)
 *   GET  /api/affiliate-store?scope=my-request-status&ids=   인플루언서: "내 신청" 전체 건수 + 지정한 상품(최대 100개)의 신청 상태
 *   GET  /api/affiliate-store?scope=my-requests              인플루언서: 내 판매 신청 목록(30개씩)
 *   GET  /api/affiliate-store?scope=my-affiliate             인플루언서: 선정된 상품 + 전용 링크 + 판매 성과 + 판매 건수
 *   GET  /api/affiliate-store?scope=my-affiliate-orders      인플루언서: 판매 내역(40개씩)
 *   GET  /api/affiliate-store?scope=admin                    운영자: 입점 신청 목록
 *   POST /api/affiliate-store  { action, ... }
 *     브랜드    apply · save_product · delete_product · review_request · update_seller_info · mark_requests_seen
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
 * 공개 여부(전체 공개 · 테스트 계정 전용)는 _shared/store-testers.mts
 * 한 곳(화면은 src/utils/featureFlags.ts)에서 관리한다.
 */


const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;
const norm = (raw: unknown) => String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

/**
 * 카테고리(상품 · 입점 신청 공용). 상품은 상위 → 하위를 고르고, 입점 신청서의 "주요 카테고리"는
 * 같은 목록의 상위 카테고리에서 고른다. 화면은 이 목록을 API 응답(taxonomy · categories)으로 받아
 * 그대로 그린다 — 바꿀 곳은 여기 하나다.
 */
const TAXONOMY: { name: string; subs: string[] }[] = [
  { name: "뷰티", subs: ["메이크업", "베이스", "립", "아이", "헤어", "바디", "향수", "네일"] },
  { name: "패션", subs: ["TOP", "BOTTOM", "OUTER", "DRESS", "SHOES", "BAG", "ACC"] },
  { name: "스킨케어", subs: ["스킨·토너", "에센스·세럼", "크림", "클렌징", "선케어", "마스크팩"] },
  { name: "라이프스타일", subs: ["리빙", "주방", "푸드", "건강식품", "디지털", "반려동물", "캠핑·레저"] },
];

/** 입점 신청서의 "주요 카테고리" = 상품 카테고리의 상위 목록(하나로 통일). */
const CATEGORIES = TAXONOMY.map((t) => t.name);

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const int = (v: unknown, min = 0, max = 1_000_000_000) => {
  const n = Math.round(Number(String(v ?? "").replace(/,/g, "")));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : NaN;
};
const err = (message: string, status = 400) => Response.json({ error: message }, { status });
const isUrl = (v: string) => /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v);
/** 구매자 문의 링크: https:// 로 시작하는 주소만 받는다(화면도 같은 규칙으로 막는다). */
const isHttpsUrl = (v: string) => /^https:\/\/[^\s/?#]+\.[^\s]+$/i.test(v);

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
    mailOrderNumber: r.mail_order_number || "",
    inquiryUrl: r.inquiry_url || "",
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
    summary: r.summary || "",
    description: r.description || "",
    imageUrls: Array.isArray(r.image_urls) ? r.image_urls : [],
    detailImageUrls: Array.isArray(r.detail_image_urls) ? r.detail_image_urls : [],
    sizeGuide: r.size_guide || "",
    deliveryGuide: r.delivery_guide || "",
    descriptionImageUrls: Array.isArray(r.description_image_urls) ? r.description_image_urls : [],
    sizeGuideImageUrls: Array.isArray(r.size_guide_image_urls) ? r.size_guide_image_urls : [],
    deliveryGuideImageUrls: Array.isArray(r.delivery_guide_image_urls) ? r.delivery_guide_image_urls : [],
    options: Array.isArray(r.options) ? r.options : [],
    retailPrice: Number(r.retail_price) || 0,
    salePrice: Number(r.sale_price) || 0,
    commissionRate: Number(r.commission_rate) || 0,
    stock: Number(r.stock) || 0,
    shippingFee: Number(r.shipping_fee) || 0,
    productUrl: r.product_url || "",
    status: r.status,
    /** 판매기간(한국 날짜 'YYYY-MM-DD', 비어 있으면 제한 없음). */
    saleStartDate: dateOnly(r.sale_start_date),
    saleEndDate: dateOnly(r.sale_end_date),
    /** 지금 실제 판매 상태(판매중 · 판매 예정 · 기간 종료 · 품절 · 판매중지 …). */
    saleState: saleStateOf(r),
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
  return {
    ...base,
    requestCounts: {
      pending: Number(r.pending_count) || 0,
      approved: Number(r.approved_count) || 0,
      rejected: Number(r.rejected_count) || 0,
      unseen: Number(r.unseen_count) || 0,
    },
  };
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
    /** 상품의 지금 판매 상태(상품 정보를 함께 읽은 목록에서만 온다). */
    productState: r.product_status !== undefined
      ? saleStateOf({
        status: r.product_status, deleted_at: r.product_deleted_at, stock: r.product_stock,
        sale_start_date: r.sale_start_date, sale_end_date: r.sale_end_date,
      })
      : undefined,
    /** 브랜드가 아직 확인하지 않은 신청(브랜드 화면에서만 의미가 있다). */
    unseen: r.brand_seen_at === undefined ? undefined : !r.brand_seen_at && r.status === "pending",
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

const BRAND_LIST_PAGE_SIZE = 30;

/** 브랜드 화면 상단 숫자 + 탭 배지(상품 · 신청 · 주문 운영). 목록을 다시 받지 않고 숫자만 새로 고칠 때도 쓴다. */
async function brandCounts(db: any, username: string) {
  const today = kstToday();
  const [counts, ops] = await Promise.all([
    db.sql`
      SELECT COUNT(*)::int AS product_total,
             COUNT(*) FILTER (WHERE status = 'on_sale'
               AND (sale_start_date IS NULL OR sale_start_date <= ${today}::date)
               AND (sale_end_date IS NULL OR sale_end_date >= ${today}::date))::int AS on_sale_total,
             (SELECT COUNT(*)::int FROM affiliate_store_requests WHERE business_username = ${username} AND status <> 'cancelled') AS request_total,
             (SELECT COUNT(*)::int FROM affiliate_store_requests WHERE business_username = ${username} AND status = 'pending') AS pending_request_count,
             (SELECT COUNT(*)::int FROM affiliate_store_requests r2
              JOIN affiliate_store_products p2 ON p2.id = r2.product_id AND p2.deleted_at IS NULL
              WHERE r2.business_username = ${username} AND r2.status = 'pending' AND r2.brand_seen_at IS NULL) AS new_request_count
      FROM affiliate_store_products WHERE business_username = ${username} AND deleted_at IS NULL
    ` as Promise<any[]>,
    db.sql`
      SELECT COUNT(*) FILTER (WHERE o.status = 'paid')::int AS new_orders,
             COUNT(*) FILTER (
               WHERE r.status = 'requested' OR (r.status = 'approved' AND o.status = 'return_requested')
             )::int AS claims_need_action,
             (SELECT COUNT(*)::int FROM affiliate_store_notifications
              WHERE recipient_type = 'brand' AND recipient = ${username} AND read_at IS NULL) AS unread
      FROM affiliate_store_orders o
      LEFT JOIN affiliate_store_returns r ON r.order_id = o.id
      WHERE o.business_username = ${username} AND o.status NOT IN ('pending_payment', 'expired')
    ` as Promise<any[]>,
  ]);
  return {
    productTotal: Number(counts[0]?.product_total || 0),
    onSaleTotal: Number(counts[0]?.on_sale_total || 0),
    requestTotal: Number(counts[0]?.request_total || 0),
    pendingRequestCount: Number(counts[0]?.pending_request_count || 0),
    newRequestCount: Number(counts[0]?.new_request_count || 0),
    opsCounts: {
      newOrders: Number(ops[0]?.new_orders || 0),
      claimsNeedAction: Number(ops[0]?.claims_need_action || 0),
      unread: Number(ops[0]?.unread || 0),
    },
  };
}

/**
 * 브랜드 화면.
 *   section=products(기본) 상품 목록. 첫 페이지(커서 없음)에만 신청서 · 숫자 · 카테고리 · 수수료율을 함께 준다.
 *                          "더 보기"(커서 있음)는 목록만 준다.
 *   section=requests       받은 판매 신청. 첫 페이지에만 건수를 함께 준다.
 *   section=counts         숫자만(상품 삭제 · 판매 상태 변경 뒤 새로 고침용).
 * 목록은 최신순 커서(list-cursor.mts)로 나눠 준다.
 */
async function brandGet(db: any, username: string, url: URL) {
  const app = await loadApplication(db, username);
  if (!app || app.status !== "approved") {
    return Response.json({ application: shapeApplication(app), products: [], requests: [], productTotal: 0, onSaleTotal: 0, pendingRequestCount: 0, newRequestCount: 0, requestTotal: 0, productHasMore: false, productNextCursor: null, opsCounts: { newOrders: 0, claimsNeedAction: 0, unread: 0 }, categories: CATEGORIES, taxonomy: TAXONOMY });
  }

  const section = url.searchParams.get("section") || "products";
  if (section === "counts") return Response.json(await brandCounts(db, username));

  if (section === "request-products") return await brandRequestProducts(db, username);

  const { hasCursor, cursorAt, cursorId } = readCursor(url);
  if (section === "requests") {
    // 상품별로 볼 때(productId) · 상태 칸(status)으로 거를 때.
    const productId = clip(url.searchParams.get("productId"), 60);
    const statusFilter = ["pending", "approved", "rejected"].includes(String(url.searchParams.get("status")))
      ? String(url.searchParams.get("status")) : "";
    const [rows, counts] = await Promise.all([
      db.sql`
        SELECT r.id, r.product_id, r.influencer_username, r.message, r.channel_url, r.status,
               r.brand_note, r.manager_status, r.link_code, r.click_count, r.brand_seen_at, r.created_at, r.updated_at,
               p.name AS product_name, p.image_urls, a.brand_name
        FROM affiliate_store_requests r
        JOIN affiliate_store_products p ON p.id = r.product_id
        LEFT JOIN affiliate_store_applications a ON a.business_username = r.business_username
        WHERE r.business_username = ${username} AND r.status <> 'cancelled'
          AND (${productId} = '' OR r.product_id = ${productId})
          AND (${statusFilter} = '' OR r.status = ${statusFilter})
          AND (NOT ${hasCursor} OR r.created_at < ${cursorAt}::timestamptz OR
            (r.created_at = ${cursorAt}::timestamptz AND r.id < ${cursorId}))
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${BRAND_LIST_PAGE_SIZE + 1}
      ` as Promise<any[]>,
      hasCursor ? Promise.resolve(null) : db.sql`
        SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
               COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS request_total
        FROM affiliate_store_requests WHERE business_username = ${username}
      ` as Promise<any[]>,
    ]);
    const { page, hasMore, nextCursor } = pageOf(rows, BRAND_LIST_PAGE_SIZE, (r) => r.created_at);
    // 지원한 인플루언서의 인스타 프로필 · 최근 릴스. 브랜드에게는 인플루언서가 등록한 단가를 보내지 않는다.
    const snapshots = await buildSnapshots(db, page.map((r) => r.influencer_username))
      .catch((e) => { console.error("[affiliate-store] snapshot load failed", e); return new Map(); });
    return Response.json({
      requests: page.map((r) => ({
        ...shapeRequest(r),
        insights: withoutRegisteredPrices(snapshots.get(norm(r.influencer_username)) || null),
      })),
      requestHasMore: hasMore,
      requestNextCursor: nextCursor,
      ...(counts ? {
        requestTotal: Number(counts[0]?.request_total || 0),
        pendingRequestCount: Number(counts[0]?.pending_count || 0),
      } : {}),
    });
  }

  const rows = (await db.sql`
    WITH page AS (
      SELECT * FROM affiliate_store_products p
      WHERE p.business_username = ${username} AND p.deleted_at IS NULL
        AND (NOT ${hasCursor} OR p.created_at < ${cursorAt}::timestamptz OR
          (p.created_at = ${cursorAt}::timestamptz AND p.id < ${cursorId}))
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${BRAND_LIST_PAGE_SIZE + 1}
    ), request_counts AS (
      SELECT product_id,
             COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
             COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count,
             COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_count,
             COUNT(*) FILTER (WHERE status = 'pending' AND brand_seen_at IS NULL)::int AS unseen_count
      FROM affiliate_store_requests
      WHERE product_id IN (SELECT id FROM page) AND status IN ('pending', 'approved', 'rejected')
      GROUP BY product_id
    )
    SELECT page.*, COALESCE(rc.pending_count, 0)::int AS pending_count,
           COALESCE(rc.approved_count, 0)::int AS approved_count,
           COALESCE(rc.rejected_count, 0)::int AS rejected_count,
           COALESCE(rc.unseen_count, 0)::int AS unseen_count
    FROM page LEFT JOIN request_counts rc ON rc.product_id = page.id
    ORDER BY page.created_at DESC, page.id DESC
  `) as any[];
  const { page, hasMore, nextCursor } = pageOf(rows, BRAND_LIST_PAGE_SIZE, (p) => p.created_at);
  const list = { products: page.map((p) => shapeProduct(p)), productHasMore: hasMore, productNextCursor: nextCursor };
  // "더 보기"는 목록만 준다(숫자 · 운영 배지 · 수수료율은 첫 페이지에서 이미 받았다).
  if (hasCursor) return Response.json(list);

  const [counts, feeRates] = await Promise.all([brandCounts(db, username), currentFeeRates(db)]);
  return Response.json({
    application: shapeApplication(app),
    ...list,
    requests: [],
    ...counts,
    categories: CATEGORIES,
    taxonomy: TAXONOMY,
    feeRates,
  });
}

const REQUEST_PRODUCTS_LIMIT = 200;

/**
 * 판매 신청 — 상품별 묶음. 신청(취소 제외)을 받은 상품마다 대기 · 선정 · 반려 · 새 신청(브랜드가 아직 확인 안 함) 수.
 * 새 신청이 있는 상품 → 최근 신청 순으로 준다. 상품을 누르면 section=requests&productId= 로 신청자를 본다.
 */
async function brandRequestProducts(db: any, username: string) {
  const rows = (await db.sql`
    WITH rc AS (
      SELECT product_id,
             COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
             COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count,
             COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_count,
             COUNT(*) FILTER (WHERE status = 'pending' AND brand_seen_at IS NULL)::int AS unseen_count,
             MAX(created_at) AS last_request_at
      FROM affiliate_store_requests
      WHERE business_username = ${username} AND status <> 'cancelled'
      GROUP BY product_id
    )
    SELECT p.*, rc.pending_count, rc.approved_count, rc.rejected_count, rc.unseen_count, rc.last_request_at
    FROM rc JOIN affiliate_store_products p ON p.id = rc.product_id
    WHERE p.business_username = ${username} AND p.deleted_at IS NULL
    ORDER BY (rc.unseen_count > 0) DESC, rc.last_request_at DESC, p.id DESC
    LIMIT ${REQUEST_PRODUCTS_LIMIT}
  `) as any[];
  return Response.json({
    products: rows.map((p) => ({ ...shapeProduct(p), lastRequestAt: p.last_request_at })),
  });
}

/** 브랜드가 상품의 신청자 목록을 열면 그 상품의 새 신청 알림을 끈다. */
async function brandMarkRequestsSeen(db: any, username: string, body: any) {
  const productId = clip(body.productId, 60);
  if (!productId) return err("상품을 선택해 주세요.");
  await db.sql`
    UPDATE affiliate_store_requests SET brand_seen_at = NOW()
    WHERE business_username = ${username} AND product_id = ${productId} AND brand_seen_at IS NULL
  `;
  return Response.json({ ok: true, ...(await brandCounts(db, username)) });
}

/**
 * 판매자 정보(대표자 · 사업장 주소 · 고객센터 연락처 · 통신판매업 신고번호)와 구매자 문의 링크.
 * 승인 뒤에도 언제든 고칠 수 있다. 문의 링크는 https:// 주소만 받는다.
 */
async function brandUpdateSeller(db: any, username: string, body: any) {
  const ceoName = clip(body.ceoName, 50);
  const businessAddress = clip(body.businessAddress, 300);
  const csPhone = clip(body.csPhone, 20);
  const mailOrderNumber = clip(body.mailOrderNumber, 60);
  const inquiryUrl = clip(body.inquiryUrl, 500);
  if (!ceoName) return err("대표자 이름을 입력해 주세요.");
  if (!businessAddress) return err("사업장 주소를 입력해 주세요.");
  if (csPhone.replace(/\D/g, "").length < 8) return err("고객센터 연락처를 정확히 입력해 주세요.");
  if (!mailOrderNumber) return err("통신판매업 신고번호를 입력해 주세요.");
  if (!isHttpsUrl(inquiryUrl)) return err("고객 문의 링크는 https:// 로 시작하는 주소로 입력해 주세요.");
  const rows = (await db.sql`
    UPDATE affiliate_store_applications SET ceo_name = ${ceoName}, business_address = ${businessAddress},
      cs_phone = ${csPhone}, mail_order_number = ${mailOrderNumber}, inquiry_url = ${inquiryUrl}, updated_at = NOW()
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
  const mailOrderNumber = clip(body.mailOrderNumber, 60);
  const inquiryUrl = clip(body.inquiryUrl, 500);

  if (!businessName) return err("사업자명을 입력해 주세요.");
  if (businessNumber.length !== 10) return err("사업자 등록번호 10자리를 입력해 주세요.");
  if (!ceoName) return err("대표자 이름을 입력해 주세요.");
  if (!businessAddress) return err("사업장 주소를 입력해 주세요.");
  if (csPhone.replace(/\D/g, "").length < 8) return err("고객센터 연락처를 정확히 입력해 주세요.");
  if (!mailOrderNumber) return err("통신판매업 신고번호를 입력해 주세요.");
  if (!brandName) return err("대표 브랜드명을 입력해 주세요.");
  if (!isUrl(channelUrl)) return err("대표 판매 채널 주소를 https:// 로 시작하는 주소로 입력해 주세요.");
  if (categories.length === 0) return err("주요 카테고리를 하나 이상 선택해 주세요.");
  if (!isHttpsUrl(inquiryUrl)) return err("고객 문의 링크(자사몰 주소)를 https:// 로 시작하는 주소로 입력해 주세요.");
  if (!contactName) return err("담당자 이름을 입력해 주세요.");
  if (contactPhone.replace(/\D/g, "").length < 9) return err("담당자 연락처를 정확히 입력해 주세요.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return err("담당자 이메일을 정확히 입력해 주세요.");

  const cats = JSON.stringify(categories);
  const rows = (await db.sql`
    INSERT INTO affiliate_store_applications
      (id, business_username, business_name, business_number, brand_name, channel_url, categories,
       contact_name, contact_position, contact_phone, contact_email, ceo_name, business_address, cs_phone,
       mail_order_number, inquiry_url, status)
    VALUES
      (${newId("asa")}, ${username}, ${businessName}, ${businessNumber}, ${brandName}, ${channelUrl}, ${cats}::jsonb,
       ${contactName}, ${contactPosition}, ${contactPhone}, ${contactEmail}, ${ceoName}, ${businessAddress}, ${csPhone},
       ${mailOrderNumber}, ${inquiryUrl}, 'pending')
    ON CONFLICT (business_username) DO UPDATE SET
      business_name = EXCLUDED.business_name, business_number = EXCLUDED.business_number,
      brand_name = EXCLUDED.brand_name, channel_url = EXCLUDED.channel_url, categories = EXCLUDED.categories,
      contact_name = EXCLUDED.contact_name, contact_position = EXCLUDED.contact_position,
      contact_phone = EXCLUDED.contact_phone, contact_email = EXCLUDED.contact_email,
      ceo_name = EXCLUDED.ceo_name, business_address = EXCLUDED.business_address, cs_phone = EXCLUDED.cs_phone,
      mail_order_number = EXCLUDED.mail_order_number, inquiry_url = EXCLUDED.inquiry_url,
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
  // 상품 정보 칸마다 붙이는 이미지(칸당 최대 10장). 보내지 않은 칸은 기존 이미지를 그대로 둔다.
  const guideImages = (v: unknown) => (Array.isArray(v) ? v : [])
    .map((u: unknown) => clip(u, 1000))
    .filter((u: string) => u.startsWith("/") || /^https:\/\//.test(u))
    .slice(0, 10);
  const keepGuideImages = !Array.isArray(p.descriptionImageUrls) && !Array.isArray(p.sizeGuideImageUrls) && !Array.isArray(p.deliveryGuideImageUrls);
  const descriptionImageUrls = guideImages(p.descriptionImageUrls);
  const descImgs = JSON.stringify(descriptionImageUrls);
  const sizeImgs = JSON.stringify(guideImages(p.sizeGuideImageUrls));
  const deliveryImgs = JSON.stringify(guideImages(p.deliveryGuideImageUrls));
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
  // 판매기간(한국 날짜). 예전 화면처럼 두 칸을 모두 보내지 않은 저장은 기존 기간을 그대로 둔다.
  const keepPeriod = p.saleStartDate === undefined && p.saleEndDate === undefined;
  const saleStartDate = parseDateInput(p.saleStartDate);
  const saleEndDate = parseDateInput(p.saleEndDate);
  if (saleStartDate === null || saleEndDate === null) return err("판매기간 날짜를 확인해 주세요.");
  if (saleStartDate && saleEndDate && saleEndDate < saleStartDate) return err("판매 종료일은 시작일과 같거나 뒤여야 합니다.");

  if (!Number.isFinite(salePrice) || salePrice <= 0) return err("판매가를 입력해 주세요.");
  if (!Number.isFinite(retailPrice) || retailPrice < salePrice) return err("정가는 판매가보다 같거나 커야 합니다.");
  if (!Number.isFinite(commissionRate) || commissionRate <= 0 || commissionRate > 90) return err("인플루언서 수수료율은 0% 초과 90% 이하로 입력해 주세요.");
  if (!Number.isFinite(shippingFee)) return err("배송비를 확인해 주세요.");
  if (!Number.isFinite(stock)) return err("재고 수량을 입력해 주세요.");
  if (productUrl && !isUrl(productUrl)) return err("상품 링크는 https:// 로 시작하는 주소로 입력해 주세요.");
  // 인플루언서가 상품 상세에서 눌러 자세히 보는 링크라, 새로 등록할 때와 판매중으로 둘 때는 꼭 있어야 한다.
  if (!productUrl && (!clip(p.id, 60) || status === "on_sale")) return err("상품 링크를 입력해 주세요. 인플루언서가 상품을 자세히 볼 때 쓰는 링크입니다.");
  if (status === "on_sale" && stock <= 0) return err("재고가 0개인 상품은 판매중으로 둘 수 없습니다.");
  // 상품 설명 · 사이즈 가이드 · 배송/반품 안내는 칸마다 글이나 이미지 중 하나가 꼭 있어야 한다.
  // 새로 등록할 때와 판매중으로 둘 때 확인한다(예전 상품을 판매중지로 돌리는 것은 막지 않는다).
  // 칸을 보내지 않은 예전 화면의 저장은 기존 값을 그대로 두므로 확인하지 않는다.
  if (!keepGuides && !keepGuideImages && (!clip(p.id, 60) || status === "on_sale")) {
    const missing = [
      [description, p.descriptionImageUrls, "상품 설명"],
      [sizeGuide, p.sizeGuideImageUrls, "사이즈 가이드"],
      [deliveryGuide, p.deliveryGuideImageUrls, "배송 · 반품 안내"],
    ].filter(([text, imgs]) => !String(text).trim() && guideImages(imgs).length === 0).map(([, , label]) => label);
    if (missing.length > 0) return err(`${missing.join(", ")}을(를) 글이나 이미지로 입력해 주세요.`);
  }

  // 이미 끝난 기간으로 새로 판매를 시작하지 않게 막는다(기간이 끝난 판매중 상품의 다른 칸 수정은 둔다).
  const id = clip(p.id, 60);
  if (status === "on_sale" && !keepPeriod && saleEndDate && saleEndDate < kstToday()) {
    const prev = id ? ((await db.sql`
      SELECT status, sale_end_date FROM affiliate_store_products
      WHERE id = ${id} AND business_username = ${username} AND deleted_at IS NULL
    `) as any[])[0] : null;
    if (!prev || prev.status !== "on_sale" || dateOnly(prev.sale_end_date) !== saleEndDate) {
      return err("판매 종료일이 이미 지났어요. 판매기간을 오늘 이후로 바꿔 주세요.");
    }
  }
  const startParam = saleStartDate || null;
  const endParam = saleEndDate || null;

  const imgs = JSON.stringify(imageUrls);
  const detailImgs = JSON.stringify(detailImageUrls);
  // 상세페이지 칸을 보내지 않은 저장(예: 예전 화면)은 기존 상세페이지를 그대로 둔다.
  const keepDetail = !Array.isArray(p.detailImageUrls);
  const opts = JSON.stringify(options);
  let rows: any[];
  if (id) {
    rows = (await db.sql`
      UPDATE affiliate_store_products SET
        name = ${name}, category = ${category}, subcategory = ${subcategory}, summary = ${summary}, description = ${description},
        image_urls = ${imgs}::jsonb, detail_image_urls = CASE WHEN ${keepDetail}::boolean THEN detail_image_urls ELSE ${detailImgs}::jsonb END, options = ${opts}::jsonb, retail_price = ${retailPrice}, sale_price = ${salePrice},
        commission_rate = ${commissionRate}, stock = ${stock}, shipping_fee = ${shippingFee},
        size_guide = CASE WHEN ${keepGuides}::boolean THEN size_guide ELSE ${sizeGuide} END,
        delivery_guide = CASE WHEN ${keepGuides}::boolean THEN delivery_guide ELSE ${deliveryGuide} END,
        description_image_urls = CASE WHEN ${keepGuideImages}::boolean THEN description_image_urls ELSE ${descImgs}::jsonb END,
        size_guide_image_urls = CASE WHEN ${keepGuideImages}::boolean THEN size_guide_image_urls ELSE ${sizeImgs}::jsonb END,
        delivery_guide_image_urls = CASE WHEN ${keepGuideImages}::boolean THEN delivery_guide_image_urls ELSE ${deliveryImgs}::jsonb END,
        sale_start_date = CASE WHEN ${keepPeriod}::boolean THEN sale_start_date ELSE ${startParam}::date END,
        sale_end_date = CASE WHEN ${keepPeriod}::boolean THEN sale_end_date ELSE ${endParam}::date END,
        product_url = ${productUrl}, status = ${status}, updated_at = NOW()
      WHERE id = ${id} AND business_username = ${username} AND deleted_at IS NULL
      RETURNING *
    `) as any[];
    if (!rows[0]) return err("상품을 찾을 수 없습니다.", 404);
  } else {
    rows = (await db.sql`
      INSERT INTO affiliate_store_products
        (id, business_username, name, category, subcategory, summary, description, image_urls, detail_image_urls, options,
         retail_price, sale_price, commission_rate, stock, shipping_fee, product_url, status, size_guide, delivery_guide,
         description_image_urls, size_guide_image_urls, delivery_guide_image_urls, sale_start_date, sale_end_date)
      VALUES
        (${newId("asp")}, ${username}, ${name}, ${category}, ${subcategory}, ${summary}, ${description}, ${imgs}::jsonb, ${detailImgs}::jsonb, ${opts}::jsonb,
         ${retailPrice}, ${salePrice}, ${commissionRate}, ${stock}, ${shippingFee}, ${productUrl}, ${status}, ${sizeGuide}, ${deliveryGuide},
         ${descImgs}::jsonb, ${sizeImgs}::jsonb, ${deliveryImgs}::jsonb, ${startParam}::date, ${endParam}::date)
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
  if (!(await requireApproved(db, username))) return err("입점 승인 후 인플루언서를 선정할 수 있습니다.", 403);
  const note = clip(body.note, 500);
  // 선정하면 담당자 연락 없이 바로 진행 확정(done)이 되고 인플루언서 전용 링크가 열린다.
  // 반려하면 신청 상태가 'rejected' 라 링크는 닫힌다(다시 선정하면 같은 링크가 살아난다).
  // 운영자가 링크를 잠시 닫은('contacting') 신청은 브랜드가 다시 선정해도 닫힌 채로 둔다.
  const rows = (await db.sql`
    UPDATE affiliate_store_requests SET status = ${decision}, brand_note = ${note},
      manager_status = CASE WHEN ${decision}::text = 'approved' AND manager_status <> 'contacting' THEN 'done' ELSE manager_status END,
      manager_updated_at = CASE WHEN ${decision}::text = 'approved' AND manager_status <> 'done' THEN NOW() ELSE manager_updated_at END,
      brand_seen_at = COALESCE(brand_seen_at, NOW()),
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
           p.deleted_at AS product_deleted_at, p.stock, p.stock AS product_stock, p.sale_start_date, p.sale_end_date, a.brand_name
    FROM affiliate_store_requests r
    JOIN affiliate_store_products p ON p.id = r.product_id
    LEFT JOIN affiliate_store_applications a ON a.business_username = r.business_username
    WHERE r.influencer_username = ${username} AND r.status = 'approved' AND r.manager_status = 'done'
    ORDER BY r.updated_at DESC
  `) as any[];
  for (const r of rows) if (!r.link_code) r.link_code = await ensureLinkCode(db, r.id);

  const stats = (await db.sql`
    SELECT request_id, COUNT(*)::int AS orders, COALESCE(SUM(quantity), 0)::int AS units,
           COALESCE(SUM(GREATEST(0, total_amount - shipping_fee - refund_amount)), 0)::bigint AS sales,
           COALESCE(SUM(commission_amount), 0)::bigint AS commission,
           COALESCE(SUM(commission_amount) FILTER (WHERE commission_status = 'pending'), 0)::bigint AS pending,
           COALESCE(SUM(commission_amount) FILTER (WHERE commission_status = 'confirmed'), 0)::bigint AS confirmed
    FROM affiliate_store_orders
    WHERE influencer_username = ${username}
      AND (status = ANY(${SALE_STATUSES}::text[]) OR status = 'cancelled')
      AND commission_status IN ('pending', 'confirmed')
    GROUP BY request_id
  `) as any[];
  const byReq = new Map(stats.map((s) => [s.request_id, s]));
  // 취소된 판매의 수수료(표시용).
  const cancelledRows = (await db.sql`
    SELECT COALESCE(SUM(commission_amount), 0)::bigint AS n FROM affiliate_store_orders
    WHERE influencer_username = ${username} AND commission_status = 'cancelled' AND status NOT IN ('pending_payment', 'expired')
  `) as any[];
  const orderCountRows = (await db.sql`
    SELECT COUNT(*)::int AS n FROM affiliate_store_orders
    WHERE influencer_username = ${username} AND status NOT IN ('pending_payment', 'expired')
  `) as any[];

  const items = rows.map((r) => {
    const st = byReq.get(r.id);
    return {
      ...shapeRequest(r),
      salePrice: Number(r.sale_price) || 0,
      commissionRate: Number(r.commission_rate) || 0,
      live: saleStateOf({
        status: r.product_status, deleted_at: r.product_deleted_at, stock: r.stock,
        sale_start_date: r.sale_start_date, sale_end_date: r.sale_end_date,
      }) === "on_sale",
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
  return Response.json({ items, totals, orderCount: Number(orderCountRows[0]?.n) || 0 });
}

const PAGE_SIZE = 40;
const CREATOR_ORDER_PAGE_SIZE = 40;
const BRAND_PAGE_SIZE = 30;

async function creatorMyAffiliateOrders(db: any, username: string, url: URL) {
  const cursorId = clip(url.searchParams.get("cursorId"), 120);
  const cursorTimeRaw = clip(url.searchParams.get("cursorAt"), 60);
  const cursorTimeValue = Date.parse(cursorTimeRaw);
  const hasCursor = !!cursorId && Number.isFinite(cursorTimeValue);
  const cursorAt = hasCursor ? new Date(cursorTimeValue).toISOString() : "1970-01-01T00:00:00.000Z";
  const rows = (await db.sql`
    SELECT * FROM affiliate_store_orders
    WHERE influencer_username = ${username} AND status NOT IN ('pending_payment', 'expired')
      AND (NOT ${hasCursor} OR created_at < ${cursorAt}::timestamptz OR
        (created_at = ${cursorAt}::timestamptz AND id < ${cursorId}))
    ORDER BY created_at DESC, id DESC
    LIMIT ${CREATOR_ORDER_PAGE_SIZE + 1}
  `) as any[];
  const orders = rows.slice(0, CREATOR_ORDER_PAGE_SIZE);
  const lastOrder = orders[orders.length - 1];
  return Response.json({
    orders: orders.map((o) => shapeOrder(o, false)),
    hasMore: rows.length > CREATOR_ORDER_PAGE_SIZE,
    nextCursor: rows.length > CREATOR_ORDER_PAGE_SIZE && lastOrder ? {
      cursorAt: new Date(lastOrder.created_at).toISOString(),
      cursorId: String(lastOrder.id),
    } : null,
  });
}

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
  const like = q ? likeOf(q) : "";
  const { hasCursor, cursorAt, cursorId } = readCursor(url);
  const today = kstToday();

  const rows = (await db.sql`
    SELECT p.id, p.business_username, p.name, p.category, p.subcategory, p.summary,
      CASE WHEN p.image_urls->0 IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(p.image_urls->0) END AS image_urls,
      p.retail_price, p.sale_price, p.commission_rate, p.status, p.sale_start_date, p.sale_end_date, p.created_at,
      a.brand_name
    FROM affiliate_store_products p
    JOIN affiliate_store_applications a ON a.business_username = p.business_username AND a.status = 'approved'
    WHERE p.deleted_at IS NULL AND p.status = 'on_sale'
      AND (p.sale_start_date IS NULL OR p.sale_start_date <= ${today}::date)
      AND (p.sale_end_date IS NULL OR p.sale_end_date >= ${today}::date)
      AND (${category} = '' OR p.category = ${category})
      AND (${sub} = '' OR p.subcategory = ${sub})
      AND (${brand} = '' OR p.business_username = ${brand})
      AND (${like} = '' OR p.name ILIKE ${like} OR a.brand_name ILIKE ${like})
      AND (NOT ${hasCursor} OR p.created_at < ${cursorAt}::timestamptz OR
        (p.created_at = ${cursorAt}::timestamptz AND p.id < ${cursorId}))
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ${PAGE_SIZE + 1}
  `) as any[];
  const { page, hasMore, nextCursor } = pageOf(rows, PAGE_SIZE, (p) => p.created_at);
  // 전체 건수는 첫 페이지에서만 센다("더 보기"는 목록만).
  const total = hasCursor ? undefined : Number(((await db.sql`
    SELECT COUNT(*)::int AS n
    FROM affiliate_store_products p
    JOIN affiliate_store_applications a ON a.business_username = p.business_username AND a.status = 'approved'
    WHERE p.deleted_at IS NULL AND p.status = 'on_sale'
      AND (p.sale_start_date IS NULL OR p.sale_start_date <= ${today}::date)
      AND (p.sale_end_date IS NULL OR p.sale_end_date >= ${today}::date)
      AND (${category} = '' OR p.category = ${category})
      AND (${sub} = '' OR p.subcategory = ${sub})
      AND (${brand} = '' OR p.business_username = ${brand})
      AND (${like} = '' OR p.name ILIKE ${like} OR a.brand_name ILIKE ${like})
  `) as any[])[0]?.n || 0);

  let brandInfo = null;
  if (brand) {
    const b = (await db.sql`
      SELECT business_username, brand_name, channel_url, categories FROM affiliate_store_applications
      WHERE business_username = ${brand} AND status = 'approved'
    `) as any[];
    if (b[0]) brandInfo = { username: b[0].business_username, brandName: b[0].brand_name, channelUrl: b[0].channel_url, categories: b[0].categories || [] };
  }
  return Response.json({
    products: page.map((p) => shapeProduct(p, true)),
    ...(total === undefined ? {} : { total }),
    hasMore,
    nextCursor,
    brand: brandInfo,
    taxonomy: TAXONOMY,
  });
}

/**
 * 상품 상세. 판매중(기간 안)인 상품은 누구나, 판매중지 · 기간 종료 등 지금 판매하지 않는 상품은
 * 이미 판매 신청한 인플루언서만 본다(응답 saleState 로 "판매 중지된 상품" 안내를 띄운다).
 */
async function creatorProductDetail(db: any, username: string, url: URL) {
  const id = clip(url.searchParams.get("id"), 100);
  if (!id) return err("상품을 찾을 수 없습니다.", 404);
  const rows = (await db.sql`
    SELECT p.*, a.brand_name,
      EXISTS (
        SELECT 1 FROM affiliate_store_requests r
        WHERE r.product_id = p.id AND r.influencer_username = ${username} AND r.status <> 'cancelled'
      ) AS has_request
    FROM affiliate_store_products p
    JOIN affiliate_store_applications a ON a.business_username = p.business_username AND a.status = 'approved'
    WHERE p.id = ${id} AND p.deleted_at IS NULL
    LIMIT 1
  `) as any[];
  const row = rows[0];
  if (!row) return err("판매 중인 상품을 찾을 수 없습니다.", 404);
  const state = saleStateOf(row);
  // 품절은 목록에도 보이므로 그대로 보여 준다. 그 밖의 판매하지 않는 상품은 신청한 인플루언서만.
  if (state !== "on_sale" && state !== "sold_out" && !row.has_request) return err("판매 중인 상품을 찾을 수 없습니다.", 404);
  return Response.json({ product: shapeProduct(row, true) });
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
      AND (p.sale_start_date IS NULL OR p.sale_start_date <= ${kstToday()}::date)
      AND (p.sale_end_date IS NULL OR p.sale_end_date >= ${kstToday()}::date)
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

const REQUEST_STATUS_MAX_IDS = 100;
const MY_REQUEST_PAGE_SIZE = 30;

/**
 * 내 판매 신청 상태 — "내 신청" 탭 숫자(전체 건수)와, 지금 화면에 보이는 상품(ids, 최대 100개)의 신청 상태.
 * 신청 목록 전체를 내려보내지 않는다.
 */
async function creatorRequestStatuses(db: any, username: string, url: URL) {
  const ids = String(url.searchParams.get("ids") || "")
    .split(",").map((v) => v.trim().slice(0, 100)).filter(Boolean)
    .slice(0, REQUEST_STATUS_MAX_IDS);
  const [requests, count] = await Promise.all([
    ids.length ? db.sql`
      SELECT product_id, status, manager_status
      FROM affiliate_store_requests
      WHERE influencer_username = ${username} AND status <> 'cancelled' AND product_id = ANY(${ids}::text[])
    ` as Promise<any[]> : Promise.resolve([]),
    db.sql`
      SELECT COUNT(*)::int AS n FROM affiliate_store_requests
      WHERE influencer_username = ${username} AND status <> 'cancelled'
    ` as Promise<any[]>,
  ]);
  return Response.json({
    total: Number(count[0]?.n || 0),
    requests: requests.map((r: any) => ({ productId: r.product_id, status: r.status, managerStatus: r.manager_status || "" })),
  });
}

/** 내 판매 신청 목록(최신순 커서). */
async function creatorRequests(db: any, username: string, url: URL) {
  const { hasCursor, cursorAt, cursorId } = readCursor(url);
  const rows = (await db.sql`
    SELECT r.id, r.product_id, r.influencer_username, r.message, r.channel_url, r.status,
           r.brand_note, r.manager_status, r.link_code, r.click_count, r.created_at, r.updated_at,
           p.name AS product_name, p.image_urls, a.brand_name,
           p.status AS product_status, p.deleted_at AS product_deleted_at, p.stock AS product_stock,
           p.sale_start_date, p.sale_end_date
    FROM affiliate_store_requests r
    JOIN affiliate_store_products p ON p.id = r.product_id
    LEFT JOIN affiliate_store_applications a ON a.business_username = r.business_username
    WHERE r.influencer_username = ${username} AND r.status <> 'cancelled'
      AND (NOT ${hasCursor} OR r.created_at < ${cursorAt}::timestamptz OR
        (r.created_at = ${cursorAt}::timestamptz AND r.id < ${cursorId}))
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${MY_REQUEST_PAGE_SIZE + 1}
  `) as any[];
  const { page, hasMore, nextCursor } = pageOf(rows, MY_REQUEST_PAGE_SIZE, (r) => r.created_at);
  return Response.json({ requests: page.map(shapeRequest), hasMore, nextCursor });
}

async function creatorRequest(db: any, username: string, body: any) {
  const productId = clip(body.productId, 60);
  const message = clip(body.message, 1000);
  const channelUrl = clip(body.channelUrl, 500);
  if (channelUrl && !isUrl(channelUrl)) return err("채널 주소는 https:// 로 시작하는 주소로 입력해 주세요.");
  const prows = (await db.sql`
    SELECT p.id, p.business_username, p.name, p.sale_start_date, p.sale_end_date FROM affiliate_store_products p
    JOIN affiliate_store_applications a ON a.business_username = p.business_username AND a.status = 'approved'
    WHERE p.id = ${productId} AND p.deleted_at IS NULL AND p.status = 'on_sale'
  `) as any[];
  const product = prows[0];
  if (!product) return err("판매중인 상품이 아닙니다.", 404);
  const periodState = saleStateOf({ status: "on_sale", sale_start_date: product.sale_start_date, sale_end_date: product.sale_end_date });
  if (periodState === "scheduled") return err("아직 판매기간이 시작되지 않은 상품입니다.");
  if (periodState === "ended") return err("판매기간이 끝난 상품입니다.");
  if (product.business_username === username) return err("내 브랜드 상품에는 신청할 수 없습니다.");
  const rows = (await db.sql`
    INSERT INTO affiliate_store_requests (id, product_id, business_username, influencer_username, message, channel_url)
    VALUES (${newId("asr")}, ${productId}, ${product.business_username}, ${username}, ${message}, ${channelUrl})
    ON CONFLICT (product_id, influencer_username) DO UPDATE SET
      message = EXCLUDED.message, channel_url = EXCLUDED.channel_url, status = 'pending', brand_note = '',
      brand_seen_at = NULL, updated_at = NOW()
    WHERE affiliate_store_requests.status IN ('cancelled', 'rejected')
    RETURNING *
  `) as any[];
  // 취소했거나 반려된 신청은 다시 낼 수 있다. 대기 중이거나 이미 선정된 신청만 막는다.
  if (!rows[0]) return err("이미 신청한 상품입니다.");
  // 브랜드에게 새 신청 알림(화면 알림 + 앱 푸시 · 실패해도 신청은 그대로).
  await notify(db, {
    recipientType: "brand",
    recipient: product.business_username,
    kind: "sales_request",
    title: "새 판매 신청이 도착했어요",
    body: `@${username} 님이 '${String(product.name || "").slice(0, 60)}' 판매를 신청했어요.`,
    link: "/business-admin?tab=affiliate",
  });
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
  // 이미 승인한 브랜드를 반려하면 주문 처리 · 반품 · 정산 화면이 모두 막혀, 결제된 주문이 자동 취소되고
  // 정산금도 찾지 못한다. 승인 뒤에는 반려하지 않는다(판매 중단은 상품 판매 중지로 한다).
  if (decision === "rejected") {
    const cur = (await db.sql`SELECT status FROM affiliate_store_applications WHERE id = ${id}`) as any[];
    if (cur[0]?.status === "approved") {
      return err("이미 승인한 브랜드는 반려할 수 없어요. 진행 중인 주문과 정산이 막히기 때문이에요.", 409);
    }
  }
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
  if (!canUseStore(username) && !caller.isAdmin) return err("아직 오픈 전인 메뉴입니다.", 403);

  // 인플루언서 쪽 기능은 크리에이터 승인을 받은 계정만 쓴다(기존 계정은 자동 승인).
  const creatorScope = ["creator", "product-detail", "brands", "my-request-status", "my-requests", "my-affiliate", "my-affiliate-orders"].includes(String(scope || ""))
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
      if (scope === "brand") return await brandGet(db, username, url);
      if (scope === "creator") return await creatorProducts(db, url);
      if (scope === "product-detail") return await creatorProductDetail(db, username, url);
      if (scope === "brands") return await creatorBrands(db, url);
      if (scope === "my-request-status") return await creatorRequestStatuses(db, username, url);
      if (scope === "my-requests") return await creatorRequests(db, username, url);
      if (scope === "my-affiliate") return await creatorMyAffiliate(db, username);
      if (scope === "my-affiliate-orders") return await creatorMyAffiliateOrders(db, username, url);
      return err("알 수 없는 요청입니다.");
    }
    switch (action) {
      case "apply": return await brandApply(db, username, body);
      case "save_product": return await brandSaveProduct(db, username, body);
      case "delete_product": return await brandDeleteProduct(db, username, body);
      case "review_request": return await brandReviewRequest(db, username, body);
      case "mark_requests_seen": return await brandMarkRequestsSeen(db, username, body);
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
