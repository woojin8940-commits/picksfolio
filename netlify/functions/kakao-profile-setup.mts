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

    if (isRealUsername(auth.username)) {
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

    if (existing && isRealUsername(existing.username)) {
      const updates: Record<string, any> = {};
      if (phone && existing.phone !== phone) updates.phone = phone;
      if (fullName && existing.full_name !== fullName) updates.full_name = fullName;
      if (avatarUrl && existing.avatar_url !== avatarUrl) updates.avatar_url = avatarUrl;
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

    const newProfile = {
      id: user_id,
      username: "",
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

    return Response.json({ success: true, profile: newProfile, isNewUser: true });
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
