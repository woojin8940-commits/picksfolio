import { getStore } from "@netlify/blobs";
import { appSecretProof, GRAPH_VERSION, metaAdsAppSecret } from "./meta-ads.mts";

/**
 * 메타 그래프 호출과 광고 집행 기록.
 *
 * 광고 현황·집행하기·페이지 조회가 모두 같은 규칙으로 그래프를 부른다: appsecret_proof 를
 * 붙이고, 실패를 던지지 않고 메타가 준 오류 문장 그대로 담아 돌려준다. 화면이 "왜 막혔는지"
 * 를 메타의 표현 그대로 보여 줘야 브랜드가 광고 관리자에서 같은 문제를 찾을 수 있다.
 */

export interface GraphResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
  /** 메타 오류 문장. 사람에게 보여 줄 수 있는 문장(error_user_msg)을 먼저 쓴다. */
  error?: string;
  errorCode?: number;
  errorSubcode?: number;
}

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** 객체·배열 파라미터는 메타가 받는 모양(JSON 문자열)으로 바꾼다. */
const toParam = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

const readResult = async (res: Response): Promise<GraphResult> => {
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data?.error) {
    const err = data?.error || {};
    return {
      ok: false,
      status: res.status,
      data,
      error: String(err.error_user_msg || err.message || `HTTP ${res.status}`),
      errorCode: Number(err.code) || undefined,
      errorSubcode: Number(err.error_subcode) || undefined,
    };
  }
  return { ok: true, status: res.status, data };
};

const failed = (e: unknown): GraphResult => ({
  ok: false,
  status: 0,
  data: {},
  error: (e as Error)?.message || "요청 실패",
});

/**
 * 그래프 호출. proof 를 넘기지 않으면 토큰으로 직접 만든다(페이지 토큰처럼 저장해 두지
 * 않은 토큰을 쓸 때).
 */
export async function graphGet<T = any>(
  path: string,
  token: string,
  params: Record<string, unknown> = {},
  proof?: string,
): Promise<GraphResult<T>> {
  const query = new URLSearchParams({ access_token: token });
  query.set("appsecret_proof", proof || appSecretProof(token, metaAdsAppSecret()));
  for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, toParam(v));
  try {
    return await readResult(await fetch(`${GRAPH}/${path}?${query.toString()}`));
  } catch (e) {
    return failed(e);
  }
}

export async function graphPost<T = any>(
  path: string,
  token: string,
  params: Record<string, unknown> = {},
  proof?: string,
): Promise<GraphResult<T>> {
  const body = new URLSearchParams({ access_token: token });
  body.set("appsecret_proof", proof || appSecretProof(token, metaAdsAppSecret()));
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, toParam(v));
  try {
    return await readResult(await fetch(`${GRAPH}/${path}`, { method: "POST", body }));
  } catch (e) {
    return failed(e);
  }
}

/** 파일 조각처럼 multipart 로만 보낼 수 있는 호출(advideos transfer). */
export async function graphPostForm<T = any>(
  path: string,
  token: string,
  form: FormData,
  proof?: string,
): Promise<GraphResult<T>> {
  form.set("access_token", token);
  form.set("appsecret_proof", proof || appSecretProof(token, metaAdsAppSecret()));
  try {
    return await readResult(await fetch(`${GRAPH}/${path}`, { method: "POST", body: form }));
  } catch (e) {
    return failed(e);
  }
}

/** 오류를 화면에 그대로 옮길 응답. 메타 오류 코드도 같이 준다(권한 부족 = 200/10). */
export const graphErrorResponse = (res: GraphResult, fallback: string, status = 502): Response =>
  Response.json(
    {
      error: res.error || fallback,
      metaErrorCode: res.errorCode,
      metaErrorSubcode: res.errorSubcode,
    },
    { status },
  );

/* ------------------------------------------------------------------------------------------ */
/* 광고 집행 기록                                                                              */
/* ------------------------------------------------------------------------------------------ */

