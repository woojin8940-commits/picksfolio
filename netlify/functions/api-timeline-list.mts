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
 *
 * 협업이 시작되는 경로는 둘이다. 비즈니스 제안을 인플루언서가 수락한 건과,
 * 담당자가 리스트업해서 진행하는 캠페인 건. 둘 다 이 목록에 함께 나오고 양쪽
 * 모두 대화할 수 있는데, 방 이름만 보면 지금 마주 앉은 상대가 브랜드인지
 * 담당자인지, 이 건이 아직 검토 중인 제안인지 이미 진행 중인 협업인지 구분되지
 * 않았다. 그래서 응답에 `source`(어느 경로에서 왔는지)와, 제안 경로인 경우
 * `proposalStatus`(검토 중 / 수락 / 거절)를 함께 실어 보낸다.
 */

/** 방 하나가 어느 경로에서 온 협업인지. */
const sourceOf = (t: any): "business_proposal" | "manager_collab" | "campaign" => {
  if (t?.kind === "influencer_support" || t?.kind === "brand_support") return "manager_collab";
  // 담당자 중개 이전에 캠페인 선정으로 열린 직접 대화방(복구된 예전 건).
  if (String(t?.proposalId || "").startsWith("campaign_")) return "campaign";
  return "business_proposal";
};

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
    let collabRows: any[] = [];
    let unreadMap: Record<string, number> = {};
    let latestMessageMap: Record<string, any> = {};

    if (dbInstance) {
      const [cRows, tRows, coRows] = await Promise.all([
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
        // 이 인플루언서가 진행 중인 담당자 중개 협업. 아래에서 대화 채널이 빠진
        // 건을 찾아 복구하는 데 쓴다. 브랜드 쪽은 조회하지 않는다 — 브랜드는
        // 담당자와 카톡으로 따로 연락하므로 채널을 만들 이유가 없다.
        (async () => {
          try {
            if (userType !== "influencer") return [];
            return await dbInstance.sql`
              SELECT id, campaign_title, company_name, manager_username
              FROM campaign_collabs
              WHERE LOWER(creator_username) = ${username}
                AND status <> 'cancelled'
                AND cancelled_at IS NULL
            ` as any[];
          } catch { return []; }
        })(),
      ]);
      campaignRows = cRows;
      sqlTimelines = tRows;
      collabRows = coRows;
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

    // ── 담당자 대화 채널 복구 (인플루언서 전용) ────────────────────────────
    //
    // 담당자가 리스트업해서 진행하는 협업은 브랜드와 직접 대화하지 않는다.
    // 인플루언서는 담당자와의 1:1 채널(influencer_support)에서 이야기하고,
    // 담당자가 필요한 내용만 브랜드에게 옮긴다.
    //
    // 그런데 이 채널은 협업이 만들어지는 순간에만 생성됐다. 담당자 중개 구조가
    // 생기기 전에 시작된 협업, 그리고 협업 생성 도중 Blobs 쓰기가 실패한 건은
    // 채널이 없다. 그러면 인플루언서는 협업이 진행 중인데 물어볼 곳이 없고,
    // 화면에는 아무 것도 나오지 않아 "대화 기능이 없는 것"처럼 보인다.
    // 복구를 부르는 곳이 지금까지 아무데도 없었다(담당자용 ensure_threads 동작은
    // 만들어져 있지만 호출하는 화면이 없다).
    //
    // 그래서 목록을 열 때 직접 메운다. 채널이 이미 있으면 아무 일도 하지 않으므로
    // (ensureSupportThread 는 멱등) 정상적인 경우 추가 비용은 협업 조회 한 번이다.
    // 브랜드 쪽 채널은 건드리지 않는다 — 브랜드는 담당자와 카톡으로 연락한다.
    if (userType === "influencer" && dbInstance && collabRows.length > 0) {
      const channelled = new Set(
        existing
          .filter((t: any) => t.kind === "influencer_support")
          .map((t: any) => String(t.collabId || "")),
      );
      const missing = collabRows.filter((row) => !channelled.has(String(row.id || "")));

      if (missing.length > 0) {
        try {
          const { ensureSupportThread } = await import("./_shared/collab-workflow.mts");
          for (const row of missing) {
            const collabId = String(row.id || "");
            if (!collabId) continue;
            const title = String(row.campaign_title || "캠페인 협업");
            const proposalId = await ensureSupportThread({
              db: dbInstance,
              kind: "influencer_support",
              collabId,
              counterpartUsername: username,
              managerUsername: String(row.manager_username || ""),
              companyName: String(row.company_name || ""),
              title,
              firstMessage:
                `"${title}" 협업 담당자 채널입니다.\n` +
                `진행 중 궁금한 점이나 일정 조정이 필요하면 여기로 남겨 주세요. ` +
                `브랜드에 전달할 내용은 담당자가 정리해 옮깁니다.`,
            });
            if (seenProposalIds.has(proposalId)) continue;
            seenProposalIds.add(proposalId);
            existing.push({
              proposalId,
              kind: "influencer_support",
              collabId,
              influencerUsername: username,
              businessUsername: "",
              managerUsername: String(row.manager_username || ""),
              companyName: String(row.company_name || ""),
              proposalTitle: title,
              createdAt: new Date().toISOString(),
            });
            added++;
          }
        } catch (err) {
          // 복구에 실패해도 목록 자체는 보여준다. 이미 있는 대화가 사라지는 것보다
          // 낫고, 다음 조회에서 다시 시도한다.
          console.error("[timeline-list] 담당자 채널 복구 실패:", err);
        }
      }
    }

    if (added > 0) {
      existing.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      context.waitUntil(store.setJSON(indexKey, existing).catch(() => {}));
    }

    const proposalIds = existing.map((t: any) => t.proposalId);

    // 비즈니스 제안으로 열린 방의 제안 상태. 방은 제안이 "도착"할 때 열리므로
    // (수락 전에도 조건을 물어볼 수 있게 한 설계) 목록에는 아직 검토 중인 제안과
    // 이미 수락된 협업이 섞여 있다. 어느 쪽인지는 제안 상태로만 알 수 있다.
    const proposalStatusMap: Record<string, string> = {};
    const businessProposalIds = existing
      .filter((t: any) => sourceOf(t) === "business_proposal")
      .map((t: any) => t.proposalId);
    if (businessProposalIds.length > 0 && dbInstance) {
      try {
        const statusRows = (await dbInstance.sql`
          SELECT id, status FROM proposals WHERE id = ANY(${businessProposalIds})
        `) as any[];
        for (const row of statusRows || []) {
          if (row?.id) proposalStatusMap[row.id] = row.status || "";
        }
      } catch {
        // 제안이 Blobs 에만 남아 있는 예전 건은 상태를 알 수 없다. 그 경우
        // 화면은 상태 배지를 생략한다 — 대화 자체는 그대로 가능하다.
      }
    }

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
      source: sourceOf(t),
      proposalStatus: proposalStatusMap[t.proposalId] || null,
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
