import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { requireManager } from "./_shared/manager-auth.mts";

/**
 * 대화방 목록. `?type=influencer|business|manager`
 *
 * 담당자 유형이 추가됐다. 담당자는 자기에게 배정된 협업의 두 채널
 * (인플루언서 채널 · 브랜드 채널)을 한 목록에서 본다 — 협업 하나에 방이 둘이므로
 * 어느 쪽이 답을 기다리는지 한눈에 보이지 않으면 응답이 늦는 쪽이 방치된다.
 */
export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const url = new URL(req.url);
  const userType = url.searchParams.get("type") || "influencer";

  if (userType === "manager") {
    const manager = await requireManager(req);
    if (!manager.ok) return manager.response;
  } else {
    // 이 계정이 진행 중인 협업 목록(업체명 · 프로젝트명 · 안 읽은 수)이다. 본인만.
    const auth = await requireAccountOwner(req, username);
    if (!auth.ok) return auth.response;
  }

  const store = getStore("timelines");
  const indexKey = `index_${userType}_${username}`;

  if (req.method === "GET") {
    let data = (await store.get(indexKey, { type: "json" })) as any[] | null;
    const existing = Array.isArray(data) ? data : [];
    const seenProposalIds = new Set<string>(existing.map((t: any) => t.proposalId));
    let added = 0;

    let dbInstance: any = null;
    try {
      const { getDatabase } = await import("@picks/netlify-database");
      dbInstance = getDatabase();
    } catch {}

    let campaignRows: any[] = [];
    let sqlTimelines: any[] = [];
    let unreadMap: Record<string, number> = {};
    let latestMessageMap: Record<string, any> = {};

    if (dbInstance) {
      const [cRows, tRows] = await Promise.all([
        (async () => {
          try {
            // 담당자 중개 구조로 바뀐 뒤 선정된 협업은 브랜드↔인플루언서 방을 만들지
            // 않는다. 그래서 협업 행(campaign_collabs)이 있는 건은 여기서 제외한다 —
            // 제외하지 않으면 없어야 할 직접 대화방이 목록에서 되살아난다.
            // 예전에 이미 진행된 협업은 협업 행이 없으므로 그대로 복구된다.
            if (userType === "manager") return [];
            if (userType === "business") {
              return await dbInstance.sql`
                SELECT ca.*, c.title as campaign_title, c.business_username as biz_user, c.brand_name
                FROM campaign_applications ca
                JOIN campaigns c ON c.id = ca.campaign_id
                WHERE ca.status = 'accepted'
                AND LOWER(REPLACE(c.business_username, 'biz/', '')) = ${username}
                AND NOT EXISTS (
                  SELECT 1 FROM campaign_collabs cc
                  WHERE cc.campaign_id = ca.campaign_id
                  AND LOWER(cc.creator_username) = LOWER(ca.applicant_username)
                )
              ` as any[];
            }
            return await dbInstance.sql`
              SELECT ca.*, c.title as campaign_title, c.business_username as biz_user, c.brand_name
              FROM campaign_applications ca
              JOIN campaigns c ON c.id = ca.campaign_id
              WHERE ca.status = 'accepted'
              AND LOWER(ca.applicant_username) = ${username}
              AND NOT EXISTS (
                SELECT 1 FROM campaign_collabs cc
                WHERE cc.campaign_id = ca.campaign_id
                AND LOWER(cc.creator_username) = LOWER(ca.applicant_username)
              )
            ` as any[];
          } catch { return []; }
        })(),
        (async () => {
          try {
            if (userType === "manager") {
              const mineOnly = url.searchParams.get("mine") === "1";
              if (mineOnly) {
                return await dbInstance.sql`
                  SELECT * FROM timelines
                  WHERE LOWER(manager_username) = ${username}
                  ORDER BY created_at DESC
                ` as any[];
              }
              return await dbInstance.sql`
                SELECT * FROM timelines
                WHERE kind IN ('influencer_support', 'brand_support')
                ORDER BY created_at DESC
                LIMIT 300
              ` as any[];
            }
            if (userType === "business") {
              return await dbInstance.sql`
                SELECT * FROM timelines
                WHERE LOWER(business_username) = ${username}
                ORDER BY created_at DESC
              ` as any[];
            }
            return await dbInstance.sql`
              SELECT * FROM timelines
              WHERE LOWER(influencer_username) = ${username}
              ORDER BY created_at DESC
            ` as any[];
          } catch { return []; }
        })(),
      ]);
      campaignRows = cRows;
      sqlTimelines = tRows;
    }

    if (Array.isArray(sqlTimelines)) {
      for (const row of sqlTimelines) {
        if (seenProposalIds.has(row.proposal_id)) continue;
        seenProposalIds.add(row.proposal_id);
        existing.push({
          proposalId: row.proposal_id,
          kind: row.kind || "brand_influencer",
          collabId: row.collab_id || "",
          influencerUsername: row.influencer_username || "",
          businessUsername: row.business_username || "",
          managerUsername: row.manager_username || "",
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
          kind: "brand_influencer",
          collabId: "",
          influencerUsername: infUser,
          businessUsername: bizUser,
          managerUsername: "",
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
                kind: "brand_influencer",
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

    if (proposalIds.length > 0 && dbInstance) {
      try {
        const unreadRows = await dbInstance.sql`
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
        const batchSize = 10;
        const batched = existing.slice(0, batchSize);
        const details = await Promise.all(
          batched.map(async (t: any) => {
            try {
              const detail = (await store.get(`detail_${t.proposalId}`, { type: "json" })) as any;
              const comments = detail?.comments || [];
              const unreadCount = comments.filter((c: any) => !c.readBy?.includes(username)).length;
              return { proposalId: t.proposalId, unreadCount };
            } catch {
              return { proposalId: t.proposalId, unreadCount: 0 };
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
      lastMessageAt: latestMessageMap[t.proposalId] || null,
    }));

    return Response.json({ timelines: enriched });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/list/:username",
};
