import type { Config } from "@netlify/functions";
import {
  checkPromoCode,
  normalizePromoCode,
  PROMO_CODE_LENGTH,
} from "./_shared/membership-promo.mts";
import { addMonths, TIER_LABEL, TIER_PRICE_KRW } from "./_shared/membership-billing.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";

/**
 * 출시 혜택 코드 확인 — 결제창에서 카드 정보를 넣기 전에 "이 코드가 무엇을 주는지"를
 * 먼저 보여주기 위한 조회다. 여기서 코드가 소진되지는 않는다(등록은 /api/billing-issue
 * 가 카드 등록까지 성공한 뒤에 처리한다).
 *
 * 9자리 숫자는 훑어서 맞힐 수 있는 크기이므로 로그인한 본인만 호출할 수 있게 하고,
 * 계정 · IP 양쪽으로 시도 횟수를 제한한다.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json().catch(() => ({} as any));
    const username = String(body?.username || "").trim();
    if (!username) {
      return Response.json({ success: false, error: "username은 필수입니다." }, { status: 400 });
    }

    const auth = await requireAccountOwner(req, username);
    if (!auth.ok) return auth.response;

    const code = normalizePromoCode(body?.code);
    if (code.length !== PROMO_CODE_LENGTH) {
      return Response.json(
        { success: false, error: `코드는 ${PROMO_CODE_LENGTH}자리 숫자입니다.` },
        { status: 400 },
      );
    }

    for (const limit of [
      { bucket: "promo-check-user", key: auth.username || username.toLowerCase() },
      { bucket: "promo-check-ip", key: clientIp(req) },
    ]) {
      const limited = await checkRateLimit({
        ...limit,
        limit: 20,
        windowSeconds: 3600,
        message: "코드 확인을 너무 많이 시도했습니다. 잠시 후 다시 시도해 주세요.",
      });
      if (!limited.ok) return limited.response;
    }

    const check = await checkPromoCode(code, username);
    if (!check.ok) {
      return Response.json({ success: false, error: check.error }, { status: 200 });
    }

    const { plan, freeMonths } = check.info;
    return Response.json({
      success: true,
      promo: {
        plan,
        planLabel: TIER_LABEL[plan],
        freeMonths,
        // 지금 등록하면 무료 기간이 끝나는 날(= 첫 정상 결제일). 실제 날짜는 등록 시점에
        // 서버가 다시 계산하므로 여기 값은 안내용이다.
        freeUntil: addMonths(new Date().toISOString(), freeMonths),
        monthlyPriceKrw: TIER_PRICE_KRW[plan],
      },
    });
  } catch (err: any) {
    return Response.json(
      { success: false, error: err?.message || "코드 확인에 실패했습니다." },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/membership-promo",
};
