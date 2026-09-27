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
  objective: "awareness" | "traffic" | "conversions";
  metaObjective?: string;
  /** 구매 전환 목적일 때 최적화에 쓰는 광고 계정의 픽셀. */
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

/** 노출 위치 → 인스타그램 게재 위치. '자동' 이면 아무것도 넘기지 않는다(Advantage+ 게재 위치). */
export function placementParams(mode: string, placements: string[]): Record<string, unknown> {
  if (mode !== "manual" || placements.length === 0) return {};
  const map: Record<string, string> = { feed: "stream", story: "story", reels: "reels", explore: "explore" };
  const positions = placements.map((p) => map[p]).filter(Boolean);
  return { publisher_platforms: ["instagram"], instagram_positions: positions };
}

/** 화면의 CTA 값 → 메타 call_to_action type. */
export const metaCta = (cta?: string): string =>
  (
    {
      learn_more: "LEARN_MORE",
      shop_now: "SHOP_NOW",
      sign_up: "SIGN_UP",
      book_now: "BOOK_NOW",
      contact_us: "CONTACT_US",
    } as Record<string, string>
  )[cta || ""] || "LEARN_MORE";

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
