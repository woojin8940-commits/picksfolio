import type { Config } from "@netlify/functions";
import type { DmJob } from "./_shared/dm-jobs.mts";
import { processDmJob } from "./_shared/dm-job-processor.mts";
import { queueRpc, renewWorker, verifyWorkerRequest, wakeDmWorkers, workerContext } from "./_shared/dm-worker.mts";
import type { WorkerContext } from "./_shared/dm-worker.mts";

export default async (req: Request) => {
  if (req.method !== "POST") return;
  const body = await req.text();
  if (body.length > 2048 || !verifyWorkerRequest(body, req.headers.get("x-dm-worker-signature"))) return;
  let input: { account?: string; token?: string };
  try { input = JSON.parse(body); } catch { return; }
  const { account, token } = input;
  if (typeof account !== "string" || !/^\d{1,64}$/.test(account) || typeof token !== "string" || !/^[a-f0-9-]{36}$/.test(token)) return;
  if (!(await queueRpc<boolean>("dm_start_worker", { p_account: account, p_token: token }))) return;

  const context: WorkerContext = { account, token, lost: false };
  let heartbeat: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (heartbeat) return;
    // 실제로 선점을 잃었으면 renewWorker 가 context.lost 를 세운다. 일시적인 연결
    // 오류까지 선점 상실로 보면 한 번의 지연으로 작업자가 통째로 멈춘다 — 선점은
    // 90초라 다음 갱신에서 회복되고, 발송 직전에는 매번 선점을 다시 확인한다.
    heartbeat = renewWorker(context, false)
      .catch((e) => console.warn("[dm-worker] heartbeat failed:", (e as Error)?.message))
      .finally(() => { heartbeat = undefined; });
  }, 20_000);
  const deadline = Date.now() + 12 * 60_000;
  context.deadline = deadline;
  let failed = false;
  try {
    await workerContext.run(context, async () => {
      while (!context.lost && Date.now() < deadline) {
        await renewWorker(context, false);
        const [job] = await queueRpc<DmJob[]>("dm_claim_account_job", { p_account: account, p_token: token });
        if (!job) break;
        context.job = job;
        await processDmJob(job);
        context.job = undefined;
      }
    });
  } catch (e) {
    failed = true;
    console.error("[dm-worker] processing failed:", (e as Error)?.message);
  } finally {
    clearInterval(timer);
    await heartbeat;
    await queueRpc("dm_release_worker", { p_account: account, p_token: token }).catch((e) => console.error("[dm-worker] release failed:", (e as Error)?.message));
    if (!failed && !context.lost) await wakeDmWorkers([account]).catch((e) => console.error("[dm-worker] continuation failed:", (e as Error)?.message));
  }
};

export const config: Config = {};
