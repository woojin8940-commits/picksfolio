import { getStore } from "@netlify/blobs";
import { safeKeyPrefix } from "./upload-media.mts";

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
  /** 토큰이 죽은 것이 확인된 연동. 사람이 다시 동의해 주기 전에는 어떤 호출도 성공하지 않는다. */
  needsReauth?: boolean;
  tokenInvalidAt?: string;
}

/**
 * 연동을 어디에 보관하는가.
 *
 * 같은 인스타그램 계정이라도 "디엠 자동화용 연동"과 "캠페인(브랜드 매칭)용 연동"은
 * 서로 다른 것으로 다룬다. 디엠 자동화에 계정을 붙여 뒀다고 캠페인 등록서가 그 계정을
 * 자기 것처럼 쓰기 시작하면, 등록하는 사람은 자기가 어떤 계정을 브랜드에게 보여 주고
 * 있는지 고른 적이 없다. 캠페인은 그 자리에서 직접 로그인한 계정만 쓴다.
 *
 *   dm     — dm-automation 블롭. 자동 응답 규칙과 함께 보관된다.
 *   collab — collab-instagram 블롭. 캠페인 등록 화면에서 로그인한 계정만 들어온다.
 */
export type MetaLinkScope = "dm" | "collab";

/** 스코프별 보관 위치. 두 스코프가 같은 키를 건드리면 한쪽 연동 해제가 다른 쪽을 끊는다. */
const linkLocation = (scope: MetaLinkScope, username: string) =>
  scope === "collab"
    ? { store: "collab-instagram", key: `ig_${username}` }
    : { store: "dm-automation", key: `dm_${username}` };

/** 토큰이 죽었을 때 화면이 쓰는 문구. 여러 곳에서 같은 말을 하도록 한 군데 둔다. */
export const REAUTH_MESSAGE =
  "인스타그램 연동이 만료되었습니다. 계정을 다시 연동하면 팔로워·릴스 조회수를 이어서 불러옵니다.";

/** 지표를 못 받았을 때 화면에 그대로 쓸 수 있는 코드. 메타 원문은 이 뒤로 넘기지 않는다. */
export type MetaFailureCode = "META_TOKEN_INVALID" | "META_ERROR";

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
  /** 인스타 프로필 사진 주소. 못 받으면 빈 문자열 — 지난번 값을 지우지 않는다. */
  profileImage: string;
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

/**
 * 인사이트를 부를 때 붙이는 API 버전.
 *
 * 버전을 적지 않으면 메타가 앱 설정의 기본 버전으로 해석하고, 그 값은 우리가 모르는
 * 사이 바뀌거나 오래된 버전으로 남아 있을 수 있다. `views` 지표는 2025년 4월 개편으로
 * 생긴 이름이라 오래된 버전에서는 "없는 지표"가 되어 요청 전체가 400 이 된다 —
 * 조회수가 있는 게시물인데도 화면에는 빈칸이 남는 조용한 실패다. 버전을 박아 두면
 * 그 실패가 우리 손을 떠난 설정값에 좌우되지 않는다.
 *
 * 목록(/me/media) 요청에는 붙이지 않는다. 그쪽은 지금 값이 잘 오고 있고, 버전을
 * 바꾸는 것은 그 자체로 필드가 사라질 위험이라 필요한 자리에만 건다.
 */
const GRAPH_VERSION = "v23.0";

/** 미디어 목록에서 항상 받을 수 있는 필드들. 조회수는 여기 넣지 않는다(위 주석 참고). */
export const MEDIA_FIELDS =
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
    /**
     * 응답 모양이 한 가지가 아니다.
     *
     * 시계열 지표는 `values: [{ value }]` 로 오지만, 2025년 지표 개편 이후 미디어의
     * `views` 는 API 버전에 따라 `total_value: { value }` 로도 온다. 예전에는 앞쪽
     * 모양만 읽었기 때문에, 값이 분명히 내려왔는데도 `null` 로 접혀 화면에는 조회수가
     * 비어 보였다. 두 자리를 다 본다.
     */
    const value = Array.isArray(row?.values)
      ? row.values[0]?.value
      : typeof row?.total_value?.value !== "undefined"
        ? row.total_value.value
        : row?.value;
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

