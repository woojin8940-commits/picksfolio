import { getDatabase } from "@picks/netlify-database";
import { getUser } from "@netlify/identity";
import type { Config, Context } from "@netlify/functions";

const ADMIN_EMAILS = ["woojin8940@inplace-ad.com", "picksfolio@picks.me"];

function decodeJwtClaims(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    return payload;
  } catch {
    return null;
  }
}

async function authenticate(req: Request) {
  let user = await getUser();
  if (!user) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const claims = decodeJwtClaims(token);
      if (claims?.email) {
        user = {
          id: claims.sub || "",
          email: claims.email,
          app_metadata: claims.app_metadata || {},
        } as any;
      }
    }
  }
  if (!user) return null;
  const roles: string[] = (user as any).app_metadata?.roles || [];
  const email = ((user as any).email || "").trim().toLowerCase();
  if (!roles.includes("admin") && !ADMIN_EMAILS.includes(email)) return null;
  return user;
}

export default async (req: Request, context: Context) => {
  const admin = await authenticate(req);
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      const status = url.searchParams.get("status");

      // 운영자 화면은 캠페인 한 줄에서 "어디까지 진행됐고 누가 맡았고 우리 수익이
      // 얼마인지"를 함께 읽어야 한다. 목록을 받은 뒤 캠페인마다 추가 요청을 보내면
      // 캠페인 수만큼 왕복이 생기고, 승인 대기 목록을 훑는 동안 화면이 계속 흔들린다.
      // 그래서 진행 숫자와 마진을 서브쿼리로 함께 내려준다.
      //
      // 마진은 브랜드 제시가(quoted_fee) − 인플루언서 지급가(offer.fee)다. 둘 다
      // 채워진 행만 세는 이유는, 견적을 아직 적지 않은 행을 함께 더하면 마진이
      // 인플루언서 단가만큼 마이너스로 찍혀 이익이 나는 캠페인이 손실로 보이기 때문이다.
      // offer JSONB 금액은 폼을 거쳐 들어오므로 숫자일 때만 더한다 — 문자열 한 개가
      // ::numeric 캐스팅에서 터지면 목록 전체가 500 이 된다.
      let result;
      if (status) {
        result = await db.sql`
          SELECT c.*,
                 (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count,
                 lc.listed_count, lc.picked_count, lc.sent_count, lc.accepted_count, lc.declined_count,
                 mg.priced_count, mg.brand_amount, mg.influencer_cost, mg.margin_amount,
                 cb.collab_count, cb.collab_running, cb.collab_done, cb.collab_manager
          FROM campaigns c
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS listed_count,
                   COUNT(*) FILTER (WHERE l.brand_decision = 'pick')::int AS picked_count,
                   COUNT(*) FILTER (WHERE l.outreach_status = 'sent')::int AS sent_count,
                   COUNT(*) FILTER (WHERE l.outreach_status = 'accepted')::int AS accepted_count,
                   COUNT(*) FILTER (WHERE l.outreach_status = 'declined')::int AS declined_count
            FROM campaign_listups l WHERE l.campaign_id = c.id
          ) lc ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*) FILTER (WHERE p.brand_amount > 0 AND p.offer_fee > 0)::int AS priced_count,
                   COALESCE(SUM(CASE WHEN p.brand_amount > 0 AND p.offer_fee > 0 THEN p.brand_amount ELSE 0 END), 0)::bigint AS brand_amount,
                   COALESCE(SUM(CASE WHEN p.brand_amount > 0 AND p.offer_fee > 0 THEN p.offer_fee + p.offer_second_fee ELSE 0 END), 0)::bigint AS influencer_cost,
                   COALESCE(SUM(CASE WHEN p.brand_amount > 0 AND p.offer_fee > 0 THEN p.brand_amount - (p.offer_fee + p.offer_second_fee) ELSE 0 END), 0)::bigint AS margin_amount
            FROM (
              SELECT COALESCE(l.quoted_fee, 0) + COALESCE(l.quoted_second_use_fee, 0) AS brand_amount,
                     CASE WHEN jsonb_typeof(l.offer->'fee') = 'number' THEN (l.offer->>'fee')::numeric
                          WHEN l.offer->>'fee' ~ '^[0-9]+$' THEN (l.offer->>'fee')::numeric ELSE 0 END AS offer_fee,
                     CASE WHEN jsonb_typeof(l.offer->'secondUseFee') = 'number' THEN (l.offer->>'secondUseFee')::numeric
                          WHEN l.offer->>'secondUseFee' ~ '^[0-9]+$' THEN (l.offer->>'secondUseFee')::numeric ELSE 0 END AS offer_second_fee
              FROM campaign_listups l
              WHERE l.campaign_id = c.id AND l.outreach_status = 'accepted'
            ) p
          ) mg ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS collab_count,
                   COUNT(*) FILTER (WHERE cc.status = 'in_progress')::int AS collab_running,
                   COUNT(*) FILTER (WHERE cc.status = 'completed')::int AS collab_done,
                   MAX(cc.manager_username) AS collab_manager
            FROM campaign_collabs cc WHERE cc.campaign_id = c.id
          ) cb ON TRUE
          WHERE c.status = ${status}
          ORDER BY c.created_at DESC
        `;
      } else {
        result = await db.sql`
          SELECT c.*,
                 (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count,
                 lc.listed_count, lc.picked_count, lc.sent_count, lc.accepted_count, lc.declined_count,
                 mg.priced_count, mg.brand_amount, mg.influencer_cost, mg.margin_amount,
                 cb.collab_count, cb.collab_running, cb.collab_done, cb.collab_manager
          FROM campaigns c
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS listed_count,
                   COUNT(*) FILTER (WHERE l.brand_decision = 'pick')::int AS picked_count,
                   COUNT(*) FILTER (WHERE l.outreach_status = 'sent')::int AS sent_count,
                   COUNT(*) FILTER (WHERE l.outreach_status = 'accepted')::int AS accepted_count,
                   COUNT(*) FILTER (WHERE l.outreach_status = 'declined')::int AS declined_count
            FROM campaign_listups l WHERE l.campaign_id = c.id
          ) lc ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*) FILTER (WHERE p.brand_amount > 0 AND p.offer_fee > 0)::int AS priced_count,
                   COALESCE(SUM(CASE WHEN p.brand_amount > 0 AND p.offer_fee > 0 THEN p.brand_amount ELSE 0 END), 0)::bigint AS brand_amount,
                   COALESCE(SUM(CASE WHEN p.brand_amount > 0 AND p.offer_fee > 0 THEN p.offer_fee + p.offer_second_fee ELSE 0 END), 0)::bigint AS influencer_cost,
                   COALESCE(SUM(CASE WHEN p.brand_amount > 0 AND p.offer_fee > 0 THEN p.brand_amount - (p.offer_fee + p.offer_second_fee) ELSE 0 END), 0)::bigint AS margin_amount
            FROM (
              SELECT COALESCE(l.quoted_fee, 0) + COALESCE(l.quoted_second_use_fee, 0) AS brand_amount,
                     CASE WHEN jsonb_typeof(l.offer->'fee') = 'number' THEN (l.offer->>'fee')::numeric
                          WHEN l.offer->>'fee' ~ '^[0-9]+$' THEN (l.offer->>'fee')::numeric ELSE 0 END AS offer_fee,
                     CASE WHEN jsonb_typeof(l.offer->'secondUseFee') = 'number' THEN (l.offer->>'secondUseFee')::numeric
                          WHEN l.offer->>'secondUseFee' ~ '^[0-9]+$' THEN (l.offer->>'secondUseFee')::numeric ELSE 0 END AS offer_second_fee
              FROM campaign_listups l
              WHERE l.campaign_id = c.id AND l.outreach_status = 'accepted'
            ) p
          ) mg ON TRUE
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS collab_count,
                   COUNT(*) FILTER (WHERE cc.status = 'in_progress')::int AS collab_running,
                   COUNT(*) FILTER (WHERE cc.status = 'completed')::int AS collab_done,
                   MAX(cc.manager_username) AS collab_manager
            FROM campaign_collabs cc WHERE cc.campaign_id = c.id
          ) cb ON TRUE
          ORDER BY c.created_at DESC
        `;
      }

      const pending = await db.sql`SELECT COUNT(*)::int as count FROM campaigns WHERE status = 'pending_approval'`;

      return Response.json({
        campaigns: result,
        pendingCount: pending[0]?.count || 0,
      });
    } catch (err: any) {
      return Response.json(
        { error: err?.message || "서버 오류" },
        { status: 500 }
      );
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = await req.json();
      const { id, action, reason } = body;

      if (!id || !action) {
        return Response.json(
          { error: "캠페인 ID와 액션이 필요합니다." },
          { status: 400 }
        );
      }

      if (!["approve", "reject", "assign_manager"].includes(action)) {
        return Response.json(
          { error: "잘못된 액션입니다." },
          { status: 400 }
        );
      }

      const existing = await db.sql`SELECT * FROM campaigns WHERE id = ${id}`;
      if (existing.length === 0) {
        return Response.json(
          { error: "캠페인을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      // 담당자 식별자는 이메일 앞부분을 쓴다(운영 콘솔은 Netlify Identity 로그인).
      const actingManager = String((admin as any).email || "")
        .split("@")[0]
        .trim()
        .toLowerCase();

      if (action === "assign_manager") {
        const target = String(body.managerUsername || actingManager)
          .trim()
          .toLowerCase()
          .replace(/^biz\//, "");
        await db.sql`
          UPDATE campaigns
          SET manager_username = ${target}, manager_assigned_at = NOW(), updated_at = NOW()
          WHERE id = ${id}
        `;
        // 이미 진행 중인 협업의 담당자도 함께 옮긴다 — 캠페인 담당자와 협업 담당자가
        // 갈리면 지원자는 누구에게 물어야 할지 알 수 없다.
        await db.sql`
          UPDATE campaign_collabs
          SET manager_username = ${target}, updated_at = NOW()
          WHERE campaign_id = ${id}
        `;
        return Response.json({ success: true, managerUsername: target });
      }

      if (action === "approve") {
        // 승인하는 순간 담당자가 정해진다. 담당자 없는 캠페인은 지원이 들어와도
        // 아무도 선정하지 못하는 상태가 되므로 승인과 배정을 한 동작으로 묶는다.
        const target = String(body.managerUsername || actingManager)
          .trim()
          .toLowerCase()
          .replace(/^biz\//, "");
        await db.sql`
          UPDATE campaigns
          SET status = 'active',
              admin_approved_at = NOW(),
              admin_rejected_reason = '',
              manager_username = CASE WHEN COALESCE(manager_username, '') = '' THEN ${target} ELSE manager_username END,
              manager_assigned_at = COALESCE(manager_assigned_at, NOW()),
              updated_at = NOW()
          WHERE id = ${id}
        `;
      } else {
        await db.sql`
          UPDATE campaigns
          SET status = 'admin_rejected', admin_rejected_reason = ${reason || ''}, updated_at = NOW()
          WHERE id = ${id}
        `;
      }

      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json(
        { error: err?.message || "처리 실패" },
        { status: 500 }
      );
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/admin/campaigns",
};
