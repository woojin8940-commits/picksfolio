import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import {
  chargeMembershipBillingKey,
  addOneMonth,
  normalizeTier,
  type MembershipBillingEntry,
} from "./_shared/membership-billing.mts";

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

    const normalizedTier = normalizeTier(tier);
    if (!normalizedTier) {
      return Response.json(
        { success: false, error: "유효하지 않은 멤버십 플랜입니다." },
        { status: 400 },
      );
    }

    const store = getStore("seller-verification");
    const key = `seller_${username.toLowerCase()}`;
    const existing = (await store.get(key, { type: "json" })) as Record<string, any> | null;

    // Charge the first month immediately against the freshly issued billing key.
    // This anchors the anniversary billing day — every subsequent monthly charge
    // is scheduled relative to this first successful payment. If the first charge
    // fails the subscription is NOT activated; the member is asked to retry.
    const charge = await chargeMembershipBillingKey(username, billingKey, normalizedTier);
    if (!charge.success) {
      return Response.json(
        { success: false, error: charge.error || "첫 결제에 실패했습니다. 카드 정보를 확인해 주세요." },
        { status: 402 },
      );
    }

    const now = new Date().toISOString();
    const billingEntry: MembershipBillingEntry = {
      at: now,
      tier: normalizedTier,
      amountKrw: charge.amountKrw || 0,
      kind: "initial",
      success: true,
      paymentId: charge.paymentId,
    };
    const history = Array.isArray(existing?.billing_history) ? existing!.billing_history : [];

    const updated = {
      ...(existing || {}),
      membership_active: true,
      membership_plan: normalizedTier,
      membership_started_at: existing?.membership_started_at || now,
      billing_key: billingKey,
      billing_key_issued_at: now,
      // Recurring billing state: the next charge is due one month from this first
      // payment, and the daily scheduler advances it from there.
      membership_amount_krw: charge.amountKrw,
      last_billing_at: now,
      next_billing_date: addOneMonth(now),
      billing_failures: 0,
      billing_history: [billingEntry, ...history].slice(0, 50),
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
