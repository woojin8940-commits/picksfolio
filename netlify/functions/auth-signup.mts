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

function generateProfileCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { username, password, phone, full_name } = await req.json();

    if (!username || !password) {
      return Response.json({
        success: false,
        error: "아이디와 비밀번호를 입력해 주세요.",
      });
    }

    const supabase = getSupabaseAdmin();
    const cleanUsername = username.trim().toLowerCase();
    const email = `${cleanUsername}@picks.me`;

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", cleanUsername)
      .maybeSingle();

    if (existingProfile) {
      return Response.json({
        success: false,
        error: "이미 사용 중인 아이디입니다.",
      });
    }

    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: full_name || username,
          phone: phone || "",
        },
      });

    if (authError) {
      if (authError.message.includes("already been registered")) {
        return Response.json({
          success: false,
          error: "이미 사용 중인 아이디입니다.",
        });
      }
      return Response.json({ success: false, error: authError.message });
    }

    if (authData.user) {
      await supabase.from("profiles").upsert(
        {
          id: authData.user.id,
          username: cleanUsername,
          email,
          full_name: full_name || "",
          phone: (phone || "").replace(/\D/g, ""),
          role: "user",
        },
        { onConflict: "id" }
      );
    }

    let profileCode = generateProfileCode();
    try {
      const db = getDatabase();
      let attempts = 0;
      while (attempts < 5) {
        const dup = await db.sql`SELECT 1 FROM site_data WHERE profile_code = ${profileCode}`;
        if (dup.length === 0) break;
        profileCode = generateProfileCode();
        attempts++;
      }

      const initialData = {
        profile: { name: full_name || cleanUsername, bio: "", avatar_url: "" },
        design: {},
        socials: {},
        category: "",
        tags: [],
        blocks: [],
      };

      await db.sql`
        INSERT INTO site_data (username, data, profile_code)
        VALUES (${cleanUsername}, ${JSON.stringify(initialData)}, ${profileCode})
        ON CONFLICT (username) DO NOTHING
      `;
    } catch {}

    return Response.json({
      success: true,
      username: cleanUsername,
      profile_code: profileCode,
    });
  } catch (err: any) {
    return Response.json({
      success: false,
      error: err?.message || "회원가입 중 오류가 발생했습니다.",
    });
  }
};
