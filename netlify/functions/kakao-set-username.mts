import { getSupabaseServer } from "./_shared/supabase.mts";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";

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
    const auth = await requireSignedInUser(req);
    if (!auth.ok) return auth.response;
    if (auth.userId !== user_id) {
      return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
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

    const [{ data: existing }, { data: current }] = await Promise.all([
      supabase.from("profiles").select("id").eq("username", value).maybeSingle(),
      supabase.from("profiles").select("id, username").eq("id", user_id).maybeSingle(),
    ]);

    if (existing && existing.id !== user_id) {
      return Response.json({
        success: false,
        error: "이미 사용 중인 링크입니다. 다른 이름을 입력해주세요.",
      });
    }
    if (current?.username && current.username !== value) {
      return Response.json({ success: false, error: "이미 링크 이름이 설정되어 있습니다." }, { status: 409 });
    }

    const payload = { username: value, updated_at: new Date().toISOString() };
    const { error: upsertError } = current
      ? await supabase.from("profiles").update(payload).eq("id", user_id)
      : await supabase.from("profiles").insert({ id: user_id, ...payload, role: "user" });

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

export const config: Config = {
  path: "/.netlify/functions/kakao-set-username",
  rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: "ip" },
};