/**
 * '집행하기' 한 번이 만든 메타 객체들의 기록.
 *
 * 메타에 만든 광고는 메타에만 있어도 되지만, 어떤 광고가 픽스폴리오에서 만든 것인지(어느
 * 캠페인 이력의 어느 게시물인지, 어떤 소재 썸네일인지)는 메타가 모른다. 그래서 만든 객체의
 * ID 와 픽스폴리오 쪽 맥락만 여기 남기고, 상태·지표는 볼 때마다 메타에서 새로 읽는다 —
 * 상태를 여기 복사해 두면 메타에서 반려된 광고가 이 화면에서는 계속 '검수 중' 으로 남는다.
 *
 * 한 번에 다 만들지 않고 단계(캠페인 → 광고 세트 → 소재 → 광고)마다 저장한다. 중간에
 * 실패하면 그 단계부터 다시 시도할 수 있어야 하고, 이미 만든 캠페인을 또 만들면 광고
 * 계정에 빈 캠페인이 쌓인다.
 */
export type MetaAdStep = "campaign" | "adset" | "creative" | "ad" | "done";

export interface MetaAdRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: "partnership" | "own";
  adAccountId: string;
  currency: string;
  /** 다음에 할 단계. 'done' 이면 광고까지 만들어졌다. */
  step: MetaAdStep;
  /** 마지막 단계에서 난 오류(메타 문장 그대로). 다시 시도하면 지운다. */
  error?: string;
  errorCode?: number;
  /** 메타가 받지 않아 다르게 처리한 것(예: 픽셀이 없어 트래픽 목적으로 집행). */
  warnings: string[];

  campaignId?: string;
  adSetId?: string;
  creativeId?: string;
  adId?: string;

  /** 처음 만들 때의 상태. PAUSED 면 광고가 만들어져도 노출·과금이 시작되지 않는다. */
  initialStatus: "ACTIVE" | "PAUSED";
  objective: "awareness" | "traffic" | "conversions" | "engagement";
  metaObjective?: string;
  /**
   * 이 광고에 연결한 광고 계정의 픽셀(데이터 세트).
   *
   * 판매 목적에서는 최적화 대상(promoted_object)이고, 어느 목적이든 광고의 tracking_specs
   * 로 붙어 웹사이트 이벤트를 이 광고의 성과로 센다 — 광고 관리자의 '추적 › 웹사이트 이벤트'.
   */
  pixelId?: string;
  name: string;
  headline?: string;
  bodyText?: string;
  cta?: string;
  linkUrl?: string;
  pageId: string;
  pageName?: string;
  instagramUserId?: string;
  imageHash?: string;
  videoId?: string;
  thumbnailUrl?: string;
  creativeKind?: "image" | "video";

  campaignTitle?: string;
  collabId?: string;
  campaignRef?: string;
  creatorHandle?: string;
  partnershipCode?: string;

  budgetKrw: number;
  startDate: string;
  endDate: string;
  ageBands: string[];
  regions: string[];
  placementMode: "auto" | "manual";
  placements: string[];

  /*
   * 광고 관리자와 같은 세부 설정. 예전 기록에는 없다 — 없으면 예전과 같은 기본값
   * (총 예산 · 최고 볼륨 · 성별 전체 · 목표의 기본 성과 목표)으로 만든다.
   */
  budgetType?: "daily" | "lifetime";
  bidStrategy?: "lowest_cost" | "cost_cap" | "bid_cap";
  bidAmountKrw?: number;
  optimizationGoal?: string;
  conversionEvent?: string;
  gender?: "all" | "male" | "female";
  ageMin?: number;
  ageMax?: number;
  interests?: { id: string; name: string }[];
  audiences?: { id: string; name: string }[];
  excludedAudiences?: { id: string; name: string }[];
  advantageAudience?: boolean;
  frequencyCap?: { impressions: number; days: number } | null;
  urlTags?: string;
  campaignName?: string;
  /** 광고 관리자의 광고 세트 이름 · 광고 이름. 비어 있으면 캠페인 이름에서 만든다. */
  adSetName?: string;
  adName?: string;
  /** 표시 링크 — 버튼 옆에 보이는 주소(link_caption). 실제로 이동하는 주소는 linkUrl 이다. */
  displayLink?: string;
}

const RECORD_STORE = "meta-ads";
const recordsKey = (username: string) => `ads_list_${username.replace(/^biz\//, "").toLowerCase()}`;
const store = () => getStore({ name: RECORD_STORE, consistency: "strong" });

/** 한 계정이 쌓는 기록은 많지 않다. 그래도 끝없이 자라지 않게 최근 것만 남긴다. */
const MAX_RECORDS = 200;

