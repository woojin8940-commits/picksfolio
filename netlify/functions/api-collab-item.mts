import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  const recordId = context.params.id;
  if (!username || !recordId) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  const store = getStore("collabs");
  const key = `collabs_${username}`;

  if (req.method === "PATCH") {
    const body = await req.json();
    const existing = (await store.get(key, { type: "json" })) as any[] || [];
    const idx = existing.findIndex((r: any) => r.id === recordId);
    if (idx === -1) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    existing[idx] = { ...existing[idx], ...body, updatedAt: new Date().toISOString() };
    await store.setJSON(key, existing);
    return Response.json({ success: true });
  }

  if (req.method === "DELETE") {
    const existing = (await store.get(key, { type: "json" })) as any[] || [];
    const filtered = existing.filter((r: any) => r.id !== recordId);
    await store.setJSON(key, filtered);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/collabs/:username/:id",
};
