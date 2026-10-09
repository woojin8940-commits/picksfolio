import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { dmAutomationAllowed } from "./_shared/dm-automation-access.mts";
import { enqueueCommentEvents, type QueuedComment } from "./_shared/dm-jobs.mts";
import { graphHostFor, linkFeatureOff, type MetaLink } from "./_shared/instagram-metrics.mts";
import { getSupabaseServer } from "./_shared/supabase.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { randomUUID } from "node:crypto";

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
 *  - 웹훅이 빠뜨린 댓글이 실제로 나온 게시물만 자주 본다. 웹훅이 잘 오는 게시물은
 *    대부분이라, 이런 게시물은 30분에 한 번 안전망으로만 본다.
 *  - 웹훅이 빠뜨리는 게시물도 댓글이 뜸해지면 확인 간격을 1분 → 2분 → 5분 → 10분으로
 *    늘린다. 새 댓글이 보이면 바로 매분으로 돌아간다.
 *  - 지난번에 본 시점 이후의 댓글만 읽는다. 그래프 API 는 댓글을 최신순으로 주므로
 *    (2026-10 운영 계정 게시물로 확인) 이미 본 시각보다 오래된 댓글이 나오면 그 뒤
 *    페이지는 넘기지 않는다. 순서가 어긋난 응답이면 예전처럼 끝까지 읽는다.
 *  - 자동화를 켠 계정만 순회한다. 목록은 10분마다, 그리고 자동화 설정이 바뀐 계정은
 *    다음 실행에서 다시 판정한다(api-dm-automation 이 `dirty` 에 계정을 적는다).
 *  - 여러 계정을 동시에 본다.
 *
 * 처음 보는 게시물은 자동화 생성 시각 이후의 최근 댓글부터 확인한다. 자동화 생성 전의
 * 댓글은 제외하고, 이미 대기열에 있는 댓글은 다시 등록하지 않는다. 확인을 시작한 뒤
 * 한동안은 매분 본다 — 웹훅이
 * 오지 않는 게시물을 10분 간격까지 기다리지 않고 바로 찾아내기 위해서다.
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
/** 처음 기준을 잡은 게시물을 매분 보는 기간. 그 사이 누락이 없으면 10분 간격으로 바뀐다. */
const PROBE_MS = 30 * 60 * 1000;
/** 웹훅이 잘 오는 게시물을 안전망으로 다시 보는 간격. */
const HEALTHY_INTERVAL_MS = 30 * 60 * 1000;
/**
 * 웹훅이 댓글을 빠뜨린 게시물을 '웹훅이 오지 않는 게시물'로 기억하는 기간. 그 뒤로도
 * 빠지면 다시 연장된다. 이 기간에는 아래 QUIET_STEPS 간격으로 본다.
 */
const SILENT_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * 웹훅이 오지 않는 게시물의 확인 간격. [마지막 댓글 이후 지난 시간 이내, 확인 간격].
 * 댓글이 달리는 동안은 매분 보고, 조용해질수록 덜 본다.
 */
const QUIET_STEPS: [number, number][] = [
  [10 * 60 * 1000, 60 * 1000],
  [30 * 60 * 1000, 2 * 60 * 1000],
  [2 * 60 * 60 * 1000, 5 * 60 * 1000],
  [Infinity, 10 * 60 * 1000],
];
/** 예약 실행 시각이 몇 초씩 어긋나도 차례를 건너뛰지 않도록 간격에서 빼 주는 여유. */
const SCHEDULE_SLACK_MS = 15_000;
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
const INVENTORY_REFRESH_MS = 10 * 60 * 1000;
/** 순회 목록 형식. 바뀌면 목록을 처음부터 다시 만든다(2: 자동화를 켠 계정만). */
const INVENTORY_VERSION = 2;
const LEASE_MS = 90_000;

const STATE_STORE = "dm-comment-sweep";

