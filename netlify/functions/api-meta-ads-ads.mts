import type { Config, Context } from "@netlify/functions";
import { randomBytes } from "node:crypto";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { readMetaAdsDiagnosis, readMetaAdsToken, tokenErrorResponse } from "./_shared/meta-ads.mts";
import {
  ageRange,
  displayStatus,
  graphErrorResponse,
  graphGet,
  graphPost,
  GraphResult,
  MetaAdRecord,
  metaCta,
  placementParams,
  purchaseMetrics,
  readAdRecords,
  resolveGeo,
  saveAdRecord,
  scheduleTimes,
  toMinorUnits,
} from "./_shared/meta-ads-graph.mts";

/**
 * 광고 집행·조회 — '집행하기' 와 광고 현황의 서버 쪽.
 *
 *   GET  /api/meta-ads/ads/:username?account=act_…
 *        이 광고 계정에서 픽스폴리오로 만든 광고 + 메타의 실시간 상태·지표(ads_read).
 *   POST /api/meta-ads/ads/:username
 *        { action: 'create', draft }      기록을 만들고 첫 단계(캠페인)를 실행한다.
 *        { action: 'continue', id }       다음 단계(광고 세트 → 소재 → 광고)를 실행한다.
 *        { action: 'status', id, status } ACTIVE / PAUSED 로 바꾼다.
 *
 * 한 요청에 네 객체를 다 만들지 않는다. 단계마다 메타 호출이 1~3번이라 한 번에 하면
 * 함수 시간 제한에 걸릴 수 있고, 중간에 실패했을 때 어디까지 만들어졌는지 화면이 알 수
 * 없다. 화면은 단계를 하나씩 부르면서 메타가 돌려준 ID 를 그대로 보여 준다 — 브랜드가
 * 광고 관리자에서 같은 캠페인을 ID 로 찾을 수 있다.
 */

