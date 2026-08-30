import { getStore } from "@netlify/blobs";
import {
  fetchMediaViews,
  intOf,
  isTokenInvalidError,
  loadMetaLink,
  linkIsUsable,
  MEDIA_FIELDS,
  MEDIA_FIELDS_WITH_VIEWS,
  viewsOnMedia,
  type MetaLink,
} from "./instagram-metrics.mts";

/**
 * 브랜드 계정이 태그·언급된 콘텐츠 목록.
 *
 * 브랜드가 알고 싶은 것은 하나다 — "누가 우리를 걸어서 올렸고, 그 콘텐츠가 얼마나
 * 퍼졌는가". 그런데 메타에서 그 목록을 받는 길은 우리 연동 방식에서 막혀 있다.
 *
 * 왜 Tags API 만으로는 안 되는가
 * ------------------------------
 * `GET /{ig-user-id}/tags` 는 실제로 존재하는 목록 엔드포인트지만 **페이스북 로그인
 * 방식 전용**이다. 메타 문서는 인스타그램 로그인 방식에 대해 "This API setup cannot
 * access ads or tagging" 이라고 못 박는다. 우리 앱은 전부 인스타그램 로그인으로
 * 토큰을 받으므로(tokenSource: 'instagram_login' → graph.instagram.com) 이 엣지는
 * 거부된다. 쓰려면 인스타그램 계정에 페이스북 페이지를 연결하고 pages_* 권한으로
 * 다시 연동받는 별개의 인증 절차가 필요하다.
 *
 * @언급(mentions)은 인스타그램 로그인에서도 되지만 **목록 조회가 없다.** 웹훅으로
 * media_id 를 하나씩 받아 우리가 쌓아야 한다. 즉 어느 쪽이든 "지금 있는 토큰으로
 * 목록을 한 번 받아오기"는 성립하지 않는다.
 *
 * 그래서 무엇으로 채우는가
 * ------------------------
 * 두 곳을 합친다.
 *
 *   ① tags 엣지            — 시도는 한다. 페이스북 로그인으로 받은 토큰이 생기면
 *                            코드를 고치지 않고 그날부터 값이 들어온다. 거부되면
 *                            사유를 payload 에 담아 화면이 설명할 수 있게 한다.
 *   ② 연동된 인플루언서 피드 — 우리 DB(creator_channels)에는 이미 연동된 인플루언서의
 *                            최근 릴스·피드가 캡션까지 저장돼 있다. 그 캡션에서 이
 *                            브랜드 핸들 언급을 찾는다. 메타를 한 번도 부르지 않고
 *                            오늘 당장 값이 나오는 유일한 경로다.
 *
 * ②의 한계는 화면에서 숨기지 않는다 — 우리 서비스에 연동된 인플루언서의 최근
 * 콘텐츠만 덮으므로, 아무 사용자나 태그한 게시물까지 다 잡지는 못한다. 대신 이
 * 플랫폼에서 브랜드가 실제로 궁금해하는 콘텐츠(같이 일한 인플루언서가 올린 것)는
 * 대부분 여기에 들어온다. 그리고 그들은 연동 계정이라 릴스 조회수까지 있다 —
 * 남의 계정 게시물이라 조회수를 못 받는 tags 엣지보다 오히려 값이 풍부하다.
 *
 * 조회수는 목록을 만드는 그 자리에서 채운다
 * -----------------------------------------
 * ②로 들어온 릴스의 조회수는 creator_channels 에 0 으로 남아 있는 경우가 많다 —
 * 그 계정을 마지막으로 동기화한 시점에 인사이트 권한이 없었거나 올린 직후라 집계
 * 전이었기 때문이다. 저장된 피드(사진·캐러셀)에는 조회수 칸이 아예 없다. 저장된 값만
 * 쓰면 브랜드 화면의 조회수는 계속 비고, 사람이 새로고침해도 같은 화면이 나온다.
 * 그래서 목록이 정해진 직후 게시물 주인의 토큰으로 한 편씩 물어 빈 자리를 채운다
 * (fillMissingViews). 종류로 자르지 않는다 — 2025년 지표 개편 이후 `views` 는 사진·
 * 캐러셀에도 내려오는 값이다. 첫 로딩 안에서 끝나야 하는 일이라 편 수와 동시 실행
 * 수에 상한을 두고, 물어보지 못한 편 수는 세어 화면에 함께 내려보낸다.
 *
 * 브랜드가 직접 올린 게시물도 함께 받는다
 * ---------------------------------------
 * 월별 추이에서 브랜드가 보려는 것은 "그 달에 우리 브랜드로 오간 콘텐츠" 다. 태그된
 * 것만 세면 우리가 직접 올린 콘텐츠가 통째로 빠져서, 브랜드 계정이 활발했던 달이
 * 빈 달로 보인다. 그래서 자기 계정 미디어(`/me/media`)를 함께 받아 payload 의 별도
 * 배열(ownItems)에 담는다. 목록에는 섞지 않는다 — "누가 우리를 태그했나" 목록에 우리
 * 게시물이 끼면 그건 틀린 목록이다.
 */

