import { getStore } from "@netlify/blobs";
import {
  intOf,
  linkIsUsable,
  linkNeedsReauth,
  loadMetaLink,
  isTokenInvalidError,
  markLinkNeedsReauth,
  REAUTH_MESSAGE,
  type MetaLink,
  type MetaLinkScope,
  type MetaFailureCode,
} from "./instagram-metrics.mts";
import { todayInSeoul } from "./campaign-recruit.mts";

/**
 * 인플루언서 본인 화면("인사이트")이 읽는 릴스 성과.
 *
 * 이 파일은 새 연동을 만들지 않는다. 이미 붙어 있는 토큰(캠페인 등록에서 붙인
 * collab 연동, 없으면 디엠 자동화의 dm 연동)을 그대로 빌려 쓴다. 연동·해제·토큰
 * 갱신 규칙은 전부 instagram-metrics.mts 와 기존 화면들의 것이고, 여기서는
 * 아무것도 고치지 않는다 — 읽기만 한다.
 *
 * ── 왜 instagram-metrics.mts 를 그대로 쓰지 않는가 ──
 *
 * 그 파일은 "브랜드 명단에 보여줄 평균값"을 만든다. 릴스 6개를 남기고 나머지는
 * 평균으로 접는다. 인사이트 화면이 필요한 것은 반대다 — 평균이 아니라 릴스 한
 * 편 한 편의 도달·저장수이고, 목록은 정렬해 볼 수 있을 만큼 길어야 한다.
 * 게다가 그쪽 결과는 creator_channels 테이블에 저장돼 브랜드가 보는 숫자가 된다.
 * 본인이 화면을 새로고침하는 것과 브랜드 명단의 숫자가 바뀌는 것은 같은 일이
 * 아니므로, 조회 경로를 따로 둔다.
 *
 * ── 도달·저장수·공유 ──
 *
 * 조회수·좋아요·댓글은 기존 경로와 같다. 도달(reach)·저장수(saved)·공유(shares)는
 * 미디어의 일반 필드가 아니라 인사이트 지표이고, instagram_business_manage_insights
 * 권한이 있어야 내려온다(instagram-oauth-start.mts 의 SCOPES 에 이미 들어 있다).
 * 권한이 없거나 메타 앱 심사 범위 밖이면 그 항목만 비고, 나머지는 그대로 보인다.
 *
 * ── 왜 캐시하는가 ──
 *
 * 릴스 24편이면 인사이트 확장이 막힐 때 최대 스무 번 넘게 그래프를 부른다. 화면을
 * 새로고침할 때마다 그러면 메타의 시간당 호출 한도를 사람 한 명이 혼자 태운다.
 * 그래서 계정별로 블롭에 굳혀 두고 TTL 안에는 같은 값을 돌려준다. 사람이 직접
 * "새로 불러오기"를 누른 경우에만 TTL 을 무시한다.
 */

/** 목록에 보여줄 릴스 수. 정렬을 바꿔 볼 만큼은 되고, 한 번의 함수 실행에 담긴다. */
export const REELS_LIMIT = 24;
/** 릴스를 채우려고 넘겨 볼 미디어 페이지 수 상한(사진이 많은 계정 대비). */
const MAX_PAGES = 3;
/** 한 페이지에 요청할 미디어 수. */
const PAGE_SIZE = 50;
/** 릴스별 인사이트를 따로 부를 때의 동시 실행 수. */
const INSIGHT_CHUNK = 6;

/** 캐시 유효 시간(분). 몇 분 단위로 새로고침해도 메타를 다시 부르지 않는다. */
export const CACHE_TTL_MINUTES = 30;

/**
 * 인사이트·댓글 권한이 메타 앱 심사를 통과한 날.
 *
 * 승인 전에 발급된 토큰에는 이 권한이 붙어 있지 않다. 심사 전에는 앱 역할이 없는
 * 일반 사용자에게 메타가 그 범위를 내주지 않기 때문이다. 그리고 토큰 갱신(장기
 * 토큰 재발급)으로는 범위가 늘어나지 않는다 — 사람이 동의 화면을 한 번 더 지나야
 * 한다. 그래서 옛 토큰을 들고 있는 계정에게는 화면이 재연동을 권해야 하고, 그
 * 판단에 이 날짜를 쓴다.
 *
 * 이 값은 "언제부터 권한이 내려오는가"의 기준선일 뿐이다. 심사 전에도 앱에 역할이
 * 있던 계정(테스트 계정 등)은 값을 받았을 수 있으므로, 아래 판정은 도달·저장수가
 * 실제로 비어 있을 때만 함께 본다.
 */
export const INSIGHTS_APPROVED_AT = Date.parse("2026-08-30T00:00:00Z");

