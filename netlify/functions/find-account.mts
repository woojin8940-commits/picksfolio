import { createClient } from "@supabase/supabase-js";
import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

function getSupabaseAdmin() {
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Normalize a Korean/Latin name for tolerant comparison (ignore case + whitespace).
function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * 이 번호가 방금 인증을 통과했는지 확인하고, 그 인증 줄의 id 를 돌려준다.
 *
 * 판정 기준을 verified 플래그 하나에서 세 가지로 좁혔다.
 *   - verified_at 이 채워져 있어야 한다. 이 값은 verify-sms 가 코드를 실제로 맞췄을
 *     때만 쓰므로, 다른 경로가 플래그를 세워도 인증으로 인정되지 않는다.
 *   - 창은 expires_at(문자를 *보낸* 시각)이 아니라 verified_at 기준 10분이다.
 *   - consumed_at 이 비어 있어야 한다. 한 번 쓴 인증으로 비밀번호를 반복해서
 *     바꿀 수 없다.
 *
 * 반환값이 null 이면 인증되지 않았다는 뜻이다.
 */
async function findUsableVerification(phone: string, purpose: string): Promise<number | null> {
  const db = getDatabase();
  const results = await db.sql`
    SELECT id FROM sms_verifications
    WHERE phone = ${phone}
      AND purpose = ${purpose}
      AND verified = TRUE
      AND verified_at IS NOT NULL
      AND verified_at > NOW() - INTERVAL '10 minutes'
      AND consumed_at IS NULL
    ORDER BY verified_at DESC
    LIMIT 1
  `;
  return results.length > 0 ? Number(results[0].id) : null;
}

/** 인증을 소진 처리한다. 조회가 아니라 실제 조치(비밀번호 변경)를 한 뒤에만 호출한다. */
async function consumeVerification(id: number): Promise<void> {
  const db = getDatabase();
  await db.sql`
    UPDATE sms_verifications
    SET consumed_at = NOW()
    WHERE id = ${id} AND consumed_at IS NULL
  `;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { action, phone, name, account_type } = body;

    if (!phone) {
      return Response.json({ success: false, error: "전화번호를 입력해 주세요." });
    }

    const cleanName = (name || "").trim();
    if (!cleanName) {
      return Response.json({ success: false, error: "이름을 입력해 주세요." });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const supabase = getSupabaseAdmin();

    const purpose = action === "find-id" ? "find-id" : "reset-password";
    const verificationId = await findUsableVerification(cleanPhone, purpose);
    if (verificationId === null) {
      return Response.json({
        success: false,
        error: "휴대폰 인증을 완료해 주세요.",
      });
    }

    const roleFilter =
      account_type === "business" ? ["operator", "admin"] : ["user"];

    if (action === "find-id" || action === "reset-lookup") {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("username, full_name, created_at")
        .eq("phone", cleanPhone)
        .in("role", roleFilter);

      const matched = (profiles || []).filter(
        (p) => normalizeName(p.full_name) === normalizeName(cleanName)
      );

      if (matched.length === 0) {
        return Response.json({
          success: false,
          error: "이름과 전화번호가 일치하는 계정이 없습니다.",
        });
      }

      return Response.json({
        success: true,
        accounts: matched.map((p) => ({
          username: p.username,
          display_name: p.full_name || "",
          created_at: p.created_at,
        })),
      });
    }

    // 화면(FindAccount.tsx)은 "reset-pw" 를 보낸다. 서버가 "reset-password" 만
    // 받고 있었기 때문에 비밀번호 재설정은 항상 "Unknown action" 으로 끝났다.
    if (action === "reset-password" || action === "reset-pw") {
      const { username, new_password } = body;

      if (!new_password) {
        return Response.json({ success: false, error: "새 비밀번호를 입력해 주세요." });
      }

      if (new_password.length < 6) {
        return Response.json({ success: false, error: "비밀번호는 6자 이상이어야 합니다." });
      }

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, full_name")
        .eq("phone", cleanPhone)
        .in("role", roleFilter);

      let matched = (profiles || []).filter(
        (p) => normalizeName(p.full_name) === normalizeName(cleanName)
      );

      // When the client knows which account to reset (multiple share a name +
      // phone), narrow down to the selected username.
      if (username) {
        matched = matched.filter((p) => p.username === username);
      }

      if (matched.length === 0) {
        return Response.json({
          success: false,
          error: "이름과 전화번호가 일치하는 계정이 없습니다.",
        });
      }

      if (matched.length > 1) {
        return Response.json({
          success: false,
          error: "여러 계정이 확인되었습니다. 아이디를 선택해 주세요.",
          accounts: matched.map((p) => ({
            username: p.username,
            display_name: p.full_name || "",
          })),
        });
      }

      const profile = matched[0];

      const { error: updateError } = await supabase.auth.admin.updateUserById(
        profile.id,
        { password: new_password }
      );

      if (updateError) {
        return Response.json({ success: false, error: "비밀번호 변경에 실패했습니다." });
      }

      // 비밀번호가 실제로 바뀐 뒤에 인증을 소진시킨다. 같은 문자 한 통으로
      // 계정을 몇 번이고 다시 잠글 수 없게 한다.
      await consumeVerification(verificationId);

      return Response.json({ success: true, message: "비밀번호가 변경되었습니다." });
    }

    return Response.json({ success: false, error: "Unknown action" });
  } catch (err: any) {
    return Response.json({ success: false, error: err?.message || "오류가 발생했습니다." });
  }
};

export const config: Config = {
  path: "/.netlify/functions/find-account",
};
