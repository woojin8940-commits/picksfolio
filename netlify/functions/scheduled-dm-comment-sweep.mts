import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { dmAutomationAllowed } from "./_shared/dm-automation-access.mts";
import { enqueueCommentEvents, type QueuedComment } from "./_shared/dm-jobs.mts";
import { graphHostFor, linkFeatureOff, type MetaLink } from "./_shared/instagram-metrics.mts";
import { getSupabaseServer } from "./_shared/supabase.mts";

/**
 * 웹훅으로 오지 않은 댓글을 직접 찾아 자동 DM 대기열에 넣는다.
 *
 * Meta 는 어떤 게시물의 댓글 웹훅을 아예 보내지 않는 경우가 있다. 실제로 같은 계정에서
 * 다른 게시물 댓글은 전부 들어오는데, 자동 DM 을 걸어 둔 게시물(댓글이 몰리는 홍보·광고
 * 릴스)의 댓글만 한 건도 오지 않았다. 웹훅만 기다리면 이런 댓글에는 아무 일도 일어나지
 * 않고 활동 기록도 남지 않아, 사용자에게는 "자동 DM 이 동작하지 않는다"로 보인다.
 *
 * 그래서 1분마다(예약 함수의 최소 주기) 자동화가 걸린 게시물의 최근 댓글을 그래프 API 로 읽어, 웹훅과 같은
 * 모양으로 대기열에 넣는다. 작업 ID 가 웹훅과 같은 `comment:<계정>:<댓글>` 이라 이미
 * 들어온 댓글은 무시되고, 발송 선점 기록(commentDmKey)이 한 번 더 중복 발송을 막는다.
 * 조건 판정(게시물·키워드·팔로우)과 발송은 웹훅 댓글과 똑같은 경로를 탄다.
 *
 * 계정이 늘어도 버티도록 확인량을 줄인다.
 *  - 웹훅이 빠뜨린 댓글이 실제로 나온 게시물만 1분마다 본다. 웹훅이 잘 오는 게시물은
 *    대부분이라, 이런 게시물은 10분에 한 번 안전망으로만 본다.
 *  - 지난번에 본 시점 이후의 댓글만 읽는다(보통 첫 페이지 한 번이면 끝난다).
 *  - 여러 계정을 동시에 본다.
 * 게시물별 확인 기록은 계정마다 블롭 하나(`acct_<IG ID>`)에 남긴다.
 */

const GRAPH_VERSION = "v21.0";
/** 실행 한 번에 쓸 시간. 예약 함수 제한(30초) 안에서 끝낸다. */
const RUN_BUDGET_MS = 22_000;
/**
 * 얼마나 오래된 댓글까지 챙길지. 비공개 답장 자체는 7일까지 가능하지만, 하루가 지난
 * 댓글에 뒤늦게 DM 이 가면 받는 사람이 어리둥절하다.
 */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** '모든 게시물' 자동화에서 살펴볼 최근 게시물 수. */
const RECENT_MEDIA = 6;
const MAX_MEDIA_PER_ACCOUNT = 20;
const MAX_COMMENT_PAGES = 4;
/** 웹훅이 잘 오는 게시물을 안전망으로 다시 보는 간격. */
const HEALTHY_INTERVAL_MS = 10 * 60 * 1000;
/** 웹훅이 댓글을 빠뜨린 게시물은 이 시간 동안 매분 본다. 그 뒤로도 빠지면 다시 연장된다. */
const SILENT_HOLD_MS = 24 * 60 * 60 * 1000;
/** '모든 게시물' 목록과 이용 자격 판정을 다시 확인하는 간격. */
const ACCOUNT_REFRESH_MS = 10 * 60 * 1000;
/** 지난번 확인 시각보다 이만큼 앞부터 읽는다(댓글 시각과 서버 시각의 어긋남 대비). */
const OVERLAP_MS = 3 * 60 * 1000;
/**
 * 이보다 오래된 댓글이 대기열에 없을 때만 "웹훅이 빠뜨렸다"고 본다. 방금 달린 댓글은
 * 웹훅이 몇 초 늦게 올 수 있어, 그것까지 세면 멀쩡한 게시물을 하루 내내 매분 보게 된다.
 */
const MISS_GRACE_MS = 2 * 60 * 1000;
/** 동시에 확인하는 계정 수. */
const CONCURRENCY = 8;

