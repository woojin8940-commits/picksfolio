import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { readMetaAdsToken, tokenErrorResponse } from "./_shared/meta-ads.mts";
import { graphErrorResponse, graphGet } from "./_shared/meta-ads-graph.mts";

/**
 * 서버에서 부르는 그래프 API 는 기본 로케일이 영어라, 한글 이름 페이지(예: 픽스폴리오)를
 * 메타가 영문 표기로 바꿔 돌려준다. 비즈니스 스위트에 보이는 이름 그대로 받도록 고정한다.
 */
const PAGE_LOCALE = "ko_KR";

/**
 * 연동한 Meta 계정이 관리하는 페이스북 페이지와, 그 페이지 게시물의 반응.
 *
 *   GET /api/meta-ads/pages/:username
 *       → GET /me/accounts (pages_show_list). 광고 페이지 선택 목록이다.
 *   GET /api/meta-ads/pages/:username/:pageId/engagement
 *       → GET /{page-id}, /{page-id}/posts (pages_read_engagement). 최근 게시물의
 *         반응(좋아요 등)·댓글·공유 수와 페이지 팔로워 수.
 *
 * 페이지 목록은 캐시하지 않고 매번 메타에서 읽는다 — 페이지 권한은 비즈니스 관리자에서
 * 언제든 바뀌고, 예전 목록으로 광고를 만들면 메타가 "이 페이지로 광고할 권한이 없다" 로
 * 거절한다. 페이지 액세스 토큰은 응답에 싣지 않는다(서버가 게시물을 읽을 때만 쓴다).
 */
export default async (req: Request, context: Context) => {
  const username = String(context.params?.username || "")
    .replace(/^biz\//, "")
    .toLowerCase()
    .trim();
  if (!username) return Response.json({ error: "username은 필수입니다." }, { status: 400 });

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const stored = await readMetaAdsToken(username);
  if (!stored.ok) return tokenErrorResponse(stored.reason);
  const { token, proof } = stored;

  const pageId = String(context.params?.pageId || "").trim();

  if (!pageId) {
    const res = await graphGet(
      "me/accounts",
      token,
      {
        fields: "id,name,category,link,fan_count,followers_count,picture{url},instagram_business_account{id,username},tasks",
        limit: 100,
        locale: PAGE_LOCALE,
      },
      proof,
    );
    if (!res.ok) return graphErrorResponse(res, "페이지 목록을 불러오지 못했습니다.");
    const pages = (Array.isArray(res.data?.data) ? res.data.data : []).map((row: any) => ({
      id: String(row?.id || ""),
      name: String(row?.name || "이름 없는 페이지"),
      category: String(row?.category || ""),
      link: String(row?.link || ""),
      pictureUrl: String(row?.picture?.data?.url || ""),
      followers: Number(row?.followers_count ?? row?.fan_count) || 0,
      instagramUserId: row?.instagram_business_account?.id ? String(row.instagram_business_account.id) : "",
      instagramUsername: String(row?.instagram_business_account?.username || ""),
      // 광고를 만들려면 페이지에서 ADVERTISE 작업 권한이 있어야 한다. 없는 페이지는 화면이
      // 고를 수는 있게 두되 이유를 적는다.
      canAdvertise: Array.isArray(row?.tasks) ? row.tasks.includes("ADVERTISE") : true,
    }));
    return Response.json({ pages, fetchedAt: new Date().toISOString(), source: "meta_graph_api" });
  }

  if (!/^\d+$/.test(pageId)) return Response.json({ error: "페이지 ID가 올바르지 않습니다." }, { status: 400 });

  // 게시물 반응은 페이지 토큰으로 읽는다. 사용자 토큰으로 페이지 토큰을 받아 이 요청
  // 안에서만 쓴다(appsecret_proof 도 페이지 토큰으로 새로 만든다).
  const pageTokenRes = await graphGet(pageId, token, { fields: "access_token,name" }, proof);
  const pageToken = String(pageTokenRes.data?.access_token || "");
  if (!pageTokenRes.ok || !pageToken) {
    return graphErrorResponse(
      pageTokenRes,
      "이 페이지에 접근할 수 없습니다. 페이지 관리 권한을 확인해 주세요.",
      pageTokenRes.ok ? 403 : 502,
    );
  }

  const [pageRes, postsRes] = await Promise.all([
    graphGet(pageId, pageToken, {
      fields: "id,name,link,fan_count,followers_count,picture{url}",
      locale: PAGE_LOCALE,
    }),
    graphGet(`${pageId}/posts`, pageToken, {
      fields:
        "id,message,created_time,permalink_url,full_picture," +
        "reactions.summary(total_count).limit(0)," +
        "comments.summary(total_count).limit(0),shares",
      limit: 12,
    }),
  ]);
  if (!pageRes.ok) return graphErrorResponse(pageRes, "페이지 정보를 불러오지 못했습니다.");
  if (!postsRes.ok) return graphErrorResponse(postsRes, "페이지 게시물을 불러오지 못했습니다.");

  const posts = (Array.isArray(postsRes.data?.data) ? postsRes.data.data : []).map((row: any) => {
    const reactions = Number(row?.reactions?.summary?.total_count) || 0;
    const comments = Number(row?.comments?.summary?.total_count) || 0;
    const shares = Number(row?.shares?.count) || 0;
    return {
      id: String(row?.id || ""),
      message: String(row?.message || ""),
      createdTime: String(row?.created_time || ""),
      permalinkUrl: String(row?.permalink_url || ""),
      pictureUrl: String(row?.full_picture || ""),
      // 좋아요는 반응(좋아요·최고예요·웃겨요 …)의 하나다. Post 의 likes 엣지는 폐기
      // 예정이라 반응 합계를 쓴다 — 메타 비즈니스 스위트의 '반응' 과 같은 숫자다.
      reactions,
      comments,
      shares,
      engagement: reactions + comments + shares,
    };
  });

  const totals = posts.reduce(
    (acc: any, p: any) => ({
      posts: acc.posts + 1,
      reactions: acc.reactions + p.reactions,
      comments: acc.comments + p.comments,
      shares: acc.shares + p.shares,
      engagement: acc.engagement + p.engagement,
    }),
    { posts: 0, reactions: 0, comments: 0, shares: 0, engagement: 0 },
  );

  return Response.json({
    page: {
      id: String(pageRes.data?.id || pageId),
      name: String(pageRes.data?.name || ""),
      link: String(pageRes.data?.link || ""),
      pictureUrl: String(pageRes.data?.picture?.data?.url || ""),
      followers: Number(pageRes.data?.followers_count ?? pageRes.data?.fan_count) || 0,
    },
    posts,
    totals,
    fetchedAt: new Date().toISOString(),
    source: "meta_graph_api",
  });
};

export const config: Config = {
  path: ["/api/meta-ads/pages/:username", "/api/meta-ads/pages/:username/:pageId/engagement"],
  method: ["GET"],
};
