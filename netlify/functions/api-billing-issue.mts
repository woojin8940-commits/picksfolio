import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { username, billingKey, tier } = body;

    if (!username || !billingKey || !tier) {
      return Response.json(
        { success: false, error: "username, billingKey, tier는 필수입니다." },
        { status: 400 },
      );
    }

    if (tier !== "standard" && tier !== "commerce") {
      return Response.json(
        { success: false, error: "유효하지 않은 멤버십 플랜입니다." },
        { status: 400 },
      );
    }

    const store = getStore("seller-verification");
    const key = `seller_${username.toLowerCase()}`;
    const existing = (await store.get(key, { type: "json" })) as Record<string, any> | null;

    const now = new Date().toISOString();
    const updated = {
      ...(existing || {}),
      membership_active: true,
      membership_plan: tier,
      membership_started_at: existing?.membership_started_at || now,
      billing_key: billingKey,
      billing_key_issued_at: now,
      updated_at: now,
    };

    await store.setJSON(key, updated);

    return Response.json({ success: true, data: updated });
  } catch (err: any) {
    return Response.json(
      { success: false, error: err?.message || "빌링 발급 실패" },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/billing-issue",
};
