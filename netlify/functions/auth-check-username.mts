import { createClient } from "@supabase/supabase-js";
import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { checkUsernameRules, normalizeUsername } from "./_shared/username-rules.mts";

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

function getSupabaseAdmin() {
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * 가입 화면의 "중복확인". 이 아이디로 지금 가입할 수 있는지만 답한다.
 *
 * 판정은 auth-signup 이 실제로 거절하는 조건과 같은 순서로 본다 — 형식 → 예약어 →
 * profiles 중복 → site_data 잔여. 마지막 것까지 보는 이유는 auth-signup 이
 * site_data 를 `ON CONFLICT (username) DO NOTHING` 으로 넣기 때문이다. 탈퇴 등으로
 * profiles 에는 없고 site_data 에만 남은 이름을 그대로 내주면, 새 주인의 페이지가
 * 남의 옛 페이지 내용으로 열린다.
 *
 * 응답은 상태 코드가 아니라 본문의 available 로 말한다(auth-signup 과 같은 방식).
 * 아이디가 실재하는지 여부는 프로필 페이지 주소를 열어 보면 누구나 알 수 있는
 * 정보라 별도 인증을 두지 않고, 대신 짧은 창의 호출 제한을 둔다.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const username = normalizeUsername((body as any)?.username);

    if (!username) {
      return Response.json({
        success: true,
        available: false,
        username,
        reason: "format",
        error: "사용할 아이디를 입력해 주세요.",
      });
    }

    const rules = checkUsernameRules(username);
    if (!rules.ok) {
      return Response.json({
        success: true,
        available: false,
        username,
        reason: rules.reason,
        error: rules.error,
      });
    }

    const supabase = getSupabaseAdmin();
    const { data: existingProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    // 조회 자체가 실패하면 "사용 가능" 으로 답하지 않는다. 비어 있다고 답한 뒤
    // 가입에서 거절되는 것보다, 지금 다시 눌러 달라고 하는 편이 낫다.
    if (profileError) {
      return Response.json(
        { success: false, error: "아이디를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 }
      );
    }

    if (existingProfile) {
      return Response.json({
        success: true,
        available: false,
        username,
        reason: "taken",
        error: "이미 사용 중인 아이디입니다.",
      });
    }

    // site_data 잔여 확인. 이 조회는 실패해도 가입을 막지 않는다(auth-signup 도
    // site_data 쓰기를 선택적으로 다룬다) — profiles 확인이 이미 끝났으므로
    // 여기서 막으면 쓸 수 있는 아이디를 못 쓰게 된다.
    try {
      const db = getDatabase();
      const rows = await db.sql`SELECT 1 FROM site_data WHERE username = ${username} LIMIT 1`;
      if (rows.length > 0) {
        return Response.json({
          success: true,
          available: false,
          username,
          reason: "taken",
          error: "이미 사용 중인 아이디입니다.",
        });
      }
    } catch {}

    return Response.json({ success: true, available: true, username });
  } catch (err: any) {
    return Response.json(
      { success: false, error: err?.message || "아이디를 확인하지 못했습니다." },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: "/.netlify/functions/auth-check-username",
  // 가입 화면에서 아이디를 여러 번 바꿔 가며 눌러 보는 것이 정상적인 사용이라
  // 가입(10회)보다 넉넉하게 둔다.
  rateLimit: { windowSize: 60, windowLimit: 40, aggregateBy: "ip" },
};
