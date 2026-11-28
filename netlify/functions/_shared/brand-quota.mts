/**
 * 브랜드 멤버십 월 한도 — 캠페인 건수와 선정 인플루언서 수.
 *
 *   · 캠페인 1건: 담당자가 그 캠페인의 리스트업을 처음 올릴 때 차감
 *   · 선정 1명: 브랜드가 고르고 담당자가 협의해 진행이 확정될 때(연락처 공개) 차감
 *
 * 한도 = 등급 한도(라이트 2건 · 20명, 그로스 5건 · 50명) + 이번 결제 주기에 추가 구매한 것
 *        + 운영자가 레코드에 적어 둔 별도 한도(brand_quota_override, 엔터프라이즈 협의용).
 * 결제 주기(다음 결제일 한 달 전 ~ 다음 결제일)마다 다시 채워지고 남은 것은 넘어가지 않는다.
 *
 * 차감은 우리 비용(담당자 시간)이 실제로 드는 지점에서만 한다. 같은 캠페인 · 같은 후보는
 * 한 번만 센다(brand_quota_usage 의 유일 키).
 *
 * BRAND_QUOTA_ENFORCED=false 면 사용량만 기록하고 막지는 않는다(도입 초기 안전장치).
 */
import { getDatabase } from "@picks/netlify-database";
import { addMonths, BRAND_PLAN_LIMITS, type BrandPlanTier } from "./membership-billing.mts";
import { activeBrandTier, readSeatRecord } from "./brand-seats.mts";

type Kind = "campaign" | "selected";

const enforced = () => (Netlify.env.get("BRAND_QUOTA_ENFORCED") || "").toLowerCase() !== "false";

