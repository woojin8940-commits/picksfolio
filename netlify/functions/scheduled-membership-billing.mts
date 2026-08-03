import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import {
  chargeMembershipMonthly,
  addOneMonth,
  normalizeTier,
  isDue,
  MAX_BILLING_FAILURES,
  type BillingPlan,
  type MembershipBillingEntry,
} from "./_shared/membership-billing.mts";

const STORE = "seller-verification";

/**
 * Daily recurring billing for the paid memberships (스탠다드 / AI 협업 / 커머스 / 프로),
 * 그리고 아직 해지하지 않은 기존 라이브 커머스 구독자.
 *
 * Every member is billed on the anniversary of the day they subscribed (가입일
 * 기준): the subscribe flow stores `next_billing_date`, and this job — running
 * once a day — charges every subscription whose date has arrived, then rolls the
 * date forward one month. Because each member carries their own next_billing_date,
 * members who paid on different days are billed on different days; they are not
 * all charged together.
 *
 * 라이브 커머스는 서비스를 종료해 신규 구독을 받지 않는다. 다만 청구 상태가 `live_plan_*`
 * 필드로 따로 관리되는 별도 구독이었기 때문에, 아직 해지하지 않은 기존 구독자는 해지할
 * 때까지 계속 갱신해 줘야 한다 — 그래서 이 청구 경로는 그대로 남겨 둔다.
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
  const store = getStore(STORE);
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

      for (const sub of due) {
        // ── 1) 결제일 선점 ────────────────────────────────────────────────
        // 카드를 긁기 전에 다음 결제일을 먼저 한 달 밀어 둔다. 순서를 이렇게
        // 두는 이유: 청구를 먼저 하고 저장에 실패하면(쓰기 오류 · 다른 요청과
        // 충돌 · 함수 중단) 결제일이 그대로 남아 다음 날 또 청구된다 —
        // 이중 청구다. 반대로 선점을 먼저 하면 최악의 경우 이번 달 청구를
        // 건너뛰는 것으로 끝나고, 돈이 두 번 빠지지는 않는다.
        // 최신 레코드로 다시 확인하므로 실행이 겹쳐도 한 번만 청구된다.
        const claim: { base: string | null } = { base: null };
        try {
          await mutateBlobJSON<SellerRecord>(STORE, blob.key, (latest) => {
            claim.base = null;
            if (!latest || !latest.billing_key || !latest[sub.activeField]) return null;
            const scheduled = latest[sub.nextField] as string | null | undefined;
            if (!isDue(scheduled, now)) return null; // 이미 다른 실행이 처리했다
            const at = new Date().toISOString();
            claim.base = scheduled || at;
            return {
              ...latest,
              [sub.nextField]: addOneMonth(claim.base),
              updated_at: at,
            };
          });
        } catch (claimErr) {
          console.error(`[membership-billing] Could not claim ${username} (${sub.plan}):`, claimErr);
        }

        if (!claim.base) {
          skipped++;
          continue;
        }
        const scheduledDate = claim.base;

        // ── 2) 청구 ──────────────────────────────────────────────────────
        const charge = await chargeMembershipMonthly(
          username,
          record.billing_key,
          sub.plan,
          (record.billing_provider as string | undefined) ?? "portone",
          (record.toss_customer_key as string | undefined) ?? null,
        );
        const at = new Date().toISOString();

        // ── 3) 결과 기록 ─────────────────────────────────────────────────
        // 같은 레코드를 사용자 저장(계좌·사업자 정보)과 빌링키 발급도 고치므로,
        // 통째로 덮어쓰지 않고 최신 레코드에 결과만 얹는다.
        if (charge.success) {
          const entry: MembershipBillingEntry = {
            at,
            tier: sub.plan,
            amountKrw: charge.amountKrw || 0,
            kind: "recurring",
            success: true,
            paymentId: charge.paymentId,
          };
          await mutateBlobJSON<SellerRecord>(STORE, blob.key, (latest) => {
            const base: SellerRecord = latest ?? {};
            const history = Array.isArray(base.billing_history) ? base.billing_history : [];
            return {
              ...base,
              [sub.lastField]: at,
              [sub.failuresField]: 0,
              billing_history: [entry, ...history].slice(0, 50),
              updated_at: at,
            };
          });
          charged++;
          console.log(
            `[membership-billing] Charged ${username} (${sub.plan}) ₩${charge.amountKrw}`,
          );
        } else {
          // Dunning: 선점해 둔 결제일을 원래 날짜로 돌려 다음 날 다시 시도한다.
          // MAX_BILLING_FAILURES 번 연속 실패하면 그 구독만 정지시켜, 죽은 카드를
          // 무한히 재시도하지 않는다.
          const outcome: { failures: number; exhausted: boolean } = { failures: 0, exhausted: false };
          await mutateBlobJSON<SellerRecord>(STORE, blob.key, (latest) => {
            const base: SellerRecord = latest ?? {};
            const history = Array.isArray(base.billing_history) ? base.billing_history : [];
            const failures = ((base[sub.failuresField] as number | undefined) || 0) + 1;
            const exhausted = failures >= MAX_BILLING_FAILURES;
            outcome.failures = failures;
            outcome.exhausted = exhausted;
            const entry: MembershipBillingEntry = {
              at,
              tier: sub.plan,
              amountKrw: charge.amountKrw || 0,
              kind: "recurring",
              success: false,
              error: charge.error,
            };
            return {
              ...base,
              [sub.nextField]: scheduledDate,
              [sub.activeField]: exhausted ? false : base[sub.activeField],
              [sub.failuresField]: failures,
              billing_history: [entry, ...history].slice(0, 50),
              updated_at: at,
            };
          });
          failed++;
          console.error(
            `[membership-billing] Failed ${username} (${sub.plan}) attempt ${outcome.failures}/${MAX_BILLING_FAILURES}` +
              `${outcome.exhausted ? " — subscription paused" : ""}: ${charge.error}`,
          );
        }
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
