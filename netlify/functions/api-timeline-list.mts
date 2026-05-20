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
    const data = await store.get(indexKey, { type: "json" }) as any[] | null;
    const timelines = data || [];

    const enriched = await Promise.all(
      timelines.map(async (t: any) => {
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
      })
    );

    return Response.json({ timelines: enriched });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/list/:username",
};
