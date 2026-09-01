import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { isAssignedManager } from "./_shared/manager-auth.mts";
import {
  FRESH_HOURS,
  collectCampaignMetrics,
  loadCampaignMetrics,
} from "./_shared/post-metrics.mts";

/**
 * 캠페인 성과 — 올라간 게시물의 조회수 · 좋아요 · 댓글, 그리고 단가.
 *
 * 브랜드 · 담당자 · 인플루언서가 같은 캠페인의 성과를 본다. 세 화면이 각각 자기
 * 방식으로 숫자를 세면 같은 캠페인이 세 가지 결과를 갖게 되므로, 계산은 여기 한
 * 군데서만 한다. 화면은 받은 숫자를 그리기만 한다.
 *
 * ── 누가 무엇을 볼 수 있는가 ──
 *   브랜드(캠페인 주인) · 담당자 — 캠페인 전체. 지급액이 걸린 쪽이라 단가까지 본다.
 *   인플루언서                  — 자기 게시물만. 같은 캠페인의 다른 사람 성과는
 *                                 남의 자료이고, 캠페인 예산도 알 일이 아니다.
 *
 * ── 언제 수집하는가 ──
 * 화면을 열 때 마지막 수집이 오래됐으면(FRESH_HOURS) 그 자리에서 받아 온다. 매번
 * 받으면 메타 호출 한도를 화면 열기로 다 태우고, 아예 안 받으면 방금 올린 게시물이
 * 하루 동안 "집계 전"으로 남는다. 사람이 직접 "지금 수집"을 누르면 POST 로 강제한다.
 *
 * 인플루언서 요청으로는 캠페인 전체를 수집하지 않는다 — 자기 게시물만 받는다.
 * 한 캠페인에 인플루언서가 스무 명이면 스무 번의 화면 열기가 스무 배의 호출이 된다.
 *
 *   GET  /api/campaign-metrics?campaignId=...
 *   POST /api/campaign-metrics  { campaignId, action: 'refresh' }
 */

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

type Role = "brand" | "manager" | "influencer";

/**
 * 이 사람이 이 캠페인을 무슨 자격으로 보는가.
 *
 * 순서가 중요하다. 담당자가 자기 계정으로 캠페인에 협업까지 갖고 있을 일은 없지만,
 * 브랜드 소유 판정을 먼저 해야 담당자 겸 브랜드인 계정이 자기 캠페인을 온전히 본다.
 */
async function resolveRole(
  db: any,
  req: Request,
  campaignId: string,
): Promise<
  | { ok: true; role: Role; username: string; campaign: any }
  | { ok: false; response: Response }
> {
  const rows = (await db.sql`
    SELECT id, title, business_username, brand_name, budget_krw, thumbnail_url,
           start_date, end_date, status, reward_mode, manager_username
    FROM campaigns WHERE id = ${campaignId} LIMIT 1
  `) as any[];
  const campaign = rows?.[0];
  if (!campaign) {
    return {
      ok: false,
      response: Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 }),
    };
  }

  const caller = await requireSignedInUser(req);
  if (!caller.ok) return { ok: false, response: caller.response };
  const me = norm(caller.username);

  if (caller.isAdmin) return { ok: true, role: "manager", username: me, campaign };
  if (me && me === norm(campaign.business_username)) {
    return { ok: true, role: "brand", username: me, campaign };
  }
  if (await isAssignedManager(me)) {
    return { ok: true, role: "manager", username: me, campaign };
  }

  const mine = (await db.sql`
    SELECT 1 FROM campaign_collabs
    WHERE campaign_id = ${campaignId} AND LOWER(creator_username) = ${me}
    LIMIT 1
  `) as any[];
  if (mine.length > 0) return { ok: true, role: "influencer", username: me, campaign };

  return {
    ok: false,
    response: Response.json({ error: "이 캠페인의 성과를 볼 권한이 없습니다." }, { status: 403 }),
  };
}

/**
 * 단가를 만든다.
 *
 * CPV(조회수당 비용)가 첫 후보다. 조회수는 인사이트 권한이 있어야 나오는 값이라
 * 못 받는 경우가 있고, 그때 예산을 조회수 0 으로 나눠 봐야 뜻이 없다. 그래서 받은
 * 것으로 만들 수 있는 단가를 차례로 내려간다.
 *
 *   조회수가 있으면            → CPV (조회수당 원)
 *   반응만 있으면              → CPE (좋아요+댓글 한 건당 원)
 *   둘 다 없고 게시물만 있으면 → 게시물당 원
 *
 * `primary` 로 무엇을 쓴 단가인지 함께 보낸다. 화면이 "CPV"라고만 적으면 사람은
 * 조회수가 집계됐다고 믿는다 — 무엇으로 대체했는지는 숫자만큼 중요한 정보다.
 */
