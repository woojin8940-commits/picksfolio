import {
  MEDIA_FIELDS,
  MEDIA_FIELDS_WITH_VIEWS,
  fetchMediaViews,
  graphHostFor,
  intOf,
  isTokenInvalidError,
  linkIsUsable,
  loadMetaLink,
  markLinkNeedsReauth,
  viewsOnMedia,
  type MetaLink,
} from "./instagram-metrics.mts";
import { todayInSeoul } from "./campaign-recruit.mts";

/**
 * 캠페인 성과 수집 — 업로드된 게시물의 조회수 · 좋아요 · 댓글.
 *
 * 지금까지 캠페인은 업로드 단계에서 게시물 주소를 받아 두고 끝났다. 그 게시물이
 * 얼마나 보였는지는 브랜드가 인플루언서에게 캡처를 받아 확인했고, 담당자는 그
 * 캡처를 옮겨 적었다. 숫자를 받아올 자리는 이미 있는데도 그랬다 — 인플루언서가
 * 캠페인용으로 연동해 둔 인스타그램 계정(스코프 'collab')의 토큰이면 자기 게시물의
 * 좋아요 · 댓글과 인사이트 조회수를 조회할 수 있다.
 *
 * ── 남의 게시물은 조회할 수 없다 ──
 * 인사이트는 게시물 주인의 토큰으로만 열린다. 그래서 협업 한 건의 지표는 반드시
 * 그 협업의 인플루언서 연동으로 받아야 한다. 브랜드나 담당자의 토큰으로는 같은
 * 게시물을 열 수 없다(그래서 화면은 "인플루언서 채널 연동 필요"를 말할 수 있어야 한다).
 *
 * ── 주소를 미디어로 바꾸는 일 ──
 * 인플루언서가 업로드 단계에 적는 것은 게시물 주소(permalink)뿐이다. 메타 API 는
 * 주소로 미디어를 찾아 주지 않으므로, 그 계정의 미디어 목록을 훑어 짧은 코드
 * (`/reel/<코드>/`)가 일치하는 항목을 찾는다. 한 번 찾은 media_id 는 표에 굳혀서
 * 다음 갱신부터는 목록을 다시 훑지 않는다 — 목록 조회는 이 수집에서 가장 비싼 호출이다.
 *
 * ── 실패도 기록한다 ──
 * 연동이 없거나 게시물을 못 찾은 것도 한 줄로 남긴다. 남기지 않으면 화면을 열
 * 때마다 죽은 연동에 다시 물어보게 되고, 사람은 "왜 비어 있는지"를 알 수 없다.
 */

/** 목록을 몇 페이지까지 훑을지. 캠페인 게시물은 대개 최근에 있어 3페이지면 충분하다. */
const LIST_PAGES = 3;
const LIST_LIMIT = 50;

/** 같은 게시물을 다시 물어보기 전에 기다리는 시간. 메타 호출 한도를 아낀다. */
export const FRESH_HOURS = 6;
/** 한 번의 수집에서 다룰 게시물 수 상한. 함수 실행 시간을 다 태우지 않게 막는다. */
const MAX_PER_RUN = 12;

/**
 * 숫자의 출처.
 *   meta_api      — 인플루언서의 캠페인 연동으로 게시물을 직접 조회했다(가장 정확).
 *   channel_cache — 연동이 없어, 인플루언서 채널에 저장해 둔 최근 게시물에서 맞췄다.
 *   unlinked      — 연동이 없고 채널 자료에도 그 게시물이 없다.
 *   not_found     — 연동은 살아 있는데 그 계정 게시물에서 주소를 찾지 못했다.
 *   error         — 메타가 오류로 답했다.
 */
export type MetricSource = "meta_api" | "channel_cache" | "unlinked" | "not_found" | "error";

export interface CollabPostRow {
  collabId: string;
  campaignId: string;
  creatorUsername: string;
  permalink: string;
  mediaId: string;
  mediaType: string;
  thumbnailUrl: string;
  postedAt: string | null;
  /** null 은 "받지 못했다"는 뜻이다. 0(아무도 보지 않았다)과 섞지 않는다. */
  views: number | null;
  likes: number | null;
  comments: number | null;
  source: MetricSource;
  note: string;
  collectedAt: string | null;
}

