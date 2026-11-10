/**
 * 어필리에이트 e2e 테스트 — 실제 API 핸들러를 실제 SQL(PGlite 에 마이그레이션 전체 적용)로 돌린다.
 *
 *   실행: npm run test:affiliate
 *
 * 로그인은 테스트용("Authorization: Bearer test:<아이디>"), 포트원 결제 조회 · 취소는 가짜 응답으로 바꾼다.
 * 결제는 전체 공개(결제 가드 없음)라, 예전 항목 "결제 오픈 전 일반 구매자 차단" · "운영자 결제 오픈"은 없다.
 *
 * 개인정보(주민번호 · 계좌번호 · 토큰 · 구매자 정보)는 테스트 데이터도 가짜 값만 쓰고 출력하지 않는다.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { setupDatabase, loadHandlers, call } from "./helpers.mts";
import { brandSettlement, feeOf } from "../../netlify/functions/_shared/affiliate-store-orders.mts";
import { brandEntitled, createPayoutRequest, entitled } from "../../netlify/functions/_shared/affiliate-payouts.mts";
import { getDatabase } from "@picks/netlify-database";

const ADMIN = "operator1:admin";
const BRAND = "brand1";
const BRAND2 = "brand2";
const INF = "creator1";
const INF2 = "creator2";
const NEWBIE = "newbie1"; // 크리에이터 승인 전
const BUYER = "buyer1"; // 테스트 계정이 아닌 일반 구매자

let pg: any;
let h: Awaited<ReturnType<typeof loadHandlers>>;
let seq = 0;
const uid = (p: string) => `${p}_${(++seq).toString().padStart(5, "0")}`;

// ─────────────────────────── 준비 ───────────────────────────

const applicationInput = (brandName: string) => ({
  businessName: `${brandName} 주식회사`, businessNumber: "1234567890", brandName,
  channelUrl: "https://example.com", categories: ["뷰티"], contactName: "담당자", contactPosition: "팀장",
  contactPhone: "010-0000-0000", contactEmail: "brand@example.com", ceoName: "대표", businessAddress: "서울시",
  csPhone: "02-000-0000", mailOrderNumber: "2026-서울-0000", inquiryUrl: "https://example.com/qna",
  directDealAgreement: true,
});

const productInput = (name: string, extra: Record<string, unknown> = {}) => ({
  name, category: "뷰티", subcategory: "립", summary: "요약", description: "설명",
  imageUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
  detailImageUrls: ["https://example.com/detail.jpg"], sizeGuide: "사이즈", deliveryGuide: "배송 안내",
  descriptionImageUrls: [], sizeGuideImageUrls: [], deliveryGuideImageUrls: [],
  options: [], retailPrice: 20000, salePrice: 15000, commissionRate: 10, stock: 100, shippingFee: 3000,
  productUrl: "https://example.com/product", status: "on_sale", ...extra,
});

async function approvedBrand(username: string, brandName: string) {
  const apply = await call(h.store, username, "POST", "/api/affiliate-store", { action: "apply", ...applicationInput(brandName) });
  assert.equal(apply.status, 201, JSON.stringify(apply.body));
  const review = await call(h.store, ADMIN, "POST", "/api/affiliate-store", { action: "review_application", id: apply.body.application.id, decision: "approve" });
  assert.equal(review.status, 200);
  return apply.body.application.id as string;
}

async function saveProduct(username: string, name: string, extra: Record<string, unknown> = {}) {
  const r = await call(h.store, username, "POST", "/api/affiliate-store", { action: "save_product", product: productInput(name, extra) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.product;
}

/** 주문이 걸릴 실제 판매 신청(브랜드 · 인플루언서별 하나). 상품은 그 브랜드의 아무 상품. */
const fixtureRequests = new Map<string, { requestId: string; productId: string; code: string }>();
async function fixtureRequest(brand: string, influencer: string) {
  const key = `${brand}:${influencer}`;
  const hit = fixtureRequests.get(key);
  if (hit) return hit;
  const product = (await pg.query(`SELECT id FROM affiliate_store_products WHERE business_username = $1 ORDER BY created_at LIMIT 1`, [brand])).rows[0];
  assert.ok(product, `${brand} 상품이 필요하다`);
  const requestId = uid("req");
  const code = `fx${requestId.replace(/\W/g, "")}`.slice(0, 10);
  await pg.query(
    `INSERT INTO affiliate_store_requests (id, product_id, business_username, influencer_username, status, manager_status, link_code)
     VALUES ($1, $2, $3, $4, 'approved', 'done', $5)
     ON CONFLICT (product_id, influencer_username) DO NOTHING`,
    [requestId, product.id, brand, influencer, code],
  );
  const row = (await pg.query(`SELECT id, link_code FROM affiliate_store_requests WHERE product_id = $1 AND influencer_username = $2`, [product.id, influencer])).rows[0];
  const v = { requestId: row.id, productId: product.id, code: row.link_code || code };
  fixtureRequests.set(key, v);
  return v;
}

/** 주문을 바로 넣는다(결제 흐름은 C 에서 따로 본다). 시각은 now − minutesAgo. */
async function insertOrder(o: {
  brand: string; influencer?: string; status: string; minutesAgo: number;
  unitPrice?: number; quantity?: number; shippingFee?: number; commissionRate?: number;
  platformRate?: number; pgRate?: number; refund?: number; commissionStatus?: string; returnStatus?: string;
  cancelledMinutesAgo?: number;
}) {
  const id = uid("ord");
  const unit = o.unitPrice ?? 15000;
  const qty = o.quantity ?? 1;
  const ship = o.shippingFee ?? 3000;
  const rate = o.commissionRate ?? 10;
  const commission = Math.floor((unit * qty * rate) / 100);
  const at = `NOW() - interval '${o.minutesAgo} minutes'`;
  const fx = await fixtureRequest(o.brand, o.influencer ?? INF);
  await pg.query(
    `INSERT INTO affiliate_store_orders
       (id, request_id, product_id, business_username, influencer_username, link_code, product_name, quantity, unit_price,
        shipping_fee, total_amount, commission_rate, commission_amount, buyer_name, buyer_phone, recipient_name, recipient_phone,
        address1, status, commission_status, platform_rate, pg_rate, refund_amount, buyer_user_id, created_at, paid_at,
        confirmed_at, cancelled_at, commission_confirmed_at)
     VALUES ($1, $16, $17, $2, $3, $18, '테스트 상품', $4, $5, $6, $7, $8, $9, '구매자', '01000000000', '받는분', '01000000000',
       '서울', $10, $11, $12, $13, $14, 'uid-buyer', ${at}, ${at},
       CASE WHEN $10 = 'confirmed' THEN ${at} END,
       CASE WHEN $10 = 'cancelled' THEN NOW() - ($15::int * interval '1 minute') END,
       CASE WHEN $11 = 'confirmed' THEN ${at} END)`,
    [id, o.brand, o.influencer ?? INF, qty, unit, ship, unit * qty + ship, rate, commission, o.status,
      o.commissionStatus ?? (o.status === "confirmed" ? "confirmed" : o.status === "cancelled" ? "cancelled" : "pending"),
      o.platformRate ?? 5, o.pgRate ?? 3.3, o.refund ?? 0, o.cancelledMinutesAgo ?? o.minutesAgo, fx.requestId, fx.productId, fx.code],
  );
  if (o.returnStatus) {
    await pg.query(
      `INSERT INTO affiliate_store_returns (id, order_id, business_username, buyer_user_id, reason, status, requested_at)
       VALUES ($1, $2, $3, 'uid-buyer', '단순 변심', $4, NOW() - ($5::int * interval '1 minute'))`,
      [uid("ret"), id, o.brand, o.returnStatus, Math.max(0, o.minutesAgo - 1)],
    );
  }
  return id;
}