export async function readAdRecords(username: string): Promise<MetaAdRecord[]> {
  try {
    const found = (await store().get(recordsKey(username), { type: "json" })) as MetaAdRecord[] | null;
    return Array.isArray(found) ? found : [];
  } catch (e) {
    console.warn("[meta-ads] records read failed:", (e as Error)?.message);
    return [];
  }
}

export async function saveAdRecord(username: string, record: MetaAdRecord): Promise<void> {
  const list = await readAdRecords(username);
  const next = [record, ...list.filter((r) => r.id !== record.id)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_RECORDS);
  await store().setJSON(recordsKey(username), next);
}

/** 광고 기록이 있는 계정들(아이디). 주기 작업이 계정마다 광고 상태를 확인할 때 쓴다. */
export async function listAdRecordOwners(): Promise<string[]> {
  const { blobs } = await store().list({ prefix: "ads_list_" });
  return blobs.map((b) => b.key.slice("ads_list_".length)).filter(Boolean);
}

/**
 * 반려 알림을 이미 보낸 광고(광고 ID → 알린 시각). 광고 기록과 다른 키에 둔다 — 주기
 * 작업이 기록 목록을 통째로 다시 쓰면 그 사이 브랜드가 만든 광고 기록을 덮어쓸 수 있다.
 */
const rejectionKey = (username: string) => `ads_rejected_${username.replace(/^biz\//, "").toLowerCase()}`;

export async function readRejectionNotices(username: string): Promise<Record<string, string>> {
  try {
    const found = (await store().get(rejectionKey(username), { type: "json" })) as Record<string, string> | null;
    return found && typeof found === "object" ? found : {};
  } catch {
    return {};
  }
}

export async function writeRejectionNotices(username: string, notices: Record<string, string>): Promise<void> {
  await store().setJSON(rejectionKey(username), notices);
}

/** 기록을 목록에서 뺀다(삭제했거나 메타에서 지워진 광고). */
export async function removeAdRecords(username: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  const list = await readAdRecords(username);
  const next = list.filter((r) => !drop.has(r.id));
  if (next.length === list.length) return;
  await store().setJSON(recordsKey(username), next);
}

/**
 * 메타에 그 객체가 더는 없다는 오류인지(광고 관리자에서 지웠거나 오래돼 사라진 것).
 * 권한 오류(10/200)와 섞이면 멀쩡한 광고 기록을 지우게 되므로 '없음' 만 골라낸다.
 * ids= 로 여러 개를 한 번에 읽을 때 하나라도 없으면 메타는 100 이 아니라 803("Some of
 * the aliases you requested do not exist")으로 돌려준다 — 이것도 '없음' 으로 본다.
 */
export const isMissingObject = (res: GraphResult): boolean =>
  !res.ok &&
  (res.errorCode === 803 ||
    (res.errorCode === 100 && (res.errorSubcode === 33 || /does not exist|do not exist/i.test(res.error || ""))));

/* ------------------------------------------------------------------------------------------ */
/* 집행 조건 → 메타 파라미터                                                                   */
/* ------------------------------------------------------------------------------------------ */

/**
 * 통화별 최소 단위. 메타는 예산을 "통화의 최소 단위"로 받는다 — 원화는 1원이 최소
 * 단위라 그대로, 달러는 센트라 100을 곱한다. 입력한 숫자는 광고 계정 통화 기준이다.
 */
const ZERO_DECIMAL = new Set(["KRW", "JPY", "CLP", "COP", "CRC", "HUF", "ISK", "IDR", "PYG", "TWD", "VND"]);
export const toMinorUnits = (amount: number, currency: string): number =>
  Math.round(amount * (ZERO_DECIMAL.has((currency || "KRW").toUpperCase()) ? 1 : 100));

/** 연령 구간 → age_min / age_max. 붙어 있지 않은 구간을 고르면 전체 범위로 묶는다. */
export function ageRange(bands: string[]): { age_min: number; age_max: number } {
  const ranges: Record<string, [number, number]> = {
    "20대": [20, 29],
    "30대": [30, 39],
    "40대": [40, 49],
    "50대 이상": [50, 65],
  };
  const picked = bands.map((b) => ranges[b]).filter(Boolean);
  if (picked.length === 0) return { age_min: 18, age_max: 65 };
  return {
    age_min: Math.min(...picked.map((r) => r[0])),
    age_max: Math.max(...picked.map((r) => r[1])),
  };
}

