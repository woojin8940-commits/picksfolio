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

  // A broadcast that crashes, force-quits, or whose end-broadcast write never
  // lands would otherwise leave isLive=true in the store forever — so the host's
  // own page (and every viewer) keeps showing "방송중" when nobody is live. The
  // broadcaster heartbeats `heartbeatAt` every ~8s while live, so any isLive=true
  // record whose heartbeat is older than this window is a dead session: report it
  // as offline. (Records written before heartbeats existed have no heartbeatAt and
  // are left untouched to avoid hiding a genuinely live legacy broadcast.)
  const LIVE_HEARTBEAT_STALE_MS = 40_000;

  if (req.method === "GET") {
    const data = (await store.get(key, { type: "json" })) as any;
    if (!data) return Response.json({ isLive: false, viewerCount: 0 });
    if (
      data.isLive &&
      typeof data.heartbeatAt === "number" &&
      Date.now() - data.heartbeatAt > LIVE_HEARTBEAT_STALE_MS
    ) {
      return Response.json({ ...data, isLive: false, viewerCount: 0 });
    }
    return Response.json(data);
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
