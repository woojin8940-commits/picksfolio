/**
 * 카페24 OAuth 의 바닥 — 토큰 암호화, Basic 인증, 토큰 엔드포인트 호출, 응답 해석.
 *
 * 연동 시작 · 콜백 · 해제(cafe24-oauth.mts)와 토큰 갱신(cafe24-api.mts)이 함께 쓴다.
 * 이 파일은 다른 카페24 모듈을 가져오지 않는다(서로 가져오면 순환 참조가 된다).
 *
 * 로그 원칙: 토큰 · 인증코드 · 시크릿 · 카페24 응답 원문은 어디에도 남기지 않는다.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * 토큰 암호화 키. AFFILIATE_PII_KEY 만 쓴다 — 없으면 null 이고, 호출부는 저장을 막는다.
 * 다른 비밀값으로 대신 만들지 않는다: 그 값을 바꾸는 순간 저장된 토큰을 읽을 수 없게
 * 되고, 키가 빠진 사실도 드러나지 않는다.
 */
function tokenKey(): Buffer | null {
  const raw = process.env.AFFILIATE_PII_KEY || "";
  if (!raw) return null;
  return createHash("sha256").update(`picksfolio-cafe24-token-v1:${raw}`).digest();
}

export const tokenKeyReady = () => tokenKey() !== null;

/** 't1.<iv>.<tag>.<암호문>' (base64url). 몰 아이디를 AAD 로 묶는다. */
export function encryptToken(plain: string, mallId: string): string {
  const key = tokenKey();
  if (!key) throw new Error("cafe24 token key missing");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`cafe24:${mallId}`));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["t1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

/** 풀 수 없으면(키 없음 · 형식 오류 · 다른 몰의 값) 빈 문자열. */
export function decryptToken(stored: unknown, mallId: string): string {
  const key = tokenKey();
  const [v, iv, tag, enc] = String(stored || "").split(".");
  if (!key || v !== "t1" || !iv || !tag || !enc) return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(`cafe24:${mallId}`));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export const MALL_ID_PATTERN = /^[a-z0-9]{2,32}$/;

/** 쇼핑몰 아이디 형식(영문 소문자 · 숫자). 카페24 API 호스트 이름에 그대로 들어가므로 엄격히 본다. */
export function cleanMallId(raw: unknown): string {
  const v = String(raw || "").trim().toLowerCase();
  return MALL_ID_PATTERN.test(v) ? v : "";
}

export function cafe24AppConfig() {
  return {
    clientId: String(process.env.CAFE24_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.CAFE24_CLIENT_SECRET || "").trim(),
    // 개발자센터에 등록한 값과 글자 하나까지 같아야 한다. 앞뒤 공백만 걷어 낸다.
    redirectUri: String(process.env.CAFE24_REDIRECT_URI || "").trim(),
  };
}

export const cafe24ConfigReady = () => {
  const c = cafe24AppConfig();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
};

export type OAuthResponse = { status: number; json: any; error: string };

/**
 * 토큰 · 폐기 엔드포인트 호출. Basic base64(client_id:client_secret), 폼 인코딩.
 * 네트워크 오류는 status 0 으로 돌려준다. 본문은 호출부가 필요한 필드만 꺼내 쓴다.
 */
export async function postOAuth(
  mallId: string,
  endpoint: "token" | "revoke",
  form: Record<string, string>,
): Promise<OAuthResponse> {
  const { clientId, clientSecret } = cafe24AppConfig();
  if (!clientId || !clientSecret || !cleanMallId(mallId)) return { status: 0, json: null, error: "config" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`https://${mallId}.cafe24api.com/api/v2/oauth/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, error: res.ok ? "" : String(json?.error || "") };
  } catch {
    return { status: 0, json: null, error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 카페24 시각 문자열. 토큰 응답의 expires_at 등은 '2021-03-01T14:00:00.000' 처럼 시간대가
 * 없고 한국 시간이다. 시간대 표기가 있으면 그대로 따른다.
 */
export function parseCafe24Time(raw: unknown): Date | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  const t = Date.parse(hasZone ? s : `${s.replace(" ", "T")}+09:00`);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function parseScopeList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(/[\s,]+/).filter(Boolean);
  return [];
}

export type Cafe24TokenSet = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  mallId: string;
  clientId: string;
  userId: string;
  shopNo: string;
  scopes: string[];
  issuedAt: Date | null;
};

const ACCESS_TTL_MS = 2 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** 토큰 응답(발급 · 갱신 공통). 토큰이 둘 다 없으면 null. */
export function parseTokenResponse(json: any): Cafe24TokenSet | null {
  const accessToken = String(json?.access_token || "");
  const refreshToken = String(json?.refresh_token || "");
  if (!accessToken || !refreshToken) return null;
  const now = Date.now();
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: parseCafe24Time(json?.expires_at) || new Date(now + ACCESS_TTL_MS),
    refreshExpiresAt: parseCafe24Time(json?.refresh_token_expires_at) || new Date(now + REFRESH_TTL_MS),
    mallId: String(json?.mall_id || "").trim().toLowerCase(),
    clientId: String(json?.client_id || ""),
    userId: String(json?.user_id || ""),
    shopNo: String(json?.shop_no ?? "1") || "1",
    scopes: parseScopeList(json?.scopes ?? json?.scope),
    issuedAt: parseCafe24Time(json?.issued_at),
  };
}

/** 갱신 · 교환이 "다시 동의해야 하는" 실패인지(되풀이해도 안 되는 경우). */
export const isGrantFailure = (r: OAuthResponse) =>
  r.error === "invalid_grant" || ((r.status === 400 || r.status === 401) && /grant|token/i.test(r.error));
