/**
 * 브랜드 정액제의 직원 좌석.
 *
 * 정액제(월 179,000원)에는 회사 관리자 좌석 1석이 들어 있고, 직원 좌석은 1석당 월
 * 99,000원으로 결제한 만큼 늘린다. 좌석 수는 멤버십 레코드(seller-verification 블롭)에
 * 함께 둔다 — 매월 청구액이 좌석 수로 정해지므로 정기결제와 같은 레코드에 있어야 한다.
 *
 *   · membership_extra_seats            지금 결제된 직원 좌석 수
 *   · membership_extra_seats_scheduled  다음 결제일부터 쓸 좌석 수(줄이기 예약). 없으면 null
 *
 * 좌석 늘리기는 그 자리에서 남은 기간만큼 일할 청구한다(등록된 정기결제 수단으로). 줄이기는
 * 이미 결제한 기간이 있으므로 다음 결제일부터 반영한다(환불 없음).
 *
 * 좌석을 누가 쓰는지(직원 · 초대)는 DB 의 brand_team_members · brand_seat_invites 가 맡는다
 * (brand-team).
 */
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import { mutateBlobJSON } from "./blob-write.mts";
import {
  addMonths,
  BRAND_SEAT_PRICE_KRW,
  brandCampaignMonthlyKrw,
  chargeMembershipBillingKey,
  MAX_SEATS_PER_PURCHASE,
  normalizeTier,
  readMembershipCharge,
  verifyMembershipBillingKey,
  type MembershipBillingEntry,
  type MembershipChargePending,
} from "./membership-billing.mts";

const STORE = "seller-verification";
const STALE_MS = 60_000;

type Rec = Record<string, any>;

const seatCount = (value: unknown): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** 정액제를 지금 쓰고 있는지(결제가 끝난 활성 구독). */
export const hasActiveBrandPlan = (record: Rec | null | undefined): boolean =>
  !!record?.membership_active && normalizeTier(record?.membership_plan) === "brand_campaign";

/** 지금 결제된 직원 좌석 수. 정액제가 아니면 0. */
export const paidExtraSeats = (record: Rec | null | undefined): number =>
  hasActiveBrandPlan(record) ? seatCount(record?.membership_extra_seats) : 0;

/** 다음 결제일에 청구할 직원 좌석 수(줄이기 예약이 있으면 그 값). */
export const nextCycleSeats = (record: Rec | null | undefined): number => {
  const scheduled = record?.membership_extra_seats_scheduled;
  if (scheduled !== null && scheduled !== undefined && Number.isFinite(Number(scheduled))) {
    return seatCount(scheduled);
  }
  return seatCount(record?.membership_extra_seats);
};

export interface SeatPlanSummary {
  planActive: boolean;
  extraSeats: number;
  scheduledSeats: number | null;
  seatPriceKrw: number;
  baseMonthlyKrw: number;
  nextMonthlyKrw: number;
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
  chargePending: boolean;
}

export const seatPlanSummary = (record: Rec | null | undefined): SeatPlanSummary => {
  const planActive = hasActiveBrandPlan(record);
  const scheduled = record?.membership_extra_seats_scheduled;
  const nextSeats = nextCycleSeats(record);
  return {
    planActive,
    extraSeats: paidExtraSeats(record),
    scheduledSeats: planActive && scheduled !== null && scheduled !== undefined ? seatCount(scheduled) : null,
    seatPriceKrw: BRAND_SEAT_PRICE_KRW,
    baseMonthlyKrw: brandCampaignMonthlyKrw(0),
    nextMonthlyKrw: planActive ? brandCampaignMonthlyKrw(nextSeats) : 0,
    nextBillingDate: planActive ? record?.next_billing_date || null : null,
    cancelAtPeriodEnd: !!record?.membership_cancel_at_period_end,
    chargePending: record?.membership_charge_pending?.kind === "seats",
  };
};

export const readSeatRecord = async (company: string): Promise<Rec | null> => {
  const store = getStore({ name: STORE, consistency: "strong" });
  return ((await store.get(`seller_${company}`, { type: "json" })) as Rec | null) || null;
};

/**
 * 남은 기간만큼의 좌석 금액. 결제 주기(이번 결제일 ~ 다음 결제일) 중 남은 비율로 나누고
 * 10원 단위로 반올림한다. 결제일을 알 수 없으면 한 달 치를 받는다.
 */
