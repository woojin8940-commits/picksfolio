import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { checkRateLimit } from "./_shared/rate-limit.mts";
import { redactSellerRecord } from "./_shared/seller-record.mts";
import {
  ADDON_SELECTED_PRICE_KRW,
  ADDON_SELECTED_UNIT,
  BRAND_PLAN_INCLUDED_SEATS,
  BRAND_PLAN_LIMITS,
  BRAND_PLAN_PRICE_KRW,
  BRAND_SEAT_PRICE_KRW,
  isBrandPlanTier,
} from "./_shared/membership-billing.mts";
import {
  activeBrandTier,
  purchaseAddon,
  readSeatRecord,
  scheduleBrandPlan,
  seatPlanSummary,
  settleStaleSeatCharge,
  upgradeBrandPlan,
} from "./_shared/brand-seats.mts";
import { brandQuotaStatus } from "./_shared/brand-quota.mts";
import { usedSeats } from "./_shared/brand-team.mts";

/**
 * 브랜드 멤버십 등급 · 이번 달 한도.
 *
 *   · overview   등급 · 다음 결제 · 이번 달 캠페인 / 선정 인플루언서 사용량 (회사 계정 누구나)
 *   · upgrade    라이트 → 그로스, 차액을 남은 기간만큼 바로 결제 (회사 관리자)
 *   · schedule   그로스 → 라이트를 다음 결제일부터(예약) · 예약 취소 (회사 관리자)
 *   · addon      캠페인 1건 · 선정 인플루언서 10명 묶음 추가 구매, 이번 주기만 (회사 관리자)
 */

const fail = (status: number, error: string) => Response.json({ success: false, error }, { status });

const catalog = () => ({
  tiers: (["brand_campaign", "brand_growth"] as const).map((tier) => ({
    tier,
    priceKrw: BRAND_PLAN_PRICE_KRW[tier],
    includedSeats: BRAND_PLAN_INCLUDED_SEATS[tier],
    campaigns: BRAND_PLAN_LIMITS[tier].campaigns,
    selected: BRAND_PLAN_LIMITS[tier].selected,
  })),
  seatPriceKrw: BRAND_SEAT_PRICE_KRW,
  addons: {
    selected: { unit: ADDON_SELECTED_UNIT, priceKrw: ADDON_SELECTED_PRICE_KRW },
  },
});

async function overview(company: string) {
  await settleStaleSeatCharge(company).catch(() => "busy");
  const record = await readSeatRecord(company);
  let quota = null;
  try {
    quota = await brandQuotaStatus(company);
  } catch (e) {
    console.error("[api-brand-plan] quota failed:", (e as Error)?.message);
  }
  return { plan: seatPlanSummary(record), quota, catalog: catalog() };
}

export default async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, "요청을 읽지 못했습니다.");
  }
  const action = String(body?.action || "overview");
  try {
    const auth = await requireSignedInUser(req);
    if (!auth.ok) return auth.response;
    if (!auth.teamRole || !auth.username) return fail(403, "브랜드 계정에서만 이용할 수 있어요.");
    const company = auth.username;

    if (action === "overview") {
      return Response.json({ success: true, viewer: { teamRole: auth.teamRole }, ...(await overview(company)) });
    }

    if (auth.teamRole !== "owner") return fail(403, "결제와 등급 변경은 회사 관리자 계정에서만 할 수 있어요.");

    if (action === "upgrade" || action === "addon") {
      const limited = await checkRateLimit({
        bucket: "brand-plan-charge",
        key: company,
        limit: 10,
        windowSeconds: 3600,
        message: "결제를 너무 많이 시도했습니다. 잠시 후 다시 시도해 주세요.",
      });
      if (!limited.ok) return limited.response;
    }

    if (action === "upgrade") {
      const tier = body?.tier;
      if (!isBrandPlanTier(tier)) return fail(400, "등급을 확인해 주세요.");
      const current = activeBrandTier(await readSeatRecord(company));
      if (current === tier) return fail(409, "이미 이용 중인 등급이에요.");
      const result = await upgradeBrandPlan(company, tier);
      if (!result.ok) return fail(result.status, result.error);
      return Response.json({
        success: true,
        chargedKrw: result.chargedKrw,
        record: redactSellerRecord(result.record),
        ...(await overview(company)),
      });
    }

    if (action === "schedule") {
      const tier = body?.tier;
      if (!isBrandPlanTier(tier)) return fail(400, "등급을 확인해 주세요.");
      const result = await scheduleBrandPlan(company, tier, await usedSeats(company));
      if (!result.ok) return fail(result.status, result.error);
      return Response.json({ success: true, record: redactSellerRecord(result.record), ...(await overview(company)) });
    }

    if (action === "addon") {
      // 추가로 살 수 있는 건 선정 인원뿐이다. 캠페인 건수는 등급을 올려서 늘린다.
      if (body?.kind !== "selected") return fail(400, "캠페인 건수는 추가로 살 수 없어요. 더 필요하면 등급을 올려 주세요.");
      const kind = "selected" as const;
      const result = await purchaseAddon(company, kind, Number(body?.units));
      if (!result.ok) return fail(result.status, result.error);
      return Response.json({
        success: true,
        chargedKrw: result.chargedKrw,
        record: redactSellerRecord(result.record),
        ...(await overview(company)),
      });
    }

    return fail(400, "알 수 없는 요청입니다.");
  } catch (e) {
    console.error("[api-brand-plan] failed:", action, (e as Error)?.message);
    return fail(500, "멤버십 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
};

export const config: Config = {
  path: "/api/brand-plan",
};
