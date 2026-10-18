import type { Config } from "@netlify/functions";
import { dispatchAffiliateWorker } from "./_shared/affiliate-worker.mts";

/**
 * 판매 주문 상태 동기화 — 하루 한 번(04:20 KST).
 *
 * 미확정 · 미검증 주문을 카페24 주문 API 로 다시 조회해 예정 → 확정 / 제외로 갱신한다.
 * 규칙은 _shared/affiliate.mts 의 syncOrder · evaluateOrder 에 있다. 시간이 오래 걸리므로
 * 실제 조회는 백그라운드 작업자가 한다(_shared/affiliate-worker.mts).
 */
export default async () => {
  await dispatchAffiliateWorker({ task: "sync" });
};

export const config: Config = {
  schedule: "20 19 * * *",
};
