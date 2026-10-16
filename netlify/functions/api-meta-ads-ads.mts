import type { Config, Context } from "@netlify/functions";
import { randomBytes } from "node:crypto";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { PARTNERSHIP_SCOPES, readMetaAdsDiagnosis, readMetaAdsToken, tokenErrorResponse } from "./_shared/meta-ads.mts";
import {
  buildTargeting,
  CONVERSION_EVENTS,
  displayStatus,
  GOALS_BY_OBJECTIVE,
  graphErrorResponse,
  graphGet,
  graphPost,
  GraphResult,
  MetaAdRecord,
  accountPixelIds,
  eventMetrics,
  metaCta,
  purchaseMetrics,
  isMissingObject,
  readAdRecords,
  removeAdRecords,
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
 *        { action: 'status', id, status } ACTIVE(진행) / PAUSED(일시중지)로 바꾼다.
 *        { action: 'resume', id, draft }  멈춘 광고를 고친 설정으로 다시 만든다.
 *        { action: 'delete', id, removeFromMeta } 기록을 지운다(메타 캠페인도 같이 지울 수 있다).
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
  if (r.objective === "engagement") objective = "OUTCOME_ENGAGEMENT";
  // 화면에서 고른 픽셀이 이 광고 계정 것인지 확인한다. 남의 계정 픽셀을 붙이면 광고 단계에서
  // 거절되고, 그 전까지 만든 캠페인·세트가 빈 채로 남는다.
  // null 은 "픽셀 없음"이 아니라 "목록 조회 실패"(일시 장애·레이트리밋)다. 한 번 더 물어보고,
  // 그래도 실패하면 화면이 보낸 픽셀을 그대로 믿는다 — 없다고 단정해 목적을 바꾸지 않는다.
  let list = await accountPixelIds(r.adAccountId, token, proof);
  if (list === null) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    list = await accountPixelIds(r.adAccountId, token, proof);
  }
  const verified = list !== null;
  if (r.objective === "conversions") {
    // 전환(구매) 최적화는 픽셀이 있어야 한다. 없는 계정에서 OUTCOME_SALES 로 만들면 광고
    // 세트 단계에서 막히므로, 여기서 확인하고 트래픽 목적으로 돌린다(진행 화면에 경고로 남긴다).
    const pixelId = !list ? r.pixelId || "" : r.pixelId && list.includes(r.pixelId) ? r.pixelId : list[0] || "";
    if (pixelId) {
      objective = "OUTCOME_SALES";
      r.pixelId = pixelId;
      if (!verified) r.warnings.push("메타에서 픽셀 목록을 확인하지 못해, 고른 픽셀을 그대로 써서 판매 목적으로 집행합니다.");
    } else {
      r.pixelId = undefined;
      r.warnings.push(
        verified
          ? "이 광고 계정에 픽셀이 없어 판매 대신 트래픽(링크 클릭) 목적으로 집행합니다."
          : "메타에서 픽셀 목록을 확인하지 못했고 고른 픽셀도 없어 판매 대신 트래픽(링크 클릭) 목적으로 집행합니다.",
      );
    }
  } else if (r.pixelId && !list) {
    // 확인에 실패했을 뿐이니 고른 픽셀로 추적을 붙인 채 만든다.
    r.warnings.push("메타에서 픽셀 목록을 확인하지 못해, 고른 픽셀을 확인 없이 웹사이트 이벤트 추적에 씁니다.");
  } else if (r.pixelId && list && !list.includes(r.pixelId)) {
    // 판매가 아닌 목적의 픽셀은 측정(tracking_specs)에만 쓴다. 이 계정 것이 아니면 빼고 만든다.
    r.warnings.push("고른 픽셀이 이 광고 계정에 없어 웹사이트 이벤트 추적 없이 만듭니다.");
    r.pixelId = undefined;
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

/** 성과 목표 → optimization_goal · promoted_object · destination_type. */
function adSetGoal(r: MetaAdRecord) {
  const pixelId = r.pixelId || "";
  const hasLink = !!r.linkUrl;
  let goal = r.optimizationGoal || "";

  if (r.metaObjective === "OUTCOME_SALES" && pixelId) {
    if (!["OFFSITE_CONVERSIONS", "VALUE", "LANDING_PAGE_VIEWS", "LINK_CLICKS"].includes(goal)) goal = "OFFSITE_CONVERSIONS";
    const event = goal === "VALUE" ? "PURCHASE" : r.conversionEvent || "PURCHASE";
    return {
      optimization_goal: goal,
      promoted_object: { pixel_id: pixelId, custom_event_type: event },
      destination_type: "WEBSITE" as string | undefined,
    };
  }
  if (r.metaObjective === "OUTCOME_AWARENESS") {
    if (!GOALS_BY_OBJECTIVE.awareness.includes(goal)) goal = "REACH";
    return { optimization_goal: goal, promoted_object: undefined, destination_type: undefined };
  }
  if (r.metaObjective === "OUTCOME_ENGAGEMENT") {
    if (!GOALS_BY_OBJECTIVE.engagement.includes(goal)) goal = "POST_ENGAGEMENT";
    return {
      optimization_goal: goal,
      promoted_object: { page_id: r.pageId },
      destination_type: goal === "THRUPLAY" ? "ON_VIDEO" : "ON_POST",
    };
  }
  // 트래픽(또는 픽셀이 없어 트래픽으로 돌린 판매).
  if (!GOALS_BY_OBJECTIVE.traffic.includes(goal) || (goal === "LANDING_PAGE_VIEWS" && !hasLink)) goal = "LINK_CLICKS";
  // 파트너십 게시물 부스팅에 연결 URL 이 없으면 게시물 자체로 보낸다.
  const destination_type = r.source === "partnership" && !hasLink ? undefined : "WEBSITE";
  return { optimization_goal: goal, promoted_object: undefined, destination_type };
}

/** 입찰 전략 → bid_strategy · bid_amount. 금액이 없으면 최고 볼륨으로 둔다. */
function bidParams(r: MetaAdRecord): Record<string, unknown> {
  const amount = Math.floor(Number(r.bidAmountKrw) || 0);
  if (r.bidStrategy === "cost_cap" && amount > 0) {
    return { bid_strategy: "COST_CAP", bid_amount: toMinorUnits(amount, r.currency) };
  }
  if (r.bidStrategy === "bid_cap" && amount > 0) {
    return { bid_strategy: "LOWEST_COST_WITH_BID_CAP", bid_amount: toMinorUnits(amount, r.currency) };
  }
  return { bid_strategy: "LOWEST_COST_WITHOUT_CAP" };
}

async function runAdSet(token: string, proof: string, r: MetaAdRecord): Promise<GraphResult> {
  const { targeting, warning, error } = await buildTargeting(token, proof, r);
  if (warning) r.warnings.push(warning);
  // 맞춤 타겟의 소속을 확인하지 못했으면 광고 세트를 만들지 않는다. 이 단계에서 멈춰 두면
  // 다시 시도할 때 이어서 만든다.
  if (error) return { ok: false, status: 502, data: {}, error };

  const { optimization_goal, promoted_object, destination_type } = adSetGoal(r);
  if (r.optimizationGoal && r.optimizationGoal !== optimization_goal) {
    r.warnings.push(`성과 목표를 ${r.optimizationGoal} 대신 ${optimization_goal}(으)로 집행합니다.`);
  }
  r.optimizationGoal = optimization_goal;

  const budget = toMinorUnits(r.budgetKrw, r.currency);
  const freq =
    optimization_goal === "REACH" && r.frequencyCap
      ? [
          {
            event: "IMPRESSIONS",
            interval_days: Math.max(1, Math.min(90, Math.floor(r.frequencyCap.days) || 7)),
            max_frequency: Math.max(1, Math.min(90, Math.floor(r.frequencyCap.impressions) || 2)),
          },
        ]
      : undefined;

  const times = scheduleTimes(r.startDate, r.endDate);
  return postWithFallback(
    `${r.adAccountId}/adsets`,
    token,
    proof,
    {
      name: r.adSetName || `${r.name} · 광고 세트`,
      campaign_id: r.campaignId,
      status: r.initialStatus,
      ...(r.budgetType === "daily" ? { daily_budget: budget } : { lifetime_budget: budget }),
      ...times,
      billing_event: "IMPRESSIONS",
      ...bidParams(r),
      optimization_goal,
      promoted_object,
      destination_type,
      frequency_control_specs: freq,
      targeting,
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
    // 파트너십 광고 코드 부스팅. 메타 문서(Boost Existing Instagram Media as Partnership Ads)
    // 대로 광고 코드 자체를 소재에 실어 보낸다 — branded_content.instagram_boost_post_access_token.
    // 코드가 곧 크리에이터의 게시물 단위 허가라서, 게시물 ID(source_instagram_media_id)만
    // 보내면 크리에이터가 따로 승인할 때까지 광고가 '게재 대기'에 머문다.
    // 스폰서(브랜드) 인스타그램 계정이 있어야 파트너십 광고의 두 번째 이름으로 나간다.
    if (!r.instagramUserId) {
      return {
        ok: false,
        status: 400,
        data: {},
        error: "파트너십 광고를 하려면 고른 페이스북 페이지에 브랜드 인스타그램 프로페셔널 계정이 연결돼 있어야 합니다.",
      };
    }
    const code = String(r.partnershipCode || "");

    // 코드가 유효한지, 광고로 쓸 수 있는 게시물인지 먼저 확인한다(비즈니스가 있을 때만).
    // 조회 자체가 막히면(권한·비즈니스 소속) 소재 생성에서 메타가 판단하게 둔다 — 조회는
    // 확인용이고 광고를 만드는 데 꼭 필요한 값이 아니다.
    let contentId = "";
    let lookupEmpty = false;
    if (businessId) {
      const lookup = await graphGet(
        `${businessId}/partnership-ads-advertisable-content`,
        token,
        {
          ig_user_id: r.instagramUserId,
          ad_codes: [code],
          fields: "content_id,platform,permalink,partnership_info{ad_eligibility}",
        },
        proof,
      );
      if (lookup.ok) {
        const row = lookup.data?.data?.[0];
        // 조회가 비어도 여기서 멈추지 않는다. 이 조회는 비즈니스·인스타그램 계정 조합에 따라
        // 유효한 코드에도 빈 목록을 돌려줄 때가 있다 — 코드를 실은 소재 생성에서 메타가 판단한다.
        if (!row?.content_id) lookupEmpty = true;
        else contentId = String(row.content_id);
        const eligibility = Array.isArray(row?.partnership_info)
          ? row.partnership_info.map((p: any) => String(p?.ad_eligibility || "")).filter(Boolean)
          : [];
        if (eligibility.length && !eligibility.includes("AD_READY")) {
          r.warnings.push(`메타가 이 게시물의 광고 가능 상태를 ${eligibility.join(", ")}(으)로 표시했습니다.`);
        }
      }
    }

    const base: Record<string, unknown> = {
      name: `${r.name} · 소재`,
      object_id: r.pageId,
      branded_content: { instagram_boost_post_access_token: code, ad_format: 1 },
      instagram_branded_content: { sponsor_id: r.instagramUserId },
      facebook_branded_content: { sponsor_page_id: r.pageId },
    };
    // 페이스북 노출용 스폰서 값을 메타가 받지 않는 계정이 있다. 그때는 인스타그램 값만 둔다.
    const igOnly = { ...base, facebook_branded_content: undefined };
    const link = r.linkUrl
      ? { call_to_action: { type: metaCta(r.cta), value: { link: r.linkUrl } }, url_tags: r.urlTags || undefined }
      : {};
    // 표시 링크는 버튼 옆에 보이는 주소일 뿐이라, 메타가 받지 않으면 빼고 다시 보낸다.
    const captioned = r.linkUrl && r.displayLink
      ? {
          call_to_action: { type: metaCta(r.cta), value: { link: r.linkUrl, link_caption: r.displayLink } },
          url_tags: r.urlTags || undefined,
        }
      : null;

    // 고른 버튼 종류를 메타가 이 게시물에 받지 않으면 '더 알아보기'로 바꿔 버튼은 살린다.
    const fallbackCta = r.linkUrl && metaCta(r.cta) !== "LEARN_MORE"
      ? { call_to_action: { type: "LEARN_MORE", value: { link: r.linkUrl } }, url_tags: r.urlTags || undefined }
      : null;

    const attempts: Record<string, unknown>[] = [];
    if (captioned) attempts.push({ ...base, ...captioned });
    attempts.push({ ...base, ...link });
    if (fallbackCta) attempts.push({ ...base, ...fallbackCta });
    if (r.linkUrl) attempts.push(base);
    attempts.push(igOnly);
    // 예전 방식(게시물 ID)도 마지막에 시도한다. 크리에이터가 계정 단위로 허가해 둔 경우 이것으로도 나간다.
    if (contentId) {
      attempts.push({
        name: `${r.name} · 소재`,
        object_id: r.pageId,
        instagram_user_id: r.instagramUserId,
        source_instagram_media_id: contentId,
      });
    }

    let first: GraphResult | null = null;
    for (let i = 0; i < attempts.length; i++) {
      const res = await graphPost(`${r.adAccountId}/adcreatives`, token, attempts[i], proof);
      if (res.ok) {
        const usedCta = (attempts[i].call_to_action as { type?: string } | undefined)?.type;
        if (fallbackCta && usedCta === "LEARN_MORE") {
          r.warnings.push("고른 버튼을 Meta가 이 게시물에 받지 않아 '더 알아보기' 버튼으로 만들었습니다.");
        } else if (captioned && i > 0 && "call_to_action" in attempts[i]) {
          r.warnings.push("표시 링크를 Meta가 받지 않아 버튼과 웹사이트 URL만 붙였습니다.");
        }
        if (r.linkUrl && !("call_to_action" in attempts[i])) {
          r.warnings.push(`웹사이트 버튼을 붙이지 못해 게시물 그대로 만들었습니다. (${first?.error || ""})`);
        }
        if ("source_instagram_media_id" in attempts[i]) {
          r.warnings.push("광고 코드로 소재를 만들지 못해 게시물 ID로 만들었습니다. 크리에이터 허가 전까지 게재 대기일 수 있습니다.");
        }
        return res;
      }
      first = first || res;
      // 권한·토큰 문제(10, 200, 190)는 값을 바꿔 다시 보내도 같다.
      if (res.errorCode === 10 || res.errorCode === 200 || res.errorCode === 190) break;
    }
    // 메타도 거절했고 사전 조회에서도 게시물이 안 나왔으면 코드 자체를 의심할 근거가 있다.
    if (lookupEmpty && first) {
      first.error = `${first.error || "소재를 만들지 못했습니다."} (광고 코드로 게시물을 찾지 못했습니다. 코드가 만료됐거나 다른 브랜드 인스타그램 계정에 발급된 코드인지 인플루언서에게 확인해 주세요.)`;
    }
    return first!;
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

  const cta = {
    type: metaCta(r.cta),
    value: { link: r.linkUrl, ...(r.displayLink ? { link_caption: r.displayLink } : {}) },
  };
  const storySpec = (withInstagram: boolean): Record<string, unknown> => ({
    page_id: r.pageId,
    ...(withInstagram && r.instagramUserId ? { instagram_user_id: r.instagramUserId } : {}),
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
    { name: `${r.name} · 소재`, object_story_spec: storySpec(true), url_tags: r.urlTags || undefined },
    proof,
  );
  if (first.ok || !r.instagramUserId) return first;
  // 인스타그램 계정을 이 광고 계정에서 쓸 수 없으면 페이지 이름으로만 만든다. 인스타그램
  // 게재 위치에는 페이지와 연결된 계정 이름으로 나간다(메타 기본 동작).
  const retry = await graphPost(
    `${r.adAccountId}/adcreatives`,
    token,
    { name: `${r.name} · 소재`, object_story_spec: storySpec(false), url_tags: r.urlTags || undefined },
    proof,
  );
  if (retry.ok) r.warnings.push(`인스타그램 계정을 소재에 직접 연결하지 못해 페이지 기준으로 만들었습니다. (${first.error})`);
  return retry;
}

/**
 * 광고를 만든다. 픽셀을 골랐으면 광고 관리자의 '추적 › 웹사이트 이벤트' 와 같은 값
 * (tracking_specs)을 붙인다.
 *
 * 판매 목적은 광고 세트의 promoted_object 로 픽셀이 이미 연결되지만, 트래픽 · 인지도 · 참여
 * 목적은 이것이 없으면 광고를 보고 들어와 구매해도 그 구매가 이 광고의 성과로 잡히지 않는다.
 * 메타가 이 값을 거절하면(오래된 광고 계정 설정 등) 추적 없이 만들고 그 사실을 남긴다 —
 * 측정 하나 때문에 광고 자체를 못 만들면 안 된다.
 */
async function runAd(token: string, proof: string, r: MetaAdRecord): Promise<GraphResult> {
  const base = { name: r.adName || r.name, adset_id: r.adSetId, creative: { creative_id: r.creativeId }, status: r.initialStatus };
  if (!r.pixelId) return graphPost(`${r.adAccountId}/ads`, token, base, proof);
  const tracked = await graphPost(
    `${r.adAccountId}/ads`,
    token,
    { ...base, tracking_specs: [{ "action.type": ["offsite_conversion"], fb_pixel: [r.pixelId] }] },
    proof,
  );
  if (tracked.ok) return tracked;
  const plain = await graphPost(`${r.adAccountId}/ads`, token, base, proof);
  if (plain.ok) r.warnings.push(`픽셀 추적을 붙이지 못해 추적 없이 만들었습니다. (${tracked.error})`);
  return plain.ok ? plain : tracked;
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

/**
 * 지표 기간. 광고 관리자 오른쪽 위 날짜 선택과 같은 값(date_preset)만 받는다.
 * 기본은 '전체 기간'(maximum) — 예전 화면과 같은 숫자다.
 */
const DATE_PRESETS = ["today", "yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month", "maximum"];

const liveFields = (preset: string) =>
  "id,effective_status,configured_status,ad_review_feedback,issues_info," +
  "adset{id,start_time,end_time,lifetime_budget,effective_status,configured_status}," +
  "campaign{id,effective_status,configured_status}," +
  `insights.date_preset(${preset}){impressions,clicks,inline_link_clicks,reach,spend,actions,action_values,video_thruplay_watched_actions}`;

const DRAFT_FIELDS = "id,effective_status,configured_status";

/**
 * 지표 없이 상태만 읽는 필드. 지워진 광고는 insights 를 붙여 읽으면 '없음' 이 아닌 다른
 * 오류로 돌아오는 일이 있어, 그때 상태만 다시 읽어 지워졌는지 가린다.
 */
const STATUS_FIELDS =
  "id,effective_status,configured_status,adset{effective_status,configured_status},campaign{effective_status,configured_status}";

/**
 * 광고 관리자에서 지운(또는 보관한) 객체인지. 지운 광고는 DELETED, 위 객체를 지우면
 * ADSET_DELETED · CAMPAIGN_DELETED 처럼 이름에 DELETED 가 붙어 돌아온다. 보관(ARCHIVED)한
 * 광고도 광고 관리자 기본 목록에서 빠지므로 여기서도 지운 것으로 본다.
 */
const isGoneStatus = (status: unknown) => {
  const s = String(status || "");
  return s === "ARCHIVED" || s.includes("DELETED");
};

const isGoneRow = (row: any) =>
  !!row &&
  [
    row.effective_status,
    row.configured_status,
    row.adset?.effective_status,
    row.adset?.configured_status,
    row.campaign?.effective_status,
    row.campaign?.configured_status,
  ].some(isGoneStatus);

/**
 * 여러 ID 를 한 번에 읽는다. 그중 하나라도 메타에서 지워졌으면 묶음 전체가 '없음' 으로
 * 실패하므로, 그때만 하나씩 다시 읽어 지워진 것을 골라낸다.
 */
async function readMany(token: string, proof: string, ids: string[], fields: string) {
  const rows: Record<string, any> = {};
  const missing: string[] = [];
  const errors: string[] = [];
  /** 하나씩 읽는다. 지표까지 붙인 읽기가 실패하면 상태만 다시 읽어 지워졌는지 가린다. */
  const readOne = async (id: string) => {
    const one = await graphGet(id, token, { fields }, proof);
    if (one.ok) return void (rows[id] = one.data);
    if (isMissingObject(one)) return void missing.push(id);
    if (fields !== DRAFT_FIELDS) {
      const bare = await graphGet(id, token, { fields: STATUS_FIELDS }, proof);
      if (bare.ok && isGoneRow(bare.data)) return void (rows[id] = bare.data);
      if (isMissingObject(bare)) return void missing.push(id);
    }
    errors.push(one.error || "광고 상태를 불러오지 못했습니다.");
  };
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await graphGet("", token, { ids: batch.join(","), fields }, proof);
    if (res.ok) {
      Object.assign(rows, res.data || {});
      // 묶음 응답에서 빠진 ID 는 지워졌을 수 있다 — 하나씩 다시 확인한다.
      for (const id of batch) if (!rows[id]) await readOne(id);
      continue;
    }
    if (!isMissingObject(res)) {
      errors.push(res.error || "광고 상태를 불러오지 못했습니다.");
      continue;
    }
    for (const id of batch) await readOne(id);
  }
  return { rows, missing, errors };
}

/**
 * 기록마다 메타의 지금 상태를 붙인다.
 *
 * 광고 관리자에서 지운 광고는 여기서 기록도 지운다 — 메타에는 없는데 이 화면에만 남아
 * 있으면 브랜드는 지운 광고를 또 찾게 된다. 광고나 광고 세트·캠페인이 지워졌거나 보관됐거나
 * (위를 지우면 아래 광고가 같이 지워진다 — isGoneRow), 조회 자체가 '없는 객체' 로 돌아오면
 * 지워진 것으로 본다. 광고까지 못 만든 기록은 만들어 둔 캠페인으로 같은 판단을 한다.
 */
async function liveStatus(token: string, proof: string, records: MetaAdRecord[], preset = "maximum") {
  const adIds = records.map((r) => r.adId).filter(Boolean) as string[];
  const draftCampaignIds = records.filter((r) => !r.adId && r.campaignId).map((r) => r.campaignId!) as string[];
  const ads = await readMany(token, proof, adIds, liveFields(preset));
  const drafts = await readMany(token, proof, draftCampaignIds, DRAFT_FIELDS);
  const errors = [...ads.errors, ...drafts.errors];
  const live = ads.rows;

  const deleted = new Set<string>();
  for (const r of records) {
    if (r.adId) {
      const row = live[r.adId];
      if (ads.missing.includes(r.adId) || isGoneRow(row)) {
        deleted.add(r.id);
      }
    } else if (r.campaignId) {
      if (drafts.missing.includes(r.campaignId) || isGoneRow(drafts.rows[r.campaignId])) {
        deleted.add(r.id);
      }
    }
  }

  return {
    errors,
    deleted: [...deleted],
    ads: records.filter((r) => !deleted.has(r.id)).map((r) => {
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
          /** 링크 클릭(광고 관리자의 'CPC(링크 클릭당 비용)' 분모). clicks 는 모든 클릭이다. */
          linkClicks: Number(insight.inline_link_clicks) || 0,
          reach: Number(insight.reach) || 0,
          spend: Number(insight.spend) || 0,
          ...purchaseMetrics(insight),
          ...eventMetrics(insight),
        },
      };
    }),
  };
}

/* ---------------------------------------------------------------------------------------- */
/* 기록 만들기 · 지우기                                                                      */
/* ---------------------------------------------------------------------------------------- */

type LinkedAccount = { id: string; currency?: string; businessId?: string };

/** 화면이 보낸 설정을 검증해 새 기록으로 만든다. 문제가 있으면 오류 응답을 돌려준다. */
async function buildRecord(
  draft: Draft,
  account: LinkedAccount,
  token: string,
  proof: string,
): Promise<MetaAdRecord | Response> {
  const source = draft.source === "partnership" ? "partnership" : "own";
  // 부스팅은 '참여' 목표까지 고를 수 있다. 예전 부스팅 기록은 목표가 비어 있어 전환이 된다.
  const objectives =
    source === "partnership"
      ? (["conversions", "traffic", "engagement", "awareness"] as const)
      : (["awareness", "traffic", "conversions"] as const);
  const objective = objectives.find((o) => o === draft.objective) || "conversions";
  const goals = GOALS_BY_OBJECTIVE[objective] || [];
  const optimizationGoal = goals.includes(String(draft.optimizationGoal || "")) ? String(draft.optimizationGoal) : goals[0];
  const conversionEvent = CONVERSION_EVENTS.includes(String(draft.conversionEvent || ""))
    ? String(draft.conversionEvent)
    : "PURCHASE";
  const budgetType = draft.budgetType === "daily" ? "daily" : "lifetime";
  const bidStrategy = (["cost_cap", "bid_cap"] as const).find((b) => b === draft.bidStrategy) || "lowest_cost";
  const bidAmountKrw = bidStrategy === "lowest_cost" ? 0 : Math.floor(Number(draft.bidAmountKrw) || 0);
  const targetList = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((x: any) => ({ id: clean(x?.id, 30), name: clean(x?.name, 200) }))
      .filter((x) => /^\d+$/.test(x.id))
      .slice(0, 50);
  const freq = draft.frequencyCap as { impressions?: number; days?: number } | null | undefined;
  const urlTags = clean(draft.urlTags, 500).replace(/^\?/, "");
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
    (source === "partnership" && !clean(draft.partnershipCode, 300) && "파트너십 코드가 없습니다.") ||
    (source === "partnership" && linkUrl && !/^https?:\/\//i.test(linkUrl) && "웹사이트 URL을 확인해 주세요.") ||
    (bidStrategy !== "lowest_cost" && bidAmountKrw <= 0 && "입찰 금액을 입력해 주세요.") ||
    (optimizationGoal === "LANDING_PAGE_VIEWS" && !linkUrl && "랜딩 페이지 조회 최적화는 웹사이트 URL이 있어야 합니다.");
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  // 페이지는 이 사람이 실제로 접근할 수 있는지 메타에 물어보고, 이름과 연결된 인스타그램
  // 계정을 함께 받는다(화면이 보낸 이름은 쓰지 않는다). 로케일을 두지 않으면 한글 페이지
  // 이름이 영문 표기로 돌아오므로 비즈니스 스위트와 같은 이름을 받게 ko_KR 로 묻는다.
  const page = await graphGet(
    pageId,
    token,
    { fields: "id,name,instagram_business_account{id}", locale: "ko_KR" },
    proof,
  );
  if (!page.ok) return graphErrorResponse(page, "이 페이지에 접근할 수 없습니다.", 400);

  // 파트너십 광고는 브랜드 인스타그램 계정이 스폰서로 들어가야 한다. 캠페인·세트를 먼저
  // 만들고 소재 단계에서 막히면 빈 캠페인이 남으므로 여기서 거른다.
  if (source === "partnership" && !page.data?.instagram_business_account?.id) {
    return Response.json(
      {
        error:
          "고른 페이스북 페이지에 브랜드 인스타그램 프로페셔널 계정이 연결돼 있지 않습니다. 인스타그램 계정이 연결된 페이지를 골라 주세요.",
      },
      { status: 400 },
    );
  }

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
    name:
      clean(draft.campaignName, 200) ||
      clean(`[PICKSfolio] ${source === "own" ? headline : draft.campaignTitle || "부스팅"} · ${startDate}`, 200),
    campaignName: clean(draft.campaignName, 200) || undefined,
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
    budgetType,
    bidStrategy,
    bidAmountKrw,
    optimizationGoal,
    conversionEvent,
    pixelId: /^\d+$/.test(clean(draft.pixelId, 30)) ? clean(draft.pixelId, 30) : undefined,
    gender: draft.gender === "male" || draft.gender === "female" ? draft.gender : "all",
    ageMin: Number(draft.ageMin) ? Math.max(18, Math.min(65, Math.floor(Number(draft.ageMin)))) : undefined,
    ageMax: Number(draft.ageMax) ? Math.max(18, Math.min(65, Math.floor(Number(draft.ageMax)))) : undefined,
    interests: targetList(draft.interests),
    audiences: targetList(draft.audiences),
    excludedAudiences: targetList(draft.excludedAudiences),
    advantageAudience: !!draft.advantageAudience,
    frequencyCap:
      freq && Number(freq.impressions) > 0 && Number(freq.days) > 0
        ? { impressions: Math.floor(Number(freq.impressions)), days: Math.floor(Number(freq.days)) }
        : null,
    urlTags: urlTags || undefined,
    adSetName: clean(draft.adSetName, 200) || undefined,
    adName: clean(draft.adName, 200) || undefined,
    displayLink: (linkUrl && clean(draft.displayLink, 200)) || undefined,
  };

  return record;
}

/**
 * 파트너십 광고 권한이 토큰에 있는지. 연동할 때 받은 권한(/me/permissions)으로 판단한다.
 * 권한 목록을 못 읽은 옛 진단이면 막지 않고 메타가 판단하게 둔다.
 */
function partnershipScopeError(granted: string[] | undefined): Response | null {
  if (!Array.isArray(granted) || granted.length === 0) return null;
  const missing = PARTNERSHIP_SCOPES.filter((s) => !granted.includes(s));
  if (missing.length === 0) return null;
  return Response.json(
    {
      error:
        `파트너십 광고 권한(${missing.join(", ")})이 연동에 없습니다. 광고 현황에서 메타 광고 계정을 다시 연동하고 ` +
        "동의 화면에서 해당 권한을 허용해 주세요.",
      missingScopes: missing,
    },
    { status: 403 },
  );
}

/** 메타 캠페인을 지운다. 이미 없으면 지운 것으로 본다. 실패하면 오류 응답을 돌려준다. */
async function deleteCampaign(token: string, proof: string, campaignId: string): Promise<Response | null> {
  const res = await graphPost(campaignId, token, { status: "DELETED" }, proof);
  if (res.ok || isMissingObject(res)) return null;
  return graphErrorResponse(res, "Meta에서 캠페인을 지우지 못했습니다.");
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
    const params = new URL(req.url).searchParams;
    const account = params.get("account") || "";
    const range = DATE_PRESETS.includes(params.get("range") || "") ? String(params.get("range")) : "maximum";
    const records = (await readAdRecords(username)).filter((r) => !account || r.adAccountId === account);
    const { ads, errors, deleted } = await liveStatus(token, proof, records, range);
    await removeAdRecords(username, deleted);
    return Response.json({ ads, errors, range, fetchedAt: new Date().toISOString(), source: "meta_graph_api" });
  }

  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await req.json().catch(() => ({}))) as any;
  const action = String(body?.action || "");

  if (action === "continue" || action === "status" || action === "resume" || action === "delete") {
    const record = (await readAdRecords(username)).find((r) => r.id === String(body?.id || ""));
    if (!record) return Response.json({ error: "광고 기록을 찾지 못했습니다." }, { status: 404 });
    const account = accounts.find((a) => a.id === record.adAccountId);

    if (action === "continue") {
      if (record.step === "done") return Response.json({ record });
      return advance(username, token, proof, record, account?.businessId || "");
    }

    if (action === "delete") {
      // 캠페인을 지우면 그 아래 광고 세트·광고도 메타가 같이 지운다. 이미 메타에서 지워진
      // 캠페인이면 그대로 기록만 지운다.
      if (body?.removeFromMeta !== false && record.campaignId) {
        const res = await deleteCampaign(token, proof, record.campaignId);
        if (res) return res;
      }
      await removeAdRecords(username, [record.id]);
      return Response.json({ ok: true });
    }

    if (action === "resume") {
      if (record.step === "done") return Response.json({ error: "이미 다 만들어진 광고입니다." }, { status: 400 });
      if (!account) return Response.json({ error: "이 광고의 광고 계정이 연동되어 있지 않습니다." }, { status: 400 });
      if (record.source === "partnership") {
        const denied = partnershipScopeError(diagnosis?.granted);
        if (denied) return denied;
      }
      // 소재의 출처(이력의 어느 게시물인지)는 기록에 있는 값을 그대로 잇는다. 고칠 수 있는
      // 것은 창에 보이는 설정(문구·페이지·예산·기간·타겟·노출 위치)뿐이다.
      const draft: Draft = {
        campaignTitle: record.campaignTitle,
        collabId: record.collabId,
        campaignRef: record.campaignRef,
        creatorHandle: record.creatorHandle,
        partnershipCode: record.partnershipCode,
        thumbnailUrl: record.thumbnailUrl,
        ...((body?.draft || {}) as Draft),
        source: record.source,
        adAccountId: record.adAccountId,
      };
      // 직접 올린 소재는 광고 계정에 이미 올라가 있다. 파일을 바꾸지 않았으면 그대로 쓴다.
      if (record.source === "own" && !draft.imageHash) {
        draft.imageHash = record.imageHash;
        draft.videoId = record.videoId;
        draft.creativeKind = record.creativeKind;
      }
      const built = await buildRecord(draft, account, token, proof);
      if (built instanceof Response) return built;
      // 멈춘 기록에 이미 만들어 둔 캠페인·세트는 옛 설정으로 만든 것이다. 고친 설정이
      // 빠짐없이 들어가도록 지우고 캠페인부터 다시 만든다 — 남겨 두면 광고 계정에 빈
      // 캠페인이 쌓인다.
      if (record.campaignId) {
        const res = await deleteCampaign(token, proof, record.campaignId);
        if (res) return res;
      }
      built.id = record.id;
      built.createdAt = record.createdAt;
      return advance(username, token, proof, built, account.businessId || "");
    }

    const status = String(body?.status || "");
    if (status !== "ACTIVE" && status !== "PAUSED") {
      return Response.json({ error: "status는 ACTIVE 또는 PAUSED여야 합니다." }, { status: 400 });
    }
    // 다시 켤 때는 셋 다 켠다 — 일시중지로 만든 광고는 캠페인·세트·광고가 모두 꺼져 있다.
    // 켤 때는 광고부터 위로, 끌 때는 캠페인부터 아래로 바꾼다. 중간에 실패해도 켜는 쪽은
    // 캠페인이 꺼진 채라 돈이 나가지 않고, 끄는 쪽은 첫 호출에서 이미 노출이 멈춘다.
    const chain = [record.campaignId, record.adSetId, record.adId].filter(Boolean) as string[];
    for (const id of status === "ACTIVE" ? chain.reverse() : chain) {
      const res = await graphPost(id, token, { status }, proof);
      if (res.ok) continue;
      // 광고 관리자에서 이미 지운 광고면 기록도 지우고 화면이 목록에서 빼게 한다.
      if (isMissingObject(res)) {
        await removeAdRecords(username, [record.id]);
        return Response.json({ error: "Meta 광고 관리자에서 삭제된 광고라 목록에서 뺐습니다.", removed: true }, { status: 410 });
      }
      return graphErrorResponse(res, "광고 상태를 바꾸지 못했습니다.");
    }
    return Response.json({ ok: true, status });
  }

  if (action !== "create") return Response.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });

  const draft = (body?.draft || {}) as Draft;
  const account = accounts.find((a) => a.id === draft.adAccountId);
  if (!account) return Response.json({ error: "연동된 광고 계정을 골라 주세요." }, { status: 400 });
  if (draft.source === "partnership") {
    const denied = partnershipScopeError(diagnosis?.granted);
    if (denied) return denied;
  }

  const record = await buildRecord(draft, account, token, proof);
  if (record instanceof Response) return record;
  return advance(username, token, proof, record, account.businessId || "");
};

export const config: Config = {
  path: "/api/meta-ads/ads/:username",
  method: ["GET", "POST"],
};