/** 게시물 주소에서 짧은 코드를 뽑는다. `/p/`, `/reel/`, `/reels/`, `/tv/` 를 모두 본다. */
export const shortcodeOf = (permalink: unknown): string => {
  const m = String(permalink || "").match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : "";
};

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

const thumbOf = (media: any) =>
  String(media?.media_type || "").toUpperCase() === "VIDEO"
    ? String(media?.thumbnail_url || media?.media_url || "")
    : String(media?.media_url || media?.thumbnail_url || "");

/**
 * 연동 계정의 미디어 목록에서 그 주소의 게시물을 찾는다.
 *
 * 조회수까지 한 번에 받는 필드 조합을 먼저 쓴다. 권한이 없으면 그 요청이 통째로
 * 실패하므로, 실패하면 조회수 없는 조합으로 한 번 더 부른다 — 목록을 놓치면
 * 좋아요 · 댓글까지 함께 잃는다.
 */
async function findMediaByPermalink(
  link: MetaLink,
  permalink: string,
): Promise<{ media: any | null; error: string; tokenDead: boolean }> {
  const token = String(link.accessToken || "");
  const code = shortcodeOf(permalink);
  if (!token || !code) return { media: null, error: code ? "" : "게시물 주소를 알아볼 수 없습니다.", tokenDead: false };

  const host = graphHostFor(link.tokenSource);
  let next =
    `https://${host}/me/media?fields=${encodeURIComponent(MEDIA_FIELDS_WITH_VIEWS)}` +
    `&limit=${LIST_LIMIT}&access_token=${encodeURIComponent(token)}`;
  let triedPlainFields = false;
  let lastError = "";

  for (let page = 0; page < LIST_PAGES && next; page += 1) {
    let data: any = {};
    let ok = false;
    try {
      const res = await fetch(next);
      data = (await res.json().catch(() => ({}))) as any;
      ok = res.ok;
      if (!ok) lastError = String(data?.error?.message || `HTTP ${res.status}`);
    } catch (e) {
      lastError = (e as Error)?.message || "요청 실패";
    }

    if (!ok) {
      if (isTokenInvalidError(data)) return { media: null, error: lastError, tokenDead: true };
      // 조회수 확장이 막힌 경우일 수 있다. 필드를 줄여 첫 페이지부터 한 번만 다시 본다.
      if (!triedPlainFields) {
        triedPlainFields = true;
        next =
          `https://${host}/me/media?fields=${encodeURIComponent(MEDIA_FIELDS)}` +
          `&limit=${LIST_LIMIT}&access_token=${encodeURIComponent(token)}`;
        page -= 1;
        continue;
      }
      return { media: null, error: lastError, tokenDead: false };
    }

    const items: any[] = Array.isArray(data?.data) ? data.data : [];
    const hit = items.find((m) => shortcodeOf(m?.permalink) === code);
    if (hit) return { media: hit, error: "", tokenDead: false };
    next = String(data?.paging?.next || "");
  }

  return { media: null, error: lastError, tokenDead: false };
}

