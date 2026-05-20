import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const url = new URL(req.url);
  const userType = url.searchParams.get("type") || "influencer";

  const store = getStore("timelines");
  const indexKey = `index_${userType}_${username}`;

  if (req.method === "GET") {
    let data = (await store.get(indexKey, { type: "json" })) as any[] | null;
    const existing = Array.isArray(data) ? data : [];
    const seenProposalIds = new Set<string>(existing.map((t: any) => t.proposalId));
    let added = 0;

    // 1) Scan proposals blob store for accepted/completed proposals
    try {
      const proposalStore = getStore("proposals");
      const { blobs } = await proposalStore.list();

      for (const blob of blobs) {
        if (!blob.key.startsWith("proposals_")) continue;
        try {
          const items = (await proposalStore.get(blob.key, { type: "json" })) as any[];
          if (!Array.isArray(items)) continue;

          for (const item of items) {
            if (item.status !== "accepted" && item.status !== "completed") continue;

            const bizUser = (item.business_username || "").toLowerCase().replace(/^biz\//, "");
            const infUser = (item.influencer_username || blob.key.replace("proposals_", "")).toLowerCase();

            const isMatch =
              (userType === "business" && bizUser === username) ||
              (userType === "influencer" && infUser === username);
            if (!isMatch) continue;

            const proposalId = item.id;
            if (seenProposalIds.has(proposalId)) continue;
            seenProposalIds.add(proposalId);

            const detailKey = `detail_${proposalId}`;
            let detail = await store.get(detailKey, { type: "json" });

            if (!detail) {
              const companyName = item.company_name || "";
              const proposalTitle = item.title || "";
              const timelineData = {
                proposalId,
                influencerUsername: infUser,
                businessUsername: bizUser,
                companyName,
                proposalTitle,
                comments: [
                  {
                    id: `tc_${Date.now()}_rebuild_${proposalId}`,
                    proposalId,
                    authorType: "business",
                    authorName: companyName || bizUser,
                    authorUsername: bizUser,
                    content: `"${proposalTitle}" 협업 제안이 수락되었습니다. 메시지를 보내 소통을 시작해보세요!`,
                    createdAt: item.updatedAt || item.createdAt || new Date().toISOString(),
                    readBy: [infUser],
                  },
                ],
                createdAt: item.updatedAt || item.createdAt || new Date().toISOString(),
              };
              await store.setJSON(detailKey, timelineData);
              detail = timelineData;

              const otherType = userType === "business" ? "influencer" : "business";
              const otherUser = userType === "business" ? infUser : bizUser;
              if (otherUser) {
                try {
                  const otherIndexKey = `index_${otherType}_${otherUser}`;
                  const otherIndex = ((await store.get(otherIndexKey, { type: "json" })) as any[]) || [];
                  if (!otherIndex.some((t: any) => t.proposalId === proposalId)) {
                    otherIndex.unshift({
                      proposalId,
                      influencerUsername: infUser,
                      businessUsername: bizUser,
                      companyName: item.company_name || "",
                      proposalTitle: item.title || "",
                      createdAt: (detail as any)?.createdAt || item.createdAt,
                    });
                    await store.setJSON(otherIndexKey, otherIndex);
                  }
                } catch (idxErr) {
                  console.error("[timeline-list] Failed to update other index:", idxErr);
                }
              }
            }

            existing.push({
              proposalId,
              influencerUsername: infUser,
              businessUsername: bizUser,
              companyName: item.company_name || "",
              proposalTitle: item.title || "",
              createdAt: (detail as any)?.createdAt || item.createdAt,
            });
            added++;
          }
        } catch (blobErr) {
          console.error(`[timeline-list] Failed to read blob ${blob.key}:`, blobErr);
        }
      }
    } catch (e) {
      console.error("[timeline-list] Failed to scan proposals store:", e);
    }

    // 2) Scan timeline detail blobs for campaign-based or orphaned timelines
    try {
      const { blobs: timelineBlobs } = await store.list({ prefix: "detail_" });
      for (const tBlob of timelineBlobs) {
        try {
          const detail = (await store.get(tBlob.key, { type: "json" })) as any;
          if (!detail || !detail.proposalId) continue;
          if (seenProposalIds.has(detail.proposalId)) continue;

          const bizUser = (detail.businessUsername || "").toLowerCase().replace(/^biz\//, "");
          const infUser = (detail.influencerUsername || "").toLowerCase();

          const isMatch =
            (userType === "business" && bizUser === username) ||
            (userType === "influencer" && infUser === username);
          if (!isMatch) continue;

          seenProposalIds.add(detail.proposalId);
          existing.push({
            proposalId: detail.proposalId,
            influencerUsername: infUser,
            businessUsername: bizUser,
            companyName: detail.companyName || "",
            proposalTitle: detail.proposalTitle || "",
            createdAt: detail.createdAt || new Date().toISOString(),
          });
          added++;
        } catch (blobErr) {
          console.error(`[timeline-list] Failed to read timeline blob ${tBlob.key}:`, blobErr);
        }
      }
    } catch (e) {
      console.error("[timeline-list] Failed to scan timeline detail blobs:", e);
    }

    // 3) Check campaign_applications DB for accepted applications
    try {
      const { getDatabase } = await import("@netlify/database");
      const db = getDatabase();
      let rows: any[];
      if (userType === "business") {
        rows = await db.sql`
          SELECT ca.*, c.title as campaign_title, c.business_username as biz_user, c.brand_name
          FROM campaign_applications ca
          JOIN campaigns c ON c.id = ca.campaign_id
          WHERE ca.status = 'accepted'
          AND LOWER(REPLACE(c.business_username, 'biz/', '')) = ${username}
        ` as any[];
      } else {
        rows = await db.sql`
          SELECT ca.*, c.title as campaign_title, c.business_username as biz_user, c.brand_name
          FROM campaign_applications ca
          JOIN campaigns c ON c.id = ca.campaign_id
          WHERE ca.status = 'accepted'
          AND LOWER(ca.applicant_username) = ${username}
        ` as any[];
      }
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const proposalId = `campaign_${row.campaign_id}_${(row.applicant_username || "").toLowerCase()}`;
          if (seenProposalIds.has(proposalId)) continue;
          seenProposalIds.add(proposalId);

          const bizUser = (row.biz_user || "").toLowerCase().replace(/^biz\//, "");
          const infUser = (row.applicant_username || "").toLowerCase();
          const companyName = row.brand_name || "";
          const campaignTitle = row.campaign_title || "";

          const detailKey = `detail_${proposalId}`;
          let detail = await store.get(detailKey, { type: "json" });
          if (!detail) {
            const timelineData = {
              proposalId,
              influencerUsername: infUser,
              businessUsername: bizUser,
              companyName,
              proposalTitle: campaignTitle,
              comments: [
                {
                  id: `tc_${Date.now()}_campaign_${proposalId}`,
                  proposalId,
                  authorType: "business",
                  authorName: companyName || bizUser,
                  authorUsername: bizUser,
                  content: `캠페인 "${campaignTitle}" 협업이 시작되었습니다. 메시지를 보내 소통을 시작해보세요!`,
                  createdAt: row.updated_at || row.created_at || new Date().toISOString(),
                  readBy: [bizUser],
                },
              ],
              createdAt: row.updated_at || row.created_at || new Date().toISOString(),
            };
            await store.setJSON(detailKey, timelineData);
            detail = timelineData;

            try {
              const otherType = userType === "business" ? "influencer" : "business";
              const otherUser = userType === "business" ? infUser : bizUser;
              if (otherUser) {
                const otherIndexKey = `index_${otherType}_${otherUser}`;
                const otherIndex = ((await store.get(otherIndexKey, { type: "json" })) as any[]) || [];
                if (!otherIndex.some((t: any) => t.proposalId === proposalId)) {
                  otherIndex.unshift({
                    proposalId,
                    influencerUsername: infUser,
                    businessUsername: bizUser,
                    companyName,
                    proposalTitle: campaignTitle,
                    createdAt: (detail as any)?.createdAt,
                  });
                  await store.setJSON(otherIndexKey, otherIndex);
                }
              }
            } catch (idxErr) {
              console.error("[timeline-list] Failed to update other index for campaign:", idxErr);
            }
          }

          existing.push({
            proposalId,
            influencerUsername: infUser,
            businessUsername: bizUser,
            companyName,
            proposalTitle: campaignTitle,
            createdAt: (detail as any)?.createdAt || row.created_at || new Date().toISOString(),
          });
          added++;
        }
      }
    } catch (e) {
      console.error("[timeline-list] Failed to scan campaign_applications DB:", e);
    }

    // 4) Recover from SQL timelines table
    try {
      const { getDatabase } = await import("@netlify/database");
      const db = getDatabase();
      let dbRows: any[];
      if (userType === "business") {
        dbRows = await db.sql`
          SELECT * FROM timelines
          WHERE LOWER(business_username) = ${username}
          ORDER BY created_at DESC
        ` as any[];
      } else {
        dbRows = await db.sql`
          SELECT * FROM timelines
          WHERE LOWER(influencer_username) = ${username}
          ORDER BY created_at DESC
        ` as any[];
      }
      if (Array.isArray(dbRows)) {
        for (const row of dbRows as any[]) {
          if (seenProposalIds.has(row.proposal_id)) continue;
          seenProposalIds.add(row.proposal_id);

          const detailKey = `detail_${row.proposal_id}`;
          let detail = await store.get(detailKey, { type: "json" }) as any;

          if (!detail) {
            // Recover messages from SQL
            let messages: any[] = [];
            try {
              messages = await db.sql`
                SELECT * FROM timeline_messages
                WHERE proposal_id = ${row.proposal_id}
                ORDER BY created_at ASC
              ` as any[];
            } catch (_) {}

            const comments = Array.isArray(messages) ? messages.map((m: any) => ({
              id: m.id,
              proposalId: m.proposal_id,
              authorType: m.author_type,
              authorName: m.author_name,
              authorUsername: m.author_username,
              content: m.content || "",
              createdAt: m.created_at,
              readBy: m.read_by || [],
              ...(m.attachments ? { attachments: m.attachments } : {}),
            })) : [];

            if (comments.length === 0) {
              comments.push({
                id: `tc_${Date.now()}_recovered_${row.proposal_id}`,
                proposalId: row.proposal_id,
                authorType: "business",
                authorName: row.company_name || row.business_username,
                authorUsername: row.business_username,
                content: `"${row.proposal_title}" 협업이 시작되었습니다. 메시지를 보내 소통을 시작해보세요!`,
                createdAt: row.created_at || new Date().toISOString(),
                readBy: [row.influencer_username],
              });
            }

            detail = {
              proposalId: row.proposal_id,
              influencerUsername: row.influencer_username,
              businessUsername: row.business_username,
              companyName: row.company_name || "",
              proposalTitle: row.proposal_title || "",
              comments,
              createdAt: row.created_at || new Date().toISOString(),
            };
            await store.setJSON(detailKey, detail);
          }

          existing.push({
            proposalId: row.proposal_id,
            influencerUsername: row.influencer_username || "",
            businessUsername: row.business_username || "",
            companyName: row.company_name || "",
            proposalTitle: row.proposal_title || "",
            createdAt: row.created_at || new Date().toISOString(),
          });
          added++;
        }
      }
    } catch (e) {
      console.error("[timeline-list] Failed to recover from SQL timelines table:", e);
    }

    if (added > 0) {
      existing.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      await store.setJSON(indexKey, existing);
    }

    const timelines = existing;

    const enriched = await Promise.all(
      timelines.map(async (t: any) => {
        try {
          const detailKey = `detail_${t.proposalId}`;
          const detail = (await store.get(detailKey, { type: "json" })) as any;
          const comments = detail?.comments || [];
          const unreadCount = comments.filter(
            (c: any) => !c.readBy?.includes(username)
          ).length;
          return {
            ...t,
            comments,
            unreadCount,
          };
        } catch (e) {
          return { ...t, comments: [], unreadCount: 0 };
        }
      })
    );

    return Response.json({ timelines: enriched });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/list/:username",
};
