import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * 정산 개인정보(주민등록번호 · 계좌번호) 암호화. AES-256-GCM.
 *
 * 키: 서버 전용 환경변수 AFFILIATE_PII_KEY (VITE_ 접두사 금지 — 브라우저 번들에 들어가면 안 된다).
 *   32바이트 키를 base64(44자) 또는 hex(64자)로 넣는 것을 권장한다(그 밖의 문자열은 UTF-8 바이트를 그대로 쓴다).
 *   같은 키를 다른 용도(카페24 토큰 등)와 나눠 쓸 수 있으므로, 정산 개인정보 전용 키를 HKDF 로 따로 뽑아 쓴다.
 *   키가 없으면 암호화 · 복호화 모두 실패한다(평문 저장으로 물러나지 않는다).
 *
 * 저장 형식: "v1:<iv base64>:<tag base64>:<ciphertext base64>"
 *
 * 규칙: 평문 · 암호문 · 키는 로그 · 오류 메시지에 넣지 않는다. 실패는 PiiCryptoError(code 만 담는다)로 알린다.
 */

export class PiiCryptoError extends Error {
  code: string;
  constructor(code: "NO_KEY" | "BAD_FORMAT" | "DECRYPT_FAILED") {
    super(`pii crypto ${code}`);
    this.name = "PiiCryptoError";
    this.code = code;
  }
}

let cachedKey: Buffer | null = null;
let cachedRaw = "";

function key(): Buffer {
  const raw = String(process.env.AFFILIATE_PII_KEY || "").trim();
  if (!raw) throw new PiiCryptoError("NO_KEY");
  if (cachedKey && cachedRaw === raw) return cachedKey;
  let ikm: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) ikm = Buffer.from(raw, "hex");
  else {
    const b = Buffer.from(raw, "base64");
    ikm = b.length === 32 ? b : Buffer.from(raw, "utf8");
  }
  const k = Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), "picksfolio:affiliate-payout-pii:v1", 32));
  cachedKey = k;
  cachedRaw = raw;
  return k;
}

export const piiKeyConfigured = () => !!String(process.env.AFFILIATE_PII_KEY || "").trim();

export function encryptPii(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptPii(stored: string): string {
  const parts = String(stored || "").split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new PiiCryptoError("BAD_FORMAT");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof PiiCryptoError) throw e;
    throw new PiiCryptoError("DECRYPT_FAILED");
  }
}

/** 주민등록번호 화면 표시: 900101-1****** (뒤 6자리 가림). */
export const maskRrn = (digits13: string) => `${digits13.slice(0, 6)}-${digits13.slice(6, 7)}******`;
/** 주민등록번호 원문 표시 형식(운영자 열람 · 신고 파일). */
export const formatRrn = (digits13: string) => `${digits13.slice(0, 6)}-${digits13.slice(6)}`;
/** 계좌번호 화면 표시: 뒤 4자리만. */
export const maskAccount = (last4: string) => (last4 ? `****${last4}` : "");
