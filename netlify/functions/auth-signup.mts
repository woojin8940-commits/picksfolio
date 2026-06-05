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

// Convert a Korean phone number (e.g. "01012345678") to E.164 ("+821012345678")
// so it can be stored in the Supabase auth.users phone column.
function toE164KR(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("82")) return `+${digits}`;
  if (digits.startsWith("0")) return `+82${digits.slice(1)}`;
  return `+82${digits}`;
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
    const { username, password, phone, full_name, email: emailInput } =
      await req.json();

    if (!username || !password) {
      return Response.json({
        success: false,
        error: "아이디와 비밀번호를 입력해 주세요.",
      });
    }

    const cleanEmail = (emailInput || "").trim().toLowerCase();
    if (!cleanEmail) {
      return Response.json({
        success: false,
        error: "이메일을 입력해 주세요.",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return Response.json({
        success: false,
        error: "올바른 이메일 형식이 아닙니다.",
      });
    }

    const supabase = getSupabaseAdmin();
    const cleanUsername = username.trim().toLowerCase();
    const email = cleanEmail;
    const cleanPhone = (phone || "").replace(/\D/g, "");
    const phoneE164 = toE164KR(cleanPhone);

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
        ...(phoneE164 ? { phone: phoneE164, phone_confirm: true } : {}),
        user_metadata: {
          full_name: full_name || username,
          phone: cleanPhone,
        },
      });

    if (authError) {
      const msg = authError.message || "";
      if (
        msg.includes("already been registered") ||
        msg.includes("already exists") ||
        msg.toLowerCase().includes("email")
      ) {
        return Response.json({
          success: false,
          error: "이미 사용 중인 이메일입니다.",
        });
      }
      if (msg.toLowerCase().includes("phone")) {
        return Response.json({
          success: false,
          error: "이미 사용 중인 휴대폰 번호입니다.",
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
          phone: cleanPhone,
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