const costOf = (totals: any, spend: number) => {
  const views = totals.views;
  const engagements = totals.engagements;
  const posts = totals.measuredCount;

  const cpv = spend > 0 && views && views > 0 ? Math.round(spend / views) : null;
  const cpe = spend > 0 && engagements && engagements > 0 ? Math.round(spend / engagements) : null;
  const cpp = spend > 0 && posts > 0 ? Math.round(spend / posts) : null;

  return {
    spend,
    cpv,
    cpe,
    cpp,
    primary: cpv !== null ? "cpv" : cpe !== null ? "cpe" : cpp !== null ? "cpp" : "none",
  };
};

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  try {
    const campaignId =
      req.method === "GET"
        ? String(url.searchParams.get("campaignId") || "")
        : "";

    let body: any = {};
    if (req.method === "POST") {
      body = await req.json().catch(() => ({}));
    }
    const id = campaignId || String(body.campaignId || "");
    if (!id) {
      return Response.json({ error: "campaignId 가 필요합니다." }, { status: 400 });
    }

    const auth = await resolveRole(db, req, id);
    if (!auth.ok) return auth.response;
    const { role, username, campaign } = auth;

    // 인플루언서는 자기 게시물만 본다. 이 값이 곧 조회·수집 양쪽의 울타리다.
    const scope = role === "influencer" ? username : "";

    if (req.method === "POST") {
      const action = String(body.action || "refresh");
      if (action !== "refresh") {
        return Response.json({ error: "알 수 없는 요청입니다." }, { status: 400 });
      }
      const result = await collectCampaignMetrics(db, id, {
        force: true,
        creatorUsername: scope,
      });
      const data = await loadCampaignMetrics(db, id, { creatorUsername: scope });
      return Response.json({
        success: true,
        collected: result.collected,
        attempted: result.attempted,
        ...shape(data, role, campaign),
      });
    }

    if (req.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // 오래된 값이면 이 요청에서 받아 온다. 실패해도 저장된 값으로 화면은 그린다 —
    // 메타가 잠시 막혔다고 어제까지의 성과가 사라져 보일 이유는 없다.
    let first = await loadCampaignMetrics(db, id, { creatorUsername: scope });
    const stale =
      !first.totals.collectedAt ||
      Date.now() - new Date(first.totals.collectedAt).getTime() > FRESH_HOURS * 3600_000;
    const pending = first.totals.uploadedCount > first.posts.length;

    if (stale || pending) {
      try {
        await collectCampaignMetrics(db, id, { creatorUsername: scope });
        first = await loadCampaignMetrics(db, id, { creatorUsername: scope });
      } catch (e) {
        console.warn("[campaign-metrics] 수집 실패:", (e as Error)?.message);
      }
    }

    return Response.json({ success: true, ...shape(first, role, campaign) });
  } catch (err: any) {
    return Response.json(
      { error: err?.message || "캠페인 성과를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
};

/**
 * 화면이 받을 모양.
 *
 * 인플루언서 응답에는 금액이 없다. 예산도 단가도 남의 계약 조건이라, 자기 협업 한
 * 건의 성과를 보는 자리에 실릴 값이 아니다(브랜드는 자기 캠페인이라 전부 본다).
 */
const shape = (data: any, role: Role, campaign: any) => {
  const budgetKrw = Number(campaign.budget_krw || 0);
  const money = role === "influencer" ? null : costOf(data.totals, data.totals.measuredSpend);

  return {
    role,
    campaign: {
      id: String(campaign.id),
      title: String(campaign.title || ""),
      brandName: String(campaign.brand_name || ""),
      thumbnailUrl: String(campaign.thumbnail_url || ""),
      status: String(campaign.status || ""),
      startDate: String(campaign.start_date || ""),
      endDate: String(campaign.end_date || ""),
      budgetKrw: role === "influencer" ? 0 : budgetKrw,
    },
    posts: data.posts,
    series: data.series,
    totals: {
      ...data.totals,
      // 인플루언서 화면에서는 지급액 합계를 지운다.
      measuredSpend: role === "influencer" ? 0 : data.totals.measuredSpend,
      totalSpend: role === "influencer" ? 0 : data.totals.totalSpend,
    },
    cost: money,
    freshHours: FRESH_HOURS,
  };
};

export const config: Config = {
  path: "/api/campaign-metrics",
};
