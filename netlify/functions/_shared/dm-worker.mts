import { createHmac, timingSafeEqual } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { getSupabaseServer } from "./supabase.mts";
import type { DmJob } from "./dm-jobs.mts";

export interface WorkerContext {
  account: string;
  token: string;
  job?: DmJob;
  lost: boolean;
}

export const workerContext = new AsyncLocalStorage<WorkerContext>();

export async function queueRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseServer().rpc(name, args).abortSignal(AbortSignal.timeout(8_000));
  if (error) throw error;
  return data as T;
}

function workerSecret(): string {
  const secret = process.env.DM_WORKER_SECRET || process.env.INSTAGRAM_APP_SECRET;
  if (!secret) throw new Error("DM worker secret is not configured");
  return secret;
}

function signature(body: string): string {
  return createHmac("sha256", workerSecret()).update(`dm-worker-v1:${body}`).digest("hex");
}

export function verifyWorkerRequest(body: string, supplied: string | null): boolean {
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  try {
    return timingSafeEqual(Buffer.from(signature(body), "hex"), Buffer.from(supplied, "hex"));
  } catch {
    return false;
  }
}

export async function wakeDmWorkers(accounts?: string[], limit = 50): Promise<void> {
  const origin = new URL(process.env.URL || "https://picks-folio.com");
  if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("Invalid worker origin");
  workerSecret();
  const tickets = await queueRpc<{ ig_account_id: string; token: string }[]>("dm_request_workers", {
    p_accounts: accounts ? [...new Set(accounts.filter(Boolean))] : null,
    p_limit: limit,
  });
  for (let offset = 0; offset < tickets.length; offset += 10) {
    await Promise.all(tickets.slice(offset, offset + 10).map(async (ticket) => {
      const body = JSON.stringify({ account: ticket.ig_account_id, token: ticket.token });
      try {
        const response = await fetch(new URL("/.netlify/functions/dm-worker-background", origin), {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-DM-Worker-Signature": signature(body) },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(2_000),
        });
        if (response.status !== 202) throw new Error(`Worker response ${response.status}`);
      } catch (e) {
        console.error("[dm-worker] dispatch failed:", (e as Error)?.message);
      }
    }));
  }
}

export async function renewWorker(context: WorkerContext, withJob = true): Promise<void> {
  if (context.lost) throw new Error("DM worker lease lost");
  const job = withJob ? context.job : undefined;
  const valid = await queueRpc<boolean>("dm_renew_worker", {
    p_account: context.account,
    p_token: context.token,
    p_job: job?.id || null,
    p_job_token: job?.lease_token || null,
  });
  if (!valid) {
    context.lost = true;
    throw new Error("DM worker lease lost");
  }
}

export async function checkWorkerLease(): Promise<void> {
  const context = workerContext.getStore();
  if (context) await renewWorker(context);
}
