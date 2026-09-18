import { createHmac } from "node:crypto";
import { getStore } from "@netlify/blobs";

/**
 * 메타 광고 계정 연동 — 앱 설정과 진단 결과 보관함.
 *
 * 광고 화면의 연동은 인스타그램 연동(`instagram-oauth-*`)과 **다른 앱·다른 로그인**을
 * 쓴다. 그쪽은 "Instagram API with Instagram Login" 이라 instagram.com 에서 동의를
 * 받고 graph.instagram.com 으로 호출하지만, 광고 권한(ads_management · ads_read ·
 * business_management)은 페이스북 로그인에서만 받을 수 있어 facebook.com 의 로그인
 * 대화상자와 graph.facebook.com 을 쓴다. 그래서 앱 ID·시크릿도 별도다 — 두 흐름을
 * 한 모듈에 섞으면 어느 토큰이 어느 그래프에서 유효한지가 호출부마다 갈린다.
 *
 * 토큰은 저장하지 않는다. 광고 권한은 아직 심사 전이고, 지금 연동의 목적은 "이 계정으로
 * 무엇이 보이는가"를 확인하는 것(진단)까지다. 심사가 끝나기 전에 장기 토큰을 들고 있으면
 * 쓰지도 않는 값을 만료·폐기까지 관리해야 하고, 유출 시 피해는 광고 집행 권한이다.
 * 그래서 콜백은 토큰을 그 요청 안에서만 쓰고 버리고, 남기는 것은 진단 결과뿐이다.
 */

/** 그래프 API 버전. 다른 함수들과 같은 버전으로 맞춘다. */
export const GRAPH_VERSION = "v21.0";

/**
 * 동의 화면에서 요청할 권한.
 *
 * 세 개 모두 심사 대상이고, 하나라도 빼면 그 권한이 동의 화면에 나오지 않아 진단에서
 * "요청했는데 거부됨"과 "애초에 요청하지 않음"을 구별할 수 없게 된다.
 *
 *   ads_management       광고 생성·집행
 *   ads_read             광고 지표 조회
 *   business_management  광고 계정·비즈니스 자산 접근
 *
 * 인스타그램 인사이트(instagram_manage_insights)는 여기 넣지 않는다. 그 권한은 이미
 * 인스타그램 연동에서 받고 있고, 이 대화상자에 얹으면 페이스북 페이지 연결까지 요구해
 * 광고 계정만 붙이려는 사람이 통과하지 못한다.
 */
export const META_ADS_SCOPES = ["ads_management", "ads_read", "business_management"];

/**
 * 페이스북 앱 ID(client_id).
 *
 * 앱 ID 는 비밀값이 아니다 — 로그인 대화상자 URL 에 그대로 실려 브라우저에 보인다.
 * 환경변수(FACEBOOK_APP_ID)를 먼저 보고, 없으면 이 앱의 공개 ID 를 쓴다. 폴백을 두는
 * 이유는 환경변수가 비어 있을 때 연동 버튼이 "앱 설정이 준비되지 않았습니다"만 돌려주고
 * 끝나는 상태를 만들지 않기 위해서다(앱 시크릿은 절대 코드에 두지 않는다 — 없으면
 * 콜백이 그 자리에서 실패한다).
 */
const FALLBACK_APP_ID = "3888118128156931";

export const metaAdsAppId = (): string =>
  process.env.FACEBOOK_APP_ID || process.env.META_APP_ID || FALLBACK_APP_ID;

export const metaAdsAppSecret = (): string =>
  process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET || "";

/**
 * '비즈니스용 페이스북 로그인' 설정 ID.
 *
 * 앱의 로그인 설정이 비즈니스용이면 `scope` 가 무시되고 `config_id` 로 지정한 설정의
 * 권한 묶음이 동의 화면에 뜬다. 지금 앱이 어느 쪽인지 확인되지 않았으므로, 기본은
 * 일반 로그인(scope)으로 두고 이 환경변수가 있으면 그때 비즈니스용으로 보낸다 —
 * 두 방식은 URL 파라미터만 다르고 콜백은 같다.
 */
export const metaAdsConfigId = (): string => process.env.FACEBOOK_LOGIN_CONFIG_ID || "";

/** 콜백 주소. 메타 앱의 '유효한 OAuth 리디렉션 URI' 에 이 경로가 등록돼 있어야 한다. */
export const metaAdsRedirectUri = (origin: string): string =>
  `${origin}/api/meta-ads/oauth/callback`;