/** 화면의 권역 → 메타 지역 검색어(시·도 영문명). */
const REGION_QUERIES: Record<string, string[]> = {
  서울: ["Seoul"],
  "경기·인천": ["Gyeonggi", "Incheon"],
  "부산·경남": ["Busan", "South Gyeongsang"],
  "대구·경북": ["Daegu", "North Gyeongsang"],
  "대전·충청": ["Daejeon", "Sejong", "North Chungcheong", "South Chungcheong"],
  "광주·전라": ["Gwangju", "North Jeolla", "South Jeolla"],
  강원: ["Gangwon"],
  제주: ["Jeju"],
};

/**
 * 권역을 메타의 지역 키로 바꾼다(GET /search?type=adgeolocation).
 *
 * 지역 키는 메타가 정하는 숫자라 코드에 박아 두지 않고 매번 찾는다. 찾지 못한 지역이
 * 있으면 그 지역만 빼는 대신 한국 전체로 넓힌다 — 일부 지역만 빠진 타겟은 브랜드가
 * 고른 것과 다른 사람에게 광고가 나가는데, 화면에서는 그 차이가 보이지 않는다.
 */
export async function resolveGeo(
  token: string,
  proof: string,
  regions: string[],
): Promise<{ geo: Record<string, unknown>; warning?: string }> {
  const queries = regions.flatMap((r) => REGION_QUERIES[r] || []);
  if (queries.length === 0) return { geo: { countries: ["KR"] } };
  const found = await Promise.all(
    queries.map(async (q) => {
      const res = await graphGet(
        "search",
        token,
        { type: "adgeolocation", location_types: ["region"], country_code: "KR", q, limit: 3 },
        proof,
      );
      const hit = (Array.isArray(res.data?.data) ? res.data.data : []).find(
        (row: any) => row?.country_code === "KR" && row?.type === "region" && row?.key,
      );
      return hit ? String(hit.key) : "";
    }),
  );
  if (found.some((key) => !key)) {
    return {
      geo: { countries: ["KR"] },
      warning: "일부 지역을 Meta 지역 목록에서 찾지 못해 대한민국 전체로 집행합니다.",
    };
  }
  return { geo: { regions: [...new Set(found)].map((key) => ({ key })) } };
}

/**
 * 노출 위치 → 메타 게재 위치. '자동' 이면 아무것도 넘기지 않는다(Advantage+ 게재 위치).
 * 예전 값(feed · story · reels · explore)은 인스타그램 위치 그대로다.
 */
export function placementParams(mode: string, placements: string[]): Record<string, unknown> {
  if (mode !== "manual" || placements.length === 0) return {};
  const ig: Record<string, string> = {
    feed: "stream",
    ig_profile_feed: "profile_feed",
    story: "story",
    reels: "reels",
    explore: "explore",
  };
  const fb: Record<string, string> = { fb_feed: "feed", fb_story: "story", fb_reels: "facebook_reels" };
  const instagram_positions = placements.map((p) => ig[p]).filter(Boolean);
  const facebook_positions = placements.map((p) => fb[p]).filter(Boolean);
  const publisher_platforms = [
    ...(instagram_positions.length ? ["instagram"] : []),
    ...(facebook_positions.length ? ["facebook"] : []),
  ];
  if (publisher_platforms.length === 0) return {};
  return {
    publisher_platforms,
    ...(instagram_positions.length ? { instagram_positions } : {}),
    ...(facebook_positions.length ? { facebook_positions } : {}),
  };
}

const ids = (list?: { id: string }[]) =>
  (Array.isArray(list) ? list : []).map((x) => String(x?.id || "")).filter((id) => /^\d+$/.test(id));

/**
 * 광고 세트의 targeting 한 덩어리. 집행과 '예상 타겟 규모' 가 같은 값을 쓴다 — 둘이
 * 다르면 화면에 보인 규모와 실제로 나간 광고의 타겟이 어긋난다.
 *
 * Advantage+ 타겟을 켜면 메타 규칙상 연령 상한은 65 로 두고(하한은 25 까지만 제한으로
 * 쓸 수 있다) 고른 연령은 age_range 제안으로 넘긴다. 성별 · 관심사도 제안이 되므로
 * 성별은 보내지 않는다. 지역과 제외 타겟은 그대로 지킨다.
 */
