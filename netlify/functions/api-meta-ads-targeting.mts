import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { readMetaAdsDiagnosis, readMetaAdsToken, tokenErrorResponse } from "./_shared/meta-ads.mts";
import { buildTargeting, graphErrorResponse, graphGet, graphPost, GOALS_BY_OBJECTIVE } from "./_shared/meta-ads-graph.mts";

/**
 * 광고 세트 설정을 고르는 데 필요한 메타 목록 — 광고 관리자의 타겟 · 데이터 세트 칸.
 *
 *   GET  /api/meta-ads/targeting/:username?kind=interests&q=…
 *        상세 타겟팅 검색(GET /search?type=adinterest). 한국어 이름으로 받는다.
 *   GET  /api/meta-ads/targeting/:username?kind=audiences&account=act_…
 *        광고 계정의 맞춤 타겟 · 유사 타겟(GET /act_…/customaudiences).
 *   GET  /api/meta-ads/targeting/:username?kind=pixels&account=act_…
 *        광고 계정의 픽셀(GET /act_…/adspixels).
 *   GET  /api/meta-ads/targeting/:username?kind=pixelStats&account=act_…&pixel=…&days=7
 *        픽셀이 받은 이벤트 수(GET /{pixel}/stats?aggregation=event) — 이벤트 관리자 개요의 숫자.
 *   POST /api/meta-ads/targeting/:username { action: 'createPixel', adAccountId, name }
 *        광고 계정에 새 픽셀(데이터 세트)을 만든다(POST /act_…/adspixels).
 *   POST /api/meta-ads/targeting/:username { action: 'estimate', adAccountId, draft }
 *        지금 타겟의 예상 규모(GET /act_…/delivery_estimate). 집행과 같은 targeting 을 쓴다.
 *
 * 광고 계정은 이 브랜드가 연동한 계정만 받는다 — 화면이 보낸 계정 ID 를 그대로 메타에
 * 넘기면 토큰 주인이 접근할 수 있는 다른 브랜드의 계정까지 읽힐 수 있다.
 */