const STATE_STORE = "dm-comment-sweep";

type MediaState = { checkedAt?: number; missedAt?: number };
type SweepState = {
  media?: Record<string, MediaState>;
  recent?: { ids: string[]; at: number };
  allowedAt?: number;
};

type Rule = {
  id: string;
  enabled?: boolean;
  createdAt?: string;
  mediaScope?: string;
  mediaIds?: string[];
};

type Settings = MetaLink & {
  enabled?: boolean;
  igUserId?: string;
  igAccountId?: string;
  igUsername?: string;
  accessToken?: string;
  tokenSource?: string;
  ownerAuthUserId?: string;
  automations?: Rule[];
};

async function graphGet(host: string, path: string, token: string, params: URLSearchParams, deadline: number) {
  const response = await fetch(`https://${host}/${GRAPH_VERSION}/${path}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(Math.max(1_000, Math.min(8_000, deadline - Date.now()))),
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || !Array.isArray(body?.data)) {
    throw new Error(String(body?.error?.message || `Instagram HTTP ${response.status}`));
  }
  return body;
}

/** 자동화가 걸린 게시물 ID 들. '모든 게시물' 자동화가 있으면 최근 게시물을 더한다. */
async function targetMedia(
  host: string,
  igId: string,
  token: string,
  rules: Rule[],
  state: SweepState,
  deadline: number,
) {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (rule.mediaScope === "selected") (rule.mediaIds || []).forEach((id) => id && ids.add(String(id)));
  }
  if (rules.some((rule) => rule.mediaScope !== "selected")) {
    if (!state.recent || Date.now() - state.recent.at >= ACCOUNT_REFRESH_MS) {
      const params = new URLSearchParams({ fields: "id", limit: String(RECENT_MEDIA) });
      const page = await graphGet(host, `${encodeURIComponent(igId)}/media`, token, params, deadline);
      state.recent = {
        ids: page.data.map((item: any) => String(item?.id || "")).filter(Boolean),
        at: Date.now(),
      };
    }
    state.recent.ids.forEach((id) => ids.add(id));
  }
  return [...ids].slice(0, MAX_MEDIA_PER_ACCOUNT);
}

/** 이번 실행에서 이 게시물을 볼 차례인지. 처음 보는 게시물은 바로 본다. */
function mediaDue(media: MediaState | undefined, now: number): boolean {
  if (!media?.checkedAt) return true;
  if (media.missedAt && now - media.missedAt < SILENT_HOLD_MS) return true;
  return now - media.checkedAt >= HEALTHY_INTERVAL_MS;
}

/** 아직 대기열에 없는 댓글만 고른다(= 웹훅이 오지 않은 댓글). */
async function notYetQueued(events: QueuedComment[]): Promise<QueuedComment[]> {
  const fresh: QueuedComment[] = [];
  for (let offset = 0; offset < events.length; offset += 100) {
    const chunk = events.slice(offset, offset + 100);
    const ids = chunk.map((e) => `comment:${e.igAccountId}:${String(e.change.value.id)}`);
    const { data, error } = await getSupabaseServer().from("dm_jobs").select("id").in("id", ids);
    if (error) throw error;
    const known = new Set((data || []).map((row: any) => String(row.id)));
    fresh.push(...chunk.filter((_, i) => !known.has(ids[i])));
  }
  return fresh;
}

async function sweepAccount(username: string, settings: Settings, deadline: number): Promise<number> {
  const token = settings.accessToken || "";
  const igId = String(settings.igUserId || settings.igAccountId || "");
  const rules = (settings.automations || []).filter((rule) => rule?.enabled);
  if (!token || !igId || rules.length === 0) return 0;
  if (!settings.enabled || linkFeatureOff(settings, "dm")) return 0;

  const stateStore = getStore({ name: STATE_STORE, consistency: "strong" });
  const stateKey = `acct_${igId}`;
  const state = ((await stateStore.get(stateKey, { type: "json" }).catch(() => null)) || {}) as SweepState;
  const now = Date.now();
  // 자격은 발송 직전에 처리기가 다시 확인하므로 여기서는 10분에 한 번만 본다.
  if (!state.allowedAt || now - state.allowedAt >= ACCOUNT_REFRESH_MS) {
    if (!(await dmAutomationAllowed(username, settings.ownerAuthUserId))) return 0;
    state.allowedAt = now;
  }

  const host = graphHostFor(settings.tokenSource);
  const ownName = String(settings.igUsername || "").toLowerCase();
  // 자동화를 만들기 전에 달린 댓글에는 보내지 않는다(웹훅도 그런 댓글은 받지 않는다).
  const earliestRule = Math.min(
    ...rules.map((rule) => {
      const ms = Date.parse(rule.createdAt || "");
      return Number.isNaN(ms) ? 0 : ms;
    }),
  );
  const since = Math.max(Date.now() - LOOKBACK_MS, earliestRule);

  const targets = await targetMedia(host, igId, token, rules, state, deadline);
  const mediaState: Record<string, MediaState> = {};
  for (const id of targets) mediaState[id] = state.media?.[id] || {};

  const events: QueuedComment[] = [];
  for (const mediaId of targets) {
    const media = mediaState[mediaId];
    if (!mediaDue(media, now)) continue;
    const from = Math.max(since, media.checkedAt ? media.checkedAt - OVERLAP_MS : 0);
    let complete = false;
    let after = "";
    for (let pages = 0; pages < MAX_COMMENT_PAGES && Date.now() < deadline; pages++) {
      const params = new URLSearchParams({ fields: "id,text,from,username,timestamp", limit: "50" });
      if (after) params.set("after", after);
      const page = await graphGet(host, `${encodeURIComponent(mediaId)}/comments`, token, params, deadline)
        .catch((e) => {
          console.warn("[dm-sweep] comments read failed:", (e as Error)?.message);
          return null;
        });
      if (!page) break;
      let reachedOld = false;
      for (const comment of page.data) {
        const commentId = String(comment?.id || "");
        const commentAt = Date.parse(String(comment?.timestamp || ""));
        const authorId = String(comment?.from?.id || "");
        const authorName = String(comment?.from?.username || comment?.username || "");
        if (!commentId || Number.isNaN(commentAt)) continue;
        if (commentAt < from) {
          reachedOld = true;
          continue;
        }
        // 방금 달린 댓글도 바로 넣는다. 웹훅과 동시에 들어와도 작업 ID 가 같아 한 번만 처리된다.
        if (authorId === igId || (ownName && authorName.toLowerCase() === ownName)) continue;
        events.push({
          igAccountId: igId,
          entryTime: Math.floor(commentAt / 1000),
          change: {
            field: "comments",
            value: {
              id: commentId,
              text: String(comment?.text || ""),
              from: { id: authorId, username: authorName },
              media: { id: mediaId },
              timestamp: comment?.timestamp,
            },
          },
        });
      }
      const next = page?.paging?.next ? String(page?.paging?.cursors?.after || "") : "";
      if (reachedOld || !next || next === after) {
        complete = true;
        break;
      }
      after = next;
    }
    // 끝까지 못 읽었으면 확인 시각을 남기지 않는다 — 다음 실행이 같은 구간부터 다시 읽는다.
    if (complete) media.checkedAt = now;
    if (Date.now() >= deadline) break;
  }

  const missed = events.length > 0 ? await notYetQueued(events) : [];
  for (const event of missed) {
    if (Number(event.entryTime) * 1000 > now - MISS_GRACE_MS) continue;
    const media = mediaState[String(event.change.value.media.id)];
    if (media) media.missedAt = now;
  }
  if (missed.length > 0) await enqueueCommentEvents(missed);

  // 자동화에서 빠진 게시물의 기록은 버린다.
  await stateStore.setJSON(stateKey, { ...state, media: mediaState });
  return missed.length;
}

export default async () => {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const store = getStore({ name: "dm-automation", consistency: "strong" });
  const { blobs } = await store.list({ prefix: "dm_" });
  // 시간이 모자라 뒤쪽 계정이 매번 밀리지 않도록 순서를 섞는다.
  const keys = blobs.map((blob) => blob.key).sort(() => Math.random() - 0.5);

  let next = 0;
  const worker = async () => {
    while (next < keys.length && Date.now() < deadline) {
      const key = keys[next++];
      try {
        const settings = await store.get(key, { type: "json" }) as Settings | null;
        if (!settings) continue;
        await sweepAccount(key.slice(3), settings, deadline);
      } catch (e) {
        console.warn("[dm-sweep] account sweep failed:", (e as Error)?.message);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
};

export const config: Config = { schedule: "* * * * *" };
