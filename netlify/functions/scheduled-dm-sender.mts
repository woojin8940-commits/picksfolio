import type { Config } from "@netlify/functions";
import { restoreCommentEvents, restoreMissingJobAccounts } from "./_shared/dm-jobs.mts";
import { transferDueScheduledJobs } from "./_shared/dm-schedule-store.mts";
import { queueRpc, wakeDmWorkers } from "./_shared/dm-worker.mts";

export default async () => {
  const deadline = Date.now() + 18_000;
  await wakeDmWorkers().catch((e) => console.error("[scheduled-dm] dispatch failed:", (e as Error)?.message));
  if (Date.now() < deadline) await restoreMissingJobAccounts(deadline).catch((e) => console.error("[scheduled-dm] account recovery failed:", (e as Error)?.message));
  if (Date.now() < deadline) await restoreCommentEvents(deadline).catch((e) => console.error("[scheduled-dm] comment recovery failed:", (e as Error)?.message));
  if (Date.now() < deadline) await transferDueScheduledJobs(deadline).catch((e) => console.error("[scheduled-dm] schedule recovery failed:", (e as Error)?.message));
  if (Date.now() < deadline) await queueRpc("dm_prune_send_attempts").catch((e) => console.error("[scheduled-dm] cleanup failed:", (e as Error)?.message));
  // 끝난 대기열 작업 정리는 표 전체를 훑으므로 한 시간에 한 번만 한다.
  if (Date.now() < deadline && new Date().getUTCMinutes() === 17) {
    await queueRpc("dm_prune_jobs").catch((e) => console.error("[scheduled-dm] job cleanup failed:", (e as Error)?.message));
  }
};

export const config: Config = { schedule: "* * * * *" };