const intOf = (v: unknown) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** 지금 결제 주기. 다음 결제일이 없으면(운영자 부여 등) 이번 달 1일부터. */
export const currentCycle = (record: Record<string, any> | null, now = new Date()) => {
  const next = record?.next_billing_date ? Date.parse(record.next_billing_date) : NaN;
  if (Number.isFinite(next) && next > now.getTime()) {
    return { start: addMonths(new Date(next).toISOString(), -1), end: new Date(next).toISOString() };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
};

export interface BrandQuotaStatus {
  tier: BrandPlanTier | null;
  enforced: boolean;
  cycle: { start: string; end: string };
  limits: { campaigns: number; selected: number };
  addons: { campaigns: number; selected: number };
  used: { campaigns: number; selected: number };
  remaining: { campaigns: number; selected: number };
}

export async function brandQuotaStatus(company: string): Promise<BrandQuotaStatus> {
  const record = await readSeatRecord(company);
  const tier = activeBrandTier(record);
  const cycle = currentCycle(record);
  const base = tier ? BRAND_PLAN_LIMITS[tier] : { campaigns: 0, selected: 0 };
  const override = record?.brand_quota_override || {};
  const addons = { campaigns: 0, selected: 0 };
  for (const a of Array.isArray(record?.membership_addons) ? record!.membership_addons : []) {
    // 이번 주기에 산 것만(산 시각이 주기 안, 또는 until 이 이번 주기 끝).
    const at = Date.parse(a?.at || "");
    if (!Number.isFinite(at) || at < Date.parse(cycle.start)) continue;
    if (a?.kind === "campaign") addons.campaigns += intOf(a.qty);
    if (a?.kind === "selected") addons.selected += intOf(a.qty);
  }
  const limits = {
    campaigns: base.campaigns + intOf(override.campaigns),
    selected: base.selected + intOf(override.selected),
  };
  const rows = (await getDatabase().sql`
    SELECT kind, COUNT(*)::int AS n
    FROM brand_quota_usage
    WHERE company_username = ${company} AND created_at >= ${cycle.start}
    GROUP BY kind
  `) as any[];
  const used = { campaigns: 0, selected: 0 };
  for (const r of rows) {
    if (r.kind === "campaign") used.campaigns = Number(r.n || 0);
    if (r.kind === "selected") used.selected = Number(r.n || 0);
  }
  return {
    tier,
    enforced: enforced(),
    cycle,
    limits,
    addons,
    used,
    remaining: {
      campaigns: Math.max(0, limits.campaigns + addons.campaigns - used.campaigns),
      selected: Math.max(0, limits.selected + addons.selected - used.selected),
    },
  };
}

export type ReserveResult = { ok: true } | { ok: false; status: number; error: string; code: string };

const cleanCompany = (company: string) => String(company || "").trim().toLowerCase().replace(/^biz\//, "");

/**
 * 한도가 남았는지 본다(쓰지는 않는다). 이미 센 캠페인 · 후보면 다시 세지 않으므로 통과한다.
 * 회사가 없는 캠페인(브랜드 계정 없이 담당자가 만든 것)은 세지 않는다. 작업이 끝난 뒤
 * recordQuota 로 실제로 차감한다 — 중간에 실패한 작업이 한도를 먹지 않게.
 */
async function check(company: string, kind: Kind, refId: string): Promise<ReserveResult> {
  const clean = cleanCompany(company);
  if (!clean || !refId) return { ok: true };
  const sql = getDatabase().sql;
  let existing: any[];
  try {
    existing = (await sql`
      SELECT 1 FROM brand_quota_usage
      WHERE company_username = ${clean} AND kind = ${kind} AND ref_id = ${refId} LIMIT 1
    `) as any[];
  } catch (e) {
    // 표가 아직 없는 환경(마이그레이션 전)은 막지 않는다.
    if ((e as { code?: string })?.code === "42P01") return { ok: true };
    throw e;
  }
  if (existing.length) return { ok: true };
  const status = await brandQuotaStatus(clean);
  const left = kind === "campaign" ? status.remaining.campaigns : status.remaining.selected;
  if (left > 0 || !status.enforced) return { ok: true };
  if (!status.tier) {
    return {
      ok: false,
      status: 402,
      code: "BRAND_PLAN_REQUIRED",
      error: "이 브랜드는 멤버십을 구독하지 않았어요. 브랜드가 멤버십을 구독한 뒤에 진행할 수 있습니다.",
    };
  }
  return {
    ok: false,
    status: 402,
    code: kind === "campaign" ? "CAMPAIGN_QUOTA_EXCEEDED" : "SELECTED_QUOTA_EXCEEDED",
    error:
      kind === "campaign"
        ? "이 브랜드는 이번 달 캠페인 한도를 다 썼어요. 브랜드가 캠페인을 추가 구매하거나 등급을 올린 뒤에 리스트업할 수 있습니다."
        : "이 브랜드는 이번 달 선정 인플루언서 한도를 다 썼어요. 브랜드가 인원을 추가 구매하거나 등급을 올린 뒤에 진행을 확정할 수 있습니다.",
  };
}

async function record(company: string, kind: Kind, refId: string): Promise<void> {
  const clean = cleanCompany(company);
  if (!clean || !refId) return;
  try {
    await getDatabase().sql`
      INSERT INTO brand_quota_usage (company_username, kind, ref_id)
      VALUES (${clean}, ${kind}, ${refId})
      ON CONFLICT (company_username, kind, ref_id) DO NOTHING
    `;
  } catch (e) {
    if ((e as { code?: string })?.code !== "42P01") console.error("[brand-quota] record failed:", (e as Error)?.message);
  }
}

/** 캠페인 리스트업을 처음 올릴 때(캠페인 1건). */
export const checkCampaignQuota = (company: string, campaignId: string) => check(company, "campaign", campaignId);
export const recordCampaignQuota = (company: string, campaignId: string) => record(company, "campaign", campaignId);

/** 진행 확정 · 연락처 공개 때(선정 1명). ref 는 리스트업 행 id. */
export const checkSelectedQuota = (company: string, listupId: string) => check(company, "selected", listupId);
export const recordSelectedQuota = (company: string, listupId: string) => record(company, "selected", listupId);
