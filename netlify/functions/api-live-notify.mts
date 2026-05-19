import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const influencer = url.searchParams.get("influencer")?.toLowerCase();

  if (!influencer) {
    return Response.json({ error: "Missing influencer" }, { status: 400 });
  }

  const store = getStore("live-notify");

  if (req.method === "GET") {
    const phone = url.searchParams.get("phone") || "";
    if (!phone) {
      return Response.json({ subscribed: false });
    }
    const key = `notify_${influencer}_${phone.replace(/\D/g, "")}`;
    const data = await store.get(key, { type: "json" });
    return Response.json({ subscribed: !!data });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const phone = (body.phone || "").replace(/\D/g, "");
    const nickname = body.nickname || "";

    if (!phone) {
      return Response.json({ success: false, error: "전화번호가 필요합니다." });
    }

    const key = `notify_${influencer}_${phone}`;
    await store.setJSON(key, {
      phone,
      nickname,
      influencer,
      subscribedAt: new Date().toISOString(),
    });

    return Response.json({ success: true });
  }

  if (req.method === "DELETE") {
    const body = await req.json();
    const phone = (body.phone || "").replace(/\D/g, "");
    if (phone) {
      const key = `notify_${influencer}_${phone}`;
      await store.delete(key);
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/live-notify",
};
