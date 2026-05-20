import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const proposalId = context.params.proposalId;
  if (!proposalId) {
    return Response.json({ error: "Missing proposalId" }, { status: 400 });
  }

  const store = getStore("timelines");
  const key = `detail_${proposalId}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" }) as any;
    if (data) {
      return Response.json({ timeline: data });
    }

    // Fallback: recover from SQL database
    try {
      const { getDatabase } = await import("@netlify/database");
      const db = getDatabase();
      const rows = await db.sql`
        SELECT * FROM timelines WHERE proposal_id = ${proposalId}
      `;
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as any;
        const msgRows = await db.sql`
          SELECT * FROM timeline_messages
          WHERE proposal_id = ${proposalId}
          ORDER BY created_at ASC
        `;
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
          companyName: row.company_name || "",
          proposalTitle: row.proposal_title || "",
          comments,
          createdAt: row.created_at || new Date().toISOString(),
        };

        // Write back to blob store for future reads
        await store.setJSON(key, recovered);
        return Response.json({ timeline: recovered });
      }
    } catch (dbErr) {
      console.error("[timeline-detail] Failed to recover from SQL:", dbErr);
    }

    return Response.json({ timeline: { proposalId, comments: [], createdAt: new Date().toISOString() } });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/detail/:proposalId",
};