/** 커서를 따라 끝까지 읽는다. */
async function readAll(fetchPage: (cursor: any) => Promise<{ items: any[]; hasMore: boolean; nextCursor: any }>, max = 50) {
  const all: any[] = [];
  let cursor: any = null;
  for (let i = 0; i < max; i++) {
    const page = await fetchPage(cursor);
    all.push(...page.items);
    if (!page.hasMore) return all;
    assert.ok(page.nextCursor, "hasMore 인데 nextCursor 가 없다");
    cursor = page.nextCursor;
  }
  throw new Error("페이지가 끝나지 않는다");
}
const qs = (cursor: any) => (cursor ? `&cursorAt=${encodeURIComponent(cursor.cursorAt)}&cursorId=${encodeURIComponent(cursor.cursorId)}` : "");
const ids = (rows: any[]) => rows.map((r) => r.id);
const assertUnique = (list: string[], label: string) => assert.equal(new Set(list).size, list.length, `${label}: 중복 항목`);

// 포트원(결제 조회 · 취소)은 가짜 응답. 결제 금액은 주문 금액과 같게 돌려준다.
const realFetch = globalThis.fetch;
function stubPortOne() {
  process.env.PORTONE_V2_API_SECRET = "test-only";
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url);
    if (!url.startsWith("https://api.portone.io/payments/")) return realFetch(input, init);
    const paymentId = decodeURIComponent(url.slice("https://api.portone.io/payments/".length).split("/")[0]);
    if (init?.method === "POST") return Response.json({ cancellation: { status: "SUCCEEDED" } });
    const r = await pg.query(`SELECT total_amount, buyer_user_id FROM affiliate_store_orders WHERE id = $1`, [paymentId]);
    const o = r.rows[0];
    if (!o) return new Response("{}", { status: 404 });
    return Response.json({
      id: paymentId, status: "PAID", currency: "KRW", amount: { total: o.total_amount, paid: o.total_amount },
      customer: { id: o.buyer_user_id }, paidAt: new Date().toISOString(), channel: { type: "LIVE", pgProvider: "NICE_V2" },
    });
  }) as typeof fetch;
}

before(async () => {
  pg = await setupDatabase();
  h = await loadHandlers();
  stubPortOne();
  // 기존 인플루언서(자동 승인) 두 명 + 승인 전 한 명
  await pg.query(`INSERT INTO creator_applications (username, source, status) VALUES ($1, 'legacy', 'approved'), ($2, 'legacy', 'approved'), ($3, 'apply', 'pending')`, [INF, INF2, NEWBIE]);
});
after(async () => {
  globalThis.fetch = realFetch;
  await pg?.close();
});

// ─────────────────────────── A. 입점 · 상품 ───────────────────────────

