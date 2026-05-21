import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

interface CartItem {
  productId: string;
  productName: string;
  productPrice?: string;
  productImage?: string;
  productLink: string;
  selectedOptions?: Record<string, string>;
  addedAt: string;
}

interface ViewerCart {
  viewerId: string;
  viewerNickname: string;
  viewerProfileImage?: string;
  items: CartItem[];
  kakaoSent: boolean;
}

interface CartData {
  carts: ViewerCart[];
  updatedAt: string;
}

function parseKrwPrice(raw?: string): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function computeStats(data: CartData) {
  const allItems: { item: CartItem; viewerId: string }[] = [];
  for (const cart of data.carts) {
    for (const item of cart.items) {
      allItems.push({ item, viewerId: cart.viewerId });
    }
  }

  const viewerIds = new Set(allItems.map((e) => e.viewerId));

  const productMap = new Map<
    string,
    {
      productId: string;
      name: string;
      count: number;
      image?: string;
      link: string;
      price?: string;
      optionCounts: Record<string, Record<string, number>>;
    }
  >();

  let totalRevenue = 0;

  for (const { item } of allItems) {
    const existing = productMap.get(item.productId);
    const price = parseKrwPrice(item.productPrice);
    totalRevenue += price;

    if (existing) {
      existing.count += 1;
      if (!existing.price && item.productPrice) existing.price = item.productPrice;
      if (!existing.image && item.productImage) existing.image = item.productImage;
    } else {
      productMap.set(item.productId, {
        productId: item.productId,
        name: item.productName,
        count: 1,
        image: item.productImage,
        link: item.productLink,
        price: item.productPrice,
        optionCounts: {},
      });
    }

    const entry = productMap.get(item.productId)!;
    if (item.selectedOptions) {
      for (const [optName, optVal] of Object.entries(item.selectedOptions)) {
        if (!entry.optionCounts[optName]) entry.optionCounts[optName] = {};
        entry.optionCounts[optName][optVal] = (entry.optionCounts[optName][optVal] || 0) + 1;
      }
    }
  }

  const productCounts = Array.from(productMap.values()).sort((a, b) => b.count - a.count);

  return {
    totalViewers: viewerIds.size,
    totalItems: allItems.length,
    totalRevenue,
    productCounts,
  };
}

function ensureCartData(raw: unknown): CartData {
  if (raw && typeof raw === "object" && Array.isArray((raw as any).carts)) {
    const carts = (raw as any).carts.map((c: any) => ({
      viewerId: c.viewerId || "unknown",
      viewerNickname: c.viewerNickname || c.viewerId || "unknown",
      viewerProfileImage: c.viewerProfileImage,
      items: Array.isArray(c.items) ? c.items : [],
      kakaoSent: !!c.kakaoSent,
    }));
    return { carts, updatedAt: (raw as any).updatedAt || new Date().toISOString() };
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as any).items)) {
    const legacy = raw as { items: any[] };
    const viewerMap = new Map<string, ViewerCart>();
    for (const item of legacy.items) {
      const vid = item.viewerId || "unknown";
      if (!viewerMap.has(vid)) {
        viewerMap.set(vid, {
          viewerId: vid,
          viewerNickname: item.viewerNickname || vid,
          viewerProfileImage: item.viewerProfileImage,
          items: [],
          kakaoSent: !!item.kakaoSent,
        });
      }
      viewerMap.get(vid)!.items.push({
        productId: item.productId,
        productName: item.productName,
        productPrice: item.productPrice,
        productImage: item.productImage,
        productLink: item.productLink || "",
        selectedOptions: item.selectedOptions,
        addedAt: item.addedAt || new Date().toISOString(),
      });
    }
    return { carts: Array.from(viewerMap.values()), updatedAt: new Date().toISOString() };
  }
  return { carts: [], updatedAt: new Date().toISOString() };
}

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore({ name: "live-cart", consistency: "strong" });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const viewerId = url.searchParams.get("viewerId");
      const raw = await store.get(username, { type: "json" });
      const data = ensureCartData(raw);

      if (viewerId) {
        const cart = data.carts.find((c) => c.viewerId === viewerId);
        return Response.json({ cart: cart?.items || [] });
      }

      const stats = computeStats(data);
      return Response.json({ carts: data.carts, stats });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const raw = await store.get(username, { type: "json" });
      const data = ensureCartData(raw);

      const viewerId = body.viewerId || "unknown";
      let viewerCart = data.carts.find((c) => c.viewerId === viewerId);
      if (!viewerCart) {
        viewerCart = {
          viewerId,
          viewerNickname: body.viewerNickname || viewerId,
          viewerProfileImage: body.viewerProfileImage,
          items: [],
          kakaoSent: false,
        };
        data.carts.push(viewerCart);
      }

      viewerCart.items.push({
        productId: body.productId,
        productName: body.productName,
        productPrice: body.productPrice,
        productImage: body.productImage,
        productLink: body.productLink || "",
        selectedOptions: body.selectedOptions,
        addedAt: new Date().toISOString(),
      });
      data.updatedAt = new Date().toISOString();

      await store.setJSON(username, data);
      const totalItems = data.carts.reduce((s, c) => s + c.items.length, 0);
      return Response.json({ success: true, itemCount: totalItems });
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      if (body.viewerId) {
        const raw = await store.get(username, { type: "json" });
        const data = ensureCartData(raw);
        const cart = data.carts.find((c) => c.viewerId === body.viewerId);
        if (cart) {
          cart.kakaoSent = true;
          data.updatedAt = new Date().toISOString();
          await store.setJSON(username, data);
        }
      }
      return Response.json({ success: true });
    }

    if (req.method === "DELETE") {
      let body: any = {};
      try {
        body = await req.json();
      } catch {}

      if (body.viewerId && body.productId) {
        const raw = await store.get(username, { type: "json" });
        const data = ensureCartData(raw);
        const cart = data.carts.find((c) => c.viewerId === body.viewerId);
        if (cart) {
          const optKey = body.selectedOptions ? JSON.stringify(body.selectedOptions) : null;
          const idx = cart.items.findIndex((i) => {
            if (i.productId !== body.productId) return false;
            if (optKey) return JSON.stringify(i.selectedOptions || {}) === optKey;
            return true;
          });
          if (idx !== -1) cart.items.splice(idx, 1);
          if (cart.items.length === 0) {
            data.carts = data.carts.filter((c) => c.viewerId !== body.viewerId);
          }
          data.updatedAt = new Date().toISOString();
          await store.setJSON(username, data);
        }
      } else {
        await store.setJSON(username, { carts: [], updatedAt: new Date().toISOString() });
      }
      return Response.json({ success: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (e) {
    console.error("[live-cart] Error:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/live-cart/:username",
};
