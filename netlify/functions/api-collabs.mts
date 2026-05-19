import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("collabs");
  const key = `collabs_${username}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    return Response.json({ records: data || [] });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const existing = (await store.get(key, { type: "json" })) as any[] || [];
    const record = {
      id: `collab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...body,
      createdAt: new Date().toISOString(),
    };
    existing.push(record);
    await store.setJSON(key, existing);
    return Response.json({ success: true, record });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/collabs/:username",
};