type MediaState = {
  checkedAt?: number;
  missedAt?: number;
  probeUntil?: number;
  baselineAt?: number;
  after?: string;
  scanFrom?: number;
  scanAt?: number;
  /** 이 게시물에서 마지막으로 본 댓글의 시각. 확인 간격을 정할 때 쓴다. */
  activeAt?: number;
};
type SweepState = {
  version?: number;
  media?: Record<string, MediaState>;
  recent?: { ids: string[]; at: number };
  allowedAt?: number;
  /** allowedAt 에 판정한 이용 자격. 자격이 없던 계정도 10분 동안 다시 묻지 않는다. */
  allowed?: boolean;
  nextMedia?: string;
};
type SchedulerState = {
  keys?: string[];
  refreshedAt?: number;
  refreshVersion?: number;
  cachedVersion?: number;
  inventoryVersion?: number;
  /** 자동화 설정이 바뀌어 다시 판정할 계정 키(api-dm-automation 이 적는다). */
  dirty?: string[];
  lastKey?: string;
  owner?: string;
  leaseUntil?: number;
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
  return [...ids];
}

/** 이번 실행에서 이 게시물을 볼 차례인지. 처음 보는 게시물은 바로 기준을 잡는다. */
function mediaDue(media: MediaState | undefined, now: number): boolean {
  if (media?.scanAt) return true;
  if (!media?.checkedAt) return true;
  if (media.probeUntil && now < media.probeUntil) return true;
  const elapsed = now - media.checkedAt + SCHEDULE_SLACK_MS;
  if (media.missedAt && now - media.missedAt < SILENT_HOLD_MS) {
    const quiet = now - Math.max(media.activeAt || 0, media.missedAt);
    return elapsed >= QUIET_STEPS.find(([within]) => quiet < within)![1];
  }
  return elapsed >= HEALTHY_INTERVAL_MS;
}

/** 순회할 계정인지 — 자동 DM 스위치와 켜진 자동화가 모두 있어야 한다. */
function sweepable(settings: Settings | null): boolean {
  return Boolean(settings?.enabled && settings.accessToken && (settings.igUserId || settings.igAccountId) &&
    !linkFeatureOff(settings, "dm") && (settings.automations || []).some((rule) => rule?.enabled));
}

