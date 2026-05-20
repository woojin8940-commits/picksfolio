import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
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

      const appRows = await db.sql`
        SELECT ca.*, c.title as campaign_title, c.business_username, c.brand_name
        FROM campaign_applications ca
        JOIN campaigns c ON c.id = ca.campaign_id
        WHERE ca.id = ${id}
      `;
      const appRow = (appRows as any[])?.[0];

      await db.sql`
        UPDATE campaign_applications
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${id}
      `;

      if (status === "accepted" && appRow) {
        const store = getStore("timelines");
        const proposalId = `campaign_${appRow.campaign_id}_${appRow.applicant_username}`;
        const detailKey = `detail_${proposalId}`;
        const existing = await store.get(detailKey, { type: "json" });

        if (!existing) {
          const businessUsername = appRow.business_username || "";
          const creatorUsername = appRow.applicant_username || "";
          const companyName = appRow.brand_name || "";
          const campaignTitle = appRow.campaign_title || "";

          const timelineData = {
            proposalId,
            influencerUsername: creatorUsername,
            businessUsername,
            companyName,
            proposalTitle: campaignTitle,
            comments: [
              {
                id: `tc_${Date.now()}_system`,
                proposalId,
                authorType: "business",
                authorName: companyName || businessUsername,
                authorUsername: businessUsername.toLowerCase(),
                content: `캠페인 "${campaignTitle}" 협업이 시작되었습니다. 메시지를 보내 소통을 시작해보세요!`,
                createdAt: new Date().toISOString(),
                readBy: [businessUsername.toLowerCase()],
              },
            ],
            createdAt: new Date().toISOString(),
          };

          await store.setJSON(detailKey, timelineData);

          const ensureIndex = async (type: string, username: string) => {
            const indexKey = `index_${type}_${username.toLowerCase()}`;
            const indexData = ((await store.get(indexKey, { type: "json" })) as any[]) || [];
            const exists = indexData.some((t: any) => t.proposalId === proposalId);
            if (!exists) {
              indexData.unshift({
                proposalId,
                influencerUsername: creatorUsername,
                businessUsername,
                companyName,
                proposalTitle: campaignTitle,
                createdAt: timelineData.createdAt,
              });
              await store.setJSON(indexKey, indexData);
            }
          };

          if (creatorUsername) await ensureIndex("influencer", creatorUsername);
          if (businessUsername) await ensureIndex("business", businessUsername);
        }
      }

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
