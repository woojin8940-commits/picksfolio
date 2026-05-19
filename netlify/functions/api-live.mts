import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("live-state");
  const key = `picks_live_${username}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    return Response.json(data || { isLive: false, viewerCount: 0 });
  }

  if (req.method === "POST") {
    const body = await req.json();
    await store.setJSON(key, body);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/live/:username",
};
