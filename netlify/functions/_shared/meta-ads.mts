import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
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
 * 토큰은 서버에만 암호화해서 저장한다. 처음에는 진단만 하고 토큰을 버렸지만, 그러면
 * '집행하기' 가 메타에 캠페인을 만들 수 없고 페이지 목록·게시물 반응도 읽을 수 없다.
 * 그래서 콜백이 장기 토큰(60일)으로 바꿔 AES-256-GCM 으로 암호화해 두고, 서버 함수만
 * 풀어서 쓴다. 토큰은 어떤 응답에도 실리지 않는다 — 화면이 받는 것은 진단 결과와
 * 그래프가 돌려준 데이터뿐이다.
 */

/** 그래프 API 버전. 다른 함수들과 같은 버전으로 맞춘다. */
export const GRAPH_VERSION = "v21.0";

/**
 * 동의 화면에서 요청할 권한.
 *
 * 모두 심사 대상이고, 하나라도 빼면 그 권한이 동의 화면에 나오지 않아 진단에서
 * "요청했는데 거부됨"과 "애초에 요청하지 않음"을 구별할 수 없게 된다.
 *
 *   ads_management         광고 생성·집행 ('집행하기')
 *   ads_read               광고 상태·지표 조회 (광고 현황)
 *   business_management    광고 계정·비즈니스 자산 접근
 *   pages_show_list        관리하는 페이스북 페이지 목록 (광고 페이지 선택)
 *   pages_read_engagement  페이지 게시물 반응 (좋아요·댓글·공유)
 *
 * 인스타그램 인사이트(instagram_manage_insights)는 여기 넣지 않는다. 그 권한은 이미
 * 인스타그램 연동에서 받고 있다.
 *
 * 파트너십 광고(광고 코드) 같은 추가 권한은 META_ADS_EXTRA_SCOPES(쉼표 구분)로 붙인다 —
 * 심사를 받지 않은 권한을 기본값에 넣으면 역할이 없는 사용자의 동의 화면이 깨진다.
 */
const BASE_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
];

const extraScopes = (): string[] =>
  String(process.env.META_ADS_EXTRA_SCOPES || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !BASE_SCOPES.includes(s));

export const META_ADS_SCOPES = BASE_SCOPES;

/** 실제로 동의 화면에 올리는 권한(기본 + 추가). */
export const metaAdsScopes = (): string[] => [...BASE_SCOPES, ...extraScopes()];

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
  /** 광고 계정이 매달린 비즈니스 ID. 파트너십 광고 코드 조회에 쓴다. */
  businessId?: string;
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
    /** GET /me/accounts — 관리하는 페이지. 옛 진단 결과에는 없다. */
    pages?: MetaAdsProbe;
  };
  /** 서버가 쓸 수 있는 토큰이 저장돼 있는지. 없으면 집행·페이지 조회를 할 수 없다. */
  tokenStored: boolean;
  /** 저장한 토큰의 만료 시각(ISO). 지나면 다시 연동해야 한다. */
  tokenExpiresAt?: string;
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
    // 토큰을 버리던 시절의 진단 결과는 tokenStored 가 false 로 남아 있다.
    found.tokenStored = !!found.tokenStored;
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
    await store().delete(tokenKeyFor(username));
  } catch (e) {
    console.warn("[meta-ads] diagnosis delete failed:", (e as Error)?.message);
  }
}

/**
 * 토큰 보관.
 *
 * 진단 결과와 다른 키에 둔다 — 진단 결과는 화면으로 나가는 값이고, 토큰은 절대 나가면
 * 안 되는 값이다. 한 덩어리에 두면 "읽고 나서 지우는" 코드 한 줄이 빠지는 순간 새어 나간다.
 *
 * 암호화 키는 전용 키(META_ADS_TOKEN_KEY)가 있으면 그걸, 없으면 앱 시크릿에서 유도한다.
 * 앱 시크릿을 바꾸면 저장된 토큰을 풀 수 없게 되는데, 그 경우 다시 연동하면 된다
 * (시크릿을 바꿨다면 어차피 기존 appsecret_proof 도 전부 무효다).
 */
const tokenKeyFor = (username: string) => `token_${username.replace(/^biz\//, "").toLowerCase()}`;

const encryptionKey = (): Buffer | null => {
  const material = process.env.META_ADS_TOKEN_KEY || metaAdsAppSecret();
  if (!material) return null;
  return createHash("sha256").update(`picks-meta-ads-token:${material}`).digest();
};

interface StoredToken {
  v: 1;
  iv: string;
  tag: string;
  data: string;
  expiresAt?: string;
  metaUserId?: string;
}

export async function writeMetaAdsToken(
  username: string,
  token: string,
  meta: { expiresAt?: string; metaUserId?: string } = {},
): Promise<boolean> {
  const key = encryptionKey();
  if (!key) return false;
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const record: StoredToken = {
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
      expiresAt: meta.expiresAt,
      metaUserId: meta.metaUserId,
    };
    await store().setJSON(tokenKeyFor(username), record);
    return true;
  } catch (e) {
    console.warn("[meta-ads] token write failed:", (e as Error)?.message);
    return false;
  }
}

export type MetaAdsTokenResult =
  | { ok: true; token: string; proof: string }
  | { ok: false; reason: "missing" | "expired" | "unreadable" };

/** 저장한 토큰을 풀어 appsecret_proof 와 함께 돌려준다. */
export async function readMetaAdsToken(username: string): Promise<MetaAdsTokenResult> {
  const key = encryptionKey();
  if (!key) return { ok: false, reason: "unreadable" };
  let record: StoredToken | null = null;
  try {
    record = (await store().get(tokenKeyFor(username), { type: "json" })) as StoredToken | null;
  } catch {
    record = null;
  }
  if (!record?.data) return { ok: false, reason: "missing" };
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    const token = Buffer.concat([
      decipher.update(Buffer.from(record.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return { ok: true, token, proof: appSecretProof(token, metaAdsAppSecret()) };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** 토큰이 없을 때 화면에 돌려줄 응답. 화면은 code 를 보고 '다시 연동' 을 띄운다. */
export const tokenErrorResponse = (reason: "missing" | "expired" | "unreadable"): Response =>
  Response.json(
    {
      error:
        reason === "expired"
          ? "Meta 연동이 만료되었습니다. 연동 설정에서 다시 연동해 주세요."
          : "Meta 계정을 다시 연동해 주세요. (집행·페이지 조회에 필요한 로그인 정보가 없습니다)",
      code: `token_${reason}`,
    },
    { status: 409 },
  );
