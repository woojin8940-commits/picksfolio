import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { jsonError, norm } from "./_shared/affiliate.mts";

/**
 * 판매 성과.
 *
 *   GET /api/affiliate-stats?scope=brand&campaignId=&from=&to=   브랜드: 캠페인 · 상품 · 인플루언서별
 *   GET /api/affiliate-stats?scope=creator&from=&to=             인플루언서: 상품별
 *
 * 수수료는 보는 사람 기준이다 — 브랜드는 자기가 낼 수수료(brand_fee), 인플루언서는 자기
 * 몫(influencer_fee). 상태 구분:
 *   예정      검증된 미확정 주문
 *   확정      구매확정됐지만 아직 지급되지 않은 금액
 *   정산 완료  지급 처리된 지급 내역에 들어간 금액(마감 후 반품 차감 포함)
 *   제외      취소·반품 등으로 빠진 주문의 원래 수수료(참고용)
 * 클릭은 들어온 클릭을 모두 센다(같은 사람이 여러 번 눌러도 누른 만큼).
 * 주문은 주문이 들어오는 즉시 센다 — 아직 카페24 에서 결제가 확인되지 않은 주문(무통장 입금 대기 등)도
 * 주문 수에 넣는다. 매출 · 수수료는 결제가 확인된 뒤에 더하고, 취소 · 반품되면 주문 수에서 빠진다.
 * waiting 은 그중 아직 결제 확인 전인 건수다.
 */

const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const empty = (key: string, label: string, imageUrl = "") => ({
  key, label, imageUrl, clicks: 0, orders: 0, sales: 0, cancelled: 0, pendingFee: 0, confirmedFee: 0, settledFee: 0, excludedFee: 0,
});