/** 목록 상한. 브랜드 화면 한 장에서 훑을 수 있는 양을 넘기지 않는다. */
export const TAGGED_LIMIT = 120;
/** DB 훑기 상한. 캡션 조건에 걸린 인플루언서 수. */
const SCAN_ROW_LIMIT = 300;

/**
 * 캐시 유지 시간(시간 단위).
 *
 * 태그된 콘텐츠는 분 단위로 바뀌는 값이 아니고, 목록을 만드는 데 tags 엣지 호출과
 * 캡션 전체 훑기가 함께 들어간다. 새로고침마다 두 개를 다시 돌릴 이유가 없다.
 */
export const CACHE_TTL_HOURS = 6;
const CACHE_STORE = "business-tagged-media";
/**
 * 캐시 형식 판. 저장해 둔 값의 모양이 바뀌면 올린다.
 *
 * 예전 판에는 조회수를 채우지 않은 항목과 브랜드 자기 게시물이 없다. 키를 그대로 두면
 * 이미 캐시가 있는 브랜드는 TTL 이 끝날 때까지 조회수 없는 화면을 계속 본다. v3 부터는
 * 릴스가 아닌 게시물에도 조회수를 물어보고(isReelLike 주석 참고), 왜 비었는지를 함께
 * 담는다.
 */
const CACHE_VERSION = "v3";

/**
 * 조회수를 지금 채워 볼 콘텐츠 수 상한.
 *
 * 인사이트는 게시물 한 편에 한 번씩 불러야 한다. 상한이 없으면 태그된 콘텐츠가 많은
 * 브랜드의 첫 조회가 함수 실행 시간(10초)을 다 태우고, 그러면 목록조차 나오지 않는다.
 * 목록은 최신순이므로 앞쪽(= 브랜드가 실제로 보는 구간)부터 채운다. 뒤쪽 항목은
 * 저장된 값이 있으면 그 값을, 없으면 '—' 로 남는다.
 */
const VIEW_FILL_LIMIT = 36;
/** 조회수 조회 동시 실행 수. 위 상한을 세 번의 왕복으로 끝내는 크기. */
const VIEW_FILL_CHUNK = 12;
/**
 * 브랜드 자기 계정 게시물을 몇 페이지까지 받아 오는가.
 *
 * 두 페이지(최대 100개)면 웬만한 브랜드의 최근 6개월을 덮는다. 월별 그래프가 보는
 * 구간이 6개월이라 그보다 더 깊이 넘길 이유가 없다.
 */
const OWN_MEDIA_PAGES = 2;
/** 브랜드 자기 계정 게시물 한 페이지 크기. */
const OWN_MEDIA_PAGE_SIZE = 50;

/** tags 엣지를 못 쓴 이유. 화면이 사람에게 할 말을 고르는 데 쓴다. */
export type TagsUnavailableReason =
  | "NOT_SUPPORTED_BY_LOGIN"
  | "TOKEN_INVALID"
  | "NO_IG_ID"
  | "ERROR";

export interface TaggedMedia {
  id: string;
  permalink: string;
  thumbnailUrl: string;
  caption: string;
  timestamp: string;
  /** 올린 사람의 인스타그램 아이디. 카드에 그대로 보여 준다. */
  authorHandle: string;
  /** 우리 서비스 사용자명(연동 인플루언서인 경우). 없으면 빈 문자열. */
  authorUsername: string;
  /** IMAGE · VIDEO · CAROUSEL_ALBUM · REELS */
  mediaType: string;
  /**
   * 조회수·좋아요·댓글. 못 받은 값은 0 이 아니라 null 이다.
   *
   * 0 으로 적으면 "조회수 0" 이라는 사실 주장이 된다. 남의 계정 게시물에서
   * 조회수는 원래 안 오고, 좋아요도 상대가 숨겨 두면 빠진다(메타는 간접 조회에서
   * like_count 를 생략한다).
   */
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** 이 항목이 어디서 왔는가. 화면이 출처를 밝힐 수 있게. */
  source: "tags_api" | "creator_feed" | "brand_feed";
}

