import { getStore } from "@netlify/blobs";
import type { DmButton, DmCard } from "./instagram-dm.mts";

/**
 * 예약 DM 대기열.
 *
 * 키를 두 갈래로 나눠 둔다.
 *   `job/<사용자명>/<발송시각ISO>_<작업ID>`  아직 보내지 않은 예약
 *   `done/<사용자명>/<발송시각ISO>_<작업ID>` 발송을 끝낸(또는 실패한) 기록
 *
 * 1분마다 도는 발송기(scheduled-dm-sender)는 `job/` 만 훑는다. 끝난 기록을 같은
 * 곳에 두면 시간이 갈수록 매분 읽어야 할 블롭이 늘어나므로, 처리한 건은 `done/`
 * 으로 옮긴다. 발송 시각을 키에 넣어 두는 것도 같은 이유다 — 블롭을 열어보지 않고
 * 목록만으로 "지금 보낼 것"을 고를 수 있다.
 *
 * 정책 주의: 인스타그램은 상대가 마지막으로 메시지를 보낸 뒤 **24시간 안에만**
 * 자유 형식 DM 을 허용한다. 예약 발송은 그 창 안에서만 성립하므로, 대상은 최근에
 * DM 을 보내온 사람(`_shared/dm-contacts.mts`)에서 고르고, 창을 넘긴 발송은
 * Graph API 가 거부한다(오류 분류 `outside_window`). 여기서는 대기열만 다루고
 * 창 판정은 화면과 발송기가 각각 수행한다.
 */

const STORE = "dm-scheduled";
/** 사용자당 보관할 완료 기록 수. */
const HISTORY_KEEP = 50;
/**
 * 이 시간이 지난 선점은 죽은 실행이 남긴 것으로 본다.
 *
 * 발송기는 1분마다 돌고 한 건 처리에 몇 초가 걸린다. 10분은 정상 실행이 선점을
 * 붙잡고 있을 수 있는 시간보다 훨씬 길어, 정상 실행과 겹칠 걱정 없이 끊긴 실행만
 * 골라낼 수 있는 간격이다.
 */
const STALE_CLAIM_MS = 10 * 60 * 1000;

export interface DmScheduledJob {
  id: string;
  /** 발신 계정(우리 서비스 사용자명). */
  username: string;
  /** 받는 사람 IGSID. */
  recipientId: string;
  /** 화면 표시용 이름(조회에 실패했으면 비어 있다). */
  recipientName?: string;
  /** 보낼 시각(ISO, UTC). */
  sendAt: string;
  message: string;
  buttons: DmButton[];
  createdAt: string;
  status: "pending" | "sent" | "failed" | "canceled";
  sentAt?: string;
  error?: string;
  errorKind?: string;
  /** 예약을 만든 시점에 알고 있던 "상대의 마지막 메시지 시각". 창 안내에 쓴다. */
  contactLastAt?: string;
  /**
   * 이 예약을 누가 만들었는지.
   *
   *  `manual`  — 예약 발송 화면에서 사람이 직접 만든 예약(기본값).
   *  `comment` — 게시물 자동화가 "예약 발송"으로 설정돼 있어, 댓글이 달린 순간
   *              대기열에 들어온 예약. 발송 방식이 다르다(아래 commentId 참고).
   */
  source?: "manual" | "comment";
  /**
   * 발송 형식. 캐러셀로 설정한 게시물 자동화도 예약할 수 있어야 하므로, 텍스트
   * 한 가지로 고정하지 않는다. 값이 없으면 텍스트로 본다(예전 예약 호환).
   */
  messageType?: "text" | "carousel";
  cards?: DmCard[];
  /** 캐러셀과 함께 보낼 인사말(선택). */
  intro?: string;
  /**
   * 댓글에서 만들어진 예약이면 그 댓글 ID.
   *
   * 이 예약은 `recipient: { comment_id }` 비공개 답장으로 나간다. 댓글 작성자는
   * 우리에게 DM 을 보낸 적이 없을 수 있는데(대부분 그렇다), 비공개 답장은 그
   * 경우에도 **댓글 작성 후 7일 안에** 한 통 보낼 수 있다. 그래서 24시간 창 판정을
   * 그대로 적용하면 정상 발송할 수 있는 예약을 전부 실패로 만든다.
   */
  commentId?: string;
  /** 댓글이 달린 시각(ISO). 7일 창 판정에 쓴다. */
  commentAt?: string;
  /** 이 예약을 만든 자동화(기록·화면 표시용). */
  ruleId?: string;
  ruleName?: string;
}

