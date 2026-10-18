import type { Config } from "@netlify/functions";
import { dispatchAffiliateWorker } from "./_shared/affiliate-worker.mts";

/**
 * 미검증 주문 재확인 — 10분마다.
 *
 * 무통장 입금처럼 주문완료 때 아직 결제 전인 주문을 카페24 에서 다시 확인한다.
 * 입금되면 미검증 → 예정으로 바뀌어 성과에 잡힌다. 실제 조회는 백그라운드 작업자가 한다.
 */
export default async () => {
  await dispatchAffiliateWorker({ task: "recheck" });
};

export const config: Config = {
  schedule: "*/10 * * * *",
};