export default async (req: Request) => {
  if (req.method !== "GET") return jsonError("Method not allowed", 405);
  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller.response;
  const me = caller.username;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "brand" ? "brand" : "creator";
  const campaignId = String(url.searchParams.get("campaignId") || "");
  const from = isDate(url.searchParams.get("from")) ? `${url.searchParams.get("from")}T00:00:00+09:00` : "1970-01-01T00:00:00Z";
  const to = isDate(url.searchParams.get("to")) ? `${url.searchParams.get("to")}T23:59:59.999+09:00` : "2999-01-01T00:00:00Z";
  const db = getDatabase();

  if (campaignId && scope === "brand") {
    const c = ((await db.sql`SELECT business_username FROM affiliate_campaigns WHERE id = ${campaignId}`) as any[])[0];
    if (!c || norm(c.business_username) !== me) return jsonError("캠페인을 찾을 수 없습니다.", 404);
  }

  const brand = scope === "brand";
  const [products, clicks, orders, waitingRows] = await Promise.all([
    db.sql`
      SELECT cp.id, cp.name, cp.image_url, c.id AS campaign_id, c.title
      FROM affiliate_campaign_products cp JOIN affiliate_campaigns c ON c.id = cp.campaign_id
      WHERE c.deleted_at IS NULL AND (${campaignId} = '' OR c.id = ${campaignId})
        AND (${brand} AND c.business_username = ${me}
             OR NOT ${brand} AND EXISTS (SELECT 1 FROM affiliate_links l WHERE l.campaign_product_id = cp.id AND l.influencer_username = ${me}))
    ` as unknown as Promise<any[]>,
    db.sql`
      SELECT k.campaign_product_id, k.campaign_id, k.influencer_username, COUNT(*)::int AS n
      FROM affiliate_clicks k JOIN affiliate_campaigns c ON c.id = k.campaign_id
      WHERE k.clicked_at >= ${from} AND k.clicked_at <= ${to}
        AND (${campaignId} = '' OR k.campaign_id = ${campaignId})
        AND (${brand} AND c.business_username = ${me} OR NOT ${brand} AND k.influencer_username = ${me})
      GROUP BY 1, 2, 3
    ` as unknown as Promise<any[]>,
    db.sql`
      SELECT o.id, o.campaign_id, o.influencer_username, o.verification, o.status, o.commission_base, o.gross_base,
             o.brand_fee, o.influencer_fee, o.commission_rate, o.platform_rate, l.campaign_product_id,
             COALESCE((SELECT SUM(CASE WHEN ${brand} THEN e.brand_fee ELSE e.influencer_fee END)
                       FROM affiliate_settlement_entries e JOIN affiliate_settlement_lines sl ON sl.id = e.line_id
                       WHERE e.order_id = o.id AND sl.status = 'paid'), 0) AS paid_fee
      FROM affiliate_orders o
      JOIN affiliate_links l ON l.code = o.code
      WHERE o.verification IN ('verified', 'unverified')
        AND COALESCE(o.ordered_at, o.received_at) >= ${from} AND COALESCE(o.ordered_at, o.received_at) <= ${to}
        AND (${campaignId} = '' OR o.campaign_id = ${campaignId})
        AND (${brand} AND o.business_username = ${me} OR NOT ${brand} AND o.influencer_username = ${me})
      LIMIT 20000
    ` as unknown as Promise<any[]>,
    db.sql`
      SELECT COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE o.status_reason = 'awaiting_payment')::int AS awaiting_payment
      FROM affiliate_orders o
      WHERE o.verification = 'unverified'
        AND o.received_at >= ${from} AND o.received_at <= ${to}
        AND (${campaignId} = '' OR o.campaign_id = ${campaignId})
        AND (${brand} AND o.business_username = ${me} OR NOT ${brand} AND o.influencer_username = ${me})
    ` as unknown as Promise<any[]>,
  ]);

  const totals = empty("total", "합계");
  const byProduct = new Map<string, ReturnType<typeof empty>>();
  const byInfluencer = new Map<string, ReturnType<typeof empty>>();
  const byCampaign = new Map<string, ReturnType<typeof empty>>();
  for (const p of products) {
    byProduct.set(p.id, empty(p.id, p.name, p.image_url));
    if (!byCampaign.has(p.campaign_id)) byCampaign.set(p.campaign_id, empty(p.campaign_id, p.title));
  }
  const rowsFor = (productId: string, campaignId: string, influencer: string) => {
    if (!byProduct.has(productId)) byProduct.set(productId, empty(productId, "상품"));
    if (!byCampaign.has(campaignId)) byCampaign.set(campaignId, empty(campaignId, "캠페인"));
    if (!byInfluencer.has(influencer)) byInfluencer.set(influencer, empty(influencer, influencer));
    return [totals, byProduct.get(productId)!, byCampaign.get(campaignId)!, byInfluencer.get(influencer)!];
  };

  for (const k of clicks) for (const r of rowsFor(k.campaign_product_id, k.campaign_id, k.influencer_username)) {
    r.clicks += k.n;
  }
  for (const o of orders) {
    const fee = Number(brand ? o.brand_fee : o.influencer_fee);
    const paid = Number(o.paid_fee);
    for (const r of rowsFor(o.campaign_product_id, o.campaign_id, o.influencer_username)) {
      // 결제 확인 전 주문은 주문 수에만 넣는다. 금액은 카페24 에서 확인된 뒤에 더한다.
      if (o.verification === "unverified") {
        r.orders += 1;
        continue;
      }
      if (o.status === "excluded") {
        r.cancelled += 1;
        const rate = brand ? Number(o.commission_rate) : Number(o.commission_rate) - Number(o.platform_rate);
        r.excludedFee += Math.floor((Number(o.gross_base) * Math.round(rate * 100)) / 10000);
        r.settledFee += paid;
        continue;
      }
      r.orders += 1;
      r.sales += Number(o.commission_base);
      if (o.status === "pending") r.pendingFee += fee;
      else {
        r.settledFee += paid;
        r.confirmedFee += Math.max(0, fee - paid);
      }
    }
  }

  const sortBySales = (m: Map<string, any>) => Array.from(m.values()).sort((a, b) => b.sales - a.sales || b.clicks - a.clicks);
  const waiting = { orders: Number(waitingRows[0]?.n || 0), awaitingPayment: Number(waitingRows[0]?.awaiting_payment || 0) };
  return Response.json({
    totals,
    waiting,
    byProduct: sortBySales(byProduct),
    ...(brand ? { byInfluencer: sortBySales(byInfluencer), byCampaign: sortBySales(byCampaign) } : {}),
  });
};

export const config: Config = {
  path: "/api/affiliate-stats",
};
