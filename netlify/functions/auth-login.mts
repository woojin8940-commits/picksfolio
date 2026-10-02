import { createClient } from "@supabase/supabase-js";
import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";

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

    // Resolve the real auth email. Accounts now sign up with a user-supplied
    // email, so look it up by username. Older accounts created with the
    // generated `<username>@picks.me` identifier still resolve via the
    // fallback below, keeping login backward compatible.
    let email: string;
    if (isEmail) {
      email = usernameClean;
    } else {
      const { data: profileByUsername } = await supabase
        .from("profiles")
        .select("email")
        .eq("username", usernameClean)
        .maybeSingle();
      email = profileByUsername?.email || `${usernameClean}@picks.me`;
    }

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

    // 인플루언서(일반 유저)는 카카오 간편로그인으로만 들어온다. 아이디·비밀번호 로그인은
    // 운영자(role=admin)가 운영 콘솔(/operator-login)에 들어올 때만 남긴다. 예전 아이디·
    // 비밀번호 계정의 유저네임은 카카오로 다시 가입한 뒤 링크 만들기 화면에서 이어받는다
    // (auth-claim-username · _shared/legacy-username).
    if (String(profile?.role || "").trim().toLowerCase() !== "admin") {
      return Response.json({
        success: false,
        code: "KAKAO_ONLY",
        error: "인플루언서 계정은 카카오 간편로그인으로만 로그인할 수 있어요. 카카오로 시작하면 쓰던 링크를 그대로 이어받을 수 있습니다.",
      });
    }

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

          // 아직 site_data 가 없던 계정에 처음 만들어 주는 페이지. 표시 이름은
          // auth-signup 과 같은 기준으로 아이디를 넣는다 — 공개 페이지의 이름과
          // 주소가 어긋나지 않게, 그리고 실명(full_name)이 본인도 모르게 공개
          // 페이지에 올라가지 않게 한다.
          const initialData: Record<string, any> = {
            profile: {
              name: resolvedUsername,
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

export const config: Config = {
  path: "/.netlify/functions/auth-login",
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: "ip" },
};
