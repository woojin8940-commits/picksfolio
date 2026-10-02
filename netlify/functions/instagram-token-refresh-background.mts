import {
  dispatchRefreshWorker,
  runRefreshWorker,
  verifyRefreshWorkerRequest,
} from "./_shared/instagram-token-refresh.mts";

/**
 * 인스타그램 토큰 갱신 백그라운드 작업자(최대 15분).
 *
 * 예약 함수가 깨우거나, 앞선 작업자가 시간이 다 돼 넘겨줄 때 불린다. 서명이 맞는
 * 요청만 받는다. 시간 안에 다 못 끝내면 다음 작업자를 깨워 같은 실행을 이어 간다 —
 * 그래서 계정 수가 몇 개든 하루 안에 모두 갱신된다. 자세한 구조는
 * _shared/instagram-token-refresh.mts.
 */
export default async (req: Request) => {
  if (req.method !== "POST") return;
  const body = await req.text();
  if (body.length > 512 || !verifyRefreshWorkerRequest(body, req.headers.get("x-token-refresh-signature"))) return;

  let runId = "";
  try {
    runId = String(JSON.parse(body)?.runId || "");
  } catch {
    return;
  }
  if (!/^[a-f0-9-]{36}$/.test(runId)) return;

  try {
    const result = await runRefreshWorker(runId);
    if (result === "continue") {
      // 넘겨주기에 실패해도 진행 위치는 저장돼 있다. 다음 시간의 예약 함수가 이어 깨운다.
      const ok = await dispatchRefreshWorker(runId);
      if (!ok) console.warn(`[ig-token] run ${runId}: 다음 작업자 호출 실패 — 예약 함수가 이어 받습니다.`);
    }
  } catch (e) {
    console.error(`[ig-token] run ${runId} worker error:`, (e as Error)?.message);
  }
};
