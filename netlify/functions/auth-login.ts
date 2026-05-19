import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("[auth-login] Missing env vars:", { url: !!supabaseUrl, key: !!supabaseServiceKey });
    return { statusCode: 500, body: JSON.stringify({ error: "서버 설정 오류" }) };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { username, password } = JSON.parse(event.body || "{}");

    if (!username || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: "아이디와 비밀번호를 입력해주세요." }) };
    }

    const virtualEmail = `${username.trim().toLowerCase()}@picks.me`;

    const { data, error } = await supabase.auth.signInWithPassword({
      email: virtualEmail,
      password,
    });

    if (error) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }),
      };
    }

    const { data: profileData } = await supabase
      .from("profiles")
      .select("username, phone, site_data")
      .eq("id", data.user.id)
      .maybeSingle();

    const userId = profileData?.username || username.trim().toLowerCase();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        username: userId,
        phone: profileData?.phone || "",
        has_site_data: !!(profileData?.site_data && Object.keys(profileData.site_data).length > 0),
        access_token: data.session?.access_token || "",
        refresh_token: data.session?.refresh_token || "",
      }),
    };
  } catch (error: any) {
    console.error("Login error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "서버 오류가 발생했습니다." }) };
  }
};

export { handler };
