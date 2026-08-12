import { getStore } from "@netlify/blobs";

/**
 * 메타(인스타그램) 지표 수집 — 픽스폴리오가 보관하는 숫자의 단일 출처.
 *
 * 브랜드 매칭 명단에서 브랜드가 실제로 보는 것은 팔로워 수가 아니라 최근 릴스의
 * 평균 조회수다. 그 숫자를 어디서 받아와 어디에 굳히는지를 이 파일 한 곳에 모은다.
 *
 * 이 로직을 부르는 곳이 두 군데다.
 *   1) 인스타그램 계정 연동 직후(instagram-oauth-callback) — 연동하는 순간 지표를 채운다.
 *   2) 이후 수동 갱신(api-creator-channel POST {action:'sync'}).
 *
 * 둘이 각자 그래프 API 를 호출하면 "연동은 했는데 명단에는 숫자가 없는" 상태가
 * 생긴다. 연동 시점에 한 번 채워 두면 운영자가 sync 를 누르기 전에도 명단이
 * 비어 보이지 않는다.
 *
 * 메타 앱 심사 범위에 따라 조회수가 거부될 수 있다. 그래서 여기서는 "받을 수 있는
 * 것만 받고, 못 받은 항목은 기존 값을 남긴다". 조회수를 못 받는다고 릴스 목록이나
 * 팔로워 수까지 포기할 이유는 없다.
 *
 * ── 조회수를 어디서 받는가 ──
 *
 * 조회수는 미디어의 일반 필드가 아니다. `view_count` 는 비즈니스 디스커버리(남의
 * 계정 조회) 전용 필드라 본인 계정 토큰(/me/media)으로 부르면 그 요청 전체가 실패한다.
 * 실패하면 조회수만 빠지는 게 아니라 릴스 목록까지 통째로 날아가므로, 일반 필드로는
 * 부르지 않는다.
 *
 * 대신 인사이트에서 받는다. 2025년 4월부터 메타가 plays·video_views·impressions 를
 * 없애고 `views` 하나로 합쳤으므로 지표 이름은 `views` 다.
 *   1) 목록 요청에 `insights.metric(views)` 를 필드 확장으로 붙여 한 번에 받는다.
 *   2) 확장이 막히면(권한·버전 문제) 릴스별 insights 엔드포인트를 따로 부른다.
 *   3) 그래도 못 받으면 viewsAvailable=false 로 내려 화면이 "조회수 비공개"를 말한다.
 * 이 값을 받으려면 앱에 instagram_business_manage_insights 권한이 있어야 한다
 * (instagram-oauth-start.mts 의 SCOPES).
 *
 * 릴스와 별개로 일반 피드 미디어 9개(recent_feed)도 함께 받는다. 브랜드가 후보를
 * 고를 때 확인하는 것은 평균 숫자가 아니라 계정의 톤이고, 릴스는 그 계정에서 가장
 * 힘을 준 콘텐츠라 평소 피드와 다르게 생기는 경우가 많다. 릴스 배열과 컬럼을 나눠
 * 두는 이유는 평균 계산이다 — 조회수가 없는 사진 게시물을 같은 배열에 섞으면
 * "평균 조회수"가 무슨 숫자인지 알 수 없어진다.
 */

/** 평균을 낼 때 볼 최근 릴스 개수. 오래된 영상까지 섞으면 지금 실력이 흐려진다. */
export const SAMPLE_SIZE = 12;
/** 화면에 보여줄 최근 릴스 개수. 동향(최근 절반 vs 이전 절반)을 내려면 3개로는 부족하다. */
export const SHOW_SIZE = 6;
/** 화면에 보여줄 최근 피드 개수. 3×3 한 화면에 들어가는 만큼만. */
export const FEED_SIZE = 9;

export interface MetaLink {
  accessToken?: string;
  tokenSource?: string;
  igUserId?: string;
  igAccountId?: string;
  igUsername?: string;
  username?: string;
}

export interface RecentReel {
  id: string;
  permalink: string;
  thumbnailUrl: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  timestamp: string;
  source: string;
}

export interface RecentFeedItem {
  id: string;
  permalink: string;
  thumbnailUrl: string;
  /** IMAGE · VIDEO · CAROUSEL_ALBUM. 화면에서 영상 칸에만 재생 표시를 붙인다. */
  mediaType: string;
  caption: string;
  likes: number;
  comments: number;
  timestamp: string;
}

