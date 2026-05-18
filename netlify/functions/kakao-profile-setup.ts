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
    const { user_id, user_metadata, identities, email, provider_token, client_kakao_phone, client_kakao_name } = JSON.parse(event.body || "{}");

    if (!user_id) {
      return { statusCode: 400, body: JSON.stringify({ error: "사용자 ID가 필요합니다." }) };
    }

    let phone = client_kakao_phone || "";
    let full_name = client_kakao_name || "";
    let kakao_id = "";

    if (user_metadata) {
      if (!full_name) {
        full_name = user_metadata.full_name || user_metadata.name || user_metadata.preferred_username || "";
      }
      if (!phone && user_metadata.phone_number) {
        phone = user_metadata.phone_number.replace(/[^0-9]/g, "").replace(/^82/, "0");
      }
    }

    if (identities && Array.isArray(identities)) {
      const kakaoIdentity = identities.find((id: any) => id.provider === "kakao");
      if (kakaoIdentity) {
        kakao_id = kakaoIdentity.id || "";
        const idData = kakaoIdentity.identity_data || {};
        if (!full_name) {
          full_name = idData.full_name || idData.name || "";
        }
        if (!phone && idData.phone_number) {
          phone = idData.phone_number.replace(/[^0-9]/g, "").replace(/^82/, "0");
        }
      }
    }

    if (provider_token) {
      try {
        const kakaoRes = await fetch("https://kapi.kakao.com/v2/user/me", {
          headers: { Authorization: `Bearer ${provider_token}` },
        });
        if (kakaoRes.ok) {
          const kakaoData = await kakaoRes.json();
          if (!kakao_id && kakaoData.id) kakao_id = String(kakaoData.id);
          const account = kakaoData.kakao_account || {};
          if (!phone && account.phone_number) {
            phone = account.phone_number.replace(/[^0-9]/g, "").replace(/^82/, "0");
          }
          if (!full_name && account.profile?.nickname) {
            full_name = account.profile.nickname;
          }
        }
      } catch (e) {
        console.warn("Kakao API fallback failed:", e);
      }
    }

    const username = (full_name || email?.split("@")[0] || `kakao_${kakao_id || user_id.slice(0, 8)}`).toLowerCase().replace(/[^a-z0-9_]/g, "");

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user_id)
      .maybeSingle();

    if (existingProfile) {
      const updates: any = {};
      if (phone && !existingProfile.phone) updates.phone = phone;
      if (full_name && !existingProfile.full_name) updates.full_name = full_name;
      if (kakao_id) {
        updates.site_data = { ...(existingProfile.site_data || {}), kakao_id };
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from("profiles").update(updates).eq("id", user_id);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          profile: {
            username: existingProfile.username,
            role: existingProfile.role || "user",
            phone: phone || existingProfile.phone || "",
            kakao_id,
            full_name: full_name || existingProfile.full_name || "",
            email: existingProfile.email || email || "",
          },
        }),
      };
    }

    await supabase.from("profiles").insert([
      {
        id: user_id,
        username,
        email: email || "",
        phone,
        full_name,
        role: "user",
        site_data: { kakao_id },
      },
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        profile: {
          username,
          role: "user",
          phone,
          kakao_id,
          full_name,
          email: email || "",
        },
      }),
    };
  } catch (error: any) {
    console.error("Kakao profile setup error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "서버 오류가 발생했습니다." }) };
  }
};

export { handler };
