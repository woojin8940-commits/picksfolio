import type { Config } from "@netlify/functions";
import { dispatchAffiliateWorker } from "./_shared/affiliate-worker.mts";
import { previousPeriod, todayKst } from "./_shared/affiliate.mts";

/**
 * 판매 수수료 월 마감 — 매월 1일 07:10 KST.
 *
 * 전월 말까지 구매확정된 주문을 브랜드별 청구서 · 인플루언서별 지급 내역으로 묶는다
 * (규칙: _shared/affiliate.mts 의 closePeriod). 새 청구서는 "브랜드 확인 대기"로 시작하고,
 * 브랜드가 승인해야 인플루언서 수익 화면에 나타난다.
 *
 * 크론은 UTC 로 돈다. 07:10 KST = 22:10 UTC(전날)이므로 매일 22:10 UTC 에 깨어나
 * 한국 날짜가 1일일 때만 마감한다. 매일 동기화(04:20 KST) 뒤에 돌도록 시각을 잡았다.
 * 같은 달을 다시 마감해도 이미 들어간 주문은 다시 들어가지 않는다.
 */
export default async () => {
  if (!todayKst().endsWith("-01")) return;
  await dispatchAffiliateWorker({ task: "close", period: previousPeriod() });
};

export const config: Config = {
  schedule: "10 22 * * *",
};
