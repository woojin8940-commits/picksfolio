import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { applyComplimentaryMembership } from "./_shared/complimentary-memberships.mts";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("seller-verification");
  const key = `seller_${username}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    const enriched = applyComplimentaryMembership(username, data as any);
    if (!enriched) return Response.json(null, { status: 404 });
    return Response.json(enriched);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const record = { ...body, updatedAt: new Date().toISOString() };
    await store.setJSON(key, record);
    return Response.json({ success: true, data: record });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/seller-verification/:username",
};
