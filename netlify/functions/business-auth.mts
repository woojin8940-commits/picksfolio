import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";
import { verifyBusinessStatus } from "./_shared/nts-business.mts";
import {
  consumePhoneVerification,
  findVerifiedPhone,
  phoneNotVerifiedResponse,
} from "./_shared/phone-verification.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { checkUsernameRules } from "./_shared/username-rules.mts";
import { usernameHasBlobLeftovers } from "./_shared/username-leftovers.mts";
import { attachAuthPhone } from "./_shared/auth-phone.mts";

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

function getSupabaseAdmin() {
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * 계정은 없는데 예전 계정의 기록이 남아 있는 아이디인지(지워진 계정의 이름).
 *
 * 페이지(site_data)와, 결제 · 인스타그램 연동 기록(_shared/username-leftovers)을 함께 본다.
 * 크리에이터 가입도 같은 기준으로 막는다(auth-check-username · auth-claim-username · auth-signup).
 * 확인하지 못하면 null — 호출부는 가입을 막는다.
 */
async function usernameHasLeftovers(username: string): Promise<boolean | null> {
  try {
    if (await usernameHasBlobLeftovers(username)) return true;
    const { getDatabase } = await import("@picks/netlify-database");
    const rows = await getDatabase().sql`SELECT 1 FROM site_data WHERE username = ${username} LIMIT 1`;
    return rows.length > 0;
  } catch (e) {
    console.error("[business-auth] leftover lookup failed:", (e as Error)?.message);
    return null;
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "login") {
      const { username, password } = body;
      if (!username || !password) {
        return Response.json({ success: false, error: "필수 정보를 입력해 주세요." });
      }

      const supabase = getSupabaseAdmin();
      const cleanUsername = username.trim().toLowerCase();
      const email = `biz_${cleanUsername}@picks.me`;

      let { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({ email, password });

      // 비즈니스 로그인은 biz_ 형식으로만 찾는다. 예외는 관리자 계정 하나뿐이다 —
      // 관리자 계정은 biz_ 접두사 없이 만들어져 있으므로, 비즈니스 계정으로 찾지
      // 못했고 그 아이디가 관리자(role=admin)일 때만 관리자 계정 이메일로 다시
      // 시도한다. 이 경로로 들어온 계정은 아래에서 관리자인지 한 번 더 확인한다.
      let viaAdminFallback = false;
      if (authError && !cleanUsername.includes("@")) {
        const { data: profileByUsername } = await supabase
          .from("profiles")
          .select("email, role")
          .eq("username", cleanUsername)
          .maybeSingle();
        if (String(profileByUsername?.role || "").trim().toLowerCase() === "admin") {
          viaAdminFallback = true;
          const adminEmails = [
            String(profileByUsername?.email || "").trim().toLowerCase(),
            `${cleanUsername}@picks.me`,
          ].filter((e, i, arr) => e && arr.indexOf(e) === i);
          for (const adminEmail of adminEmails) {
            ({ data: authData, error: authError } =
              await supabase.auth.signInWithPassword({ email: adminEmail, password }));
            if (!authError) break;
          }
        }
      }

      if (authError) {
        return Response.json({ success: false, error: "존재하지 않는 정보입니다. 아이디 또는 비밀번호를 확인해 주세요." });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authData.user.id)
        .maybeSingle();

      const profileRole = String(profile?.role || "").trim().toLowerCase();
      if (!profile || !["admin", "operator"].includes(profileRole) || (viaAdminFallback && profileRole !== "admin")) {
        return Response.json({ success: false, error: "비즈니스 계정을 찾을 수 없습니다." });
      }

      return Response.json({
        success: true,
        username: profile.username,
        company_name: profile.full_name || "",
        role: profileRole,
        access_token: authData.session?.access_token || "",
        refresh_token: authData.session?.refresh_token || "",
      });
    }

    if (action === "signup") {
      const { company_name, business_number, contact_person, contact_email, contact_phone, username, password } = body;

      if (!company_name || !business_number || !contact_person || !contact_email || !username || !password) {
        return Response.json({ success: false, error: "모든 필수 항목을 입력해 주세요." });
      }

      const cleanUsername = String(username).trim().toLowerCase();
      const cleanContactEmail = String(contact_email).trim().toLowerCase();
      // 비즈니스 아이디도 같은 profiles.username 칸에 저장되므로(=같은 주소
      // 공간이다) 크리에이터 가입과 같은 규칙을 쓴다.
      const usernameRules = checkUsernameRules(cleanUsername);
      if (!usernameRules.ok) {
        return Response.json({ success: false, error: usernameRules.error });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanContactEmail)) {
        return Response.json({ success: false, error: "올바른 이메일 형식이 아닙니다." });
      }

      // 담당자 휴대폰도 서버에서 인증을 확인한다. 사업자번호는 아래에서 국세청에
      // 재조회하지만 연락처는 아무도 확인하지 않았고, 캠페인 알림 · 정산 안내가
      // 전부 이 번호로 나간다.
      const cleanContactPhone = (contact_phone || "").replace(/\D/g, "");
      if (!cleanContactPhone) {
        return Response.json({ success: false, error: "담당자 휴대폰 번호를 입력해 주세요." });
      }
      const phoneVerification = await findVerifiedPhone(cleanContactPhone, "business_signup");
      if (!phoneVerification) {
        return phoneNotVerifiedResponse();
      }

      // 국세청 사업자등록정보 상태조회로 서버 측에서 재검증한다(클라이언트 플래그를 신뢰하지 않음).
      const ntsResult = await verifyBusinessStatus(business_number);
      if (!ntsResult.verified) {
        return Response.json({
          success: false,
          error: ntsResult.error || "유효한 사업자등록번호가 아닙니다. 사업자 조회를 확인해 주세요.",
        });
      }

      const supabase = getSupabaseAdmin();
      const email = `biz_${cleanUsername}@picks.me`;

      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", cleanUsername)
        .maybeSingle();

      if (existingProfile) {
        return Response.json({ success: false, error: "이미 사용 중인 아이디입니다." });
      }

      const leftovers = await usernameHasLeftovers(cleanUsername);
      if (leftovers === null) {
        return Response.json({ success: false, error: "아이디를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." });
      }
      if (leftovers) {
        return Response.json({ success: false, error: "이미 사용 중인 아이디입니다." });
      }

      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            company_name,
            business_number,
            business_verified: true,
            business_status: ntsResult.status || "계속사업자",
            business_verified_at: new Date().toISOString(),
            contact_person,
            contact_email: cleanContactEmail,
            contact_phone: (contact_phone || "").replace(/\D/g, ""),
          },
        });

      if (authError) {
        if (authError.message.includes("already been registered")) {
          return Response.json({ success: false, error: "이미 사용 중인 아이디입니다." });
        }
        return Response.json({ success: false, error: authError.message });
      }

      if (authData.user) {
        const { error: profileError } = await supabase.from("profiles").upsert(
          {
            id: authData.user.id,
            username: cleanUsername,
            email: cleanContactEmail,
            full_name: company_name,
            phone: (contact_phone || "").replace(/\D/g, ""),
            role: "operator",
          },
          { onConflict: "id" }
        );
        if (profileError) {
          await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
          return Response.json({ success: false, error: "회원정보를 저장하지 못했습니다. 다시 시도해 주세요." });
        }
        await attachAuthPhone(supabase, authData.user.id, cleanContactPhone);
      }

      await consumePhoneVerification(phoneVerification.id);

      return Response.json({ success: true, username: cleanUsername });
    }

    if (action === "profile") {
      const username = String(body.username || "").trim().toLowerCase().replace(/^biz\//, "");
      if (!username) {
        return Response.json({ success: false, error: "Missing username" }, { status: 400 });
      }
      const auth = await requireAccountOwner(req, username);
      if (!auth.ok) return auth.response;

      const supabase = getSupabaseAdmin();
      const [{ data: profile }, { data: authData }] = await Promise.all([
        supabase
          .from("profiles")
          .select("username, full_name, email, phone")
          .eq("id", auth.userId)
          .maybeSingle(),
        supabase.auth.admin.getUserById(auth.userId),
      ]);
      const metadata = authData?.user?.user_metadata || {};

      return Response.json({
        success: true,
        profile: profile ? {
          company_name: profile.full_name || metadata.company_name || "",
          contact_person: metadata.contact_person || "",
          contact_email: profile.email || metadata.contact_email || "",
          contact_phone: profile.phone || metadata.contact_phone || "",
        } : null,
      });
    }

    return Response.json({ success: false, error: "Unknown action" });
  } catch (err: any) {
    return Response.json({ success: false, error: err?.message || "오류가 발생했습니다." });
  }
};

export const config: Config = {
  path: "/.netlify/functions/business-auth",
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: "ip" },
};