/** 키 중 순회할 계정만 고른다. 설정을 못 읽은 계정은 남긴다. 시간이 모자라면 null. */
async function activeKeys(store: ReturnType<typeof getStore>, keys: string[], deadline: number) {
  const active: string[] = [];
  for (let offset = 0; offset < keys.length; offset += 20) {
    if (Date.now() >= deadline) return null;
    const batch = keys.slice(offset, offset + 20);
    const docs = await Promise.all(batch.map((key) =>
      (store.get(key, { type: "json" }) as Promise<Settings | null>).catch(() => undefined)));
    batch.forEach((key, i) => {
      if (docs[i] === undefined || sweepable(docs[i]!)) active.push(key);
    });
  }
  return active;
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
  const snapshot = await stateStore.getWithMetadata(stateKey, { type: "json" });
  const state = (snapshot?.data || {}) as SweepState;
  if (state.version !== 2) {
    state.media = {};
    delete state.nextMedia;
    state.version = 2;
  }
  const now = Date.now();
  const save = (media: Record<string, MediaState> | undefined) =>
    stateStore.set(stateKey, JSON.stringify({ ...state, media }),
      snapshot?.etag ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true });
  // 자격은 발송 직전에 처리기가 다시 확인하므로 여기서는 10분에 한 번만 본다.
  if (!state.allowedAt || now - state.allowedAt >= ACCOUNT_REFRESH_MS) {
    state.allowed = await dmAutomationAllowed(username, settings.ownerAuthUserId);
    state.allowedAt = now;
    if (!state.allowed) {
      await save(state.media);
      return 0;
    }
  } else if (state.allowed === false) {
    return 0;
  }

  const host = graphHostFor(settings.tokenSource);
  const ownName = String(settings.igUsername || "").toLowerCase();
  // 자동화를 만들기 전에 달린 댓글에는 보내지 않는다(웹훅도 그런 댓글은 받지 않는다).
  const targets = await targetMedia(host, igId, token, rules, state, deadline);
  const mediaState: Record<string, MediaState> = {};
  for (const id of targets) mediaState[id] = state.media?.[id] || {};
  const start = Math.max(0, targets.indexOf(state.nextMedia || ""));
  const ordered = [...targets.slice(start), ...targets.slice(0, start)].slice(0, MAX_MEDIA_PER_ACCOUNT);

  const events: QueuedComment[] = [];
  let pagesRead = 0;
  for (const mediaId of ordered) {
    if (Date.now() >= deadline || pagesRead >= MAX_COMMENT_PAGES) break;
    const media = mediaState[mediaId];
    state.nextMedia = targets[(targets.indexOf(mediaId) + 1) % targets.length];
    if (!mediaDue(media, now)) continue;
    const created = rules
      .filter((rule) => rule.mediaScope !== "selected" || rule.mediaIds?.includes(mediaId))
      .map((rule) => Date.parse(rule.createdAt || ""))
      .filter(Number.isFinite);
    const since = Math.max(now - LOOKBACK_MS, created.length ? Math.min(...created) : media.baselineAt || now);
    if (media.baselineAt === undefined) {
      // 처음 보는 게시물 — 자동화 생성 시각 이후의 최근 댓글부터 확인한다.
      media.baselineAt = since;
      media.probeUntil = now + PROBE_MS;
    }
    // 기준 시각보다 앞선 댓글은 겹쳐 읽는 구간에 들어와도 보내지 않는다.
    if (media.scanAt === undefined) {
      media.scanAt = now;
      media.scanFrom = Math.max(since, (media.checkedAt ?? since) - OVERLAP_MS);
      media.after = "";
    }
    const from = Math.max(now - LOOKBACK_MS, media.scanFrom ?? since);
    let complete = false;
    let after = media.after || "";
    // 지금까지 받은 댓글이 최신순인지. 한 번이라도 어긋나면 일찍 멈추지 않는다.
    let newestFirst = true;
    let previousAt = Infinity;
    while (pagesRead < MAX_COMMENT_PAGES && Date.now() < deadline) {
      const params = new URLSearchParams({ fields: "id,text,from,username,timestamp", limit: "50" });
      if (after) params.set("after", after);
      const page = await graphGet(host, `${encodeURIComponent(mediaId)}/comments`, token, params, deadline)
        .catch((e) => {
          console.warn("[dm-sweep] comments read failed:", (e as Error)?.message);
          return null;
        });
      if (!page) {
        media.after = "";
        break;
      }
      pagesRead += 1;
      for (const comment of page.data) {
        const commentId = String(comment?.id || "");
        const commentAt = Date.parse(String(comment?.timestamp || ""));
        const authorId = String(comment?.from?.id || "");
        const authorName = String(comment?.from?.username || comment?.username || "");
        if (!commentId || Number.isNaN(commentAt)) continue;
        if (commentAt > previousAt) newestFirst = false;
        previousAt = commentAt;
        if (commentAt > now) continue;
        if (!(authorId === igId || (ownName && authorName.toLowerCase() === ownName))) {
          media.activeAt = Math.max(media.activeAt || 0, commentAt);
        }
        if (commentAt < from) continue;
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
      // 최신순이면 이미 본 시각보다 오래된 댓글이 나온 뒤로는 새 댓글이 없다.
      if (!next || (newestFirst && previousAt < from)) {
        complete = true;
        break;
      }
      if (next === after) {
        media.after = "";
        break;
      }
      after = next;
      media.after = after;
    }
    // 끝까지 못 읽었으면 확인 시각을 남기지 않는다 — 다음 실행이 저장된 페이지부터 이어 읽는다.
    if (complete) {
      media.checkedAt = media.scanAt;
      delete media.after;
      delete media.scanFrom;
      delete media.scanAt;
    }
    if (Date.now() >= deadline) break;
  }

  const missed = events.length > 0 ? await notYetQueued(events) : [];
  for (const event of missed) {
    const media = mediaState[String(event.change.value.media.id)];
    if (!media) continue;
    if (Number(event.entryTime) * 1000 <= now - MISS_GRACE_MS) media.missedAt = now;
    else media.probeUntil = Math.max(media.probeUntil || 0, now + PROBE_MS);
  }
  if (missed.length > 0) await enqueueCommentEvents(missed);

  // 자동화에서 빠진 게시물의 기록은 버린다.
  await save(mediaState);
  return missed.length;
}