export interface TaggedMediaPayload {
  /** 브랜드 자신의 인스타그램 핸들. 무엇을 기준으로 찾았는지 화면이 밝힌다. */
  igUsername: string;
  items: TaggedMedia[];
  /**
   * 브랜드 계정이 직접 올린 게시물.
   *
   * 태그된 콘텐츠와 섞지 않고 따로 들고 다닌다 — "누가 우리를 태그했나" 목록에 우리
   * 게시물이 끼면 그건 틀린 목록이 된다. 월별 추이는 두 배열을 함께 세서, 브랜드가
   * 그 달에 오간 콘텐츠 전체(받은 것 + 올린 것)를 한 그래프에서 본다.
   */
  ownItems: TaggedMedia[];
  /** tags 엣지 시도 결과. 성공하면 목록에 tags_api 항목이 섞인다. */
  tagsApi: { ok: boolean; reason: TagsUnavailableReason | null };
  /** 캡션에서 언급을 찾은 연동 인플루언서 수. */
  scannedCreators: number;
  /** 조회수를 지금 조회해 채운 콘텐츠 수. 화면이 무엇을 근거로 냈는지 밝힐 수 있게. */
  viewsFilled: number;
  /**
   * 조회수가 왜 비었는지.
   *
   * "총 조회수" 가 '—' 로 남는 이유는 하나가 아니다 — 물어볼 토큰이 없는 게시물이거나
   * (연동하지 않은 계정이 올린 것), 물어봤는데 메타가 값을 주지 않은 경우다. 화면이
   * 그 둘을 구분해 말할 수 있어야 사람이 할 수 있는 일(연동 요청 vs 기다리기)을 안다.
   */
  viewsFill: {
    /** 조회수가 비어 있어 물어볼 후보로 잡힌 콘텐츠 수. */
    candidates: number;
    /** 실제로 물어본 수(상한에 걸려 뒤쪽은 빠질 수 있다). */
    attempted: number;
    /** 값을 받아 채운 수. */
    filled: number;
    /** 올린 계정의 연동을 찾을 수 없어 물어보지도 못한 수. */
    noToken: number;
  };
  fetchedAt: string;
}

export type TaggedMediaResult =
  | { ok: true; payload: TaggedMediaPayload; cached: boolean }
  | { ok: false; error: string; status: number; code: "META_NOT_LINKED" | "META_TOKEN_INVALID" | "NO_HANDLE" };

const graphHostFor = (tokenSource?: string) =>
  tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com";

/** tags 엣지에서 받을 필드. 전부 공개 필드다(인사이트는 남의 게시물에 못 쓴다). */
const TAG_FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url," +
  "permalink,timestamp,username,like_count,comments_count";

/** 필드를 줄인 재시도. 한 필드가 막혀 전체가 400 나는 경우를 살린다. */
const TAG_FIELDS_MINIMAL = "id,media_type,media_url,thumbnail_url,permalink,timestamp,username";

/**
 * 브랜드 계정의 연동 정보.
 *
 * 브랜드는 디엠 자동화 화면에서 계정을 붙인다(블롭 dm-automation, 키 dm_<사용자명>).
 * 캠페인용 collab 보관함은 캠페인에 지원하는 인플루언서 전용이라 여기서 보지 않는다.
 * 사용자명에 `biz/` 접두사가 붙은 그대로 넘겨야 키가 맞는다.
 */
export async function loadBrandLink(rawUsername: string): Promise<MetaLink | null> {
  return await loadMetaLink(rawUsername, "dm");
}

const igIdOf = (link: MetaLink) => String(link.igUserId || link.igAccountId || "");

/** LIKE 패턴에 쓸 문자 이스케이프. 인스타 핸들에는 `_` 가 흔하고 그건 LIKE 와일드카드다. */
const likeEscape = (raw: string) => raw.replace(/([\\%_])/g, "\\$1");

const escapeRegex = (raw: string) => raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 저장돼 있지 않은 지표는 null 이다.
 *
 * `intOf` 는 읽을 수 없는 값을 0 으로 돌려준다 — 합계 계산에는 맞지만 카드에 그대로
 * 적으면 "좋아요 0개"라는 사실 주장이 된다. 화면이 '—' 로 비울 수 있게 구분한다.
 */
const numOrNull = (raw: unknown): number | null =>
  raw === null || typeof raw === "undefined" || raw === "" ? null : intOf(raw);

