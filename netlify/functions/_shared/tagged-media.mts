import { getStore } from "@netlify/blobs";
import {
  intOf,
  isTokenInvalidError,
  loadMetaLink,
  linkIsUsable,
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
  source: "tags_api" | "creator_feed";
}

export interface TaggedMediaPayload {
  /** 브랜드 자신의 인스타그램 핸들. 무엇을 기준으로 찾았는지 화면이 밝힌다. */
  igUsername: string;
  items: TaggedMedia[];
  /** tags 엣지 시도 결과. 성공하면 목록에 tags_api 항목이 섞인다. */
  tagsApi: { ok: boolean; reason: TagsUnavailableReason | null };
  /** 캡션에서 언급을 찾은 연동 인플루언서 수. */
  scannedCreators: number;
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

const cacheKey = (username: string) => `tags_${username.replace(/[^a-z0-9._-]/gi, "_")}`;

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
        // 사진·일반 영상 게시물에는 조회수가 없다.
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

  const [tags, scan] = await Promise.all([fetchTagsEdge(link), scanCreatorMentions(db, handle)]);

  const items = dedupe([...tags.items, ...scan.items])
    // 우리가 우리 계정을 언급한 게시물은 "누가 우리를 태그했나" 가 아니다.
    .filter((m) => m.authorHandle.toLowerCase() !== handle.toLowerCase())
    // 최신순이 기본 저장 순서다. 화면이 다른 기준으로 다시 정렬한다.
    .sort((a, b) => Date.parse(b.timestamp || "") - Date.parse(a.timestamp || ""))
    .slice(0, TAGGED_LIMIT);

  const payload: TaggedMediaPayload = {
    igUsername: handle,
    items,
    tagsApi: { ok: tags.ok, reason: tags.reason },
    scannedCreators: scan.creators,
    fetchedAt: new Date().toISOString(),
  };

  await writeCache(rawUsername, payload);
  return { ok: true, payload, cached: false };
}

/** 연동이 쓸 수 있는 상태인지. 화면에 연동 안내를 띄울지 판단한다. */
export const brandLinkUsable = (link: MetaLink | null): boolean => linkIsUsable(link);
