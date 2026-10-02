import { createHash, randomInt } from "node:crypto";
import { getDatabase } from "@picks/netlify-database";

/**
 * 예전 아이디·비밀번호 계정의 유저네임을 카카오 계정으로 옮기기.
 *
 * 인플루언서 로그인을 카카오 간편로그인 하나로 줄였다. 예전에 아이디·비밀번호로 가입한
 * 사람은 카카오로 다시 가입하게 되는데, 쓰던 유저네임(= 페이지 주소)은 예전 계정이 쥐고
 * 있어 그대로 두면 "이미 사용 중인 링크" 로 막힌다. 페이지 내용 · 협업 · 정산 기록이 모두
 * 유저네임에 묶여 있으므로, 이름을 옮기면 그 기록도 함께 이어진다.
 *
 * 그래서 아무나 가져가게 둘 수는 없다. 본인 확인은 두 가지 중 하나다.
 *   1. 카카오에서 받은 휴대폰 번호가 예전 계정 번호(가입 때 SMS 인증한 번호)와 같다.
 *   2. 운영자가 연락해 본인을 확인한 뒤 발급한 이전 코드를 넣는다(14일 유효, 한 번만).
 *
 * 옮길 때 예전 계정 행은 지우지 않는다. 유저네임만 `_legacy_…` 로 비켜 두어 고유 제약을
 * 풀고, 어느 계정에서 어느 카카오 계정으로 갔는지는 legacy_username_moves 에 남긴다.
 */

export const LEGACY_CODE_TTL_DAYS = 14;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

const digits = (raw: unknown) => String(raw || "").replace(/\D/g, "");

export const hashTransferCode = (code: string) =>
  createHash("sha256").update(normalizeTransferCode(code)).digest("hex");

export const normalizeTransferCode = (raw: unknown) =>
  String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);

export function generateTransferCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * 예전 아이디·비밀번호 인플루언서 계정인지. 카카오로 가입한 계정(kakao_id 있음),
 * 브랜드(role=operator), 운영자(role=admin)는 옮길 대상이 아니다.
 */
export const isLegacyInfluencerProfile = (profile: { role?: unknown; kakao_id?: unknown } | null | undefined) => {
  if (!profile) return false;
  const role = String(profile.role || "user").trim().toLowerCase();
  if (role === "operator" || role === "admin") return false;
  return !String(profile.kakao_id || "").trim();
};

export type LegacyDecision =
  | { kind: "taken" }
  | { kind: "code_required"; codeGiven: boolean }
  | { kind: "move"; method: "phone" | "code"; codeId: number | null };

/** 이 사람이 예전 계정의 유저네임을 이어받을 수 있는지. */
export async function legacyTransferDecision(input: {
  username: string;
  owner: { id: string; role?: unknown; kakao_id?: unknown; phone?: unknown };
  me: { kakao_id?: unknown; phone?: unknown } | null;
  transferCode?: unknown;
}): Promise<LegacyDecision> {
  if (!isLegacyInfluencerProfile(input.owner)) return { kind: "taken" };
  // 이어받는 쪽은 카카오로 가입한 계정이어야 한다.
  if (!input.me || !String(input.me.kakao_id || "").trim()) return { kind: "taken" };

  const ownerPhone = digits(input.owner.phone);
  const myPhone = digits(input.me.phone);
  if (ownerPhone.length >= 10 && ownerPhone === myPhone) {
    return { kind: "move", method: "phone", codeId: null };
  }

  const code = normalizeTransferCode(input.transferCode);
  if (!code) return { kind: "code_required", codeGiven: false };
  try {
    const db = getDatabase();
    const rows = await db.sql`
      SELECT id FROM legacy_username_transfers
      WHERE username = ${input.username} AND code_hash = ${hashTransferCode(code)}
        AND used_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1
    `;
    if (rows.length === 0) return { kind: "code_required", codeGiven: true };
    return { kind: "move", method: "code", codeId: Number(rows[0].id) };
  } catch (e) {
    console.error("[legacy-username] code lookup failed:", (e as Error)?.message);
    return { kind: "code_required", codeGiven: true };
  }
}

/**
 * 유저네임을 옮긴다. 예전 계정의 이름을 먼저 비켜 두고, 새 계정에 이름을 준다.
 * 두 번째 쓰기가 실패하면 예전 계정의 이름을 되돌린다 — 아무도 그 이름을 갖지 않은
 * 채로 남으면 페이지 주소가 통째로 열리지 않는다.
 */
export async function moveLegacyUsername(input: {
  supabase: any;
  username: string;
  fromUserId: string;
  toUserId: string;
  hasProfile: boolean;
  method: "phone" | "code";
  codeId: number | null;
}): Promise<{ ok: boolean }> {
  const { supabase, username, fromUserId, toUserId } = input;
  const parked = `_legacy_${fromUserId.replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();

  const { error: parkError } = await supabase
    .from("profiles")
    .update({ username: parked, updated_at: now })
    .eq("id", fromUserId)
    .eq("username", username);
  if (parkError) {
    console.error("[legacy-username] park failed:", parkError);
    return { ok: false };
  }

  const payload = { username, updated_at: now };
  const { error: writeError } = input.hasProfile
    ? await supabase.from("profiles").update(payload).eq("id", toUserId)
    : await supabase.from("profiles").insert({ id: toUserId, ...payload, role: "user" });
  if (writeError) {
    console.error("[legacy-username] claim failed, restoring:", writeError);
    await supabase
      .from("profiles")
      .update({ username, updated_at: now })
      .eq("id", fromUserId)
      .eq("username", parked);
    return { ok: false };
  }

  try {
    const db = getDatabase();
    if (input.codeId != null) {
      await db.sql`
        UPDATE legacy_username_transfers SET used_at = NOW(), used_by_user_id = ${toUserId}
        WHERE id = ${input.codeId}
      `;
    }
    await db.sql`
      INSERT INTO legacy_username_moves (username, from_user_id, to_user_id, method)
      VALUES (${username}, ${fromUserId}, ${toUserId}, ${input.method})
    `;
  } catch (e) {
    // 이름은 이미 옮겨졌다. 기록이 빠진 것은 로그로만 남긴다.
    console.error("[legacy-username] move log failed:", (e as Error)?.message);
  }
  return { ok: true };
}
