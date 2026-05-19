import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      const username = url.searchParams.get("username");
      const campaign_id = url.searchParams.get("campaign_id");
      const applicant = url.searchParams.get("applicant");

      if (username) {
        const result = await db.sql`
          SELECT ca.*, c.title as campaign_title, c.brand_name, c.type as campaign_type,
                 c.status as campaign_status, c.reward_type, c.reward_amount
          FROM campaign_applications ca
          JOIN campaigns c ON ca.campaign_id = c.id
          WHERE ca.applicant_username = ${username}
          ORDER BY ca.created_at DESC
        `;
        return Response.json({ applications: result });
      }

      if (campaign_id && applicant) {
        const result = await db.sql`
          SELECT * FROM campaign_applications
          WHERE campaign_id = ${campaign_id} AND applicant_username = ${applicant}
        `;
        return Response.json({
          applied: result.length > 0,
          application: result[0] || null,
        });
      }

      return Response.json({ error: "Missing parameters" }, { status: 400 });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const { campaign_id, applicant_username, message, contact, portfolio_url } = body;

      if (!campaign_id || !applicant_username) {
        return Response.json({ error: "필수 항목을 입력해 주세요." }, { status: 400 });
      }

      const campaign = await db.sql`SELECT * FROM campaigns WHERE id = ${campaign_id} AND status = 'active'`;
      if (campaign.length === 0) {
        return Response.json({ error: "캠페인을 찾을 수 없거나 마감되었습니다." }, { status: 400 });
      }

      const camp = campaign[0] as Record<string, any>;
      if (camp.max_applicants && Number(camp.max_applicants) > 0) {
        const count = await db.sql`SELECT COUNT(*)::int as count FROM campaign_applications WHERE campaign_id = ${campaign_id}`;
        if (Number((count[0] as any).count) >= Number(camp.max_applicants)) {
          return Response.json({ error: "모집 인원이 마감되었습니다." }, { status: 400 });
        }
      }

      const dup = await db.sql`
        SELECT id FROM campaign_applications
        WHERE campaign_id = ${campaign_id} AND applicant_username = ${applicant_username}
      `;
      if (dup.length > 0) {
        return Response.json({ error: "이미 지원한 캠페인입니다." }, { status: 400 });
      }

      const id = `app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await db.sql`
        INSERT INTO campaign_applications (id, campaign_id, applicant_username, message, contact, portfolio_url)
        VALUES (${id}, ${campaign_id}, ${applicant_username}, ${message || ""}, ${contact || ""}, ${portfolio_url || ""})
      `;

      return Response.json({ success: true, id });
    } catch (err: any) {
      return Response.json({ error: err?.message || "지원 실패" }, { status: 500 });
    }
  }

  if (req.method === "DELETE") {
    try {
      const id = url.searchParams.get("id");
      const username = url.searchParams.get("username");

      if (!id || !username) {
        return Response.json({ error: "Missing parameters" }, { status: 400 });
      }

      await db.sql`
        DELETE FROM campaign_applications
        WHERE id = ${id} AND applicant_username = ${username} AND status = 'pending'
      `;

      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json({ error: err?.message || "지원 취소 실패" }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/campaign-applications",
};
