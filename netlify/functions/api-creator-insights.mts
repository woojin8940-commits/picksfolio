import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { REAUTH_MESSAGE } from "./_shared/instagram-metrics.mts";
import {
  backfillSnapshotFromChannel,
  CACHE_TTL_MINUTES,
  DEMOGRAPHICS_MIN_FOLLOWERS,
  firstSnapshotDate,
  getFollowerDemographics,
  getReelInsights,
  loadFollowerSeries,
  recordFollowerSnapshot,
  resolveInsightsLink,
  tokenPredatesInsightsApproval,
} from "./_shared/creator-insights.mts";

/**
 * 인플루언서 본인용 인사이트 조회.
 *
 *   GET /api/creator-insights?username=&refresh=1
 *       계정 요약(팔로워·팔로잉·7일 증감) + 최근 릴스 목록.
 *
 *   GET /api/creator-insights/followers?username=&days=7|30|90
 *       팔로워 증감 추이용 일별 스냅샷.
 *
 *   GET /api/creator-insights/demographics?username=&refresh=1
 *       팔로워의 성별·연령대·국가 분포(메타 follower_demographics).
 *
 *   GET /api/creator-insights/benchmark?username=
 *       같은 팔로워 규모(나노·마이크로·매크로) 인플루언서들의 평균과 내 값.
 *
 * 본인만 본다. 남의 계정 인사이트는 브랜드가 보는 명단(리스트업)에도 평균값으로만
 * 나가는 값이라, 여기서 계정 주인 외에 열어 줄 이유가 없다. 관리자는 고객 지원을
 * 위해 통과된다(requireAccountOwner 의 기존 규칙).
 *
 * 이 경로는 읽기 전용이다. creator_channels(브랜드가 보는 숫자)도, 연동 토큰도
 * 건드리지 않는다. 쓰는 것은 팔로워 스냅샷 표뿐이다 — 오늘자 한 줄과, 이미 확인해 둔
 * 과거 팔로워 수(creator_channels.synced_at 기준) 한 줄이다. 둘 다 그래프의 점을
 * 채우는 값이고 다른 화면에 영향이 없다.
 */

const norm = (raw: string) => String(raw || "").trim().toLowerCase();

/** 화면이 고를 수 있는 기간. 임의의 숫자를 그대로 SQL 에 넣지 않는다. */
const ALLOWED_DAYS = [7, 30, 90];

// ---------------------------------------------------------------------------
// 벤치마킹 — 같은 규모 인플루언서들의 평균
// ---------------------------------------------------------------------------

/**
 * 팔로워 규모 구간.
 *
 * 팔로워 800명 계정과 8만 계정을 같은 평균에 넣으면 그 평균은 누구의 것도 아니다.
 * 참여율은 규모가 작을수록 높게 나오는 지표라(친구·지인 비중이 크다), 규모를 나누지
 * 않은 비교는 항상 작은 계정이 이기는 게임이 된다.
 */
const TIERS = [
  { key: "nano", from: 0, to: 9_999 },
  { key: "micro", from: 10_000, to: 99_999 },
  { key: "macro", from: 100_000, to: Number.POSITIVE_INFINITY },
] as const;

type TierKey = (typeof TIERS)[number]["key"];

const tierOf = (followers: number): TierKey =>
  (TIERS.find((t) => followers >= t.from && followers <= t.to) || TIERS[0]).key;

/**
 * 평균을 말하기 위해 필요한 최소 계정 수(나 제외).
 *
 * 둘·셋의 평균은 평균이 아니라 그 사람들의 값이다. 그 값으로 "상위 30%입니다"를
 * 적으면 숫자는 그럴듯한데 뜻이 없고, 더 나쁜 것은 그 말을 믿고 다음 콘텐츠를
 * 바꾸는 사람이 생긴다는 것이다. 표본이 이 선을 넘기 전에는 비교를 아예 그리지
 * 않고 "데이터 쌓이는 중"이라고 적는다.
 */
const BENCHMARK_MIN_SAMPLE = 5;

/** 업로드 빈도를 셀 구간(일). 최근 4주를 보고 주당 편수로 환산한다. */
const UPLOAD_WINDOW_DAYS = 28;

