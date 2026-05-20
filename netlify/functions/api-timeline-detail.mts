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
    if (!data) {
      return Response.json({ timeline: { proposalId, comments: [], createdAt: new Date().toISOString() } });
    }
    return Response.json({ timeline: data });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/detail/:proposalId",
};
