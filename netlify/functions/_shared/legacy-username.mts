import { createHash, randomInt } from "node:crypto";
import { getDatabase } from "@picks/netlify-database";
import { mutateBlobJSON } from "./blob-write.mts";

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
 *      이 번호는 kakao-profile-setup 이 Auth app_metadata(kakao_verified_phone)에 남긴
 *      값만 쓴다. profiles.phone 은 본인이 화면에서 고칠 수 있어 본인 확인이 되지 않는다.
 *   2. 운영자가 연락해 본인을 확인한 뒤 발급한 이전 코드를 넣는다(14일 유효, 한 번만).
 *
 * 이름과 함께 계정 아이디에 묶인 기록(프로필 나머지 값 · 추천 링크 · 운영자 부여 멤버십 ·
 * 디엠 자동화 주인)도 새 계정으로 넘긴다 — 로그인 방식만 바뀐 같은 사람이다.
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
  | { kind: "code_required"; codeGiven: boolean; phoneUnverified: boolean }
  | { kind: "move"; method: "phone" | "code"; codeId: number | null };

/** 이어받으려는 사람. 값은 모두 Auth 사용자 정보에서 온다(본인이 고칠 수 없는 자리). */
export type LegacyClaimant = { kakaoId: string; verifiedPhone: string };

/**
 * 호출한 사람의 카카오 계정 아이디와, 카카오가 확인해 준 휴대폰 번호.
 * profiles 의 kakao_id · phone 이 아니라 Auth 의 카카오 신원 · app_metadata 를 본다.
 */
export async function loadLegacyClaimant(supabase: any, userId: string): Promise<LegacyClaimant | null> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  const user = data.user;
  const kakao = (user.identities || []).find((i: any) => i.provider === "kakao");
  const kakaoId = String(kakao?.identity_data?.sub || kakao?.provider_id || "").trim();
  return { kakaoId, verifiedPhone: digits(user.app_metadata?.kakao_verified_phone) };
}

/** 이 사람이 예전 계정의 유저네임을 이어받을 수 있는지. */
export async function legacyTransferDecision(input: {
  username: string;
  owner: { id: string; role?: unknown; kakao_id?: unknown; phone?: unknown };
  me: LegacyClaimant | null;
  transferCode?: unknown;
}): Promise<LegacyDecision> {
  if (!isLegacyInfluencerProfile(input.owner)) return { kind: "taken" };
  // 이어받는 쪽은 카카오로 가입한 계정이어야 한다.
  if (!input.me || !input.me.kakaoId) return { kind: "taken" };

  const ownerPhone = digits(input.owner.phone);
  const myPhone = input.me.verifiedPhone;
  if (ownerPhone.length >= 10 && ownerPhone === myPhone) {
    return { kind: "move", method: "phone", codeId: null };
  }

  const phoneUnverified = myPhone.length < 10;
  const code = normalizeTransferCode(input.transferCode);
  if (!code) return { kind: "code_required", codeGiven: false, phoneUnverified };
  try {
    const db = getDatabase();
    const rows = await db.sql`
      SELECT id FROM legacy_username_transfers
      WHERE username = ${input.username} AND code_hash = ${hashTransferCode(code)}
        AND used_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1
    `;
    if (rows.length === 0) return { kind: "code_required", codeGiven: true, phoneUnverified };
    return { kind: "move", method: "code", codeId: Number(rows[0].id) };
  } catch (e) {
    console.error("[legacy-username] code lookup failed:", (e as Error)?.message);
    return { kind: "code_required", codeGiven: true, phoneUnverified };
  }
}

/** 옮기지 않는 profiles 컬럼. 계정 자체를 가리키거나 카카오 쪽이 주인인 값이다. */
const PROFILE_SKIP_COLUMNS = new Set(["id", "username", "role", "kakao_id", "created_at", "updated_at"]);
/** 카카오에서 새로 받은 값이 있으면 그쪽을 쓰고, 비어 있을 때만 예전 값으로 채우는 컬럼. */
const PROFILE_PREFER_NEW_COLUMNS = new Set(["phone", "full_name", "email"]);

const isBlank = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");

/**
 * 예전 계정 프로필의 나머지 값(소개 · 프로필 사진 · 설정 등)을 새 계정으로 옮길 값.
 * 예전에 직접 고른 값을 살리되, 이름 · 휴대폰 · 이메일은 카카오에서 새로 받은 값이 우선이다.
 */
function carriedProfileFields(oldRow: Record<string, any> | null, newRow: Record<string, any> | null) {
  const fields: Record<string, any> = {};
  if (!oldRow) return fields;
  for (const [column, value] of Object.entries(oldRow)) {
    if (PROFILE_SKIP_COLUMNS.has(column) || isBlank(value)) continue;
    if (PROFILE_PREFER_NEW_COLUMNS.has(column) && !isBlank(newRow?.[column])) continue;
    fields[column] = value;
  }
  return fields;
}

/**
 * 유저네임 말고 계정 아이디(auth user id)에 묶인 기록을 새 계정으로 넘긴다. 로그인 방식만
 * 바뀐 같은 사람이므로 예전 계정에 쌓인 것이 하나도 빠지면 안 된다.
 *   - profiles 의 나머지 값(소개 · 프로필 사진 · 설정 등)
 *   - 추천 링크(link_grid_items.user_id)
 *   - 운영자가 부여한 멤버십(operator_membership_grants.auth_user_id)
 *   - 출시 혜택 코드 사용 기록(membership_promo_codes.auth_user_id)
 *   - 디엠 자동화 설정의 주인(dm-automation 블롭의 ownerAuthUserId) — 웹훅이 이 아이디로
 *     멤버십을 확인하므로 예전 아이디로 남아 있으면 운영자 부여 멤버십을 못 찾는다.
 * 페이지 내용 · 협업 · 정산 · 결제 멤버십 · 디엠 설정 본문은 유저네임에 묶여 있어 이름을
 * 옮기는 것만으로 따라온다.
 *
 * 이름은 이미 옮겨졌으므로 하나가 실패해도 나머지는 계속 옮기고 로그로 남긴다.
 */
