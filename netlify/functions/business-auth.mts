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
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("username", username.trim().toLowerCase())
        .maybeSingle();

      if (!profile || !["admin", "operator"].includes(profile.role || "")) {
        return Response.json({ success: false, error: "비즈니스 계정을 찾을 수 없습니다." });
      }

      return Response.json({ success: true, profile });
    }

    if (action === "signup") {
      return Response.json({ success: false, error: "비즈니스 계정은 관리자를 통해 생성됩니다." });
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
