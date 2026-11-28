/**
 * 브랜드 멤버십 월 한도 — 캠페인 건수와 선정 인플루언서 수.
 *
 *   · 캠페인 1건: 담당자가 그 캠페인의 리스트업을 처음 올릴 때 차감
 *   · 선정 1명: 브랜드가 고르고 담당자가 협의해 진행이 확정될 때(연락처 공개).
 *     단, 브랜드가 직접 요청한 인플루언서는 캠페인당 2명까지 빼 준다(kind = 'brand_free'). 차감
 *
 * 한도 = 등급 한도(라이트 2건 · 20명, 그로스 5건 · 50명) + 이번 결제 주기에 추가 구매한 선정 인원(캠페인 건수는 사지 않는다)
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

type Kind = "campaign" | "selected" | "brand_free";

/** 브랜드가 직접 요청한 인플루언서는 캠페인당 이만큼까지 선정 한도에서 빼 준다. */
export const FREE_BRAND_REQUESTS_PER_CAMPAIGN = 2;

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
  /** 정기결제가 실패해 결제일이 지난 상태. 다시 결제될 때까지 새 리스트업 · 진행 확정을 막는다. */
  pastDue: boolean;
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
  // 결제일이 지났는데 청구가 실패해 있으면(멤버십은 재시도 동안 켜져 있다) 미납이다.
  const nextDue = record?.next_billing_date ? Date.parse(record.next_billing_date) : NaN;
  const pastDue = !!tier && Number(record?.billing_failures || 0) > 0 && Number.isFinite(nextDue) && nextDue <= Date.now();
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
    pastDue,
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
  if (!status.enforced) return { ok: true };
  if (status.pastDue) {
    return {
      ok: false,
      status: 402,
      code: "BRAND_PAYMENT_PAST_DUE",
      error: "이 브랜드는 멤버십 정기결제가 실패한 상태예요. 결제 수단을 확인해 결제가 다시 되면 진행할 수 있습니다.",
    };
  }
  if (left > 0) return { ok: true };
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
        ? "이 브랜드는 이번 달 캠페인 한도를 다 썼어요. 브랜드가 등급을 올리거나 다음 결제일에 한도가 다시 채워진 뒤에 리스트업할 수 있습니다."
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

/**
 * 캠페인 등록은 멤버십 회원만 한다. 미구독 · 미납이면 막고, 이번 달 캠페인 한도가 남지 않았으면
 * 등록해도 리스트업이 시작될 수 없으니 등록 단계에서 먼저 알린다(추가 구매 · 업그레이드 안내).
 * 등록 자체는 한도를 쓰지 않는다 — 차감은 담당자가 첫 리스트업을 올릴 때 한 번.
 */
export async function checkCampaignRegistration(company: string): Promise<ReserveResult> {
  const clean = cleanCompany(company);
  if (!clean) return { ok: true };
  const status = await brandQuotaStatus(clean);
  if (!status.enforced) return { ok: true };
  if (!status.tier) {
    return {
      ok: false,
      status: 402,
      code: "BRAND_PLAN_REQUIRED",
      error: "캠페인 등록은 멤버십 회원만 할 수 있어요. 멤버십을 구독한 뒤에 다시 등록해 주세요.",
    };
  }
  if (status.pastDue) {
    return {
      ok: false,
      status: 402,
      code: "BRAND_PAYMENT_PAST_DUE",
      error: "멤버십 정기결제가 실패한 상태예요. 결제 수단을 확인해 결제가 다시 되면 캠페인을 등록할 수 있습니다.",
    };
  }
  if (status.remaining.campaigns <= 0) {
    return {
      ok: false,
      status: 402,
      code: "CAMPAIGN_QUOTA_EXCEEDED",
      error: status.tier === "brand_campaign"
        ? "이번 달 캠페인 한도를 다 썼어요. 그로스로 올리면 바로 월 5건까지 등록할 수 있어요."
        : "이번 달 캠페인 한도를 다 썼어요. 다음 결제일에 다시 채워지고, 더 필요하면 엔터프라이즈로 문의해 주세요.",
    };
  }
  return { ok: true };
}

/**
 * 브랜드가 골라 두었지만 아직 선정 한도에 잡히지 않은(진행 확정 전) 후보 수. 이 캠페인은 뺀다 —
 * 화면이 지금 고르고 있는 수를 따로 더한다. 진행 중인 캠페인의, 거절 · 만료 · 이미 수락(확정)되지 않은 후보만 센다.
 */
export async function pendingPicksElsewhere(company: string, excludeCampaignId: string): Promise<number> {
  const clean = cleanCompany(company);
  if (!clean) return 0;
  try {
    const rows = (await getDatabase().sql`
      SELECT COUNT(*)::int AS n
      FROM campaign_listups l
      JOIN campaigns c ON c.id = l.campaign_id
      WHERE LOWER(c.business_username) = ${clean}
        AND c.id <> ${excludeCampaignId}
        AND c.deleted_at IS NULL
        AND c.status IN ('active', 'inactive')
        AND l.brand_decision = 'pick'
        AND l.outreach_status NOT IN ('declined', 'expired', 'accepted')
        -- 브랜드 요청 후보는 캠페인당 2명까지 무료라 대개 한도를 쓰지 않는다. 미리 알림에서는 뺀다.
        AND COALESCE(l.brand_requested, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM brand_quota_usage u
          WHERE u.company_username = ${clean} AND u.kind IN ('selected', 'brand_free') AND u.ref_id = l.id
        )
    `) as any[];
    return Number(rows[0]?.n || 0);
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return 0;
    throw e;
  }
}