const pendingPrefix = (username: string) => `job/${username.toLowerCase()}/`;
const donePrefix = (username: string) => `done/${username.toLowerCase()}/`;
const suffixOf = (job: Pick<DmScheduledJob, "sendAt" | "id">) => `${job.sendAt}_${job.id}`;

const store = () => getStore({ name: STORE, consistency: "strong" });

/** `job/<사용자명>/<시각>_<ID>` 를 열어보지 않고 해석한다. */
function parseKey(key: string): { username: string; sendAt: string; id: string } | null {
  const parts = key.split("/");
  if (parts.length < 3) return null;
  const username = parts[1];
  const tail = parts.slice(2).join("/");
  const cut = tail.indexOf("_");
  if (cut <= 0) return null;
  return { username, sendAt: tail.slice(0, cut), id: tail.slice(cut + 1) };
}

export async function createScheduledJob(job: DmScheduledJob): Promise<void> {
  await store().setJSON(`${pendingPrefix(job.username)}${suffixOf(job)}`, job);
}

/** 한 사용자의 예약 목록(대기 + 완료 기록)을 발송 시각 순으로 돌려준다. */
export async function listScheduledJobs(username: string): Promise<DmScheduledJob[]> {
  if (!username) return [];
  const s = store();
  try {
    const [pending, done] = await Promise.all([
      s.list({ prefix: pendingPrefix(username) }),
      s.list({ prefix: donePrefix(username) }),
    ]);
    const keys = [...pending.blobs, ...done.blobs].map((b) => b.key);
    const jobs = await Promise.all(
      keys.map(async (key) => {
        try {
          return (await s.get(key, { type: "json" })) as DmScheduledJob | null;
        } catch {
          return null;
        }
      }),
    );
    return (jobs.filter(Boolean) as DmScheduledJob[]).sort(
      (a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt),
    );
  } catch (e) {
    console.warn("[dm-schedule] list failed:", (e as Error)?.message);
    return [];
  }
}

/** 아직 보내지 않은 예약 하나를 취소(삭제)한다. 이미 나간 건은 취소할 수 없다. */
export async function cancelScheduledJob(username: string, id: string): Promise<boolean> {
  const s = store();
  const { blobs } = await s.list({ prefix: pendingPrefix(username) });
  const target = blobs.find((b) => parseKey(b.key)?.id === id);
  if (!target) return false;
  await s.delete(target.key);
  // 선점 표시도 같이 지운다. 남겨 두면 취소된 예약의 흔적이 계속 쌓인다.
  await s.delete(`claim/${target.key}`).catch(() => {});
  return true;
}

/**
 * 지금 보낼 차례가 된 예약을 모아 온다(모든 사용자).
 *
 * 키에 발송 시각이 들어 있어, 아직 시간이 안 된 예약은 블롭을 열어보지 않고
 * 건너뛴다.
 */
