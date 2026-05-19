import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      const campaign_id = url.searchParams.get("campaign_id");
      if (!campaign_id) {
        return Response.json({ error: "캠페인 ID가 필요합니다." }, { status: 400 });
      }

      const result = await db.sql`
        SELECT * FROM campaign_applications
        WHERE campaign_id = ${campaign_id}
        ORDER BY created_at DESC
      `;

      return Response.json({ applicants: result });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = await req.json();
      const { id, status } = body;

      if (!id || !status) {
        return Response.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
      }

      if (!["pending", "accepted", "rejected"].includes(status)) {
        return Response.json({ error: "잘못된 상태값입니다." }, { status: 400 });
      }

      await db.sql`
        UPDATE campaign_applications
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${id}
      `;

      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json({ error: err?.message || "상태 변경 실패" }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/campaign-applicants",
};