/** 주어진 후보 중 이미 선정 한도에 잡힌 것. */
export async function countedSelectedIds(company: string, ids: string[]): Promise<string[]> {
  const clean = cleanCompany(company);
  if (!clean || !ids.length) return [];
  try {
    const rows = (await getDatabase().sql`
      SELECT ref_id FROM brand_quota_usage
      WHERE company_username = ${clean} AND kind IN ('selected', 'brand_free') AND ref_id = ANY(${ids})
    `) as any[];
    return rows.map((r) => String(r.ref_id));
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return [];
    throw e;
  }
}

/** 캠페인 리스트업을 처음 올릴 때(캠페인 1건). */
export const checkCampaignQuota = (company: string, campaignId: string) => check(company, "campaign", campaignId);
export const recordCampaignQuota = (company: string, campaignId: string) => record(company, "campaign", campaignId);

/**
 * 이 후보가 "브랜드 요청 무료" 자리에 들어가는지. 브랜드가 요청한 후보(brand_requested)만 해당하고,
 * 그 캠페인에서 이미 무료로 처리된 후보가 2명 미만일 때다. 이미 선정 한도로 센 후보는 아니다.
 * 확정은 캠페인 잠금(withCampaignLock) 안에서 일어나므로 같은 캠페인에서 3명째가 끼어들지 않는다.
 */
async function freeBrandSlot(company: string, campaignId: string, listupId: string): Promise<boolean> {
  const clean = cleanCompany(company);
  if (!clean || !campaignId || !listupId) return false;
  try {
    const rows = (await getDatabase().sql`
      SELECT
        (SELECT kind FROM brand_quota_usage
          WHERE company_username = ${clean} AND ref_id = ${listupId} AND kind IN ('selected', 'brand_free')
          LIMIT 1) AS existing,
        (SELECT COUNT(*)::int FROM brand_quota_usage u
          WHERE u.company_username = ${clean} AND u.kind = 'brand_free'
            AND u.ref_id IN (SELECT id FROM campaign_listups WHERE campaign_id = ${campaignId})) AS used
    `) as any[];
    const existing = rows[0]?.existing ? String(rows[0].existing) : "";
    if (existing === "brand_free") return true;
    if (existing === "selected") return false;
    return Number(rows[0]?.used || 0) < FREE_BRAND_REQUESTS_PER_CAMPAIGN;
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return false;
    throw e;
  }
}

type SelectedOpts = { campaignId?: string; brandRequested?: boolean };

/**
 * 진행 확정 · 연락처 공개 때(선정 1명). ref 는 리스트업 행 id.
 * 브랜드가 요청한 후보는 캠페인당 2명까지 한도를 쓰지 않는다(brand_free 로 남긴다).
 */
export async function checkSelectedQuota(company: string, listupId: string, opts: SelectedOpts = {}): Promise<ReserveResult> {
  if (opts.brandRequested && opts.campaignId && (await freeBrandSlot(company, opts.campaignId, listupId))) {
    // 무료 자리라도 멤버십이 없거나 미납이면 막는다(한도만 빼 주는 것이다).
    const clean = cleanCompany(company);
    if (!clean) return { ok: true };
    const status = await brandQuotaStatus(clean);
    if (!status.enforced) return { ok: true };
    if (!status.tier) {
      return { ok: false, status: 402, code: "BRAND_PLAN_REQUIRED", error: "이 브랜드는 멤버십을 구독하지 않았어요. 브랜드가 멤버십을 구독한 뒤에 진행할 수 있습니다." };
    }
    if (status.pastDue) {
      return { ok: false, status: 402, code: "BRAND_PAYMENT_PAST_DUE", error: "이 브랜드는 멤버십 정기결제가 실패한 상태예요. 결제 수단을 확인해 결제가 다시 되면 진행할 수 있습니다." };
    }
    return { ok: true };
  }
  return check(company, "selected", listupId);
}
export async function recordSelectedQuota(company: string, listupId: string, opts: SelectedOpts = {}): Promise<void> {
  if (opts.brandRequested && opts.campaignId && (await freeBrandSlot(company, opts.campaignId, listupId))) {
    return record(company, "brand_free", listupId);
  }
  return record(company, "selected", listupId);
}

/** 이 캠페인에서 남은 브랜드 요청 무료 자리. */
export async function freeBrandRemaining(company: string, campaignId: string): Promise<number> {
  const clean = cleanCompany(company);
  if (!clean || !campaignId) return 0;
  try {
    const rows = (await getDatabase().sql`
      SELECT COUNT(*)::int AS n FROM brand_quota_usage u
      WHERE u.company_username = ${clean} AND u.kind = 'brand_free'
        AND u.ref_id IN (SELECT id FROM campaign_listups WHERE campaign_id = ${campaignId})
    `) as any[];
    return Math.max(0, FREE_BRAND_REQUESTS_PER_CAMPAIGN - Number(rows[0]?.n || 0));
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return FREE_BRAND_REQUESTS_PER_CAMPAIGN;
    throw e;
  }
}
