import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { isPastDeadline } from "./_shared/campaign-recruit.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { isOpenApplyMode } from "./_shared/reward-mode.mts";

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
                 c.status as campaign_status, c.reward_type, c.reward_amount,
                 c.thumbnail_url, c.category, c.end_date, c.reward_mode
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
      const { campaign_id, applicant_username, message, contact, portfolio_url, instagram_url, youtube_naver_url } = body;

      if (!campaign_id || !applicant_username) {
        return Response.json({ error: "필수 항목을 입력해 주세요." }, { status: 400 });
      }

      const campaign = await db.sql`SELECT * FROM campaigns WHERE id = ${campaign_id} AND status = 'active'`;
      if (campaign.length === 0) {
        return Response.json({ error: "캠페인을 찾을 수 없거나 마감되었습니다." }, { status: 400 });
      }

      const camp = campaign[0] as Record<string, any>;

      // 모집 종료일이 지난 캠페인은 목록에 노출되지 않지만, 이전에 열어둔 화면이나
      // 직접 호출로 지원이 들어올 수 있으므로 서버에서도 막는다.
      if (isPastDeadline(camp.end_date)) {
        return Response.json({ error: "모집이 마감된 캠페인입니다." }, { status: 400 });
      }

      // 지원을 받지 않는 진행 방식(광고비 지급형)에는 지원 행을 만들지 않는다.
      // 브랜드 화면에 지원자 목록이 없어(담당자 리스트업만 있다) 여기서 받아 두면
      // 아무도 보지 않는 지원이 쌓이고, 지원한 사람은 답을 기다리게 된다.
      if (!isOpenApplyMode(camp.reward_mode)) {
        return Response.json(
          { error: "담당자가 조건에 맞는 후보를 찾아 제안하는 캠페인입니다. 지원을 받지 않습니다." },
          { status: 400 },
        );
      }

      // 모집 인원(max_applicants)이 다 차도 지원은 계속 받는다.
      // 지원자가 많을수록 브랜드가 더 나은 크리에이터를 고를 수 있기 때문이다.

      const dup = await db.sql`
        SELECT id FROM campaign_applications
        WHERE campaign_id = ${campaign_id} AND applicant_username = ${applicant_username}
      `;
      if (dup.length > 0) {
        return Response.json({ error: "이미 지원한 캠페인입니다." }, { status: 400 });
      }

      const id = `app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await db.sql`
        INSERT INTO campaign_applications (id, campaign_id, applicant_username, message, contact, portfolio_url, instagram_url, youtube_naver_url)
        VALUES (${id}, ${campaign_id}, ${applicant_username}, ${message || ""}, ${contact || ""}, ${portfolio_url || ""}, ${instagram_url || ""}, ${youtube_naver_url || ""})
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

      // 예전에는 쿼리 파라미터의 username 만 믿어서, 아이디만 알면 남의 지원을
      // 취소할 수 있었다. 본인(또는 관리자)인지 토큰으로 확인한다.
      const auth = await requireAccountOwner(req, username);
      if (!auth.ok) return auth.response;

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
