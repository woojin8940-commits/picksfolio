import { createClient } from "@supabase/supabase-js";
import { getDatabase } from "@netlify/database";

const SUPABASE_URL =
  "https://rjksilpewohjvtbxrsvu.supabase.co";

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
    const { username, password } = await req.json();

    if (!username || !password) {
      return Response.json({
        success: false,
        error: "아이디와 비밀번호를 입력해 주세요.",
      });
    }

    const supabase = getSupabaseAdmin();
    const usernameClean = username.trim().toLowerCase();
    const isEmail = usernameClean.includes("@");
    const email = isEmail ? usernameClean : `${usernameClean}@picks.me`;

    const { data, error } =
      await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return Response.json({
        success: false,
        error: "존재하지 않는 정보입니다. 아이디 또는 비밀번호를 확인해 주세요.",
      });
    }

    let { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();

    const resolvedUsername = profile?.username || usernameClean.replace(/@.*$/, "");

    if (!profile && resolvedUsername) {
      const { data: createdProfile } = await supabase
        .from("profiles")
        .upsert(
          {
            id: data.user.id,
            username: resolvedUsername,
            email,
            role: "user",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        )
        .select("*")
        .maybeSingle();
      if (createdProfile) profile = createdProfile;
    }

    let hasSiteData = false;
    let profileCode = "";
    if (resolvedUsername) {
      try {
        const db = getDatabase();
        const result = await db.sql`
          SELECT profile_code, data FROM site_data WHERE username = ${resolvedUsername}
        `;
        if (result.length > 0) {
          profileCode = result[0].profile_code || "";
          const siteData = result[0].data;
          hasSiteData = !!(
            siteData &&
            siteData.blocks &&
            Array.isArray(siteData.blocks) &&
            siteData.blocks.length > 0
          );
        } else {
          const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          let newCode = "";
          for (let i = 0; i < 6; i++) {
            newCode += chars.charAt(Math.floor(Math.random() * chars.length));
          }

          const initialData: Record<string, any> = {
            profile: {
              name: profile?.nickname || profile?.full_name || resolvedUsername,
              bio: profile?.bio || "",
              avatar_url: profile?.avatar_url || "",
            },
            design: {},
            socials: {},
            blocks: [],
          };

          await db.sql`
            INSERT INTO site_data (username, data, profile_code)
            VALUES (${resolvedUsername}, ${JSON.stringify(initialData)}, ${newCode})
          `;
          profileCode = newCode;
        }
      } catch {}
    }

    return Response.json({
      success: true,
      username: resolvedUsername,
      has_site_data: hasSiteData,
      phone: profile?.phone || "",
      role: profile?.role || "user",
      profile_code: profileCode,
      access_token: data.session?.access_token || "",
      refresh_token: data.session?.refresh_token || "",
    });
  } catch (err: any) {
    return Response.json({
      success: false,
      error: err?.message || "로그인 중 오류가 발생했습니다.",
    });
  }
};
