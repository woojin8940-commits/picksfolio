import { getDatabase } from "@picks/netlify-database";
import { runClose, runRecheck, runSync, verifyWorkerRequest } from "./_shared/affiliate-worker.mts";

/** 판매 연동 백그라운드 작업(주문 동기화 · 미검증 재확인 · 월 마감). 서명된 요청만 처리한다. */
export default async (req: Request) => {
  if (req.method !== "POST") return;
  const body = await req.text();
  if (body.length > 512 || !verifyWorkerRequest(body, req.headers.get("x-affiliate-worker-signature"))) return;
  let task: any;
  try {
    task = JSON.parse(body);
  } catch {
    return;
  }
  // 오래된 요청을 다시 보내는 것을 막는다.
  if (!Number.isFinite(task?.at) || Math.abs(Date.now() - Number(task.at)) > 10 * 60 * 1000) return;
  const db = getDatabase();
  try {
    if (task.task === "sync") await runSync(db);
    else if (task.task === "recheck") await runRecheck(db);
    else if (task.task === "close") await runClose(db, String(task.period || ""));
  } catch (e) {
    console.error(`[affiliate-worker] ${task.task} failed`, e instanceof Error ? e.message : "");
  }
};
