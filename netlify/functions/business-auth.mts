import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

function getSupabaseAdmin() {
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "login") {
      const { username, password } = body;
      if (!username || !password) {
        return Response.json({ success: false, error: "필수 정보를 입력해 주세요." });
      }

      const supabase = getSupabaseAdmin();
      const cleanUsername = username.trim().toLowerCase();
      const email = `biz_${cleanUsername}@picks.me`;

      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        return Response.json({ success: false, error: "존재하지 않는 정보입니다. 아이디 또는 비밀번호를 확인해 주세요." });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (!profile || !["admin", "operator"].includes(profile.role || "")) {
        return Response.json({ success: false, error: "비즈니스 계정을 찾을 수 없습니다." });
      }

      return Response.json({
        success: true,
        username: profile.username,
        company_name: profile.full_name || "",
        access_token: authData.session?.access_token || "",
        refresh_token: authData.session?.refresh_token || "",
      });
    }

    if (action === "signup") {
      const { company_name, business_number, contact_person, contact_email, contact_phone, username, password } = body;

      if (!company_name || !business_number || !contact_person || !contact_email || !username || !password) {
        return Response.json({ success: false, error: "모든 필수 항목을 입력해 주세요." });
      }

      const supabase = getSupabaseAdmin();
      const cleanUsername = username.trim().toLowerCase();
      const email = `biz_${cleanUsername}@picks.me`;

      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", cleanUsername)
        .maybeSingle();

      if (existingProfile) {
        return Response.json({ success: false, error: "이미 사용 중인 아이디입니다." });
      }

      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            company_name,
            business_number,
            contact_person,
            contact_email,
            contact_phone: (contact_phone || "").replace(/\D/g, ""),
          },
        });

      if (authError) {
        if (authError.message.includes("already been registered")) {
          return Response.json({ success: false, error: "이미 사용 중인 아이디입니다." });
        }
        return Response.json({ success: false, error: authError.message });
      }

      if (authData.user) {
        await supabase.from("profiles").upsert(
          {
            id: authData.user.id,
            username: cleanUsername,
            email: contact_email,
            full_name: company_name,
            phone: (contact_phone || "").replace(/\D/g, ""),
            role: "operator",
          },
          { onConflict: "id" }
        );
      }

      return Response.json({ success: true, username: cleanUsername });
    }

    if (action === "profile") {
      const { user_id } = body;
      if (!user_id) {
        return Response.json({ success: false, error: "Missing user_id" });
      }

      const supabase = getSupabaseAdmin();
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user_id)
        .maybeSingle();

      return Response.json({ success: true, profile: profile || null });
    }

    return Response.json({ success: false, error: "Unknown action" });
  } catch (err: any) {
    return Response.json({ success: false, error: err?.message || "오류가 발생했습니다." });
  }
};

export const config: Config = {
  path: "/.netlify/functions/business-auth",
};
