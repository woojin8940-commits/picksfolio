import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";

const SUPABASE_URL =
  "https://rjksilpewohjvtbxrsvu.supabase.co";

function getSupabaseAdmin() {
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function normalizePhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0082")) return `0${digits.slice(4)}`;
  if (digits.startsWith("82")) return `0${digits.slice(2)}`;
  return digits;
}

function extractKakaoPhone(
  identityData: Record<string, any>,
): string {
  const raw =
    identityData?.phone_number ||
    identityData?.kakao_account?.phone_number ||
    "";
  if (!raw) return "";
  return normalizePhone(raw);
}

function extractKakaoName(
  userMetadata: Record<string, any>,
  identityData: Record<string, any>,
  clientName: string
): string {
  const name =
    clientName ||
    userMetadata?.kakao_account?.name ||
    identityData?.kakao_account?.name ||
    identityData?.name ||
    identityData?.full_name ||
    userMetadata?.full_name ||
    userMetadata?.name ||
    "";
  if (!name || name.trim() === "" || name.trim() === ".") return "";
  return name.trim();
}

async function fetchKakaoProfile(providerToken: string) {
  if (!providerToken) return null;
  try {
    const res = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function isRealUsername(username: string | null | undefined): boolean {
  return !!username && !username.startsWith("_kakao_") && !username.startsWith("_kk_");
}

/**
 * 카카오가 확인해 준 휴대폰 번호를 Auth 의 app_metadata 에 남긴다.
 *
 * 예전 아이디·비밀번호 계정의 링크를 번호로 이어받을 때(auth-claim-username) 이 값만
 * 본다. profiles.phone 은 로그인한 본인이 화면에서 직접 고칠 수 있는 칸이라, 그 값을
 * 믿으면 남의 번호를 적어 넣고 남의 링크 · 페이지 · 정산 기록을 가져갈 수 있다.
 * app_metadata 는 서비스 롤 키로만 쓸 수 있다.
 */
async function rememberVerifiedKakaoPhone(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  user: { id: string; app_metadata?: Record<string, any> },
  phone: string,
) {
  if (!phone || user.app_metadata?.kakao_verified_phone === phone) return;
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: { ...(user.app_metadata || {}), kakao_verified_phone: phone },
  });
  if (error) console.error("Failed to record verified Kakao phone:", error.message);
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { user_id, provider_token = "" } = body;

    if (!user_id) {
      return Response.json({ success: false, error: "Missing user_id" });
    }

    const auth = await requireSignedInUser(req);
    if (!auth.ok) return auth.response;
    if (auth.userId !== user_id) {
      return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    // 링크가 있는 계정은 보통 더 채울 것이 없다. 다만 방금 카카오로 로그인해 토큰을
    // 가져온 경우에는 아래로 내려가 비어 있는 전화번호·카카오 아이디를 채운다 —
    // 프로필 생성이 실패하던 시기에 가입한 계정은 링크만 있고 번호가 없다.
    if (isRealUsername(auth.username) && !provider_token) {
      return Response.json({
        success: true,
        profile: {
          username: auth.username,
          role: auth.isAdmin ? "admin" : "user",
        },
        isNewUser: false,
      });
    }

    const supabase = getSupabaseAdmin();
    const { data: verifiedAuth, error: verifiedAuthError } = await supabase.auth.admin.getUserById(user_id);
    if (verifiedAuthError || !verifiedAuth?.user) {
      return Response.json({ success: false, error: "User not found" }, { status: 401 });
    }
    const verifiedUser = verifiedAuth.user;
    const user_metadata = verifiedUser.user_metadata || {};
    const identities = verifiedUser.identities || [];
    const email = verifiedUser.email || "";
    const client_kakao_name = "";

    const kakaoIdentity = identities.find(
      (i: any) => i.provider === "kakao"
    );
    if (!kakaoIdentity) {
      return Response.json({ success: false, error: "Kakao identity not found" }, { status: 403 });
    }
    const identityData = kakaoIdentity?.identity_data || {};

    let phone = extractKakaoPhone(identityData);
    let fullName = extractKakaoName(
      user_metadata,
      identityData,
      client_kakao_name
    );
    let avatarUrl =
      identityData?.avatar_url ||
      user_metadata?.avatar_url ||
      user_metadata?.picture ||
      "";
    let kakaoId = String(
      identityData?.sub ||
      kakaoIdentity?.provider_id ||
      ""
    );
    if (!kakaoId) {
      return Response.json({ success: false, error: "Kakao account ID not found" }, { status: 403 });
    }

    const { data: existing } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user_id)
      .maybeSingle();

    if (provider_token && (!phone || !fullName)) {
      const kakaoProfile = await fetchKakaoProfile(provider_token);
      if (kakaoProfile) {
        if (String(kakaoProfile.id || "") !== kakaoId) {
          return Response.json({ success: false, error: "Kakao account mismatch" }, { status: 403 });
        }
        const account = kakaoProfile.kakao_account || {};
        if (!phone) {
          const rawPhone =
            account.phone_number ||
            account.mobile_phone_number ||
            kakaoProfile.phone_number ||
            "";
          if (rawPhone) {
            phone = normalizePhone(rawPhone);
          }
        }
        if (!fullName && (account.name || account.profile?.nickname)) {
          fullName = account.name || account.profile?.nickname;
        }
        if (!avatarUrl && account.profile?.profile_image_url) {
          avatarUrl = account.profile.profile_image_url;
        }
      }
    }

    // 여기까지의 phone 은 카카오 신원 정보이거나, 같은 카카오 계정임을 확인한 카카오 API
    // 응답에서만 왔다.
    await rememberVerifiedKakaoPhone(supabase, verifiedUser, phone);

    if (existing && isRealUsername(existing.username)) {
      const updates: Record<string, any> = {};
      if (phone && existing.phone !== phone) updates.phone = phone;
      if (fullName && existing.full_name !== fullName) updates.full_name = fullName;
      // 프로필 사진은 비어 있을 때만 카카오 사진으로 채운다. 예전 계정에서 옮겨 온 사진이나
      // 직접 고른 사진을 로그인할 때마다 카카오 사진으로 덮으면 안 된다.
      if (avatarUrl && !existing.avatar_url) updates.avatar_url = avatarUrl;
      if (kakaoId && existing.kakao_id !== kakaoId) updates.kakao_id = kakaoId;

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("profiles")
          .update(updates)
          .eq("id", user_id);

        if (updateError) {
          console.error("Failed to update existing profile:", updateError.message);
        }
      }

      const merged = { ...existing, ...updates };
      return Response.json({
        success: true,
        profile: {
          ...merged,
          username: merged.username || "",
        },
        isNewUser: false,
      });
    }

    // 링크(username)를 정하기 전이라 비워 두되 빈 문자열이 아니라 NULL 로 넣는다.
    // profiles.username 에는 고유 제약(profiles_username_key)이 있어서 '' 는 한 행만
    // 가질 수 있다 — 링크를 정하지 않고 나간 계정이 하나라도 있으면 그 뒤 모든 카카오
    // 가입자의 프로필 생성이 중복 키 오류로 실패했고, 카카오에서 받은 전화번호·카카오
    // 아이디가 저장되지 않았다. NULL 은 서로 겹치지 않는다.
    const newProfile = {
      id: user_id,
      username: null,
      email: email || "",
      full_name: fullName,
      phone,
      avatar_url: avatarUrl,
      kakao_id: kakaoId,
      role: "user",
    };

    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: fullName || existing.full_name || "",
          phone: phone || existing.phone || "",
          avatar_url: avatarUrl || existing.avatar_url || "",
          kakao_id: kakaoId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user_id)
        .select("*")
        .single();
      if (updateError) {
        return Response.json({ success: false, error: updateError.message });
      }
      return Response.json({ success: true, profile: updated, isNewUser: true });
    }

    const { error: insertError } = await supabase
      .from("profiles")
      .insert(newProfile);

    if (insertError && insertError.code === "23505") {
      const { data: retryFetch } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user_id)
        .maybeSingle();

      if (retryFetch) {
        return Response.json({
          success: true,
          profile: {
            ...retryFetch,
            username: retryFetch.username || "",
          },
          isNewUser: false,
        });
      }
    }

    if (insertError) {
      return Response.json({
        success: false,
        error: insertError.message,
      });
    }

    return Response.json({
      success: true,
      profile: { ...newProfile, username: "" },
      isNewUser: true,
    });
  } catch (err: any) {
    return Response.json({
      success: false,
      error: err?.message || "Internal error",
    });
  }
};

export const config: Config = {
  path: "/.netlify/functions/kakao-profile-setup",
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: "ip" },
};
