import { getStore } from "@netlify/blobs";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mutateBlobJSON } from "./blob-write.mts";
import { billMembershipRecord, type BillingRecordResult } from "./membership-billing-record.mts";

const STORE = "membership-billing-runs";
const KEY = "state";
const LEASE_MS = 90_000;
const BUDGET_MS = 12 * 60_000;
interface BillingRun {
  id: string; period: string; startedAt: string; after: string; finishedAt: string | null;
  leaseToken: string | null; leaseUntil: number; resumeAt: number;
  counts: BillingRecordResult;
  retries: Record<string, { attempts: number; at: number }>;
}
function secret(): string {
  const value = process.env.MEMBERSHIP_BILLING_WORKER_SECRET || process.env.PORTONE_V2_API_SECRET;
  if (!value) throw new Error("Billing worker secret is not configured");
  return value;
}
const sign = (body: string) => createHmac("sha256", secret()).update(`membership-billing-v1:${body}`).digest("hex");
export function verifyBillingWorkerRequest(body: string, signature: string | null): boolean {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  try { return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(body), "hex")); }
  catch { return false; }
}
export async function dispatchBillingWorker(id: string): Promise<void> {
  const origin = new URL(process.env.URL || "https://picks-folio.com");
  if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("Invalid billing worker origin");
  const body = JSON.stringify({ id });
  const response = await fetch(new URL("/.netlify/functions/membership-billing-background", origin), {
    method: "POST", headers: { "Content-Type": "application/json", "X-Billing-Worker-Signature": sign(body) },
    body, redirect: "error", signal: AbortSignal.timeout(5_000),
  });
  if (response.status !== 202) throw new Error(`Billing worker response ${response.status}`);
}
export async function scheduleBillingRun(): Promise<void> {
  const now = Date.now();
  // Each daily cycle starts at 04:10 KST. Other ticks only resume an unfinished cycle.
  const period = new Date(now - (19 * 60 + 10) * 60_000).toISOString().slice(0, 10);
  let dispatch = "";
  await mutateBlobJSON<BillingRun>(STORE, KEY, (current) => {
    dispatch = "";
    if (current && !current.finishedAt) {
      if (current.leaseUntil <= now && current.resumeAt <= now) dispatch = current.id;
      return null;
    }
    if (current?.period === period) return null;
    const next: BillingRun = { id: randomUUID(), period, startedAt: new Date(now).toISOString(), after: "", finishedAt: null,
      leaseToken: null, leaseUntil: 0, resumeAt: 0, retries: {}, counts: { charged: 0, failed: 0, canceled: 0, skipped: 0 } };
    dispatch = next.id;
    return next;
  });
  if (dispatch) await dispatchBillingWorker(dispatch);
}
export async function runBillingWorker(id: string, budgetMs = BUDGET_MS): Promise<"continue" | "done" | "busy"> {
  const token = randomUUID();
  let acquired = false;
  let state = await mutateBlobJSON<BillingRun>(STORE, KEY, (current) => {
    acquired = false;
    if (!current || current.id !== id || current.finishedAt || current.leaseUntil > Date.now() || current.resumeAt > Date.now()) return null;
    acquired = true;
    return { ...current, leaseToken: token, leaseUntil: Date.now() + LEASE_MS };
  });
  if (!acquired || !state) return "busy";
  let lost = false;
  let heartbeat: Promise<unknown> | undefined;
  const update = async (change: (current: BillingRun) => BillingRun): Promise<BillingRun> => {
    let matched = false;
    const updated = await mutateBlobJSON<BillingRun>(STORE, KEY, (current) => {
      matched = false;
      if (!current || current.id !== id || current.leaseToken !== token || current.leaseUntil <= Date.now()) return null;
      matched = true;
      return change(current);
    });
    if (!matched) { lost = true; throw new Error("Billing worker lease lost"); }
    return updated!;
  };
  const renew = () => update((current) => ({ ...current, leaseUntil: Date.now() + LEASE_MS }));
  const timer = setInterval(() => {
    if (!heartbeat) heartbeat = renew().catch((e) => console.warn("[membership-billing] heartbeat failed:", (e as Error)?.message))
      .finally(() => { heartbeat = undefined; });
  }, 20_000);
  const deadline = Date.now() + Math.min(BUDGET_MS, Math.max(1, budgetMs));
  let mainComplete = false;
  try {
    const store = getStore({ name: "seller-verification", consistency: "strong" });
    const { blobs } = await store.list({ prefix: "seller_" });
    const keys = new Map<string, string>();
    const conflicts = new Set<string>();
    for (const blob of blobs) {
      const name = blob.key.slice(7).trim().toLowerCase();
      if (!name) continue;
      if (keys.has(name) && keys.get(name) !== blob.key) conflicts.add(name);
      else keys.set(name, blob.key);
    }
    const names = [...keys.keys()].sort();
    const remaining = names.filter((name) => name > state!.after);
    const process = async (username: string, main: boolean) => {
      await renew();
      let counts: BillingRecordResult = { charged: 0, failed: 0, canceled: 0, skipped: 0 };
      let delay = 0;
      try {
        if (conflicts.has(username)) throw new Error("Membership record keys conflict; review required");
        counts = await billMembershipRecord(username, new Date(state!.startedAt), keys.get(username));
        delay = counts.retryAfterMs || 0;
      } catch (e) {
        console.error(`[membership-billing] Error processing ${username}:`, e);
        delay = 5 * 60_000;
      }
      state = await update((current) => {
        const retries = { ...(current.retries || {}) };
        let exhausted = false;
        if (delay) {
          const attempts = (retries[username]?.attempts || 0) + 1;
          if (attempts < 12) retries[username] = { attempts, at: Date.now() + delay };
          else { delete retries[username]; exhausted = true; }
        } else delete retries[username];
        return { ...current, after: main ? username : current.after, retries, resumeAt: 0, leaseUntil: Date.now() + LEASE_MS,
          counts: {
            charged: current.counts.charged + (delay ? 0 : counts.charged),
            failed: current.counts.failed + (delay ? exhausted ? 1 : 0 : counts.failed),
            canceled: current.counts.canceled + (delay ? 0 : counts.canceled),
            skipped: current.counts.skipped + (delay ? 0 : counts.skipped),
          } };
      });
    };
    for (const username of remaining) {
      if (lost || Date.now() + 60_000 >= deadline) break;
      await process(username, true);
    }
    mainComplete = remaining.every((name) => name <= state!.after);
    if (!mainComplete) return "continue";
    for (const [username, retry] of Object.entries(state!.retries || {})) {
      if (lost || Date.now() + 60_000 >= deadline) break;
      if (retry.at <= Date.now()) await process(username, false);
    }
    const retries = Object.values(state!.retries || {});
    if (retries.length === 0) {
      state = await update((current) => ({ ...current, finishedAt: new Date().toISOString(), resumeAt: 0 }));
      return "done";
    }
    const resumeAt = Math.min(...retries.map((retry) => retry.at));
    await update((current) => ({ ...current, resumeAt }));
    return resumeAt <= Date.now() ? "continue" : "done";
  } finally {
    clearInterval(timer);
    await heartbeat;
    await mutateBlobJSON<BillingRun>(STORE, KEY, (current) =>
      current?.id === id && current.leaseToken === token ? { ...current, leaseToken: null, leaseUntil: 0 } : null);
  }
}