/** 이미 찾아 둔 media_id 로 바로 조회한다. 목록을 훑지 않는 빠른 길. */
async function fetchMediaById(
  link: MetaLink,
  mediaId: string,
): Promise<{ media: any | null; error: string; tokenDead: boolean }> {
  const token = String(link.accessToken || "");
  if (!token || !mediaId) return { media: null, error: "", tokenDead: false };
  const host = graphHostFor(link.tokenSource);
  try {
    const res = await fetch(
      `https://${host}/${encodeURIComponent(mediaId)}?fields=${encodeURIComponent(MEDIA_FIELDS)}` +
        `&access_token=${encodeURIComponent(token)}`,
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (res.ok) return { media: data, error: "", tokenDead: false };
    const message = String(data?.error?.message || `HTTP ${res.status}`);
    return { media: null, error: message, tokenDead: isTokenInvalidError(data) };
  } catch (e) {
    return { media: null, error: (e as Error)?.message || "요청 실패", tokenDead: false };
  }
}

/**
 * 연동 없이 맞춰 보는 길 — 인플루언서 채널에 저장해 둔 최근 게시물.
 *
 * 채널 지표(creator_channels.recent_reels / recent_feed)는 인플루언서가 자기 채널을
 * 동기화할 때 이미 받아 둔 것이다. 캠페인 연동이 없거나 만료된 사람도 채널 자료는
 * 있는 경우가 많아서, 그 안에 같은 게시물이 있으면 숫자를 그대로 쓴다. 우리가 새로
 * 부르는 호출이 아니므로 토큰 경계를 넘지 않는다.
 *
 * 한계는 그대로 남는다. 메타는 최근 게시물만 돌려주므로 오래된 캠페인 게시물은 이
 * 목록에서 밀려나 맞춰지지 않고, 마지막 동기화 시점의 숫자다. 그래서 출처를
 * 'channel_cache' 로 구분해 둔다 — 화면이 "연동하면 더 정확해진다"를 말할 근거다.
 */
async function findInChannelCache(
  db: any,
  creator: string,
  permalink: string,
): Promise<{ views: number | null; likes: number | null; comments: number | null; thumbnailUrl: string; postedAt: string | null } | null> {
  const code = shortcodeOf(permalink);
  if (!code || !creator) return null;
  const rows = (await db.sql`
    SELECT recent_reels, recent_feed FROM creator_channels
    WHERE LOWER(username) = ${creator}
    LIMIT 1
  `) as any[];
  const row = rows?.[0];
  if (!row) return null;

  const reels = Array.isArray(row.recent_reels) ? row.recent_reels : [];
  const feed = Array.isArray(row.recent_feed) ? row.recent_feed : [];
  // 릴스 쪽을 먼저 본다 — 피드 항목에는 조회수가 없다.
  const hit =
    reels.find((r: any) => shortcodeOf(r?.permalink) === code) ||
    feed.find((f: any) => shortcodeOf(f?.permalink) === code);
  if (!hit) return null;

  const num = (raw: unknown) => (typeof raw === "undefined" || raw === null ? null : intOf(raw));
  return {
    views: num(hit.views),
    likes: num(hit.likes),
    comments: num(hit.comments),
    thumbnailUrl: String(hit.thumbnailUrl || ""),
    postedAt: hit.timestamp ? String(hit.timestamp) : null,
  };
}

/** 표 한 줄과 그날의 스냅샷을 함께 남긴다. 성공·실패 모두 기록한다. */
async function persistRow(
  db: any,
  input: {
    collabId: string;
    campaignId: string;
    creatorUsername: string;
    permalink: string;
    mediaId: string;
    mediaType: string;
    thumbnailUrl: string;
    postedAt: string | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    source: MetricSource;
    note: string;
  },
) {
  await db.sql`
    INSERT INTO collab_post_metrics (
      collab_id, campaign_id, creator_username, permalink, media_id, media_type,
      thumbnail_url, posted_at, views, likes, comments, source, note, collected_at, updated_at
    ) VALUES (
      ${input.collabId}, ${input.campaignId}, ${input.creatorUsername}, ${input.permalink},
      ${input.mediaId}, ${input.mediaType}, ${input.thumbnailUrl}, ${input.postedAt},
      ${input.views}, ${input.likes}, ${input.comments}, ${input.source}, ${input.note.slice(0, 300)},
      NOW(), NOW()
    )
    ON CONFLICT (collab_id) DO UPDATE SET
      campaign_id = EXCLUDED.campaign_id,
      creator_username = EXCLUDED.creator_username,
      permalink = EXCLUDED.permalink,
      -- 못 받은 값으로 이미 관측해 둔 값을 덮지 않는다. 한 번 본 숫자는 정산 근거다.
      media_id = COALESCE(NULLIF(EXCLUDED.media_id, ''), collab_post_metrics.media_id),
      media_type = COALESCE(NULLIF(EXCLUDED.media_type, ''), collab_post_metrics.media_type),
      thumbnail_url = COALESCE(NULLIF(EXCLUDED.thumbnail_url, ''), collab_post_metrics.thumbnail_url),
      posted_at = COALESCE(EXCLUDED.posted_at, collab_post_metrics.posted_at),
      views = COALESCE(EXCLUDED.views, collab_post_metrics.views),
      likes = COALESCE(EXCLUDED.likes, collab_post_metrics.likes),
      comments = COALESCE(EXCLUDED.comments, collab_post_metrics.comments),
      source = EXCLUDED.source,
      note = EXCLUDED.note,
      collected_at = NOW(),
      updated_at = NOW()
  `;

  // 실패한 조회로는 스냅샷을 남기지 않는다. 빈 점을 찍으면 그날 성과가 0 으로 읽힌다.
  if (input.views === null && input.likes === null && input.comments === null) return;
  const today = todayInSeoul();
  await db.sql`
    INSERT INTO collab_post_metric_snapshots (
      collab_id, captured_on, campaign_id, views, likes, comments
    ) VALUES (
      ${input.collabId}, ${today}::date, ${input.campaignId},
      ${input.views}, ${input.likes}, ${input.comments}
    )
    ON CONFLICT (collab_id, captured_on) DO UPDATE SET
      views = COALESCE(EXCLUDED.views, collab_post_metric_snapshots.views),
      likes = COALESCE(EXCLUDED.likes, collab_post_metric_snapshots.likes),
      comments = COALESCE(EXCLUDED.comments, collab_post_metric_snapshots.comments)
  `;
}

/**
 * 협업 한 건의 게시물 지표를 지금 받아 온다.
 *
 * `link` 를 넘기면 그 연동을 쓴다(캠페인 전체를 돌 때 같은 인플루언서의 연동을
 * 사람마다 한 번씩만 읽게 하기 위한 것이다).
 */
export async function collectCollabMetrics(
  db: any,
  collab: {
    id: string;
    campaign_id: string;
    creator_username: string;
    upload_url: string;
    media_id?: string;
  },
  opts: { link?: MetaLink | null } = {},
): Promise<{ ok: boolean; source: MetricSource }> {
  const creator = norm(collab.creator_username);
  const permalink = String(collab.upload_url || "").trim();
  const base = {
    collabId: collab.id,
    campaignId: collab.campaign_id,
    creatorUsername: creator,
    permalink,
    mediaId: String(collab.media_id || ""),
    mediaType: "",
    thumbnailUrl: "",
    postedAt: null as string | null,
    views: null as number | null,
    likes: null as number | null,
    comments: null as number | null,
  };

  /** 연동으로 못 받았을 때 채널 자료로 한 번 더 맞춰 본다. */
  const fallback = async (reason: string): Promise<{ ok: boolean; source: MetricSource }> => {
    const cached = await findInChannelCache(db, creator, permalink);
    if (cached) {
      await persistRow(db, {
        ...base,
        thumbnailUrl: cached.thumbnailUrl,
        postedAt: cached.postedAt,
        views: cached.views,
        likes: cached.likes,
        comments: cached.comments,
        source: "channel_cache",
        note: "인플루언서 채널에 저장된 최근 게시물에서 맞춘 값입니다.",
      });
      return { ok: true, source: "channel_cache" };
    }
    await persistRow(db, { ...base, source: "unlinked", note: reason });
    return { ok: false, source: "unlinked" };
  };

  const link =
    opts.link !== undefined ? opts.link : await loadMetaLink(creator, "collab");
  if (!linkIsUsable(link)) {
    return fallback(
      link
        ? "인플루언서의 인스타그램 연동이 만료되었습니다. 재연동하면 조회수까지 채워집니다."
        : "인플루언서가 캠페인용 인스타그램 계정을 연동하지 않았습니다.",
    );
  }

  // 이미 찾아 둔 미디어가 있으면 그 id 로 바로 간다. 실패하면(삭제·재업로드) 목록을 다시 훑는다.
  let found: { media: any | null; error: string; tokenDead: boolean } = base.mediaId
    ? await fetchMediaById(link!, base.mediaId)
    : { media: null, error: "", tokenDead: false };
  if (!found.media && !found.tokenDead) {
    found = await findMediaByPermalink(link!, permalink);
  }

  if (found.tokenDead) {
    await markLinkNeedsReauth(creator, "collab");
    return fallback("인플루언서의 인스타그램 연동이 만료되었습니다. 재연동하면 조회수까지 채워집니다.");
  }

  if (!found.media) {
    const cached = await findInChannelCache(db, creator, permalink);
    if (cached) {
      await persistRow(db, {
        ...base,
        thumbnailUrl: cached.thumbnailUrl,
        postedAt: cached.postedAt,
        views: cached.views,
        likes: cached.likes,
        comments: cached.comments,
        source: "channel_cache",
        note: "인플루언서 채널에 저장된 최근 게시물에서 맞춘 값입니다.",
      });
      return { ok: true, source: "channel_cache" };
    }
    const source: MetricSource = found.error ? "error" : "not_found";
    await persistRow(db, {
      ...base,
      source,
      note:
        found.error ||
        "연동된 계정의 최근 게시물에서 이 주소를 찾지 못했습니다. 다른 계정으로 올렸거나 게시물이 삭제되었을 수 있습니다.",
    });
    if (found.error) console.warn(`[post-metrics] ${collab.id} 조회 실패: ${found.error}`);
    return { ok: false, source };
  }

  const media = found.media;
  const mediaId = String(media?.id || base.mediaId || "");
  // 목록 요청에 조회수가 실려 왔으면 그대로 쓰고, 없으면 인사이트로 따로 묻는다.
  const views = viewsOnMedia(media) ?? (mediaId ? await fetchMediaViews(link!, mediaId) : null);

  await persistRow(db, {
    ...base,
    mediaId,
    mediaType: String(media?.media_product_type || media?.media_type || ""),
    thumbnailUrl: thumbOf(media),
    postedAt: media?.timestamp ? String(media.timestamp) : null,
    views,
    likes: typeof media?.like_count === "undefined" ? null : intOf(media.like_count),
    comments: typeof media?.comments_count === "undefined" ? null : intOf(media.comments_count),
    source: "meta_api",
    note: "",
  });
  return { ok: true, source: "meta_api" };
}

/**
 * 캠페인 하나의 게시물 지표를 훑어 갱신한다.
 *
 * 대상은 업로드 주소가 적힌 협업뿐이다. 아직 안 올린 협업에 대고 메타를 부를 이유가
 * 없다. `force` 가 아니면 최근에 받아 둔 줄은 건너뛴다.
 */
export async function collectCampaignMetrics(
  db: any,
  campaignId: string,
  opts: { force?: boolean; creatorUsername?: string } = {},
): Promise<{ attempted: number; collected: number; skipped: number }> {
  const rows = (await db.sql`
    SELECT c.id, c.campaign_id, c.creator_username, c.upload_url,
           m.media_id, m.collected_at
    FROM campaign_collabs c
    LEFT JOIN collab_post_metrics m ON m.collab_id = c.id
    WHERE c.campaign_id = ${campaignId}
      AND COALESCE(c.upload_url, '') <> ''
      AND c.cancelled_at IS NULL
      AND c.status <> 'cancelled'
      AND (${opts.creatorUsername || ""} = '' OR LOWER(c.creator_username) = ${opts.creatorUsername || ""})
    ORDER BY c.updated_at DESC
    LIMIT ${MAX_PER_RUN}
  `) as any[];

  const freshBefore = Date.now() - FRESH_HOURS * 3600_000;
  const targets = rows.filter((r) => {
    if (opts.force) return true;
    const at = r.collected_at ? new Date(r.collected_at).getTime() : 0;
    return !at || at < freshBefore;
  });

  if (targets.length === 0) {
    return { attempted: 0, collected: 0, skipped: rows.length };
  }

  // 같은 인플루언서의 연동은 한 번만 읽는다. 협업이 여러 건이어도 블롭 조회는 사람 수만큼이다.
  const linkCache = new Map<string, MetaLink | null>();
  let collected = 0;
  for (const row of targets) {
    const creator = norm(row.creator_username);
    if (!linkCache.has(creator)) {
      linkCache.set(creator, await loadMetaLink(creator, "collab"));
    }
    try {
      const res = await collectCollabMetrics(db, row, { link: linkCache.get(creator) });
      if (res.ok) collected += 1;
    } catch (e) {
      console.warn(`[post-metrics] ${row.id} 수집 중 오류:`, (e as Error)?.message);
    }
  }

  return { attempted: targets.length, collected, skipped: rows.length - targets.length };
}

const numOrNull = (raw: unknown) => (raw === null || typeof raw === "undefined" ? null : intOf(raw));

const shapeRow = (row: any): CollabPostRow => ({
  collabId: row.collab_id,
  campaignId: row.campaign_id,
  creatorUsername: norm(row.creator_username),
  permalink: row.permalink || "",
  mediaId: row.media_id || "",
  mediaType: row.media_type || "",
  thumbnailUrl: row.thumbnail_url || "",
  postedAt: row.posted_at || null,
  views: numOrNull(row.views),
  likes: numOrNull(row.likes),
  comments: numOrNull(row.comments),
  source: (row.source || "meta_api") as MetricSource,
  note: row.note || "",
  collectedAt: row.collected_at || null,
});

const sumOrNull = (values: (number | null)[]) => {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length === 0 ? null : valid.reduce((a, b) => a + b, 0);
};

/**
 * 일자별 추이.
 *
 * 조회수는 누적값이라, 어느 날 한 게시물의 스냅샷이 빠지면 그날 합계가 주저앉는다.
 * 그래서 게시물별 마지막 관측값을 날짜 순서대로 이어 붙인다(carry forward). 아직
 * 관측 전인 게시물은 0 으로 채우지 않는다 — 없는 값은 없는 값이다.
 */
function buildSeries(snapshots: any[]) {
  const dates = [...new Set(snapshots.map((s) => String(s.captured_on).slice(0, 10)))].sort();
  const last = new Map<string, { views: number | null; likes: number | null; comments: number | null }>();
  const byDate = new Map<string, any[]>();
  snapshots.forEach((s) => {
    const day = String(s.captured_on).slice(0, 10);
    byDate.set(day, [...(byDate.get(day) || []), s]);
  });

  return dates.map((date) => {
    (byDate.get(date) || []).forEach((s) => {
      last.set(s.collab_id, {
        views: numOrNull(s.views),
        likes: numOrNull(s.likes),
        comments: numOrNull(s.comments),
      });
    });
    const rows = [...last.values()];
    return {
      date,
      views: sumOrNull(rows.map((r) => r.views)) ?? 0,
      likes: sumOrNull(rows.map((r) => r.likes)) ?? 0,
      comments: sumOrNull(rows.map((r) => r.comments)) ?? 0,
    };
  });
}

/**
 * 캠페인 성과를 읽어 화면이 그릴 모양으로 만든다.
 *
 * `creatorUsername` 을 넘기면 그 사람의 게시물만 본다 — 인플루언서는 자기 성과만
 * 보고, 같은 캠페인의 다른 사람 숫자는 남의 자료다.
 */
export async function loadCampaignMetrics(
  db: any,
  campaignId: string,
  opts: { creatorUsername?: string; days?: number } = {},
) {
  const creator = norm(opts.creatorUsername);
  const days = opts.days || 30;

  const [metricRows, collabRows, snapshots] = await Promise.all([
    db.sql`
      SELECT * FROM collab_post_metrics
      WHERE campaign_id = ${campaignId}
        AND (${creator} = '' OR LOWER(creator_username) = ${creator})
      ORDER BY COALESCE(views, 0) DESC, posted_at DESC NULLS LAST
    `,
    db.sql`
      SELECT cc.id, cc.creator_username, cc.upload_url, cc.upload_confirmed_at,
             cc.status, cc.cancelled_at, COALESCE(ct.fee, 0) AS fee
      FROM campaign_collabs cc
      LEFT JOIN collab_terms ct ON ct.collab_id = cc.id
      WHERE cc.campaign_id = ${campaignId}
        AND (${creator} = '' OR LOWER(cc.creator_username) = ${creator})
    `,
    db.sql`
      SELECT s.collab_id, s.captured_on, s.views, s.likes, s.comments
      FROM collab_post_metric_snapshots s
      WHERE s.campaign_id = ${campaignId}
        AND s.captured_on >= (CURRENT_DATE - ${days}::int)
        AND (${creator} = '' OR EXISTS (
              SELECT 1 FROM campaign_collabs c
              WHERE c.id = s.collab_id AND LOWER(c.creator_username) = ${creator}
            ))
      ORDER BY s.captured_on ASC
    `,
  ]);

  const posts = (metricRows as any[]).map(shapeRow);
  // 취소된 협업은 성과에서 뺀다. 목록에는 남지만 그 사람의 게시물은 이 캠페인의
  // 결과가 아니고, 지급액도 나가지 않았다.
  const collabs = (collabRows as any[]).filter(
    (c) => !c.cancelled_at && c.status !== "cancelled",
  );
  const liveIds = new Set(collabs.map((c) => String(c.id)));
  const feeOf = new Map(collabs.map((c) => [String(c.id), intOf(c.fee)]));
  const withUpload = collabs.filter((c) => String(c.upload_url || "").trim());

  // 숫자가 실제로 들어온 줄만 합산한다. 실패로 남은 줄은 0 이 아니라 없는 값이다.
  const live = posts.filter((p) => liveIds.has(p.collabId));
  const measured = live.filter((p) => p.source === "meta_api" || p.source === "channel_cache");
  const views = sumOrNull(measured.map((p) => p.views));
  const likes = sumOrNull(measured.map((p) => p.likes));
  const comments = sumOrNull(measured.map((p) => p.comments));
  const engagements = likes === null && comments === null ? null : (likes || 0) + (comments || 0);

  return {
    posts: live,
    series: buildSeries((snapshots as any[]).filter((s: any) => liveIds.has(String(s.collab_id)))),
    totals: {
      /** 협업 수 · 업로드된 게시물 수 · 실제로 숫자를 받은 게시물 수. */
      collabCount: collabs.length,
      uploadedCount: withUpload.length,
      measuredCount: measured.length,
      views,
      likes,
      comments,
      engagements,
      /** 조회수를 한 건이라도 받았는가. 화면이 CPV 를 계산할 근거다. */
      viewsAvailable: measured.some((p) => p.views !== null && p.views > 0),
      /** 연동이 없어 못 받은 게시물 수. 화면이 "무엇을 하면 채워지는지"를 말할 근거다. */
      unlinkedCount: live.filter((p) => p.source === "unlinked").length,
      /** 채널 자료로 맞춘 게시물 수. 연동으로 받은 값보다 오래된 숫자일 수 있다. */
      cachedCount: live.filter((p) => p.source === "channel_cache").length,
      notFoundCount: live.filter((p) => p.source === "not_found").length,
      /**
       * 집계된 게시물에 실제로 나간 지급액의 합.
       *
       * CPV 를 캠페인 예산으로 계산하면 절반만 집계된 캠페인의 단가가 실제보다 두 배
       * 나쁘게 보인다. 그래서 "집계된 게시물의 지급액 ÷ 그 게시물의 조회수"로 센다 —
       * 분자와 분모가 같은 게시물에서 나온 값이어야 단가가 뜻을 갖는다.
       */
      measuredSpend: measured.reduce((sum, p) => sum + (feeOf.get(p.collabId) || 0), 0),
      totalSpend: collabs.reduce((sum, c) => sum + intOf(c.fee), 0),
      collectedAt:
        live.map((p) => p.collectedAt).filter(Boolean).sort().slice(-1)[0] || null,
    },
  };
}