const LOCALE = "ko_KR";

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
  const linked = new Set((diagnosis?.accounts || []).map((a) => a.id));
  const checkAccount = (id: string) =>
    linked.has(id) ? null : Response.json({ error: "연동된 광고 계정이 아닙니다." }, { status: 400 });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") || "";

    if (kind === "interests") {
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);
      if (!q) return Response.json({ interests: [] });
      const res = await graphGet("search", token, { type: "adinterest", q, limit: 20, locale: LOCALE }, proof);
      if (!res.ok) return graphErrorResponse(res, "관심사를 찾지 못했습니다.");
      const interests = (Array.isArray(res.data?.data) ? res.data.data : []).map((row: any) => ({
        id: String(row?.id || ""),
        name: String(row?.name || ""),
        path: Array.isArray(row?.path) ? row.path.slice(0, -1).join(" > ") : "",
        audienceSize: Number(row?.audience_size_upper_bound ?? row?.audience_size) || 0,
      }));
      return Response.json({ interests: interests.filter((i: any) => i.id && i.name) });
    }

    const account = String(url.searchParams.get("account") || "");
    const bad = checkAccount(account);
    if (bad) return bad;

    if (kind === "audiences") {
      const res = await graphGet(
        `${account}/customaudiences`,
        token,
        { fields: "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound", limit: 200 },
        proof,
      );
      if (!res.ok) return graphErrorResponse(res, "맞춤 타겟을 불러오지 못했습니다.");
      const audiences = (Array.isArray(res.data?.data) ? res.data.data : []).map((row: any) => ({
        id: String(row?.id || ""),
        name: String(row?.name || "이름 없는 타겟"),
        subtype: String(row?.subtype || ""),
        size: Number(row?.approximate_count_upper_bound ?? row?.approximate_count_lower_bound) || 0,
      }));
      return Response.json({ audiences });
    }

    if (kind === "pixels") {
      const res = await graphGet(`${account}/adspixels`, token, { fields: "id,name,last_fired_time", limit: 50 }, proof);
      if (!res.ok) return graphErrorResponse(res, "픽셀을 불러오지 못했습니다.");
      const pixels = (Array.isArray(res.data?.data) ? res.data.data : []).map((row: any) => ({
        id: String(row?.id || ""),
        name: String(row?.name || "픽셀"),
        lastFiredTime: String(row?.last_fired_time || ""),
      }));
      return Response.json({ pixels });
    }

    if (kind === "pixelStats") {
      /*
       * 픽셀이 웹사이트에서 받은 이벤트 수. 광고에서 온 것만이 아니라 사이트 전체 방문의
       * 이벤트다 — 광고로 생긴 전환은 광고 인사이트(actions)가 따로 센다. 둘을 나란히 두면
       * "사이트 전체 구매 중 광고가 만든 구매가 얼마인지"가 보인다.
       *
       * 이 계정의 픽셀인지 먼저 확인한다. 픽셀 ID 만 받아 그대로 물으면 토큰 주인이 접근할 수
       * 있는 다른 브랜드의 픽셀 통계까지 읽힌다.
       */
      const pixel = String(url.searchParams.get("pixel") || "");
      if (!/^\d+$/.test(pixel)) return Response.json({ error: "픽셀을 골라 주세요." }, { status: 400 });
      const owned = await graphGet(`${account}/adspixels`, token, { fields: "id,name,last_fired_time,is_unavailable", limit: 100 }, proof);
      if (!owned.ok) return graphErrorResponse(owned, "픽셀을 불러오지 못했습니다.");
      const info = (Array.isArray(owned.data?.data) ? owned.data.data : []).find((row: any) => String(row?.id) === pixel);
      if (!info) return Response.json({ error: "이 광고 계정의 픽셀이 아닙니다." }, { status: 400 });

      const days = [1, 7, 28].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 7;
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const counts: Record<string, number> = {};
      // 시간 단위 묶음으로 오므로 쪽을 넘기며 더한다. 끝없이 돌지 않게 쪽 수를 묶어 둔다.
      let after = "";
      for (let page = 0; page < 20; page += 1) {
        const res = await graphGet(
          `${pixel}/stats`,
          token,
          { aggregation: "event", start_time: since, limit: 100, ...(after ? { after } : {}) },
          proof,
        );
        if (!res.ok) return graphErrorResponse(res, "픽셀 이벤트를 불러오지 못했습니다.");
        for (const bucket of Array.isArray(res.data?.data) ? res.data.data : []) {
          for (const row of Array.isArray(bucket?.data) ? bucket.data : []) {
            const name = String(row?.value || "");
            if (name) counts[name] = (counts[name] || 0) + (Number(row?.count) || 0);
          }
        }
        after = String(res.data?.paging?.cursors?.after || "");
        if (!after || !res.data?.paging?.next) break;
      }
      const events = Object.entries(counts)
        .map(([event, count]) => ({ event, count }))
        .sort((a, b) => b.count - a.count);
      return Response.json({
        pixel: {
          id: pixel,
          name: String(info?.name || "픽셀"),
          lastFiredTime: String(info?.last_fired_time || ""),
          unavailable: !!info?.is_unavailable,
        },
        days,
        events,
      });
    }

    return Response.json({ error: "지원하지 않는 조회입니다." }, { status: 400 });
  }

  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const body = (await req.json().catch(() => ({}))) as any;
  if (body?.action !== "estimate" && body?.action !== "createPixel") {
    return Response.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });
  }
  const account = String(body?.adAccountId || "");
  const bad = checkAccount(account);
  if (bad) return bad;

  if (body.action === "createPixel") {
    const name = String(body?.name || "").trim().slice(0, 100) || `${username} 픽셀`;
    const res = await graphPost(`${account}/adspixels`, token, { name }, proof);
    if (!res.ok) return graphErrorResponse(res, "픽셀을 만들지 못했습니다.");
    const id = String((res.data as any)?.id || "");
    if (!id) return Response.json({ error: "픽셀을 만들지 못했습니다." }, { status: 502 });
    return Response.json({ pixel: { id, name, lastFiredTime: "" } });
  }

  const draft = (body?.draft || {}) as any;
  const { targeting } = await buildTargeting(token, proof, {
    regions: Array.isArray(draft.regions) ? draft.regions.map(String).slice(0, 10) : [],
    ageBands: [],
    ageMin: Number(draft.ageMin) || undefined,
    ageMax: Number(draft.ageMax) || undefined,
    gender: draft.gender,
    interests: draft.interests,
    audiences: draft.audiences,
    excludedAudiences: draft.excludedAudiences,
    advantageAudience: !!draft.advantageAudience,
    placementMode: draft.placementMode === "manual" ? "manual" : "auto",
    placements: Array.isArray(draft.placements) ? draft.placements.map(String).slice(0, 10) : [],
  });
  const allGoals = Object.values(GOALS_BY_OBJECTIVE).flat();
  const goal = allGoals.includes(String(draft.optimizationGoal || "")) ? String(draft.optimizationGoal) : "REACH";
  // 픽셀이 필요한 목표는 추정에 promoted_object 가 있어야 한다. 규모만 보려는 것이라
  // 그런 목표는 같은 타겟의 링크 클릭으로 묻는다.
  const estimateGoal = ["OFFSITE_CONVERSIONS", "VALUE", "LANDING_PAGE_VIEWS"].includes(goal) ? "LINK_CLICKS" : goal;

  const res = await graphGet(
    `${account}/delivery_estimate`,
    token,
    { targeting_spec: targeting, optimization_goal: estimateGoal },
    proof,
  );
  if (!res.ok) return graphErrorResponse(res, "타겟 규모를 계산하지 못했습니다.");
  const row = Array.isArray(res.data?.data) ? res.data.data[0] || {} : {};
  return Response.json({
    lower: Number(row?.estimate_mau_lower_bound) || 0,
    upper: Number(row?.estimate_mau_upper_bound) || 0,
  });
};

export const config: Config = {
  path: "/api/meta-ads/targeting/:username",
  method: ["GET", "POST"],
};