export async function buildTargeting(
  token: string,
  proof: string,
  r: Pick<
    MetaAdRecord,
    | "adAccountId"
    | "regions"
    | "ageBands"
    | "ageMin"
    | "ageMax"
    | "gender"
    | "interests"
    | "audiences"
    | "excludedAudiences"
    | "advantageAudience"
    | "placementMode"
    | "placements"
  >,
): Promise<{ targeting: Record<string, unknown>; warning?: string; error?: string }> {
  const { geo, warning: geoWarning } = await resolveGeo(token, proof, r.regions || []);
  const warnings = geoWarning ? [geoWarning] : [];
  const legacy = ageRange(r.ageBands || []);
  const ageMin = Math.max(18, Math.min(65, Number(r.ageMin) || legacy.age_min));
  const ageMax = Math.max(ageMin, Math.min(65, Number(r.ageMax) || legacy.age_max));
  const advantage = !!r.advantageAudience;

  const targeting: Record<string, unknown> = {
    geo_locations: geo,
    ...placementParams(r.placementMode, r.placements || []),
    targeting_automation: { advantage_audience: advantage ? 1 : 0 },
  };
  if (advantage) {
    targeting.age_min = Math.min(ageMin, 25);
    targeting.age_max = 65;
    if (ageMin !== 18 || ageMax !== 65) targeting.age_range = [ageMin, ageMax];
  } else {
    targeting.age_min = ageMin;
    targeting.age_max = ageMax;
    if (r.gender === "male") targeting.genders = [1];
    if (r.gender === "female") targeting.genders = [2];
  }
  const interests = ids(r.interests);
  if (interests.length) targeting.flexible_spec = [{ interests: interests.map((id) => ({ id })) }];
  let include = ids(r.audiences);
  let exclude = ids(r.excludedAudiences);
  // 맞춤 · 유사 타겟 ID 는 화면이 보낸 값이라, 이 광고 계정 것인지 서버에서 다시 확인한다.
  // 한 메타 로그인(비즈니스 매니저)이 여러 브랜드의 계정을 다루면 토큰으로는 남의 계정
  // 오디언스도 보이므로, 확인 없이 넘기면 다른 브랜드의 고객 리스트로 타겟팅될 수 있다.
  // 픽셀 확인(accountPixelIds)과 달리 조회에 실패하면 화면 값을 믿지 않고 멈춘다 —
  // 빼고 만들면 타겟이 의도보다 넓어지고, 믿고 만들면 검증을 건너뛰게 된다.
  if (include.length || exclude.length) {
    let owned = await accountAudienceIds(r.adAccountId, token, proof);
    if (owned === null) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      owned = await accountAudienceIds(r.adAccountId, token, proof);
    }
    if (owned === null) {
      return {
        targeting,
        warning: warnings.join(" ") || undefined,
        error: "메타에서 이 광고 계정의 맞춤 타겟 목록을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      };
    }
    const set = new Set(owned);
    const foreign = [...include, ...exclude].filter((id) => !set.has(id));
    if (foreign.length) {
      include = include.filter((id) => set.has(id));
      exclude = exclude.filter((id) => set.has(id));
      warnings.push(`이 광고 계정에 없는 맞춤 타겟 ${foreign.length}개를 빼고 만듭니다.`);
    }
  }
  if (include.length) targeting.custom_audiences = include.map((id) => ({ id }));
  if (exclude.length) targeting.excluded_custom_audiences = exclude.map((id) => ({ id }));
  return { targeting, warning: warnings.join(" ") || undefined };
}

/** 캠페인 목표별로 고를 수 있는 성과 목표. 맨 앞이 기본값이다(화면의 PERFORMANCE_GOALS 와 같다). */
export const GOALS_BY_OBJECTIVE: Record<string, string[]> = {
  conversions: ["OFFSITE_CONVERSIONS", "VALUE", "LANDING_PAGE_VIEWS", "LINK_CLICKS"],
  traffic: ["LINK_CLICKS", "LANDING_PAGE_VIEWS", "REACH"],
  engagement: ["POST_ENGAGEMENT", "THRUPLAY", "REACH"],
  awareness: ["REACH", "IMPRESSIONS", "AD_RECALL_LIFT"],
};