/** 이 연동의 토큰이 권한 승인 전에 발급된 것인가. */
export function tokenPredatesInsightsApproval(link: MetaLink): boolean {
  const stamped = Date.parse(String((link as { updatedAt?: string }).updatedAt || ""));
  // 언제 받은 토큰인지 기록이 없으면 옛 코드가 쓴 연동이다 — 승인 전으로 본다.
  if (!Number.isFinite(stamped)) return true;
  return stamped < INSIGHTS_APPROVED_AT;
}
const CACHE_STORE = "creator-insights";

export interface InsightReel {
  id: string;
  permalink: string;
  thumbnailUrl: string;
  caption: string;
  timestamp: string;
  views: number;
  /** 도달. 권한이 없으면 null — 0 으로 두면 아무에게도 안 닿은 릴스로 읽힌다. */
  reach: number | null;
  /** 저장수. 권한이 없으면 null. */
  saved: number | null;
  /**
   * 공유 수. 권한이 없으면 null.
   *
   * 좋아요·댓글과 달리 미디어의 일반 필드가 아니라 인사이트 지표다. 그래서 도달·저장수와
   * 같은 조건에서 함께 오거나 함께 빈다.
   */
  shares: number | null;
  likes: number;
  comments: number;
  /** 영상 길이(초). 메타가 안 주는 계정도 있어 못 받으면 null. */
  durationSeconds: number | null;
}

export interface InsightsPayload {
  igUsername: string;
  followers: number | null;
  following: number | null;
  reels: InsightReel[];
  /** 조회수를 한 편이라도 받았는지. */
  viewsAvailable: boolean;
  /** 도달·저장수를 한 편이라도 받았는지(= 인사이트 권한이 실제로 통했는지). */
  insightsAvailable: boolean;
  /** 이 값을 메타에서 받아 온 시각. */
  fetchedAt: string;
}

export type InsightsResult =
  | { ok: true; payload: InsightsPayload; cached: boolean }
  | { ok: false; error: string; status: number; code: MetaFailureCode };

/** "Instagram API with Instagram Login" 토큰은 graph.instagram.com 을 쓴다. */
const graphHostFor = (tokenSource?: string) =>
  tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com";

/** 미디어 목록에서 항상 받을 수 있는 필드들. */
const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp," +
  "like_count,comments_count";

/**
 * 필드 조합 사다리. 위에서부터 시도하고, 거절되면 위험한 부분을 하나씩 떨어뜨린다.
 *
 * 한 번에 다 받아 오는 게 호출 수로는 가장 싸다. 그런데 계정 권한·API 버전에
 * 따라 특정 지표나 필드 하나 때문에 요청 전체가 400 으로 돌아온다. 그때 목록까지
 * 같이 잃으면 화면은 빈 카드가 되므로, 목록만이라도 남는 조합까지 내려간다.
 */
const FIELD_LADDER = [
  `${MEDIA_FIELDS},duration,insights.metric(views,reach,saved,shares)`,
  `${MEDIA_FIELDS},duration,insights.metric(views,reach,saved)`,
  `${MEDIA_FIELDS},insights.metric(views,reach,saved)`,
  `${MEDIA_FIELDS},insights.metric(views)`,
  MEDIA_FIELDS,
];

/** 인사이트 응답에서 지표 이름 → 값 표를 만든다. */
const insightsMap = (payload: any): Record<string, number> => {
  const out: Record<string, number> = {};
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    const name = String(row?.name || "");
    if (!name) continue;
    const value = Array.isArray(row?.values) ? row.values[0]?.value : row?.value;
    if (typeof value !== "undefined" && value !== null) out[name] = intOf(value);
  }
  return out;
};