/**
 * 어느 (버전, 지표 이름) 조합이 통했는지 기억해 둔다.
 *
 * 사다리를 게시물마다 처음부터 다시 타면, 태그된 콘텐츠 서른 편을 채우는 데 필요한
 * 호출이 여덟 배로 늘어 함수 실행 시간을 다 태운다. 한 계정에서 통한 조합은 같은
 * 계정의 다른 게시물에서도 통하므로, 그래프 호스트별로 하나만 기억한다. 함수가
 * 새로 뜨면 비는 값이고, 그때 다시 한 번 찾으면 된다.
 */
const viewsProbe = new Map<string, { base: string; metric: string }>();

/**
 * 지표 이름이 막혀서 온 실패인가.
 *
 * 이 경우에만 다음 이름으로 내려간다. "이 게시물에는 인사이트가 없다" 같은 실패에서
 * 이름을 바꿔 다시 물어보는 것은 같은 답을 네 번 더 받는 일이고, 그 네 번이 다른
 * 게시물의 조회수를 채울 시간을 가져간다.
 */
const isMetricRejected = (payload: any): boolean => {
  const message = String(payload?.error?.message || "").toLowerCase();
  return message.includes("metric") || message.includes("param") || message.includes("does not support");
};

/**
 * 미디어 한 편의 조회수를 지금 조회한다. 못 받으면 null.
 *
 * `fetchReelViews` 와 달리 실패를 0 으로 접지 않는다. 브랜드 화면의 태그된 콘텐츠
 * 목록처럼 "조회수 0" 과 "조회수를 못 받음" 을 구분해 적어야 하는 쪽이 쓴다 —
 * 0 으로 접으면 그 게시물이 아무도 안 본 것으로 읽힌다.
 *
 * 인사이트는 게시물 주인의 토큰으로만 조회된다. 남의 계정 게시물에는 쓸 수 없으므로,
 * 부르는 쪽이 그 게시물을 올린 계정의 연동을 찾아 넘겨야 한다.
 */
export async function fetchMediaViews(link: MetaLink, mediaId: string): Promise<number | null> {
  const token = String(link.accessToken || "");
  if (!token || !mediaId) return null;
  const host = graphHostFor(link.tokenSource);

  /**
   * 지표 이름을 한 칸씩 물러난다.
   *
   * 예전에는 `metric=views` 한 번만 물어보고, 실패하면 조용히 null 이었다. 그런데
   * `views` 는 2025년 4월 지표 개편으로 생긴 이름이라 그 이전 버전으로 해석되는
   * 요청에서는 "없는 지표"로 400 이 된다 — 조회수가 분명히 있는 게시물도 영원히
   * 비어 있었고, 화면은 그 이유를 말할 수도 없었다. 개편 전 이름(plays ·
   * video_views · impressions)까지 차례로 물어본다.
   *
   * 주소도 두 가지를 본다. 버전을 박아 두는 이유는 GRAPH_VERSION 주석에 있고, 박아
   * 둔 버전이 언젠가 만료되면 그 주소만으로는 다시 빈칸이 되므로 버전 없는 주소를
   * 뒤에 한 번 더 둔다.
   */
  const ladder = ["views", "plays", "video_views", "impressions"];
  const bases = [`https://${host}/${GRAPH_VERSION}`, `https://${host}`];

  const combos: { base: string; metric: string }[] = [];
  const learned = viewsProbe.get(host);
  if (learned) combos.push(learned);
  for (const base of bases) {
    for (const metric of ladder) {
      if (learned && learned.base === base && learned.metric === metric) continue;
      combos.push({ base, metric });
    }
  }

  let lastError = "";
  for (const combo of combos) {
    try {
      const res = await fetch(
        `${combo.base}/${encodeURIComponent(mediaId)}/insights?metric=${combo.metric}` +
          `&access_token=${encodeURIComponent(token)}`,
      );
      const data = (await res.json().catch(() => ({}))) as any;
      if (res.ok) {
        const value = insightValue(data);
        if (value !== null) {
          viewsProbe.set(host, combo);
          return value;
        }
        // 요청은 통했는데 값이 비었다. 지표 이름 문제가 아니므로 더 물어볼 것이 없다.
        return null;
      }
      // 메타가 보낸 사유를 남긴다. 토큰은 URL 에만 있고 로그에는 들어가지 않는다.
      lastError = String(data?.error?.message || `HTTP ${res.status}`);
      // 토큰이 죽었거나 권한이 없거나, 지표 이름과 무관한 실패면 여기서 끝난다.
      if (isTokenInvalidError(data) || res.status === 403 || !isMetricRejected(data)) break;
    } catch (e) {
      lastError = (e as Error)?.message || "요청 실패";
      break;
    }
  }

  if (lastError) {
    console.warn(`[instagram-metrics] 조회수 조회 실패 media=${mediaId}: ${lastError}`);
  }
  return null;
}

