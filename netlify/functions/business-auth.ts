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
    const body = JSON.parse(event.body || "{}");
    const { action } = body;

    if (action === "signup") {
      const { company_name, business_number, contact_person, contact_email, contact_phone, username, password } = body;

      if (!username || !password || !company_name) {
        return { statusCode: 400, body: JSON.stringify({ error: "필수 항목을 입력해주세요." }) };
      }

      const virtualEmail = `biz_${username.trim().toLowerCase()}@picks.me`;

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
            role: "business",
            company_name,
            business_number: business_number || "",
            contact_person: contact_person || "",
            contact_email: contact_email || "",
            contact_phone: contact_phone || "",
          },
        },
      });

      if (authError) {
        return { statusCode: 400, body: JSON.stringify({ error: authError.message }) };
      }

      if (authData.user) {
        await supabase.from("profiles").insert([
          {
            id: authData.user.id,
            username: username.trim().toLowerCase(),
            email: virtualEmail,
            phone: contact_phone || "",
            full_name: contact_person || company_name,
            role: "business",
            site_data: {
              company_name,
              business_number: business_number || "",
              contact_person: contact_person || "",
              contact_email: contact_email || "",
              contact_phone: contact_phone || "",
            },
          },
        ]);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: "비즈니스 회원가입이 완료되었습니다." }),
      };
    }

    if (action === "login") {
      const { username, password } = body;

      if (!username || !password) {
        return { statusCode: 400, body: JSON.stringify({ error: "아이디와 비밀번호를 입력해주세요." }) };
      }

      const virtualEmail = `biz_${username.trim().toLowerCase()}@picks.me`;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: virtualEmail,
        password,
      });

      if (error) {
        return { statusCode: 401, body: JSON.stringify({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }) };
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("username, site_data")
        .eq("id", data.user.id)
        .maybeSingle();

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          username: profileData?.username || username.trim().toLowerCase(),
          company_name: profileData?.site_data?.company_name || "",
          access_token: data.session?.access_token || "",
          refresh_token: data.session?.refresh_token || "",
        }),
      };
    }

    if (action === "profile") {
      const { username } = body;

      if (!username) {
        return { statusCode: 400, body: JSON.stringify({ error: "사용자 정보가 필요합니다." }) };
      }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("username, full_name, site_data")
        .eq("username", username.trim().toLowerCase())
        .maybeSingle();

      if (!profileData) {
        return { statusCode: 404, body: JSON.stringify({ error: "프로필을 찾을 수 없습니다." }) };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          profile: {
            username: profileData.username,
            company_name: profileData.site_data?.company_name || "",
            contact_person: profileData.site_data?.contact_person || "",
            contact_email: profileData.site_data?.contact_email || "",
            contact_phone: profileData.site_data?.contact_phone || "",
          },
        }),
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "유효하지 않은 요청입니다." }) };
  } catch (error: any) {
    console.error("Business auth error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "서버 오류가 발생했습니다." }) };
  }
};

export { handler };
