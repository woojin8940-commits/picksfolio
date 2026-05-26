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
    const { action, phone, account_type } = body;

    if (!phone) {
      return Response.json({ success: false, error: "전화번호를 입력해 주세요." });
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

    if (action === "find-id") {
      if (account_type === "business") {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("username, full_name, created_at")
          .eq("phone", cleanPhone)
          .in("role", ["operator", "admin"]);

        if (!profiles || profiles.length === 0) {
          return Response.json({ success: false, error: "해당 전화번호로 등록된 비즈니스 계정이 없습니다." });
        }

        return Response.json({
          success: true,
          accounts: profiles.map((p) => ({
            username: p.username,
            display_name: p.full_name || "",
            created_at: p.created_at,
          })),
        });
      } else {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("username, full_name, created_at")
          .eq("phone", cleanPhone)
          .eq("role", "user");

        if (!profiles || profiles.length === 0) {
          return Response.json({ success: false, error: "해당 전화번호로 등록된 계정이 없습니다." });
        }

        return Response.json({
          success: true,
          accounts: profiles.map((p) => ({
            username: p.username,
            display_name: p.full_name || "",
            created_at: p.created_at,
          })),
        });
      }
    }

    if (action === "reset-password") {
      const { username, new_password } = body;

      if (!username || !new_password) {
        return Response.json({ success: false, error: "아이디와 새 비밀번호를 입력해 주세요." });
      }

      if (new_password.length < 6) {
        return Response.json({ success: false, error: "비밀번호는 6자 이상이어야 합니다." });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id, phone")
        .eq("username", username)
        .maybeSingle();

      if (!profile) {
        return Response.json({ success: false, error: "존재하지 않는 계정입니다." });
      }

      if (profile.phone !== cleanPhone) {
        return Response.json({ success: false, error: "전화번호가 일치하지 않습니다." });
      }

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