export const proratedSeatAmount = (seats: number, nextBillingIso: string | null | undefined, now = new Date()): number => {
  const full = BRAND_SEAT_PRICE_KRW * seats;
  const next = nextBillingIso ? Date.parse(nextBillingIso) : NaN;
  if (!Number.isFinite(next) || next <= now.getTime()) return full;
  const start = Date.parse(addMonths(new Date(next).toISOString(), -1));
  const cycle = next - start;
  if (!Number.isFinite(cycle) || cycle <= 0) return full;
  const ratio = Math.min(1, Math.max(0, (next - now.getTime()) / cycle));
  return Math.max(100, Math.round((full * ratio) / 10) * 10);
};

const pushHistory = (record: Rec, entry: MembershipBillingEntry) =>
  [entry, ...(Array.isArray(record.billing_history) ? record.billing_history : [])].slice(0, 50);

/** 결제가 확인된 좌석 청구를 레코드에 반영한다(같은 결제는 한 번만). */
const applySeatCharge = async (company: string, pending: MembershipChargePending, amountKrw: number) => {
  let applied = false;
  const saved = await mutateBlobJSON<Rec>(STORE, `seller_${company}`, (current) => {
    applied = false;
    if (current?.membership_charge_pending?.paymentId !== pending.paymentId) return null;
    applied = true;
    const at = new Date().toISOString();
    const added = seatCount(pending.seats);
    const scheduled = current.membership_extra_seats_scheduled;
    return {
      ...current,
      membership_extra_seats: seatCount(current.membership_extra_seats) + added,
      // 줄이기를 예약해 둔 채 좌석을 더 사면, 새로 산 좌석은 다음 달에도 남아야 한다.
      membership_extra_seats_scheduled:
        scheduled !== null && scheduled !== undefined ? seatCount(scheduled) + added : null,
      membership_charge_pending: null,
      billing_history: pushHistory(current, {
        at, tier: "brand_campaign", amountKrw, kind: "seats", success: true, seats: added, paymentId: pending.paymentId,
      }),
      updated_at: at,
    };
  });
  return { applied, saved };
};

const clearPending = (company: string, paymentId: string) =>
  mutateBlobJSON<Rec>(STORE, `seller_${company}`, (current) =>
    current?.membership_charge_pending?.paymentId === paymentId
      ? { ...current, membership_charge_pending: null }
      : null,
  );

/**
 * 결과를 모른 채 남은 좌석 청구(서버가 중간에 끊긴 경우)를 정리한다.
 * 'settled' — 남은 청구가 없다(정리했거나 원래 없었다), 'busy' — 아직 진행 중이거나 결과를 모른다.
 */
export const settleStaleSeatCharge = async (company: string): Promise<"settled" | "busy"> => {
  const record = await readSeatRecord(company);
  const pending = record?.membership_charge_pending as MembershipChargePending | null | undefined;
  if (!pending || pending.kind !== "seats") return "settled";
  const age = Date.now() - Date.parse(pending.startedAt);
  if (Number.isFinite(age) && age < STALE_MS) return "busy";
  const state = await readMembershipCharge(pending, company);
  if (state === "paid") {
    await applySeatCharge(company, pending, pending.amountKrw || 0);
    return "settled";
  }
  if (state === "failed" || state === "missing") {
    await clearPending(company, pending.paymentId);
    return "settled";
  }
  return "busy";
};

export type SeatChangeResult =
  | { ok: true; record: Rec; chargedKrw?: number }
  | { ok: false; status: number; error: string };