type Draft = Partial<MetaAdRecord> & { status?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** 이 기록이 메타의 어느 객체까지 만들었는지를 화면에 보낼 모양. 썸네일은 그대로 둔다. */
const publicRecord = (r: MetaAdRecord) => r;

/** 메타 오류를 기록에 남기고 화면에 그대로 돌려준다. */
async function stepFailed(username: string, record: MetaAdRecord, res: GraphResult, fallback: string) {
  record.error = res.error || fallback;
  record.errorCode = res.errorCode;
  record.updatedAt = new Date().toISOString();
  await saveAdRecord(username, record);
  return Response.json({ record: publicRecord(record), error: record.error, metaErrorCode: res.errorCode }, { status: 502 });
}

/**
 * 메타 버전에 따라 필수가 되는 파라미터가 있다(예: 광고 세트 예산을 쓰는 캠페인의
 * is_adset_budget_sharing_enabled). 먼저 없이 보내고, 메타가 그 이름을 대며 거절하면
 * 그 값만 붙여 한 번 더 보낸다 — 모르는 파라미터를 미리 붙이면 옛 버전이 거절한다.
 */
async function postWithFallback(
  path: string,
  token: string,
  proof: string,
  params: Record<string, unknown>,
  fallbacks: Record<string, unknown>,
): Promise<GraphResult> {
  const first = await graphPost(path, token, params, proof);
  if (first.ok) return first;
  const text = `${first.error || ""} ${JSON.stringify(first.data?.error || {})}`;
  const extra = Object.fromEntries(Object.entries(fallbacks).filter(([k]) => text.includes(k)));
  if (Object.keys(extra).length === 0) return first;
  return graphPost(path, token, { ...params, ...extra }, proof);
}

/* ---------------------------------------------------------------------------------------- */
/* 단계                                                                                     */
/* ---------------------------------------------------------------------------------------- */

async function runCampaign(token: string, proof: string, r: MetaAdRecord): Promise<GraphResult> {
  let objective = "OUTCOME_TRAFFIC";
  if (r.objective === "awareness") objective = "OUTCOME_AWARENESS";
  if (r.objective === "conversions") {
    // 전환(구매) 최적화는 픽셀이 있어야 한다. 없는 계정에서 OUTCOME_SALES 로 만들면 광고
    // 세트 단계에서 막히므로, 여기서 확인하고 트래픽 목적으로 돌린 뒤 그 사실을 남긴다.
    const pixels = await graphGet(`${r.adAccountId}/adspixels`, token, { fields: "id,name", limit: 1 }, proof);
    const pixelId = pixels.ok && Array.isArray(pixels.data?.data) ? String(pixels.data.data[0]?.id || "") : "";
    if (pixelId) {
      objective = "OUTCOME_SALES";
      r.pixelId = pixelId;
    } else {
      r.warnings.push("광고 계정에 Meta 픽셀이 없어 구매 전환 대신 링크 클릭(트래픽) 목적으로 집행합니다.");
    }
  }
  r.metaObjective = objective;
  return postWithFallback(
    `${r.adAccountId}/campaigns`,
    token,
    proof,
    {
      name: r.name,
      objective,
      status: r.initialStatus,
      special_ad_categories: [],
      buying_type: "AUCTION",
    },
    { is_adset_budget_sharing_enabled: false },
  );
}

async function runAdSet(token: string, proof: string, r: MetaAdRecord): Promise<GraphResult> {
  const { geo, warning } = await resolveGeo(token, proof, r.regions);
  if (warning) r.warnings.push(warning);

  const pixelId = r.pixelId || "";
  let optimization_goal = "LINK_CLICKS";
  let promoted_object: Record<string, unknown> | undefined;
  let destination_type: string | undefined = "WEBSITE";
  if (r.metaObjective === "OUTCOME_AWARENESS") {
    optimization_goal = "REACH";
    destination_type = undefined;
  } else if (r.metaObjective === "OUTCOME_SALES" && pixelId) {
    optimization_goal = "OFFSITE_CONVERSIONS";
    promoted_object = { pixel_id: pixelId, custom_event_type: "PURCHASE" };
  }
  // 파트너십 게시물 부스팅은 연결 URL 이 없다 — 게시물 자체로 보낸다.
  if (r.source === "partnership" && optimization_goal === "LINK_CLICKS") destination_type = undefined;

  const times = scheduleTimes(r.startDate, r.endDate);
  return postWithFallback(
    `${r.adAccountId}/adsets`,
    token,
    proof,
    {
      name: `${r.name} · 광고 세트`,
      campaign_id: r.campaignId,
      status: r.initialStatus,
      lifetime_budget: toMinorUnits(r.budgetKrw, r.currency),
      ...times,
      billing_event: "IMPRESSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      optimization_goal,
      promoted_object,
      destination_type,
      targeting: {
        geo_locations: geo,
        ...ageRange(r.ageBands),
        ...placementParams(r.placementMode, r.placements),
        targeting_automation: { advantage_audience: 0 },
      },
    },
    {},
  );
}

async function runCreative(
  token: string,
  proof: string,
  r: MetaAdRecord,
  businessId: string,
): Promise<GraphResult | Response> {
  if (r.source === "partnership") {
    // 파트너십 광고 코드 → 게시물 ID. 이 조회에는 instagram_branded_content_ads_brand
    // 권한과 브랜드 인스타그램 계정이 필요하다. 막히면 메타 문장을 그대로 보여 준다.
    if (!businessId || !r.instagramUserId) {
      return {
        ok: false,
        status: 400,
        data: {},
        error:
          "파트너십 광고 코드를 쓰려면 광고 계정이 비즈니스에 연결돼 있고, 고른 페이지에 인스타그램 프로페셔널 계정이 연결돼 있어야 합니다.",
      };
    }
    const lookup = await graphGet(
      `${businessId}/partnership-ads-advertisable-content`,
      token,
      { ig_user_id: r.instagramUserId, ad_codes: [r.partnershipCode], fields: "content_id,platform,permalink" },
      proof,
    );
    if (!lookup.ok) return lookup;
    const contentId = String(lookup.data?.data?.[0]?.content_id || "");
    if (!contentId) {
      return { ok: false, status: 404, data: lookup.data, error: "이 파트너십 광고 코드로 게시물을 찾지 못했습니다." };
    }
    return graphPost(
      `${r.adAccountId}/adcreatives`,
      token,
      {
        name: `${r.name} · 소재`,
        object_id: r.pageId,
        instagram_actor_id: r.instagramUserId,
        source_instagram_media_id: contentId,
      },
      proof,
    );
  }

  if (r.creativeKind === "video" && r.videoId) {
    // 메타가 영상 처리를 마치기 전에 소재를 만들면 거절된다. 화면이 잠시 뒤 다시 부른다.
    const video = await graphGet(r.videoId, token, { fields: "status" }, proof);
    const state = String(video.data?.status?.video_status || "");
    if (state && state !== "ready") {
      return Response.json(
        { record: r, pending: true, error: state === "error" ? "Meta가 영상을 처리하지 못했습니다." : "Meta가 영상을 처리하고 있습니다." },
        { status: state === "error" ? 502 : 202 },
      );
    }
  }

  const cta = { type: metaCta(r.cta), value: { link: r.linkUrl } };
  const storySpec = (withInstagram: boolean): Record<string, unknown> => ({
    page_id: r.pageId,
    ...(withInstagram && r.instagramUserId ? { instagram_actor_id: r.instagramUserId } : {}),
    ...(r.creativeKind === "video"
      ? {
          video_data: {
            video_id: r.videoId,
            image_hash: r.imageHash,
            title: r.headline,
            message: r.bodyText,
            call_to_action: cta,
          },
        }
      : {
          link_data: {
            link: r.linkUrl,
            name: r.headline,
            message: r.bodyText,
            image_hash: r.imageHash,
            call_to_action: cta,
          },
        }),
  });

  const first = await graphPost(
    `${r.adAccountId}/adcreatives`,
    token,
    { name: `${r.name} · 소재`, object_story_spec: storySpec(true) },
    proof,
  );
  if (first.ok || !r.instagramUserId) return first;
  // 인스타그램 계정을 이 광고 계정에서 쓸 수 없으면 페이지 이름으로만 만든다. 인스타그램
  // 게재 위치에는 페이지와 연결된 계정 이름으로 나간다(메타 기본 동작).
  const retry = await graphPost(
    `${r.adAccountId}/adcreatives`,
    token,
    { name: `${r.name} · 소재`, object_story_spec: storySpec(false) },
    proof,
  );
  if (retry.ok) r.warnings.push(`인스타그램 계정을 소재에 직접 연결하지 못해 페이지 기준으로 만들었습니다. (${first.error})`);
  return retry;
}

async function runAd(token: string, proof: string, r: MetaAdRecord): Promise<GraphResult> {
  return graphPost(
    `${r.adAccountId}/ads`,
    token,
    { name: r.name, adset_id: r.adSetId, creative: { creative_id: r.creativeId }, status: r.initialStatus },
    proof,
  );
}

/** 다음 단계 하나를 실행하고 기록을 저장한다. */
async function advance(username: string, token: string, proof: string, r: MetaAdRecord, businessId: string) {
  r.error = undefined;
  r.errorCode = undefined;
  const now = () => new Date().toISOString();

  if (r.step === "campaign") {
    const res = await runCampaign(token, proof, r);
    if (!res.ok) return stepFailed(username, r, res, "캠페인을 만들지 못했습니다.");
    r.campaignId = String(res.data?.id || "");
    r.step = "adset";
  } else if (r.step === "adset") {
    const res = await runAdSet(token, proof, r);
    if (!res.ok) return stepFailed(username, r, res, "광고 세트를 만들지 못했습니다.");
    r.adSetId = String(res.data?.id || "");
    r.step = "creative";
  } else if (r.step === "creative") {
    const res = await runCreative(token, proof, r, businessId);
    if (res instanceof Response) return res;
    if (!res.ok) return stepFailed(username, r, res, "광고 소재를 만들지 못했습니다.");
    r.creativeId = String(res.data?.id || "");
    r.step = "ad";
  } else if (r.step === "ad") {
    const res = await runAd(token, proof, r);
    if (!res.ok) return stepFailed(username, r, res, "광고를 만들지 못했습니다.");
    r.adId = String(res.data?.id || "");
    r.step = "done";
  }

  r.updatedAt = now();
  await saveAdRecord(username, r);
  return Response.json({ record: publicRecord(r) });
}

/* ---------------------------------------------------------------------------------------- */
/* 조회                                                                                     */
/* ---------------------------------------------------------------------------------------- */

const LIVE_FIELDS =
  "id,effective_status,configured_status,ad_review_feedback,issues_info," +
  "adset{id,start_time,end_time,lifetime_budget,effective_status}," +
  "campaign{id,effective_status}," +
  "insights.date_preset(maximum){impressions,clicks,reach,spend,actions,action_values}";

async function liveStatus(token: string, proof: string, records: MetaAdRecord[]) {
  const ids = records.map((r) => r.adId).filter(Boolean) as string[];
  const live: Record<string, any> = {};
  const errors: string[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await graphGet("", token, { ids: batch.join(","), fields: LIVE_FIELDS }, proof);
    if (res.ok) Object.assign(live, res.data || {});
    else errors.push(res.error || "광고 상태를 불러오지 못했습니다.");
  }

  return {
    errors,
    ads: records.map((r) => {
      const row = r.adId ? live[r.adId] : null;
      if (!row) {
        return {
          ...r,
          meta: {
            displayStatus: r.step === "done" ? "review" : "draft",
            effectiveStatus: r.step === "done" ? "UNKNOWN" : "NOT_CREATED",
          },
        };
      }
      const insight = Array.isArray(row?.insights?.data) ? row.insights.data[0] || {} : {};
      const effective = String(row?.effective_status || "");
      const feedback = row?.ad_review_feedback?.global
        ? Object.values(row.ad_review_feedback.global).map(String)
        : [];
      const issues = Array.isArray(row?.issues_info)
        ? row.issues_info.map((i: any) => String(i?.error_message || i?.error_summary || "")).filter(Boolean)
        : [];
      return {
        ...r,
        meta: {
          effectiveStatus: effective,
          configuredStatus: String(row?.configured_status || ""),
          campaignStatus: String(row?.campaign?.effective_status || ""),
          displayStatus: displayStatus(effective, row?.adset?.end_time),
          reviewFeedback: feedback,
          issues,
          impressions: Number(insight.impressions) || 0,
          clicks: Number(insight.clicks) || 0,
          reach: Number(insight.reach) || 0,
          spend: Number(insight.spend) || 0,
          ...purchaseMetrics(insight),
        },
      };
    }),
  };
}

/* ---------------------------------------------------------------------------------------- */

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

  const diagnosis = await readMetaAdsDiagnosis(username);
  const accounts = diagnosis?.accounts || [];

  if (req.method === "GET") {
    const account = new URL(req.url).searchParams.get("account") || "";
    const records = (await readAdRecords(username)).filter((r) => !account || r.adAccountId === account);
    const { ads, errors } = await liveStatus(token, proof, records);
    return Response.json({ ads, errors, fetchedAt: new Date().toISOString(), source: "meta_graph_api" });
  }

  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await req.json().catch(() => ({}))) as any;
  const action = String(body?.action || "");

  if (action === "continue" || action === "status") {
    const record = (await readAdRecords(username)).find((r) => r.id === String(body?.id || ""));
    if (!record) return Response.json({ error: "광고 기록을 찾지 못했습니다." }, { status: 404 });
    const account = accounts.find((a) => a.id === record.adAccountId);

    if (action === "continue") {
      if (record.step === "done") return Response.json({ record });
      return advance(username, token, proof, record, account?.businessId || "");
    }

    const status = String(body?.status || "");
    if (status !== "ACTIVE" && status !== "PAUSED") {
      return Response.json({ error: "status는 ACTIVE 또는 PAUSED여야 합니다." }, { status: 400 });
    }
    // 다시 켤 때는 셋 다 켠다 — 일시중지로 만든 광고는 캠페인·세트·광고가 모두 꺼져 있다.
    // 끌 때는 캠페인만 꺼도 되지만, 광고 관리자에서 보이는 상태를 맞추려고 같은 순서로 끈다.
    for (const id of [record.campaignId, record.adSetId, record.adId]) {
      if (!id) continue;
      const res = await graphPost(id, token, { status }, proof);
      if (!res.ok) return graphErrorResponse(res, "광고 상태를 바꾸지 못했습니다.");
    }
    return Response.json({ ok: true });
  }

  if (action !== "create") return Response.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });

  const draft = (body?.draft || {}) as Draft;
  const account = accounts.find((a) => a.id === draft.adAccountId);
  if (!account) return Response.json({ error: "연동된 광고 계정을 골라 주세요." }, { status: 400 });

  const source = draft.source === "partnership" ? "partnership" : "own";
  const objective =
    source === "partnership"
      ? "conversions"
      : (["awareness", "traffic", "conversions"] as const).find((o) => o === draft.objective) || "conversions";
  const budget = Math.floor(Number(draft.budgetKrw) || 0);
  const startDate = clean(draft.startDate, 10);
  const endDate = clean(draft.endDate, 10);
  const pageId = clean(draft.pageId, 30);
  const linkUrl = clean(draft.linkUrl, 1000);

  const invalid =
    (!/^\d+$/.test(pageId) && "광고 페이지를 골라 주세요.") ||
    (budget <= 0 && "예산을 입력해 주세요.") ||
    ((!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || endDate < startDate) && "집행 기간을 확인해 주세요.") ||
    (source === "own" && !/^https?:\/\//i.test(linkUrl) && "연결 URL을 확인해 주세요.") ||
    (source === "own" && !clean(draft.headline, 100) && "광고 제목을 입력해 주세요.") ||
    (source === "own" && !draft.imageHash && "광고 소재를 먼저 업로드해 주세요.") ||
    (source === "own" && draft.creativeKind === "video" && !draft.videoId && "영상 업로드가 끝나지 않았습니다.") ||
    (source === "partnership" && !clean(draft.partnershipCode, 300) && "파트너십 코드가 없습니다.");
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  // 페이지는 이 사람이 실제로 접근할 수 있는지 메타에 물어보고, 이름과 연결된 인스타그램
  // 계정을 함께 받는다(화면이 보낸 이름은 쓰지 않는다).
  const page = await graphGet(pageId, token, { fields: "id,name,instagram_business_account{id}" }, proof);
  if (!page.ok) return graphErrorResponse(page, "이 페이지에 접근할 수 없습니다.", 400);

  const thumbnail = String(draft.thumbnailUrl || "");
  const now = new Date().toISOString();
  const headline = clean(draft.headline, 100);
  const record: MetaAdRecord = {
    id: `mad_${Date.now()}_${randomBytes(3).toString("hex")}`,
    createdAt: now,
    updatedAt: now,
    source,
    adAccountId: account.id,
    currency: account.currency || "KRW",
    step: "campaign",
    warnings: [],
    initialStatus: draft.initialStatus === "PAUSED" ? "PAUSED" : "ACTIVE",
    objective,
    name: clean(
      `[PICKSfolio] ${source === "own" ? headline : draft.campaignTitle || "부스팅"} · ${startDate}`,
      200,
    ),
    headline,
    bodyText: clean(draft.bodyText, 1000),
    cta: clean(draft.cta, 30),
    linkUrl: linkUrl || undefined,
    pageId,
    pageName: String(page.data?.name || ""),
    instagramUserId: page.data?.instagram_business_account?.id
      ? String(page.data.instagram_business_account.id)
      : undefined,
    imageHash: clean(draft.imageHash, 100) || undefined,
    videoId: clean(draft.videoId, 40) || undefined,
    // 썸네일(작은 data URL)은 목록 카드용이다. 너무 크면 버린다 — 기록 전체를 한 덩어리로
    // 읽고 쓰므로 기록 하나가 커지면 모든 조회가 느려진다.
    thumbnailUrl: thumbnail.length <= 80_000 && /^(data:image\/|https:\/\/)/.test(thumbnail) ? thumbnail : "",
    creativeKind: draft.creativeKind === "video" ? "video" : "image",
    campaignTitle: clean(draft.campaignTitle, 200) || undefined,
    collabId: clean(draft.collabId, 100) || undefined,
    campaignRef: clean(draft.campaignRef, 100) || undefined,
    creatorHandle: clean(draft.creatorHandle, 100) || undefined,
    partnershipCode: clean(draft.partnershipCode, 300) || undefined,
    budgetKrw: budget,
    startDate,
    endDate,
    ageBands: Array.isArray(draft.ageBands) ? draft.ageBands.map(String).slice(0, 10) : [],
    regions: Array.isArray(draft.regions) ? draft.regions.map(String).slice(0, 10) : [],
    placementMode: draft.placementMode === "manual" ? "manual" : "auto",
    placements: Array.isArray(draft.placements) ? draft.placements.map(String).slice(0, 10) : [],
  };

  return advance(username, token, proof, record, account.businessId || "");
};

export const config: Config = {
  path: "/api/meta-ads/ads/:username",
  method: ["GET", "POST"],
};
