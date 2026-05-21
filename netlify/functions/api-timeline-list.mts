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

    const [campaignRows, sqlTimelines] = await Promise.all([
      (async () => {
        try {
          const { getDatabase } = await import("@netlify/database");
          const db = getDatabase();
          if (userType === "business") {
            return await db.sql`
              SELECT ca.*, c.title as campaign_title, c.business_username as biz_user, c.brand_name
              FROM campaign_applications ca
              JOIN campaigns c ON c.id = ca.campaign_id
              WHERE ca.status = 'accepted'
              AND LOWER(REPLACE(c.business_username, 'biz/', '')) = ${username}
            ` as any[];
          } else {
            return await db.sql`
              SELECT ca.*, c.title as campaign_title, c.business_username as biz_user, c.brand_name
              FROM campaign_applications ca
              JOIN campaigns c ON c.id = ca.campaign_id
              WHERE ca.status = 'accepted'
              AND LOWER(ca.applicant_username) = ${username}
            ` as any[];
          }
        } catch { return []; }
      })(),
      (async () => {
        try {
          const { getDatabase } = await import("@netlify/database");
          const db = getDatabase();
          if (userType === "business") {
            return await db.sql`
              SELECT * FROM timelines
              WHERE LOWER(business_username) = ${username}
              ORDER BY created_at DESC
            ` as any[];
          } else {
            return await db.sql`
              SELECT * FROM timelines
              WHERE LOWER(influencer_username) = ${username}
              ORDER BY created_at DESC
            ` as any[];
          }
        } catch { return []; }
      })(),
    ]);

    if (Array.isArray(sqlTimelines)) {
      for (const row of sqlTimelines) {
        if (seenProposalIds.has(row.proposal_id)) continue;
        seenProposalIds.add(row.proposal_id);
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

    if (Array.isArray(campaignRows)) {
      for (const row of campaignRows) {
        const proposalId = `campaign_${row.campaign_id}_${(row.applicant_username || "").toLowerCase()}`;
        if (seenProposalIds.has(proposalId)) continue;
        seenProposalIds.add(proposalId);

        const bizUser = (row.biz_user || "").toLowerCase().replace(/^biz\//, "");
        const infUser = (row.applicant_username || "").toLowerCase();

        existing.push({
          proposalId,
          influencerUsername: infUser,
          businessUsername: bizUser,
          companyName: row.brand_name || "",
          proposalTitle: row.campaign_title || "",
          createdAt: row.updated_at || row.created_at || new Date().toISOString(),
        });
        added++;

        context.waitUntil((async () => {
          try {
            const detailKey = `detail_${proposalId}`;
            const detail = await store.get(detailKey, { type: "json" });
            if (!detail) {
              const companyName = row.brand_name || "";
              const campaignTitle = row.campaign_title || "";
              const timelineData = {
                proposalId,
                influencerUsername: infUser,
                businessUsername: bizUser,
                companyName,
                proposalTitle: campaignTitle,
                comments: [{
                  id: `tc_${Date.now()}_campaign_${proposalId}`,
                  proposalId,
                  authorType: "business",
                  authorName: companyName || bizUser,
                  authorUsername: bizUser,
                  content: `캠페인 "${campaignTitle}" 협업이 시작되었습니다. 메시지를 보내 소통을 시작해보세요!`,
                  createdAt: row.updated_at || row.created_at || new Date().toISOString(),
                  readBy: [bizUser],
                }],
                createdAt: row.updated_at || row.created_at || new Date().toISOString(),
              };
              await store.setJSON(detailKey, timelineData);
            }
          } catch {}
        })());
      }
    }

    if (added > 0) {
      existing.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      context.waitUntil(store.setJSON(indexKey, existing).catch(() => {}));
    }

    const proposalIds = existing.map((t: any) => t.proposalId);

    let unreadMap: Record<string, number> = {};
    let latestMessageMap: Record<string, any> = {};
    if (proposalIds.length > 0) {
      try {
        const { getDatabase } = await import("@netlify/database");
        const db = getDatabase();
        const unreadRows = await db.sql`
          SELECT proposal_id,
                 COUNT(*) FILTER (WHERE NOT (${username} = ANY(read_by))) as unread_count,
                 MAX(created_at) as last_message_at
          FROM timeline_messages
          WHERE proposal_id = ANY(${proposalIds})
          GROUP BY proposal_id
        ` as any[];
        if (Array.isArray(unreadRows)) {
          for (const row of unreadRows) {
            unreadMap[row.proposal_id] = parseInt(row.unread_count) || 0;
            latestMessageMap[row.proposal_id] = row.last_message_at;
          }
        }
      } catch {
        // Fallback: fetch details from blob store in parallel
        const details = await Promise.all(
          existing.map(async (t: any) => {
            try {
              const detail = (await store.get(`detail_${t.proposalId}`, { type: "json" })) as any;
              const comments = detail?.comments || [];
              const unreadCount = comments.filter((c: any) => !c.readBy?.includes(username)).length;
              return { proposalId: t.proposalId, unreadCount, comments };
            } catch {
              return { proposalId: t.proposalId, unreadCount: 0, comments: [] };
            }
          })
        );
        for (const d of details) {
          unreadMap[d.proposalId] = d.unreadCount;
        }
      }
    }

    const enriched = existing.map((t: any) => ({
      ...t,
      unreadCount: unreadMap[t.proposalId] || 0,
    }));

    return Response.json({ timelines: enriched });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/list/:username",
};
