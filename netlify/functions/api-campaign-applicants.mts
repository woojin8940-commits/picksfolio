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
        const rawBizUser = appRow.business_username || "";
        const businessUsername = rawBizUser.toLowerCase().replace(/^biz\//, "");
        const creatorUsername = (appRow.applicant_username || "").toLowerCase();
        const companyName = appRow.brand_name || "";
        const campaignTitle = appRow.campaign_title || "";
        const proposalId = `campaign_${appRow.campaign_id}_${creatorUsername}`;
        const nowISO = new Date().toISOString();

        // 1) Create timeline entry
        const store = getStore("timelines");
        const detailKey = `detail_${proposalId}`;
        const existingTimeline = await store.get(detailKey, { type: "json" });

        if (!existingTimeline) {
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
                authorUsername: businessUsername,
                content: `🎉 지원하신 "${campaignTitle}" 캠페인에 선정되셨습니다! 지금부터 ${companyName || businessUsername}와(과) 이곳에서 메시지를 주고받으며 협업을 진행할 수 있습니다.`,
                createdAt: nowISO,
                readBy: [businessUsername],
              },
            ],
            createdAt: nowISO,
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
                createdAt: nowISO,
              });
              await store.setJSON(indexKey, indexData);
            }
          };

          if (creatorUsername) await ensureIndex("influencer", creatorUsername);
          if (businessUsername) await ensureIndex("business", businessUsername);

          // Persist timeline to SQL
          try {
            const systemComment = timelineData.comments[0];
            await db.sql`
              INSERT INTO timelines (proposal_id, influencer_username, business_username, company_name, proposal_title, created_at)
              VALUES (${proposalId}, ${creatorUsername}, ${businessUsername}, ${companyName}, ${campaignTitle}, ${nowISO})
              ON CONFLICT (proposal_id) DO NOTHING
            `;
            await db.sql`
              INSERT INTO timeline_messages (id, proposal_id, author_type, author_name, author_username, content, read_by, created_at)
              VALUES (${systemComment.id}, ${proposalId}, ${systemComment.authorType}, ${systemComment.authorName}, ${systemComment.authorUsername}, ${systemComment.content}, ${[businessUsername]}, ${nowISO})
              ON CONFLICT (id) DO NOTHING
            `;
          } catch (sqlErr) {
            console.error("[campaign-applicants] Failed to persist timeline to SQL:", sqlErr);
          }
        }

        // 2) Create proposal entries so business inbox and influencer proposals show this collaboration
        const campaignRows = await db.sql`SELECT * FROM campaigns WHERE id = ${appRow.campaign_id}`;
        const campaign = (campaignRows as any[])?.[0];

        const proposalEntry = {
          id: proposalId,
          influencer_username: creatorUsername,
          category: campaign?.type === "group_buy" ? "커머스" : "광고",
          company_name: companyName,
          contact_person: "",
          contact_email: "",
          contact_phone: "",
          title: campaignTitle,
          content: campaign?.description || "",
          start_date: campaign?.start_date || "",
          end_date: campaign?.end_date || "",
          fee: parseInt(campaign?.reward_amount) || 0,
          revenue_share: 0,
          reference_links: [],
          attachments: [],
          business_username: businessUsername,
          status: "accepted",
          created_at: nowISO,
          updated_at: nowISO,
          createdAt: nowISO,
          updatedAt: nowISO,
        };

        try {
          const proposalStore = getStore("proposals");
          const infKey = `proposals_${creatorUsername}`;
          const infExisting = ((await proposalStore.get(infKey, { type: "json" })) as any[]) || [];
          if (!infExisting.some((p: any) => p.id === proposalId)) {
            infExisting.push(proposalEntry);
            await proposalStore.setJSON(infKey, infExisting);
          }
        } catch (e) {
          console.error("[campaign-applicants] Failed to create influencer proposal entry:", e);
        }

        try {
          const bizStore = getStore("business-proposals");
          const bizKey = `biz_proposals_${businessUsername}`;
          const bizExisting = ((await bizStore.get(bizKey, { type: "json" })) as any[]) || [];
          if (!bizExisting.some((p: any) => p.id === proposalId)) {
            bizExisting.push(proposalEntry);
            await bizStore.setJSON(bizKey, bizExisting);
          }
        } catch (e) {
          console.error("[campaign-applicants] Failed to create business proposal entry:", e);
        }

        // 3) Auto-create settlement record for accepted campaign collaboration
        try {
          const settlementStore = getStore("settlements");
          const stlId = `stl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const stlNow = new Date().toISOString();
          const fee = parseInt(campaign?.reward_amount) || 0;
          const scheduledDate = (() => {
            const d = new Date();
            d.setDate(d.getDate() + 30);
            return d.toISOString().split("T")[0];
          })();

          const settlement = {
            id: stlId,
            proposal_id: proposalId,
            influencer_username: creatorUsername,
            business_username: businessUsername,
            company_name: companyName,
            title: campaignTitle,
            amount: fee,
            scheduled_date: scheduledDate,
            status: "scheduled",
            memo: "캠페인 수락 시 자동 생성",
            created_at: stlNow,
            updated_at: stlNow,
          };

          const getRecordsFrom = async (key: string) => {
            const data = (await settlementStore.get(key, { type: "json" })) as any;
            if (Array.isArray(data)) return data;
            if (data && Array.isArray(data.records)) return data.records;
            if (data && Array.isArray(data.settlements)) return data.settlements;
            return [];
          };

          const bizKey = `settlements_biz_${businessUsername}`;
          const infKey = `settlements_inf_${creatorUsername}`;

          const [bizSettlements, infSettlements] = await Promise.all([
            getRecordsFrom(bizKey),
            getRecordsFrom(infKey),
          ]);

          if (!bizSettlements.some((s: any) => s.proposal_id === proposalId)) {
            bizSettlements.push(settlement);
            await settlementStore.setJSON(bizKey, bizSettlements);
          }
          if (!infSettlements.some((s: any) => s.proposal_id === proposalId)) {
            infSettlements.push(settlement);
            await settlementStore.setJSON(infKey, infSettlements);
          }
        } catch (stlErr) {
          console.error("[campaign-applicants] Failed to auto-create settlement:", stlErr);
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
