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
    heartbeat = renewWorker(context, false).catch(() => { context.lost = true; }).finally(() => { heartbeat = undefined; });
  }, 20_000);
  const deadline = Date.now() + 12 * 60_000;
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
