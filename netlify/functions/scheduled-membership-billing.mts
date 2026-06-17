import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import {
  chargeMembershipMonthly,
  addOneMonth,
  normalizeTier,
  isDue,
  MAX_BILLING_FAILURES,
  type MembershipBillingEntry,
} from "./_shared/membership-billing.mts";

/**
 * Daily recurring billing for the paid memberships (스탠다드 / 스탠다드 AI / 커머스).
 *
 * Every member is billed on the anniversary of the day they subscribed (가입일
 * 기준): the subscribe flow stores `next_billing_date`, and this job — running
 * once a day — charges every subscription whose date has arrived, then rolls the
 * date forward one month. Because each member carries their own next_billing_date,
 * members who paid on different days are billed on different days; they are not
 * all charged together.
 *
 * The Claude plan is deliberately NOT handled here — it is a prepaid credit wallet
 * in a different store with balance-based top-ups, not a monthly subscription.
 */

interface SellerRecord {
  membership_active?: boolean;
  membership_plan?: string | null;
  billing_key?: string | null;
  next_billing_date?: string | null;
  billing_failures?: number;
  billing_history?: MembershipBillingEntry[];
  [k: string]: unknown;
}

export default async () => {
  const store = getStore("seller-verification");
  const now = new Date();

  const { blobs } = await store.list({ prefix: "seller_" });
  if (blobs.length === 0) {
    console.log("[membership-billing] No seller records");
    return;
  }

  let charged = 0;
  let failed = 0;
  let skipped = 0;

  for (const blob of blobs) {
    try {
      const record = (await store.get(blob.key, { type: "json" })) as SellerRecord | null;
      if (!record) continue;

      const tier = normalizeTier(record.membership_plan);
      // Only active, billing-key-backed subscriptions whose date is due. Records
      // without a billing key (e.g. complimentary memberships) are never charged.
      if (
        !record.membership_active ||
        !record.billing_key ||
        !tier ||
        !isDue(record.next_billing_date, now)
      ) {
        skipped++;
        continue;
      }

      const username = blob.key.replace(/^seller_/, "");
      const charge = await chargeMembershipMonthly(
        username,
        record.billing_key,
        tier,
        (record.billing_provider as string | undefined) ?? "portone",
        (record.toss_customer_key as string | undefined) ?? null,
      );
      const at = new Date().toISOString();
      const history = Array.isArray(record.billing_history) ? record.billing_history : [];

      if (charge.success) {
        const entry: MembershipBillingEntry = {
          at,
          tier,
          amountKrw: charge.amountKrw || 0,
          kind: "recurring",
          success: true,
          paymentId: charge.paymentId,
        };
        // Advance from the scheduled due date (not "now") so the billing day never
        // drifts even if the scheduler runs a little late.
        const base = record.next_billing_date || at;
        await store.setJSON(blob.key, {
          ...record,
          last_billing_at: at,
          next_billing_date: addOneMonth(base),
          billing_failures: 0,
          billing_history: [entry, ...history].slice(0, 50),
          updated_at: at,
        });
        charged++;
        console.log(`[membership-billing] Charged ${username} (${tier}) ₩${charge.amountKrw}`);
      } else {
        const failures = (record.billing_failures || 0) + 1;
        const entry: MembershipBillingEntry = {
          at,
          tier,
          amountKrw: charge.amountKrw || 0,
          kind: "recurring",
          success: false,
          error: charge.error,
        };
        // Dunning: keep next_billing_date unchanged so the charge is retried on the
        // next daily run. After MAX_BILLING_FAILURES consecutive failures the
        // subscription is paused so a dead card stops being retried indefinitely.
        const exhausted = failures >= MAX_BILLING_FAILURES;
        await store.setJSON(blob.key, {
          ...record,
          membership_active: exhausted ? false : record.membership_active,
          billing_failures: failures,
          billing_history: [entry, ...history].slice(0, 50),
          updated_at: at,
        });
        failed++;
        console.error(
          `[membership-billing] Failed ${username} (${tier}) attempt ${failures}/${MAX_BILLING_FAILURES}` +
            `${exhausted ? " — subscription paused" : ""}: ${charge.error}`,
        );
      }
    } catch (e) {
      console.error(`[membership-billing] Error processing ${blob.key}:`, e);
    }
  }

  console.log(
    `[membership-billing] Done — charged ${charged}, failed ${failed}, skipped ${skipped} of ${blobs.length}`,
  );
};

export const config: Config = {
  // Once a day at 04:10 KST-ish (cron is UTC; the exact hour is not important —
  // each subscription is gated by its own next_billing_date, not by this time).
  schedule: "10 19 * * *",
};