/**
 * 캡션이 이 핸들을 언급했는가.
 *
 * `@brand` 는 맞지만 `@brandshop` 은 아니다. 뒤에 아이디에 쓰일 수 있는 글자가
 * 이어지면 다른 계정이다 — 접두사가 같은 남의 계정 게시물을 브랜드 목록에 올리면
 * 그건 틀린 정보다.
 */
export const mentionsHandle = (caption: string, handle: string): boolean => {
  if (!caption || !handle) return false;
  return new RegExp(`@${escapeRegex(handle)}(?![A-Za-z0-9._])`, "i").test(caption);
};

const cacheKey = (username: string) =>
  `tags_${CACHE_VERSION}_${username.replace(/[^a-z0-9._-]/gi, "_")}`;

async function readCache(username: string, ttlHours: number): Promise<TaggedMediaPayload | null> {
  try {
    const store = getStore({ name: CACHE_STORE, consistency: "eventual" });
    const hit = (await store.get(cacheKey(username), { type: "json" })) as TaggedMediaPayload | null;
    if (!hit?.fetchedAt) return null;
    const age = Date.now() - Date.parse(hit.fetchedAt);
    if (!Number.isFinite(age) || age > ttlHours * 3600_000) return null;
    return hit;
  } catch {
    return null;
  }
}

async function writeCache(username: string, payload: TaggedMediaPayload): Promise<void> {
  try {
    const store = getStore({ name: CACHE_STORE, consistency: "eventual" });
    await store.setJSON(cacheKey(username), payload);
  } catch (e) {
    console.warn("[tagged-media] 캐시 저장 실패:", (e as Error)?.message);
  }
}

/**
 * tags 엣지 시도.
 *
 * 인스타그램 로그인 토큰에서는 거부되는 것이 정상이다. 그래서 실패를 오류로 다루지
 * 않고 사유만 담아 돌려준다 — 이 호출이 실패해도 화면은 ②의 목록으로 채워진다.
 */
