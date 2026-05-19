import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  const replayId = context.params.id;
  if (!username || !replayId) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  const store = getStore("broadcast-history");
  const key = `history_${username}`;
  const existing = (await store.get(key, { type: "json" })) as any[] || [];
  const broadcast = existing.find((r: any) => r.id === replayId);

  if (!broadcast) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ broadcast });
};

export const config: Config = {
  path: "/api/broadcast-replay/:username/:id",
};
