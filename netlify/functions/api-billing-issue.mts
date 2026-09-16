import type { Config } from "@netlify/functions";
import {
  chargeMembershipBillingKey,
  addOneMonth,
  normalizeTier,
  issueNiceCardBillingKey,
  TIER_PRICE_KRW,
  type MembershipBillingEntry,
} from "./_shared/membership-billing.mts";
import {
  checkPromoCode,
  normalizePromoCode,
  redeemPromoCode,
  releasePromoRedemption,
} from "./_shared/membership-promo.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";
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

    if (!username || !tier) {
      return Response.json(
        { success: false, error: "username, tier는 필수입니다." },
        { status: 400 },
      );
    }

    // 남의 아이디로 호출하면 그 사람의 빌링키가 내 것으로 덮어써진다
    // (= 이후 자동결제가 내 카드로 나간다).
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

    // ── 출시 혜택 코드(선택) ──
    // 코드를 함께 보내면 첫 달 결제를 건너뛰고 첫 청구일을 무료 기간만큼 뒤로 미룬다.
    // 카드(빌링키) 등록은 그대로 진행한다 — 무료 기간이 끝나는 날 정기결제 스케줄러가
    // 평소처럼 청구해야 하므로 결제수단이 없으면 혜택이 끝나는 순간 구독이 끊긴다.
    // 청구 금액·플랜은 코드에 적힌 값(출시 혜택 = 프로 플랜)을 따른다.
    const promoCode = normalizePromoCode(body?.promoCode);
    if (promoCode) {
      // 9자리 숫자 코드는 훑어서 맞힐 수 있는 크기다. 코드를 넣은 요청만 횟수를 제한해
      // 정상 구독 경로는 건드리지 않는다(계정 · IP 양쪽으로 센다).
      for (const limit of [
        { bucket: "promo-redeem-user", key: auth.username || String(username).toLowerCase() },
        { bucket: "promo-redeem-ip", key: clientIp(req) },
      ]) {
        const limited = await checkRateLimit({
          ...limit,
          limit: 10,
          windowSeconds: 3600,
          message: "코드 확인을 너무 많이 시도했습니다. 잠시 후 다시 시도해 주세요.",
        });
        if (!limited.ok) return limited.response;
      }

      // 카드 등록 전에 먼저 걸러낸다 — 쓸 수 없는 코드인데 카드까지 등록해 두면
      // 사용자는 무료로 시작한 줄 알고 결제창을 닫는다. 실제 플랜·기간은 등록 시점에
      // 코드에 적힌 값을 그대로 쓴다(요청의 tier 는 따르지 않는다).
      const check = await checkPromoCode(promoCode, username);
      if (!check.ok) {
        return Response.json({ success: false, error: check.error }, { status: 400 });
      }
    }

    // ── 빌링키(정기결제) 발급 경로 ──
    // 멤버십은 모두 정기결제(매월 자동결제)로 동작한다. 결제수단별로 빌링키를 확보한다:
    //   • 카드(나이스정보통신) — 멤버십 카드 결제의 기본 경로: 브라우저 SDK 로는 카드 빌링키를
    //     발급할 수 없어(NICE V2 는 결제창 빌링키 발급을 간편결제만 지원) 카드 정보를 받아
    //     서버에서 수기(키인) `POST /billing-keys` 로 빌링키를 발급한다. 카드 정보는 저장하지
    //     않고 PortOne 으로만 전달하며, 이후 매월 청구는 발급된 빌링키로만 한다.
    //   • 카카오페이: 브라우저 SDK(결제창)가 발급한 billingKey 를 그대로 받는다.
    let billingKey = String(body?.billingKey || "").trim();
    const cardCredential =
      !billingKey && body?.card && typeof body.card === "object" ? body.card : null;

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
    }

    if (!billingKey) {
      return Response.json(
        { success: false, error: "billingKey는 필수입니다." },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    // ── 출시 혜택으로 시작하는 구독 ──
    // 코드를 소진시키는 것은 빌링키를 확보한 뒤다. 순서를 반대로 두면 카드 등록이
    // 실패했을 때 계정당 한 번인 혜택이 그냥 사라진다.
    if (promoCode) {
      const redeemed = await redeemPromoCode({
        code: promoCode,
        username: String(username),
        authUserId: auth.userId,
      });
      if (!redeemed.ok) {
        return Response.json({ success: false, error: redeemed.error }, { status: 400 });
      }

      const { freeUntil, freeMonths, plan } = redeemed.redemption;
      // 청구가 없었던 첫 기록. 금액 0 으로 남겨 두면 무료로 시작한 구독임이 이력에 남는다.
      const promoEntry: MembershipBillingEntry = {
        at: now,
        tier: plan,
        amountKrw: 0,
        kind: "promo",
        success: true,
      };

      try {
        const updated = (await mutateBlobJSON<Record<string, any>>(STORE, key, (current) => {
          const history = Array.isArray(current?.billing_history) ? current!.billing_history : [];

          return {
            ...(current || {}),
            membership_active: true,
            membership_plan: plan,
            membership_started_at: current?.membership_started_at || now,
            // 무료 기간이 끝난 뒤 실제로 청구될 금액.
            membership_amount_krw: TIER_PRICE_KRW[plan],
            membership_payment_method: cardCredential ? "card" : "easypay",
            membership_cancel_at_period_end: false,
            membership_canceled_at: null,
            membership_ends_at: null,
            membership_ended_at: null,
            // 출시 혜택 흔적 — 화면에서 "언제까지 무료인지" 안내하는 데 쓴다.
            membership_promo_code: promoCode,
            membership_promo_free_months: freeMonths,
            membership_promo_free_until: freeUntil,
            membership_promo_redeemed_at: now,
            // 첫 청구일만 무료 기간만큼 미룬다. 정기결제 스케줄러가 이 날짜를 보고
            // 그날 처음 청구하고, 이후에는 한 달씩 갱신한다 — 별도 만료 처리가 없다.
            next_billing_date: freeUntil,
            last_billing_at: null,
            billing_failures: 0,
            billing_key: billingKey,
            billing_provider: "portone",
            billing_key_issued_at: now,
            billing_history: [promoEntry, ...history].slice(0, 50),
            updated_at: now,
          };
        })) as Record<string, any>;

        return Response.json({
          success: true,
          promo: { code: promoCode, freeMonths, freeUntil, plan },
          data: redactSellerRecord(updated),
        });
      } catch (writeErr) {
        // 구독을 켜지 못했으면 혜택도 쓰지 않은 것으로 되돌린다.
        await releasePromoRedemption(String(username)).catch(() => {});
        throw writeErr;
      }
    }

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
        // 어떤 수단으로 등록한 정기결제인지(화면 안내용).
        // card = 카드 수기(키인) 빌링키, easypay = 간편결제(카카오페이) 빌링키.
        membership_payment_method: cardCredential ? "card" : "easypay",
        // 해지 예약이 걸린 상태에서 다시 구독(또는 업그레이드)하면 예약을 풀어
        // 정기결제를 되살린다 — 아니면 다음 결제일에 방금 산 구독이 종료된다.
        membership_cancel_at_period_end: false,
        membership_canceled_at: null,
        membership_ends_at: null,
        membership_ended_at: null,
        last_billing_at: now,
        next_billing_date: addOneMonth(now),
        billing_failures: 0,
        billing_key: billingKey,
        // 빌링키를 발급한 PG — 결제는 모두 포트원을 거친다(카드 = 나이스정보통신, 간편결제 =
        // 카카오페이). 정기결제 스케줄러가 이 값을 보고 청구한다.
        billing_provider: "portone",
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