/** 릴스 한 편의 인사이트를 따로 받아 온다. 실패는 빈 표로 둔다. */
async function fetchOneInsight(
  graphHost: string,
  token: string,
  mediaId: string,
): Promise<Record<string, number>> {
  if (!mediaId) return {};
  const ask = async (metrics: string) => {
    const res = await fetch(
      `https://${graphHost}/${encodeURIComponent(mediaId)}/insights?metric=${metrics}` +
        `&access_token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return null;
    return insightsMap((await res.json().catch(() => ({}))) as any);
  };
  try {
    // 도달·저장수·공유까지 한 번에. 지표 하나가 막히면 그 요청은 통째로 거절되므로
    // 한 칸씩 줄여 내려간다 — 마지막에는 조회수만이라도 받아 둔다.
    return (
      (await ask("views,reach,saved,shares")) ||
      (await ask("views,reach,saved")) ||
      (await ask("views")) ||
      {}
    );
  } catch {
    return {};
  }
}

/** 릴스인지. 세로 영상은 media_product_type 이 REELS 로 오고, 예전 영상은 VIDEO 다. */
const isReel = (m: any) =>
  String(m?.media_product_type || "").toUpperCase() === "REELS" ||
  String(m?.media_type || "").toUpperCase() === "VIDEO";

/** 영상 길이(초). 메타는 초 또는 밀리초로 주는 경우가 있어 둘 다 받아 준다. */
const durationOf = (m: any): number | null => {
  const raw = m?.duration ?? m?.video_duration;
  if (typeof raw === "undefined" || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 300 초를 넘는 릴스는 없다. 그런 값이면 밀리초로 온 것이다.
  return n > 300 ? Math.round(n / 1000) : Math.round(n);
};

/**
 * 어느 연동으로 인사이트를 읽을지 고른다.
 *
 * 캠페인 등록에서 붙인 연동(collab)을 먼저 본다. 그 자리에서 "이 계정으로 등록한다"를
 * 직접 고른 계정이라 본인이 알고 있는 계정이다. 그게 없으면 디엠 자동화 연동(dm)을
 * 쓴다 — 새로 인증 흐름을 만들지 않는다는 것이 이 화면의 전제이고, 이미 붙여 둔
 * 계정이 있는데 "연동해 주세요"만 보여 주면 사람은 같은 계정을 두 번 붙이게 된다.
 * 어느 연동을 읽었는지는 화면에 @아이디로 함께 보여 주므로, 사람이 보는 숫자가
 * 어느 계정의 것인지 모르는 상태는 생기지 않는다.
 *
 * 여기서 토큰을 고치거나 지우는 일은 없다. 읽기만 한다.
 */
export async function resolveInsightsLink(
  username: string,
): Promise<{ link: MetaLink | null; scope: MetaLinkScope | null; needsReauth: boolean }> {
  const order: MetaLinkScope[] = ["collab", "dm"];
  let needsReauth = false;
  let fallback: MetaLink | null = null;

  for (const scope of order) {
    const link = await loadMetaLink(username, scope);
    if (linkIsUsable(link)) return { link, scope, needsReauth: false };
    if (linkNeedsReauth(link)) {
      needsReauth = true;
      fallback = fallback || link;
    }
  }

  return { link: fallback, scope: null, needsReauth };
}

/**
 * 계정별 캐시 키. 사용자명은 소문자 영문·숫자·밑줄·점만 남긴다.
 *
 * 판 번호(`v2`)는 굳혀 둔 값의 모양이 바뀔 때 올린다. 예전 판에는 공유 수가 없어서,
 * 키를 그대로 두면 이미 캐시가 있는 계정은 TTL 이 끝날 때까지 공유 수가 빈 그래프를
 * 계속 본다.
 */
const cacheKey = (username: string) =>
  `reels_v2_${String(username || "").toLowerCase().replace(/[^a-z0-9._-]/g, "_")}`;

/** 굳혀 둔 값을 읽는다. TTL 이 지났으면 null. */
async function readCache(
  username: string,
  ttlMinutes: number,
): Promise<InsightsPayload | null> {
  try {
    const store = getStore({ name: CACHE_STORE, consistency: "eventual" });
    const cached = (await store.get(cacheKey(username), { type: "json" })) as InsightsPayload | null;
    if (!cached?.fetchedAt) return null;
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (!Number.isFinite(age) || age < 0) return null;
    if (age > ttlMinutes * 60 * 1000) return null;
    return cached;
  } catch (e) {
    console.warn("[creator-insights] 캐시 읽기 실패:", (e as Error)?.message);
    return null;
  }
}

/**
 * 굳혀 둔 값을 유효기간 없이 읽는다.
 *
 * 태그된 콘텐츠 목록이 쓴다. 그쪽은 "이 값이 최신인가"보다 "조회수를 한 줄이라도
 * 채울 수 있는가"가 중요하다 — 크리에이터가 자기 화면에서 릴스 성과를 한 번이라도
 * 열었으면 그때 받아 둔 편별 조회수가 여기 남아 있고, 그 값은 메타를 다시 부르지
 * 않고도 쓸 수 있다. 며칠 전 숫자라도 빈칸보다는 브랜드에게 훨씬 쓸모 있고, 화면에는
 * 언제 받은 값인지 함께 적힌다.
 *
 * TTL 을 보는 `readCache` 와 굳이 나눈 이유는, 크리에이터 화면은 오래된 값을 그대로
 * 보여주면 안 되기 때문이다(그쪽은 30분이 지나면 다시 받는다).
 */
export async function readCachedInsights(username: string): Promise<InsightsPayload | null> {
  try {
    const store = getStore({ name: CACHE_STORE, consistency: "eventual" });
    const cached = (await store.get(cacheKey(username), { type: "json" })) as InsightsPayload | null;
    return cached?.fetchedAt ? cached : null;
  } catch (e) {
    console.warn("[creator-insights] 캐시 읽기 실패:", (e as Error)?.message);
    return null;
  }
}

async function writeCache(username: string, payload: InsightsPayload): Promise<void> {
  try {
    const store = getStore({ name: CACHE_STORE, consistency: "eventual" });
    await store.setJSON(cacheKey(username), payload);
  } catch (e) {
    // 캐시를 못 남겨도 이번 응답은 정상이다. 다음 요청이 메타를 한 번 더 부를 뿐.
    console.warn("[creator-insights] 캐시 쓰기 실패:", (e as Error)?.message);
  }
}

/** 프로필(팔로워·팔로잉·아이디)만 따로 읽는다. 스냅샷 배치도 이걸 쓴다. */
export async function fetchProfileCounts(
  link: MetaLink,
): Promise<{ ok: boolean; igUsername: string; followers: number | null; following: number | null; tokenDead: boolean }> {
  const token = String(link.accessToken || "");
  const graphHost = graphHostFor(link.tokenSource);
  try {
    const res = await fetch(
      `https://${graphHost}/me?fields=username,followers_count,follows_count` +
        `&access_token=${encodeURIComponent(token)}`,
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      return {
        ok: false,
        igUsername: String(link.igUsername || ""),
        followers: null,
        following: null,
        tokenDead: isTokenInvalidError(data),
      };
    }
    return {
      ok: true,
      igUsername: String(data?.username || link.igUsername || ""),
      followers:
        typeof data?.followers_count === "undefined" ? null : intOf(data.followers_count),
      following: typeof data?.follows_count === "undefined" ? null : intOf(data.follows_count),
      tokenDead: false,
    };
  } catch (e) {
    console.warn("[creator-insights] 프로필 조회 실패:", (e as Error)?.message);
    return {
      ok: false,
      igUsername: String(link.igUsername || ""),
      followers: null,
      following: null,
      tokenDead: false,
    };
  }
}