describe("A. 입점 · 상품 관리", () => {
  test("입점 신청은 직거래 금지 동의가 없으면 막힌다", async () => {
    const { directDealAgreement: _a, ...rest } = applicationInput("동의안함");
    const r = await call(h.store, "brand_noagree", "POST", "/api/affiliate-store", { action: "apply", ...rest });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /직거래/);
  });

  test("브랜드 입점 신청 → 운영자 승인, 승인 뒤에는 반려할 수 없다", async () => {
    const id = await approvedBrand(BRAND, "브랜드원");
    const reject = await call(h.store, ADMIN, "POST", "/api/affiliate-store", { action: "review_application", id, decision: "reject", reason: "x" });
    assert.equal(reject.status, 409);
    await approvedBrand(BRAND2, "브랜드투");
  });

  test("상품 목록: 30개씩 커서 · 첫 페이지에만 숫자 · 더 보기는 목록만", async () => {
    for (let i = 0; i < 35; i++) await saveProduct(BRAND, `상품 ${String(i).padStart(2, "0")}`);
    const first = await call(h.store, BRAND, "GET", "/api/affiliate-store?scope=brand");
    assert.equal(first.status, 200);
    assert.equal(first.body.products.length, 30);
    assert.equal(first.body.productHasMore, true);
    assert.equal(first.body.productTotal, 35);
    assert.equal(first.body.onSaleTotal, 35);
    assert.ok(first.body.feeRates && first.body.taxonomy && first.body.opsCounts, "첫 페이지에 숫자 · 수수료율 · 배지가 온다");

    const more = await call(h.store, BRAND, "GET", `/api/affiliate-store?scope=brand${qs(first.body.productNextCursor)}`);
    assert.equal(more.status, 200);
    assert.equal(more.body.products.length, 5);
    assert.equal(more.body.productHasMore, false);
    for (const key of ["productTotal", "onSaleTotal", "opsCounts", "feeRates", "application", "taxonomy"]) {
      assert.equal(key in more.body, false, `더 보기 응답에 ${key} 가 없어야 한다`);
    }
    assertUnique([...ids(first.body.products), ...ids(more.body.products)], "상품");
  });

  test("상품 더 보기 '다시 시도': 같은 커서로 다시 받으면 같은 결과", async () => {
    const first = await call(h.store, BRAND, "GET", "/api/affiliate-store?scope=brand");
    const a = await call(h.store, BRAND, "GET", `/api/affiliate-store?scope=brand${qs(first.body.productNextCursor)}`);
    const b = await call(h.store, BRAND, "GET", `/api/affiliate-store?scope=brand${qs(first.body.productNextCursor)}`);
    assert.deepEqual(ids(a.body.products), ids(b.body.products));
  });

  test("보는 도중 상품이 추가 · 삭제돼도 다음 페이지가 겹치거나 빠지지 않는다", async () => {
    const first = await call(h.store, BRAND, "GET", "/api/affiliate-store?scope=brand");
    const seen = ids(first.body.products);
    await saveProduct(BRAND, "새 상품(보는 도중 추가)");
    const del = await call(h.store, BRAND, "POST", "/api/affiliate-store", { action: "delete_product", id: seen[0] });
    assert.equal(del.status, 200);
    const more = await call(h.store, BRAND, "GET", `/api/affiliate-store?scope=brand${qs(first.body.productNextCursor)}`);
    assert.equal(more.body.products.length, 5);
    assert.equal(more.body.products.some((p: any) => seen.includes(p.id)), false);
  });

  test("판매 상태 변경 · 삭제 뒤 숫자만 새로 받는다(section=counts)", async () => {
    const before = await call(h.store, BRAND, "GET", "/api/affiliate-store?scope=brand&section=counts");
    assert.equal(before.status, 200);
    assert.equal("products" in before.body, false);
    const list = await call(h.store, BRAND, "GET", "/api/affiliate-store?scope=brand");
    const target = list.body.products[1];
    const paused = await call(h.store, BRAND, "POST", "/api/affiliate-store", { action: "save_product", product: { ...productInput(target.name), id: target.id, status: "paused" } });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.product.id, target.id);
    assert.equal(paused.body.product.status, "paused");
    const afterPause = await call(h.store, BRAND, "GET", "/api/affiliate-store?scope=brand&section=counts");
    assert.equal(afterPause.body.onSaleTotal, before.body.onSaleTotal - 1);
    assert.equal(afterPause.body.productTotal, before.body.productTotal);
    await call(h.store, BRAND, "POST", "/api/affiliate-store", { action: "delete_product", id: target.id });
    const afterDelete = await call(h.store, BRAND, "GET", "/api/affiliate-store?scope=brand&section=counts");
    assert.equal(afterDelete.body.productTotal, before.body.productTotal - 1);
  });

  test("상품 둘러보기: 40개씩 커서 · 목록은 대표 이미지 1장 · 상세 펼치기는 전체 정보", async () => {
    for (let i = 0; i < 12; i++) await saveProduct(BRAND2, `브랜드투 상품 ${i}`);
    const first = await call(h.store, INF, "GET", "/api/affiliate-store?scope=creator");
    assert.equal(first.status, 200);
    assert.equal(first.body.products.length, 40);
    assert.ok(first.body.total >= 40);
    assert.ok(first.body.products.every((p: any) => p.imageUrls.length <= 1), "목록에는 대표 이미지만");
    assert.equal(first.body.products.some((p: any) => "stock" in p || "shippingFee" in p), false, "재고 · 배송비는 인플루언서에게 보내지 않는다");
    const rest = await readAll(async (c) => {
      const r = await call(h.store, INF, "GET", `/api/affiliate-store?scope=creator${qs(c)}`);
      if (c) assert.equal("total" in r.body, false, "더 보기에는 total 이 없다");
      return { items: r.body.products, hasMore: r.body.hasMore, nextCursor: r.body.nextCursor };
    });
    assert.equal(rest.length, first.body.total);
    assertUnique(ids(rest), "상품 둘러보기");

    const detail = await call(h.store, INF, "GET", `/api/affiliate-store?scope=product-detail&id=${first.body.products[0].id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.product.imageUrls.length, 2);
    assert.equal(detail.body.product.detailImageUrls.length, 1);
    assert.equal(detail.body.product.deliveryGuide, "배송 안내");
  });

  test("검색 · 브랜드로 거른 목록도 커서로 끝까지 읽힌다", async () => {
    const all = await readAll(async (c) => {
      const r = await call(h.store, INF, "GET", `/api/affiliate-store?scope=creator&brand=${BRAND2}${qs(c)}`);
      return { items: r.body.products, hasMore: r.body.hasMore, nextCursor: r.body.nextCursor };
    });
    assert.equal(all.length, 12);
  });

  test("크리에이터 승인 전 계정은 인플루언서 메뉴를 쓸 수 없다", async () => {
    const r = await call(h.store, NEWBIE, "GET", "/api/affiliate-store?scope=creator");
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "CREATOR_APPROVAL_REQUIRED");
  });

  test("수수료율은 브랜드가 정한 값 그대로 인플루언서에게 보인다", async () => {
    const p = await saveProduct(BRAND2, "수수료 표시 확인", { commissionRate: 17.5 });
    const d = await call(h.store, INF, "GET", `/api/affiliate-store?scope=product-detail&id=${p.id}`);
    assert.equal(d.body.product.commissionRate, 17.5);
  });
});

// ─────────────────────────── B. 판매 신청 ───────────────────────────

describe("B. 판매 신청 · 선정", () => {
  let requestIds: string[] = [];
  let productIds: string[] = [];

  test("내 신청: 전체 건수는 서버가 세고, 상태는 보이는 상품 것만 받는다", async () => {
    const list = await readAll(async (c) => {
      const r = await call(h.store, INF2, "GET", `/api/affiliate-store?scope=creator&brand=${BRAND}${qs(c)}`);
      return { items: r.body.products, hasMore: r.body.hasMore, nextCursor: r.body.nextCursor };
    });
    productIds = ids(list).slice(0, 33);
    // 기존(자동 승인) 크리에이터는 첫 판매 신청 때 직거래 금지 안내에 동의해야 한다.
    const before = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-request-status");
    assert.equal(before.body.directDealAgreed, false);
    const blocked = await call(h.store, INF2, "POST", "/api/affiliate-store", { action: "request", productId: productIds[0], message: "", channelUrl: "" });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.code, "DIRECT_DEAL_AGREEMENT_REQUIRED");
    for (const [i, id] of productIds.entries()) {
      const r = await call(h.store, INF2, "POST", "/api/affiliate-store", {
        action: "request", productId: id, message: "신청합니다", channelUrl: "", ...(i === 0 ? { directDealAgreement: true } : {}),
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      requestIds.push(r.body.request.id);
    }
    const none = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-request-status");
    assert.equal(none.body.total, 33);
    assert.equal(none.body.directDealAgreed, true, "한 번 동의하면 다음 신청부터는 묻지 않는다");
    assert.equal(none.body.requests.length, 0, "ids 없이 부르면 건수만");
    const some = await call(h.store, INF2, "GET", `/api/affiliate-store?scope=my-request-status&ids=${[productIds[0], productIds[1], list[40]?.id || "nope"].join(",")}`);
    assert.equal(some.body.total, 33);
    assert.deepEqual(some.body.requests.map((r: any) => r.productId).sort(), [productIds[0], productIds[1]].sort());
  });

  test("같은 상품에 다시 신청하면 막힌다", async () => {
    const r = await call(h.store, INF2, "POST", "/api/affiliate-store", { action: "request", productId: productIds[0], message: "", channelUrl: "" });
    assert.equal(r.status, 400);
  });

  test("내 신청 목록 · 브랜드 받은 신청: 30개씩 커서 · 첫 페이지에만 건수", async () => {
    const mine = await readAll(async (c) => {
      const r = await call(h.store, INF2, "GET", `/api/affiliate-store?scope=my-requests${qs(c)}`);
      if (!c) assert.equal(r.body.requests.length, 30);
      return { items: r.body.requests, hasMore: r.body.hasMore, nextCursor: r.body.nextCursor };
    });
    assert.equal(mine.length, 33);
    assertUnique(ids(mine), "내 신청");

    const first = await call(h.store, BRAND, "GET", "/api/affiliate-store?scope=brand&section=requests");
    assert.equal(first.body.requests.length, 30);
    assert.equal(first.body.requestTotal, 33);
    assert.equal(first.body.pendingRequestCount, 33);
    const more = await call(h.store, BRAND, "GET", `/api/affiliate-store?scope=brand&section=requests${qs(first.body.requestNextCursor)}`);
    assert.equal(more.body.requests.length, 3);
    assert.equal("requestTotal" in more.body, false);
  });

  test("브랜드가 선정하면 배송정보 입력을 기다리고, 인플루언서가 입력하면 협업이 진행된다", async () => {
    const r = await call(h.store, BRAND, "POST", "/api/affiliate-store", { action: "review_request", id: requestIds[0], decision: "approve" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.request.status, "approved");
    assert.equal(r.body.request.shippingStatus, "awaiting_info");
    assert.equal(r.body.request.managerStatus, "waiting");
    assert.equal(r.body.request.linkCode, "", "배송정보 입력 전에는 링크가 열리지 않는다");
    // 선정하는 순간 운영 콘솔에 새 선정으로 올라온다.
    const opsNew = await call(h.store, ADMIN, "GET", "/api/affiliate-store?scope=selections&countOnly=1");
    assert.equal(opsNew.body.newCount, 1);
    const opsList = await call(h.store, ADMIN, "GET", "/api/affiliate-store?scope=selections");
    const fresh = opsList.body.selections.find((x: any) => x.id === requestIds[0]);
    assert.equal(fresh.shippingStatus, "awaiting_info");
    assert.equal(fresh.operatorUnseen, true);
    const seen = await call(h.store, ADMIN, "POST", "/api/affiliate-store", { action: "manager_mark_seen", ids: [requestIds[0]] });
    assert.equal(seen.body.newCount, 0);
    const counts = await call(h.store, BRAND, "GET", "/api/affiliate-store?scope=brand&section=counts");
    assert.equal(counts.body.pendingRequestCount, 32);

    const status = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-request-status");
    assert.equal(status.body.awaitingShippingCount, 1);
    const mineBefore = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-affiliate");
    assert.equal(mineBefore.body.items.length, 0, "협업 진행 전에는 MY 어필리에이트에 없다");

    // 다른 사람은 배송정보를 넣을 수 없다.
    const other = await call(h.store, INF, "POST", "/api/affiliate-store", {
      action: "submit_shipping", id: requestIds[0], recipientName: "받는분", recipientPhone: "010-0000-0000", address1: "서울시", address2: "1호",
    });
    assert.equal(other.status, 404);
    const missing = await call(h.store, INF2, "POST", "/api/affiliate-store", { action: "submit_shipping", id: requestIds[0], recipientName: "받는분" });
    assert.equal(missing.status, 400);
    // 송장은 배송정보가 들어오기 전에는 넣을 수 없다.
    const early = await call(h.store, BRAND, "POST", "/api/affiliate-store", { action: "ship_selection", id: requestIds[0], trackingCompany: "CJ대한통운", trackingNumber: "123456789" });
    assert.equal(early.status, 404);

    const sub = await call(h.store, INF2, "POST", "/api/affiliate-store", {
      action: "submit_shipping", id: requestIds[0], recipientName: "받는분", recipientPhone: "010-0000-0000",
      postcode: "06000", address1: "서울시 강남구", address2: "101호", memo: "문 앞",
    });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal(sub.body.request.shippingStatus, "info_submitted");
    assert.equal(sub.body.request.managerStatus, "waiting");
    assert.equal(sub.body.request.linkCode, "", "송장 입력 전에는 판매 링크가 열리지 않는다");
    const mineWaiting = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-affiliate");
    assert.equal(mineWaiting.body.items.length, 0);

    // 협업이 진행 중이면 브랜드는 반려할 수 없다.
    const rej = await call(h.store, BRAND, "POST", "/api/affiliate-store", { action: "review_request", id: requestIds[0], decision: "reject" });
    assert.equal(rej.status, 409);

    const brandList = await call(h.store, BRAND, "GET", `/api/affiliate-store?scope=brand&section=requests&status=approved`);
    const row = brandList.body.requests.find((x: any) => x.id === requestIds[0]);
    assert.equal(row.shipping.address1, "서울시 강남구");
    const brandCounts = await call(h.store, BRAND, "GET", "/api/affiliate-store?scope=brand&section=counts");
    assert.equal(brandCounts.body.shipPendingCount, 1);

    const shipped = await call(h.store, BRAND, "POST", "/api/affiliate-store", { action: "ship_selection", id: requestIds[0], trackingCompany: "CJ대한통운", trackingNumber: "1234 5678 9012" });
    assert.equal(shipped.status, 200, JSON.stringify(shipped.body));
    assert.equal(shipped.body.request.shippingStatus, "shipped");
    assert.equal(shipped.body.request.trackingNumber, "123456789012");
    assert.ok(shipped.body.request.trackingUrl);
    assert.equal(shipped.body.request.managerStatus, "done");
    assert.match(shipped.body.request.linkCode, /^[A-Za-z0-9]{10}$/, "송장을 입력하면 판매 링크가 열린다");
    const mine = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-affiliate");
    assert.equal(mine.body.items.length, 1);
    const again = await call(h.store, INF2, "POST", "/api/affiliate-store", {
      action: "submit_shipping", id: requestIds[0], recipientName: "받는분", recipientPhone: "010-0000-0000", address1: "서울시", address2: "1호",
    });
    assert.equal(again.status, 404, "발송 뒤에는 배송정보를 고칠 수 없다");

    // 운영 콘솔: 배송정보가 들어온 협업을 배송지 · 송장과 함께 본다.
    const ops = await call(h.store, ADMIN, "GET", "/api/affiliate-store?scope=selections");
    assert.equal(ops.status, 200, JSON.stringify(ops.body));
    const sel = ops.body.selections.find((x: any) => x.id === requestIds[0]);
    assert.equal(sel.shippingStatus, "shipped");
    assert.equal(sel.shipping.recipientName, "받는분");
    assert.equal(sel.trackingCompany, "CJ대한통운");
  });

  test("인플루언서가 배송정보 대신 반려하면 협업은 진행되지 않는다", async () => {
    const id = requestIds[2];
    const ok = await call(h.store, BRAND, "POST", "/api/affiliate-store", { action: "review_request", id, decision: "approve" });
    assert.equal(ok.status, 200);
    const d = await call(h.store, INF2, "POST", "/api/affiliate-store", { action: "decline_selection", id, reason: "일정이 맞지 않아요" });
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal(d.body.request.shippingStatus, "declined");
    assert.equal(d.body.request.linkCode, "");
    const sub = await call(h.store, INF2, "POST", "/api/affiliate-store", {
      action: "submit_shipping", id, recipientName: "받는분", recipientPhone: "010-0000-0000", address1: "서울시", address2: "1호",
    });
    assert.equal(sub.status, 404, "반려한 뒤에는 배송정보를 넣을 수 없다");
    const reapprove = await call(h.store, BRAND, "POST", "/api/affiliate-store", { action: "review_request", id, decision: "approve" });
    assert.equal(reapprove.status, 409);
    const mine = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-affiliate");
    assert.equal(mine.body.items.length, 1, "반려한 협업은 MY 어필리에이트에 없다");
    const shop = (await import("../../netlify/functions/api-affiliate-shop.mts")).default as any;
    const code = (await pg.query(`SELECT link_code FROM affiliate_store_requests WHERE id = $1`, [id])).rows[0]?.link_code;
    if (code) assert.notEqual((await call(shop, null, "GET", `/api/affiliate-shop?code=${code}`)).status, 200);
  });

  test("대기 중 신청 취소 → 건수가 줄고 목록에서 빠진다", async () => {
    const r = await call(h.store, INF2, "POST", "/api/affiliate-store", { action: "cancel_request", id: requestIds[1] });
    assert.equal(r.status, 200);
    const s = await call(h.store, INF2, "GET", `/api/affiliate-store?scope=my-request-status&ids=${productIds[1]}`);
    assert.equal(s.body.total, 32);
    assert.equal(s.body.requests.length, 0);
  });
});

// ─────────────────────────── C. 구매 · 결제(전체 공개) ───────────────────────────

describe("C. 구매 · 결제", () => {
  let code = "";
  test("선정된 링크로 일반 구매자가 주문 · 결제할 수 있다", async () => {
    const mine = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-affiliate");
    assert.equal(mine.status, 200);
    code = mine.body.items[0]?.linkCode;
    assert.ok(code, "선정된 상품의 링크 코드");
    const shop = (await import("../../netlify/functions/api-affiliate-shop.mts")).default as any;
    const page = await call(shop, null, "GET", `/api/affiliate-shop?code=${code}`);
    assert.equal(page.status, 200);
    const order = await call(shop, BUYER, "POST", "/api/affiliate-shop", {
      action: "create_order", code, quantity: 1, buyerName: "구매자", buyerPhone: "010-0000-0000",
      address1: "서울시", agreeTerms: true, agreeProvide: true, payMethod: "CARD",
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const done = await call(shop, BUYER, "POST", "/api/affiliate-shop", { action: "complete", orderId: order.body.orderId });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const row = (await pg.query(`SELECT status, commission_amount FROM affiliate_store_orders WHERE id = $1`, [order.body.orderId])).rows[0];
    assert.equal(row.status, "paid");
    assert.equal(row.commission_amount, 1500);
  });

  test("MY 어필리에이트: 판매 건수는 서버가 세고, 판매 내역은 커서로 나눠 받는다", async () => {
    const mine = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-affiliate");
    assert.equal(mine.body.orderCount, 1);
    assert.equal("orders" in mine.body, false);
    const orders = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-affiliate-orders");
    assert.equal(orders.body.orders.length, 1);
    assert.equal(orders.body.hasMore, false);
    assert.equal("buyerPhone" in orders.body.orders[0], false, "인플루언서에게 구매자 연락처를 보내지 않는다");
  });

  test("인플루언서 본인 링크 구매 → 정상 주문 · 수수료 pending", async () => {
    const shop = (await import("../../netlify/functions/api-affiliate-shop.mts")).default as any;
    const order = await call(shop, INF2, "POST", "/api/affiliate-shop", {
      action: "create_order", code, quantity: 2, buyerName: "본인", buyerPhone: "010-0000-0000",
      address1: "서울시", agreeTerms: true, agreeProvide: true, payMethod: "CARD",
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const done = await call(shop, INF2, "POST", "/api/affiliate-shop", { action: "complete", orderId: order.body.orderId });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const row = (await pg.query(
      `SELECT status, influencer_username, commission_amount, commission_status FROM affiliate_store_orders WHERE id = $1`,
      [order.body.orderId],
    )).rows[0];
    assert.equal(row.status, "paid");
    assert.equal(row.influencer_username, INF2, "본인 링크 판매로 잡힌다");
    assert.equal(row.commission_amount, 3000, "15,000원 × 2개 × 10%");
    assert.equal(row.commission_status, "pending");
    const mine = await call(h.store, INF2, "GET", "/api/affiliate-store?scope=my-affiliate");
    assert.equal(mine.body.orderCount, 2);
  });
});

// ─────────────────────────── D. 브랜드 주문 운영 ───────────────────────────

describe("D. 주문 관리 · 취소·반품", () => {
  const OPS = "/api/affiliate-store-ops?scope=brand";

  test("필터는 서버에서 거른다: 최근 40건 밖의 신규 주문도 '신규' 필터에 모두 나온다", async () => {
    // 오래된 결제완료 5건 + 그보다 최근의 배송 중 · 배송 완료 50건
    for (let i = 0; i < 5; i++) await insertOrder({ brand: BRAND, status: "paid", minutesAgo: 10_000 + i });
    for (let i = 0; i < 50; i++) await insertOrder({ brand: BRAND, status: i % 2 ? "shipped" : "delivered", minutesAgo: 100 + i });
    const r = await call(h.ops, BRAND, "GET", `${OPS}&view=orders&filter=new`);
    assert.equal(r.status, 200);
    assert.equal(r.body.summary.orderCounts.new, 7, "C 의 결제 2건(일반 구매 · 본인 구매) + 오래된 5건");
    assert.equal(r.body.orders.length, 7);
    assert.ok(r.body.orders.every((o: any) => o.status === "paid"));
    const shipped = await call(h.ops, BRAND, "GET", `${OPS}&view=orders&filter=shipped&summary=0`);
    assert.equal(shipped.body.orders.length, 25);
    assert.equal("summary" in shipped.body, false, "summary=0 이면 숫자 없이 목록만");
    const delivered = await call(h.ops, BRAND, "GET", `${OPS}&view=orders&filter=delivered&summary=0`);
    assert.equal(delivered.body.orders.length, 25);
  });

  test("전체 주문 커서: 40건씩 겹치지 않고 끝까지", async () => {
    const all = await readAll(async (c) => {
      const r = await call(h.ops, BRAND, "GET", `${OPS}&view=orders&filter=all${qs(c)}`);
      if (c) assert.equal("summary" in r.body, false, "다음 페이지에는 숫자가 없다");
      return { items: r.body.orders, hasMore: r.body.hasMore, nextCursor: r.body.nextCursor };
    });
    const first = await call(h.ops, BRAND, "GET", `${OPS}&view=orders&filter=all`);
    assert.equal(all.length, first.body.summary.orderCounts.all);
    assertUnique(ids(all), "주문");
  });

  test("취소·반품 필터도 서버에서 거르고, 숫자와 목록이 맞다", async () => {
    for (let i = 0; i < 3; i++) await insertOrder({ brand: BRAND, status: "cancelled", minutesAgo: 20_000 + i, refund: 18000 });
    await insertOrder({ brand: BRAND, status: "return_requested", minutesAgo: 20_100, returnStatus: "requested" });
    await insertOrder({ brand: BRAND, status: "return_requested", minutesAgo: 20_101, returnStatus: "approved" });
    await insertOrder({ brand: BRAND, status: "delivered", minutesAgo: 20_102, returnStatus: "rejected" });
    const first = await call(h.ops, BRAND, "GET", `${OPS}&view=claims&claim=all`);
    const c = first.body.summary.claimCounts;
    assert.deepEqual(c, { all: 6, cancel: 3, return: 3, action: 2 });
    for (const [claim, n] of Object.entries({ all: 6, cancel: 3, return: 3, action: 2 })) {
      const r = await call(h.ops, BRAND, "GET", `${OPS}&view=claims&claim=${claim}&summary=0`);
      assert.equal(r.body.orders.length, n, `claim=${claim}`);
    }
  });

  test("주문 처리 뒤에는 그 주문 한 건과 숫자만 다시 받는다", async () => {
    const list = await call(h.ops, BRAND, "GET", `${OPS}&view=orders&filter=new`);
    const target = list.body.orders[0];
    const r = await call(h.ops, BRAND, "POST", "/api/affiliate-store-ops", { action: "prepare", id: target.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const one = await call(h.ops, BRAND, "GET", `${OPS}&view=orders&orderId=${target.id}`);
    assert.equal(one.body.orders.length, 1);
    assert.equal(one.body.orders[0].status, "preparing");
    assert.equal(one.body.summary.orderCounts.new, list.body.summary.orderCounts.new - 1);
    assert.equal(one.body.summary.orderCounts.preparing, list.body.summary.orderCounts.preparing + 1);
    const ship = await call(h.ops, BRAND, "POST", "/api/affiliate-store-ops", { action: "ship", id: target.id, trackingCompany: "CJ대한통운", trackingNumber: "123456789012" });
    assert.equal(ship.status, 200);
  });

  test("다른 브랜드의 주문은 보이지 않는다", async () => {
    const list = await call(h.ops, BRAND, "GET", `${OPS}&view=orders&filter=all`);
    const other = await call(h.ops, BRAND2, "GET", `${OPS}&view=orders&orderId=${list.body.orders[0].id}`);
    assert.equal(other.body.orders.length, 0);
  });

  test("영업일 계산은 주말만 뺀다", async () => {
    const { businessDaysSince } = await import("../../netlify/functions/_shared/affiliate-store-orders.mts");
    // 2026-11-06(금) 09:00 KST → 2026-11-10(화) 09:00 KST = 영업일 2일(월 · 화)
    assert.equal(businessDaysSince("2026-11-06T00:00:00Z", new Date("2026-11-10T00:00:00Z")), 2);
  });
});

// ─────────────────────────── E. 정산 계산 일치 ───────────────────────────

describe("E. 브랜드 정산 계산 — 주문 관리 · 정산 화면 · 신청 상세가 같은 값", () => {
  const RATES = [0, 0.01, 1.1, 2.75, 3.3, 3.5, 5, 7.77, 9.99, 12.34];

  test("수수료 절사는 정수 계산(부동소수 오차 없음)", () => {
    for (let base = 1; base < 200_000; base += 997) {
      for (const rate of RATES) {
        const exact = Number((BigInt(base) * BigInt(Math.round(rate * 100))) / 10000n);
        assert.equal(feeOf(base, rate), exact, `${base} × ${rate}%`);
      }
    }
  });

  test("여러 수수료율 · 상태의 주문에서 세 곳의 합계가 같다", async () => {
    const statuses = ["paid", "preparing", "shipped", "delivered", "confirmed", "confirmed", "cancelled", "return_requested"];
    let n = 0;
    for (const pgRate of RATES) {
      for (const platformRate of [5, 4.5, 0.33]) {
        const status = statuses[n % statuses.length];
        const unit = 9900 + n * 137;
        const qty = 1 + (n % 3);
        const ship = n % 4 === 0 ? 0 : 2500;
        // 취소: 짝수는 반품 환불(상품 금액만 환불 · 배송비 남음), 홀수는 전액 환불
        const refund = status === "cancelled" ? (n % 2 === 0 ? unit * qty : unit * qty + ship) : 0;
        await insertOrder({
          brand: BRAND2, influencer: INF, status, minutesAgo: 500 + n, unitPrice: unit, quantity: qty, shippingFee: ship,
          commissionRate: 3 + (n % 7) * 1.5, platformRate, pgRate, refund,
          commissionStatus: status === "confirmed" ? "confirmed" : status === "cancelled" ? (n % 3 ? "cancelled" : "pending") : "pending",
        });
        n++;
      }
    }
    const rows = (await pg.query(`SELECT * FROM affiliate_store_orders WHERE business_username = $1 AND status NOT IN ('pending_payment', 'expired')`, [BRAND2])).rows;

    // 1) JS 로 주문마다 계산한 값(brandSettlement)
    const js = rows.reduce((t: any, o: any) => {
      const s = brandSettlement(o);
      if (!s.included) return t;
      return {
        payment: t.payment + s.payment, commission: t.commission + s.commission, pgFee: t.pgFee + s.pgFee,
        platformFee: t.platformFee + s.platformFee, amount: t.amount + s.amount,
        confirmedAmount: t.confirmedAmount + (o.commission_status === "confirmed" ? s.amount : 0),
      };
    }, { payment: 0, commission: 0, pgFee: 0, platformFee: 0, amount: 0, confirmedAmount: 0 });
    const jsAvailable = rows.reduce((t: number, o: any) => t + brandEntitled(o), 0);
    const jsAvailableCount = rows.filter((o: any) => brandEntitled(o) > 0).length;
    const jsPending = rows
      .filter((o: any) => ["paid", "preparing", "shipped", "delivered", "return_requested"].includes(o.status))
      .reduce((t: number, o: any) => t + Math.max(0, brandSettlement(o).amount), 0);

    // 2) 주문 관리 화면 합계(SQL)
    const ops = await call(h.ops, BRAND2, "GET", "/api/affiliate-store-ops?scope=brand&view=orders&filter=all");
    assert.deepEqual(ops.body.summary.settlement, js);

    // 주문 관리 목록에 실린 주문별 정산값(JS)을 끝까지 더해도 같다
    const listed = await readAll(async (c) => {
      const r = await call(h.ops, BRAND2, "GET", `/api/affiliate-store-ops?scope=brand&view=orders&filter=all${qs(c)}`);
      return { items: r.body.orders, hasMore: r.body.hasMore, nextCursor: r.body.nextCursor };
    });
    assert.equal(listed.filter((o: any) => o.settlement.included).reduce((t: number, o: any) => t + o.settlement.amount, 0), js.amount);

    // 3) 정산 화면(SQL) · 신청에 들어갈 주문 상세(JS) — 둘 다 JS 계산과 같아야 한다
    const payout = await call(h.payouts, BRAND2, "GET", "/api/affiliate-payouts?as=brand");
    assert.equal(payout.status, 200, JSON.stringify(payout.body));
    const s = payout.body.summary;
    assert.equal(s.availableOrderAmount, jsAvailable);
    assert.equal(s.availableOrdersCount, jsAvailableCount);
    assert.equal(s.pending, jsPending);
    const details = await readAll(async (c) => {
      const r = await call(h.payouts, BRAND2, "GET", `/api/affiliate-payouts?as=brand&scope=available-details&kind=orders${qs(c)}`);
      return { items: r.body.items, hasMore: !!r.body.nextCursor, nextCursor: r.body.nextCursor };
    });
    assert.equal(details.length, jsAvailableCount);
    assert.equal(details.reduce((t: number, o: any) => t + o.amount, 0), jsAvailable);
  });
});

// ─────────────────────────── F. 지급 신청 ───────────────────────────

describe("F. 지급 신청 · 상세 펼치기", () => {
  const account = { legalName: "브랜드투 주식회사", bankName: "테스트은행", accountEncrypted: "enc:test", accountLast4: "0000", accountHolder: "브랜드투 주식회사", holderMismatch: false };
  let requestId = "";

  test("지급 신청 금액 = 정산 화면의 지급 가능 금액, 신청 뒤 지급 가능 0", async () => {
    // 상세 '더 보기'를 보려고 구매확정 주문을 45건 더 넣는다.
    for (let i = 0; i < 45; i++) await insertOrder({ brand: BRAND2, status: "confirmed", minutesAgo: 3000 + i, pgRate: 3.3, platformRate: 5 });
    const before = await call(h.payouts, BRAND2, "GET", "/api/affiliate-payouts?as=brand");
    const r = await createPayoutRequest(getDatabase(), "brand", BRAND2, account, { id: uid("apr"), minAmount: 0 });
    assert.equal(r.ok, true, JSON.stringify(r));
    const after = await call(h.payouts, BRAND2, "GET", "/api/affiliate-payouts?as=brand");
    assert.equal(after.body.summary.available, 0);
    assert.equal(after.body.summary.requested, before.body.summary.available);
    requestId = after.body.requests[0].id;
    assert.equal(after.body.requests[0].items.length, 0, "목록에는 포함 주문을 싣지 않는다(펼칠 때 받는다)");
  });

  test("신청 상세 펼치기: 포함 주문 40건씩 · 합계가 신청 금액과 같다", async () => {
    const items: any[] = [];
    let cursor = "";
    for (let i = 0; i < 10; i++) {
      const r = await call(h.payouts, BRAND2, "GET", `/api/affiliate-payouts?as=brand&scope=request-details&id=${requestId}&kind=items${cursor ? `&cursorId=${cursor}` : ""}`);
      assert.equal(r.status, 200);
      if (i === 0) assert.equal(r.body.items.length, 40);
      items.push(...r.body.items);
      if (!r.body.nextCursor) break;
      cursor = r.body.nextCursor;
    }
    const req = (await pg.query(`SELECT gross_amount FROM affiliate_payout_requests WHERE id = $1`, [requestId])).rows[0];
    assert.equal(items.reduce((t, i) => t + i.amount, 0), Number(req.gross_amount));
    assertUnique(items.map((i) => i.orderId), "포함 주문");
    const ops = await call(h.payouts, ADMIN, "GET", `/api/affiliate-payouts?scope=admin-request-details&id=${requestId}&kind=items`);
    assert.equal(ops.status, 200);
    assert.equal(ops.body.items.length, 40);
  });

  test("남의 지급 신청 상세는 볼 수 없다", async () => {
    const r = await call(h.payouts, BRAND, "GET", `/api/affiliate-payouts?as=brand&scope=request-details&id=${requestId}&kind=items`);
    assert.equal(r.status, 404);
  });

  test("신청에 들어간 주문이 환불되면 다음 신청에서 뺄 차감이 생기고 정산 화면에 보인다", async () => {
    const orderId = (await pg.query(`SELECT order_id FROM affiliate_payout_items WHERE request_id = $1 ORDER BY id LIMIT 1`, [requestId])).rows[0].order_id;
    await pg.query(`UPDATE affiliate_store_orders SET status = 'cancelled', refund_amount = total_amount, commission_status = 'cancelled', cancelled_at = NOW() WHERE id = $1`, [orderId]);
    const r = await call(h.payouts, BRAND2, "GET", "/api/affiliate-payouts?as=brand");
    assert.equal(r.body.summary.availableDeductionsCount, 1);
    assert.ok(r.body.summary.availableDeductionAmount > 0);
    const d = await call(h.payouts, BRAND2, "GET", "/api/affiliate-payouts?as=brand&scope=available-details&kind=deductions");
    assert.equal(d.body.items.length, 1);
    assert.equal(d.body.items[0].orderId, orderId);
  });

  test("인플루언서 정산: 구매확정 수수료만 지급 가능", async () => {
    const r = await call(h.payouts, INF, "GET", "/api/affiliate-payouts?as=influencer");
    assert.equal(r.status, 200);
    const rows = (await pg.query(`SELECT * FROM affiliate_store_orders WHERE influencer_username = $1`, [INF])).rows;
    const expected = rows.reduce((t: number, o: any) => t + entitled("influencer", o), 0);
    assert.equal(r.body.summary.availableOrderAmount, expected);
  });
});

// ─────────────────────────── G. 상품별 판매 신청 · 판매기간 · 판매중지 ───────────────────────────

describe("G. 상품별 판매 신청 · 판매기간 · 판매중지", () => {
  const BRAND3 = "brand3";
  const day = (offset: number) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
  let pA: any;
  let pB: any;

  test("판매 신청은 상품별로 묶이고, 새 신청 알림은 신청자 목록을 열면 꺼진다", async () => {
    await approvedBrand(BRAND3, "브랜드쓰리");
    pA = await saveProduct(BRAND3, "묶음 상품 A");
    pB = await saveProduct(BRAND3, "묶음 상품 B");
    for (const [inf, p] of [[INF, pA], [INF2, pA], [INF, pB]] as const) {
      const r = await call(h.store, inf, "POST", "/api/affiliate-store", { action: "request", productId: p.id, message: "", channelUrl: "", directDealAgreement: true });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    const counts = await call(h.store, BRAND3, "GET", "/api/affiliate-store?scope=brand&section=counts");
    assert.equal(counts.body.newRequestCount, 3);

    const grouped = await call(h.store, BRAND3, "GET", "/api/affiliate-store?scope=brand&section=request-products");
    assert.equal(grouped.status, 200);
    const byId = new Map(grouped.body.products.map((p: any) => [p.id, p]));
    assert.deepEqual((byId.get(pA.id) as any).requestCounts, { pending: 2, approved: 0, rejected: 0, unseen: 2, toShip: 0 });
    assert.equal((byId.get(pB.id) as any).requestCounts.unseen, 1);

    const onlyA = await call(h.store, BRAND3, "GET", `/api/affiliate-store?scope=brand&section=requests&productId=${pA.id}`);
    assert.equal(onlyA.body.requests.length, 2);
    assert.ok(onlyA.body.requests.every((r: any) => r.productId === pA.id && r.unseen === true));

    const seen = await call(h.store, BRAND3, "POST", "/api/affiliate-store", { action: "mark_requests_seen", productId: pA.id });
    assert.equal(seen.status, 200);
    assert.equal(seen.body.newRequestCount, 1);

    // 동의 제도 전에 승인된 브랜드는 처음 선정할 때 직거래 금지 안내에 동의해야 한다.
    await pg.query(`UPDATE affiliate_store_applications SET direct_deal_agreed_at = NULL WHERE business_username = $1`, [BRAND3]);
    const noAgree = await call(h.store, BRAND3, "POST", "/api/affiliate-store", { action: "review_request", id: onlyA.body.requests[0].id, decision: "approve" });
    assert.equal(noAgree.status, 400);
    assert.equal(noAgree.body.code, "DIRECT_DEAL_AGREEMENT_REQUIRED");
    // 선정하면 상태 칸으로 거른 목록에 나온다.
    const approve = await call(h.store, BRAND3, "POST", "/api/affiliate-store", { action: "review_request", id: onlyA.body.requests[0].id, decision: "approve", directDealAgreement: true });
    assert.equal(approve.status, 200);
    const approved = await call(h.store, BRAND3, "GET", `/api/affiliate-store?scope=brand&section=requests&productId=${pA.id}&status=approved`);
    assert.equal(approved.body.requests.length, 1);
  });

  test("판매중지한 상품은 신청한 인플루언서에게 '판매 중지'로 보이고, 새 신청은 막힌다", async () => {
    const paused = await saveProduct(BRAND3, "묶음 상품 A", { ...pA, status: "paused" });
    assert.equal(paused.saleState, "paused");
    const mine = await call(h.store, INF, "GET", "/api/affiliate-store?scope=my-requests");
    const req = mine.body.requests.find((r: any) => r.productId === pA.id);
    assert.equal(req.productState, "paused");
    const detail = await call(h.store, INF, "GET", `/api/affiliate-store?scope=product-detail&id=${pA.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.product.saleState, "paused");
    // 신청하지 않은 인플루언서에게는 보이지 않는다.
    const other = await call(h.store, INF2, "GET", `/api/affiliate-store?scope=product-detail&id=${pB.id}`);
    assert.equal(other.status, 200, "판매중 상품은 누구나 본다");
    const list = await call(h.store, INF2, "GET", `/api/affiliate-store?scope=creator&brand=${BRAND3}`);
    assert.deepEqual(list.body.products.map((p: any) => p.id), [pB.id]);
  });

  test("판매기간: 기간 밖이면 목록 · 신청에서 빠지고, 지난 종료일로 판매를 시작할 수 없다", async () => {
    const later = await saveProduct(BRAND3, "판매 예정 상품", { saleStartDate: day(3), saleEndDate: day(10) });
    assert.equal(later.saleState, "scheduled");
    assert.equal(later.saleStartDate, day(3));
    const list = await call(h.store, INF2, "GET", `/api/affiliate-store?scope=creator&brand=${BRAND3}`);
    assert.ok(!list.body.products.some((p: any) => p.id === later.id));
    const req = await call(h.store, INF2, "POST", "/api/affiliate-store", { action: "request", productId: later.id, message: "", channelUrl: "" });
    assert.equal(req.status, 400);

    const bad = await call(h.store, BRAND3, "POST", "/api/affiliate-store", { action: "save_product", product: productInput("끝난 기간", { saleStartDate: day(-10), saleEndDate: day(-1) }) });
    assert.equal(bad.status, 400);
    const reversed = await call(h.store, BRAND3, "POST", "/api/affiliate-store", { action: "save_product", product: productInput("거꾸로", { saleStartDate: day(5), saleEndDate: day(1) }) });
    assert.equal(reversed.status, 400);

    // 기간을 보내지 않은 예전 화면의 저장은 기존 기간을 그대로 둔다.
    const { saleStartDate: _s, saleEndDate: _e, ...rest } = later;
    const kept = await saveProduct(BRAND3, "판매 예정 상품", { ...rest, summary: "수정" });
    assert.equal(kept.saleEndDate, day(10));
  });
});
