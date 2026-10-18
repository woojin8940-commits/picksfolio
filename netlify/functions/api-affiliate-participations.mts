import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import {
  type Tx,
  jsonError,
  newCode,
  newId,
  norm,
  publicOrigin,
  shapeCampaign,
  todayKst,
  withTransaction,
} from "./_shared/affiliate.mts";

/**
 * 판매 캠페인 참여.
 *
 *   GET   /api/affiliate-participations?scope=mine                 인플루언서: 내 참여 + 링크
 *   GET   /api/affiliate-participations?scope=brand&campaignId=    브랜드: 신청자
 *   POST  /api/affiliate-participations { campaignId, message }    인플루언서: 참여 신청
 *   PATCH /api/affiliate-participations/:id { action }
 *           브랜드      approve · reject · revoke(참여 중단)
 *           인플루언서  cancel(신청 취소 · 판매 중단)
 *
 * 링크는 승인되는 순간 같은 트랜잭션 안에서 상품마다 하나씩 만들어진다. 승인 없이
 * 링크가 생기는 길은 없다(즉시 참여 캠페인은 신청이 곧 승인이다). 참여가 중단되면
 * 링크도 같이 멈춘다 — 그 뒤 클릭은 추적되지 않고 상품 페이지로만 보낸다.
 */

const shapeParticipation = (p: any) => ({
  id: String(p.id),
  campaignId: String(p.campaign_id),
  influencerUsername: String(p.influencer_username),
  message: String(p.message || ""),
  status: String(p.status),
  rejectReason: String(p.reject_reason || ""),
  decidedAt: p.decided_at ? new Date(p.decided_at).toISOString() : null,
  createdAt: new Date(p.created_at).toISOString(),
});

/** 승인된 참여의 링크를 만든다(이미 있으면 다시 켠다). 트랜잭션 안에서 부른다. */
async function issueLinks(q: Tx, participation: any) {
  const products = await q(
    `SELECT id FROM affiliate_campaign_products WHERE campaign_id = $1 AND active`,
    [participation.campaign_id],
  );
  for (const p of products) {
    const existing = await q(
      `UPDATE affiliate_links SET status = 'active', updated_at = NOW()
       WHERE participation_id = $1 AND campaign_product_id = $2 RETURNING code`,
      [participation.id, p.id],
    );
    if (existing[0]) continue;
    // 코드가 겹치면(확률은 거의 없다) 다른 코드로 다시 넣는다.
    for (let attempt = 0; attempt < 5; attempt++) {
      const inserted = await q(
        `INSERT INTO affiliate_links (code, participation_id, campaign_id, campaign_product_id, influencer_username)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING RETURNING code`,
        [newCode(), participation.id, participation.campaign_id, p.id, participation.influencer_username],
      );
      if (inserted[0]) break;
      if (attempt === 4) throw new Error("could not allocate code");
    }
  }
}

