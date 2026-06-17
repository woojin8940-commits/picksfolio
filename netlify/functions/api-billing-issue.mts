import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import {
  chargeMembershipMonthly,
  addOneMonth,
  normalizeTier,
  type MembershipBillingEntry,
} from "./_shared/membership-billing.mts";
import { issueTossBillingKey } from "./_shared/toss-payments.mts";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { username, tier } = body;
    const provider = String(body?.provider || "").trim().toLowerCase();
    const isToss = provider === "toss";

    if (!username || !tier) {
      return Response.json(
        { success: false, error: "username, tier는 필수입니다." },
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

    // Resolve the billing key. 토스페이먼츠(카드)는 requestBillingAuth 후 받은
    // authKey·customerKey 를 서버에서 빌링키로 교환한다. 토스페이/카카오페이는 PortOne
    // 브라우저 SDK 가 발급한 billingKey 를 그대로 받는다.
    let billingKey = String(body?.billingKey || "").trim();
    const tossCustomerKey = String(body?.customerKey || "").trim();
    if (isToss) {
      const authKey = String(body?.authKey || "").trim();
      if (!authKey || !tossCustomerKey) {
        return Response.json(
          { success: false, error: "토스페이먼츠 결제 정보(authKey)가 필요합니다." },
          { status: 400 },
        );
      }
      const issued = await issueTossBillingKey(authKey, tossCustomerKey);
      if (!issued.ok || !issued.billingKey) {
        return Response.json(
          { success: false, error: issued.error || "토스페이먼츠 빌링키 발급에 실패했습니다." },
          { status: 402 },
        );
      }
      billingKey = issued.billingKey;
    }

    if (!billingKey) {
      return Response.json(
        { success: false, error: "billingKey는 필수입니다." },
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
    const charge = await chargeMembershipMonthly(
      username,
      billingKey,
      normalizedTier,
      isToss ? "toss" : "portone",
      isToss ? tossCustomerKey : null,
    );
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
      // Which provider backs this billing key, so the recurring scheduler charges it
      // correctly. TossPayments billing also needs the customerKey on every charge.
      billing_provider: isToss ? "toss" : "portone",
      toss_customer_key: isToss ? tossCustomerKey : (existing?.toss_customer_key ?? null),
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
