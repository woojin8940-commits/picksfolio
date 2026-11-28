import { getDatabase } from "@picks/netlify-database";
import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { memberNames, ownerLabel, ownsCampaign } from "./_shared/campaign-owner.mts";
import { dateOnly, saleStateOf } from "./_shared/affiliate-sale-period.mts";
import { SALE_STATUSES } from "./_shared/affiliate-store-orders.mts";
import {
  getFollowerDemographics,
  getReelInsights,
  resolveInsightsLink,
  type DemographicSlice,
} from "./_shared/creator-insights.mts";

/**
 * 비즈니스 계정의 캠페인 이력 — 지난 캠페인에서 올라간 게시물의 성과.
 *
 * 브랜드가 두 번째 캠페인을 열 때 가장 먼저 하는 질문은 "지난번에 뭐가 잘 됐지"다.
 * 지금까지 그 답은 어디에도 없었다. 캠페인 관리 화면은 진행 중인 건만 보여 주고,
 * 끝난 캠페인은 목록에서 사라진다. 그래서 브랜드는 매번 처음부터 다시 고른다.
 *
 * 이 API 가 하는 일은 세 가지를 한 자리에 모으는 것이다.
 *   1) 이 계정이 열었던 캠페인 전부 (모집 중 · 마감 · 종료를 구분해서)
 *   2) 캠페인별로 확정된 협업과 실제 업로드된 게시물
 *   3) 그 게시물의 메타 지표 (조회수 · 좋아요 · 댓글)
 *
 * ── 지표를 어떻게 붙이는가 ──
 *
 * 게시물 지표를 따로 저장하지 않는다. 업로드 주소(campaign_collabs.upload_url)의
 * 인스타그램 shortcode 를 인플루언서 채널에 받아 둔 최근 미디어
 * (creator_channels.recent_reels / recent_feed)의 permalink 와 맞춰 본다. 지표를
 * 캠페인 쪽에 복사해 두면 나중에 조회수가 올라도 그 값이 갱신되지 않아, 캠페인
 * 화면과 인플루언서 화면이 서로 다른 숫자를 말하게 된다.
 *
 * 대신 한계가 하나 생긴다. 메타는 최근 미디어만 돌려주므로, 오래된 캠페인의
 * 게시물은 그 목록에서 밀려나 맞춰지지 않는다. 그런 게시물은 숫자를 추정하지 않고
 * "집계 전"으로 둔다(reason 으로 이유를 구분해 보낸다). 추정치를 한 번 보여 주면
 * 나중에 실제 수치가 들어올 때 브랜드는 둘 중 무엇이 맞는지 알 수 없다.
 *
 * CPV 도 같은 이유로 조회수가 맞춰진 게시물만으로 계산하고, 몇 건 중 몇 건이
 * 집계됐는지(matched / uploaded)를 함께 보낸다. 절반만 집계된 조회수를 전체 예산으로
 * 나누면 CPV 가 실제보다 두 배로 나쁘게 보인다.
 *
 * ── 지급액을 두 개로 보내는 이유 ──
 *
 * spend 는 취소되지 않은 협업의 확정 지급액 전부이고, measuredSpend 는 그중 지표가
 * 맞춰진 게시물의 지급액만이다. CPV 는 measuredSpend 로 계산한다 — 분자와 분모가 같은
 * 게시물에서 나와야 단가가 뜻을 갖는다(캠페인 성과 패널 api-campaign-metrics 와 같은
 * 기준이다). 예전에는 전체 지급액을 집계된 조회수로 나눠서, 지표가 아직 안 잡힌 협업이
 * 섞인 캠페인은 같은 캠페인을 성과 패널에서 볼 때보다 CPV 가 나쁘게 나왔다.
 *
 * 그러면서도 spend 를 계속 보내는 이유는 브랜드가 "이 캠페인에 얼마가 확정됐나"를
 * 보는 자리가 따로 있기 때문이다. CPV 를 맞추려고 그 숫자를 집계된 건으로 줄이면
 * 실제로 나가는 돈이 실제보다 적게 보인다.
 *
 *   GET /api/business/campaign-history/:username
 *       ?from=YYYY-MM-DD&to=YYYY-MM-DD   캠페인 기간이 겹치는 것만(없으면 전체)
 *       &status=open|closed  &category=  &q=캠페인명  &creator=인플루언서 아이디 · 핸들
 *       &campaignId=  (캠페인 하나만)
 *       &sort=recent|overall|views|reach|comments|shares|cpv  &page=1&pageSize=20
 *   GET /api/business/campaign-history/:username?source=affiliate   (같은 조건을 받는다, sort=sales 추가)
 *       어필리에이트 이력 — 상품 하나가 캠페인 한 건, 선정된 인플루언서 한 명이 게시물 한 건이다.
 *       게시물 주소는 인플루언서가 MY 어필리에이트에 올린 콘텐츠 링크, 코드는 파트너십 코드다.
 *       광고비 대신 그 인플루언서의 전용 링크 판매액(취소 · 환불 제외)을 함께 보낸다.
 */

