import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import {
  chargeMembershipMonthly,
  addOneMonth,
  normalizeTier,
  isDue,
  MAX_BILLING_FAILURES,
  type BillingPlan,
  type MembershipBillingEntry,
} from "./_shared/membership-billing.mts";

/**
 * Daily recurring billing for the paid memberships (스탠다드 / AI 협업 / 커머스 / 프로)
 * 및 별도 구독인 라이브 커머스 멤버십.
 *
 * Every member is billed on the anniversary of the day they subscribed (가입일
 * 기준): the subscribe flow stores `next_billing_date`, and this job — running
 * once a day — charges every subscription whose date has arrived, then rolls the
 * date forward one month. Because each member carries their own next_billing_date,
 * members who paid on different days are billed on different days; they are not
 * all charged together.
 *
 * 라이브 커머스는 멤버십과 따로 결제하는 구독이라 청구 상태도 `live_plan_*` 필드로
 * 따로 관리한다. 한 사람이 멤버십과 라이브를 같이 들고 있으면 각각의 결제일에 각각
 * 청구된다(같은 빌링키를 쓰되 청구는 두 건).
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
  live_plan_active?: boolean;
  live_plan_next_billing_date?: string | null;
  live_plan_billing_failures?: number;
  [k: string]: unknown;
}

/** 한 레코드 안에서 따로 청구되는 구독 한 건. */
interface DueSubscription {
  plan: BillingPlan;
  /** 실패가 누적됐을 때 꺼야 하는 활성 플래그. */
  activeField: "membership_active" | "live_plan_active";
  nextField: "next_billing_date" | "live_plan_next_billing_date";
  lastField: "last_billing_at" | "live_plan_last_billing_at";
  failuresField: "billing_failures" | "live_plan_billing_failures";
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

      // Records without a billing key (e.g. complimentary memberships) are never charged.
      if (!record.billing_key) {
        skipped++;
        continue;
      }

      const due: DueSubscription[] = [];

      const tier = normalizeTier(record.membership_plan);
      if (record.membership_active && tier && isDue(record.next_billing_date, now)) {
        due.push({
          plan: tier,
          activeField: "membership_active",
          nextField: "next_billing_date",
          lastField: "last_billing_at",
          failuresField: "billing_failures",
        });
      }

      if (record.live_plan_active && isDue(record.live_plan_next_billing_date, now)) {
        due.push({
          plan: "live_plan",
          activeField: "live_plan_active",
          nextField: "live_plan_next_billing_date",
          lastField: "live_plan_last_billing_at",
          failuresField: "live_plan_billing_failures",
        });
      }

      if (due.length === 0) {
        skipped++;
        continue;
      }

      const username = blob.key.replace(/^seller_/, "");
      // 두 구독이 같은 날 걸릴 수 있으므로 레코드에 차례로 반영한 뒤 한 번만 저장한다.
      let current: SellerRecord = record;

      for (const sub of due) {
        const charge = await chargeMembershipMonthly(
          username,
          record.billing_key,
          sub.plan,
          (record.billing_provider as string | undefined) ?? "portone",
          (record.toss_customer_key as string | undefined) ?? null,
        );
        const at = new Date().toISOString();
        const history = Array.isArray(current.billing_history) ? current.billing_history : [];

        if (charge.success) {
          const entry: MembershipBillingEntry = {
            at,
            tier: sub.plan,
            amountKrw: charge.amountKrw || 0,
            kind: "recurring",
            success: true,
            paymentId: charge.paymentId,
          };
          // Advance from the scheduled due date (not "now") so the billing day never
          // drifts even if the scheduler runs a little late.
          const base = (current[sub.nextField] as string | null | undefined) || at;
          current = {
            ...current,
            [sub.lastField]: at,
            [sub.nextField]: addOneMonth(base),
            [sub.failuresField]: 0,
            billing_history: [entry, ...history].slice(0, 50),
            updated_at: at,
          };
          charged++;
          console.log(
            `[membership-billing] Charged ${username} (${sub.plan}) ₩${charge.amountKrw}`,
          );
        } else {
          const failures = ((current[sub.failuresField] as number | undefined) || 0) + 1;
          const entry: MembershipBillingEntry = {
            at,
            tier: sub.plan,
            amountKrw: charge.amountKrw || 0,
            kind: "recurring",
            success: false,
            error: charge.error,
          };
          // Dunning: keep the due date unchanged so the charge is retried on the next
          // daily run. After MAX_BILLING_FAILURES consecutive failures that one
          // subscription is paused so a dead card stops being retried indefinitely.
          const exhausted = failures >= MAX_BILLING_FAILURES;
          current = {
            ...current,
            [sub.activeField]: exhausted ? false : current[sub.activeField],
            [sub.failuresField]: failures,
            billing_history: [entry, ...history].slice(0, 50),
            updated_at: at,
          };
          failed++;
          console.error(
            `[membership-billing] Failed ${username} (${sub.plan}) attempt ${failures}/${MAX_BILLING_FAILURES}` +
              `${exhausted ? " — subscription paused" : ""}: ${charge.error}`,
          );
        }
      }

      await store.setJSON(blob.key, current);
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
