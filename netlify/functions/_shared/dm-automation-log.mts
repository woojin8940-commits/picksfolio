import { getStore } from "@netlify/blobs";

/**
 * DM 자동화 발송 로그.
 *
 * 예전 구현은 사용자별로 배열 하나(`log_<username>`)를 읽어 앞에 끼워 넣고 다시
 * 통째로 쓰는 방식이었다. 웹훅은 댓글이 몰리면 동시에 여러 번 실행되는데, 그때
 * 두 인스턴스가 같은 배열을 읽으면 나중에 쓴 쪽이 상대의 기록을 통째로 덮어써서
 * 기록이 사라졌다. 장애 조사용 로그가 정작 트래픽이 몰릴 때 비어 있는 셈이다.
 *
 * 그래서 한 건당 블롭 하나로 바꿨다. 키가 서로 다르니 동시에 써도 겹치지 않는다.
 *   키 형식: `log_<username>/<ISO 시각>_<난수>`
 * ISO 시각은 사전순 정렬이 곧 시간순이라 최신 N건을 뽑기 쉽다.
 */

/** 사용자당 보관할 최대 건수. */
const KEEP = 50;
/** 정리(오래된 항목 삭제)를 시도할 확률. 매 요청마다 목록을 훑지 않기 위한 장치. */
const PRUNE_CHANCE = 0.15;

export interface DmLogEntry {
  at: string;
  [k: string]: unknown;
}

const prefixFor = (username: string) => `log_${username.toLowerCase()}/`;

/**
 * 로그 한 건을 남긴다. 실패해도 본 작업(DM 발송)에는 영향을 주지 않는다.
 */
export async function appendDmLog(
  username: string,
  entry: Record<string, unknown>,
  tag = "dm-log",
): Promise<void> {
  try {
    const store = getStore("dm-automation-log");
    const at = new Date().toISOString();
    const key = `${prefixFor(username)}${at}_${Math.random().toString(36).slice(2, 8)}`;
    await store.setJSON(key, { ...entry, at });

    if (Math.random() < PRUNE_CHANCE) await pruneDmLog(username);
  } catch (e) {
    console.error(`[${tag}] log write failed:`, (e as Error)?.message);
  }
}

/** 최신 순으로 로그를 읽는다. */
export async function readDmLog(username: string, limit = KEEP): Promise<DmLogEntry[]> {
  const store = getStore("dm-automation-log");
  const { blobs } = await store.list({ prefix: prefixFor(username) });
  const keys = blobs
    .map((b) => b.key)
    .sort()
    .reverse()
    .slice(0, limit);

  const entries = await Promise.all(
    keys.map(async (key) => {
      try {
        return (await store.get(key, { type: "json" })) as DmLogEntry | null;
      } catch {
        return null;
      }
    }),
  );
  return entries.filter(Boolean) as DmLogEntry[];
}

/** 보관 한도를 넘긴 오래된 항목을 지운다. */
export async function pruneDmLog(username: string): Promise<void> {
  try {
    const store = getStore("dm-automation-log");
    const { blobs } = await store.list({ prefix: prefixFor(username) });
    if (blobs.length <= KEEP) return;
    const stale = blobs
      .map((b) => b.key)
      .sort()
      .reverse()
      .slice(KEEP);
    await Promise.all(stale.map((key) => store.delete(key).catch(() => {})));
  } catch {
    // 정리는 실패해도 무방하다. 다음 기록 때 다시 시도한다.
  }
}
