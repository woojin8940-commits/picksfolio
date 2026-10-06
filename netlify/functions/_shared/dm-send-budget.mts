import { checkWorkerLease, queueRpc, workerContext } from "./dm-worker.mts";
import { AsyncLocalStorage } from "node:async_hooks";
import { readDmSendSpeed } from "./dm-send-speed.mts";

type Bucket = "private_reply" | "direct" | "public_reply";
type Reservation = { allowed: boolean; token?: string; retryAfterMs?: number };
/** 답글·DM 을 합산해 세는 계정 단위 발송 줄. */
const ACCOUNT_LANE: Bucket = "direct";
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
  const worker = workerContext.getStore();
  const deadline = Math.min(
    Date.now() + (worker ? 80_000 : requestDeadline ? 13_500 : 2_000),
    requestDeadline ? requestDeadline - 8_500 : Infinity,
    worker?.deadline ? worker.deadline - 25_000 : Infinity,
  );
  // 사용자가 고른 시간당 발송량(답글 + DM 합산). 인스타그램 문서의 엔드포인트별
  // 한도(비공개 답장 750건/시간 등)보다 커지지 않도록 기존 상한과 함께 묶는다.
  const limit = Math.min(await readDmSendSpeed(account), hourlyBudget(bucket));
  while (true) {
    if (Date.now() >= deadline) return { allowed: false, retryAfterMs: 1000 };
    if (requestDeadline && Date.now() >= requestDeadline - 8_500) return { allowed: false, retryAfterMs: 1000 };
    await checkWorkerLease();
    const reservation = await queueRpc<Reservation>("dm_reserve_send", {
      p_account: account,
      // 답글과 DM 을 한 줄로 센다. 종류별로 따로 세면 댓글 하나에 답글 + DM 이 같이
      // 나가는 자동화가 설정한 양의 두세 배를 보내게 된다. 설정 최대치(700건)가
      // 엔드포인트별 한도보다 작으므로 합산 한도만 지키면 종류별 한도도 지켜진다.
      p_bucket: ACCOUNT_LANE,
      p_hour_limit: limit,
      // 소셜비즈 방식: 한 시간을 한도로 고르게 나눈 간격으로 보낸다(400건이면 9초).
      // 몰아서 보내지 않는 것이 메타의 스팸 판단을 피하는 핵심이다. 간격이 아직
      // 안 됐거나 한도에 닿은 발송은 대기열로 돌아가 순서대로 나간다.
      p_spacing_ms: Math.max(400, Math.ceil(3_600_000 / limit)),
    });
    if (reservation.allowed && reservation.token) return reservation;
    const delay = Math.max(100, Number(reservation.retryAfterMs) || 1000);
    if (Date.now() + delay + 50 > deadline) return { allowed: false, retryAfterMs: delay };
    const resumeAt = Date.now() + delay + 25;
    while (Date.now() < resumeAt) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(resumeAt - Date.now(), 20_000)));
      if (worker) await checkWorkerLease();
    }
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