async function carryOverAccountData(input: {
  supabase: any;
  username: string;
  fromUserId: string;
  toUserId: string;
  oldProfile: Record<string, any> | null;
  newProfile: Record<string, any> | null;
}) {
  const { supabase, username, fromUserId, toUserId } = input;
  const now = new Date().toISOString();

  const fields = carriedProfileFields(input.oldProfile, input.newProfile);
  if (Object.keys(fields).length > 0) {
    let { error } = await supabase
      .from("profiles")
      .update({ ...fields, updated_at: now })
      .eq("id", toUserId);
    if (error && "email" in fields) {
      // 이메일에 고유 제약이 걸려 있으면 예전 계정 행과 부딪힌다. 이메일만 빼고 다시 쓴다.
      const { email: _email, ...rest } = fields;
      ({ error } = await supabase.from("profiles").update({ ...rest, updated_at: now }).eq("id", toUserId));
    }
    if (error) console.error("[legacy-username] profile carry-over failed:", error);
  }

  const { error: gridError } = await supabase
    .from("link_grid_items")
    .update({ user_id: toUserId })
    .eq("user_id", fromUserId);
  if (gridError) console.error("[legacy-username] link_grid_items carry-over failed:", gridError);

  try {
    const db = getDatabase();
    // 새 계정에 이미 부여가 있으면(운영자가 먼저 다시 부여한 경우) 그쪽을 둔다.
    await db.sql`
      UPDATE operator_membership_grants
      SET auth_user_id = ${toUserId}, username = ${username}, updated_at = NOW()
      WHERE auth_user_id = ${fromUserId}
        AND NOT EXISTS (SELECT 1 FROM operator_membership_grants WHERE auth_user_id = ${toUserId})
    `;
  } catch (e) {
    console.error("[legacy-username] operator grant carry-over failed:", (e as Error)?.message);
  }

  // 등록 기록은 membership_promo_redemptions 에 있다(membership_promo_codes 는 코드 목록).
  // 따로 감싼다 — 앞의 부여 이전이 실패해도 이 기록은 옮겨야 한다.
  try {
    const db = getDatabase();
    await db.sql`
      UPDATE membership_promo_redemptions SET auth_user_id = ${toUserId}
      WHERE username = ${username} AND auth_user_id = ${fromUserId}
    `;
  } catch (e) {
    console.error("[legacy-username] promo redemption carry-over failed:", (e as Error)?.message);
  }

  try {
    await mutateBlobJSON<Record<string, any>>("dm-automation", `dm_${username}`, (current) => {
      if (!current) return null;
      const owner = String(current.ownerAuthUserId || "");
      if (owner && owner !== fromUserId) return null;
      return { ...current, ownerAuthUserId: toUserId };
    });
  } catch (e) {
    console.error("[legacy-username] dm settings carry-over failed:", (e as Error)?.message);
  }
}

/**
 * 유저네임을 옮긴다. 예전 계정의 이름을 먼저 비켜 두고, 새 계정에 이름을 준다.
 * 두 번째 쓰기가 실패하면 예전 계정의 이름을 되돌린다 — 아무도 그 이름을 갖지 않은
 * 채로 남으면 페이지 주소가 통째로 열리지 않는다. 이름이 옮겨지면 계정 아이디에 묶인
 * 나머지 기록도 함께 넘긴다(carryOverAccountData).
 */
export async function moveLegacyUsername(input: {
  supabase: any;
  username: string;
  fromUserId: string;
  toUserId: string;
  /** 새 계정의 카카오 아이디. 프로필 행이 아직 없어 새로 만들 때 함께 넣는다. */
  kakaoId: string;
  hasProfile: boolean;
  method: "phone" | "code";
  codeId: number | null;
}): Promise<{ ok: boolean }> {
  const { supabase, username, fromUserId, toUserId } = input;
  const parked = `_legacy_${fromUserId.replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();

  const [{ data: oldProfile }, { data: newProfile }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", fromUserId).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", toUserId).maybeSingle(),
  ]);

  const { data: parkedRows, error: parkError } = await supabase
    .from("profiles")
    .update({ username: parked, updated_at: now })
    .eq("id", fromUserId)
    .eq("username", username)
    .select("id");
  // 비켜 둔 행이 없으면 그 사이 다른 요청이 먼저 옮겼거나 이름이 바뀐 것이다. 이어서
  // 쓰면 고유 제약에 걸린 뒤 되돌리기까지 엉키므로 여기서 멈춘다.
  if (parkError || !Array.isArray(parkedRows) || parkedRows.length === 0) {
    console.error("[legacy-username] park failed:", parkError || "no row parked");
    return { ok: false };
  }

  const payload = { username, updated_at: now };
  const { error: writeError } = input.hasProfile
    ? await supabase.from("profiles").update(payload).eq("id", toUserId)
    : await supabase
        .from("profiles")
        .insert({ id: toUserId, ...payload, role: "user", kakao_id: input.kakaoId || null });
  if (writeError) {
    console.error("[legacy-username] claim failed, restoring:", writeError);
    await supabase
      .from("profiles")
      .update({ username, updated_at: now })
      .eq("id", fromUserId)
      .eq("username", parked);
    return { ok: false };
  }

  await carryOverAccountData({ supabase, username, fromUserId, toUserId, oldProfile, newProfile });

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
