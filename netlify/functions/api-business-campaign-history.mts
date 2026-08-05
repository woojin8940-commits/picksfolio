import { getDatabase } from "@picks/netlify-database";
import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";

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
 *   GET /api/business/campaign-history/:username
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
  thumbnailUrl: string;
  permalink: string;
  timestamp: string;
  /** 릴스에서 맞췄는지 피드에서 맞췄는지. 피드 항목에는 조회수가 없다. */
  from: "reels" | "feed";
};

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

export default async (req: Request, context: Context) => {
  const raw = context.params.username || "";
  const username = norm(raw).replace(/^biz\//, "");
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const db = getDatabase();

  try {
    const campaignRows = (await db.sql`
      SELECT id, title, category, type, status, reward_mode, thumbnail_url,
             start_date, end_date, budget_krw, created_at
      FROM campaigns
      WHERE LOWER(REPLACE(business_username, 'biz/', '')) = ${username}
      ORDER BY created_at DESC
      LIMIT 200
    `) as any[];

    const campaignIds = (campaignRows || []).map((c) => String(c.id));
    if (campaignIds.length === 0) {
      return Response.json({
        totals: emptyTotals(),
        campaigns: [],
        categories: [],
      });
    }

    // 확정된 협업과 확정 조건(지급액)을 함께 읽는다. 취소된 건은 성과 집계에서
    // 빼되 목록에는 남긴다 — "몇 명이 중간에 빠졌는지"도 이력이다.
    const collabRows = (await db.sql`
      SELECT cc.id, cc.campaign_id, cc.creator_username, cc.status, cc.upload_url,
             cc.confirmed_at, cc.completed_at, cc.cancelled_at, cc.created_at,
             COALESCE(ct.fee, 0) AS fee
      FROM campaign_collabs cc
      LEFT JOIN collab_terms ct ON ct.collab_id = cc.id
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

    const totals = emptyTotals();
    const categories = new Set<string>();

    const campaigns = (campaignRows || []).map((c) => {
      const list = collabsByCampaign.get(String(c.id)) || [];
      if (c.category) categories.add(String(c.category));

      let views = 0;
      let likes = 0;
      let comments = 0;
      let matched = 0;
      let uploaded = 0;
      let spend = 0;

      const posts = list.map((collab) => {
        const creator = norm(collab.creator_username);
        const channel = channelByUser.get(creator);
        const uploadUrl = String(collab.upload_url || "");
        const code = shortcodeOf(uploadUrl);
        const metric = code ? mediaByUser.get(creator)?.[code] : undefined;
        const cancelled = !!collab.cancelled_at || collab.status === "cancelled";

        if (uploadUrl && !cancelled) uploaded++;
        if (!cancelled) spend += intOf(collab.fee);
        if (metric && !cancelled) {
          matched++;
          views += metric.views;
          likes += metric.likes;
          comments += metric.comments;
        }

        return {
          collabId: String(collab.id),
          creatorUsername: creator,
          instagramHandle: String(channel?.instagram_handle || ""),
          status: String(collab.status || ""),
          cancelled,
          uploadUrl,
          fee: intOf(collab.fee),
          followers: intOf(channel?.followers),
          metricsSource: String(channel?.metrics_source || ""),
          // 지표가 없으면 왜 없는지까지 보낸다. 화면이 "아직 안 올렸다"와
          // "올렸는데 연동이 없다"를 다르게 안내해야 브랜드가 할 일을 안다.
          metrics: metric || null,
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

      const cpv = views > 0 && spend > 0 ? Math.round(spend / views) : 0;

      totals.campaigns++;
      totals.collabs += list.length;
      totals.uploaded += uploaded;
      totals.matched += matched;
      totals.views += views;
      totals.reactions += likes + comments;
      totals.spend += spend;

      return {
        id: String(c.id),
        title: String(c.title || ""),
        category: String(c.category || ""),
        type: String(c.type || ""),
        status: String(c.status || ""),
        rewardMode: String(c.reward_mode || ""),
        thumbnailUrl: String(c.thumbnail_url || ""),
        startDate: String(c.start_date || ""),
        endDate: String(c.end_date || ""),
        budgetKrw: intOf(c.budget_krw),
        createdAt: c.created_at || null,
        collabs: list.length,
        uploaded,
        matched,
        views,
        likes,
        comments,
        spend,
        cpv,
        posts,
      };
    });

    totals.cpv = totals.views > 0 && totals.spend > 0 ? Math.round(totals.spend / totals.views) : 0;

    return Response.json({
      totals,
      campaigns,
      categories: Array.from(categories).sort(),
    });
  } catch (err: any) {
    console.error("[business-campaign-history] 조회 실패:", err);
    return Response.json({ error: "캠페인 이력을 불러오지 못했습니다." }, { status: 500 });
  }
};

function emptyTotals() {
  return {
    campaigns: 0,
    collabs: 0,
    uploaded: 0,
    matched: 0,
    views: 0,
    reactions: 0,
    spend: 0,
    cpv: 0,
  };
}

export const config: Config = {
  path: "/api/business/campaign-history/:username",
};
