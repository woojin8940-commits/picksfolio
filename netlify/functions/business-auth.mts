import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";
import { verifyBusinessStatus } from "./_shared/nts-business.mts";
import {
  consumePhoneVerification,
  findVerifiedPhone,
  phoneNotVerifiedResponse,
} from "./_shared/phone-verification.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

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

      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        return Response.json({ success: false, error: "존재하지 않는 정보입니다. 아이디 또는 비밀번호를 확인해 주세요." });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (!profile || !["admin", "operator"].includes(profile.role || "")) {
        return Response.json({ success: false, error: "비즈니스 계정을 찾을 수 없습니다." });
      }

      return Response.json({
        success: true,
        username: profile.username,
        company_name: profile.full_name || "",
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
      if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
        return Response.json({ success: false, error: "아이디는 영문 소문자, 숫자, 밑줄로 3~20자까지 입력해 주세요." });
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
