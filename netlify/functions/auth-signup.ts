import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "서버 설정 오류" }) };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { username, password, phone, full_name } = JSON.parse(event.body || "{}");

    if (!username || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: "아이디와 비밀번호를 입력해주세요." }) };
    }

    const virtualEmail = `${username.trim().toLowerCase()}@picks.me`;

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("username")
      .eq("username", username.trim().toLowerCase())
      .maybeSingle();

    if (existingProfile) {
      return { statusCode: 409, body: JSON.stringify({ error: "이미 사용 중인 아이디입니다." }) };
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: virtualEmail,
      password,
      options: {
        data: {
          username: username.trim().toLowerCase(),
          phone: phone || "",
          full_name: full_name || username,
        },
      },
    });

    if (authError) {
      if (authError.message.includes("already registered")) {
        return { statusCode: 409, body: JSON.stringify({ error: "이미 가입된 아이디입니다." }) };
      }
      return { statusCode: 400, body: JSON.stringify({ error: authError.message }) };
    }

    if (authData.user) {
      await supabase.from("profiles").insert([
        {
          id: authData.user.id,
          username: username.trim().toLowerCase(),
          email: virtualEmail,
          phone: phone || "",
          full_name: full_name || username,
          site_data: {},
        },
      ]);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "회원가입이 완료되었습니다." }),
    };
  } catch (error: any) {
    console.error("Signup error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "서버 오류가 발생했습니다." }) };
  }
};

export { handler };
