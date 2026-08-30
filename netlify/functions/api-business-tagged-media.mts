import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { REAUTH_MESSAGE, linkNeedsReauth } from "./_shared/instagram-metrics.mts";
import {
  CACHE_TTL_HOURS,
  brandLinkUsable,
  getTaggedMedia,
  loadBrandLink,
} from "./_shared/tagged-media.mts";

/**
 * 브랜드 계정용 "태그된 콘텐츠" 조회.
 *
 *   GET /api/business-tagged-media?username=biz%2F<이름>&refresh=1
 *
 * 브랜드 본인(과 관리자)만 본다. 목록에는 어느 인플루언서가 우리를 걸었는지가
 * 들어가므로 남의 브랜드가 열어 볼 값이 아니다.
 *
 * 이 경로는 읽기 전용이다 — 디엠 자동화 설정, 연동 토큰, creator_channels 를
 * 하나도 고치지 않는다. 유일한 쓰기는 목록 캐시(별도 블롭 저장소) 한 줄이다.
 */

const norm = (raw: string) => String(raw || "").trim().toLowerCase();

/** 이번 달(서울 기준) 시작 시각. 브랜드가 보는 "이번 달"은 한국 달력이다. */
function seoulMonthStart(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).format(now);
  const [year, month] = parts.split("-").map(Number);
  // 서울은 UTC+9 고정(서머타임 없음)이므로 1일 00:00 KST = 전달 말일 15:00 UTC.
  return Date.UTC(year, month - 1, 1, 0, 0, 0) - 9 * 3600_000;
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(req.url);
  // 브랜드 사용자명은 `biz/<이름>` 형태다. 블롭 키가 그 접두사까지 포함하므로
  // 여기서 떼지 않고 그대로 들고 간다(권한 검사 쪽에서만 정규화된다).
  const rawUsername = norm(url.searchParams.get("username") || "");
  if (!rawUsername) {
    return Response.json({ error: "사용자명이 필요합니다.", items: [] }, { status: 400 });
  }

  const auth = await requireAccountOwner(req, rawUsername);
  if (!auth.ok) return auth.response;

  try {
    const link = await loadBrandLink(rawUsername);
    if (!brandLinkUsable(link)) {
      // 한 번도 연동하지 않은 경우와 토큰이 죽은 경우는 할 말이 다르다.
      const dead = linkNeedsReauth(link);
      return Response.json({
        connected: false,
        needsReauth: dead,
        error: dead
          ? REAUTH_MESSAGE
          : "인스타그램 계정이 연동되어 있지 않습니다. DM 자동화 화면에서 계정을 연동하면 태그된 콘텐츠를 불러옵니다.",
        code: dead ? "META_TOKEN_INVALID" : "META_NOT_LINKED",
        items: [],
      });
    }

    const force = url.searchParams.get("refresh") === "1";
    const result = await getTaggedMedia(rawUsername, link!, getDatabase(), { force });
    if (!result.ok) {
      return Response.json(
        { connected: true, needsReauth: false, error: result.error, code: result.code, items: [] },
        { status: 200 },
      );
    }

    const { payload } = result;
    const monthStart = seoulMonthStart();
    const thisMonth = payload.items.filter((m) => {
      const at = Date.parse(m.timestamp || "");
      return Number.isFinite(at) && at >= monthStart;
    });

    /**
     * 합계는 값이 있는 항목만 더한다. 못 받은 조회수를 0 으로 세면 합계는 진짜보다
     * 작게 나오는데 화면에는 "총 조회수"라고 적히므로, 몇 개를 근거로 낸 합계인지
     * 함께 내려보내 화면이 그대로 밝힐 수 있게 한다.
     */
    const sum = (rows: typeof payload.items, key: "views" | "likes" | "comments") => {
      const valued = rows.filter((r) => typeof r[key] === "number");
      return {
        total: valued.reduce((acc, r) => acc + (r[key] as number), 0),
        counted: valued.length,
        of: rows.length,
      };
    };

    return Response.json({
      connected: true,
      needsReauth: false,
      igUsername: payload.igUsername,
      items: payload.items,
      summary: {
        monthCount: thisMonth.length,
        totalCount: payload.items.length,
        monthViews: sum(thisMonth, "views"),
        views: sum(payload.items, "views"),
        likes: sum(payload.items, "likes"),
        comments: sum(payload.items, "comments"),
        /** 우리를 태그한 서로 다른 계정 수. */
        authors: new Set(payload.items.map((m) => m.authorHandle).filter(Boolean)).size,
      },
      tagsApi: payload.tagsApi,
      scannedCreators: payload.scannedCreators,
      fetchedAt: payload.fetchedAt,
      cached: result.cached,
      cacheTtlHours: CACHE_TTL_HOURS,
    });
  } catch (err: any) {
    console.error("[business-tagged-media] 조회 실패:", err?.message || err);
    return Response.json(
      { error: "태그된 콘텐츠를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", items: [] },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/business-tagged-media",
};
