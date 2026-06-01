import { getSupabaseServer } from "./_shared/supabase.mts";

// Sets a Kakao viewer's profile "link name" (the same username they would pick
// at signup). Live-stream viewers sign in with Kakao and then have their
// Supabase session signed out so it doesn't clash with the influencer/admin
// session in the same browser — so the write must go through the service role
// here rather than a client-side upsert.
export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json(
      { success: false, error: "Method not allowed" },
      { status: 405 }
    );
  }

  try {
    const { user_id, username } = await req.json();

    if (!user_id) {
      return Response.json({ success: false, error: "Missing user_id" });
    }

    // Same rules as the signup link-name (SetupLink): lowercase letters,
    // numbers and underscore, 3–20 characters.
    const value = String(username || "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(value)) {
      return Response.json({
        success: false,
        error: "영문 소문자, 숫자, 밑줄(_) 3~20자로 입력해주세요.",
      });
    }

    const supabase = getSupabaseServer();

    // Reject if the link name is already used by a different account.
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", value)
      .maybeSingle();

    if (existing && existing.id !== user_id) {
      return Response.json({
        success: false,
        error: "이미 사용 중인 링크입니다. 다른 이름을 입력해주세요.",
      });
    }

    const { error: upsertError } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user_id,
          username: value,
          role: "user",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

    if (upsertError) {
      return Response.json({ success: false, error: upsertError.message });
    }

    return Response.json({ success: true, username: value });
  } catch (err: any) {
    return Response.json({
      success: false,
      error: err?.message || "Internal error",
    });
  }
};