/**
 * 릴스 목록 + 편당 지표를 받아 온다.
 *
 * 실패해도 받을 수 있는 것은 남긴다. 도달을 못 받는다고 조회수·좋아요까지 버릴
 * 이유가 없고, 조회수를 못 받는다고 목록을 버릴 이유도 없다.
 */
async function fetchReelsFromMeta(link: MetaLink): Promise<InsightsResult> {
  const token = String(link.accessToken || "");
  if (!token) {
    return { ok: false, error: REAUTH_MESSAGE, status: 409, code: "META_TOKEN_INVALID" };
  }
  const graphHost = graphHostFor(link.tokenSource);

  const askPage = async (fields: string, cursor: string | null) => {
    const endpoint =
      cursor ||
      `https://${graphHost}/me/media?fields=${encodeURIComponent(fields)}` +
        `&limit=${PAGE_SIZE}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(endpoint);
    const data = (await res.json().catch(() => ({}))) as any;
    return { ok: res.ok, status: res.status, data };
  };

  // 사다리를 내려가며 첫 페이지를 받아 본다. 성공한 조합으로 나머지 페이지도 넘긴다.
  let fields = "";
  let first: { ok: boolean; status: number; data: any } | null = null;
  for (const candidate of FIELD_LADDER) {
    const attempt = await askPage(candidate, null);
    if (attempt.ok) {
      fields = candidate;
      first = attempt;
      break;
    }
    // 토큰이 죽었으면 필드를 줄여 다시 불러도 같은 실패다. 남은 시도를 아낀다.
    if (isTokenInvalidError(attempt.data)) {
      console.warn(
        `[creator-insights] 토큰 만료/권한 해제 (${link.igUsername || "?"}): ` +
          `${attempt.data?.error?.message || `HTTP ${attempt.status}`}`,
      );
      return { ok: false, error: REAUTH_MESSAGE, status: 409, code: "META_TOKEN_INVALID" };
    }
    first = attempt;
  }

  if (!fields || !first?.ok) {
    // 메타 원문은 로그에만 남긴다. 영문 오류를 화면에 그대로 올리면 읽는 사람이
    // 할 수 있는 일이 없다.
    console.warn(
      `[creator-insights] 메타 API 오류 (${link.igUsername || "?"}): ` +
        `${first?.data?.error?.message || `HTTP ${first?.status ?? 0}`}`,
    );
    return {
      ok: false,
      error: "인스타그램에서 릴스 정보를 받지 못했습니다. 잠시 후 다시 시도해 주세요.",
      status: 502,
      code: "META_ERROR",
    };
  }

  // 릴스가 REELS_LIMIT 개 모일 때까지 커서를 따라간다. 사진만 올리는 계정에서
  // 무한히 넘기지 않도록 페이지 수에 상한을 둔다.
  const raw: any[] = [];
  let page = first;
  for (let i = 0; i < MAX_PAGES; i++) {
    const items = Array.isArray(page.data?.data) ? page.data.data : [];
    for (const m of items) if (isReel(m)) raw.push(m);
    if (raw.length >= REELS_LIMIT) break;
    const next = items.length > 0 ? (page.data?.paging?.next as string) || null : null;
    if (!next) break;
    const attempt = await askPage(fields, next);
    // 도중에 실패하면 모은 만큼으로 만든다. 뒤쪽 페이지는 더 오래된 릴스다.
    if (!attempt.ok) break;
    page = attempt;
  }

  const reelsRaw = raw.slice(0, REELS_LIMIT);

  // 목록 요청에 인사이트가 실려 왔으면 그대로 쓴다. 하나도 안 왔으면 릴스별로 부른다.
  let metrics: Record<string, number>[] = reelsRaw.map((m) => insightsMap(m?.insights));
  const gotAnything = metrics.some((row) => Object.keys(row).length > 0);
  if (reelsRaw.length > 0 && !gotAnything) {
    metrics = [];
    for (let i = 0; i < reelsRaw.length; i += INSIGHT_CHUNK) {
      const slice = reelsRaw.slice(i, i + INSIGHT_CHUNK);
      metrics.push(
        ...(await Promise.all(
          slice.map((m) => fetchOneInsight(graphHost, token, String(m?.id || ""))),
        )),
      );
    }
  }

  const reels: InsightReel[] = reelsRaw.map((m, i) => {
    const row = metrics[i] || {};
    const hasReach = typeof row.reach !== "undefined";
    const hasSaved = typeof row.saved !== "undefined";
    const hasShares = typeof row.shares !== "undefined";
    return {
      id: String(m?.id || ""),
      permalink: String(m?.permalink || ""),
      // 영상은 media_url 이 동영상 파일이라 썸네일을 먼저 쓴다.
      thumbnailUrl: String(m?.thumbnail_url || m?.media_url || ""),
      caption: String(m?.caption || "").slice(0, 200),
      timestamp: String(m?.timestamp || ""),
      views: intOf(row.views ?? 0),
      reach: hasReach ? intOf(row.reach) : null,
      saved: hasSaved ? intOf(row.saved) : null,
      shares: hasShares ? intOf(row.shares) : null,
      likes: intOf(m?.like_count),
      comments: intOf(m?.comments_count),
      durationSeconds: durationOf(m),
    };
  });

  const profile = await fetchProfileCounts(link);

  return {
    ok: true,
    cached: false,
    payload: {
      igUsername: profile.igUsername || String(link.igUsername || ""),
      followers: profile.followers,
      following: profile.following,
      reels,
      viewsAvailable: reels.some((r) => r.views > 0),
      insightsAvailable: reels.some((r) => r.reach !== null || r.saved !== null),
      fetchedAt: new Date().toISOString(),
    },
  };
}

/**
 * 인사이트 조회 진입점. 캐시가 살아 있으면 메타를 부르지 않는다.
 *
 * `force` 는 사람이 "새로 불러오기"를 누른 경우다. 그때만 TTL 을 무시한다 —
 * 페이지를 열 때마다 무시하면 캐시를 둔 이유가 없어진다.
 */
export async function getReelInsights(
  username: string,
  link: MetaLink,
  scope: MetaLinkScope,
  opts: { force?: boolean; ttlMinutes?: number } = {},
): Promise<InsightsResult> {
  const ttl = opts.ttlMinutes ?? CACHE_TTL_MINUTES;
  if (!opts.force) {
    const cached = await readCache(username, ttl);
    if (cached) return { ok: true, payload: cached, cached: true };
  }

  const fresh = await fetchReelsFromMeta(link);
  if (!fresh.ok) {
    // 토큰이 죽은 것이 확인되면 다른 화면들도 같은 사실을 알아야 한다. 표시를
    // 남기는 것은 기존 규칙(instagram-metrics)의 함수에 맡긴다.
    if (fresh.code === "META_TOKEN_INVALID") await markLinkNeedsReauth(username, scope);
    // 새로 못 받았어도 지난번에 굳혀 둔 값이 있으면 그것을 보여 준다. 빈 화면보다
    // "몇 시간 전 기준"이 낫다.
    const stale = await readCache(username, 24 * 60);
    if (stale) return { ok: true, payload: stale, cached: true };
    return fresh;
  }

  await writeCache(username, fresh.payload);
  return fresh;
}

// ---------------------------------------------------------------------------
// 팔로워 스냅샷 (2단계 — 증감 추이 그래프)
// ---------------------------------------------------------------------------

export interface FollowerSnapshot {
  date: string;
  followers: number;
  following: number;
}

/**
 * 오늘(한국 날짜) 팔로워 수를 한 줄 남긴다.
 *
 * 하루 한 줄만 남기고 나중 값이 그날의 값이다. 배치가 새벽에 남긴 줄을 낮에 화면을
 * 연 사람의 실측값이 덮어쓰는 것은 문제가 되지 않는다 — 둘 다 같은 날 같은 계정의
 * 팔로워 수이고, 늦은 값이 더 최신이다.
 */
export async function recordFollowerSnapshot(
  db: any,
  username: string,
  followers: number | null,
  following: number | null,
  source: "batch" | "live",
): Promise<void> {
  // 팔로워 수를 못 받은 경우(권한 없음)에 0 을 남기면 그래프에 그 날 절벽이 생긴다.
  if (followers === null || !Number.isFinite(followers)) return;
  try {
    await db.sql`
      INSERT INTO creator_follower_snapshots (username, captured_on, followers, following, source)
      VALUES (${username}, ${todayInSeoul()}::date, ${followers}, ${following ?? 0}, ${source})
      ON CONFLICT (username, captured_on) DO UPDATE SET
        followers = EXCLUDED.followers,
        following = EXCLUDED.following,
        source = EXCLUDED.source
    `;
  } catch (e) {
    // 스냅샷을 못 남겨도 화면은 오늘 숫자를 보여 줄 수 있다. 그래프의 점 하나가 빈다.
    console.warn("[creator-insights] 스냅샷 저장 실패:", (e as Error)?.message);
  }
}

/**
 * 이미 알고 있는 과거 팔로워 수를 스냅샷으로 옮겨 둔다.
 *
 * 왜 필요한가 — 스냅샷 표는 하루에 한 줄씩만 쌓이므로, 표를 만든 날에 화면을 연
 * 사람에게는 점이 하나뿐이고 그래프에는 아무 선도 그려지지 않는다. 그런데 우리는
 * 그 사람의 과거 팔로워 수를 이미 한 번 확인해 둔 적이 있다 — creator_channels 의
 * followers 와 그 값을 받아 온 시각(synced_at)이다. 그 쌍은 만들어 낸 값이 아니라
 * 그날 실제로 관측한 값이므로, 스냅샷으로 옮겨도 그래프가 거짓말을 하지 않는다.
 *
 * 같은 날 줄이 이미 있으면 건드리지 않는다(DO NOTHING). 그날 배치나 본인 화면이
 * 남긴 값이 이 값보다 늦게 관측된 것일 수 있고, 늦은 관측이 그날의 값이다.
 */
export async function backfillSnapshotFromChannel(db: any, username: string): Promise<void> {
  try {
    await db.sql`
      INSERT INTO creator_follower_snapshots (username, captured_on, followers, following, source)
      SELECT username,
             (synced_at AT TIME ZONE 'Asia/Seoul')::date,
             followers,
             COALESCE(following, 0),
             'sync'
        FROM creator_channels
       WHERE username = ${username}
         AND synced_at IS NOT NULL
         AND followers > 0
      ON CONFLICT (username, captured_on) DO NOTHING
    `;
  } catch (e) {
    // 옮기지 못해도 오늘 점은 그대로 쌓인다. 그래프가 하루 늦게 그려질 뿐이다.
    console.warn("[creator-insights] 과거 팔로워 수 이전 실패:", (e as Error)?.message);
  }
}

/** 최근 N일 스냅샷. 오래된 것부터(그래프의 x축 순서) 돌려준다. */
export async function loadFollowerSeries(
  db: any,
  username: string,
  days: number,
): Promise<FollowerSnapshot[]> {
  const rows = (await db.sql`
    SELECT captured_on, followers, following
      FROM creator_follower_snapshots
     WHERE username = ${username}
       AND captured_on >= (${todayInSeoul()}::date - ${days - 1}::int)
     ORDER BY captured_on ASC
  `) as any[];

  return (rows || []).map((r) => ({
    // DATE 컬럼은 드라이버에 따라 Date 또는 문자열로 온다. 화면은 'YYYY-MM-DD' 만 쓴다.
    date: String(
      r.captured_on instanceof Date
        ? r.captured_on.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
        : r.captured_on,
    ).slice(0, 10),
    followers: intOf(r.followers),
    following: intOf(r.following),
  }));
}

/** 스냅샷이 처음 쌓인 날. 없으면 빈 문자열 — 화면이 "수집 중"을 말할 근거다. */
export async function firstSnapshotDate(db: any, username: string): Promise<string> {
  try {
    const rows = (await db.sql`
      SELECT MIN(captured_on) AS first_on
        FROM creator_follower_snapshots
       WHERE username = ${username}
    `) as any[];
    const raw = rows?.[0]?.first_on;
    if (!raw) return "";
    return String(
      raw instanceof Date
        ? raw.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
        : raw,
    ).slice(0, 10);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// 팔로워 인구통계 (1단계 — 팔로워 분석 탭)
// ---------------------------------------------------------------------------

/**
 * 팔로워의 성별·연령대·국가 분포를 받아 온다.
 *
 * ── 무슨 호출인가 ──
 *
 *   GET /me/insights
 *       ?metric=follower_demographics
 *       &period=lifetime
 *       &metric_type=total_value
 *       &breakdown=age|gender|country
 *       &timeframe=last_30_days
 *
 * 필요한 권한은 instagram_business_basic + instagram_business_manage_insights 둘뿐이고,
 * 둘 다 이미 승인받아 쓰고 있다(INSIGHTS_APPROVED_AT). 새 권한 신청은 필요 없다.
 *
 * ── breakdown 을 세 번 나눠 부르는 이유 ──
 *
 * `breakdown=age,gender` 처럼 묶어 보내면 메타는 교차표(20대 여성 …)를 준다. 화면이
 * 그리려는 것은 축별 분포 셋이라, 교차표를 받아 다시 합치면 반올림된 값을 우리가 또
 * 더하는 셈이 된다. 세 번 부르고 각각 독립적으로 실패하게 두는 편이 낫다 — 국가가
 * 막혀도 성별·연령대는 그려진다.
 *
 * ── 메타가 값을 안 주는 경우들 ──
 *
 * 1. 팔로워 100명 미만: 아예 지표가 안 나온다. 개인 식별을 막는 선이라 우리가 넘을
 *    방법이 없다. 그래서 호출 전에 팔로워 수로 먼저 걸러 낸다 — 안 될 호출로 메타의
 *    호출 한도를 태우지 않고, 화면에도 "권한 문제"가 아니라 진짜 이유를 적어 준다.
 * 2. 상위 45개까지만: 국가는 45개국에서 잘린다. 그래서 합계가 팔로워 수와 다르고,
 *    화면은 백분율을 "받은 값 안에서의 비율"로만 말해야 한다.
 * 3. 최대 48시간 지연: 오늘 늘어난 팔로워는 아직 안 섞여 있다.
 * 4. 값이 없으면 0 이 아니라 빈 배열이 온다. 없는 칸을 0 으로 채우면 "그 나이대는
 *    한 명도 없다"가 되는데, 실제로는 "메타가 말해 주지 않았다"다. 그대로 비운다.
 */
export const DEMOGRAPHICS_MIN_FOLLOWERS = 100;

/**
 * 인구통계 캐시 유효 시간(분).
 *
 * 릴스 지표(30분)보다 훨씬 길게 둔다. 이 값은 메타 쪽에서 하루 단위로 갱신되고
 * 최대 48시간 늦게 반영되므로, 자주 다시 불러도 같은 숫자가 온다. 여섯 시간이면
 * 하루에 계정당 네 번이고, 그 안에서 화면을 몇 번 열든 호출은 한 번이다.
 */
export const DEMOGRAPHICS_TTL_MINUTES = 6 * 60;

export type DemographicAxis = "age" | "gender" | "country";

/** 분포 한 칸. `key` 는 메타가 준 값 그대로(18-24 / F / KR), 이름 붙이기는 화면 몫이다. */
export interface DemographicSlice {
  key: string;
  value: number;
}

export interface FollowerDemographics {
  age: DemographicSlice[];
  gender: DemographicSlice[];
  country: DemographicSlice[];
  /**
   * 왜 비었는가. 빈 화면에 이유를 적기 위한 값이고, 셋 중 하나라도 값이 왔으면 빈
   * 문자열이다.
   *
   * - few_followers: 팔로워 100명 미만(메타가 정한 선)
   * - empty: 조건은 맞는데 메타가 빈 집합을 줬다(새 계정·집계 대기)
   * - denied: 요청이 거절됐다(권한·계정 종류)
   * - error: 네트워크 등 그 외
   */
  reason: "" | "few_followers" | "empty" | "denied" | "error";
  /** 이 값을 받아 온 시각. 화면이 "48시간까지 늦을 수 있음"을 함께 적는 근거. */
  fetchedAt: string;
}

const demographicsCacheKey = (username: string) =>
  `demographics_v1_${String(username || "").toLowerCase().replace(/[^a-z0-9._-]/g, "_")}`;

/** 축 하나를 받아 온다. 실패는 축 하나만 비우고 나머지에 영향을 주지 않는다. */
async function fetchOneBreakdown(
  graphHost: string,
  token: string,
  node: string,
  axis: DemographicAxis,
): Promise<{ slices: DemographicSlice[]; denied: boolean }> {
  const params = new URLSearchParams({
    metric: "follower_demographics",
    period: "lifetime",
    metric_type: "total_value",
    breakdown: axis,
    // 인구통계 지표에는 timeframe 이 필수다. 빼면 요청 자체가 거절된다.
    timeframe: "last_30_days",
    access_token: token,
  });
  try {
    const res = await fetch(
      `https://${graphHost}/${encodeURIComponent(node)}/insights?${params.toString()}`,
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      console.warn(
        `[creator-insights] 인구통계(${axis}) 거절:`,
        String(data?.error?.message || res.status),
      );
      return { slices: [], denied: true };
    }
    // total_value.breakdowns[].results[] → { dimension_values: ["18-24"], value: 12 }
    const rows = Array.isArray(data?.data) ? data.data : [];
    const breakdowns = rows[0]?.total_value?.breakdowns;
    const results = Array.isArray(breakdowns) ? breakdowns[0]?.results : null;
    if (!Array.isArray(results)) return { slices: [], denied: false };
    const slices: DemographicSlice[] = [];
    for (const row of results) {
      const key = String(row?.dimension_values?.[0] || "").trim();
      if (!key) continue;
      const value = intOf(row?.value);
      // 0 인 칸은 버린다. 메타가 값을 준 축에서 0 은 "그 칸에 아무도 없다"는 뜻이라
      // 사실이지만, 도넛·막대에 0 조각을 그리면 범례만 길어지고 읽을 게 없다.
      if (value > 0) slices.push({ key, value });
    }
    slices.sort((a, b) => b.value - a.value);
    return { slices, denied: false };
  } catch (e) {
    console.warn(`[creator-insights] 인구통계(${axis}) 조회 실패:`, (e as Error)?.message);
    return { slices: [], denied: false };
  }
}

