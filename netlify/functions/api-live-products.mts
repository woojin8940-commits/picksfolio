import { getStore } from "@netlify/blobs";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import type { Config, Context } from "@netlify/functions";

/**
 * 라이브에 걸어 둔 상품 목록.
 * GET 은 시청자도 봐야 하므로 공개, POST(수정)는 채널 주인만.
 */

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("live-products");
  const key = `products_${username}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    return Response.json({ products: Array.isArray(data) ? data : [] });
  }

  if (req.method === "POST") {
    const auth = await requireAccountOwner(req, username);
    if (!auth.ok) return auth.response;

    const bodyText = await req.text();
    if (bodyText.length > 1024 * 1024) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    let body: any;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!Array.isArray(body.products) || body.products.length > 500) {
      return Response.json({ error: "Invalid products" }, { status: 400 });
    }
    await store.setJSON(key, body.products);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/live-products/:username",
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: "ip" },
};
