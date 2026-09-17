import { getStore } from "@netlify/blobs";
import { graphHostFor, isTokenInvalidError, type MetaLink } from "./instagram-metrics.mts";

/**
 * 연동 계정의 피드 게시물 목록 — 받아오기와 보관을 한곳에 모은다.
 *
 * 자동 디엠 화면은 "어느 게시물에 자동화를 걸까"를 고르는 화면이라, 게시물 격자가
 * 뜨기 전에는 아무것도 할 수 없다. 그런데 이 목록은 계정을 연동한 직후에 가장
 * 절실하고, 하필 그때가 가장 느리다 — 그래프 API 를 여러 번 왕복해야 하고, 모바일
 * 회선에서는 그 왕복이 길어져 함수 실행 시간(10초)을 넘기기도 했다. 넘기면 화면은
 * 빈 응답을 받아 "불러올 게시물이 없어요"라고 말했다. 게시물이 있는 사람에게
 * 게시물이 없다고 말하는 화면이었고, 다시 시도할 방법도 주지 않았다.
 *
 * 그래서 두 가지를 여기서 처리한다.
 *
 *   1. 첫 화면은 항상 시간 예산 안에서 끝낸다(`collectFeed`). 예산을 다 쓰면 모은
 *      만큼과 이어보기 커서를 돌려주고, 나머지는 화면이 이어서 받는다. 한 번에 다
 *      모으려다 통째로 실패하는 것보다 50개라도 먼저 보이는 편이 낫다.
 *   2. 받아 온 첫 페이지는 보관해 둔다(`writeFeedCache`). 계정을 연동하는 순간
 *      콜백이 미리 채워 두므로(instagram-oauth-callback), 연동을 마치고 화면으로
 *      돌아온 사람은 그래프 API 왕복 없이 곧바로 자기 게시물을 본다.
 *
 * 커서를 그대로 화면에 내려보내지 않는 것도 여기서 지킨다. 그래프 API 의
 * `paging.next` 는 액세스 토큰이 박힌 완성된 URL 이라, 그대로 돌려주면 브라우저에
 * 계정 토큰을 넘기는 셈이 된다. 토큰이 없는 `paging.cursors.after` 만 주고받고
 * 요청 주소는 서버에서 다시 만든다.
 */

/** 화면에 필요한 필드만. 인사이트 지표는 이 목록의 용도가 아니다. */
const FEED_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";

/** 한 번에 요청할 게시물 수 (그래프 API 권장 상한). */
export const FEED_PAGE_SIZE = 50;

/** 한 응답에 담을 최대 게시물 수. 화면은 이어보기로 그 너머까지 받는다. */
export const FEED_MAX_ITEMS = 400;

/** 그래프 API 한 번 호출에 허용할 시간. 하나가 멎어도 전체 예산을 먹지 않게. */
const PER_REQUEST_TIMEOUT_MS = 5_000;

export interface FeedMediaItem {
  id: string;
  caption: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl: string;
  permalink: string;
  timestamp: string;
}

const toFeedItem = (m: any): FeedMediaItem => ({
  id: String(m?.id || ""),
  caption: String(m?.caption || ""),
  mediaType: String(m?.media_type || ""),
  // 동영상은 media_url 이 재생용이므로 썸네일을 우선 노출한다.
  mediaUrl: String(m?.thumbnail_url || m?.media_url || ""),
  thumbnailUrl: String(m?.thumbnail_url || ""),
  permalink: String(m?.permalink || ""),
  timestamp: String(m?.timestamp || ""),
});

export type FeedPage =
  | { ok: true; items: FeedMediaItem[]; after: string }
  | { ok: false; error: string; tokenInvalid: boolean };

/** 사람이 읽을 수 있는 실패 문구. 메타의 영문 원문은 로그에만 남긴다. */
const FEED_ERROR_MESSAGE = "인스타그램에서 게시물을 받지 못했습니다. 잠시 후 다시 시도해 주세요.";
export const FEED_REAUTH_MESSAGE =
  "인스타그램 연동이 만료됐습니다. 계정을 다시 연동해 주세요.";

