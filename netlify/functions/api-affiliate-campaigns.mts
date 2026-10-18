import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireOperator } from "./_shared/manager-auth.mts";
import { connectionHealth, connectionsForBusiness, fetchProductsByIds } from "./_shared/cafe24-api.mts";
import {
  DISCLOSURE_TEXT,
  jsonError,
  loadSettings,
  newId,
  norm,
  shapeCampaign,
  todayKst,
  withTransaction,
} from "./_shared/affiliate.mts";
import { termsGate } from "./_shared/affiliate-terms.mts";

/**
 * 판매 연동형 캠페인.
 *
 *   GET   /api/affiliate-campaigns?scope=browse   인플루언서 둘러보기(공개 · 승인된 진행 중 캠페인)
 *   GET   /api/affiliate-campaigns?scope=brand    브랜드: 내 캠페인 + 간단 성과
 *   GET   /api/affiliate-campaigns?scope=admin    운영자: 전체(status 필터)
 *   GET   /api/affiliate-campaigns/:id?scope=...
 *   POST  /api/affiliate-campaigns                브랜드: 등록(관리자 승인 대기로 들어간다)
 *   PATCH /api/affiliate-campaigns/:id            브랜드: resubmit(반려 후 재심사) · end(판매 종료)
 *                                                 운영자: approve · reject
 *
 * 수수료율 노출 범위: 브랜드·운영자는 총 수수료율과 플랫폼율을, 인플루언서는 자기 몫만 본다.
 * 심사 요청(등록 · 재심사)은 브랜드가 판매 수수료 이용약관(지금 버전)에 동의해 있어야 한다.
 * 약관 버전이 바뀌면 다음 등록 때 다시 동의받는다 — 이미 진행 중인 캠페인은 그대로다.
 * 플랫폼 수수료율은 등록(또는 재심사 요청) 시점의 설정값으로 고정된다. 승인된 뒤에는
 * 수수료율·상품을 바꿀 수 없다 — 이미 링크를 받은 인플루언서의 조건이 바뀌기 때문이다.
 */

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

/**
 * 카테고리는 등록 화면이 고른 이름(뷰티 · 패션 …)으로 저장한다. 둘러보기 화면의 칩은
 * 기존 캠페인 목록과 같은 slug(beauty · fashion …)를 보내므로 여기서 이름으로 바꿔 찾는다.
 */
const CATEGORY_BY_SLUG: Record<string, string> = {
  beauty: "뷰티", fashion: "패션", food: "식품", lifestyle: "라이프스타일", travel: "여행", health: "건강",
  tech: "IT/테크", parenting: "육아", pet: "반려동물", interior: "인테리어", sports: "스포츠",
  entertainment: "엔터테인먼트", education: "교육", other: "기타",
};
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

async function productsFor(db: any, ids: string[]) {
  if (ids.length === 0) return new Map<string, any[]>();
  const rows = (await db.sql`
    SELECT * FROM affiliate_campaign_products WHERE campaign_id = ANY(${ids}::text[]) ORDER BY sort_order, created_at
  `) as any[];
  const map = new Map<string, any[]>();
  for (const r of rows) map.set(r.campaign_id, [...(map.get(r.campaign_id) || []), r]);
  return map;
}

async function brandCounts(db: any, ids: string[]) {
  const map = new Map<string, any>();
  if (ids.length === 0) return map;
  const [parts, clicks, orders] = await Promise.all([
    db.sql`
      SELECT campaign_id, COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
             COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
      FROM affiliate_participations WHERE campaign_id = ANY(${ids}::text[]) GROUP BY campaign_id
    ` as Promise<any[]>,
    db.sql`
      SELECT campaign_id, COUNT(*)::int AS n FROM affiliate_clicks
      WHERE campaign_id = ANY(${ids}::text[]) AND counted GROUP BY campaign_id
    ` as Promise<any[]>,
    db.sql`
      SELECT campaign_id,
             COUNT(*) FILTER (WHERE status <> 'excluded')::int AS orders,
             COALESCE(SUM(commission_base) FILTER (WHERE status <> 'excluded'), 0)::bigint AS sales,
             COUNT(*) FILTER (WHERE status = 'excluded' AND status_reason = 'cancelled_or_returned')::int AS cancelled
      FROM affiliate_orders WHERE campaign_id = ANY(${ids}::text[]) AND verification = 'verified' GROUP BY campaign_id
    ` as Promise<any[]>,
  ]);
  for (const id of ids) map.set(id, { pending: 0, approved: 0, clicks: 0, orders: 0, sales: 0, cancelled: 0 });
  for (const p of parts) Object.assign(map.get(p.campaign_id), { pending: p.pending, approved: p.approved });
  for (const c of clicks) map.get(c.campaign_id).clicks = c.n;
  for (const o of orders) Object.assign(map.get(o.campaign_id), { orders: o.orders, sales: Number(o.sales), cancelled: o.cancelled });
  return map;
}

