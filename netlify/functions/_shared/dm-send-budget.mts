import { checkWorkerLease, queueRpc, workerContext } from "./dm-worker.mts";
import { AsyncLocalStorage } from "node:async_hooks";

type Bucket = "private_reply" | "direct" | "public_reply";
type Reservation = { allowed: boolean; token?: string; retryAfterMs?: number };
const sendDeadline = new AsyncLocalStorage<number>();

export function withDmSendDeadline<T>(run: () => Promise<T>): Promise<T> {
  return sendDeadline.run(Date.now() + 22_000, run);
}

function hourlyBudget(bucket: Bucket): number {
  const defaults = { private_reply: 700, direct: 3600, public_reply: 700 };
  const value = Number(process.env[`DM_${bucket.toUpperCase()}_HOURLY_BUDGET`] || defaults[bucket]);
  return Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), 100000) : defaults[bucket];
}

export async function reserveDmSend(account: string, bucket: Bucket): Promise<Reservation> {
  const requestDeadline = sendDeadline.getStore();
  const deadline = Math.min(Date.now() + (workerContext.getStore() || requestDeadline ? 7_000 : 2_000), requestDeadline ? requestDeadline - 8_500 : Infinity);
  const limit = hourlyBudget(bucket);
  while (true) {
    if (requestDeadline && Date.now() >= requestDeadline - 8_500) return { allowed: false, retryAfterMs: 1000 };
    await checkWorkerLease();
    const reservation = await queueRpc<Reservation>("dm_reserve_send", {
      p_account: account,
      p_bucket: bucket,
      p_hour_limit: limit,
      p_spacing_ms: Math.max(400, Math.ceil(3_600_000 / limit)),
    });
    if (reservation.allowed && reservation.token) return reservation;
    const delay = Math.max(100, Number(reservation.retryAfterMs) || 1000);
    if (Date.now() + delay + 50 > deadline) return { allowed: false, retryAfterMs: delay };
    await new Promise((resolve) => setTimeout(resolve, delay + 25));
  }
}

export async function finishDmSend(account: string, token: string, result: { ok: boolean; errorKind?: string; retryAfterMs?: number }): Promise<void> {
  await queueRpc("dm_finish_send", {
    p_account: account,
    p_token: token,
    p_status: result.ok ? "sent" : result.errorKind === "uncertain" ? "uncertain" : "failed",
    p_error_kind: result.errorKind || null,
    p_retry_ms: Math.min(result.retryAfterMs || 60_000, 86_400_000),
  }).catch((e) => console.error("[dm-send] result recording failed:", (e as Error)?.message));
}

export function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const value = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(value) && value > 0 ? Math.min(value, 86_400_000) : undefined;
}