export const CONVERSION_EVENTS = [
  "PURCHASE",
  "ADD_TO_CART",
  "INITIATED_CHECKOUT",
  "ADD_PAYMENT_INFO",
  "COMPLETE_REGISTRATION",
  "LEAD",
  "CONTENT_VIEW",
];

/** 화면의 CTA 값 → 메타 call_to_action type. */
const META_CTAS = new Set([
  "LEARN_MORE",
  "SHOP_NOW",
  "SIGN_UP",
  "BOOK_NOW",
  "CONTACT_US",
  "ORDER_NOW",
  "BUY_NOW",
  "GET_OFFER",
  "APPLY_NOW",
  "SUBSCRIBE",
  "DOWNLOAD",
  "GET_QUOTE",
  "SEE_MENU",
  "WATCH_MORE",
  "BUY_TICKETS",
  "REQUEST_TIME",
  "GET_SHOWTIMES",
  "LISTEN_NOW",
  "DONATE_NOW",
  "INQUIRE_NOW",
]);

/** 화면의 CTA 값(shop_now) → 메타의 call_to_action.type(SHOP_NOW). 모르는 값은 '더 알아보기'. */
export const metaCta = (cta?: string): string => {
  const type = String(cta || "").toUpperCase();
  return META_CTAS.has(type) ? type : "LEARN_MORE";
};

/** 서울 기준 날짜 → 메타가 받는 시각. 시작일이 오늘이면 지금으로 둔다(과거 시각은 거절된다). */
export function scheduleTimes(startDate: string, endDate: string): { start_time?: string; end_time: string } {
  const start = `${startDate}T00:00:00+0900`;
  const startsInPast = Date.parse(start) <= Date.now() + 60_000;
  return {
    start_time: startsInPast ? undefined : start,
    end_time: `${endDate}T23:59:59+0900`,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* 메타 상태 → 화면 상태                                                                       */
/* ------------------------------------------------------------------------------------------ */

export type AdDisplayStatus = "draft" | "review" | "active" | "paused" | "rejected" | "issue" | "ended";

/**
 * 광고의 effective_status 를 화면 상태로 옮긴다. 원문도 같이 화면에 적는다 — 메타 광고
 * 관리자에서 같은 광고를 찾았을 때 같은 말이 보여야 한다.
 */
export function displayStatus(effective: string, endTime?: string): AdDisplayStatus {
  switch (effective) {
    case "ACTIVE":
      return endTime && Date.parse(endTime) < Date.now() ? "ended" : "active";
    case "PENDING_REVIEW":
    case "IN_PROCESS":
    case "PREAPPROVED":
      return "review";
    case "PAUSED":
    case "CAMPAIGN_PAUSED":
    case "ADSET_PAUSED":
      return "paused";
    case "DISAPPROVED":
      return "rejected";
    case "WITH_ISSUES":
    case "PENDING_BILLING_INFO":
      return "issue";
    case "ARCHIVED":
    case "DELETED":
      return "ended";
    default:
      return "review";
  }
}

/** 인사이트 actions 에서 구매 전환 수·가치를 꺼낸다. */
const PURCHASE_TYPES = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];
export function purchaseMetrics(insight: any): { conversions: number; conversionValue: number } {
  const pick = (rows: any[]) => {
    for (const type of PURCHASE_TYPES) {
      const row = rows.find((r) => r?.action_type === type);
      if (row) return Number(row.value) || 0;
    }
    return 0;
  };
  return {
    conversions: pick(Array.isArray(insight?.actions) ? insight.actions : []),
    conversionValue: pick(Array.isArray(insight?.action_values) ? insight.action_values : []),
  };
}

/**
 * 인사이트 actions 의 이벤트를 광고 관리자 열 이름 단위로 묶는다.
 *
 * 같은 이벤트가 여러 이름으로 온다(픽셀 전용 `offsite_conversion.fb_pixel_purchase`, 통합
 * `omni_purchase`, 요약 `purchase`). 셋을 더하면 같은 구매가 두세 번 세어지므로, 광고 관리자처럼
 * 앞에 둔 이름 하나만 고른다 — 앞의 것이 있으면 뒤의 것은 보지 않는다.
 *
 * 키는 화면의 전환 이벤트 값(CONVERSION_EVENTS)과 성과 목표에서 쓰는 이름에 맞춘다.
 */
const EVENT_ACTION_TYPES: Record<string, string[]> = {
  PURCHASE: PURCHASE_TYPES,
  ADD_TO_CART: ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "omni_add_to_cart"],
  INITIATED_CHECKOUT: ["initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout", "omni_initiated_checkout"],
  ADD_PAYMENT_INFO: ["add_payment_info", "offsite_conversion.fb_pixel_add_payment_info"],
  COMPLETE_REGISTRATION: [
    "complete_registration",
    "offsite_conversion.fb_pixel_complete_registration",
    "omni_complete_registration",
  ],
  LEAD: ["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped"],
  CONTENT_VIEW: ["view_content", "offsite_conversion.fb_pixel_view_content", "omni_view_content"],
  SEARCH: ["search", "offsite_conversion.fb_pixel_search", "omni_search"],
  LANDING_PAGE_VIEW: ["landing_page_view", "omni_landing_page_view"],
  LINK_CLICK: ["link_click"],
  POST_ENGAGEMENT: ["post_engagement"],
  VIDEO_VIEW: ["video_view"],
};

