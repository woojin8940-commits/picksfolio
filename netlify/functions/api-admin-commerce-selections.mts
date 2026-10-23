import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireAdmin } from "./_shared/admin-auth.mts";
import { buildSnapshots, loadManagerContacts } from "./_shared/campaign-listup.mts";
import { norm } from "./_shared/collab-workflow.mts";

/**
 * 커머스 캠페인의 지원자 선정 현황 — 운영 콘솔 전용.
 *
 * 커머스형은 브랜드가 지원자 중에서 직접 수락한다. 그 뒤의 조건 · 일정 · 수수료는 픽스폴리오
 * 담당자가 중간에서 조율하는데, 예전에는 수락이 일어나도 운영자 화면에 아무 표시가 없었다.
 * 그래서 여기서 "새로 선정된 건"을 세고, 캠페인을 열면 선정된 인플루언서의 지표 · 연락처를
 * 함께 내려준다. 브랜드 담당자 연락처는 화면이 BrandContactCard 로 따로 부른다.
 *
 *   GET                       캠페인 목록 + 캠페인별 지원 · 선정 · 새 선정 수, 전체 새 선정 수
 *   GET  ?campaign_id=...     그 캠페인의 지원자(선정 먼저) + 지표 + 연락처
 *   POST { campaignId }       그 캠페인의 선정 내역을 본 것으로 표시
 *
 * 선정은 지원 경로(source='apply')만 센다. 리스트업 제안을 수락한 사람도 지원 행이
 * 생기지만, 그 건은 리스트업 작업대에서 이미 보인다.
 */
export default async (req: Request) => {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      const campaignId = url.searchParams.get("campaign_id");

      if (!campaignId) {
        const rows = await db.sql`
          SELECT c.id, c.title, c.brand_name, c.business_username, c.manager_username,
                 c.thumbnail_url, c.category, c.status, c.start_date, c.end_date,
                 c.max_applicants, c.groupbuy_commission_rate, c.upload_channel,
                 c.product_name, c.product_url, c.description, c.created_at,
                 COALESCE(a.application_count, 0) AS application_count,
                 COALESCE(a.selected_count, 0) AS selected_count,
                 COALESCE(a.new_selected_count, 0) AS new_selected_count,
                 a.last_selected_at
          FROM campaigns c
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS application_count,
                   COUNT(*) FILTER (WHERE ca.status = 'accepted')::int AS selected_count,
                   COUNT(*) FILTER (WHERE ca.status = 'accepted' AND ca.operator_seen_at IS NULL)::int AS new_selected_count,
                   MAX(ca.decided_at) FILTER (WHERE ca.status = 'accepted') AS last_selected_at
            FROM campaign_applications ca
            WHERE ca.campaign_id = c.id AND COALESCE(ca.source, 'apply') = 'apply'
          ) a ON TRUE
          WHERE c.deleted_at IS NULL
            AND c.reward_mode = 'groupbuy'
            AND c.status IN ('active', 'inactive')
          ORDER BY c.created_at DESC
        `;
        const campaigns = (rows as any[]) || [];
        return Response.json({
          campaigns,
          newSelectedTotal: campaigns.reduce((sum, c) => sum + Number(c.new_selected_count || 0), 0),
        });
      }

      const owner = await db.sql`
        SELECT id FROM campaigns
        WHERE id = ${campaignId} AND reward_mode = 'groupbuy' AND deleted_at IS NULL
      `;
      if (!owner.length) {
        return Response.json({ error: "커머스 캠페인을 찾을 수 없습니다." }, { status: 404 });
      }

      const result = await db.sql`
        SELECT ca.id, ca.applicant_username, ca.message, ca.contact, ca.portfolio_url,
               ca.instagram_url, ca.youtube_naver_url, ca.status, ca.brand_preference,
               ca.decided_by, ca.decided_by_role, ca.decided_at, ca.operator_seen_at, ca.created_at,
               cc.id AS collab_id, cc.status AS collab_status
        FROM campaign_applications ca
        LEFT JOIN campaign_collabs cc
          ON cc.campaign_id = ca.campaign_id AND cc.creator_username = ca.applicant_username
        WHERE ca.campaign_id = ${campaignId} AND COALESCE(ca.source, 'apply') = 'apply'
        ORDER BY (ca.status = 'accepted') DESC, ca.decided_at DESC NULLS LAST, ca.created_at DESC
      `;
      const rows = (result as any[]) || [];
      const usernames = rows.map((r) => String(r.applicant_username || ""));
      // 연락처는 선정된 사람 것만 싣는다. 조율할 상대는 그 사람들이고, 아직 고르지 않은
      // 지원자의 번호까지 한꺼번에 내려보낼 이유가 없다.
      const selectedNames = rows.filter((r) => r.status === "accepted").map((r) => String(r.applicant_username || ""));
      const [snapshots, contacts] = await Promise.all([
        buildSnapshots(db, usernames),
        loadManagerContacts(db, selectedNames, campaignId),
      ]);

      return Response.json({
        applicants: rows.map((r) => {
          const key = norm(r.applicant_username);
          const selected = r.status === "accepted";
          return {
            ...r,
            contact: selected ? r.contact : "",
            insights: snapshots.get(key) || null,
            contact_card: selected ? contacts.get(key) || null : null,
            is_new: selected && !r.operator_seen_at,
          };
        }),
      });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  if (req.method === "POST") {
    try {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      const campaignId = String(body?.campaignId || "").trim();
      if (!campaignId) return Response.json({ error: "캠페인을 지정해 주세요." }, { status: 400 });
      await db.sql`
        UPDATE campaign_applications
        SET operator_seen_at = NOW()
        WHERE campaign_id = ${campaignId} AND status = 'accepted' AND operator_seen_at IS NULL
      `;
      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/admin/commerce-selections",
};
