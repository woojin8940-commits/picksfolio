import type { Config } from "@netlify/functions";
import {
  RUN_INTERVAL_MS,
  STALE_RUN_MS,
  dispatchRefreshWorker,
  newRunState,
  readRunState,
  saveNewRun,
} from "./_shared/instagram-token-refresh.mts";

/**
 * 인스타그램 장기 액세스 토큰 자동 갱신 — 시작 · 감시 담당.
 *
 * 실제 갱신은 백그라운드 작업자(instagram-token-refresh-background)가 한다. 예약 함수는
 * 약 30초면 끝나므로 계정을 직접 돌지 않고, 매시간 진행 상태 하나만 읽어 판단한다.
 *   - 오늘 실행이 이미 끝났다 → 아무것도 하지 않는다.
 *   - 실행 중이고 작업자가 최근에 진행을 알렸다 → 기다린다.
 *   - 실행 중인데 작업자 소식이 끊겼다(배포 · 장애로 중단) → 남은 자리부터 다시 깨운다.
 *   - 마지막 실행이 끝난 지 하루 가까이 지났다 → 새 실행을 연다.
 *
 * 그래서 어느 단계에서 끊겨도 한 시간 안에 이어지고, 계정이 많아지면 작업자가 여러
 * 번에 나눠 끝까지 간다. 구조 설명은 _shared/instagram-token-refresh.mts.
 */
export default async () => {
  const state = await readRunState();
  const now = Date.now();

  if (state && !state.finishedAt) {
    const quietFor = now - Date.parse(state.heartbeatAt || state.startedAt);
    if (Number.isFinite(quietFor) && quietFor < STALE_RUN_MS) {
      console.log(`[ig-token] run ${state.runId} in progress — waiting`);
      return;
    }
    console.warn(`[ig-token] run ${state.runId} stalled — resuming from saved cursor`);
    await dispatchRefreshWorker(state.runId);
    return;
  }

  if (state?.finishedAt && now - Date.parse(state.finishedAt) < RUN_INTERVAL_MS) return;

  const next = newRunState();
  await saveNewRun(next);
  console.log(`[ig-token] starting run ${next.runId}`);
  await dispatchRefreshWorker(next.runId);
};

export const config: Config = {
  // 매시간 상태만 확인한다(가볍다). 실제 갱신은 하루 한 번, 만료 14일 전부터 매일 시도한다.
  schedule: "41 * * * *",
};
