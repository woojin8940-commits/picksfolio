import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireOperator } from "./_shared/manager-auth.mts";
import { jsonError, loadSettings, maskOrderNo, syncOrder } from "./_shared/affiliate.mts";
import { recheckOrders } from "./_shared/affiliate-worker.mts";

/**
 * 판매 주문 목록.
 *
 *   GET   /api/affiliate-orders?scope=brand|creator|admin&campaignId=&status=&verification=&offset=
 *   PATCH /api/affiliate-orders { action: 'reverify', orderId }    운영자: 카페24 에서 다시 조회
 *
 * 브랜드·인플루언서에게는 주문번호 뒤 4자리만 보인다. 고객 정보는 애초에 저장하지 않는다.
 */

const REASON_LABEL: Record<string, string> = {
  awaiting_payment: "입금 대기",
  shop_not_connected: "쇼핑몰 연동 없음 — 확인 대기",
  shop_reconnect: "쇼핑몰 재연동 필요 — 확인 대기",
  shop_token_expired: "쇼핑몰 토큰 만료 — 확인 대기",
  shop_unavailable: "쇼핑몰 연결 문제 — 확인 대기",
  shop_api_error: "쇼핑몰 조회 실패 — 다시 시도 예정",
  order_not_found: "쇼핑몰에서 주문을 찾지 못함",
  no_campaign_product: "캠페인 상품이 없는 주문",
  cancelled_or_returned: "취소 · 반품",
  no_click_in_window: "클릭 후 7일이 지난 주문",
  purchase_confirmed: "구매확정",
  auto_confirm: "배송완료 후 기간 경과로 확정",
  delivered: "배송완료 · 구매확정 대기",
  in_progress: "배송 준비 · 배송 중",
};

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "PATCH") {
    const op = await requireOperator(req);
    if (!op.ok) return op.response;
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "reverify") return jsonError("알 수 없는 요청입니다.");
    const orderId = String(body?.orderId || "");
    // 검증 실패로 닫힌 주문도 운영자가 다시 열어 볼 수 있다.
    await db.sql`
      UPDATE affiliate_orders SET verification = 'unverified', verify_attempts = 0
      WHERE id = ${orderId} AND verification = 'failed'
    `;
    const result = await syncOrder(db, orderId, { settings: await loadSettings(db) });
    if (!result.ok && result.reason === "not_found") return jsonError("주문을 찾을 수 없습니다.", 404);
    const rows = await listOrders(db, { scope: "admin", me: "", orderId });
    return Response.json({ order: rows[0] || null, result });
  }

  if (req.method !== "GET") return jsonError("Method not allowed", 405);
  const scope = (url.searchParams.get("scope") || "creator") as "brand" | "creator" | "admin";
  let me = "";
  if (scope === "admin") {
    const op = await requireOperator(req);
    if (!op.ok) return op.response;
  } else {
    const caller = await requireSignedInUser(req);
    if (!caller.ok) return caller.response;
    me = caller.username;
    // 새로고침 버튼(&refresh=1): 목록을 읽기 전에 내 열린 주문을 카페24 에서 다시 확인한다(취소 · 반품 · 입금).
    if (url.searchParams.get("refresh") === "1") {
      await recheckOrders(db, { brand: scope === "brand", me, campaignId: String(url.searchParams.get("campaignId") || "") }).catch((e) =>
        console.error("[affiliate-orders] recheck failed", e instanceof Error ? e.message : ""),
      );
    }
  }
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const rows = await listOrders(db, {
    scope,
    me,
    campaignId: String(url.searchParams.get("campaignId") || ""),
    status: String(url.searchParams.get("status") || "all"),
    verification: String(url.searchParams.get("verification") || ""),
    limit: limit + 1,
    offset,
  });
  return Response.json({ orders: rows.slice(0, limit), hasMore: rows.length > limit });
};

async function listOrders(
  db: any,
  f: { scope: "brand" | "creator" | "admin"; me: string; campaignId?: string; status?: string; verification?: string; orderId?: string; limit?: number; offset?: number },
) {
  const campaignId = f.campaignId || "";
  const verification = f.verification || "";
  const orderId = f.orderId || "";
  const status = f.status || "all";
  const rows = (await db.sql`
    SELECT * FROM (
    SELECT o.*, c.title AS campaign_title,
           COALESCE(s.paid_fee, 0) AS paid_fee, COALESCE(s.paid_n, 0) AS paid_n,
           CASE
             WHEN o.verification = 'unverified' THEN 'unverified'
             WHEN o.verification = 'failed' OR o.status = 'excluded' THEN 'excluded'
             WHEN o.status = 'confirmed' AND COALESCE(s.paid_n, 0) > 0 AND COALESCE(s.paid_fee, 0) >= o.influencer_fee THEN 'settled'
             WHEN o.status = 'confirmed' THEN 'confirmed'
             ELSE 'pending'
           END AS commission_status
    FROM affiliate_orders o
    JOIN affiliate_campaigns c ON c.id = o.campaign_id
    LEFT JOIN (
      SELECT e.order_id, SUM(e.influencer_fee) AS paid_fee, COUNT(*) AS paid_n
      FROM affiliate_settlement_entries e JOIN affiliate_settlement_lines l ON l.id = e.line_id
      WHERE l.status = 'paid' GROUP BY e.order_id
    ) s ON s.order_id = o.id
    WHERE (${f.scope} = 'admin'
           OR ${f.scope} = 'brand' AND o.business_username = ${f.me}
           OR ${f.scope} = 'creator' AND o.influencer_username = ${f.me})
      AND (${campaignId} = '' OR o.campaign_id = ${campaignId})
      AND (${verification} = '' OR o.verification = ${verification})
      AND (${orderId} = '' OR o.id = ${orderId})
    ) x
    WHERE (${status} = 'all' OR x.commission_status = ${status})
    ORDER BY COALESCE(x.ordered_at, x.received_at) DESC
    LIMIT ${f.limit ?? 50} OFFSET ${f.offset ?? 0}
  `) as any[];
  const shaped = rows.map((o) => {
    const commissionStatus = String(o.commission_status);
    const base = {
      id: String(o.id),
      orderNo: f.scope === "admin" ? String(o.shop_order_id) : maskOrderNo(o.shop_order_id),
      campaignId: String(o.campaign_id),
      campaignTitle: String(o.campaign_title || ""),
      influencerUsername: String(o.influencer_username),
      orderedAt: o.ordered_at ? new Date(o.ordered_at).toISOString() : new Date(o.received_at).toISOString(),
      commissionBase: Number(o.commission_base),
      refundedAmount: Number(o.refunded_amount),
      commissionStatus,
      fee: f.scope === "brand" ? Number(o.brand_fee) : Number(o.influencer_fee),
      verification: String(o.verification),
      reason: REASON_LABEL[o.status_reason] || "",
    };
    return f.scope === "admin"
      ? { ...base, brandFee: Number(o.brand_fee), platformFee: Number(o.platform_fee), influencerFee: Number(o.influencer_fee) }
      : base;
  });
  return shaped;
}

export const config: Config = {
  path: "/api/affiliate-orders",
};
