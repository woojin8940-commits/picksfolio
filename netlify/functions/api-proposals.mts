import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("proposals");

  if (req.method === "GET") {
    const data = await store.get(`proposals_${username}`, { type: "json" });
    return Response.json(data || []);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const existing = (await store.get(`proposals_${username}`, { type: "json" })) as any[] || [];
    const proposal = {
      id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...body,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    existing.push(proposal);
    await store.setJSON(`proposals_${username}`, existing);
    return Response.json({ success: true, proposal });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/proposals/:username",
};
