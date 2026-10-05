import type { Config } from "@netlify/functions";
import { getDatabase } from "@picks/netlify-database";
import { requireOperator } from "./_shared/manager-auth.mts";
import { getSupabaseServer } from "./_shared/supabase.mts";
import { normalizeUsername } from "./_shared/username-rules.mts";
import {
  LEGACY_CODE_TTL_DAYS,
  generateTransferCode,
  hashTransferCode,
  isLegacyInfluencerProfile,
  isOrphanPage,
} from "./_shared/legacy-username.mts";

/**
 * 운영자: 예전 아이디·비밀번호 계정의 유저네임 이전 코드 발급.
 *
 * 인플루언서 로그인을 카카오 하나로 줄이면서, 예전 계정으로 쓰던 유저네임을 카카오로
 * 다시 가입한 본인이 이어받게 했다. 카카오 휴대폰 번호가 예전 계정 번호와 같으면 바로
 * 옮겨지고, 다르면(번호를 바꿨거나 카카오에 번호가 없을 때) 운영자가 연락해 본인을
 * 확인한 뒤 여기서 코드를 발급해 전달한다. 코드는 한 번만 보여 주고 원문은 저장하지
 * 않는다.
 *
 * 예전 계정이 지워지고 페이지 내용(site_data)만 남은 이름(orphan)도 같은 코드로 옮긴다 —
 * 비교할 번호가 없으므로 코드가 유일한 길이다.
 *
 *   GET  /api/admin-legacy-username?username=foo   이 유저네임의 상태(예전 계정인지 · 옮겨졌는지)
 *   POST /api/admin-legacy-username { username }   이전 코드 발급(14일 유효)
 */

async function lookup(username: string) {
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("profiles")
    .select("id, username, role, kakao_id, phone, full_name")
    .eq("username", username)
    .limit(1);
  return Array.isArray(data) ? data[0] || null : null;
}

const maskPhone = (raw: unknown) => {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length >= 8 ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : "";
};

export default async (req: Request) => {
  const operator = await requireOperator(req);
  if (!operator.ok) return operator.response;

  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const username = normalizeUsername(url.searchParams.get("username"));
    if (!username) return Response.json({ error: "유저네임을 입력해 주세요." }, { status: 400 });
    try {
      const profile = await lookup(username);
      const orphan = profile ? false : await isOrphanPage(getSupabaseServer(), username);
      const moves = await db.sql`
        SELECT method, created_at FROM legacy_username_moves
        WHERE username = ${username} ORDER BY created_at DESC LIMIT 1
      `;
      const codes = await db.sql`
        SELECT created_at, expires_at, used_at FROM legacy_username_transfers
        WHERE username = ${username} ORDER BY created_at DESC LIMIT 5
      `;
      return Response.json({
        username,
        exists: !!profile,
        orphan,
        legacy: isLegacyInfluencerProfile(profile),
        kakao: !!String(profile?.kakao_id || "").trim(),
        role: String(profile?.role || ""),
        name: String(profile?.full_name || ""),
        phone: maskPhone(profile?.phone),
        movedAt: moves[0]?.created_at || null,
        movedBy: moves[0]?.method || null,
        codes: (codes as any[]).map((c) => ({
          createdAt: c.created_at,
          expiresAt: c.expires_at,
          usedAt: c.used_at,
        })),
      });
    } catch (e: any) {
      console.error("[admin-legacy-username] lookup failed:", e?.message);
      return Response.json({ error: "조회하지 못했습니다." }, { status: 500 });
    }
  }

  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    const username = normalizeUsername(body?.username);
    if (!username) return Response.json({ error: "유저네임을 입력해 주세요." }, { status: 400 });
    try {
      const profile = await lookup(username);
      if (!profile && !(await isOrphanPage(getSupabaseServer(), username))) {
        return Response.json({ error: "이 유저네임을 쓰는 계정이 없습니다. 이미 옮겨졌거나 비어 있는 이름이면 카카오 가입 때 바로 쓸 수 있어요." }, { status: 404 });
      }
      if (profile && !isLegacyInfluencerProfile(profile)) {
        return Response.json({ error: "예전 아이디·비밀번호 인플루언서 계정이 아닙니다(카카오 · 브랜드 · 운영자 계정은 옮길 수 없습니다)." }, { status: 400 });
      }
      const code = generateTransferCode();
      const expiresAt = new Date(Date.now() + LEGACY_CODE_TTL_DAYS * 86_400_000).toISOString();
      await db.sql`
        INSERT INTO legacy_username_transfers (username, code_hash, created_by, expires_at)
        VALUES (${username}, ${hashTransferCode(code)}, ${operator.username}, ${expiresAt}::timestamptz)
      `;
      return Response.json({ success: true, username, code, expiresAt });
    } catch (e: any) {
      console.error("[admin-legacy-username] issue failed:", e?.message);
      return Response.json({ error: "코드를 발급하지 못했습니다." }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/admin-legacy-username",
};