/**
 * appsecret_proof — 앱 설정에서 '앱 시크릿 증명 요구' 가 켜져 있으면 없으면 전부 실패한다.
 * 켜져 있지 않아도 붙여서 해가 없으므로 모든 그래프 호출에 함께 보낸다.
 */
export const appSecretProof = (accessToken: string, appSecret: string): string =>
  createHmac("sha256", appSecret).update(accessToken).digest("hex");

/** 그래프 호출 하나의 결과. 성공·실패 이유를 화면이 그대로 읽을 수 있게 남긴다. */
export interface MetaAdsProbe {
  ok: boolean;
  /** HTTP 상태. 0 이면 요청 자체가 나가지 못한 경우다. */
  status: number;
  /** 목록 호출의 건수. */
  count?: number;
  /** 그래프가 돌려준 오류 메시지. 사람이 읽을 수 있는 문장만 남긴다. */
  error?: string;
  /** 그래프 오류 코드(예: 200 = 권한 부족). 심사 상태를 판단할 때 쓴다. */
  errorCode?: number;
  /** 캠페인 조회에 쓴 광고 계정. 계정이 하나도 없으면 비어 있다. */
  accountId?: string;
}

export interface MetaAdsAccount {
  /** act_ 접두어를 포함한 광고 계정 ID. 화면과 집행 요청이 이 값을 키로 쓴다. */
  id: string;
  name: string;
  businessName: string;
  currency: string;
  /** 메타의 account_status(1 = 활성). 정지된 계정을 화면에서 구분할 수 있게 둔다. */
  accountStatus?: number;
}

export interface MetaAdsDiagnosis {
  connected: true;
  connectedAt: string;
  metaUserId: string;
  metaUserName: string;
  /** 동의 화면에 올린 권한. '거부'와 '요청 안 함'을 구별하기 위해 남긴다. */
  scopesRequested: string[];
  /** /me/permissions 가 granted 로 돌려준 권한. */
  granted: string[];
  /** 동의 화면에서 사람이 끈 권한. */
  declined: string[];
  accounts: MetaAdsAccount[];
  businesses: { id: string; name: string }[];
  probes: {
    me: MetaAdsProbe;
    permissions: MetaAdsProbe;
    adaccounts: MetaAdsProbe;
    businesses: MetaAdsProbe;
    campaigns: MetaAdsProbe;
  };
  /** 토큰을 저장하지 않았다는 사실을 진단 결과에도 적어 둔다. */
  tokenStored: false;
}

/**
 * 진단 결과 보관함.
 *
 * 사용자 한 명당 JSON 한 덩어리를 통째로 읽고 통째로 덮어쓴다(질의·집계가 없다).
 * 인스타그램 연동 상태를 dm-automation 블롭에 두는 것과 같은 방식이다 — 연동 상태를
 * 테이블로 쪼개 두면 연동 하나를 읽는 데 조인이 필요해진다.
 */
const STORE_NAME = "meta-ads";
const keyFor = (username: string) => `ads_${username.replace(/^biz\//, "").toLowerCase()}`;

const store = () => getStore({ name: STORE_NAME, consistency: "strong" });

export async function readMetaAdsDiagnosis(username: string): Promise<MetaAdsDiagnosis | null> {
  try {
    const found = (await store().get(keyFor(username), { type: "json" })) as MetaAdsDiagnosis | null;
    if (!found || !found.connected) return null;
    // 지난 버전이 토큰을 남겼더라도 화면으로는 절대 내보내지 않는다.
    delete (found as any).accessToken;
    return found;
  } catch (e) {
    console.warn("[meta-ads] diagnosis read failed:", (e as Error)?.message);
    return null;
  }
}

export async function writeMetaAdsDiagnosis(
  username: string,
  diagnosis: MetaAdsDiagnosis,
): Promise<boolean> {
  try {
    await store().setJSON(keyFor(username), diagnosis);
    return true;
  } catch (e) {
    console.warn("[meta-ads] diagnosis write failed:", (e as Error)?.message);
    return false;
  }
}

export async function clearMetaAdsDiagnosis(username: string): Promise<void> {
  try {
    await store().delete(keyFor(username));
  } catch (e) {
    console.warn("[meta-ads] diagnosis delete failed:", (e as Error)?.message);
  }
}