export default async () => {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const owner = randomUUID();
  const acquired = await mutateBlobJSON<SchedulerState>(STATE_STORE, "scheduler", (current) => {
    if ((current?.leaseUntil || 0) > Date.now()) return null;
    return { ...current, owner, leaseUntil: Date.now() + LEASE_MS };
  });
  if (acquired?.owner !== owner) return;
  const store = getStore({ name: "dm-automation", consistency: "strong" });
  try {
    let keys = acquired.keys || [];
    const handled = new Set(acquired.dirty || []);
    const clearHandled = (current: SchedulerState) => (current.dirty || []).filter((key) => !handled.has(key));
    if (acquired.inventoryVersion !== INVENTORY_VERSION || !acquired.refreshedAt ||
      acquired.cachedVersion !== acquired.refreshVersion ||
      Date.now() - acquired.refreshedAt >= INVENTORY_REFRESH_MS) {
      const cachedVersion = acquired.refreshVersion;
      const inventory: string[] = [];
      for await (const page of store.list({ prefix: "dm_", paginate: true })) {
        inventory.push(...page.blobs.map((blob) => blob.key));
        if (Date.now() >= deadline) return;
      }
      const active = await activeKeys(store, [...new Set(inventory)], deadline);
      if (!active) return;
      keys = active.sort();
      await mutateBlobJSON<SchedulerState>(STATE_STORE, "scheduler", (current) =>
        current?.owner === owner ? {
          ...current, keys, refreshedAt: Date.now(), cachedVersion, inventoryVersion: INVENTORY_VERSION,
          dirty: clearHandled(current),
        } : null);
    } else if (handled.size > 0) {
      // 설정이 바뀐 계정만 다시 판정한다 — 방금 켠 자동화가 10분을 기다리지 않게.
      const active = await activeKeys(store, [...handled], deadline);
      if (active) {
        const next = new Set(keys);
        handled.forEach((key) => next.delete(key));
        active.forEach((key) => next.add(key));
        keys = [...next].sort();
        await mutateBlobJSON<SchedulerState>(STATE_STORE, "scheduler", (current) =>
          current?.owner === owner ? { ...current, keys, dirty: clearHandled(current) } : null);
      }
    }
    const start = acquired.lastKey ? keys.findIndex((key) => key > acquired.lastKey!) : 0;
    const offset = start < 0 ? 0 : start;
    // 시간이 모자라 뒤쪽 계정이 매번 밀리지 않도록 마지막 확인 위치부터 순회한다.
    const ordered = [...keys.slice(offset), ...keys.slice(0, offset)];
    for (let next = 0; next < ordered.length && Date.now() < deadline; next += CONCURRENCY) {
      const batch = ordered.slice(next, next + CONCURRENCY);
      const checkpoint = await mutateBlobJSON<SchedulerState>(STATE_STORE, "scheduler", (current) =>
        current?.owner === owner && (current.leaseUntil || 0) > Date.now()
          ? { ...current, lastKey: batch[batch.length - 1] } : null);
      if (checkpoint?.owner !== owner || (checkpoint.leaseUntil || 0) <= Date.now()) return;
      await Promise.all(batch.map(async (key) => {
        try {
          const settings = await store.get(key, { type: "json" }) as Settings | null;
          if (settings && Date.now() < deadline) await sweepAccount(key.slice(3), settings, deadline);
        } catch (e) {
          console.warn("[dm-sweep] account sweep failed:", (e as Error)?.message);
        }
      }));
    }
  } finally {
    await mutateBlobJSON<SchedulerState>(STATE_STORE, "scheduler", (current) =>
      current?.owner === owner ? { ...current, owner: "", leaseUntil: 0 } : null);
  }
};

export const config: Config = { schedule: "* * * * *" };