export interface MetaMetrics {
  igUsername: string;
  followers: number | null;
  following: number | null;
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  reelsCount: number;
  recentReels: RecentReel[];
  /** 릴스를 뺀 것이 아니라, 릴스를 포함한 최근 게시물 9개(피드 분위기용). */
  recentFeed: RecentFeedItem[];
  /** 조회수 필드를 실제로 받았는지 — 화면이 "연동됐지만 조회수는 비공개"를 말할 수 있어야 한다. */
  viewsAvailable: boolean;
}

export const intOf = (raw: unknown) => {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  const n = digits ? Number(digits) : Number(raw ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

const avg = (nums: number[]) => {
  const valid = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
};

/** "Instagram API with Instagram Login" 토큰은 graph.instagram.com 을 쓴다(페이스북 그래프 아님). */
const graphHostFor = (tokenSource?: string) =>
  tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com";

/** 미디어 목록에서 항상 받을 수 있는 필드들. 조회수는 여기 넣지 않는다(위 주석 참고). */
const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp," +
  "like_count,comments_count";

/** 조회수를 목록 요청 한 번으로 받기 위한 필드 확장. */
const VIEWS_EXPANSION = "insights.metric(views)";

/**
 * 인사이트 응답에서 숫자를 꺼낸다.
 * 응답 모양이 { data: [{ name, values: [{ value }] }] } 이고, 필드 확장으로 붙이면
 * 그 덩어리가 미디어 안의 insights 로 들어온다.
 */
const insightValue = (payload: any): number | null => {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    const value = Array.isArray(row?.values) ? row.values[0]?.value : row?.value;
    if (typeof value !== "undefined" && value !== null) return intOf(value);
  }
  return null;
};

/** 미디어 항목에 이미 실려 온 조회수(필드 확장 성공 시). 없으면 null. */
const viewsFromMedia = (media: any): number | null => {
  const expanded = insightValue(media?.insights);
  if (expanded !== null) return expanded;
  // 비즈니스 디스커버리 응답 등 일반 필드로 오는 경우도 받아 둔다.
  if (typeof media?.view_count !== "undefined") return intOf(media.view_count);
  return null;
};

/**
 * 릴스 하나의 조회수를 인사이트 엔드포인트로 받아 온다.
 * 실패는 조용히 0 으로 둔다 — 한 편이 막혔다고 나머지 릴스까지 버릴 이유가 없다.
 */
async function fetchReelViews(graphHost: string, token: string, mediaId: string): Promise<number> {
  if (!mediaId) return 0;
  try {
    const res = await fetch(
      `https://${graphHost}/${encodeURIComponent(mediaId)}/insights?metric=views` +
        `&access_token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return 0;
    const data = (await res.json().catch(() => ({}))) as any;
    return insightValue(data) ?? 0;
  } catch {
    return 0;
  }
}

/** 사용자별 인스타그램 연동 정보(디엠 자동화 블롭에 함께 보관된다). */
export async function loadMetaLink(username: string): Promise<MetaLink | null> {
  try {
    const store = getStore({ name: "dm-automation", consistency: "strong" });
    const settings = (await store.get(`dm_${username}`, { type: "json" })) as MetaLink | null;
    if (!settings) return null;
    return settings;
  } catch {
    return null;
  }
}

export const linkIsUsable = (link: MetaLink | null): boolean =>
  !!(link?.accessToken && (link?.igUserId || link?.igAccountId));

/**
 * 연동된 계정의 프로필(팔로워·팔로잉)과 최근 릴스 성과를 읽어 온다.
 *
 * 팔로워·팔로잉은 권한에 따라 개별 필드가 빠질 수 있으므로 못 받은 값은 null 로
 * 두고, 저장하는 쪽에서 기존 값을 유지하게 한다. 0 으로 덮어쓰면 이미 확인해 둔
 * 숫자가 사라진다.
 */
export async function fetchInstagramMetrics(
  link: MetaLink,
): Promise<{ ok: true; metrics: MetaMetrics } | { ok: false; error: string; status: number }> {
  const token = String(link.accessToken || "");
  if (!token) return { ok: false, error: "액세스 토큰이 없습니다.", status: 409 };

  const graphHost = graphHostFor(link.tokenSource);

  const fetchMedia = async (fields: string) => {
    const endpoint =
      `https://${graphHost}/me/media?fields=${encodeURIComponent(fields)}` +
      `&limit=${SAMPLE_SIZE * 2}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(endpoint);
    const data = (await res.json().catch(() => ({}))) as any;
    return { ok: res.ok, status: res.status, data };
  };

  // 조회수(인사이트)를 붙인 요청부터 시도한다. 막히면 나머지 값이라도 받아 두고
  // 조회수는 릴스별로 따로 부른다 — 목록 자체를 놓치면 카드가 빈 화면이 된다.
  let result = await fetchMedia(`${MEDIA_FIELDS},${VIEWS_EXPANSION}`);
  if (!result.ok) result = await fetchMedia(MEDIA_FIELDS);
  if (!result.ok) {
    return {
      ok: false,
      error: result.data?.error?.message || `메타 API 오류 (HTTP ${result.status})`,
      status: 502,
    };
  }

  const items: any[] = Array.isArray(result.data?.data) ? result.data.data : [];
  // 릴스만 본다. 사진 게시물은 조회수가 없고, 섞으면 평균이 무슨 숫자인지 알 수 없어진다.
  const reels = items
    .filter(
      (m) =>
        String(m?.media_product_type || "").toUpperCase() === "REELS" ||
        String(m?.media_type || "").toUpperCase() === "VIDEO",
    )
    .slice(0, SAMPLE_SIZE);

  // 릴스별 조회수. 목록 요청에 인사이트가 실려 왔으면 그대로 쓰고, 하나도 못 받았으면
  // 릴스별 인사이트를 병렬로 부른다. 일부라도 실려 왔다면(권한은 있는데 특정 영상만
  // 빠진 경우) 다시 부르지 않는다 — 그 영상은 실제로 집계 전일 수 있다.
  let reelViews = reels.map((m) => viewsFromMedia(m) ?? 0);
  if (reels.length > 0 && reelViews.every((v) => v <= 0)) {
    reelViews = await Promise.all(
      reels.map((m) => fetchReelViews(graphHost, token, String(m?.id || ""))),
    );
  }
  // 조회수를 한 편이라도 받았는지. 화면이 "연동됐지만 조회수는 비공개"를 말할 근거다.
  const viewsAvailable = reelViews.some((v) => v > 0);

  // 피드는 거르지 않고 최근 순서 그대로 9개를 남긴다. 사진·캐러셀·릴스가 섞인
  // 그대로가 이 계정의 실제 화면이고, 그걸 보려고 받는 값이다.
  const feed: RecentFeedItem[] = items.slice(0, FEED_SIZE).map((m) => ({
    id: String(m?.id || ""),
    permalink: String(m?.permalink || ""),
    // 영상은 media_url 이 동영상 파일이라 썸네일을 먼저 쓴다. 사진은 그 반대.
    thumbnailUrl:
      String(m?.media_type || "").toUpperCase() === "VIDEO"
        ? String(m?.thumbnail_url || m?.media_url || "")
        : String(m?.media_url || m?.thumbnail_url || ""),
    mediaType: String(m?.media_type || ""),
    caption: String(m?.caption || "").slice(0, 200),
    likes: intOf(m?.like_count),
    comments: intOf(m?.comments_count),
    timestamp: String(m?.timestamp || ""),
  }));

  // 팔로워·팔로잉은 프로필 필드로 별도 조회한다.
  let igUsername = String(link.igUsername || "");
  let followers: number | null = null;
  let following: number | null = null;
  try {
    const profileRes = await fetch(
      `https://${graphHost}/me?fields=username,followers_count,follows_count` +
        `&access_token=${encodeURIComponent(token)}`,
    );
    const profile = (await profileRes.json().catch(() => ({}))) as any;
    if (profileRes.ok) {
      if (profile?.username) igUsername = String(profile.username);
      if (typeof profile?.followers_count !== "undefined") followers = intOf(profile.followers_count);
      if (typeof profile?.follows_count !== "undefined") following = intOf(profile.follows_count);
    }
  } catch (e) {
    console.warn("[ig-metrics] 프로필(팔로워/팔로잉) 조회 실패:", (e as Error)?.message);
  }

  return {
    ok: true,
    metrics: {
      igUsername,
      followers,
      following,
      avgViews: avg(reelViews),
      avgLikes: avg(reels.map((m) => intOf(m?.like_count))),
      avgComments: avg(reels.map((m) => intOf(m?.comments_count))),
      reelsCount: reels.length,
      recentReels: reels.slice(0, SHOW_SIZE).map((m, i) => ({
        id: String(m?.id || ""),
        permalink: String(m?.permalink || ""),
        thumbnailUrl: String(m?.thumbnail_url || m?.media_url || ""),
        caption: String(m?.caption || "").slice(0, 200),
        views: reelViews[i] || 0,
        likes: intOf(m?.like_count),
        comments: intOf(m?.comments_count),
        timestamp: String(m?.timestamp || ""),
        source: "meta_api",
      })),
      recentFeed: feed,
      viewsAvailable,
    },
  };
}

async function loadChannel(db: any, username: string) {
  const rows = await db.sql`SELECT * FROM creator_channels WHERE username = ${username}`;
  return (rows as any[])?.[0] || null;
}

/**
 * 메타에서 받은 지표를 creator_channels 에 굳힌다.
 *
 * 못 받은 항목(권한 거부 등)은 기존 값을 유지한다. 연동 후 첫 저장이라 기존 값이
 * 없으면 0 이 되지만, 그건 "아직 못 받았다"와 같은 뜻이라 문제되지 않는다.
 */
export async function persistMetrics(
  db: any,
  username: string,
  metrics: MetaMetrics,
): Promise<any> {
  const existing = await loadChannel(db, username);

  const followers = metrics.followers ?? Number(existing?.followers || 0);
  const following = metrics.following ?? Number(existing?.following || 0);
  const avgViews = metrics.avgViews || Number(existing?.avg_views || 0);
  const avgLikes = metrics.avgLikes || Number(existing?.avg_likes || 0);
  const avgComments = metrics.avgComments || Number(existing?.avg_comments || 0);
  const reelsCount = metrics.reelsCount || Number(existing?.reels_count || 0);
  const recentReels = metrics.recentReels.length
    ? metrics.recentReels
    : Array.isArray(existing?.recent_reels)
      ? existing.recent_reels
      : [];
  // 피드도 같은 규칙이다. 이번 응답이 빈 배열이면(권한 거부·일시 오류) 지난번에
  // 받아 둔 9칸을 지우지 않는다. 빈 그리드는 "게시물이 없는 계정"으로 읽힌다.
  const recentFeed = metrics.recentFeed.length
    ? metrics.recentFeed
    : Array.isArray(existing?.recent_feed)
      ? existing.recent_feed
      : [];

  const handle = metrics.igUsername || String(existing?.instagram_handle || "");
  const igUrl =
    String(existing?.instagram_url || "") ||
    (handle ? `https://www.instagram.com/${handle}/` : "");

  await db.sql`
    INSERT INTO creator_channels (
      username, instagram_handle, instagram_url, connected, followers, following, avg_views,
      avg_likes, avg_comments, reels_count, metrics_source, recent_reels, recent_feed, synced_at,
      intro, categories
    ) VALUES (
      ${username}, ${handle}, ${igUrl}, TRUE, ${followers}, ${following}, ${avgViews},
      ${avgLikes}, ${avgComments}, ${reelsCount}, 'meta_api',
      ${JSON.stringify(recentReels)}, ${JSON.stringify(recentFeed)}, NOW(),
      ${String(existing?.intro || "")}, ${String(existing?.categories || "")}
    )
    ON CONFLICT (username) DO UPDATE SET
      instagram_handle = COALESCE(NULLIF(EXCLUDED.instagram_handle, ''), creator_channels.instagram_handle),
      instagram_url = COALESCE(NULLIF(EXCLUDED.instagram_url, ''), creator_channels.instagram_url),
      connected = TRUE,
      followers = EXCLUDED.followers,
      following = EXCLUDED.following,
      avg_views = EXCLUDED.avg_views,
      avg_likes = EXCLUDED.avg_likes,
      avg_comments = EXCLUDED.avg_comments,
      reels_count = EXCLUDED.reels_count,
      metrics_source = 'meta_api',
      recent_reels = EXCLUDED.recent_reels,
      recent_feed = EXCLUDED.recent_feed,
      synced_at = NOW(),
      updated_at = NOW()
  `;

  return await loadChannel(db, username);
}

/**
 * 연동 정보로 지표를 받아 바로 저장하는 한 번의 동작.
 * 연동 직후 콜백과 수동 sync 가 같은 결과를 남기도록 여기 한 군데만 쓴다.
 */
export async function syncChannelFromMeta(
  db: any,
  username: string,
  link: MetaLink,
): Promise<
  | { ok: true; row: any; viewsAvailable: boolean; sampled: number }
  | { ok: false; error: string; status: number }
> {
  const fetched = await fetchInstagramMetrics(link);
  if (!fetched.ok) return fetched;
  const row = await persistMetrics(db, username, fetched.metrics);
  return {
    ok: true,
    row,
    viewsAvailable: fetched.metrics.viewsAvailable,
    sampled: fetched.metrics.reelsCount,
  };
}