/** 이벤트별 횟수와 가치(구매 · 장바구니 · 결제 시작에만 금액이 실린다). */
export function eventMetrics(insight: any): { events: Record<string, number>; eventValues: Record<string, number> } {
  const pick = (rows: any[], types: string[]) => {
    for (const type of types) {
      const row = rows.find((r) => r?.action_type === type);
      if (row) return Number(row.value) || 0;
    }
    return 0;
  };
  const actions = Array.isArray(insight?.actions) ? insight.actions : [];
  const values = Array.isArray(insight?.action_values) ? insight.action_values : [];
  const events: Record<string, number> = {};
  const eventValues: Record<string, number> = {};
  for (const [key, types] of Object.entries(EVENT_ACTION_TYPES)) {
    const count = pick(actions, types);
    if (count) events[key] = count;
    const value = pick(values, types);
    if (value) eventValues[key] = value;
  }
  // ThruPlay 는 actions 가 아니라 따로 온다(video_thruplay_watched_actions).
  const thru = Array.isArray(insight?.video_thruplay_watched_actions) ? insight.video_thruplay_watched_actions : [];
  const thruplays = pick(thru, ["video_view"]);
  if (thruplays) events.THRUPLAY = thruplays;
  return { events, eventValues };
}

/** 광고 계정에 실제로 있는 픽셀 ID 들. 화면이 보낸 픽셀이 이 계정 것인지 확인할 때 쓴다. */
export async function accountPixelIds(adAccountId: string, token: string, proof: string): Promise<string[] | null> {
  const res = await graphGet(`${adAccountId}/adspixels`, token, { fields: "id", limit: 100 }, proof);
  if (!res.ok) return null;
  return Array.isArray(res.data?.data) ? res.data.data.map((p: any) => String(p?.id || "")).filter(Boolean) : [];
}

/**
 * 광고 계정에 실제로 있는 맞춤 · 유사 타겟 ID 들. 화면이 보낸 오디언스가 이 계정 것인지
 * 확인할 때 쓴다(buildTargeting). null 은 "없음"이 아니라 "목록 조회 실패"다.
 */
export async function accountAudienceIds(adAccountId: string, token: string, proof: string): Promise<string[] | null> {
  if (!adAccountId) return null;
  const found: string[] = [];
  let after = "";
  // 계정마다 수백 개를 넘는 경우가 드물어 몇 쪽이면 충분하다. 끝없이 따라가지 않는다.
  for (let page = 0; page < 10; page++) {
    const res = await graphGet(
      `${adAccountId}/customaudiences`,
      token,
      { fields: "id", limit: 500, ...(after ? { after } : {}) },
      proof,
    );
    if (!res.ok) return null;
    const rows = Array.isArray(res.data?.data) ? res.data.data : [];
    for (const row of rows) {
      const id = String(row?.id || "");
      if (id) found.push(id);
    }
    after = String(res.data?.paging?.cursors?.after || "");
    if (!res.data?.paging?.next || !after) break;
  }
  return found;
}
