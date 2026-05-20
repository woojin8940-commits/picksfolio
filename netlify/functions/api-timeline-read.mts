import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const proposalId = context.params.proposalId;
  if (!proposalId) {
    return Response.json({ error: "Missing proposalId" }, { status: 400 });
  }

  if (req.method === "PATCH") {
    const body = await req.json();
    const username = body.username?.toLowerCase();
    if (!username) {
      return Response.json({ error: "Missing username" }, { status: 400 });
    }

    const store = getStore("timelines");
    const key = `detail_${proposalId}`;
    const data = (await store.get(key, { type: "json" })) as any;
    if (!data || !data.comments) {
      return Response.json({ success: true });
    }

    let updated = false;
    for (const comment of data.comments) {
      if (!comment.readBy) comment.readBy = [];
      if (!comment.readBy.includes(username)) {
        comment.readBy.push(username);
        updated = true;
      }
    }

    if (updated) {
      await store.setJSON(key, data);

      // Update SQL read_by as well
      try {
        const { getDatabase } = await import("@netlify/database");
        const db = getDatabase();
        await db.sql`
          UPDATE timeline_messages
          SET read_by = array_append(read_by, ${username})
          WHERE proposal_id = ${proposalId}
          AND NOT (${username} = ANY(read_by))
        `;
      } catch (dbErr) {
        console.error("[timeline-read] Failed to update SQL read_by:", dbErr);
      }
    }

    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/read/:proposalId",
};
