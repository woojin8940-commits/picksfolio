import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const handler: Handler = async (event) => {
  const code = event.queryStringParameters?.code;
  const errorParam = event.queryStringParameters?.error;
  const siteUrl = process.env.URL || `https://${event.headers.host}`;

  if (errorParam) {
    const desc = event.queryStringParameters?.error_description || errorParam;
    console.error("[kakao-login-callback] Kakao error:", desc);
    return {
      statusCode: 302,
      headers: { Location: `${siteUrl}/login?error=${encodeURIComponent(desc)}` },
      body: "",
    };
  }

  if (!code) {
    return {
      statusCode: 302,
      headers: { Location: `${siteUrl}/login?error=missing_code` },
      body: "",
    };
  }

  const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

  if (!KAKAO_KEY || !SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error("[kakao-login-callback] Missing env vars");
    return {
      statusCode: 302,
      headers: { Location: `${siteUrl}/login?error=server_config` },
      body: "",
    };
  }

  const redirectUri = `${siteUrl}/api/kakao/callback`;

  try {
    // 1. Exchange authorization code for Kakao tokens
    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: KAKAO_KEY,
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokens = await tokenRes.json();

    if (!tokens.access_token) {
      console.error("[kakao-login-callback] Token exchange failed:", JSON.stringify(tokens));
      return {
        statusCode: 302,
        headers: { Location: `${siteUrl}/login?error=token_exchange_failed` },
        body: "",
      };
    }

    // 2. Get user info from Kakao API
    const userRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const kakaoUser = await userRes.json();

    const kakaoId = String(kakaoUser.id || "");
    const account = kakaoUser.kakao_account || {};
    const name = account.profile?.nickname || "";
    const email = account.email || `kakao_${kakaoId}@picks.kakao`;
    const phone = (account.phone_number || "").replace(/[^0-9]/g, "").replace(/^82/, "0");

    if (!kakaoId) {
      console.error("[kakao-login-callback] No kakao user ID");
      return {
        statusCode: 302,
        headers: { Location: `${siteUrl}/login?error=kakao_user_not_found` },
        body: "",
      };
    }

    // 3. Create or update Supabase user
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const pwd = createHash("sha256")
      .update(`kakao:${kakaoId}:${SERVICE_KEY}`)
      .digest("hex")
      .slice(0, 32);

    let userId = "";

    const { data: created } = await supabase.auth.admin.createUser({
      email,
      password: pwd,
      email_confirm: true,
      user_metadata: { full_name: name, phone, kakao_id: kakaoId },
      app_metadata: { provider: "kakao", providers: ["kakao"] },
    });

    if (created?.user) {
      userId = created.user.id;
    } else {
      // User already exists — find them via generateLink and update password
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      if (linkData?.user) {
        userId = linkData.user.id;
        await supabase.auth.admin.updateUserById(userId, {
          password: pwd,
          user_metadata: {
            ...(linkData.user.user_metadata || {}),
            full_name: name || linkData.user.user_metadata?.full_name,
            phone: phone || linkData.user.user_metadata?.phone,
            kakao_id: kakaoId,
          },
          app_metadata: { provider: "kakao", providers: ["kakao"] },
        });
      }
    }

    if (!userId) {
      console.error("[kakao-login-callback] Could not create or find user");
      return {
        statusCode: 302,
        headers: { Location: `${siteUrl}/login?error=user_setup_failed` },
        body: "",
      };
    }

    // 4. Set up profile in database
    const username = (name || email.split("@")[0] || `kakao_${kakaoId}`)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (!existingProfile) {
      await supabase.from("profiles").insert([{
        id: userId,
        username,
        email,
        phone,
        full_name: name,
        role: "user",
        site_data: { kakao_id: kakaoId },
      }]);
    } else {
      const updates: Record<string, any> = {};
      if (phone && !existingProfile.phone) updates.phone = phone;
      if (name && !existingProfile.full_name) updates.full_name = name;
      updates.site_data = { ...(existingProfile.site_data || {}), kakao_id: kakaoId };
      await supabase.from("profiles").update(updates).eq("id", userId);
    }

    // 5. Sign in to get session tokens
    const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password: pwd }),
    });

    if (!signInRes.ok) {
      const errBody = await signInRes.text();
      console.error("[kakao-login-callback] Sign-in failed:", signInRes.status, errBody);
      return {
        statusCode: 302,
        headers: { Location: `${siteUrl}/login?error=session_failed` },
        body: "",
      };
    }

    const session = await signInRes.json();

    if (!session.access_token) {
      console.error("[kakao-login-callback] No access_token in sign-in response");
      return {
        statusCode: 302,
        headers: { Location: `${siteUrl}/login?error=no_session` },
        body: "",
      };
    }

    // 6. Redirect to frontend with session tokens in URL hash
    //    Supabase JS client auto-detects these and establishes the session
    const hash = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token || "",
      expires_in: String(session.expires_in || 3600),
      token_type: "bearer",
    });

    return {
      statusCode: 302,
      headers: { Location: `${siteUrl}/auth-callback#${hash.toString()}` },
      body: "",
    };
  } catch (err: any) {
    console.error("[kakao-login-callback] Unexpected error:", err);
    return {
      statusCode: 302,
      headers: { Location: `${siteUrl}/login?error=server_error` },
      body: "",
    };
  }
};

export { handler };