export default async (req: Request) => {
  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller.response;
  const me = caller.username;
  const db = getDatabase();
  const url = new URL(req.url);
  const id = decodeURIComponent(url.pathname.replace(/^\/api\/affiliate-participations\/?/, "").split("/")[0] || "");

  if (req.method === "GET") {
    const scope = url.searchParams.get("scope") || "mine";

    if (scope === "brand") {
      const campaignId = String(url.searchParams.get("campaignId") || "");
      const campaign = ((await db.sql`
        SELECT business_username FROM affiliate_campaigns WHERE id = ${campaignId} AND deleted_at IS NULL
      `) as any[])[0];
      if (!campaign || (norm(campaign.business_username) !== me && !caller.isAdmin)) return jsonError("캠페인을 찾을 수 없습니다.", 404);
      const rows = (await db.sql`
        SELECT p.*, ch.followers, ch.instagram_url, ch.instagram_handle, ch.categories,
               COALESCE(to_jsonb(ch)->>'profile_image', '') AS profile_image
        FROM affiliate_participations p
        LEFT JOIN creator_channels ch ON ch.username = p.influencer_username
        WHERE p.campaign_id = ${campaignId}
        ORDER BY (p.status = 'pending') DESC, p.created_at DESC
      `) as any[];
      return Response.json({
        participations: rows.map((r) => ({
          ...shapeParticipation(r),
          profile: {
            displayName: String(r.instagram_handle || r.influencer_username),
            profileImage: String(r.profile_image || ""),
            followers: Number(r.followers || 0),
            instagramUrl: String(r.instagram_url || ""),
            category: String(r.categories || ""),
          },
        })),
      });
    }

    const rows = (await db.sql`
      SELECT p.*, to_jsonb(c) AS campaign
      FROM affiliate_participations p JOIN affiliate_campaigns c ON c.id = p.campaign_id
      WHERE p.influencer_username = ${me} AND c.deleted_at IS NULL
      ORDER BY p.created_at DESC
    `) as any[];
    const campaignIds = rows.map((r) => r.campaign_id);
    const partIds = rows.map((r) => r.id);
    const [products, links] = campaignIds.length
      ? await Promise.all([
          db.sql`SELECT * FROM affiliate_campaign_products WHERE campaign_id = ANY(${campaignIds}::text[]) ORDER BY sort_order` as unknown as Promise<any[]>,
          db.sql`
            SELECT l.*, cp.name, cp.image_url, cp.price FROM affiliate_links l
            JOIN affiliate_campaign_products cp ON cp.id = l.campaign_product_id
            WHERE l.participation_id = ANY(${partIds}::text[]) ORDER BY cp.sort_order
          ` as unknown as Promise<any[]>,
        ])
      : [[], []];
    const origin = publicOrigin();
    return Response.json({
      participations: rows.map((r) => ({
        ...shapeParticipation(r),
        campaign: shapeCampaign(r.campaign, products.filter((p: any) => p.campaign_id === r.campaign_id), "creator"),
        links: links
          .filter((l: any) => l.participation_id === r.id)
          .map((l: any) => ({
            code: String(l.code),
            productId: String(l.campaign_product_id),
            productName: String(l.name),
            productImage: String(l.image_url || ""),
            price: Number(l.price || 0),
            url: `${origin}/go/${l.code}`,
            status: String(l.status),
          })),
      })),
    });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaignId || "");
    const message = String(body?.message || "").trim().slice(0, 1000);
    const today = todayKst();

    try {
      const result = await withTransaction(db, async (q) => {
        const campaign = (await q(
          `SELECT * FROM affiliate_campaigns WHERE id = $1 AND deleted_at IS NULL`,
          [campaignId],
        ))[0];
        if (!campaign || campaign.status !== "active") return { error: "모집 중인 캠페인이 아닙니다.", status: 404 };
        const end = String(campaign.end_date instanceof Date ? campaign.end_date.toISOString() : campaign.end_date).slice(0, 10);
        if (end < today) return { error: "판매 기간이 끝난 캠페인입니다.", status: 409 };
        if (norm(campaign.business_username) === me) return { error: "자기 캠페인에는 참여할 수 없습니다.", status: 400 };

        const status = campaign.join_mode === "open" ? "approved" : "pending";
        const rows = await q(
          `INSERT INTO affiliate_participations (id, campaign_id, influencer_username, message, status, decided_at, decided_by)
           VALUES ($1,$2,$3,$4,$5, CASE WHEN $5 = 'approved' THEN NOW() END, CASE WHEN $5 = 'approved' THEN 'auto' ELSE '' END)
           ON CONFLICT (campaign_id, influencer_username) DO UPDATE SET
             message = EXCLUDED.message, status = EXCLUDED.status, decided_at = EXCLUDED.decided_at,
             decided_by = EXCLUDED.decided_by, reject_reason = '', updated_at = NOW()
           WHERE affiliate_participations.status = 'cancelled'
           RETURNING *`,
          [newId("afj"), campaignId, me, message, status],
        );
        if (!rows[0]) return { error: "이미 신청한 캠페인입니다.", status: 409 };
        if (rows[0].status === "approved") await issueLinks(q, rows[0]);
        return { participation: rows[0] };
      });
      if ("error" in result) return jsonError(result.error as string, result.status as number);
      return Response.json({ participation: shapeParticipation(result.participation) }, { status: 201 });
    } catch (e) {
      console.error("[affiliate-participations] apply failed", e instanceof Error ? e.message : "");
      return jsonError("참여 신청을 처리하지 못했습니다.", 500);
    }
  }

  if (req.method === "PATCH" && id) {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const reason = String(body?.reason || "").trim().slice(0, 500);

    const result = await withTransaction(db, async (q) => {
      const row = (await q(
        `SELECT p.*, c.business_username, c.status AS campaign_status
         FROM affiliate_participations p JOIN affiliate_campaigns c ON c.id = p.campaign_id
         WHERE p.id = $1 FOR UPDATE OF p`,
        [id],
      ))[0];
      if (!row) return { error: "참여 정보를 찾을 수 없습니다.", status: 404 };
      const isBrand = norm(row.business_username) === me;
      const isInfluencer = norm(row.influencer_username) === me;

      if (["approve", "reject", "revoke"].includes(action)) {
        if (!isBrand) return { error: "캠페인을 등록한 브랜드만 처리할 수 있습니다.", status: 403 };
        const from = action === "revoke" ? "approved" : "pending";
        if (row.status !== from) return { error: "이미 처리된 신청입니다.", status: 409 };
        if (action === "approve" && row.campaign_status !== "active") return { error: "진행 중인 캠페인이 아닙니다.", status: 409 };
        const next = action === "approve" ? "approved" : action === "reject" ? "rejected" : "revoked";
        const updated = (await q(
          `UPDATE affiliate_participations SET status = $2, reject_reason = $3, decided_by = $4, decided_at = NOW(), updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [id, next, action === "approve" ? "" : reason, me],
        ))[0];
        if (action === "approve") await issueLinks(q, updated);
        if (action === "revoke") {
          await q(`UPDATE affiliate_links SET status = 'revoked', updated_at = NOW() WHERE participation_id = $1`, [id]);
        }
        return { participation: updated };
      }

      if (action === "cancel") {
        if (!isInfluencer) return { error: "본인의 참여만 바꿀 수 있습니다.", status: 403 };
        if (!["pending", "approved"].includes(row.status)) return { error: "취소할 수 없는 상태입니다.", status: 409 };
        const updated = (await q(
          `UPDATE affiliate_participations SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
          [id],
        ))[0];
        await q(`UPDATE affiliate_links SET status = 'revoked', updated_at = NOW() WHERE participation_id = $1`, [id]);
        return { participation: updated };
      }

      return { error: "알 수 없는 요청입니다.", status: 400 };
    });
    if ("error" in result) return jsonError(result.error as string, result.status as number);
    return Response.json({ participation: shapeParticipation(result.participation) });
  }

  return jsonError("Method not allowed", 405);
};

export const config: Config = {
  path: ["/api/affiliate-participations", "/api/affiliate-participations/*"],
};
