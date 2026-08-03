import type { Config } from "@netlify/functions";
import {
  chargeMembershipMonthly,
  addOneMonth,
  normalizeTier,
  issueNiceCardBillingKey,
  type MembershipBillingEntry,
} from "./_shared/membership-billing.mts";
import { issueTossBillingKey } from "./_shared/toss-payments.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { redactSellerRecord } from "./_shared/seller-record.mts";

const STORE = "seller-verification";

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

    // 남의 아이디로 호출하면 그 사람의 빌링키가 내 것으로 덮어써지고(=이후 자동결제가
    // 내 카드로 나감) 응답으로 그 사람의 정산 계좌·사업자 정보까지 돌아왔다.
    const auth = await requireAccountOwner(req, String(username));
    if (!auth.ok) return auth.response;

    const normalizedTier = normalizeTier(tier);
    if (!normalizedTier) {
      return Response.json(
        { success: false, error: "유효하지 않은 멤버십 플랜입니다." },
        { status: 400 },
      );
    }

    const key = `seller_${username.toLowerCase()}`;

    // ── 빌링키(정기결제) 발급 경로 ──
    // 멤버십은 모두 정기결제(매월 자동결제)로 동작한다. 결제수단별로 빌링키를 확보한다:
    //   • 카드(나이스정보통신): 브라우저 SDK 로는 카드 빌링키를 발급할 수 없어(NICE V2 는
    //     간편결제만 SDK 지원) 카드 정보를 받아 서버에서 수기(키인) `POST /billing-keys` 로
    //     빌링키를 발급한다. 카드 정보는 저장하지 않고 PortOne 으로만 전달한다.
    //   • 토스페이먼츠(카드): authKey·customerKey 를 서버에서 빌링키로 교환한다.
    //   • 토스페이 / 카카오페이: 브라우저 SDK 가 발급한 billingKey 를 그대로 받는다.
    let billingKey = String(body?.billingKey || "").trim();
    const tossCustomerKey = String(body?.customerKey || "").trim();
    const cardCredential =
      !isToss && !billingKey && body?.card && typeof body.card === "object" ? body.card : null;

    if (cardCredential) {
      const issued = await issueNiceCardBillingKey(username, {
        number: String(cardCredential.number || "").replace(/[\s-]/g, ""),
        expiryYear: String(cardCredential.expiryYear || "").trim(),
        expiryMonth: String(cardCredential.expiryMonth || "").trim(),
        birthOrBusinessRegistrationNumber: String(
          cardCredential.birthOrBusinessRegistrationNumber || "",
        ).trim(),
        passwordTwoDigits: String(cardCredential.passwordTwoDigits || "").trim(),
      });
      if (!issued.ok) {
        return Response.json({ success: false, error: issued.error }, { status: 402 });
      }
      billingKey = issued.billingKey;
    } else if (isToss) {
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

    // 같은 레코드를 정기결제 스케줄러도 고친다. 통째로 덮어쓰면 그 사이 기록된
    // 다음 결제일·결제 이력이 사라질 수 있어 조건부 쓰기로 반영한다.
    const updated = (await mutateBlobJSON<Record<string, any>>(STORE, key, (current) => {
      const history = Array.isArray(current?.billing_history) ? current!.billing_history : [];

      return {
        ...(current || {}),
        membership_active: true,
        membership_plan: normalizedTier,
        membership_started_at: current?.membership_started_at || now,
        membership_amount_krw: charge.amountKrw,
        last_billing_at: now,
        next_billing_date: addOneMonth(now),
        billing_failures: 0,
        billing_key: billingKey,
        // Which provider backs this billing key, so the recurring scheduler charges it
        // correctly. TossPayments billing also needs the customerKey on every charge.
        billing_provider: isToss ? "toss" : "portone",
        toss_customer_key: isToss ? tossCustomerKey : (current?.toss_customer_key ?? null),
        billing_key_issued_at: now,
        billing_history: [billingEntry, ...history].slice(0, 50),
        updated_at: now,
      };
    })) as Record<string, any>;

    return Response.json({ success: true, data: redactSellerRecord(updated) });
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