/**
 * 팔로워 인구통계를 받아 온다(캐시 우선).
 *
 * `followers` 는 방금 프로필에서 받은 팔로워 수다. 100명 미만이면 메타를 부르지
 * 않는다. 못 받았으면(null) 걸러 내지 않고 그냥 불러 본다 — 팔로워 수를 모르는 것과
 * 100명 미만인 것은 다른 상황이고, 후자로 단정해 화면에 잘못된 이유를 적을 이유가 없다.
 */
export async function getFollowerDemographics(
  username: string,
  link: MetaLink,
  followers: number | null,
  opts: { force?: boolean } = {},
): Promise<FollowerDemographics> {
  const empty = (reason: FollowerDemographics["reason"]): FollowerDemographics => ({
    age: [],
    gender: [],
    country: [],
    reason,
    fetchedAt: new Date().toISOString(),
  });

  if (typeof followers === "number" && followers < DEMOGRAPHICS_MIN_FOLLOWERS) {
    return empty("few_followers");
  }

  const store = (() => {
    try {
      return getStore({ name: CACHE_STORE, consistency: "eventual" });
    } catch {
      return null;
    }
  })();

  if (!opts.force && store) {
    try {
      const cached = (await store.get(demographicsCacheKey(username), {
        type: "json",
      })) as FollowerDemographics | null;
      const age = cached?.fetchedAt ? Date.now() - new Date(cached.fetchedAt).getTime() : NaN;
      if (Number.isFinite(age) && age >= 0 && age <= DEMOGRAPHICS_TTL_MINUTES * 60 * 1000) {
        return cached as FollowerDemographics;
      }
    } catch (e) {
      console.warn("[creator-insights] 인구통계 캐시 읽기 실패:", (e as Error)?.message);
    }
  }

  const token = String(link.accessToken || "");
  const graphHost = graphHostFor(link.tokenSource);
  // 계정 아이디를 알면 그것으로 부른다. `me` 는 토큰이 가리키는 사용자로 풀리는데,
  // 페이스북 로그인으로 받은 토큰에서는 그게 인스타 계정이 아니라 페이스북 사용자다.
  const node = String(link.igUserId || link.igAccountId || "me");
  const [gender, age, country] = await Promise.all([
    fetchOneBreakdown(graphHost, token, node, "gender"),
    fetchOneBreakdown(graphHost, token, node, "age"),
    fetchOneBreakdown(graphHost, token, node, "country"),
  ]);

  const got = gender.slices.length + age.slices.length + country.slices.length;
  const payload: FollowerDemographics = {
    age: age.slices,
    gender: gender.slices,
    country: country.slices,
    reason: got > 0 ? "" : gender.denied && age.denied && country.denied ? "denied" : "empty",
    fetchedAt: new Date().toISOString(),
  };

  // 빈 결과도 굳혀 둔다. 새 계정은 며칠 동안 계속 빈 집합이 오는데, 그때마다 세 번씩
  // 다시 부르면 아무 값도 못 얻고 호출 한도만 쓴다. 거절(denied)은 남기지 않는다 —
  // 재연동으로 바로 풀릴 수 있는 상태를 여섯 시간 붙잡아 둘 이유가 없다.
  if (store && payload.reason !== "denied") {
    try {
      await store.setJSON(demographicsCacheKey(username), payload);
    } catch (e) {
      console.warn("[creator-insights] 인구통계 캐시 쓰기 실패:", (e as Error)?.message);
    }
  }

  return payload;
}
