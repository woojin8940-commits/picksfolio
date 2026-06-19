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
      // 자동 승인하지 않는다. 사업자등록증 이미지를 받아 관리자가 수동으로 심사·수락한다.
      // 제출이 들어오면 인증을 해제하고 심사 대기(pending) 상태로 둔다. 관리자가 수락해야
      // business_verified 가 true 가 되어 라이브 송출이 가능해진다.
      if (b && b.company_name && b.business_number && b.representative_name && b.contact_phone) {
        merged.business_verified = false;
        merged.business_review_status = "pending";
        merged.business_review_reason = "";
        merged.business_submitted_at = new Date().toISOString();
        merged.business_reviewed_at = null;
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