/** 등록 · 재심사 입력 검사. 상품은 몰에서 다시 조회해 서버가 URL 을 만든다. */
async function validateInput(db: any, business: string, body: any, platformRate: number) {
  const conns = await connectionsForBusiness(db, business);
  const mallId = clip(body?.mallId, 80).toLowerCase();
  const conn = conns.find((c) => c.mallId.toLowerCase() === mallId);
  if (!conn) return { error: "연동된 쇼핑몰을 선택해 주세요." };
  if (!connectionHealth(conn).usable) return { error: "쇼핑몰 재연동이 필요합니다. 쇼핑몰 연동 메뉴에서 다시 연결해 주세요." };

  const title = clip(body?.title, 120);
  if (!title) return { error: "캠페인 이름을 입력해 주세요." };
  const commission = Math.round(Number(body?.commissionRate) * 100) / 100;
  if (!Number.isFinite(commission) || commission <= 0 || commission > 90) return { error: "수수료율은 0% 초과 90% 이하로 입력해 주세요." };
  if (commission <= platformRate) return { error: `수수료율은 플랫폼 수수료율(${platformRate}%)보다 커야 합니다.` };
  if (!isDate(body?.startDate) || !isDate(body?.endDate)) return { error: "판매 기간을 입력해 주세요." };
  if (body.endDate < body.startDate) return { error: "판매 종료일이 시작일보다 빠릅니다." };
  if (body.endDate < todayKst()) return { error: "판매 종료일이 이미 지났습니다." };
  const joinMode = body?.joinMode === "open" ? "open" : "approval";

  const requested: string[] = Array.isArray(body?.products) ? body.products.map((p: any) => String(p?.shopProductId || "")) : [];
  if (requested.length === 0) return { error: "판매할 상품을 하나 이상 선택해 주세요." };
  if (requested.length > 50) return { error: "상품은 한 캠페인에 50개까지 올릴 수 있습니다." };
  let products;
  try {
    products = await fetchProductsByIds(conn, requested);
  } catch {
    return { error: "쇼핑몰에서 상품 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (products.length === 0) return { error: "선택한 상품을 쇼핑몰에서 찾지 못했습니다." };

  return {
    value: {
      mallId: conn.mallId,
      companyName: clip(body?.companyName, 80) || conn.shopName || conn.mallId,
      title,
      description: clip(body?.description, 2000),
      category: clip(body?.category, 40),
      commission,
      startDate: body.startDate as string,
      endDate: body.endDate as string,
      joinMode,
      sampleOffered: Boolean(body?.sampleOffered),
      sampleNote: clip(body?.sampleNote, 500),
      followerDiscount: clip(body?.followerDiscount, 300),
      contentGuide: clip(body?.contentGuide, 4000),
      bannedPhrases: clip(body?.bannedPhrases, 2000),
      products,
    },
  };
}

async function insertProducts(q: any, campaignId: string, products: any[]) {
  await q(`DELETE FROM affiliate_campaign_products WHERE campaign_id = $1`, [campaignId]);
  let order = 0;
  for (const p of products) {
    await q(
      `INSERT INTO affiliate_campaign_products (id, campaign_id, shop_product_id, name, price, image_url, product_url, active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8) ON CONFLICT (campaign_id, shop_product_id) DO NOTHING`,
      [newId("afp"), campaignId, p.shopProductId, p.name.slice(0, 200), p.price, p.imageUrl, p.productUrl, order++],
    );
  }
}

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);
  const id = decodeURIComponent(url.pathname.replace(/^\/api\/affiliate-campaigns\/?/, "").split("/")[0] || "");
  const scope = url.searchParams.get("scope") || "browse";

  if (req.method === "GET") {
    if (scope === "admin") {
      const op = await requireOperator(req);
      if (!op.ok) return op.response;
      const status = url.searchParams.get("status") || "all";
      const rows = (await db.sql`
        SELECT * FROM affiliate_campaigns
        WHERE deleted_at IS NULL AND (${status} = 'all' OR status = ${status}) AND (${id} = '' OR id = ${id})
        ORDER BY (status = 'pending_approval') DESC, created_at DESC LIMIT 200
      `) as any[];
      const products = await productsFor(db, rows.map((r) => r.id));
      const campaigns = rows.map((r) => shapeCampaign(r, products.get(r.id) || [], "admin"));
      return Response.json(id ? { campaign: campaigns[0] || null } : { campaigns });
    }

    if (scope === "brand") {
      const caller = await requireSignedInUser(req);
      if (!caller.ok) return caller.response;
      const rows = (await db.sql`
        SELECT * FROM affiliate_campaigns
        WHERE deleted_at IS NULL AND business_username = ${caller.username} AND (${id} = '' OR id = ${id})
        ORDER BY created_at DESC
      `) as any[];
      const ids = rows.map((r) => r.id);
      const [products, counts] = await Promise.all([productsFor(db, ids), brandCounts(db, ids)]);
      const campaigns = rows.map((r) => ({ ...shapeCampaign(r, products.get(r.id) || [], "brand"), counts: counts.get(r.id) }));
      if (id) return campaigns[0] ? Response.json({ campaign: campaigns[0] }) : jsonError("캠페인을 찾을 수 없습니다.", 404);
      return Response.json({ campaigns });
    }

    // 둘러보기: 승인됐고 기간 안인 캠페인. 로그인했으면 내 참여 상태를 함께 싣는다.
    const caller = await requireSignedInUser(req);
    const me = caller.ok ? caller.username : "";
    const today = todayKst();
    const rawCategory = clip(url.searchParams.get("category"), 40);
    const category = CATEGORY_BY_SLUG[rawCategory] || rawCategory;
    const q = clip(url.searchParams.get("q"), 60);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = (await db.sql`
      SELECT * FROM affiliate_campaigns c
      WHERE c.deleted_at IS NULL AND c.status = 'active' AND c.start_date <= ${today} AND c.end_date >= ${today}
        AND (${id} = '' OR c.id = ${id})
        AND (${category} = '' OR c.category = ${category})
        AND (${q} = '' OR c.title ILIKE ${like} OR c.company_name ILIKE ${like}
             OR EXISTS (SELECT 1 FROM affiliate_campaign_products p WHERE p.campaign_id = c.id AND p.name ILIKE ${like}))
      ORDER BY c.created_at DESC LIMIT 100
    `) as any[];
    const ids = rows.map((r) => r.id);
    const products = await productsFor(db, ids);
    const mine = me && ids.length
      ? ((await db.sql`
          SELECT id, campaign_id, status FROM affiliate_participations
          WHERE influencer_username = ${me} AND campaign_id = ANY(${ids}::text[])
        `) as any[])
      : [];
    const myMap = new Map(mine.map((p) => [p.campaign_id, { id: p.id, status: p.status }]));
    const campaigns = rows.map((r) => ({
      ...shapeCampaign(r, (products.get(r.id) || []).filter((p) => p.active), "creator"),
      myParticipation: myMap.get(r.id) || null,
    }));
    if (id) return campaigns[0] ? Response.json({ campaign: campaigns[0] }) : jsonError("모집 중인 캠페인이 아닙니다.", 404);
    return Response.json({ campaigns });
  }

  if (req.method === "POST") {
    const caller = await requireSignedInUser(req);
    if (!caller.ok) return caller.response;
    const blocked = await termsGate(db, norm(caller.username));
    if (blocked) return blocked;
    const body = await req.json().catch(() => ({}));
    const settings = await loadSettings(db);
    const checked = await validateInput(db, caller.username, body, settings.platformRate);
    if ("error" in checked) return jsonError(checked.error as string);
    const v = checked.value!;
    const campaignId = newId("afc");
    await withTransaction(db, async (q) => {
      await q(
        `INSERT INTO affiliate_campaigns
          (id, business_username, company_name, shop_type, mall_id, title, description, category,
           commission_rate, platform_rate, start_date, end_date, join_mode, sample_offered, sample_note,
           follower_discount, content_guide, banned_phrases, disclosure_text, status)
         VALUES ($1,$2,$3,'cafe24',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending_approval')`,
        [campaignId, caller.username, v.companyName, v.mallId, v.title, v.description, v.category, v.commission,
         settings.platformRate, v.startDate, v.endDate, v.joinMode, v.sampleOffered, v.sampleNote,
         v.followerDiscount, v.contentGuide, v.bannedPhrases, DISCLOSURE_TEXT],
      );
      await insertProducts(q, campaignId, v.products);
    });
    const row = ((await db.sql`SELECT * FROM affiliate_campaigns WHERE id = ${campaignId}`) as any[])[0];
    const products = await productsFor(db, [campaignId]);
    return Response.json({ campaign: shapeCampaign(row, products.get(campaignId) || [], "brand") }, { status: 201 });
  }

  if (req.method === "PATCH" && id) {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "approve" || action === "reject") {
      const op = await requireOperator(req);
      if (!op.ok) return op.response;
      const reason = clip(body?.reason, 500);
      if (action === "reject" && !reason) return jsonError("반려 사유를 입력해 주세요.");
      const rows = (await db.sql`
        UPDATE affiliate_campaigns
        SET status = ${action === "approve" ? "active" : "rejected"},
            reject_reason = ${action === "approve" ? "" : reason},
            reviewed_by = ${op.username}, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND status = 'pending_approval' AND deleted_at IS NULL
        RETURNING *
      `) as any[];
      if (!rows[0]) return jsonError("승인 대기 중인 캠페인이 아닙니다.", 409);
      const products = await productsFor(db, [id]);
      return Response.json({ campaign: shapeCampaign(rows[0], products.get(id) || [], "admin") });
    }

    const caller = await requireSignedInUser(req);
    if (!caller.ok) return caller.response;
    const current = ((await db.sql`
      SELECT * FROM affiliate_campaigns WHERE id = ${id} AND deleted_at IS NULL
    `) as any[])[0];
    if (!current || norm(current.business_username) !== caller.username) return jsonError("캠페인을 찾을 수 없습니다.", 404);

    if (action === "end") {
      // 판매 종료: 링크 추적을 멈춘다(이후 클릭은 상품 페이지로만 보낸다). 이미 들어온 주문은 규칙대로 정산된다.
      const updated = await withTransaction(db, async (q) => {
        const rows = await q(
          `UPDATE affiliate_campaigns SET status = 'ended', ended_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status IN ('active', 'pending_approval', 'rejected') RETURNING *`,
          [id],
        );
        if (rows[0]) await q(`UPDATE affiliate_links SET status = 'paused', updated_at = NOW() WHERE campaign_id = $1 AND status = 'active'`, [id]);
        return rows[0];
      });
      if (!updated) return jsonError("이미 종료된 캠페인입니다.", 409);
      const products = await productsFor(db, [id]);
      return Response.json({ campaign: shapeCampaign(updated, products.get(id) || [], "brand") });
    }

    if (action === "resubmit") {
      if (!["rejected", "pending_approval"].includes(current.status)) {
        return jsonError("승인된 캠페인의 조건은 바꿀 수 없습니다. 판매를 종료하고 새로 등록해 주세요.", 409);
      }
      const blocked = await termsGate(db, norm(caller.username));
      if (blocked) return blocked;
      // 플랫폼 수수료율은 처음 등록할 때의 값을 그대로 둔다(재심사 요청은 새 등록이 아니다).
      const fixedPlatformRate = Number(current.platform_rate);
      const checked = await validateInput(db, caller.username, { ...body, mallId: body?.mallId || current.mall_id }, fixedPlatformRate);
      if ("error" in checked) return jsonError(checked.error as string);
      const v = checked.value!;
      const updated = await withTransaction(db, async (q) => {
        const rows = await q(
          `UPDATE affiliate_campaigns SET company_name=$2, mall_id=$3, title=$4, description=$5, category=$6,
             commission_rate=$7, platform_rate=$8, start_date=$9, end_date=$10, join_mode=$11, sample_offered=$12,
             sample_note=$13, follower_discount=$14, content_guide=$15, banned_phrases=$16,
             status='pending_approval', reject_reason='', updated_at=NOW()
           WHERE id=$1 AND status IN ('rejected','pending_approval') RETURNING *`,
          [id, v.companyName, v.mallId, v.title, v.description, v.category, v.commission, fixedPlatformRate,
           v.startDate, v.endDate, v.joinMode, v.sampleOffered, v.sampleNote, v.followerDiscount, v.contentGuide, v.bannedPhrases],
        );
        if (rows[0]) await insertProducts(q, id, v.products);
        return rows[0];
      });
      if (!updated) return jsonError("캠페인 상태가 바뀌었습니다. 새로고침해 주세요.", 409);
      const products = await productsFor(db, [id]);
      return Response.json({ campaign: shapeCampaign(updated, products.get(id) || [], "brand") });
    }

    return jsonError("알 수 없는 요청입니다.");
  }

  return jsonError("Method not allowed", 405);
};

export const config: Config = {
  path: ["/api/affiliate-campaigns", "/api/affiliate-campaigns/*"],
};