/** 직원 좌석을 늘린다. 남은 기간만큼 바로 결제하고, 결제가 확인되면 좌석이 생긴다. */
export const purchaseSeats = async (company: string, count: number): Promise<SeatChangeResult> => {
  const seats = Math.trunc(Number(count));
  if (!Number.isFinite(seats) || seats < 1 || seats > MAX_SEATS_PER_PURCHASE) {
    return { ok: false, status: 400, error: `좌석은 한 번에 1~${MAX_SEATS_PER_PURCHASE}석까지 추가할 수 있어요.` };
  }
  if ((await settleStaleSeatCharge(company)) === "busy") {
    return { ok: false, status: 409, error: "좌석 결제를 처리하는 중입니다. 잠시 후 다시 확인해 주세요." };
  }
  const before = await readSeatRecord(company);
  if (!hasActiveBrandPlan(before)) {
    return { ok: false, status: 403, error: "정액제를 구독한 뒤에 직원 좌석을 추가할 수 있어요." };
  }
  if (before?.membership_cancel_at_period_end) {
    return { ok: false, status: 409, error: "해지 예약이 걸려 있어요. 구독을 계속하기로 바꾼 뒤 좌석을 추가해 주세요." };
  }
  if (!before?.billing_key) {
    return { ok: false, status: 409, error: "등록된 결제 수단이 없어요. 고객센터에 문의해 주세요." };
  }
  const keyOwned = await verifyMembershipBillingKey(company, before.billing_key);
  if (keyOwned !== true) {
    return {
      ok: false,
      status: keyOwned === null ? 503 : 403,
      error: keyOwned === null
        ? "결제 수단 확인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
        : "등록된 결제 수단의 계정 정보가 일치하지 않습니다.",
    };
  }

  const amountKrw = proratedSeatAmount(seats, before.next_billing_date);
  const claim: { pending: MembershipChargePending | null } = { pending: null };
  await mutateBlobJSON<Rec>(STORE, `seller_${company}`, (current) => {
    claim.pending = null;
    if (!hasActiveBrandPlan(current) || current?.membership_cancel_at_period_end ||
        current?.billing_key !== before.billing_key || current?.membership_charge_pending) return null;
    claim.pending = {
      paymentId: `membership-${randomUUID()}`,
      billingKey: String(before.billing_key),
      tier: "brand_campaign",
      kind: "seats",
      startedAt: new Date().toISOString(),
      amountKrw,
      seats,
    };
    return { ...current, membership_charge_pending: claim.pending };
  });
  const pending = claim.pending as MembershipChargePending | null;
  if (!pending) {
    return { ok: false, status: 409, error: "결제를 처리하는 중입니다. 잠시 후 다시 시도해 주세요." };
  }

  const charge = await chargeMembershipBillingKey(company, pending.billingKey, "brand_campaign", pending.paymentId, {
    amountKrw,
    orderName: `픽스폴리오 직원 좌석 ${seats}석 추가`,
  });
  if (!charge.success) {
    if (!charge.uncertain) await clearPending(company, pending.paymentId);
    return {
      ok: false,
      status: charge.uncertain ? 503 : 402,
      error: charge.uncertain
        ? "결제 결과를 확인하는 중입니다. 다시 결제하지 말고 잠시 후 화면을 새로고침해 주세요."
        : charge.error || "좌석 결제에 실패했어요. 결제 수단을 확인해 주세요.",
    };
  }
  const { applied, saved } = await applySeatCharge(company, pending, charge.amountKrw);
  if (!applied || !saved) {
    return { ok: false, status: 503, error: "결제는 완료됐지만 좌석 반영을 확인해야 합니다. 다시 결제하지 말고 고객센터에 문의해 주세요." };
  }
  return { ok: true, record: saved, chargedKrw: charge.amountKrw };
};

/**
 * 다음 결제일부터 쓸 직원 좌석 수를 정한다(줄이기 예약 · 예약 취소).
 * `minimum` 은 지금 쓰고 있는 좌석(직원 + 대기 중인 초대) — 그보다 적게는 줄일 수 없다.
 */
export const scheduleSeatCount = async (company: string, target: number, minimum: number): Promise<SeatChangeResult> => {
  const seats = Math.trunc(Number(target));
  if (!Number.isFinite(seats) || seats < 0) {
    return { ok: false, status: 400, error: "좌석 수를 확인해 주세요." };
  }
  if (seats < minimum) {
    return {
      ok: false,
      status: 409,
      error: `지금 직원과 대기 중인 초대가 ${minimum}석을 쓰고 있어요. 직원을 내보내거나 초대를 취소한 뒤 줄여 주세요.`,
    };
  }
  let reason = "";
  const saved = await mutateBlobJSON<Rec>(STORE, `seller_${company}`, (current) => {
    reason = "";
    if (!hasActiveBrandPlan(current)) { reason = "plan"; return null; }
    const paid = seatCount(current?.membership_extra_seats);
    if (seats > paid) { reason = "more"; return null; }
    const at = new Date().toISOString();
    return { ...(current as Rec), membership_extra_seats_scheduled: seats === paid ? null : seats, updated_at: at };
  });
  if (reason === "plan" || !saved) return { ok: false, status: 403, error: "정액제를 이용 중일 때만 좌석을 바꿀 수 있어요." };
  if (reason === "more") return { ok: false, status: 400, error: "좌석을 늘리려면 좌석 추가 결제를 이용해 주세요." };
  return { ok: true, record: saved };
};