interface BenchmarkMetrics {
  /** 참여율(%) — (평균 좋아요 + 평균 댓글) ÷ 팔로워. */
  engagement: number | null;
  /** 조회율(%) — 평균 조회수 ÷ 팔로워. 100%를 넘을 수 있다(팔로워 밖 도달). */
  viewRate: number | null;
  /** 댓글률(%) — 평균 댓글 ÷ 평균 조회수. */
  commentRate: number | null;
  /** 주당 업로드 편수. */
  uploads: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 채널 한 줄 → 비교 지표. 분모가 없는 값은 0 이 아니라 null 이다. */
function metricsOfChannel(row: any): BenchmarkMetrics {
  const followers = Number(row?.followers || 0);
  const views = Number(row?.avg_views || 0);
  const likes = Number(row?.avg_likes || 0);
  const comments = Number(row?.avg_comments || 0);

  // 최근 4주 업로드 수. recent_reels 는 목록이 비어 있을 수 있고(연동 전) 그때
  // "주 0편"이라고 단정하면 안 된다 — 안 올린 것과 목록을 모르는 것은 다르다.
  let uploads: number | null = null;
  const reels = Array.isArray(row?.recent_reels) ? row.recent_reels : [];
  if (reels.length > 0) {
    const since = Date.now() - UPLOAD_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const recent = reels.filter((r: any) => {
      const t = Date.parse(String(r?.timestamp || ""));
      return Number.isFinite(t) && t >= since;
    }).length;
    uploads = round2(recent / (UPLOAD_WINDOW_DAYS / 7));
  }

  return {
    engagement: followers > 0 && (likes > 0 || comments > 0)
      ? round2(((likes + comments) / followers) * 100)
      : null,
    viewRate: followers > 0 && views > 0 ? round2((views / followers) * 100) : null,
    commentRate: views > 0 && comments > 0 ? round2((comments / views) * 100) : null,
    uploads,
  };
}

const METRIC_KEYS: (keyof BenchmarkMetrics)[] = [
  "engagement",
  "viewRate",
  "commentRate",
  "uploads",
];

/** 값이 있는 것만 골라 평균. 한 개도 없으면 null — 0 은 "평균이 0" 이라는 거짓말이다. */
function averageOf(values: (number | null)[]): { value: number | null; counted: number } {
  const usable = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (usable.length === 0) return { value: null, counted: 0 };
  return {
    value: round2(usable.reduce((sum, v) => sum + v, 0) / usable.length),
    counted: usable.length,
  };
}

/**
 * "상위 O%". 나를 포함한 같은 규모 계정들 중 내 값 이상인 계정의 비율이다.
 *
 * 1위면 1/10 → 상위 10% 로 적힌다. 0% 는 만들지 않는다 — 어떤 순위든 자기 자신은
 * 세므로 최소값은 1÷n 이다.
 */
function topPercentOf(mine: number | null, others: (number | null)[]): number | null {
  if (typeof mine !== "number" || !Number.isFinite(mine)) return null;
  const pool = others.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (pool.length === 0) return null;
  const atOrAbove = pool.filter((v) => v >= mine).length + 1;
  return Math.max(1, Math.round((atOrAbove / (pool.length + 1)) * 100));
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(req.url);
  const username = norm(url.searchParams.get("username") || "");
  if (!username) {
    return Response.json({ error: "사용자명이 필요합니다." }, { status: 400 });
  }

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const db = getDatabase();
  const isSeries = url.pathname.endsWith("/followers");
  const isDemographics = url.pathname.endsWith("/demographics");
  const isBenchmark = url.pathname.endsWith("/benchmark");

  // -------------------------------------------------------------------------
  // 벤치마킹 — 같은 팔로워 규모의 평균과 견주기
  // -------------------------------------------------------------------------
  //
  // 메타를 부르지 않는다. 남의 계정 지표를 실시간으로 물어볼 방법이 없고(그 권한은
  // 각자의 토큰에 있다), 물어볼 수 있어도 화면 한 번 열 때 수백 계정을 부를 수는
  // 없다. 대신 우리가 이미 들고 있는 채널 표(creator_channels — 브랜드에게 보여 주는
  // 그 숫자)를 쓴다. 내 값도 같은 표에서 읽는다. 내 값만 방금 받은 실측치로 바꾸면
  // 나는 최신, 남은 며칠 전 값이 되어 비교 자체가 기울어진다.
  if (isBenchmark) {
    try {
      const [mineRows, allRows] = (await Promise.all([
        db.sql`
          SELECT username, followers, avg_views, avg_likes, avg_comments, reels_count, recent_reels
            FROM creator_channels
           WHERE username = ${username}
        `,
        db.sql`
          SELECT username, followers, avg_views, avg_likes, avg_comments, reels_count, recent_reels
            FROM creator_channels
           WHERE followers > 0
           ORDER BY followers DESC
           LIMIT 2000
        `,
      ])) as [any[], any[]];

      const mineRow = mineRows?.[0] || null;
      const totalCreators = (allRows || []).length;

      if (!mineRow || Number(mineRow.followers || 0) <= 0) {
        // 내 채널 숫자가 아직 없으면 견줄 대상이 없다. 브랜드 매칭에 등록하면
        // 그때 채널 지표가 만들어지므로, 그 사실만 알려 준다.
        return Response.json({
          ok: false,
          reason: "no_channel",
          totalCreators,
          minSample: BENCHMARK_MIN_SAMPLE,
        });
      }

      const followers = Number(mineRow.followers || 0);
      const tier = tierOf(followers);
      const me = metricsOfChannel(mineRow);

      // 같은 구간의 다른 계정들. 나는 뺀다 — 내 값이 평균에 섞이면 비교 대상이 나를
      // 조금씩 닮게 되고, 표본이 작을수록 그 왜곡이 커진다.
      const peers = (allRows || [])
        .filter((r) => String(r.username || "").toLowerCase() !== username)
        .filter((r) => tierOf(Number(r.followers || 0)) === tier);

      const sample = peers.length;
      if (sample < BENCHMARK_MIN_SAMPLE) {
        return Response.json({
          ok: true,
          collecting: true,
          tier,
          followers,
          me,
          peer: null,
          topPercent: null,
          sample,
          minSample: BENCHMARK_MIN_SAMPLE,
          totalCreators,
        });
      }

      const peerMetrics = peers.map(metricsOfChannel);
      const peer: BenchmarkMetrics = {
        engagement: null,
        viewRate: null,
        commentRate: null,
        uploads: null,
      };
      const counted: Record<string, number> = {};
      const topPercent: Record<string, number | null> = {};
      for (const key of METRIC_KEYS) {
        const values = peerMetrics.map((m) => m[key]);
        const avg = averageOf(values);
        peer[key] = avg.value;
        counted[key] = avg.counted;
        topPercent[key] = topPercentOf(me[key], values);
      }

      return Response.json({
        ok: true,
        collecting: false,
        tier,
        followers,
        me,
        peer,
        /** 지표별로 몇 계정이 그 평균에 들어갔는지. 화면이 표본을 숨기지 않도록. */
        counted,
        topPercent,
        sample,
        minSample: BENCHMARK_MIN_SAMPLE,
        totalCreators,
      });
    } catch (err: any) {
      console.error("[creator-insights] 벤치마킹 조회 실패:", err?.message || err);
      return Response.json(
        { ok: false, reason: "error", minSample: BENCHMARK_MIN_SAMPLE },
        { status: 200 },
      );
    }
  }

  // -------------------------------------------------------------------------
  // 팔로워 인구통계 — 성별·연령대·국가
  // -------------------------------------------------------------------------
  //
  // 추이(/followers)와 한 응답으로 묶지 않는다. 그쪽은 기간 버튼(7·30·90일)을
  // 누를 때마다 다시 부르는 경로인데, 인구통계는 기간과 무관한 값이라 같이 실으면
  // 버튼 세 번에 같은 값을 세 번 받아 오게 된다. 탭을 열 때 한 번만 부른다.
  if (isDemographics) {
    try {
      const resolved = await resolveInsightsLink(username);
      if (!resolved.link || !resolved.scope) {
        return Response.json({
          connected: false,
          needsReauth: resolved.needsReauth,
          reason: "denied",
          age: [],
          gender: [],
          country: [],
        });
      }

      // 팔로워 100명 미만이면 메타가 인구통계를 아예 주지 않는다. 그 판정을 위해
      // 프로필을 또 부르지는 않는다 — 스냅샷 표에 이미 최근 팔로워 수가 있고, 그
      // 값은 이 화면이 방금 그린 그래프의 마지막 점과 같은 값이다.
      const recent = await loadFollowerSeries(db, username, 7);
      const followers = recent.length ? recent[recent.length - 1].followers : null;

      const demographics = await getFollowerDemographics(username, resolved.link, followers, {
        force: url.searchParams.get("refresh") === "1",
      });
      return Response.json({
        connected: true,
        needsReauth: false,
        ...demographics,
        /** 화면이 "100명부터"라는 문구를 직접 적지 않도록 기준선을 함께 보낸다. */
        minFollowers: DEMOGRAPHICS_MIN_FOLLOWERS,
        followers,
      });
    } catch (err: any) {
      console.error("[creator-insights] 인구통계 조회 실패:", err?.message || err);
      return Response.json(
        { connected: true, reason: "error", age: [], gender: [], country: [] },
        { status: 200 },
      );
    }
  }

  // -------------------------------------------------------------------------
  // 팔로워 증감 추이 — 저장된 스냅샷만 읽는다(메타 호출 없음)
  // -------------------------------------------------------------------------
  if (isSeries) {
    try {
      const asked = Number(url.searchParams.get("days") || 7);
      const days = ALLOWED_DAYS.includes(asked) ? asked : 7;
      // 이미 확인해 둔 과거 팔로워 수를 먼저 스냅샷으로 옮긴다. 표를 만든 날에도
      // 그래프가 그려질 수 있는 유일한 근거이고, 없는 값을 만들어 내지는 않는다.
      await backfillSnapshotFromChannel(db, username);
      const [points, firstOn] = await Promise.all([
        loadFollowerSeries(db, username, days),
        firstSnapshotDate(db, username),
      ]);
      return Response.json({
        days,
        points,
        // 배치를 켠 날 이전은 물어볼 곳이 없는 구간이다. 화면이 "데이터 수집 중"을
        // 말할 수 있게, 언제부터 쌓였는지를 그대로 알려 준다.
        firstSnapshotDate: firstOn,
        collecting: points.length < 2,
      });
    } catch (err: any) {
      console.error("[creator-insights] 스냅샷 조회 실패:", err?.message || err);
      return Response.json(
        { error: "팔로워 추이를 불러오지 못했습니다.", days: 7, points: [] },
        { status: 500 },
      );
    }
  }

  // -------------------------------------------------------------------------
  // 계정 요약 + 릴스 목록
  // -------------------------------------------------------------------------
  try {
    const resolved = await resolveInsightsLink(username);
    if (!resolved.link || !resolved.scope) {
      // 한 번도 연동한 적 없는 경우와 토큰이 죽은 경우는 할 말이 다르다.
      return Response.json({
        connected: false,
        needsReauth: resolved.needsReauth,
        igUsername: String(resolved.link?.igUsername || ""),
        error: resolved.needsReauth
          ? REAUTH_MESSAGE
          : "인스타그램 계정이 연동되어 있지 않습니다. 캠페인 등록 화면에서 계정을 연동하면 릴스 성과를 불러옵니다.",
        code: resolved.needsReauth ? "META_TOKEN_INVALID" : "META_NOT_LINKED",
        reels: [],
      });
    }

    const force = url.searchParams.get("refresh") === "1";
    const result = await getReelInsights(username, resolved.link, resolved.scope, { force });
    if (!result.ok) {
      return Response.json(
        { connected: true, needsReauth: result.code === "META_TOKEN_INVALID", error: result.error, code: result.code, reels: [] },
        { status: 200 },
      );
    }

    const { payload } = result;

    // 오늘자 팔로워 수를 남긴다. 방금 메타에서 받은 값일 때만 — 캐시에서 나온 값은
    // 이미 그때 남겼거나, 남길 필요가 없는 어제 값일 수 있다.
    if (!result.cached) {
      await recordFollowerSnapshot(db, username, payload.followers, payload.following, "live");
    }

    // 최근 7일 증감. 스냅샷이 두 개 이상 있어야 말할 수 있는 값이라, 없으면 null 로
    // 두고 화면이 이 항목 자체를 생략한다 — 0 으로 적으면 "일주일째 그대로"가 된다.
    await backfillSnapshotFromChannel(db, username);
    const week = await loadFollowerSeries(db, username, 7);
    const followerDelta7d =
      week.length >= 2 ? week[week.length - 1].followers - week[0].followers : null;

    return Response.json({
      connected: true,
      needsReauth: false,
      igUsername: payload.igUsername,
      followers: payload.followers,
      following: payload.following,
      followerDelta7d,
      /** 증감을 계산한 실제 구간(며칠치인지). 화면 문구가 "7일"이라고 단정하지 않도록. */
      followerDeltaDays: week.length >= 2 ? week.length : 0,
      reels: payload.reels,
      viewsAvailable: payload.viewsAvailable,
      insightsAvailable: payload.insightsAvailable,
      /**
       * 재연동을 권해야 하는가.
       *
       * 도달·저장수가 비어 있고, 그 토큰이 권한 승인 전에 발급된 경우에만 참이다.
       * 릴스가 아예 없는 계정에는 권하지 않는다 — 그 경우 값이 비는 이유는 권한이
       * 아니라 잴 게시물이 없어서다.
       */
      reconnectForInsights:
        !payload.insightsAvailable &&
        payload.reels.length > 0 &&
        tokenPredatesInsightsApproval(resolved.link),
      fetchedAt: payload.fetchedAt,
      cached: result.cached,
      cacheTtlMinutes: CACHE_TTL_MINUTES,
    });
  } catch (err: any) {
    console.error("[creator-insights] 조회 실패:", err?.message || err);
    return Response.json(
      { error: "인사이트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", reels: [] },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: [
    "/api/creator-insights",
    "/api/creator-insights/followers",
    "/api/creator-insights/demographics",
    "/api/creator-insights/benchmark",
  ],
};