/** 목록 요청에 조회수를 함께 받기 위한 필드 조합. 자기 계정 미디어에만 쓴다. */
export const MEDIA_FIELDS_WITH_VIEWS = `${MEDIA_FIELDS},${VIEWS_EXPANSION}`;
/** 미디어 항목에 실려 온 조회수. 없으면 null — 부르는 쪽이 따로 조회할지 정한다. */
export const viewsOnMedia = viewsFromMedia;

/** 사용자별 인스타그램 연동 정보. 스코프에 따라 보관 위치가 다르다(linkLocation 참고). */
export async function loadMetaLink(
  username: string,
  scope: MetaLinkScope = "dm",
): Promise<MetaLink | null> {
  try {
    const at = linkLocation(scope, username);
    const store = getStore({ name: at.store, consistency: "strong" });
    const settings = (await store.get(at.key, { type: "json" })) as MetaLink | null;
    if (!settings) return null;
    return settings;
  } catch {
    return null;
  }
}

/**
 * 메타가 "이 토큰은 더 이상 쓸 수 없다"고 답한 경우인지.
 *
 * 사람이 앱 권한을 지웠거나(설정 → 비즈니스 통합에서 삭제), 비밀번호를 바꿨거나,
 * 60일 장기 토큰이 갱신되지 못한 채 만료된 경우가 전부 여기로 온다. 메타는 이걸
 * OAuthException(code 190)으로 답하고, 본문 문구는 상황마다 다르다
 * ("The user has not authorized application …", "Session has expired …").
 *
 * 이 구분이 필요한 이유는 사람에게 할 말이 다르기 때문이다. 일시적인 오류라면
 * "잠시 후 다시" 이지만, 토큰이 죽었으면 다시 눌러도 영원히 같은 실패가 난다 —
 * 재연동만이 유일한 길이므로 화면은 갱신 버튼이 아니라 연동 버튼을 보여야 한다.
 */
export const isTokenInvalidError = (payload: any): boolean => {
  const err = payload?.error ?? payload;
  if (Number(err?.code) === 190) return true;
  if (String(err?.type || "") === "OAuthException") return true;
  // 재동의가 필요한 하위 코드: 앱 권한 삭제(458), 비밀번호 변경(460), 만료(463), 무효(467).
  if ([458, 459, 460, 463, 464, 467, 492].includes(Number(err?.error_subcode))) return true;
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("has not authorized application") ||
    msg.includes("error validating access token") ||
    msg.includes("session has expired") ||
    (msg.includes("access token") && msg.includes("invalid"))
  );
};

/**
 * 죽은 토큰을 연동 정보에 기록한다.
 *
 * 블롭을 지우지 않는 이유는 여기에 디엠 자동화 규칙이 함께 들어 있기 때문이다.
 * 토큰이 만료됐다고 사람이 만들어 둔 자동 응답 문구까지 사라지면, 재연동한 뒤에
 * 그걸 처음부터 다시 만들어야 한다. 표시만 남기고 내용은 그대로 둔다.
 *
 * 기록해 두면 다음 화면부터는 버튼을 눌러 보기 전에 상태를 알 수 있다 — 실패할 것이
 * 확실한 버튼을 눌러 보게 하고 영문 오류를 보여 주는 대신, 처음부터 재연동을 권한다.
 */
export async function markLinkNeedsReauth(
  username: string,
  scope: MetaLinkScope = "dm",
): Promise<void> {
  try {
    const at = linkLocation(scope, username);
    const store = getStore({ name: at.store, consistency: "strong" });
    const key = at.key;
    const latest = (await store.get(key, { type: "json" })) as MetaLink | null;
    if (!latest || latest.needsReauth) return;
    await store.setJSON(key, {
      ...latest,
      needsReauth: true,
      tokenInvalidAt: new Date().toISOString(),
    });
  } catch (e) {
    // 표시를 못 남겨도 이번 호출의 안내는 이미 정확하다. 다음 호출에서 다시 시도된다.
    console.warn("[ig-metrics] 재연동 표시 저장 실패:", (e as Error)?.message);
  }
}

