import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("live-cart");
  const key = `cart_${username}`;

  if (req.method === "GET") {
    const url = new URL(req.url);
    const viewerId = url.searchParams.get("viewerId");
    const data = (await store.get(key, { type: "json" })) as any || { items: [] };

    if (viewerId) {
      const cart = (data.items || []).filter((i: any) => i.viewerId === viewerId);
      return Response.json({ cart });
    }
    return Response.json(data);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const data = (await store.get(key, { type: "json" })) as any || { items: [] };
    data.items = data.items || [];
    data.items.push({ ...body, addedAt: new Date().toISOString() });
    await store.setJSON(key, data);
    return Response.json({ success: true });
  }

  if (req.method === "PATCH") {
    const body = await req.json();
    const data = (await store.get(key, { type: "json" })) as any || { items: [] };
    if (body.viewerId) {
      data.items = (data.items || []).map((i: any) =>
        i.viewerId === body.viewerId ? { ...i, kakaoSent: true } : i
      );
      await store.setJSON(key, data);
    }
    return Response.json({ success: true });
  }

  if (req.method === "DELETE") {
    let body: any = {};
    try { body = await req.json(); } catch {}

    if (body.viewerId && body.productId) {
      const data = (await store.get(key, { type: "json" })) as any || { items: [] };
      data.items = (data.items || []).filter(
        (i: any) => !(i.viewerId === body.viewerId && i.productId === body.productId)
      );
      await store.setJSON(key, data);
    } else {
      await store.setJSON(key, { items: [] });
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/live-cart/:username",
};