export async function listDueJobs(
  now: Date,
  limit = 50,
): Promise<{ key: string; job: DmScheduledJob }[]> {
  const s = store();
  const { blobs } = await s.list({ prefix: "job/" });
  const due = blobs
    .map((b) => ({ key: b.key, parsed: parseKey(b.key) }))
    .filter((entry) => {
      const at = Date.parse(entry.parsed?.sendAt || "");
      return !Number.isNaN(at) && at <= now.getTime();
    })
    .sort((a, b) => Date.parse(a.parsed!.sendAt) - Date.parse(b.parsed!.sendAt))
    .slice(0, limit);

  const loaded = await Promise.all(
    due.map(async (entry) => {
      try {
        const job = (await s.get(entry.key, { type: "json" })) as DmScheduledJob | null;
        return job ? { key: entry.key, job } : null;
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter(Boolean) as { key: string; job: DmScheduledJob }[];
}

/**
 * 처리를 끝낸 예약을 대기열에서 빼고 기록으로 옮긴다.
 *
 * 대기열에서 먼저 지운다 — 순서가 반대면, 기록을 쓴 직후 함수가 죽었을 때 같은
 * 예약이 다음 분에 한 번 더 발송된다.
 */
export async function finishJob(key: string, job: DmScheduledJob): Promise<void> {
  const s = store();
  try {
    await s.delete(key);
    // 선점 표시도 함께 정리한다. 대기열에서 이미 빠졌으니 다시 집어 들 일이 없고,
    // 남겨 두면 예약을 쓸 때마다 키가 하나씩 쌓인다.
    await s.delete(`claim/${key}`).catch(() => {});
  } catch (e) {
    console.warn("[dm-schedule] pending delete failed:", (e as Error)?.message);
  }
  try {
    await s.setJSON(`${donePrefix(job.username)}${suffixOf(job)}`, job);
    await pruneHistory(job.username);
  } catch (e) {
    console.warn("[dm-schedule] history write failed:", (e as Error)?.message);
  }
}

/**
 * 대기열에서 예약 하나를 선점한다.
 *
 * 발송기는 1분마다 돌고, 한 번의 실행이 1분을 넘기면 다음 실행과 겹친다. 대기
 * 블롭을 지우는 데 성공한 실행만 발송하도록 해서 같은 예약이 두 번 나가지 않게
 * 한다(블롭 삭제는 이미 지워진 키에도 오류를 내지 않으므로, 삭제 전에 값이 남아
 * 있었는지 조건부 쓰기로 확인한다).
 */
export async function claimJob(key: string, staleAfterMs = STALE_CLAIM_MS): Promise<boolean> {
  const s = store();
  const claimKey = `claim/${key}`;
  try {
    // 같은 키에 "선점됨" 표시를 조건부로 남길 수는 없으므로(값이 이미 있다),
    // 별도의 선점 키를 하나 만든다. 이 키는 발송이 끝나면 남겨 두더라도
    // `job/` 목록을 훑는 데 영향이 없다.
    const now = Date.now();
    const claim = await s.set(claimKey, "1", { onlyIfNew: true, metadata: { at: now } });
    if (claim?.modified !== false) return true;

    /**
     * 이미 선점된 예약.
     *
     * 보통은 같은 예약을 두 실행이 동시에 집으려 한 경우라 여기서 물러나는 것이
     * 맞다. 그런데 발송 도중 함수가 시간 초과로 끊기면(대기 건이 몰릴 때 생긴다)
     * 선점 표시만 남고 대기 블롭은 그대로라, 그 예약은 매분 "보낼 시간"으로 잡히면서
     * 영영 아무도 집지 못한다 — 화면에는 계속 "대기 중"으로 남는다. 그래서 충분히
     * 오래된 선점은 죽은 실행이 남긴 것으로 보고 다시 집는다.
     *
     * 다시 집을 때도 조건부 쓰기(`onlyIfMatch`)를 쓴다. 그러지 않으면 오래된 선점을
     * 본 두 실행이 함께 발송해 같은 DM 이 두 번 도착한다.
     */
    const meta = await s.getMetadata(claimKey);
    const at = Number((meta?.metadata as { at?: unknown } | undefined)?.at || 0);
    // 시각을 남기지 않은 예전 선점은 나이를 알 수 없으므로 건드리지 않는다.
    if (!at || !meta?.etag || now - at < staleAfterMs) return false;

    const retaken = await s.set(claimKey, "1", { onlyIfMatch: meta.etag, metadata: { at: now } });
    if (retaken?.modified === false) return false;
    console.warn(`[dm-schedule] stale claim re-taken: ${key}`);
    return true;
  } catch (e) {
    // 선점 기록에 실패했다면 발송을 막지 않는다 — 예약이 아예 안 나가는 쪽이 더 나쁘다.
    console.warn("[dm-schedule] claim failed:", (e as Error)?.message);
    return true;
  }
}

/**
 * 선점을 되돌린다.
 *
 * 처리 도중 예외가 나면 예약은 대기열에 그대로 남지만, 선점 표시가 남아 있으면
 * 다음 주기에도 집어 들지 못해 그 예약은 영영 나가지 않는다. 실패한 실행은 반드시
 * 선점을 풀어야 한다.
 */
export async function releaseJobClaim(key: string): Promise<void> {
  try {
    await store().delete(`claim/${key}`);
  } catch (e) {
    console.warn("[dm-schedule] claim release failed:", (e as Error)?.message);
  }
}

/** 보관 한도를 넘긴 오래된 완료 기록을 지운다. */
async function pruneHistory(username: string): Promise<void> {
  const s = store();
  const { blobs } = await s.list({ prefix: donePrefix(username) });
  if (blobs.length <= HISTORY_KEEP) return;
  const stale = blobs
    .map((b) => b.key)
    .sort()
    .reverse()
    .slice(HISTORY_KEEP);
  await Promise.all(stale.map((key) => s.delete(key).catch(() => {})));
}
