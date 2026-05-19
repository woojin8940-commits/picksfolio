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
    const { kakao_user_id, username, password } = await req.json();

    if (!kakao_user_id || !username || !password) {
      return Response.json({
        success: false,
        error: "카카오 사용자 ID, 아이디, 비밀번호를 모두 입력해 주세요.",
      });
    }

    const supabase = getSupabaseAdmin();
    const usernameClean = username.trim().toLowerCase();
    const isEmail = usernameClean.includes("@");
    const email = isEmail ? usernameClean : `${usernameClean}@picks.me`;

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (authError || !authData?.user) {
      return Response.json({
        success: false,
        error: "비밀번호가 올바르지 않습니다.",
      });
    }

    const existingUserId = authData.user.id;

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", existingUserId)
      .maybeSingle();

    if (!existingProfile) {
      return Response.json({
        success: false,
        error: "기존 계정의 프로필을 찾을 수 없습니다.",
      });
    }

    const { data: kakaoProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", kakao_user_id)
      .maybeSingle();

    let kakaoAuthUser: any = null;
    try {
      const { data: kakaoAuth } = await supabase.auth.admin.getUserById(kakao_user_id);
      kakaoAuthUser = kakaoAuth?.user || null;
    } catch {}

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (kakaoProfile) {
      if (kakaoProfile.kakao_id) updates.kakao_id = kakaoProfile.kakao_id;
      if (kakaoProfile.avatar_url && !existingProfile.avatar_url)
        updates.avatar_url = kakaoProfile.avatar_url;
      if (kakaoProfile.full_name && !existingProfile.full_name)
        updates.full_name = kakaoProfile.full_name;
      if (kakaoProfile.phone && !existingProfile.phone)
        updates.phone = kakaoProfile.phone;
    }

    if (!updates.kakao_id) {
      const kakaoIdFromAuth = String(
        kakaoAuthUser?.user_metadata?.provider_id ||
        kakaoAuthUser?.user_metadata?.sub ||
        ""
      );
      if (kakaoIdFromAuth) updates.kakao_id = kakaoIdFromAuth;
    }

    const kakaoEmail = kakaoAuthUser?.email || kakaoProfile?.email || "";
    if (kakaoEmail && !kakaoEmail.endsWith("@picks.me")) {
      updates.email = kakaoEmail;
    }

    await supabase
      .from("profiles")
      .update(updates)
      .eq("id", existingUserId);

    if (kakaoProfile && kakaoProfile.id !== existingUserId) {
      const { error: syncError } = await supabase
        .from("profiles")
        .update({
          username: existingProfile.username,
          email: existingProfile.email || kakaoProfile.email || "",
          full_name: existingProfile.full_name || kakaoProfile.full_name || "",
          phone: existingProfile.phone || kakaoProfile.phone || "",
          avatar_url: existingProfile.avatar_url || kakaoProfile.avatar_url || "",
          kakao_id: kakaoProfile.kakao_id || updates.kakao_id || "",
          role: existingProfile.role || "user",
          updated_at: new Date().toISOString(),
        })
        .eq("id", kakao_user_id);

      if (syncError) {
        await supabase.from("profiles").update({
          username: "",
          kakao_id: kakaoProfile.kakao_id || updates.kakao_id || "",
          role: existingProfile.role || "user",
          updated_at: new Date().toISOString(),
        }).eq("id", kakao_user_id);
      }
    } else if (!kakaoProfile && kakao_user_id !== existingUserId) {
      const kakaoIdForFallback = updates.kakao_id || kakao_user_id;
      const { error: createError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: kakao_user_id,
            username: existingProfile.username,
            email: existingProfile.email || "",
            full_name: existingProfile.full_name || "",
            phone: existingProfile.phone || "",
            avatar_url: existingProfile.avatar_url || "",
            kakao_id: updates.kakao_id || "",
            role: existingProfile.role || "user",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );

      if (createError) {
        await supabase
          .from("profiles")
          .upsert(
            {
              id: kakao_user_id,
              username: "",
              email: existingProfile.email || "",
              full_name: existingProfile.full_name || "",
              phone: existingProfile.phone || "",
              avatar_url: existingProfile.avatar_url || "",
              kakao_id: updates.kakao_id || "",
              role: existingProfile.role || "user",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" }
          )
          .then(({ error }) => {
            if (error) console.error("Failed to create Kakao profile alias:", error.message);
          });
      }
    }

    return Response.json({
      success: true,
      username: existingProfile.username,
      profile: {
        ...existingProfile,
        ...updates,
      },
    });
  } catch (err: any) {
    return Response.json({
      success: false,
      error: err?.message || "계정 연동 중 오류가 발생했습니다.",
    });
  }
};

export const config: Config = {
  path: "/api/kakao-link-account",
};
