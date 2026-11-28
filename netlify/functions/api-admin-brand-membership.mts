import type { Config } from "@netlify/functions";
import { requireOperator } from "./_shared/manager-auth.mts";
import { findProfileByUsername } from "./_shared/user-auth.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { activeBrandTier, readSeatRecord } from "./_shared/brand-seats.mts";
import { brandQuotaStatus } from "./_shared/brand-quota.mts";
import { addMonths, isBrandPlanTier } from "./_shared/membership-billing.mts";

/**
 * 운영자가 브랜드 멤버십을 결제 없이 부여 · 회수한다(테스트 계정, 엔터프라이즈 계약, 보상 등).
 *
 *   GET  ?company=  지금 멤버십 · 이번 달 한도 · 별도 한도
 *   POST { company, tier: 'brand_campaign' | 'brand_growth' | null, months?, override? }
 *        tier 를 주면 결제 없이 그 등급을 켠다(다음 결제일 = 지금 + months, 기본 1개월).
 *        tier 가 null 이면 운영자 부여 멤버십을 끈다(결제로 구독 중인 계정은 건드리지 않는다).
 *        override { campaigns, selected } 는 등급 한도에 더하는 별도 한도(엔터프라이즈 협의용).
 *
 * 결제 수단(billing_key)이 없는 레코드는 정기결제 작업이 결제를 건너뛰므로 청구되지 않는다.
 * 결제로 구독 중인 계정(billing_key 있음)은 등급을 바꾸지 않는다 — 다음 결제 때 그 등급으로
 * 청구되기 때문이다. 별도 한도만 바꿀 수 있다.
 */

const STORE = "seller-verification";
const cleanCompany = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/^biz\//, "");
const intOf = (v: unknown) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 0;
};

async function view(company: string) {
  const record = await readSeatRecord(company);
  const quota = await brandQuotaStatus(company).catch(() => null);
  return {
    company,
    exists: !!record,
    tier: activeBrandTier(record),
    paid: !!record?.billing_key,
    grantedByOperator: record?.membership_source === "operator_grant",
    nextBillingDate: record?.next_billing_date || null,
    override: {
      campaigns: intOf(record?.brand_quota_override?.campaigns),
      selected: intOf(record?.brand_quota_override?.selected),
    },
    quota,
  };
}

export default async (req: Request) => {
  const operator = await requireOperator(req);
  if (!operator.ok) return operator.response;

  if (req.method === "GET") {
    const company = cleanCompany(new URL(req.url).searchParams.get("company"));
    if (!company) return Response.json({ error: "브랜드 아이디를 입력해 주세요." }, { status: 400 });
    return Response.json({ success: true, ...(await view(company)) });
  }

  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const company = cleanCompany(body.company);
  if (!company) return Response.json({ error: "브랜드 아이디를 입력해 주세요." }, { status: 400 });
  const tierRaw = body.tier === null || body.tier === "" ? null : String(body.tier || "");
  if (tierRaw !== null && !isBrandPlanTier(tierRaw)) {
    return Response.json({ error: "등급을 확인해 주세요." }, { status: 400 });
  }
  const months = Math.min(24, Math.max(1, intOf(body.months) || 1));
  const override = body.override && typeof body.override === "object"
    ? { campaigns: intOf(body.override.campaigns), selected: intOf(body.override.selected) }
    : null;

  // 한 번도 결제하지 않은 브랜드는 멤버십 레코드가 없다. 비즈니스 계정(role = operator)이 맞으면 새로 만든다.
  const existing = await readSeatRecord(company);
  if (!existing) {
    const profile = await findProfileByUsername(company);
    if (profile === null) return Response.json({ error: "계정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 503 });
    if (!profile.found || profile.role.toLowerCase() !== "operator") {
      return Response.json({ error: "브랜드(비즈니스) 계정을 찾을 수 없어요. 아이디를 확인해 주세요." }, { status: 404 });
    }
  }
  let blocked = "";
  await mutateBlobJSON<Record<string, any>>(STORE, `seller_${company}`, (current) => {
    const latest: Record<string, any> = current || { username: company, created_at: new Date().toISOString() };
    blocked = "";
    const at = new Date().toISOString();
    const next: Record<string, any> = { ...latest, updated_at: at };
    if (override) next.brand_quota_override = override;
    if (body.tier !== undefined) {
      if (latest.billing_key && latest.membership_active) {
        blocked = "결제로 구독 중인 계정은 등급을 바꿀 수 없어요. 별도 한도만 바꿀 수 있습니다.";
      } else if (tierRaw) {
        Object.assign(next, {
          membership_active: true,
          membership_plan: tierRaw,
          membership_plan_scheduled: null,
          membership_source: "operator_grant",
          membership_granted_by: operator.username,
          membership_started_at: latest.membership_active ? latest.membership_started_at || at : at,
          next_billing_date: addMonths(at, months),
          membership_cancel_at_period_end: false,
          membership_ends_at: null,
          billing_failures: 0,
        });
      } else if (latest.membership_source === "operator_grant") {
        Object.assign(next, {
          membership_active: false,
          next_billing_date: null,
          membership_ended_at: at,
        });
      }
    }
    return blocked && !override ? null : next;
  });
  if (blocked && !override) return Response.json({ error: blocked }, { status: 409 });
  return Response.json({ success: true, notice: blocked || undefined, ...(await view(company)) });
};

export const config: Config = {
  path: "/api/admin/brand-membership",
};