/**
 * 연동 자체를 지운다 — 사람이 "연동 해제"를 눌렀을 때.
 *
 * 토큰 만료(markLinkNeedsReauth)와 달리 여기서는 보관함을 통째로 비운다. 해제는
 * "이 계정을 더는 쓰지 않겠다"는 뜻이므로, 토큰이 남아 있으면 안 된다.
 *
 * 캠페인용(collab) 보관함에는 토큰과 계정 아이디밖에 없어서 지워도 잃는 것이 없다.
 * 디엠 자동화(dm)는 같은 블롭에 자동 응답 규칙이 함께 들어 있으므로 이 함수 대신
 * 규칙을 남기고 토큰만 비우는 자기 쪽 처리를 쓴다.
 */
export async function deleteMetaLink(
  username: string,
  scope: MetaLinkScope = "collab",
): Promise<void> {
  const at = linkLocation(scope, username);
  const store = getStore({ name: at.store, consistency: "strong" });
  await store.delete(at.key);
}

/** 토큰이 다시 살아 있는 것이 확인되면 표시를 지운다(재연동 직후·일시 오류였던 경우). */
export async function clearLinkReauthFlag(
  username: string,
  scope: MetaLinkScope = "dm",
): Promise<void> {
  try {
    const at = linkLocation(scope, username);
    const store = getStore({ name: at.store, consistency: "strong" });
    const key = at.key;
    const latest = (await store.get(key, { type: "json" })) as MetaLink | null;
    if (!latest?.needsReauth) return;
    const { needsReauth, tokenInvalidAt, ...rest } = latest;
    await store.setJSON(key, rest);
  } catch (e) {
    console.warn("[ig-metrics] 재연동 표시 해제 실패:", (e as Error)?.message);
  }
}

/**
 * 갱신 버튼을 켜도 되는 연동인지.
 *
 * 토큰 문자열이 남아 있다는 것과 그 토큰이 살아 있다는 것은 다르다. 죽은 것이
 * 확인된 연동을 "연동됨"으로 세면, 화면은 멀쩡한 갱신 버튼을 보여 주고 사람은
 * 누를 때마다 같은 실패를 다시 만난다.
 */
export const linkIsUsable = (link: MetaLink | null): boolean =>
  !!(link?.accessToken && (link?.igUserId || link?.igAccountId) && !link?.needsReauth);

/** 연동은 돼 있으나 토큰이 죽어 다시 동의가 필요한 상태. 화면이 연동 버튼을 보여줄 근거다. */
export const linkNeedsReauth = (link: MetaLink | null): boolean => !!link?.needsReauth;

/**
 * 연동된 계정의 프로필(팔로워·팔로잉)과 최근 릴스 성과를 읽어 온다.
 *
 * 팔로워·팔로잉은 권한에 따라 개별 필드가 빠질 수 있으므로 못 받은 값은 null 로
 * 두고, 저장하는 쪽에서 기존 값을 유지하게 한다. 0 으로 덮어쓰면 이미 확인해 둔
 * 숫자가 사라진다.
 */
export async function fetchInstagramMetrics(
  link: MetaLink,
): Promise<
  | { ok: true; metrics: MetaMetrics }
  | { ok: false; error: string; status: number; code: MetaFailureCode }
