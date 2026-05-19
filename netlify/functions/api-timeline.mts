import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("timeline");
  const key = `timeline_${username}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    return Response.json(data || { events: [] });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const existing = (await store.get(key, { type: "json" })) as any || { events: [] };
    existing.events = existing.events || [];
    existing.events.unshift({ ...body, createdAt: new Date().toISOString() });
    await store.setJSON(key, existing);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/:username",
};
