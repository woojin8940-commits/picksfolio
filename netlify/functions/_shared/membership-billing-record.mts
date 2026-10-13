import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import { mutateBlobJSON } from "./blob-write.mts";
import { migrateSellerMembership } from "./seller-membership-store.mts";
import {
  addOneMonth, chargeMembershipBillingKey, isDue, isSellableTier, MAX_BILLING_FAILURES,
  normalizeTier, verifyMembershipBillingKey,
  type MembershipBillingEntry, type MembershipChargePending,
} from "./membership-billing.mts";

const STORE = "seller-verification";
const CLAIM_WAIT_MS = 5 * 60_000;
interface SellerRecord {
  membership_active?: boolean;
  membership_plan?: string | null;
  membership_cancel_at_period_end?: boolean;
  membership_ends_at?: string | null;
  billing_key?: string | null;
  next_billing_date?: string | null;
  billing_failures?: number;
  billing_history?: MembershipBillingEntry[];
  membership_charge_pending?: MembershipChargePending | null;
  [key: string]: unknown;
}
export interface BillingRecordResult {
  charged: number; failed: number; canceled: number; skipped: number; retryAfterMs?: number;
}
const result = (field: "charged" | "failed" | "canceled" | "skipped", retryAfterMs?: number): BillingRecordResult =>
  ({ charged: 0, failed: 0, canceled: 0, skipped: 0, [field]: 1, ...(retryAfterMs ? { retryAfterMs } : {}) });

export async function billMembershipRecord(username: string, now: Date, key = `seller_${username}`): Promise<BillingRecordResult> {
  if (!key.startsWith("seller_") || key.slice(7).trim().toLowerCase() !== username) throw new Error("Membership record key mismatch");
  const store = getStore({ name: STORE, consistency: "strong" });
  const record = (key === `seller_${username}` ? await migrateSellerMembership(store, username)
    : await store.get(key, { type: "json" })) as SellerRecord | null;
  if (!record) return result("skipped");
  const tier = normalizeTier(record.membership_plan);
  if (!record.membership_active || !tier ||
      (!isDue(record.next_billing_date, now) && record.membership_charge_pending?.kind !== "recurring")) return result("skipped");
  if (record.membership_cancel_at_period_end || !isSellableTier(tier)) {
    let ended = false;
    await mutateBlobJSON<SellerRecord>(STORE, key, (latest) => {
      ended = false;
      if (!latest?.membership_active || !isDue(latest.next_billing_date, now) ||
          (!latest.membership_cancel_at_period_end && isSellableTier(normalizeTier(latest.membership_plan)))) return null;
      ended = true;
      const at = new Date().toISOString();
      return { ...latest, membership_active: false, next_billing_date: null,
        membership_cancel_at_period_end: false, membership_ends_at: latest.membership_ends_at || at,
        membership_ended_at: at, updated_at: at };
    });
    return result(ended ? "canceled" : "skipped");
  }
  if (!record.billing_key) return result("skipped");
  const keyOwned = await verifyMembershipBillingKey(username, record.billing_key);
  if (keyOwned === null) return result("skipped");
  if (!keyOwned) {
    await mutateBlobJSON<SellerRecord>(STORE, key, (latest) => {
      if (!latest || latest.billing_key !== record.billing_key) return null;
      const failures = Number(latest.billing_failures || 0) + 1;
      const at = new Date().toISOString();
      const entry: MembershipBillingEntry = { at, tier, amountKrw: 0, kind: "recurring", success: false,
        error: "등록된 결제 수단의 계정 정보가 일치하지 않아 청구하지 않았습니다." };
      return { ...latest, membership_active: failures >= MAX_BILLING_FAILURES ? false : latest.membership_active,
        billing_failures: failures, billing_history: [entry, ...(Array.isArray(latest.billing_history) ? latest.billing_history : [])].slice(0, 50), updated_at: at };
    });
    return result("failed");
  }
  const claim: { pending: MembershipChargePending | null; wait: number } = { pending: null, wait: 0 };
  await mutateBlobJSON<SellerRecord>(STORE, key, (latest) => {
    claim.pending = null;
    claim.wait = 0;
    if (!latest?.membership_active || latest.membership_cancel_at_period_end ||
        latest.billing_key !== record.billing_key || normalizeTier(latest.membership_plan) !== tier) return null;
    const at = new Date().toISOString();
    const existing = latest.membership_charge_pending;
    if (existing) {
      if (existing.kind !== "recurring" || !existing.scheduledDate || existing.tier !== tier ||
          existing.billingKey !== latest.billing_key) return null;
      const age = Date.now() - Date.parse(existing.startedAt);
      if (!Number.isFinite(age) || age < CLAIM_WAIT_MS) {
        claim.wait = Number.isFinite(age) ? CLAIM_WAIT_MS - age : CLAIM_WAIT_MS;
        return null;
      }
      claim.pending = { ...existing, startedAt: at };
    } else {
      if (!isDue(latest.next_billing_date, now)) return null;
      claim.pending = { paymentId: `membership-${randomUUID()}`, billingKey: latest.billing_key!, tier,
        kind: "recurring", scheduledDate: latest.next_billing_date || at, startedAt: at };
    }
    return { ...latest, next_billing_date: addOneMonth(claim.pending.scheduledDate!),
      membership_charge_pending: claim.pending, updated_at: at };
  });
  const pending: MembershipChargePending | null = claim.pending;
  if (!pending) return result("skipped", claim.wait);
  // Retain the payment ID across worker restarts and uncertain provider responses.
  const charge = await chargeMembershipBillingKey(username, pending.billingKey, pending.tier, pending.paymentId);
  const at = new Date().toISOString();
  let recorded = false;
  await mutateBlobJSON<SellerRecord>(STORE, key, (latest) => {
    recorded = false;
    if (!latest || latest.membership_charge_pending?.paymentId !== pending.paymentId) return null;
    recorded = true;
    if (charge.uncertain) return { ...latest, next_billing_date: pending.scheduledDate, updated_at: at };
    const failures = charge.success ? 0 : Number(latest.billing_failures || 0) + 1;
    const entry: MembershipBillingEntry = { at, tier: pending.tier, amountKrw: charge.amountKrw || 0,
      kind: "recurring", success: charge.success, ...(charge.success ? { paymentId: charge.paymentId } : { error: charge.error }) };
    return { ...latest, last_billing_at: charge.success ? at : latest.last_billing_at,
      next_billing_date: charge.success ? addOneMonth(pending.scheduledDate!) : pending.scheduledDate,
      membership_active: !charge.success && failures >= MAX_BILLING_FAILURES ? false : latest.membership_active,
      billing_failures: failures, billing_history: [entry, ...(Array.isArray(latest.billing_history) ? latest.billing_history : [])].slice(0, 50),
      membership_charge_pending: null, updated_at: at };
  });
  return result(recorded && charge.success ? "charged" : "failed");
}
