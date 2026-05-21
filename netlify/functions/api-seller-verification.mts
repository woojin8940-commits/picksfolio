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
    const existing = ((await store.get(key, { type: "json" })) ?? {}) as Record<string, any>;
    const body = await req.json();

    const merged: Record<string, any> = { ...existing };

    if (body.business !== undefined) {
      merged.business = body.business;
      const b = body.business;
      if (b && b.company_name && b.business_number && b.representative_name && b.contact_phone) {
        merged.business_verified = true;
      }
    }

    if (body.settlement !== undefined) {
      merged.settlement = body.settlement;
      const s = body.settlement;
      if (s && s.bank_name && s.account_number && s.account_holder) {
        merged.settlement_registered = true;
      }
    }

    if (body.membership_active !== undefined) {
      merged.membership_active = body.membership_active;
    }

    merged.updatedAt = new Date().toISOString();

    await store.setJSON(key, merged);
    const enriched = applyComplimentaryMembership(username, merged as any);
    return Response.json({ success: true, data: enriched });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/seller-verification/:username",
};
