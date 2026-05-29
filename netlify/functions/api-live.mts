import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // Strong consistency so a viewer's "is this broadcast live?" poll reflects the
  // broadcaster's go-live/end-broadcast write immediately. With the default
  // eventual store this read could lag up to 60s, so viewers would keep seeing
  // isLive=false (never connecting) or stale isLive=true after a broadcast ended.
  // Matches api-admin-live.mts, which already opens this same store as 'strong'.
  const store = getStore({ name: "live-state", consistency: "strong" });
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
