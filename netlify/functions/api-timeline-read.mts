import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { resolveTimelineAccess } from "./_shared/timeline-access.mts";

const STORE = "timelines";

export default async (req: Request, context: Context) => {
  const proposalId = context.params.proposalId;
  if (!proposalId) {
    return Response.json({ error: "Missing proposalId" }, { status: 400 });
  }

  if (req.method === "PATCH") {
    // 읽음 표시는 "누가 읽었는지"를 남기는 기록이다. 예전에는 body 의 username 을
    // 그대로 믿어서 남의 대화를 대신 읽음 처리할 수 있었으므로, 토큰으로 확인한
    // 호출자 본인 이름만 쓴다. 담당자가 읽으면 담당자 이름으로 남는다.
    const store = getStore(STORE);
    const key = `detail_${proposalId}`;
    const data = (await store.get(key, { type: "json" })) as any;

    const access = await resolveTimelineAccess(req, {
      influencer: data?.influencerUsername,
      business: data?.businessUsername,
      manager: data?.managerUsername,
    });
    if (!access.ok) {
      // 방이 없으면 대조할 참여자도 없다 — 읽음 표시할 것도 없으므로 조용히 끝낸다.
      if (!data || !data.comments) return Response.json({ success: true });
      return access.response;
    }
    const username = access.username;
    if (!username) {
      return Response.json({ error: "Missing username" }, { status: 400 });
    }
    if (!data || !data.comments) {
      return Response.json({ success: true });
    }

    // 상대방이 같은 순간에 답장을 보내면 통째로 덮어쓰기가 그 메시지를 지운다.
    // 최신 대화를 다시 읽어 읽음 표시만 얹는 조건부 쓰기로 바꾼다.
    let updated = false;
    await mutateBlobJSON<any>(STORE, key, (current) => {
      const comments = Array.isArray(current?.comments) ? current.comments : null;
      if (!current || !comments) {
        updated = false;
        return null;
      }
      let changed = false;
      const nextComments = comments.map((comment: any) => {
        const readBy: string[] = Array.isArray(comment?.readBy) ? comment.readBy : [];
        if (readBy.includes(username)) return comment;
        changed = true;
        return { ...comment, readBy: [...readBy, username] };
      });
      updated = changed;
      return changed ? { ...current, comments: nextComments } : null;
    });

    if (updated) {
      // Update SQL read_by as well
      try {
        const { getDatabase } = await import("@picks/netlify-database");
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