const norm = (raw: unknown) => String(raw ?? "").trim().toLowerCase();
const intOf = (raw: unknown) => {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

/**
 * 인스타그램 주소에서 게시물 코드만 꺼낸다.
 *
 * 같은 게시물이 `/reel/`, `/reels/`, `/p/` 로 오고 뒤에 `?igsh=...` 같은 추적
 * 파라미터가 붙는다. 주소를 문자열로 비교하면 같은 게시물이 다른 것으로 취급된다.
 */
const shortcodeOf = (url: unknown): string => {
  const m = String(url || "").match(/instagram\.com\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : "";
};

type PostMetric = {
  views: number;
  likes: number;
  comments: number;
  /**
   * 공유 수. 채널 동기화가 인사이트로 받아 둔 값이고, 못 받은 게시물(권한 없음 ·
   * 공유 수를 받기 전에 동기화된 채널)은 null 이다. 0 으로 두면 아무도 공유하지 않은
   * 게시물로 읽힌다.
   */
  shares: number | null;
  thumbnailUrl: string;
  permalink: string;
  timestamp: string;
  /** 릴스에서 맞췄는지 피드에서 맞췄는지. 피드 항목에는 조회수가 없다. */
  from: "reels" | "feed";
};

/** 게시물 인사이트 — 도달 · 저장수. 권한이 없거나 못 받은 값은 null(0 이면 "아무도 안 봤다"로 읽힌다). */
type PostInsight = { reach: number | null; saved: number | null };

/** 협업한 인플루언서의 팔로워 분포(성별 · 연령 · 국가). 메타가 준 그대로의 인원 수다. */
type CreatorAudience = {
  gender: DemographicSlice[];
  age: DemographicSlice[];
  country: DemographicSlice[];
  reason: string;
  fetchedAt: string;
};

/** 인플루언서 한 명당 인사이트를 받는 데 쓸 시간. 메타가 느린 계정 하나가 화면 전체를 붙잡지 않게 한다. */
const INSIGHT_PER_CREATOR_MS = 5_000;
/** 인사이트를 받는 데 쓸 전체 시간. 넘으면 받은 만큼만 싣는다. */
const INSIGHT_TOTAL_MS = 8_000;
/** 한 번에 메타를 부르는 인플루언서 수. */
const INSIGHT_CONCURRENCY = 4;
/** 릴스 인사이트 캐시를 이 화면에서는 6시간까지 그대로 쓴다(인플루언서 화면은 30분). */
const INSIGHT_TTL_MINUTES = 6 * 60;

const withTimeout = <T,>(work: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * 협업한 인플루언서들의 도달 · 저장수(게시물별)와 팔로워 분포를 받는다.
 *
 * 조회수 · 좋아요 · 댓글은 채널 동기화가 받아 둔 최근 미디어에서 오지만, 도달 · 저장수와
 * 팔로워 분포는 인사이트 권한으로만 받을 수 있어 인플루언서 연동으로 따로 읽는다(인플루언서의
 * 인사이트 화면과 같은 캐시를 쓴다). 인플루언서가 인사이트를 꺼 두었거나 연동이 없으면 비운다 —
 * 끊은 사람의 숫자를 브랜드에게 계속 보여 주지 않는다.
 */
async function loadCreatorInsights(
  creators: { username: string; followers: number | null }[],
): Promise<{ posts: Map<string, Record<string, PostInsight>>; audiences: Record<string, CreatorAudience> }> {
  const posts = new Map<string, Record<string, PostInsight>>();
  const audiences: Record<string, CreatorAudience> = {};
  const queue = [...creators];

  const one = async ({ username, followers }: { username: string; followers: number | null }) => {
    const resolved = await resolveInsightsLink(username, "insights");
    if (!resolved.link || !resolved.scope) return;
    const [reels, demographics] = await Promise.all([
      getReelInsights(username, resolved.link, resolved.scope, { ttlMinutes: INSIGHT_TTL_MINUTES }),
      getFollowerDemographics(username, resolved.link, followers),
    ]);
    if (reels.ok) {
      const index: Record<string, PostInsight> = {};
      for (const reel of reels.payload.reels) {
        const code = shortcodeOf(reel.permalink);
        if (code) index[code] = { reach: reel.reach, saved: reel.saved };
      }
      posts.set(username, index);
    }
    audiences[username] = {
      gender: demographics.gender,
      age: demographics.age,
      country: demographics.country,
      reason: demographics.reason,
      fetchedAt: demographics.fetchedAt,
    };
  };

  const worker = async () => {
    while (queue.length) {
      const next = queue.shift()!;
      try {
        await withTimeout(one(next), INSIGHT_PER_CREATOR_MS);
      } catch (e) {
        // 한 명의 인사이트를 못 받아도 이력 화면은 나머지 숫자로 그린다.
        console.warn("[business-campaign-history] 인사이트 조회 실패:", (e as Error)?.message);
      }
    }
  };
  // 전체에도 상한을 둔다. 시간 안에 받은 인플루언서까지만 싣고, 나머지는 다음에 열 때
  // (캐시가 채워진 뒤) 붙는다. 남은 인플루언서는 더 부르지 않도록 대기열을 비운다.
  const all = Promise.all(Array.from({ length: Math.min(INSIGHT_CONCURRENCY, queue.length) }, worker));
  const done = await withTimeout(all.then(() => true), INSIGHT_TOTAL_MS);
  if (!done) queue.length = 0;
  return { posts, audiences };
}

/** 채널 한 명의 최근 미디어를 shortcode → 지표 표로 바꾼다. */
const mediaIndexOf = (row: any): Record<string, PostMetric> => {
  const index: Record<string, PostMetric> = {};
  const put = (item: any, from: "reels" | "feed") => {
    const code = shortcodeOf(item?.permalink);
    if (!code) return;
    // 릴스 쪽이 조회수를 갖고 있으므로 릴스에서 이미 찾은 항목은 덮어쓰지 않는다.
    if (index[code] && index[code].from === "reels") return;
    index[code] = {
      views: intOf(item?.views),
      likes: intOf(item?.likes),
      comments: intOf(item?.comments),
      shares: item?.shares === null || typeof item?.shares === "undefined" ? null : intOf(item.shares),
      thumbnailUrl: String(item?.thumbnailUrl || ""),
      permalink: String(item?.permalink || ""),
      timestamp: String(item?.timestamp || ""),
      from,
    };
  };
  for (const r of Array.isArray(row?.recent_reels) ? row.recent_reels : []) put(r, "reels");
  for (const f of Array.isArray(row?.recent_feed) ? row.recent_feed : []) put(f, "feed");
  return index;
};

// ── 기간 · 검색 · 정렬 · 페이지 ────────────────────────────────────────────────
// 캠페인이 많아지면 한 번에 다 보내는 방식은 화면도 응답도 무거워진다(게시물 · 인사이트까지
// 실리므로). 그래서 조건으로 먼저 추리고, 정렬한 뒤 한 쪽(기본 20건)만 보낸다. 위쪽 합계는
// 페이지가 아니라 "조건에 맞는 전체" 기준이다.

export type HistorySort = "recent" | "overall" | "views" | "reach" | "comments" | "shares" | "cpv" | "sales";
const SORTS: HistorySort[] = ["recent", "overall", "views", "reach", "comments", "shares", "cpv", "sales"];
const DEFAULT_PAGE_SIZE = 20;

export interface HistoryQuery {
  from: string;
  to: string;
  status: "" | "open" | "closed";
  q: string;
  creator: string;
  category: string;
  /** 캠페인 하나만 볼 때 그 캠페인 id. */
  campaignId: string;
  /** mine: 내가 맡은 캠페인만, company: 회사 전체. */
  scope: "mine" | "company";
  sort: HistorySort;
  page: number;
  pageSize: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const parseHistoryQuery = (params: URLSearchParams): HistoryQuery => {
  const date = (v: string | null) => (v && DATE_RE.test(v) ? v : "");
  const status = params.get("status");
  const sort = params.get("sort") as HistorySort;
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const size = Math.floor(Number(params.get("pageSize")) || DEFAULT_PAGE_SIZE);
  return {
    from: date(params.get("from")),
    to: date(params.get("to")),
    status: status === "open" || status === "closed" ? status : "",
    q: norm(params.get("q")).slice(0, 80),
    creator: norm(params.get("creator")).replace(/^@/, "").slice(0, 60),
    category: String(params.get("category") || "").trim().slice(0, 60),
    campaignId: String(params.get("campaignId") || "").trim().slice(0, 80),
    scope: params.get("scope") === "company" ? "company" : "mine",
    sort: SORTS.includes(sort) ? sort : "recent",
    page,
    pageSize: Math.min(50, Math.max(10, size)),
  };
};

const dayOf = (v: unknown): string => {
  if (!v) return "";
  const s = String(v);
  if (DATE_RE.test(s.slice(0, 10))) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

/** 캠페인 기간(시작~종료, 없으면 등록일)이 고른 기간과 겹치는지. */
export const overlapsPeriod = (
  c: { start?: unknown; end?: unknown; created?: unknown },
  from: string,
  to: string,
): boolean => {
  if (!from && !to) return true;
  const start = dayOf(c.start) || dayOf(c.created);
  const end = dayOf(c.end) || start;
  if (!start) return false;
  if (to && start > to) return false;
  if (from && end < from) return false;
  return true;
};

const statusMatches = (status: string, filter: HistoryQuery["status"]) =>
  !filter ||
  (filter === "open" ? status === "active" : ["closed", "completed", "inactive"].includes(status));

/** 정렬 값. 0(집계 전)은 성과순에서 아래로 내린다 — CPV 0 이 가장 싼 것처럼 위에 오면 안 된다. */
const sortValueOf = (c: any, sort: HistorySort): number => {
  switch (sort) {
    case "views": return c.views || 0;
    case "reach": return c.reach || 0;
    case "comments": return c.comments || 0;
    case "shares": return c.shares || 0;
    case "cpv": return c.cpv || 0;
    case "sales": return c.sales || 0;
    case "overall": return c.score || 0;
    default: return 0;
  }
};

export const sortHistory = <T,>(list: T[], sort: HistorySort): T[] => {
  if (sort === "recent") return list;
  return [...list].sort((a, b) => {
    const av = sortValueOf(a, sort);
    const bv = sortValueOf(b, sort);
    if (av === 0 || bv === 0) return av === bv ? 0 : av === 0 ? 1 : -1;
    return sort === "cpv" ? av - bv : bv - av;
  });
};

const COUNTED_STATUSES = ["active", "closed", "completed", "inactive"];

/** 화면에 보낸 캠페인 목록으로 합계를 낸다(조건에 맞는 전체). */
const sumHistory = (list: any[], affiliate: boolean) => {
  const t: any = affiliate ? { ...emptyTotals(), sales: 0, orders: 0 } : emptyTotals();
  for (const c of list) {
    if (!affiliate && !COUNTED_STATUSES.includes(String(c.status))) continue;
    t.campaigns++;
    t.collabs += c.collabs || 0;
    t.uploaded += c.uploaded || 0;
    t.matched += c.matched || 0;
    t.views += c.views || 0;
    t.reactions += (c.likes || 0) + (c.comments || 0);
    t.comments += c.comments || 0;
    t.shares += c.shares || 0;
    t.sharesMatched += c.sharesMatched || 0;
    t.spend += c.spend || 0;
    t.measuredSpend += c.measuredSpend || 0;
    t.reach += c.reach || 0;
    t.saved += c.saved || 0;
    t.insightsMatched += c.insightsMatched || 0;
    if (affiliate) {
      t.sales += c.sales || 0;
      t.orders += c.orders || 0;
    }
  }
  t.cpv = t.views > 0 && t.measuredSpend > 0 ? Math.round(t.measuredSpend / t.views) : 0;
  return t;
};

const pageOf = <T,>(list: T[], query: HistoryQuery) => {
  const totalCount = list.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / query.pageSize));
  const page = Math.min(query.page, pageCount);
  return {
    items: list.slice((page - 1) * query.pageSize, page * query.pageSize),
    pagination: { page, pageSize: query.pageSize, totalCount, pageCount },
  };
};

/** 어필리에이트 이력은 상품 수가 적어 다 만든 뒤 같은 조건으로 추린다. */
const filterBuilt = (list: any[], query: HistoryQuery) =>
  list.filter((c) => {
    if (query.campaignId && String(c.id) !== query.campaignId) return false;
    if (!overlapsPeriod({ start: c.startDate, end: c.endDate, created: c.createdAt }, query.from, query.to)) return false;
    if (!statusMatches(String(c.status), query.status)) return false;
    if (query.category && c.category !== query.category) return false;
    if (query.q && !norm(c.title).includes(query.q)) return false;
    if (query.creator && !(c.posts || []).some((p: any) =>
      norm(p.creatorUsername).includes(query.creator) || norm(p.instagramHandle).includes(query.creator))) return false;
    return true;
  });

// ── 종합 점수 ──────────────────────────────────────────────────────────────
// "결국 누가 제일 잘했나"를 한 숫자로 본다. 조회 · 도달 · 저장 · 댓글 · 공유 · CPV(낮을수록
// 좋음)를 같은 조건 안의 다른 게시물(또는 캠페인)과 비교해 백분위(0~1)로 바꾸고, 값이 있는
// 지표만 평균 내 100점 만점으로 만든다. 단위가 다른 숫자(조회 10만 · 댓글 30)를 그대로 더하면
// 조회수만 남으므로 순위로 바꿔 더한다. 캠페인은 인원이 많을수록 합계가 커지므로 게시물당
// 평균으로 비교한다. 값이 하나도 없으면 점수도 없다(null).

type ScoreMetrics = Partial<Record<"views" | "reach" | "saved" | "comments" | "shares" | "cpv" | "sales", number | null>>;
const LOWER_IS_BETTER = new Set(["cpv"]);

const percentileOf = (values: number[], v: number): number => {
  if (values.length <= 1) return 1;
  let below = 0, equal = 0;
  for (const x of values) { if (x < v) below++; else if (x === v) equal++; }
  // 같은 값은 가운데 순위를 준다.
  return (below + (equal - 1) / 2) / (values.length - 1);
};

/** 항목마다 종합 점수(0~100, 정수)를 매긴다. 지표가 하나도 없으면 null. */
export const compositeScores = (rows: ScoreMetrics[]): (number | null)[] => {
  const keys = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  const pools = new Map<string, number[]>();
  for (const k of keys) {
    pools.set(k, rows.map((r) => (r as any)[k]).filter((v): v is number => typeof v === "number" && Number.isFinite(v)));
  }
  // 비교할 대상이 하나뿐이면 순위가 늘 1등(100점)이라 뜻이 없다. 지표가 있는 행이 2개 이상일 때만 매긴다.
  const scorable = rows.filter((r) => Object.values(r).some((v) => typeof v === "number" && Number.isFinite(v))).length;
  if (scorable < 2) return rows.map(() => null);
  return rows.map((r) => {
    const parts: number[] = [];
    for (const k of keys) {
      const v = (r as any)[k];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const pool = pools.get(k)!;
      const pct = percentileOf(pool, v);
      parts.push(LOWER_IS_BETTER.has(k) ? 1 - pct : pct);
    }
    if (!parts.length) return null;
    return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
  });
};

/** 게시물 하나의 지표. 집계가 없으면 null 로 두어 점수 계산에서 빠지게 한다. */
const postScoreMetrics = (p: any, affiliate: boolean): ScoreMetrics => {
  if (p.cancelled) return {};
  const m = p.metrics;
  const views = m?.from === "reels" && m.views > 0 ? m.views : null;
  // 조회수(어필리에이트는 판매액)가 잡히지 않은 게시물은 점수에서 뺀다. 댓글 0 · 공유 0 만으로
  // 점수를 매기면 지표가 거의 없는 게시물이 순위 위로 올라온다.
  if (!affiliate && views === null) return {};
  if (affiliate && !(p.sales > 0) && views === null) return {};
  const out: ScoreMetrics = {
    views,
    comments: m ? m.comments : null,
    shares: m && m.shares !== null && m.shares !== undefined ? m.shares : null,
  };
  if (affiliate) {
    out.sales = p.sales > 0 ? p.sales : null;
  } else {
    out.reach = p.insights?.reach ?? null;
    out.saved = p.insights?.saved ?? null;
    out.cpv = views && p.fee > 0 ? Math.round(p.fee / views) : null;
  }
  return out;
};

/** 캠페인의 게시물당 평균 지표. */
const campaignScoreMetrics = (c: any, affiliate: boolean): ScoreMetrics => {
  const avg = (sum: number, n: number) => (n > 0 ? sum / n : null);
  // 조회수가 하나도 잡히지 않은 캠페인(어필리에이트는 판매도 없는 캠페인)은 점수에서 뺀다.
  if (!(c.matched > 0) && !(affiliate && c.sales > 0)) return {};
  const out: ScoreMetrics = {
    views: avg(c.views, c.matched),
    comments: avg(c.comments, c.matched),
    shares: avg(c.shares, c.sharesMatched),
  };
  if (affiliate) {
    out.sales = c.collabs > 0 && c.sales > 0 ? c.sales / c.collabs : null;
  } else {
    out.reach = avg(c.reach, c.insightsMatched);
    out.saved = avg(c.saved, c.insightsMatched);
    out.cpv = c.cpv > 0 ? c.cpv : null;
  }
  return out;
};

/**
 * 조건에 맞는 캠페인 전체에 점수를 매긴다(캠페인 · 게시물). 그리고 인플루언서별 평균 점수로
 * 종합 순위를 만든다 — "평균적으로 누가 제일 좋았나".
 */
const applyScores = (campaigns: any[], affiliate: boolean) => {
  const cScores = compositeScores(campaigns.map((c) => campaignScoreMetrics(c, affiliate)));
  campaigns.forEach((c, i) => { c.score = cScores[i]; });

  const allPosts = campaigns.flatMap((c) => (c.posts || []).map((p: any) => ({ p, c })));
  const pScores = compositeScores(allPosts.map(({ p }) => postScoreMetrics(p, affiliate)));
  allPosts.forEach(({ p }, i) => { p.score = pScores[i]; });

  const byCreator = new Map<string, any>();
  for (const { p, c } of allPosts) {
    if (p.score === null || p.score === undefined || p.cancelled) continue;
    const key = p.creatorUsername;
    const row = byCreator.get(key) || {
      creatorUsername: key, instagramHandle: p.instagramHandle || "", posts: 0, campaigns: new Set<string>(),
      scoreSum: 0, views: 0, viewsN: 0, reach: 0, reachN: 0, fee: 0, feeViews: 0, sales: 0,
    };
    row.posts++;
    row.campaigns.add(String(c.id));
    row.scoreSum += p.score;
    if (p.metrics?.from === "reels" && p.metrics.views > 0) {
      row.views += p.metrics.views; row.viewsN++;
      if (p.fee > 0) { row.fee += p.fee; row.feeViews += p.metrics.views; }
    }
    if (typeof p.insights?.reach === "number") { row.reach += p.insights.reach; row.reachN++; }
    row.sales += p.sales || 0;
    byCreator.set(key, row);
  }
  return Array.from(byCreator.values())
    .map((r) => ({
      creatorUsername: r.creatorUsername,
      instagramHandle: r.instagramHandle,
      posts: r.posts,
      campaigns: r.campaigns.size,
      score: Math.round(r.scoreSum / r.posts),
      avgViews: r.viewsN ? Math.round(r.views / r.viewsN) : 0,
      avgReach: r.reachN ? Math.round(r.reach / r.reachN) : 0,
      cpv: r.feeViews > 0 ? Math.round(r.fee / r.feeViews) : 0,
      sales: r.sales,
    }))
    .sort((a, b) => b.score - a.score || b.posts - a.posts || b.avgViews - a.avgViews)
    .slice(0, 10);
};

export default async (req: Request, context: Context) => {
  const raw = context.params.username || "";
  const username = norm(raw).replace(/^biz\//, "");
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const db = getDatabase();

  // 어필리에이트 이력에서 판매가 끝난(판매 중지 · 종료 · 삭제) 상품을 지운다. 주문 · 수수료 기록은 그대로 두고 이력 화면에서만 내린다.
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "hide_affiliate") return Response.json({ error: "알 수 없는 요청입니다." }, { status: 400 });
    const productId = String(body?.productId || "").trim().slice(0, 60);
    if (!productId) return Response.json({ error: "상품을 찾을 수 없습니다." }, { status: 400 });
    try {
      const rows = (await db.sql`
        SELECT id, status, deleted_at, stock, sale_start_date, sale_end_date
        FROM affiliate_store_products WHERE id = ${productId} AND business_username = ${username}
      `) as any[];
      const p = rows[0];
      if (!p) return Response.json({ error: "상품을 찾을 수 없습니다." }, { status: 404 });
      const state = saleStateOf({
        status: p.status, deleted_at: p.deleted_at, stock: p.stock,
        sale_start_date: p.sale_start_date, sale_end_date: p.sale_end_date,
      });
      if (state === "on_sale" || state === "sold_out" || state === "scheduled") {
        return Response.json({ error: "판매 중인 상품은 이력에서 삭제할 수 없어요. 먼저 판매를 중지해 주세요." }, { status: 409 });
      }
      await db.sql`
        UPDATE affiliate_store_products SET brand_history_hidden_at = COALESCE(brand_history_hidden_at, NOW())
        WHERE id = ${productId} AND business_username = ${username}
      `;
      return Response.json({ ok: true });
    } catch (err: any) {
      console.error("[business-campaign-history] 어필리에이트 이력 삭제 실패:", err);
      return Response.json({ error: "이력에서 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    }
  }

  const searchParams = new URL(req.url).searchParams;
  const query = parseHistoryQuery(searchParams);

  if (searchParams.get("source") === "affiliate") {
    try {
      const all = await affiliateHistory(db, username);
      const matchedList = filterBuilt(all.campaigns, query);
      const creatorRanking = applyScores(matchedList, true);
      const filtered = sortHistory(matchedList, query.sort);
      const { items, pagination } = pageOf(filtered, query);
      return Response.json({
        totals: sumHistory(filtered, true),
        accountTotals: { campaigns: all.totals.campaigns, views: all.totals.views },
        creatorRanking,
        campaigns: items,
        categories: all.categories,
        campaignOptions: all.campaigns.map((c: any) => ({ id: String(c.id), title: String(c.title || ""), startDate: c.startDate || null })),
        pagination,
      });
    } catch (err: any) {
      console.error("[business-campaign-history] 어필리에이트 이력 조회 실패:", err);
      return Response.json({ error: "어필리에이트 이력을 불러오지 못했습니다." }, { status: 500 });
    }
  }

  try {
    // 삭제한 캠페인도 읽는다(deleted_at 을 조건으로 걸지 않는다).
    //
    // 협업 메뉴에서 캠페인을 내리는 것은 "목록 정리"이고, 이 화면은 "지난 집행의
    // 기록"이다. 둘을 같은 조건으로 묶어 두면 끝난 캠페인을 정리한 브랜드가 자기
    // 광고비와 성과를 다시 볼 방법이 없어진다. 내려간 캠페인이라는 사실만 함께
    // 보내서 화면이 배지로 구분한다.
    const allCampaignRows = (await db.sql`
      SELECT id, title, category, type, status, reward_mode, thumbnail_url,
             start_date, end_date, budget_krw, created_at, deleted_at, owner_member
      FROM campaigns
      WHERE LOWER(REPLACE(business_username, 'biz/', '')) = ${username}
      ORDER BY created_at DESC, id DESC
    `) as any[];
    // 내 캠페인(내가 맡은 것) / 회사 전체. 회사 전체는 관리자 · 직원 모두 볼 수 있다(성과만 — 연락처는 없다).
    const campaignRows = query.scope === "company"
      ? allCampaignRows
      : allCampaignRows.filter((c) => ownsCampaign(auth, c.owner_member));
    const ownerNames = auth.teamRole ? await memberNames(username) : new Map<string, string>();

    const campaignIds = (campaignRows || []).map((c) => String(c.id));
    if (campaignIds.length === 0) {
      return Response.json({
        totals: emptyTotals(),
        accountTotals: { campaigns: 0, views: 0 },
        campaigns: [],
        categories: [],
        pagination: { page: 1, pageSize: query.pageSize, totalCount: 0, pageCount: 1 },
      });
    }

    // 확정된 협업과 확정 조건(지급액)을 함께 읽는다. 취소된 건은 성과 집계에서
    // 빼되 목록에는 남긴다 — "몇 명이 중간에 빠졌는지"도 이력이다.
    const collabRows = (await db.sql`
      SELECT cc.id, cc.campaign_id, cc.creator_username, cc.status, cc.upload_url,
             cc.ad_code, cc.clean_file_url, cc.clean_file_name,
             cc.confirmed_at, cc.completed_at, cc.cancelled_at, cc.created_at,
             -- 브랜드 화면이므로 금액은 인플루언서 보수가 아니라 브랜드가 내는 광고비다
             -- (_shared/brand-billing.mts 와 같은 규칙). 보수를 실으면 마진이 드러난다.
             CASE
               WHEN COALESCE(cl.quoted_fee, 0) + COALESCE(cl.quoted_second_use_fee, 0) > 0
                 THEN COALESCE(cl.quoted_fee, 0) + COALESCE(cl.quoted_second_use_fee, 0)
               WHEN cl.id IS NOT NULL THEN 0
               ELSE COALESCE(ct.fee, 0)
             END AS fee
      FROM campaign_collabs cc
      LEFT JOIN collab_terms ct ON ct.collab_id = cc.id
      -- 명단 행은 협업 아이디로 먼저, 아직 연결되지 않은 행(지원 수락으로 협업이 생긴 뒤
      -- 담당자가 따로 명단에 올린 경우)은 캠페인 + 인플루언서 아이디로 찾는다. 정산 탭
      -- (api-campaign-brand-settlement)과 같은 규칙이어야 두 화면의 금액이 같다.
      LEFT JOIN LATERAL (
        SELECT l.id, l.quoted_fee, l.quoted_second_use_fee
        FROM campaign_listups l
        WHERE l.campaign_id = cc.campaign_id
          AND (l.collab_id = cc.id OR LOWER(l.influencer_username) = LOWER(cc.creator_username))
        ORDER BY (l.collab_id = cc.id) DESC NULLS LAST
        LIMIT 1
      ) cl ON TRUE
      WHERE cc.campaign_id = ANY(${campaignIds})
      ORDER BY cc.created_at ASC
    `) as any[];

    const creatorNames = Array.from(
      new Set((collabRows || []).map((c) => norm(c.creator_username)).filter(Boolean)),
    );

    const channelRows = creatorNames.length
      ? ((await db.sql`
          SELECT username, instagram_handle, followers, avg_views, metrics_source,
                 connected, recent_reels, recent_feed, synced_at
          FROM creator_channels
          WHERE username = ANY(${creatorNames})
        `) as any[])
      : [];

    const channelByUser = new Map<string, any>();
    const mediaByUser = new Map<string, Record<string, PostMetric>>();
    for (const row of channelRows || []) {
      const key = norm(row.username);
      channelByUser.set(key, row);
      mediaByUser.set(key, mediaIndexOf(row));
    }

    const collabsByCampaign = new Map<string, any[]>();
    for (const c of collabRows || []) {
      const key = String(c.campaign_id);
      if (!collabsByCampaign.has(key)) collabsByCampaign.set(key, []);
      collabsByCampaign.get(key)!.push(c);
    }

    // 계정 전체 기준(조건과 무관) — 캠페인 수와 조회수만. 인사이트를 부르지 않는 값이라 가볍다.
    const accountTotals = { campaigns: 0, views: 0 };
    for (const c of campaignRows || []) {
      if (!COUNTED_STATUSES.includes(String(c.status))) continue;
      accountTotals.campaigns++;
      for (const collab of collabsByCampaign.get(String(c.id)) || []) {
        if (collab.cancelled_at || collab.status === "cancelled") continue;
        const code = shortcodeOf(collab.upload_url);
        const metric = code ? mediaByUser.get(norm(collab.creator_username))?.[code] : undefined;
        if (metric?.from === "reels") accountTotals.views += metric.views;
      }
    }

    // 조건(기간 · 상태 · 카테고리 · 캠페인명 · 인플루언서)으로 먼저 추린다. 인사이트는 남은
    // 캠페인의 인플루언서만 부른다 — 기간을 좁히면 메타 호출도 그만큼 준다.
    const filteredRows = (campaignRows || []).filter((c) => {
      if (query.campaignId && String(c.id) !== query.campaignId) return false;
      if (!overlapsPeriod({ start: c.start_date, end: c.end_date, created: c.created_at }, query.from, query.to)) return false;
      if (!statusMatches(String(c.status || ""), query.status)) return false;
      if (query.category && String(c.category || "") !== query.category) return false;
      if (query.q && !norm(c.title).includes(query.q)) return false;
      if (query.creator) {
        const hit = (collabsByCampaign.get(String(c.id)) || []).some((collab) => {
          const name = norm(collab.creator_username);
          return name.includes(query.creator) ||
            norm(channelByUser.get(name)?.instagram_handle).includes(query.creator);
        });
        if (!hit) return false;
      }
      return true;
    });
    const filteredIds = new Set(filteredRows.map((c) => String(c.id)));

    // 도달 · 저장수 · 팔로워 분포는 게시물을 올린(취소되지 않은) 인플루언서만 읽는다.
    const insightCreators = Array.from(
      new Set(
        (collabRows || [])
          .filter((c) => filteredIds.has(String(c.campaign_id)))
          .filter((c) => c.upload_url && !c.cancelled_at && c.status !== "cancelled")
          .map((c) => norm(c.creator_username))
          .filter(Boolean),
      ),
    ).map((name) => {
      const followers = intOf(channelByUser.get(name)?.followers);
      return { username: name, followers: followers > 0 ? followers : null };
    });
    const insights = await loadCreatorInsights(insightCreators);

    const categories = new Set<string>();
    for (const c of campaignRows || []) if (c.category) categories.add(String(c.category));

    const campaigns = filteredRows.map((c) => {
      const list = collabsByCampaign.get(String(c.id)) || [];

      let views = 0;
      let likes = 0;
      let comments = 0;
      let shares = 0;
      // 공유 수를 실제로 받은 게시물 수. 화면이 "집계 전"과 "공유 0"을 가르는 근거다.
      let sharesMatched = 0;
      let matched = 0;
      let uploaded = 0;
      let spend = 0;
      // CPV 의 분자. 지표가 맞춰진 게시물의 지급액만 들어간다.
      let measuredSpend = 0;
      // 도달 · 저장수 합계와 그 값을 받은 게시물 수(받지 못한 게시물은 0 으로 더하지 않는다).
      let reach = 0;
      let saved = 0;
      let insightsMatched = 0;

      const posts = list.map((collab) => {
        const creator = norm(collab.creator_username);
        const channel = channelByUser.get(creator);
        const uploadUrl = String(collab.upload_url || "");
        const code = shortcodeOf(uploadUrl);
        const metric = code ? mediaByUser.get(creator)?.[code] : undefined;
        const cancelled = !!collab.cancelled_at || collab.status === "cancelled";
        const insight = code ? insights.posts.get(creator)?.[code] : undefined;
        const postInsight =
          insight && (insight.reach !== null || insight.saved !== null) ? insight : null;
        if (postInsight && !cancelled) {
          insightsMatched++;
          reach += postInsight.reach ?? 0;
          saved += postInsight.saved ?? 0;
        }

        if (uploadUrl && !cancelled) uploaded++;
        if (!cancelled) spend += intOf(collab.fee);
        if (metric && !cancelled) {
          if (metric.from === 'reels') {
            matched++;
            views += metric.views;
          }
          likes += metric.likes;
          comments += metric.comments;
          if (metric.shares !== null) {
            shares += metric.shares;
            sharesMatched++;
          }
          if (metric.from === 'reels' && metric.views > 0) measuredSpend += intOf(collab.fee);
        }

        return {
          collabId: String(collab.id),
          creatorUsername: creator,
          instagramHandle: String(channel?.instagram_handle || ""),
          status: String(collab.status || ""),
          cancelled,
          uploadUrl,
          // 인플루언서가 업로드 단계에 남긴 브랜디드 콘텐츠 파트너십 코드.
          // 이 코드가 있어야 브랜드가 그 게시물을 자기 광고 소재로 돌릴 수 있어서,
          // 이력 화면에서 부스팅 버튼을 열지 말지를 가르는 값이다.
          partnershipCode: String(collab.ad_code || "").trim(),
          /**
           * 인플루언서가 업로드 단계에 함께 올린 클린본(자막·로고 없는 원본 영상).
           *
           * 코드와 한 쌍이다 — 코드는 게시물을 광고 소재로 지정하게 해 주고, 새 소재로
           * 편집해 돌리려면 이 파일이 필요하다. 예전에는 카카오톡으로 오갔고 캠페인이
           * 끝나면 찾을 수 없었다. 이력 화면에서 바로 내려받게 주소를 함께 보낸다.
           */
          cleanFileUrl: String(collab.clean_file_url || "").trim(),
          cleanFileName: String(collab.clean_file_name || "").trim(),
          fee: intOf(collab.fee),
          followers: intOf(channel?.followers),
          metricsSource: String(channel?.metrics_source || ""),
          // 지표가 없으면 왜 없는지까지 보낸다. 화면이 "아직 안 올렸다"와
          // "올렸는데 연동이 없다"를 다르게 안내해야 브랜드가 할 일을 안다.
          metrics: metric || null,
          /** 도달 · 저장수. 인플루언서가 인사이트를 연동했고 최근 릴스에서 찾은 게시물만 값이 있다. */
          insights: postInsight,
          reason: metric
            ? ""
            : cancelled
              ? "cancelled"
              : !uploadUrl
                ? "not_uploaded"
                : !channel?.connected
                  ? "not_linked"
                  : "out_of_window",
        };
      });

      const cpv =
        views > 0 && measuredSpend > 0 ? Math.round(measuredSpend / views) : 0;

      const collabs = list.filter(collab => !collab.cancelled_at && collab.status !== 'cancelled').length;

      return {
        id: String(c.id),
        title: String(c.title || ""),
        category: String(c.category || ""),
        type: String(c.type || ""),
        status: String(c.status || ""),
        /** 협업 메뉴에서 내린 캠페인. 이력에는 남고, 화면에서는 배지로 구분한다. */
        removed: Boolean(c.deleted_at),
        rewardMode: String(c.reward_mode || ""),
        thumbnailUrl: String(c.thumbnail_url || ""),
        startDate: String(c.start_date || ""),
        endDate: String(c.end_date || ""),
        budgetKrw: intOf(c.budget_krw),
        createdAt: c.created_at || null,
        /** 회사 안의 담당자(관리자 또는 직원 이름). */
        ownerName: ownerLabel(c.owner_member, ownerNames),
        collabs,
        uploaded,
        matched,
        views,
        likes,
        comments,
        shares,
        sharesMatched,
        spend,
        measuredSpend,
        cpv,
        reach,
        saved,
        insightsMatched,
        posts,
      };
    });

    // 점수는 조건에 맞는 전체에서 매긴다 — 쪽마다 기준이 달라지면 안 된다.
    const creatorRanking = applyScores(campaigns, false);
    const sorted = sortHistory(campaigns, query.sort);
    const { items, pagination } = pageOf(sorted, query);
    // 팔로워 분포는 이 쪽에 보이는 게시물의 인플루언서 것만 보낸다.
    const pageCreators = new Set(items.flatMap((c) => c.posts.map((p) => p.creatorUsername)));
    const audiences = Object.fromEntries(
      Object.entries(insights.audiences).filter(([name]) => pageCreators.has(name)),
    );

    return Response.json({
      /** 조건에 맞는 캠페인 전체의 합계(이 쪽만이 아니다). */
      totals: sumHistory(campaigns, false),
      /** 조건과 무관한 계정 전체 기준. */
      accountTotals,
      /** 인플루언서 종합 순위(게시물 종합 점수 평균, 상위 10명). */
      creatorRanking,
      campaigns: items,
      categories: Array.from(categories).sort(),
      /** 캠페인별로 볼 때 고르는 목록(최신순, 조건과 무관). */
      campaignOptions: (campaignRows || []).map((c) => ({
        id: String(c.id),
        title: String(c.title || ""),
        startDate: c.start_date || null,
      })),
      pagination,
      /** 협업한 인플루언서별 팔로워 분포(성별 · 연령 · 국가 인원 수). */
      audiences,
    });
  } catch (err: any) {
    console.error("[business-campaign-history] 조회 실패:", err);
    return Response.json({ error: "캠페인 이력을 불러오지 못했습니다." }, { status: 500 });
  }
};

/**
 * 어필리에이트 이력. 선정된 인플루언서가 한 명 이상인 상품(삭제한 상품 포함 · 기록이므로)과
 * 그 인플루언서의 콘텐츠 링크 · 파트너십 코드 · 게시물 지표 · 판매액.
 */
async function affiliateHistory(db: any, username: string) {
  const productRows = (await db.sql`
    SELECT p.id, p.name, p.category, p.status, p.deleted_at, p.stock, p.image_urls,
           p.sale_start_date, p.sale_end_date, p.created_at
    FROM affiliate_store_products p
    WHERE p.business_username = ${username}
      AND p.brand_history_hidden_at IS NULL
      AND EXISTS (SELECT 1 FROM affiliate_store_requests r WHERE r.product_id = p.id AND r.status = 'approved')
    ORDER BY p.created_at DESC, p.id DESC
  `) as any[];
  if (!productRows.length) return { totals: emptyTotals(), campaigns: [], categories: [] };
  const productIds = productRows.map((p) => String(p.id));

  const [requestRows, salesRows] = await Promise.all([
    db.sql`
      SELECT id, product_id, influencer_username, channel_url, shipping_status, manager_status,
             content_url, partnership_code, content_submitted_at, shipped_at, ship_delivered_at, created_at
      FROM affiliate_store_requests
      WHERE product_id = ANY(${productIds}) AND status = 'approved'
      ORDER BY created_at ASC
    ` as Promise<any[]>,
    db.sql`
      SELECT request_id, COUNT(*)::int AS orders,
             COALESCE(SUM(GREATEST(0, total_amount - shipping_fee - refund_amount)), 0)::bigint AS sales
      FROM affiliate_store_orders
      WHERE business_username = ${username} AND product_id = ANY(${productIds})
        AND status = ANY(${SALE_STATUSES}::text[]) AND commission_status IN ('pending', 'confirmed')
      GROUP BY request_id
    ` as Promise<any[]>,
  ]);
  const salesByRequest = new Map(salesRows.map((r) => [String(r.request_id), r]));

  const creatorNames = Array.from(new Set(requestRows.map((r) => norm(r.influencer_username)).filter(Boolean)));
  const channelRows = creatorNames.length
    ? ((await db.sql`
        SELECT username, instagram_handle, followers, avg_views, metrics_source,
               connected, recent_reels, recent_feed, synced_at
        FROM creator_channels
        WHERE username = ANY(${creatorNames})
      `) as any[])
    : [];
  const channelByUser = new Map<string, any>();
  const mediaByUser = new Map<string, Record<string, PostMetric>>();
  for (const row of channelRows) {
    const key = norm(row.username);
    channelByUser.set(key, row);
    mediaByUser.set(key, mediaIndexOf(row));
  }

  const byProduct = new Map<string, any[]>();
  for (const r of requestRows) {
    const key = String(r.product_id);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(r);
  }

  const totals: any = { ...emptyTotals(), sales: 0, orders: 0 };
  const categories = new Set<string>();
  const dateOf = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  const campaigns = productRows.map((p) => {
    if (p.category) categories.add(String(p.category));
    const list = byProduct.get(String(p.id)) || [];
    let views = 0, likes = 0, comments = 0, shares = 0, sharesMatched = 0, matched = 0, uploaded = 0, sales = 0, orders = 0;
    const posts = list.map((r) => {
      const creator = norm(r.influencer_username);
      const channel = channelByUser.get(creator);
      const uploadUrl = String(r.content_url || "");
      const code = shortcodeOf(uploadUrl);
      const metric = code ? mediaByUser.get(creator)?.[code] : undefined;
      const cancelled = r.shipping_status === "declined";
      const st = salesByRequest.get(String(r.id));
      const postSales = Number(st?.sales || 0);
      const postOrders = Number(st?.orders || 0);
      if (!cancelled) {
        if (uploadUrl) uploaded++;
        sales += postSales;
        orders += postOrders;
        if (metric) {
          if (metric.from === "reels") { matched++; views += metric.views; }
          likes += metric.likes;
          comments += metric.comments;
          if (metric.shares !== null) { shares += metric.shares; sharesMatched++; }
        }
      }
      return {
        collabId: String(r.id),
        creatorUsername: creator,
        instagramHandle: String(channel?.instagram_handle || ""),
        status: String(r.shipping_status || r.manager_status || ""),
        cancelled,
        uploadUrl,
        partnershipCode: String(r.partnership_code || "").trim(),
        cleanFileUrl: "",
        cleanFileName: "",
        fee: 0,
        sales: postSales,
        orders: postOrders,
        contentSubmittedAt: r.content_submitted_at || null,
        followers: intOf(channel?.followers),
        metricsSource: String(channel?.metrics_source || ""),
        metrics: metric || null,
        reason: metric ? "" : cancelled ? "cancelled" : !uploadUrl ? "not_uploaded" : !channel?.connected ? "not_linked" : "out_of_window",
      };
    });
    const state = saleStateOf({
      status: p.status, deleted_at: p.deleted_at, stock: p.stock,
      sale_start_date: p.sale_start_date, sale_end_date: p.sale_end_date,
    });
    const collabs = list.filter((r) => r.shipping_status !== "declined").length;
    totals.campaigns++;
    totals.collabs += collabs;
    totals.uploaded += uploaded;
    totals.matched += matched;
    totals.views += views;
    totals.reactions += likes + comments;
    totals.comments += comments;
    totals.shares += shares;
    totals.sharesMatched += sharesMatched;
    totals.sales += sales;
    totals.orders += orders;
    return {
      id: String(p.id),
      title: String(p.name || ""),
      category: String(p.category || ""),
      type: "affiliate",
      status: state === "on_sale" || state === "sold_out" || state === "scheduled" ? "active" : "closed",
      removed: Boolean(p.deleted_at),
      saleState: state,
      rewardMode: "affiliate",
      thumbnailUrl: Array.isArray(p.image_urls) ? String(p.image_urls[0] || "") : "",
      startDate: dateOnly(p.sale_start_date) || dateOf(p.created_at),
      endDate: dateOnly(p.sale_end_date),
      budgetKrw: 0,
      createdAt: p.created_at || null,
      collabs,
      uploaded,
      matched,
      views,
      likes,
      comments,
      shares,
      sharesMatched,
      spend: 0,
      measuredSpend: 0,
      cpv: 0,
      sales,
      orders,
      posts,
    };
  });

  return { totals, campaigns, categories: Array.from(categories).sort() };
}

function emptyTotals() {
  return {
    campaigns: 0,
    collabs: 0,
    uploaded: 0,
    matched: 0,
    views: 0,
    reactions: 0,
    comments: 0,
    shares: 0,
    sharesMatched: 0,
    spend: 0,
    measuredSpend: 0,
    cpv: 0,
    reach: 0,
    saved: 0,
    insightsMatched: 0,
  };
}

export const config: Config = {
  path: "/api/business/campaign-history/:username",
};
