import { createHash, randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";

/**
 * 계정 찾기(아이디 찾기 · 비밀번호 재설정)용 문자 인증의 확인값.
 *
 * 문자 인증 기록(sms_verifications)은 번호 단위다. 그래서 인증을 마친 사람이 아니어도
 * 같은 10분 안에 그 번호와 이름을 아는 사람이면 그 인증으로 아이디를 조회하고
 * 비밀번호를 바꿀 수 있었다. 인증을 마친 화면에만 확인값을 주고(서버에는 해시만
 * 남긴다), 계정 찾기 요청은 그 값이 있어야 인증으로 인정한다.
 */

export interface VerifyTokenBinding {
  /** sms_verifications.id */
  id: number;
  phone: string;
  purpose: string;
}

const store = () => getStore({ name: "sms-verify-tokens", consistency: "strong" });
const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

export async function issueVerifyToken(binding: VerifyTokenBinding): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await store().setJSON(hashToken(token), { ...binding, at: new Date().toISOString() });
  return token;
}

/** 확인값이 가리키는 인증 기록. 값이 없거나 모르는 값이면 null. */
export async function readVerifyToken(token: unknown): Promise<VerifyTokenBinding | null> {
  const value = typeof token === "string" ? token.trim() : "";
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(value)) return null;
  const found = (await store().get(hashToken(value), { type: "json" })) as Partial<VerifyTokenBinding> | null;
  if (!found || !Number.isFinite(Number(found.id)) || typeof found.phone !== "string") return null;
  return { id: Number(found.id), phone: found.phone, purpose: String(found.purpose || "") };
}

/** 다 쓴 확인값을 지운다. 실패해도 인증 기록 쪽이 이미 소진돼 다시 쓸 수 없다. */
export async function dropVerifyToken(token: unknown): Promise<void> {
  if (typeof token !== "string" || !token) return;
  await store().delete(hashToken(token.trim())).catch(() => {});
}