export async function fetchTagsEdge(
  link: MetaLink,
): Promise<{ ok: boolean; items: TaggedMedia[]; reason: TagsUnavailableReason | null }> {
  const igId = igIdOf(link);
  const token = String(link.accessToken || "");
  if (!igId || !token) return { ok: false, items: [], reason: "NO_IG_ID" };

  const host = graphHostFor(link.tokenSource);

  const ask = async (fields: string) => {
    const url =
      `https://${host}/${encodeURIComponent(igId)}/tags` +
      `?fields=${encodeURIComponent(fields)}&limit=50&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data } as const;
  };

  let attempt = await ask(TAG_FIELDS);
  if (!attempt.ok && !isTokenInvalidError(attempt.data)) {
    attempt = await ask(TAG_FIELDS_MINIMAL);
  }

  if (!attempt.ok) {
    const message = String(attempt.data?.error?.message || `HTTP ${attempt.status}`);
    if (isTokenInvalidError(attempt.data)) {
      return { ok: false, items: [], reason: "TOKEN_INVALID" };
    }
    // code 100 + "does not support this operation" 이 로그인 방식 때문에 막힌 경우다.
    // 문구는 버전마다 바뀌므로 코드와 문구를 함께 본다.
    const unsupported =
      Number(attempt.data?.error?.code) === 100 ||
      /does not support this operation|nonexisting field|unsupported get request/i.test(message);
    console.warn(`[tagged-media] tags 엣지 사용 불가 (${link.igUsername || "?"}): ${message}`);
    return { ok: false, items: [], reason: unsupported ? "NOT_SUPPORTED_BY_LOGIN" : "ERROR" };
  }

  const rows = Array.isArray(attempt.data?.data) ? attempt.data.data : [];
  const items: TaggedMedia[] = rows.map((m: any) => ({
    id: String(m?.id || ""),
    permalink: String(m?.permalink || ""),
    thumbnailUrl: String(m?.thumbnail_url || m?.media_url || ""),
    caption: String(m?.caption || ""),
    timestamp: String(m?.timestamp || ""),
    authorHandle: String(m?.username || ""),
    authorUsername: "",
    mediaType: String(m?.media_product_type === "REELS" ? "REELS" : m?.media_type || ""),
    // 남의 게시물에는 인사이트를 쓸 수 없다. 조회수는 원래 오지 않는다.
    views: null,
    // 상대가 좋아요 수를 숨기면 메타가 이 필드를 아예 빼고 준다. 그때는 null 이다.
    likes: typeof m?.like_count === "undefined" ? null : intOf(m.like_count),
    comments: typeof m?.comments_count === "undefined" ? null : intOf(m.comments_count),
    source: "tags_api" as const,
  }));

  return { ok: true, items, reason: null };
}

/**
 * 연동된 인플루언서의 최근 릴스·피드 캡션에서 이 브랜드 언급을 찾는다.
 *
 * SQL 로 후보를 좁히고(캡션 어딘가에 핸들 문자열이 있는 행), 항목별 판정은 자바스크립트
 * 정규식으로 다시 한다. `::text ILIKE` 는 캡션이 아닌 곳(썸네일 주소 등)에도 걸릴 수
 * 있어서 그것만으로는 근거가 되지 않는다.
 */
export async function scanCreatorMentions(
  db: any,
  handle: string,
): Promise<{ items: TaggedMedia[]; creators: number }> {
  const clean = handle.replace(/^@/, "").trim().toLowerCase();
  if (!clean) return { items: [], creators: 0 };

  const pattern = `%@${likeEscape(clean)}%`;
  let rows: any[] = [];
  try {
    rows = ((await db.sql`
      SELECT username, instagram_handle, recent_reels, recent_feed
        FROM creator_channels
       WHERE connected = TRUE
         AND (recent_reels::text ILIKE ${pattern} OR recent_feed::text ILIKE ${pattern})
       LIMIT ${SCAN_ROW_LIMIT}
    `) as any[]) || [];
  } catch (e) {
    console.warn("[tagged-media] 캡션 훑기 실패:", (e as Error)?.message);
    return { items: [], creators: 0 };
  }

  const items: TaggedMedia[] = [];
  let creators = 0;

  for (const row of rows) {
    const authorUsername = String(row?.username || "");
    const authorHandle = String(row?.instagram_handle || "").replace(/^@/, "");
    const reels = Array.isArray(row?.recent_reels) ? row.recent_reels : [];
    const feed = Array.isArray(row?.recent_feed) ? row.recent_feed : [];
    let matched = 0;

    for (const r of reels) {
      const caption = String(r?.caption || "");
      if (!mentionsHandle(caption, clean)) continue;
      matched += 1;
      items.push({
        id: String(r?.id || ""),
        permalink: String(r?.permalink || ""),
        thumbnailUrl: String(r?.thumbnailUrl || ""),
        caption,
        timestamp: String(r?.timestamp || ""),
        authorHandle,
        authorUsername,
        mediaType: "REELS",
        // 연동 계정의 자기 릴스라 조회수가 있다. 0 은 "아직 집계 전" 일 수 있어 null 로 둔다.
        views: intOf(r?.views) > 0 ? intOf(r.views) : null,
        likes: numOrNull(r?.likes),
        comments: numOrNull(r?.comments),
        source: "creator_feed",
      });
    }

    for (const f of feed) {
      const caption = String(f?.caption || "");
      if (!mentionsHandle(caption, clean)) continue;
      matched += 1;
      items.push({
        id: String(f?.id || ""),
        permalink: String(f?.permalink || ""),
        thumbnailUrl: String(f?.thumbnailUrl || ""),
        caption,
        timestamp: String(f?.timestamp || ""),
        authorHandle,
        authorUsername,
        mediaType: String(f?.mediaType || "IMAGE"),
        // 저장된 피드에는 조회수 칸이 없다. 아래에서 게시물별로 물어 채운다.
        views: null,
        likes: numOrNull(f?.likes),
        comments: numOrNull(f?.comments),
        source: "creator_feed",
      });
    }

    if (matched > 0) creators += 1;
  }

  return { items, creators };
}

/**
 * 인플루언서 본인 계정의 연동을 찾는다.
 *
 * 조회수(인사이트)는 게시물 주인의 토큰으로만 나온다. 캠페인 등록에서 붙인 연동을
 * 먼저 보고 없으면 디엠 자동화 연동을 본다 — 인사이트 화면이 쓰는 순서와 같다.
 * 죽은 토큰은 여기서 걸러진다(눌러도 영원히 같은 실패가 나는 호출을 아낀다).
 */
async function usableCreatorLink(username: string): Promise<MetaLink | null> {
  for (const scope of ["collab", "dm"] as const) {
    const link = await loadMetaLink(username, scope);
    if (linkIsUsable(link)) return link;
  }
  return null;
}

/**
 * 릴스·영상 게시물인가. 조회수를 먼저 물어볼 순서를 정하는 데 쓴다.
 *
 * 2025년 4월 메타 지표 개편 이후 `views` 는 릴스 전용 값이 아니다 — 없어진
 * impressions 를 대신하는 지표라서 사진·캐러셀 게시물에도 내려온다. 그래서 종류로
 * 후보를 자르지 않고, 값이 큰 릴스를 먼저 물어보는 순서만 이 함수로 정한다. 예전처럼
 * 릴스만 물어보면 브랜드를 태그한 게시물의 대다수(사진·캐러셀)는 조회수가 영원히
 * 비고, 화면의 "총 조회수" 는 태그가 쌓여도 계속 '—' 로 남는다.
 */
const isReelLike = (m: TaggedMedia): boolean => {
  const type = String(m.mediaType || "").toUpperCase();
  return type === "REELS" || type === "VIDEO";
};

/**
 * 비어 있는 조회수를 지금 채운다.
 *
 * 왜 필요한가 — creator_channels 에 굳혀 둔 릴스에는 조회수가 0 으로 남아 있는 경우가
 * 많다. 그 계정을 마지막으로 동기화한 시점에 인사이트 권한이 없었거나, 올린 직후라
 * 집계 전이었기 때문이다. 그리고 저장된 피드(사진·캐러셀)에는 조회수 칸이 아예 없다.
 * 그 값을 그대로 쓰면 브랜드 화면의 "총 조회수" 는 계속 '—' 로 비고, 사람은 새로
 * 불러오기를 눌러도 같은 화면을 본다. 그래서 목록을 만드는 그 자리에서 게시물 주인의
 * 토큰으로 한 편씩 물어본다.
 *
 * 릴스를 먼저 물어본다. 상한에 걸려 다 못 물어볼 때 남겨야 하는 것은 값이 큰 쪽이고,
 * 브랜드가 성과로 읽는 숫자도 릴스 조회수다.
 *
 * 못 받은 값은 0 으로 접지 않고 null 로 남긴다 — 조회수 0 과 "조회수를 못 받음" 은
 * 화면에서 다른 말이어야 한다. 대신 몇 편을 물어봤고 몇 편은 물어볼 토큰조차 없었는지
 * 세어 돌려준다. 화면이 '—' 의 이유를 말할 수 있어야 사람이 할 일을 안다.
 */
async function fillMissingViews(items: TaggedMedia[]): Promise<TaggedMediaPayload["viewsFill"]> {
  // 채울 수 있는 후보만 고른다. 우리 서비스 사용자명이 없는 항목(tags 엣지로 들어온
  // 남의 게시물)은 물어볼 토큰 자체가 없다.
  const empty = items.filter((m) => m.views === null && m.id);
  const candidates = empty.filter((m) => m.authorUsername);
  const targets = [
    ...candidates.filter(isReelLike),
    ...candidates.filter((m) => !isReelLike(m)),
  ].slice(0, VIEW_FILL_LIMIT);

  const fill: TaggedMediaPayload["viewsFill"] = {
    candidates: empty.length,
    attempted: targets.length,
    filled: 0,
    // 올린 계정이 우리 서비스 사용자가 아니면 인사이트를 물어볼 토큰이 없다.
    noToken: empty.length - candidates.length,
  };
  if (targets.length === 0) return fill;

  // 계정별 연동은 한 번만 읽는다. 한 인플루언서가 여러 편을 올렸을 때 같은 블롭을
  // 편 수만큼 다시 읽을 이유가 없다.
  const links = new Map<string, MetaLink | null>();
  for (const username of new Set(targets.map((m) => m.authorUsername))) {
    links.set(username, await usableCreatorLink(username));
  }
  // 연동이 죽었거나 없는 계정의 게시물은 물어보지 못한 쪽으로 센다.
  for (const m of targets) {
    if (!links.get(m.authorUsername)) {
      fill.attempted -= 1;
      fill.noToken += 1;
    }
  }

  for (let i = 0; i < targets.length; i += VIEW_FILL_CHUNK) {
    const chunk = targets.slice(i, i + VIEW_FILL_CHUNK);
    const views = await Promise.all(
      chunk.map(async (m) => {
        const link = links.get(m.authorUsername);
        return link ? await fetchMediaViews(link, m.id) : null;
      }),
    );
    chunk.forEach((m, idx) => {
      const value = views[idx];
      if (value === null) return;
      m.views = value;
      fill.filled += 1;
    });
  }

  return fill;
}

/**
 * 브랜드 계정이 직접 올린 최근 게시물.
 *
 * 자기 계정 미디어라 조회수까지 받을 수 있다(`/me/media` + 인사이트 필드 확장). 확장이
 * 막히는 계정에서는 목록만 받고 조회수는 릴스별로 따로 물어본다 — 목록 자체를 놓치면
 * 월별 그래프에서 브랜드가 올린 콘텐츠가 통째로 빠진다.
 *
 * 실패는 오류로 다루지 않는다. 이 값이 없어도 태그된 콘텐츠 화면은 성립한다.
 */
export async function fetchBrandOwnMedia(
  link: MetaLink,
): Promise<{ items: TaggedMedia[]; viewsFilled: number }> {
  const token = String(link.accessToken || "");
  if (!token) return { items: [], viewsFilled: 0 };
  const host = graphHostFor(link.tokenSource);
  const handle = String(link.igUsername || "").replace(/^@/, "");

  const firstPage = (fields: string) =>
    `https://${host}/me/media?fields=${encodeURIComponent(fields)}` +
    `&limit=${OWN_MEDIA_PAGE_SIZE}&access_token=${encodeURIComponent(token)}`;

  const rows: any[] = [];
  let next = firstPage(MEDIA_FIELDS_WITH_VIEWS);
  // 필드를 줄인 재시도를 한 번만 쓴다. 재시도가 페이지 예산을 먹지 않도록 페이지
  // 수와 따로 센다 — 확장이 막힌 계정이 절반의 게시물만 받게 되면 안 된다.
  let mayRetryWithoutViews = true;
  let pages = 0;

  while (next && pages < OWN_MEDIA_PAGES) {
    let res: Response;
    try {
      res = await fetch(next);
    } catch (e) {
      console.warn("[tagged-media] 브랜드 게시물 조회 실패:", (e as Error)?.message);
      break;
    }
    const data = (await res.json().catch(() => ({}))) as any;

    if (!res.ok) {
      // 인사이트 필드 확장이 막힌 계정이다. 목록만이라도 받는다 — 조회수는 아래에서
      // 게시물별로 따로 물어본다. 토큰이 죽은 경우에는 다시 불러도 같은 실패라
      // 두 번째 호출을 아낀다.
      if (pages === 0 && mayRetryWithoutViews && !isTokenInvalidError(data)) {
        mayRetryWithoutViews = false;
        next = firstPage(MEDIA_FIELDS);
        continue;
      }
      console.warn(
        "[tagged-media] 브랜드 게시물 조회 실패:",
        String(data?.error?.message || `HTTP ${res.status}`),
      );
      break;
    }

    rows.push(...(Array.isArray(data?.data) ? data.data : []));
    next = String(data?.paging?.next || "");
    pages += 1;
  }

  const items: TaggedMedia[] = rows.map((m: any) => {
    const isReels =
      String(m?.media_product_type || "").toUpperCase() === "REELS" ||
      String(m?.media_type || "").toUpperCase() === "VIDEO";
    const expanded = viewsOnMedia(m);
    return {
      id: String(m?.id || ""),
      permalink: String(m?.permalink || ""),
      thumbnailUrl:
        String(m?.media_type || "").toUpperCase() === "VIDEO"
          ? String(m?.thumbnail_url || m?.media_url || "")
          : String(m?.media_url || m?.thumbnail_url || ""),
      caption: String(m?.caption || "").slice(0, 200),
      timestamp: String(m?.timestamp || ""),
      authorHandle: handle,
      authorUsername: "",
      mediaType: isReels ? "REELS" : String(m?.media_type || "IMAGE"),
      views: expanded !== null && expanded > 0 ? expanded : null,
      likes: numOrNull(m?.like_count),
      comments: numOrNull(m?.comments_count),
      source: "brand_feed" as const,
    };
  });

  // 확장으로 못 받은 조회수는 자기 게시물별로 물어본다. 브랜드 토큰이므로 권한이 있다.
  // 릴스를 먼저 본다 — 상한에 걸리면 값이 큰 쪽이 남아야 한다.
  const blank = items.filter((m) => m.views === null && m.id);
  const missing = [...blank.filter(isReelLike), ...blank.filter((m) => !isReelLike(m))].slice(
    0,
    VIEW_FILL_LIMIT,
  );
  let viewsFilled = 0;
  for (let i = 0; i < missing.length; i += VIEW_FILL_CHUNK) {
    const chunk = missing.slice(i, i + VIEW_FILL_CHUNK);
    const values = await Promise.all(chunk.map((m) => fetchMediaViews(link, m.id)));
    chunk.forEach((m, idx) => {
      if (values[idx] === null) return;
      m.views = values[idx];
      viewsFilled += 1;
    });
  }

  return {
    items: items
      .filter((m) => m.id || m.permalink)
      .sort((a, b) => Date.parse(b.timestamp || "") - Date.parse(a.timestamp || "")),
    viewsFilled,
  };
}

/** 같은 게시물이 두 경로로 들어오면 한 번만 남긴다. tags 엣지 값을 우선한다. */
const dedupe = (items: TaggedMedia[]): TaggedMedia[] => {
  const byId = new Map<string, TaggedMedia>();
  for (const item of items) {
    // 아이디가 비어 있으면 링크로라도 구분한다. 둘 다 없으면 버린다 — 카드를 눌러도
    // 갈 곳이 없는 항목이다.
    const key = item.id || item.permalink;
    if (!key) continue;
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, item);
      continue;
    }
    // 두 경로가 같은 게시물을 줬다. 조회수는 연동 인플루언서 쪽에만 있고 좋아요·댓글은
    // 양쪽에 있을 수 있으니, 값이 있는 쪽을 골라 합친다.
    byId.set(key, {
      ...prev,
      views: prev.views ?? item.views,
      likes: prev.likes ?? item.likes,
      comments: prev.comments ?? item.comments,
      authorHandle: prev.authorHandle || item.authorHandle,
      authorUsername: prev.authorUsername || item.authorUsername,
      caption: prev.caption || item.caption,
      thumbnailUrl: prev.thumbnailUrl || item.thumbnailUrl,
    });
  }
  return [...byId.values()];
};

