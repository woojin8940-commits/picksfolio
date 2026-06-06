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

    // 아이디(링크 주소)는 변경할 수 없는 고유 식별자이므로 같은 아이디로는 재가입할 수 없다.
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

    // 같은 사람(휴대폰 번호 기준)이 이미 가입했어도 계정을 더 만들 수 있게 허용한다.
    // 단, 무제한 생성은 막기 위해 한 번호당 최대 10개까지만 만들 수 있도록 제한한다.
    const MAX_ACCOUNTS_PER_PERSON = 10;
    if (cleanPhone) {
      const { data: sameOwner } = await supabase
        .from("profiles")
        .select("id")
        .eq("phone", cleanPhone)
        .eq("role", "user");

      if ((sameOwner?.length || 0) >= MAX_ACCOUNTS_PER_PERSON) {
        return Response.json({
          success: false,
          error: `하나의 휴대폰 번호로는 최대 ${MAX_ACCOUNTS_PER_PERSON}개의 계정까지만 만들 수 있습니다.`,
        });
      }
    }

    // 동일인이 같은 이메일·휴대폰으로 여러 계정을 만들 수 있어야 하므로, Supabase
    // auth 단계의 고유 제약(이메일·휴대폰)에 막히지 않도록 처리한다.
    //  - 휴대폰: auth 단계에서 고유 제약을 걸지 않는다(번호는 profiles에만 저장).
    //  - 이메일: 실제 이메일로 먼저 시도하고, 이미 쓰인 이메일이면(=재가입) 아이디
    //    기반의 고유 이메일로 대체한다. 로그인은 profiles.email로 인증하므로,
    //    어떤 경우든 실제로 사용된 인증 이메일을 profiles.email에 저장한다.
    const userMetadata = {
      full_name: full_name || username,
      phone: cleanPhone,
      contact_email: email,
    };

    let authEmail = email;
    let { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      });

    if (authError) {
      const msg = (authError.message || "").toLowerCase();
      const emailTaken =
        msg.includes("already been registered") ||
        msg.includes("already exists") ||
        msg.includes("email");

      // 이미 가입한 사람의 재가입: 아이디 기반 고유 이메일로 다시 시도한다.
      // (아이디는 위에서 고유성이 보장됐으므로 이 이메일도 항상 고유하다.)
      if (emailTaken) {
        authEmail = `${cleanUsername}@picks.me`;
        ({ data: authData, error: authError } =
          await supabase.auth.admin.createUser({
            email: authEmail,
            password,
            email_confirm: true,
            user_metadata: userMetadata,
          }));
      }
    }

    if (authError) {
      return Response.json({ success: false, error: authError.message });
    }

    if (authData?.user) {
      await supabase.from("profiles").upsert(
        {
          id: authData.user.id,
          username: cleanUsername,
          email: authEmail,
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
