import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { resolveTimelineAccess } from "./_shared/timeline-access.mts";

export default async (req: Request, context: Context) => {
  const proposalId = context.params.proposalId;
  if (!proposalId) {
    return Response.json({ error: "Missing proposalId" }, { status: 400 });
  }

  // 협업 대화 전문과 첨부 파일이 그대로 들어 있다. proposalId 만 알면 누구나 읽을 수
  // 있었으므로, 대화를 읽은 뒤 그 대화의 참여자(인플루언서 · 브랜드 · 담당자)인지
  // 대조한다. 참여자를 알려면 자원을 먼저 읽어야 하므로 토큰 검증은 방을 찾은 뒤 한다.
  //
  // 담당자 채널은 참여자가 두 명(당사자 한 명 + 담당자)뿐이다. 방에 기록되지 않은
  // 쪽은 담당자여도 아니라 아예 열리지 않는다 — 브랜드 채널에는 인플루언서가,
  // 인플루언서 채널에는 브랜드가 들어올 수 없다.
  const store = getStore("timelines");
  const key = `detail_${proposalId}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" }) as any;
    if (data) {
      const access = await resolveTimelineAccess(req, {
        influencer: data.influencerUsername,
        business: data.businessUsername,
        manager: data.managerUsername,
      });
      if (!access.ok) return access.response;
      return Response.json({
        timeline: data,
        viewer: { username: access.username, authorType: access.authorType },
      });
    }

    try {
      const { getDatabase } = await import("@picks/netlify-database");
      const db = getDatabase();

      const [rows, msgRows] = await Promise.all([
        db.sql`SELECT * FROM timelines WHERE proposal_id = ${proposalId}`,
        db.sql`
          SELECT * FROM timeline_messages
          WHERE proposal_id = ${proposalId}
          ORDER BY created_at ASC
        `,
      ]);

      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as any;
        const access = await resolveTimelineAccess(req, {
          influencer: row.influencer_username,
          business: row.business_username,
          manager: row.manager_username,
        });
        if (!access.ok) return access.response;
        const comments = Array.isArray(msgRows) ? msgRows.map((m: any) => ({
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

        const recovered = {
          proposalId: row.proposal_id,
          influencerUsername: row.influencer_username || "",
          businessUsername: row.business_username || "",
          managerUsername: row.manager_username || "",
          kind: row.kind || "brand_influencer",
          collabId: row.collab_id || "",
          companyName: row.company_name || "",
          proposalTitle: row.proposal_title || "",
          comments,
          createdAt: row.created_at || new Date().toISOString(),
        };

        context.waitUntil(store.setJSON(key, recovered).catch(() => {}));
        return Response.json({
          timeline: recovered,
          viewer: { username: access.username, authorType: access.authorType },
        });
      }
    } catch (dbErr) {
      console.error("[timeline-detail] Failed to recover from SQL:", dbErr);
    }

    // 방이 아직 없으면 빈 방을 돌려준다. 참여자를 알 수 없으므로 대조할 대상도 없고,
    // 여기서 새는 정보도 없다. 단, 로그인은 확인한다.
    const access = await resolveTimelineAccess(req, {});
    if (!access.ok && access.response.status === 401) return access.response;

    return Response.json({ timeline: { proposalId, comments: [], createdAt: new Date().toISOString() } });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/detail/:proposalId",
};