> {
  const token = String(link.accessToken || "");
  if (!token) {
    return { ok: false, error: REAUTH_MESSAGE, status: 409, code: "META_TOKEN_INVALID" };
  }

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
  // 토큰이 죽었으면 필드를 줄여 다시 불러도 같은 실패다. 두 번째 호출을 아낀다.
  if (!result.ok && !isTokenInvalidError(result.data)) result = await fetchMedia(MEDIA_FIELDS);
  if (!result.ok) {
    // 메타 원문은 로그에만 남긴다. 영문 오류 문장을 화면에 그대로 올리면 사람은
    // 무엇이 잘못됐는지도, 무엇을 해야 하는지도 알 수 없다.
    const raw = result.data?.error?.message || `HTTP ${result.status}`;
    if (isTokenInvalidError(result.data)) {
      console.warn(`[ig-metrics] 토큰 만료/권한 해제 (${link.igUsername || "?"}): ${raw}`);
      return { ok: false, error: REAUTH_MESSAGE, status: 409, code: "META_TOKEN_INVALID" };
    }
    console.warn(`[ig-metrics] 메타 API 오류 (${link.igUsername || "?"}): ${raw}`);
    return {
      ok: false,
      error: "인스타그램에서 정보를 받지 못했습니다. 잠시 후 다시 시도해 주세요.",
      status: 502,
      code: "META_ERROR",
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
  let profileImage = "";
  try {
    // profile_picture_url 은 토큰 종류·권한에 따라 없는 필드일 수 있고, 그럴 때
    // 그래프는 요청 전체를 400 으로 돌려준다. 사진 한 장 때문에 팔로워 수까지
    // 잃으면 안 되므로, 실패하면 예전 필드만으로 한 번 더 부른다.
    const baseFields = "username,followers_count,follows_count";
    const askProfile = (fields: string) =>
      fetch(
        `https://${graphHost}/me?fields=${fields}` +
          `&access_token=${encodeURIComponent(token)}`,
      );
    let profileRes = await askProfile(`${baseFields},profile_picture_url`);
    if (!profileRes.ok) profileRes = await askProfile(baseFields);
    const profile = (await profileRes.json().catch(() => ({}))) as any;
    if (profileRes.ok) {
      if (profile?.username) igUsername = String(profile.username);
      if (typeof profile?.followers_count !== "undefined") followers = intOf(profile.followers_count);
      if (typeof profile?.follows_count !== "undefined") following = intOf(profile.follows_count);
      profileImage = String(profile?.profile_picture_url || "");
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
      profileImage,
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

/** 프로필 사진으로 받아 둘 형식. 목록에 없는 형식은 저장하지 않는다. */
const AVATAR_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
/** 프로필 사진 한 장의 상한. 인스타가 주는 원본은 보통 100KB 안쪽이다. */
const AVATAR_MAX_BYTES = 3 * 1024 * 1024;

/**
 * 인스타 프로필 사진을 우리 저장소에 한 장 복사해 두고, 그 주소를 대신 굳힌다.
 *
 * 메타가 주는 `profile_picture_url` 은 서명과 만료 시각이 박힌 임시 주소다. 그대로
 * 저장하면 동기화 직후에는 얼굴이 보이다가 며칠 뒤 조용히 깨져, 브랜드 화면에는
 * 회색 동그라미만 남는다("인스타 연동이 안 된다"는 말이 여기서 나온다). 사진은
 * 한 장짜리 파일이라 받아 두는 비용이 작고, 우리 도메인 주소가 되면 만료도
 * 핫링크 차단도 없다.
 *
 * 실패하면 빈 문자열을 돌려준다 — 부르는 쪽이 원본 주소로 되돌아갈 수 있게 해서,
 * 사진 한 장 때문에 동기화 전체를 실패시키지 않는다.
 */
async function mirrorProfileImage(username: string, sourceUrl: string, priorUrl: string): Promise<string> {
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return "";
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return "";
    const contentType = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = AVATAR_TYPES[contentType];
    if (!ext) return "";
    const buffer = await res.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > AVATAR_MAX_BYTES) return "";

    const store = getStore("images");
    // 주소에 시각을 넣는다. 이미지 응답이 immutable 로 캐시되므로, 같은 키에 덮어쓰면
    // 계정 사진을 바꿔도 브라우저에는 옛 얼굴이 남는다.
    const key = `creator-avatar/${safeKeyPrefix(username)}/${Date.now()}.${ext}`;
    await store.set(key, buffer, { metadata: { contentType } });

    // 지난 사진은 지운다. 동기화를 누를 때마다 한 장씩 쌓이게 두지 않는다.
    const priorKey = String(priorUrl || "").startsWith("/api/images/")
      ? priorUrl.slice("/api/images/".length)
      : "";
    if (priorKey && priorKey.startsWith("creator-avatar/") && priorKey !== key) {
      await store.delete(priorKey).catch(() => {});
    }
    return `/api/images/${key}`;
  } catch (e) {
    console.warn("[ig-metrics] 프로필 사진 저장 실패:", (e as Error)?.message);
    return "";
  }
}

/**
 * 프로필 사진만 다시 받아 오는 간격. 이 시간이 지난 계정만 메타에 다시 묻는다.
 *
 * 사람이 프로필 사진을 바꾸는 빈도는 하루에 몇 번이 아니라 몇 달에 한 번이다.
 * 그래서 짧게 잡을 이유가 없고, 짧게 잡으면 명단을 열 때마다 메타를 부르는 값을
 * 브랜드가 로딩으로 낸다.
 */
const PROFILE_IMAGE_TTL_HOURS = 6;
/** 한 번의 요청에서 사진을 다시 받아 올 계정 수 상한. 명단이 서른 줄이어도 화면은 기다리지 않는다. */
const PROFILE_IMAGE_BATCH = 6;

/** "물어본 시각"만 찍는다. 실패한 호출을 페이지를 열 때마다 되풀이하지 않기 위한 도장이다. */
async function stampProfileImageCheck(db: any, username: string): Promise<void> {
  try {
    await db.sql`
      UPDATE creator_channels SET profile_image_checked_at = NOW() WHERE username = ${username}
    `;
  } catch (e) {
    console.warn("[ig-metrics] 프로필 사진 확인 시각 저장 실패:", (e as Error)?.message);
  }
}

/**
 * 한 계정의 프로필 사진을 연동된 인스타에서 다시 받아 온다.
 *
 * 지표 전체를 다시 받는 것(syncChannelFromMeta)과 일부러 나눠 둔다 — 그쪽은 릴스
 * 열두 편의 인사이트까지 부르므로 브랜드가 명단을 여는 길에 끼워 넣을 무게가 아니다.
 * 여기서 부르는 것은 프로필 필드 하나뿐이다.
 */
async function refreshOneProfileImage(db: any, row: any): Promise<boolean> {
  const username = String(row?.username || "");
  if (!username) return false;

  // 연동은 두 곳에 따로 보관된다(캠페인용 · 디엠 자동화용). 이 사진이 뜨는 자리는
  // 캠페인 화면이므로 캠페인 연동을 먼저 본다.
  let scope: MetaLinkScope = "collab";
  let link = await loadMetaLink(username, "collab");
  if (!link?.accessToken) {
    const dm = await loadMetaLink(username, "dm");
    if (dm?.accessToken) {
      link = dm;
      scope = "dm";
    }
  }
  const token = String(link?.accessToken || "");
  // 토큰이 없거나 죽은 것이 확인된 연동은 물어볼 것이 없다. 지난 사진을 그대로 두고
  // 도장만 찍는다 — 인플루언서가 재연동하면 그 순간 새 사진이 들어온다.
  if (!token || link?.needsReauth) {
    await stampProfileImageCheck(db, username);
    return false;
  }

  try {
    const host = graphHostFor(link?.tokenSource);
    const res = await fetch(
      `https://${host}/me?fields=username,profile_picture_url` +
        `&access_token=${encodeURIComponent(token)}`,
    );
    const payload = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      if (isTokenInvalidError(payload)) await markLinkNeedsReauth(username, scope);
      await stampProfileImageCheck(db, username);
      return false;
    }
    const source = String(payload?.profile_picture_url || "");
    if (!source) {
      await stampProfileImageCheck(db, username);
      return false;
    }

    // 메타가 주는 주소는 서명과 만료가 박힌 임시 주소다. 지표 동기화와 같은 방식으로
    // 우리 저장소에 한 장 복사하고 그 주소를 굳힌다.
    const prior = String(row?.profile_image || "");
    const next = (await mirrorProfileImage(username, source, prior)) || source;
    await db.sql`
      UPDATE creator_channels
      SET profile_image = ${next}, profile_image_checked_at = NOW(), updated_at = NOW()
      WHERE username = ${username}
    `;
    return true;
  } catch (e) {
    console.warn("[ig-metrics] 프로필 사진 갱신 실패:", (e as Error)?.message);
    await stampProfileImageCheck(db, username);
    return false;
  }
}

/**
 * 명단에 뜰 얼굴을 연동된 인스타 계정의 지금 사진으로 맞춘다.
 *
 * 지금까지 creator_channels.profile_image 는 연동하는 순간과 인플루언서가 '갱신'을
 * 누르는 순간에만 채워졌다. 둘 다 인플루언서의 손이 필요한 일이라, 연동해 둔 사람이
 * 인스타에서 사진을 바꿔도 브랜드 화면에는 연동한 날의 얼굴이 남았다 — 브랜드는
 * 진행사항 카드에서 지금 인스타에 없는 사진을 보고 같은 사람인지 의심하게 된다.
 *
 * 그래서 브랜드·담당자가 명단을 여는 길에 사진만 따로 확인한다. 계정마다 마지막으로
 * 물어본 시각을 남겨 두고 그 뒤로 몇 시간이 지난 계정만, 그것도 한 번에 몇 개까지만
 * 다시 묻는다. 대부분의 페이지 열기에서는 한 건도 부르지 않는다.
 *
 * 실패는 조용히 삼킨다 — 사진 한 장 때문에 협업 명단이 안 열리면 안 된다.
 */
export async function refreshStaleProfileImages(db: any, usernames: string[]): Promise<number> {
  const names = [
    ...new Set(
      (usernames || []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean),
    ),
  ];
  if (names.length === 0) return 0;

  // 기준 시각은 여기서 계산해 넘긴다. SQL 안에서 시간 간격을 매개변수로 곱하면
  // 드라이버가 넘긴 숫자의 타입을 포스트그레스가 짐작해야 해서, 같은 질의가 환경에
  // 따라 다르게 풀린다.
  const cutoff = new Date(Date.now() - PROFILE_IMAGE_TTL_HOURS * 3600 * 1000).toISOString();

  let stale: any[] = [];
  try {
    stale = (await db.sql`
      SELECT username, instagram_handle, profile_image
      FROM creator_channels
      WHERE username = ANY(${names})
        AND connected = TRUE
        AND (profile_image_checked_at IS NULL OR profile_image_checked_at < ${cutoff})
      ORDER BY profile_image_checked_at ASC NULLS FIRST
      LIMIT ${PROFILE_IMAGE_BATCH}
    `) as any[];
  } catch (e) {
    console.warn("[ig-metrics] 프로필 사진 확인 대상 조회 실패:", (e as Error)?.message);
    return 0;
  }
  if (stale.length === 0) return 0;

  const results = await Promise.all(stale.map((row) => refreshOneProfileImage(db, row)));
  return results.filter(Boolean).length;
}

/**
 * 메타에서 받은 지표를 creator_channels 에 굳힌다.
 *
 * 못 받은 항목(권한 거부 등)은 기존 값을 유지한다. 연동 후 첫 저장이라 기존 값이
 * 없으면 0 이 되지만, 그건 "아직 못 받았다"와 같은 뜻이라 문제되지 않는다.
 *
 * 단, 그 규칙은 **같은 계정**일 때만 맞다. 다른 인스타그램 계정으로 다시 연동했는데
 * 지난 계정의 평균 조회수·릴스를 물려받으면, 브랜드는 이 사람의 것이 아닌 숫자를
 * 보게 된다. 계정이 바뀌면 물려받지 않고 이번에 받아 온 값만 남긴다.
 */
export async function persistMetrics(
  db: any,
  username: string,
  metrics: MetaMetrics,
): Promise<any> {
  const existing = await loadChannel(db, username);

  // 계정이 바뀌었는지. 아이디를 못 받았거나 처음 저장이면 판단할 근거가 없으므로
  // 지금까지처럼 기존 값을 이어 쓴다(같은 계정의 권한 문제일 가능성이 높다).
  const priorHandle = String(existing?.instagram_handle || "").toLowerCase();
  const sameAccount =
    !metrics.igUsername || !priorHandle || priorHandle === metrics.igUsername.toLowerCase();
  const prior = sameAccount ? existing : null;

  const followers = metrics.followers ?? Number(prior?.followers || 0);
  const following = metrics.following ?? Number(prior?.following || 0);
  const avgViews = metrics.avgViews || Number(prior?.avg_views || 0);
  const avgLikes = metrics.avgLikes || Number(prior?.avg_likes || 0);
  const avgComments = metrics.avgComments || Number(prior?.avg_comments || 0);
  const reelsCount = metrics.reelsCount || Number(prior?.reels_count || 0);
  const recentReels = metrics.recentReels.length
    ? metrics.recentReels
    : Array.isArray(prior?.recent_reels)
      ? prior.recent_reels
      : [];
  // 피드도 같은 규칙이다. 이번 응답이 빈 배열이면(권한 거부·일시 오류) 지난번에
  // 받아 둔 9칸을 지우지 않는다. 빈 그리드는 "게시물이 없는 계정"으로 읽힌다.
  const recentFeed = metrics.recentFeed.length
    ? metrics.recentFeed
    : Array.isArray(prior?.recent_feed)
      ? prior.recent_feed
      : [];

  const handle = metrics.igUsername || String(existing?.instagram_handle || "");
  // 프로필 사진도 같은 규칙이다. 이번 응답에 없으면(권한·필드 미지원) 지난번 주소를
  // 남긴다. 단 계정이 바뀌었으면 물려받지 않는다 — 남의 얼굴이 걸린다.
  //
  // 받아 온 주소는 그대로 굳히지 않고 우리 저장소로 한 번 복사한다. 메타 주소는
  // 만료되기 때문에, 굳혀 두면 며칠 뒤 화면에서 사진이 사라진다. 복사에 실패하면
  // 원본 주소라도 남긴다 — 당장은 보이고, 다음 동기화가 다시 시도한다.
  const priorImage = String(prior?.profile_image || "");
  const mirrored = metrics.profileImage
    ? await mirrorProfileImage(username, metrics.profileImage, priorImage)
    : "";
  const profileImage = mirrored || metrics.profileImage || priorImage;
  // 프로필 주소도 계정을 따라간다. 바뀐 계정에 옛 주소가 남으면 브랜드가 다른 사람의
  // 프로필을 열어 보게 된다.
  const igUrl =
    String(prior?.instagram_url || "") || (handle ? `https://www.instagram.com/${handle}/` : "");

  await db.sql`
    INSERT INTO creator_channels (
      username, instagram_handle, instagram_url, connected, followers, following, avg_views,
      avg_likes, avg_comments, reels_count, metrics_source, recent_reels, recent_feed, synced_at,
      intro, categories, profile_image, profile_image_checked_at
    ) VALUES (
      ${username}, ${handle}, ${igUrl}, TRUE, ${followers}, ${following}, ${avgViews},
      ${avgLikes}, ${avgComments}, ${reelsCount}, 'meta_api',
      ${JSON.stringify(recentReels)}, ${JSON.stringify(recentFeed)}, NOW(),
      ${String(existing?.intro || "")}, ${String(existing?.categories || "")}, ${profileImage}, NOW()
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
      profile_image = EXCLUDED.profile_image,
      -- 지표를 통째로 받아 온 이 순간도 "사진을 물어본 시각"이다. 안 찍으면 방금
      -- 동기화한 계정을 명단이 다시 한 번 메타에 물어본다.
      profile_image_checked_at = NOW(),
      synced_at = NOW(),
      updated_at = NOW()
  `;

  return await loadChannel(db, username);
}

/**
 * 연동 정보로 지표를 받아 바로 저장하는 한 번의 동작.
 * 연동 직후 콜백과 수동 sync 가 같은 결과를 남기도록 여기 한 군데만 쓴다.
 *
 * 토큰이 죽은 것이 확인되면 연동 정보에도 표시를 남긴다. 그래야 다음에 화면을 열
 * 때 갱신 버튼 대신 재연동 안내가 먼저 보인다 — 실패가 예정된 버튼을 사람이 다시
 * 누르지 않도록.
 */
export async function syncChannelFromMeta(
  db: any,
  username: string,
  link: MetaLink,
  scope: MetaLinkScope = "dm",
): Promise<
  | { ok: true; row: any; viewsAvailable: boolean; sampled: number }
  | { ok: false; error: string; status: number; code: MetaFailureCode }
> {
  const fetched = await fetchInstagramMetrics(link);
  if (!fetched.ok) {
    if (fetched.code === "META_TOKEN_INVALID") await markLinkNeedsReauth(username, scope);
    return fetched;
  }
  // 토큰이 살아 있는 것이 확인됐다. 지난번 일시 오류로 남은 표시가 있으면 지운다.
  if (link.needsReauth) await clearLinkReauthFlag(username, scope);
  const row = await persistMetrics(db, username, fetched.metrics);
  return {
    ok: true,
    row,
    viewsAvailable: fetched.metrics.viewsAvailable,
    sampled: fetched.metrics.reelsCount,
  };
}
