import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { REAUTH_MESSAGE } from "./_shared/instagram-metrics.mts";
import {
  CACHE_TTL_MINUTES,
  firstSnapshotDate,
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
 * 본인만 본다. 남의 계정 인사이트는 브랜드가 보는 명단(리스트업)에도 평균값으로만
 * 나가는 값이라, 여기서 계정 주인 외에 열어 줄 이유가 없다. 관리자는 고객 지원을
 * 위해 통과된다(requireAccountOwner 의 기존 규칙).
 *
 * 이 경로는 읽기 전용이다. creator_channels(브랜드가 보는 숫자)도, 연동 토큰도
 * 건드리지 않는다. 유일한 쓰기는 오늘자 팔로워 스냅샷 한 줄인데, 이건 본인 화면을
 * 열었다는 사실로 그래프의 오늘 점을 채우는 것이라 다른 화면에 영향이 없다.
 */

const norm = (raw: string) => String(raw || "").trim().toLowerCase();

/** 화면이 고를 수 있는 기간. 임의의 숫자를 그대로 SQL 에 넣지 않는다. */
const ALLOWED_DAYS = [7, 30, 90];

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

  // -------------------------------------------------------------------------
  // 팔로워 증감 추이 — 저장된 스냅샷만 읽는다(메타 호출 없음)
  // -------------------------------------------------------------------------
  if (isSeries) {
    try {
      const asked = Number(url.searchParams.get("days") || 7);
      const days = ALLOWED_DAYS.includes(asked) ? asked : 7;
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
  path: ["/api/creator-insights", "/api/creator-insights/followers"],
};
