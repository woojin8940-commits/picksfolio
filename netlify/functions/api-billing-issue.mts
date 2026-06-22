import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import {
  chargeMembershipMonthly,
  addOneMonth,
  normalizeTier,
  TIER_PRICE_KRW,
  type MembershipBillingEntry,
} from "./_shared/membership-billing.mts";
import { issueTossBillingKey } from "./_shared/toss-payments.mts";

const PORTONE_API_BASE = "https://api.portone.io";

// 카드(신용카드) 단건 결제를 서버에서 검증한다. 빌링키 발급(본인인증 필요) 대신, 클로드 플랜과
// 동일한 단건 결제(requestPayment)로 받은 paymentId 가 실제로 결제 완료(PAID)됐고 금액·통화가
// 멤버십 가격과 일치하는지 PortOne V2 결제 조회로 확인한다. (V2 API 시크릿은 서버 전용)
async function verifyPortOneOneTime(
  paymentId: string,
  expectedKrw: number,
): Promise<{ ok: boolean; error?: string }> {
  const apiSecret = process.env.PORTONE_V2_API_SECRET;
  if (!apiSecret) return { ok: false, error: "PORTONE_V2_API_SECRET 환경 변수가 설정되지 않았습니다." };

  let res: Response;
  try {
    res = await fetch(`${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      method: "GET",
      headers: { Authorization: `PortOne ${apiSecret}` },
    });
  } catch {
    return { ok: false, error: "PortOne 결제 조회에 실패했습니다." };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `PortOne 결제 조회 실패 (${res.status}): ${detail.slice(0, 200)}` };
  }
  const payment = (await res.json()) as {
    status?: string;
    amount?: { total?: number; paid?: number };
    currency?: string;
  };
  if (payment.status !== "PAID") {
    return { ok: false, error: `결제가 완료되지 않았습니다. (상태: ${payment.status || "UNKNOWN"})` };
  }
  const paid = payment.amount?.total ?? payment.amount?.paid ?? 0;
  if (paid !== expectedKrw) {
    return { ok: false, error: `결제 금액이 일치하지 않습니다. (기대: ${expectedKrw}, 실제: ${paid})` };
  }
  if (payment.currency && payment.currency !== "KRW") {
    return { ok: false, error: `통화가 일치하지 않습니다. (${payment.currency})` };
  }
  return { ok: true };
}

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

    const store = getStore("seller-verification");
    const key = `seller_${username.toLowerCase()}`;

    // ── 카드(신용카드) 단건 결제 경로 ──
    // billingKey 없이 paymentId 로 들어오면(=토스 제외) 빌링키 정기결제가 아니라 단건 결제다.
    // 본인인증을 강제하는 카드 빌링키 발급 대신, 클로드 플랜과 같은 단건 결제로 첫 달을 즉시
    // 결제한 것이다. 결제를 검증한 뒤 빌링키 없이 멤버십을 활성화한다. 카드 단건은 자동 정기결제
    // 대상이 아니므로(스케줄러는 billing_key 없는 레코드를 건너뛴다) next_billing_date 를 비운다.
    const oneTimePaymentId = !isToss && !body?.billingKey ? String(body?.paymentId || "").trim() : "";
    if (oneTimePaymentId) {
      const expectedKrw = TIER_PRICE_KRW[normalizedTier];
      const verified = await verifyPortOneOneTime(oneTimePaymentId, expectedKrw);
      if (!verified.ok) {
        return Response.json(
          { success: false, error: verified.error || "결제 검증에 실패했습니다." },
          { status: 402 },
        );
      }

      const existing = (await store.get(key, { type: "json" })) as Record<string, any> | null;
      const now = new Date().toISOString();
      const billingEntry: MembershipBillingEntry = {
        at: now,
        tier: normalizedTier,
        amountKrw: expectedKrw,
        kind: "initial",
        success: true,
        paymentId: oneTimePaymentId,
      };
      const history = Array.isArray(existing?.billing_history) ? existing!.billing_history : [];

      const updated = {
        ...(existing || {}),
        membership_active: true,
        membership_plan: normalizedTier,
        membership_started_at: existing?.membership_started_at || now,
        // 단건 결제이므로 빌링키를 저장하지 않는다 → 자동 정기결제 스케줄러가 건너뛴다.
        billing_key: null,
        billing_provider: "portone-onetime",
        membership_amount_krw: expectedKrw,
        membership_payment_method: "card",
        last_billing_at: now,
        next_billing_date: null,
        billing_failures: 0,
        billing_history: [billingEntry, ...history].slice(0, 50),
        updated_at: now,
      };

      await store.setJSON(key, updated);
      return Response.json({ success: true, data: updated });
    }

    // ── 빌링키(정기결제) 경로 ── 토스페이먼츠(카드) / 토스페이 / 카카오페이 ──
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
