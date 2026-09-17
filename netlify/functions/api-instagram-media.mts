import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { markSharedLinkNeedsReauth, resolveSharedLink } from "./_shared/instagram-metrics.mts";
import {
  collectFeed,
  feedCacheFresh,
  readFeedCache,
  writeFeedCache,
  FEED_MAX_ITEMS,
} from "./_shared/instagram-feed.mts";

/**
 * 연동된 인스타그램 계정의 피드 게시물 목록 조회.
 *
 * 자동 DM 을 걸 게시물을 고르기 위한 용도이므로 이미지·캡션·링크만 내려준다.
 *
 * 이 응답이 늦거나 비어 있으면 자동 디엠 화면은 아무것도 할 수 없는 화면이 된다.
 * 그래서 세 가지를 지킨다.
 *
 *   1. 연동은 세 화면(자동 디엠·인사이트·브랜드 매칭받기)이 함께 쓰는 하나다.
 *      여기서도 `resolveSharedLink` 로 찾는다 — 예전처럼 자동 디엠 보관함만 직접
 *      읽으면, 다른 화면에서 연동한 사람은 연동을 마쳤는데도 "게시물 없음"을 본다.
 *   2. 응답은 시간 예산 안에서 반드시 돌아온다. 모으다 예산을 다 쓰면 모은 만큼과
 *      이어보기 커서(`nextCursor`)를 주고, 나머지는 화면이 이어서 받는다. 예전에는
 *      최대 8페이지를 끝까지 모은 뒤에야 응답했고, 모바일 회선에서 그 왕복이 함수
 *      실행 시간을 넘기면 화면은 빈 응답을 "게시물 없음"으로 그렸다.
 *   3. 실패는 실패로 내려보낸다(`error` · `needsReauth`). 빈 목록으로 뭉개면 화면이
 *      게시물이 있는 사람에게 "인스타그램에 게시물을 올린 뒤 다시 확인해주세요"
 *      라고 말한다. 보관해 둔 목록이 있으면 그것이라도 함께 보낸다(`stale`).
 *
 * 커서는 토큰이 들어 있지 않은 값만 주고받는다(_shared/instagram-feed.mts 참고).
 */

/** 첫 응답을 만드는 데 쓸 시간. 함수 실행 시간(10초) 안에서 넉넉히 끝나도록 잡는다. */
const FIRST_PAGE_BUDGET_MS = 3_500;
/** 이어보기 요청의 예산. 화면이 배경에서 받는 중이라 조금 더 모아도 된다. */
const MORE_BUDGET_MS = 4_000;

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 남의 계정 피드를 들여다볼 수 없게 본인 확인을 먼저 한다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const after = url.searchParams.get("after") || "";
  // 화면의 "다시 시도"는 보관된 목록을 건너뛰고 새로 받아야 한다.
  const refresh = url.searchParams.get("refresh") === "1";

  const resolved = await resolveSharedLink(username, "dm");
  const link = resolved.link;
  const igId = String(link?.igUserId || link?.igAccountId || "");

  if (!link?.accessToken || !igId) {
    return Response.json(
      {
        connected: false,
        media: [],
        nextCursor: "",
        // 토큰이 죽어 다시 동의가 필요한 경우와 한 번도 연동하지 않은 경우는
        // 화면이 할 말이 다르다.
        needsReauth: resolved.needsReauth,
      },
      { status: 200 },
    );
  }

  /** 이어보기 — 보관함을 거치지 않고 그 페이지부터 모은다. */
  if (after) {
    const more = await collectFeed(link, { after, budgetMs: MORE_BUDGET_MS });
    if (more.tokenInvalid) await markSharedLinkNeedsReauth(username, link);
    return Response.json(
      {
        connected: true,
        media: more.items,
        nextCursor: more.after,
        error: more.items.length === 0 ? more.error : "",
        needsReauth: more.tokenInvalid,
      },
      { status: 200 },
    );
  }

  const cached = await readFeedCache(username);

  // 방금 연동하고 돌아온 사람은 여기서 끝난다 — 콜백이 미리 채워 둔 목록이 있으면
  // 그래프 API 왕복 없이 곧바로 게시물이 뜬다.
  if (!refresh && feedCacheFresh(cached, igId)) {
    return Response.json(
      {
        connected: true,
        media: cached!.items,
        nextCursor: cached!.after,
        cachedAt: cached!.updatedAt,
      },
      { status: 200 },
    );
  }

  const collected = await collectFeed(link, {
    budgetMs: FIRST_PAGE_BUDGET_MS,
    maxItems: FEED_MAX_ITEMS,
  });

  if (collected.tokenInvalid) await markSharedLinkNeedsReauth(username, link);

  if (collected.items.length === 0 && collected.error) {
    // 받아오지 못했다. 예전에 보관해 둔 목록이라도 있으면 그것을 보여준다 —
    // 잠깐의 그래프 API 장애 때문에 사람이 자기 게시물을 못 고를 이유는 없다.
    const fallback = cached && (!cached.igUserId || cached.igUserId === igId) ? cached : null;
    return Response.json(
      {
        connected: true,
        media: fallback?.items || [],
        nextCursor: fallback?.after || "",
        error: collected.error,
        needsReauth: collected.tokenInvalid,
        stale: Boolean(fallback?.items?.length),
      },
      { status: 200 },
    );
  }

  // 첫 페이지는 다음 방문(과 방금 연동한 사람)을 위해 보관해 둔다.
  await writeFeedCache(username, {
    items: collected.items,
    after: collected.after,
    igUserId: igId,
  });

  return Response.json(
    {
      connected: true,
      media: collected.items,
      nextCursor: collected.after,
      // 도중에 실패했지만 모은 게 있는 경우. 화면은 목록을 그리면서 안내만 덧붙인다.
      error: collected.error,
    },
    { status: 200 },
  );
};

export const config: Config = {
  path: "/api/instagram/media/:username",
};