/**
 * 목록 조회 진입점. 캐시가 살아 있으면 메타도 DB 도 건드리지 않는다.
 *
 * `force` 는 사람이 "새로 불러오기" 를 누른 경우다.
 */
export async function getTaggedMedia(
  rawUsername: string,
  link: MetaLink,
  db: any,
  opts: { force?: boolean; ttlHours?: number } = {},
): Promise<TaggedMediaResult> {
  const handle = String(link.igUsername || "").replace(/^@/, "").trim();
  if (!handle) {
    return {
      ok: false,
      status: 200,
      code: "NO_HANDLE",
      error:
        "연동된 인스타그램 계정의 아이디를 확인할 수 없습니다. DM 자동화 화면에서 계정을 다시 연동해 주세요.",
    };
  }

  const ttl = opts.ttlHours ?? CACHE_TTL_HOURS;
  if (!opts.force) {
    const cached = await readCache(rawUsername, ttl);
    if (cached) return { ok: true, payload: cached, cached: true };
  }

  const [tags, scan, own] = await Promise.all([
    fetchTagsEdge(link),
    scanCreatorMentions(db, handle),
    // 브랜드가 직접 올린 게시물. 월별 추이가 "받은 것 + 올린 것" 을 함께 세려면
    // 목록을 만드는 이 자리에서 같이 받아 둬야 한다.
    fetchBrandOwnMedia(link),
  ]);

  const items = dedupe([...tags.items, ...scan.items])
    // 우리가 우리 계정을 언급한 게시물은 "누가 우리를 태그했나" 가 아니다.
    .filter((m) => m.authorHandle.toLowerCase() !== handle.toLowerCase())
    // 최신순이 기본 저장 순서다. 화면이 다른 기준으로 다시 정렬한다.
    .sort((a, b) => Date.parse(b.timestamp || "") - Date.parse(a.timestamp || ""))
    .slice(0, TAGGED_LIMIT);

  // 조회수는 여기서 채운다. 사람이 "새로 불러오기" 를 누를 때만 채우면, 처음 화면을
  // 연 사람은 조회수가 비어 있는 화면을 먼저 보고 왜 비었는지 알 방법이 없다.
  const fill = await fillMissingViews(items);

  const payload: TaggedMediaPayload = {
    igUsername: handle,
    items,
    ownItems: own.items,
    tagsApi: { ok: tags.ok, reason: tags.reason },
    scannedCreators: scan.creators,
    viewsFilled: fill.filled + own.viewsFilled,
    viewsFill: fill,
    fetchedAt: new Date().toISOString(),
  };

  await writeCache(rawUsername, payload);
  return { ok: true, payload, cached: false };
}

/** 연동이 쓸 수 있는 상태인지. 화면에 연동 안내를 띄울지 판단한다. */
export const brandLinkUsable = (link: MetaLink | null): boolean => linkIsUsable(link);