/**
 * 게시물 한 페이지를 받아온다.
 *
 * `after` 는 이전 응답이 준 커서다(토큰이 들어 있지 않은 `paging.cursors.after`).
 */
export async function fetchFeedPage(
  link: MetaLink,
  opts: { after?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<FeedPage> {
  const token = String(link?.accessToken || "");
  if (!token) return { ok: false, error: FEED_REAUTH_MESSAGE, tokenInvalid: true };

  const host = graphHostFor(link.tokenSource);
  const limit = Math.min(Math.max(1, opts.limit || FEED_PAGE_SIZE), FEED_PAGE_SIZE);
  const endpoint =
    `https://${host}/me/media?fields=${encodeURIComponent(FEED_FIELDS)}` +
    `&limit=${limit}` +
    (opts.after ? `&after=${encodeURIComponent(opts.after)}` : "") +
    `&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(endpoint, { signal: opts.signal ?? AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS) });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const raw = data?.error?.message || `HTTP ${res.status}`;
      const tokenInvalid = isTokenInvalidError(data);
      console.warn(`[ig-feed] 목록 조회 실패 (${link.igUsername || "?"}): ${raw}`);
      return {
        ok: false,
        error: tokenInvalid ? FEED_REAUTH_MESSAGE : FEED_ERROR_MESSAGE,
        tokenInvalid,
      };
    }
    const items = (Array.isArray(data?.data) ? data.data : []).map(toFeedItem);
    // 다음 페이지가 실제로 있을 때만 커서를 넘긴다. 그래프 API 는 마지막 페이지에도
    // cursors.after 를 주기 때문에, 그것만 보고 이어가면 빈 페이지를 한 번 더 받는다.
    const after = data?.paging?.next ? String(data?.paging?.cursors?.after || "") : "";
    return { ok: true, items, after };
  } catch (e: any) {
    const aborted = e?.name === "AbortError" || e?.name === "TimeoutError";
    console.warn(`[ig-feed] 목록 조회 오류: ${aborted ? "시간 초과" : e?.message || e}`);
    return { ok: false, error: FEED_ERROR_MESSAGE, tokenInvalid: false };
  }
}

export interface CollectedFeed {
  items: FeedMediaItem[];
  /** 더 받을 게 남았으면 이어보기 커서. 다 받았으면 빈 문자열. */
  after: string;
  /** 한 건도 못 받았을 때의 실패 사유. 도중에 실패하면 모은 만큼과 함께 전달한다. */
  error: string;
  /** 다시 동의가 필요한 토큰인지. */
  tokenInvalid: boolean;
}

/**
 * 시간 예산 안에서 받을 수 있는 만큼 모은다.
 *
 * 예산을 두는 이유는 응답이 반드시 돌아오게 하기 위해서다. 게시물이 수백 개인
 * 계정에서 끝까지 모으려 들면 함수 실행 시간을 넘겨 응답 자체가 사라지고, 화면은
 * 그것을 "게시물 없음"과 구별하지 못한다.
 */
export async function collectFeed(
  link: MetaLink,
  opts: { after?: string; budgetMs?: number; maxItems?: number } = {},
): Promise<CollectedFeed> {
  const budgetMs = opts.budgetMs ?? 4_000;
  const maxItems = Math.min(opts.maxItems ?? FEED_MAX_ITEMS, FEED_MAX_ITEMS);
  const deadline = Date.now() + budgetMs;

  const items: FeedMediaItem[] = [];
  let cursor = opts.after || "";
  let error = "";
  let tokenInvalid = false;

  do {
    const page = await fetchFeedPage(link, { after: cursor });
    if (!page.ok) {
      error = page.error;
      tokenInvalid = page.tokenInvalid;
      break;
    }
    for (const item of page.items) {
      if (items.length >= maxItems) break;
      items.push(item);
    }
    cursor = page.after;
    if (!cursor || items.length >= maxItems) break;
    // 다음 왕복을 시작할 여유가 없으면 여기서 멈추고 커서를 넘긴다.
  } while (Date.now() < deadline);

  return { items, after: cursor, error, tokenInvalid };
}

/* ─────────────────────────── 보관함 ─────────────────────────── */

/**
 * 설정 문서(dm-automation)와 보관함을 나눠 둔다. 그쪽 보관함은 `dm_` 접두사로
 * 훑는 곳이 여럿이라(웹훅 역인덱스·토큰 갱신), 성격이 다른 값을 같이 두지 않는다.
 */
const FEED_STORE = "instagram-feed-cache";

/** 보관한 목록을 그대로 믿는 기간. 지나면 다시 받아오되, 실패하면 이 값으로 그린다. */
export const FEED_CACHE_TTL_MS = 5 * 60_000;

export interface CachedFeed {
  items: FeedMediaItem[];
  after: string;
  /** 어느 인스타그램 계정의 목록인지. 계정을 갈아 끼우면 남의 게시물을 보여주면 안 된다. */
  igUserId: string;
  updatedAt: string;
}

const feedKey = (username: string) => `feed_${username.toLowerCase()}`;

export async function readFeedCache(username: string): Promise<CachedFeed | null> {
  try {
    const store = getStore({ name: FEED_STORE, consistency: "strong" });
    const raw = (await store.get(feedKey(username), { type: "json" })) as CachedFeed | null;
    if (!raw || !Array.isArray(raw.items)) return null;
    return raw;
  } catch (e) {
    console.warn("[ig-feed] 보관된 목록 읽기 실패:", (e as Error)?.message);
    return null;
  }
}

export async function writeFeedCache(
  username: string,
  value: { items: FeedMediaItem[]; after: string; igUserId: string },
): Promise<void> {
  try {
    const store = getStore({ name: FEED_STORE, consistency: "strong" });
    await store.setJSON(feedKey(username), {
      items: value.items,
      after: value.after,
      igUserId: String(value.igUserId || ""),
      updatedAt: new Date().toISOString(),
    } satisfies CachedFeed);
  } catch (e) {
    // 보관은 빠르게 보여주기 위한 것이라, 실패해도 이번 응답은 이미 정확하다.
    console.warn("[ig-feed] 목록 보관 실패:", (e as Error)?.message);
  }
}

export async function clearFeedCache(username: string): Promise<void> {
  try {
    const store = getStore({ name: FEED_STORE, consistency: "strong" });
    await store.delete(feedKey(username));
  } catch (e) {
    console.warn("[ig-feed] 목록 보관 삭제 실패:", (e as Error)?.message);
  }
}

/** 보관한 목록이 이 계정의 것이고 아직 신선한지. */
export const feedCacheFresh = (cached: CachedFeed | null, igUserId: string): boolean => {
  if (!cached) return false;
  if (cached.igUserId && igUserId && cached.igUserId !== igUserId) return false;
  const at = Date.parse(cached.updatedAt || "");
  return Number.isFinite(at) && Date.now() - at < FEED_CACHE_TTL_MS;
};

/**
 * 계정을 연동하는 순간 첫 페이지를 미리 받아 둔다.
 *
 * 연동을 마치고 화면으로 돌아온 사람이 게시물 격자를 곧바로 보게 하는 것이 목적이다.
 * 실패해도 연동 자체는 성공이므로 조용히 넘어간다 — 화면이 직접 받아오는 길이 남아 있다.
 *
 * 연동 콜백은 이미 토큰 교환·프로필 조회·웹훅 구독·지표 수집을 줄줄이 하는 자리라,
 * 여기에 긴 대기를 얹으면 연동 자체가 함수 실행 시간을 넘겨 실패할 수 있다. 미리
 * 받아두기는 빠르게 보여주기 위한 것이지 연동의 조건이 아니므로 시간을 짧게 끊는다.
 */
export async function warmFeedCache(
  username: string,
  link: MetaLink,
  timeoutMs = 2_500,
): Promise<number> {
  try {
    const page = await fetchFeedPage(link, {
      limit: FEED_PAGE_SIZE,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!page.ok) return 0;
    await writeFeedCache(username, {
      items: page.items,
      after: page.after,
      igUserId: String(link.igUserId || link.igAccountId || ""),
    });
    return page.items.length;
  } catch (e) {
    console.warn("[ig-feed] 연동 직후 목록 미리받기 실패:", (e as Error)?.message);
    return 0;
  }
}
