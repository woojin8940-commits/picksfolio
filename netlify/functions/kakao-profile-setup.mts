import { createClient } from "@supabase/supabase-js";
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

function extractKakaoPhone(
  userMetadata: Record<string, any>,
  identityData: Record<string, any>,
  clientPhone: string
): string {
  const raw =
    clientPhone ||
    userMetadata?.phone_number ||
    userMetadata?.phone ||
    userMetadata?.kakao_account?.phone_number ||
    identityData?.phone_number ||
    identityData?.kakao_account?.phone_number ||
    "";
  if (!raw) return "";
  return raw.replace(/[^0-9+]/g, "").replace(/^\+82/, "0");
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

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const {
      user_id,
      user_metadata = {},
      identities = [],
      email = "",
      provider_token = "",
      client_kakao_phone = "",
      client_kakao_name = "",
    } = body;

    if (!user_id) {
      return Response.json({ success: false, error: "Missing user_id" });
    }

    const supabase = getSupabaseAdmin();

    const kakaoIdentity = identities.find(
      (i: any) => i.provider === "kakao"
    );
    const identityData = kakaoIdentity?.identity_data || {};

    let phone = extractKakaoPhone(
      user_metadata,
      identityData,
      client_kakao_phone
    );
    let fullName = extractKakaoName(
      user_metadata,
      identityData,
      client_kakao_name
    );
    let avatarUrl =
      user_metadata?.avatar_url ||
      user_metadata?.picture ||
      identityData?.avatar_url ||
      "";
    let kakaoId = String(
      user_metadata?.provider_id ||
      user_metadata?.sub ||
      identityData?.sub ||
      kakaoIdentity?.id ||
      ""
    );

    if (provider_token && (!kakaoId || !phone || !fullName)) {
      const kakaoProfile = await fetchKakaoProfile(provider_token);
      if (kakaoProfile) {
        if (!kakaoId && kakaoProfile.id) {
          kakaoId = String(kakaoProfile.id);
        }
        const account = kakaoProfile.kakao_account || {};
        if (!phone) {
          const rawPhone =
            account.phone_number ||
            account.mobile_phone_number ||
            kakaoProfile.phone_number ||
            "";
          if (rawPhone) {
            phone = rawPhone.replace(/[^0-9+]/g, "").replace(/^\+82/, "0");
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

    const { data: existing } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user_id)
      .maybeSingle();

    const hasRealUsername = existing?.username &&
      !existing.username.startsWith("_kakao_") &&
      !existing.username.startsWith("_kk_");

    if (existing && hasRealUsername) {
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (phone) updates.phone = phone;
      if (fullName) updates.full_name = fullName;
      if (avatarUrl) updates.avatar_url = avatarUrl;
      if (kakaoId) updates.kakao_id = kakaoId;

      const { error: updateError } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user_id);

      if (updateError) {
        console.error("Failed to update existing profile:", updateError.message);
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

    // Try to recover via kakao_id — works whether or not a profile row exists yet
    const recoveryKakaoId = existing?.kakao_id || kakaoId;
    if (recoveryKakaoId) {
      const { data: recoveredProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("kakao_id", recoveryKakaoId)
        .neq("id", user_id)
        .not("username", "eq", "")
        .limit(10);
      if (recoveredProfile && recoveredProfile.length > 0) {
        const rp = recoveredProfile.find(
          (p: any) => p.username && !p.username.startsWith("_kakao_") && !p.username.startsWith("_kk_")
        );
        if (rp) {
          if (existing) {
            await supabase
              .from("profiles")
              .update({
                username: rp.username,
                kakao_id: recoveryKakaoId,
                role: rp.role || "user",
                full_name: rp.full_name || existing.full_name || fullName || "",
                phone: rp.phone || existing.phone || phone || "",
                avatar_url: rp.avatar_url || existing.avatar_url || avatarUrl || "",
                updated_at: new Date().toISOString(),
              })
              .eq("id", user_id);
          } else {
            await supabase
              .from("profiles")
              .upsert({
                id: user_id,
                username: rp.username,
                email: email || "",
                kakao_id: recoveryKakaoId,
                role: rp.role || "user",
                full_name: rp.full_name || fullName || "",
                phone: rp.phone || phone || "",
                avatar_url: rp.avatar_url || avatarUrl || "",
                updated_at: new Date().toISOString(),
              }, { onConflict: "id" })
              .then(({ error }) => {
                if (error) console.error("Recovery upsert failed:", error.message);
              });
          }
          return Response.json({
            success: true,
            profile: { ...rp, id: user_id, kakao_id: recoveryKakaoId },
            isNewUser: false,
          });
        }
      }
    }

    let linkedProfile: Record<string, any> | null = null;

    // 1) Match by kakao_id (strongest signal)
    if (!linkedProfile && kakaoId) {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("kakao_id", kakaoId)
        .neq("id", user_id)
        .not("username", "eq", "")
        .limit(1);
      if (data && data.length > 0) {
        linkedProfile = data[0];
      } else {
        const { data: anyMatch } = await supabase
          .from("profiles")
          .select("*")
          .eq("kakao_id", kakaoId)
          .neq("id", user_id)
          .limit(1);
        if (anyMatch && anyMatch.length > 0) {
          linkedProfile = anyMatch[0];
        }
      }
    }

    // 2) Match by email (more specific than phone)
    if (!linkedProfile && email) {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("email", email)
        .neq("id", user_id)
        .not("email", "eq", "")
        .maybeSingle();
      if (data && (!data.kakao_id || data.kakao_id === kakaoId)) {
        linkedProfile = data;
      }
    }

    // 2.5) Match by email across auth users — find if any other auth user
    // shares this email in their profile or identity data
    if (!linkedProfile && email) {
      try {
        let page = 1;
        while (!linkedProfile && page <= 3) {
          const { data: authData } = await supabase.auth.admin.listUsers({
            page,
            perPage: 200,
          });
          if (!authData?.users?.length) break;
          for (const authUser of authData.users) {
            if (authUser.id === user_id) continue;
            const authEmail = authUser.email || "";
            const metaEmail = authUser.user_metadata?.email || "";
            const identityEmails = (authUser.identities || [])
              .map((ident: any) => ident.identity_data?.email || "")
              .filter(Boolean);
            const allEmails = [authEmail, metaEmail, ...identityEmails]
              .map((e: string) => e.toLowerCase().trim())
              .filter(Boolean);
            if (allEmails.includes(email.toLowerCase().trim())) {
              const { data: profileById } = await supabase
                .from("profiles")
                .select("*")
                .eq("id", authUser.id)
                .maybeSingle();
              if (
                profileById &&
                profileById.username &&
                !profileById.username.startsWith("_kakao_") &&
                !profileById.username.startsWith("_kk_") &&
                (!profileById.kakao_id || profileById.kakao_id === kakaoId)
              ) {
                linkedProfile = profileById;
                break;
              }
            }
          }
          if (authData.users.length < 200) break;
          page++;
        }
      } catch (e) {
        console.error("Auth user email search failed:", e);
      }
    }

    // 3) Match by phone. The site signup stores phone digits-only (e.g. 01012345678)
    //    while Kakao can return it in several shapes (+82, 8210…, formatted). A site
    //    member who later opens a live stream and logs in with Kakao must be matched
    //    to the SAME profile so they are never re-prompted for a link/username. We
    //    therefore compare on the last 8 digits (the part that is stable across all
    //    formats) and prefer a row that already has a real username. Using a list
    //    query instead of .maybeSingle() also avoids silently failing when more than
    //    one row happens to share the phone (e.g. a leftover Kakao stub profile).
    if (!linkedProfile && phone) {
      const last8 = phone.replace(/\D/g, "").slice(-8);
      if (last8.length === 8) {
        const { data: phoneMatches } = await supabase
          .from("profiles")
          .select("*")
          .neq("id", user_id)
          .not("phone", "eq", "")
          .ilike("phone", `%${last8}`)
          .limit(20);
        if (phoneMatches && phoneMatches.length > 0) {
          const eligible = phoneMatches.filter(
            (p: any) => !p.kakao_id || p.kakao_id === kakaoId
          );
          const withRealName = eligible.find(
            (p: any) =>
              p.username &&
              !p.username.startsWith("_kakao_") &&
              !p.username.startsWith("_kk_")
          );
          linkedProfile = withRealName || eligible[0] || null;
        }
      }
    }

    // 5) Match by scanning auth users' phone metadata
    if (!linkedProfile && phone) {
      try {
        const phoneDigits = phone.replace(/\D/g, "");
        const last10 = phoneDigits.slice(-10);
        if (last10.length >= 8) {
          let page = 1;
          let found = false;
          while (!found && page <= 5) {
            const { data: authData } = await supabase.auth.admin.listUsers({
              page,
              perPage: 200,
            });
            if (!authData?.users?.length) break;
            for (const authUser of authData.users) {
              if (authUser.id === user_id) continue;
              const metaPhone = (authUser.user_metadata?.phone || "").replace(/\D/g, "");
              if (metaPhone && metaPhone.slice(-10) === last10) {
                const { data: profileById } = await supabase
                  .from("profiles")
                  .select("*")
                  .eq("id", authUser.id)
                  .maybeSingle();
                if (
                  profileById &&
                  profileById.username &&
                  (!profileById.kakao_id || profileById.kakao_id === kakaoId)
                ) {
                  linkedProfile = profileById;
                  found = true;
                  break;
                }
              }
            }
            if (authData.users.length < 200) break;
            page++;
          }
        }
      } catch (e) {
        console.error("Auth user phone search failed:", e);
      }
    }

    if (linkedProfile) {
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (kakaoId && (!linkedProfile.kakao_id || linkedProfile.kakao_id === kakaoId)) {
        updates.kakao_id = kakaoId;
      }
      if (email && !email.endsWith("@picks.me") && linkedProfile.email !== email) {
        updates.email = email;
      }
      if (phone && !linkedProfile.phone) updates.phone = phone;
      if (fullName && !linkedProfile.full_name) updates.full_name = fullName;
      if (avatarUrl && !linkedProfile.avatar_url) updates.avatar_url = avatarUrl;

      const { error: updateError } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", linkedProfile.id);

      if (updateError) {
        console.error("Failed to update linked profile:", updateError.message);
      }

      const merged = { ...linkedProfile, ...updates };

      if (linkedProfile.id !== user_id) {
        const kakaoUserProfile = {
          id: user_id,
          username: merged.username || "",
          email: email || "",
          full_name: merged.full_name || "",
          phone: merged.phone || "",
          avatar_url: merged.avatar_url || "",
          kakao_id: kakaoId || merged.kakao_id || "",
          role: merged.role || "user",
          updated_at: new Date().toISOString(),
        };

        const { error: upsertError } = await supabase
          .from("profiles")
          .upsert(kakaoUserProfile, { onConflict: "id" });

        if (upsertError) {
          console.error("Kakao profile sync failed:", upsertError.message);
          if (existing) {
            await supabase
              .from("profiles")
              .update({
                kakao_id: kakaoId || merged.kakao_id || "",
                updated_at: new Date().toISOString(),
              })
              .eq("id", user_id);
          }
        }
      }

      return Response.json({
        success: true,
        profile: {
          ...merged,
          username: merged.username || "",
        },
        isNewUser: false,
      });
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
