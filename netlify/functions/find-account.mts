import { createClient } from "@supabase/supabase-js";
import { getDatabase } from "@netlify/database";
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

async function isPhoneVerified(phone: string, purpose: string): Promise<boolean> {
  const db = getDatabase();
  const results = await db.sql`
    SELECT 1 FROM sms_verifications
    WHERE phone = ${phone}
      AND purpose = ${purpose}
      AND verified = TRUE
      AND expires_at > NOW() - INTERVAL '10 minutes'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return results.length > 0;
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
    const verified = await isPhoneVerified(cleanPhone, purpose);
    if (!verified) {
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

    if (action === "reset-password") {
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
