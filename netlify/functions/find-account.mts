import { createClient } from "@supabase/supabase-js";
import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

function getSupabaseAdmin() {
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Normalize a Korean/Latin name for tolerant comparison (ignore case + whitespace).
function normalizeName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * 이 번호가 방금 인증을 통과했는지 확인하고, 그 인증 줄의 id 를 돌려준다.
 *
 * 판정 기준을 verified 플래그 하나에서 세 가지로 좁혔다.
 *   - verified_at 이 채워져 있어야 한다. 이 값은 verify-sms 가 코드를 실제로 맞췄을
 *     때만 쓰므로, 다른 경로가 플래그를 세워도 인증으로 인정되지 않는다.
 *   - 창은 expires_at(문자를 *보낸* 시각)이 아니라 verified_at 기준 10분이다.
 *   - consumed_at 이 비어 있어야 한다. 한 번 쓴 인증으로 비밀번호를 반복해서
 *     바꿀 수 없다.
 *
 * purposes 는 여러 개를 받는다. 아이디 찾기로 인증한 사람이 찾은 아이디에서 바로
 * "비밀번호 재설정" 으로 넘어갈 때 문자를 한 번 더 받지 않게 하기 위해서다 —
 * 두 인증 모두 "이 번호의 주인이다" 를 증명한다는 점에서 같다.
 *
 * 반환값이 null 이면 인증되지 않았다는 뜻이다.
 */
async function findUsableVerification(phone: string, purposes: string[]): Promise<number | null> {
  const db = getDatabase();
  const results = await db.sql`
    SELECT id FROM sms_verifications
    WHERE phone = ${phone}
      AND purpose IN (${purposes[0]}, ${purposes[purposes.length - 1]})
      AND verified = TRUE
      AND verified_at IS NOT NULL
      AND verified_at > NOW() - INTERVAL '10 minutes'
      AND consumed_at IS NULL
    ORDER BY verified_at DESC
    LIMIT 1
  `;
  return results.length > 0 ? Number(results[0].id) : null;
}

/** 인증을 소진 처리한다. 조회가 아니라 실제 조치(비밀번호 변경)를 한 뒤에만 호출한다. */
async function consumeVerification(id: number): Promise<void> {
  const db = getDatabase();
  await db.sql`
    UPDATE sms_verifications
    SET consumed_at = NOW()
    WHERE id = ${id} AND consumed_at IS NULL
  `;
}

type AccountType = "user" | "business";

type MatchedAccount = {
  id: string;
  username: string;
  display_name: string;
  created_at: string | null;
  account_type: AccountType;
  login_method: "password" | "kakao";
};

/**
 * 인증된 번호로 가입된 계정 중, 입력한 이름과 맞는 계정을 모두 찾는다.
 *
 * 예전에는 profiles.full_name 하나만 이름과 비교했다. 그런데 가입 경로마다 이 칸에
 * 들어가는 값이 다르다.
 *   - 비즈니스 가입은 full_name 에 *회사명* 을 넣고, 담당자 이름은 Auth 사용자
 *     정보(user_metadata.contact_person)에만 남긴다. 그래서 비즈니스 회원이 자기
 *     이름을 넣으면 항상 "일치하는 계정이 없습니다" 였다.
 *   - 카카오 가입은 카카오 프로필 이름(닉네임일 수 있다)이 들어간다.
 * 그래서 가입 때 저장된 이름 후보(full_name · 담당자명 · 가입 시 이름 · 카카오 이름)
 * 중 하나라도 맞으면 본인 계정으로 본다. 번호는 방금 문자 인증으로 확인됐다.
 *
 * 역할(인플루언서 / 비즈니스)로 거르지 않는다. 비즈니스 로그인 화면에서 인플루언서
 * 계정을 찾는 등 탭을 잘못 고른 사람도 자기 아이디를 볼 수 있게, 계정마다
 * account_type 을 붙여 돌려주고 요청한 종류를 앞에 둔다.
 */
async function findMatchingAccounts(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  phone: string,
  name: string,
  preferred: AccountType
): Promise<{ ok: true; accounts: MatchedAccount[] } | { ok: false }> {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, role")
    .eq("phone", phone);

  if (error) {
    console.error("find-account: profiles lookup failed", error.message);
    return { ok: false };
  }

  const wanted = normalizeName(name);
  const accounts: MatchedAccount[] = [];

  for (const p of profiles || []) {
    // 링크(아이디)를 아직 만들지 않은 계정은 로그인할 아이디가 없다.
    if (!p.username) continue;
    // 카카오 계정으로 링크를 옮겨 준 예전 계정(_legacy_…)은 더 쓰지 않는 자리 표시다.
    // 같은 번호로 찾으면 실제로 쓰는 카카오 계정이 따로 나온다.
    if (p.username.startsWith("_legacy_")) continue;

    const { data } = await supabase.auth.admin.getUserById(p.id);
    const user = data?.user;
    const meta = (user?.user_metadata || {}) as Record<string, unknown>;

    const candidates = [p.full_name, meta.full_name, meta.name, meta.contact_person]
      .map((v) => normalizeName(typeof v === "string" ? v : ""))
      .filter(Boolean);
    if (!candidates.includes(wanted)) continue;

    const isBusiness = p.role === "operator" || p.role === "admin";
    accounts.push({
      id: p.id,
      username: p.username,
      display_name: p.full_name || "",
      created_at: user?.created_at || null,
      account_type: isBusiness ? "business" : "user",
      login_method: user?.app_metadata?.provider === "kakao" ? "kakao" : "password",
    });
  }

  accounts.sort((a, b) => {
    if (a.account_type !== b.account_type) return a.account_type === preferred ? -1 : 1;
    return (a.created_at || "").localeCompare(b.created_at || "");
  });

  return { ok: true, accounts };
}

const publicAccount = ({ id: _id, ...rest }: MatchedAccount) => rest;

const NO_MATCH_ERROR =
  "이름과 전화번호가 일치하는 계정이 없습니다. 가입할 때 입력한 이름(비즈니스 회원은 담당자 이름)을 정확히 입력해 주세요.";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { action, phone, name, account_type } = body;

    if (!phone) {
      return Response.json({ success: false, error: "전화번호를 입력해 주세요." });
    }

    const cleanName = (name || "").trim();
    if (!cleanName) {
      return Response.json({ success: false, error: "이름을 입력해 주세요." });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const supabase = getSupabaseAdmin();
    const preferred: AccountType = account_type === "business" ? "business" : "user";

    const purposes = action === "find-id" ? ["find-id"] : ["reset-password", "find-id"];
    const verificationId = await findUsableVerification(cleanPhone, purposes);
    if (verificationId === null) {
      return Response.json({
        success: false,
        error: "휴대폰 인증이 만료되었습니다. 인증을 다시 진행해 주세요.",
        code: "VERIFICATION_REQUIRED",
      });
    }

    const lookup = await findMatchingAccounts(supabase, cleanPhone, cleanName, preferred);
    if (!lookup.ok) {
      return Response.json({
        success: false,
        error: "계정 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      });
    }

    if (action === "find-id" || action === "reset-lookup") {
      if (lookup.accounts.length === 0) {
        return Response.json({ success: false, error: NO_MATCH_ERROR, code: "NO_MATCH" });
      }
      return Response.json({ success: true, accounts: lookup.accounts.map(publicAccount) });
    }

    // 화면(FindAccount.tsx)은 "reset-pw" 를 보낸다. 서버가 "reset-password" 만
    // 받고 있었기 때문에 비밀번호 재설정은 항상 "Unknown action" 으로 끝났다.
    if (action === "reset-password" || action === "reset-pw") {
      const { username, new_password } = body;

      if (!new_password) {
        return Response.json({ success: false, error: "새 비밀번호를 입력해 주세요." });
      }

      if (new_password.length < 6) {
        return Response.json({ success: false, error: "비밀번호는 6자 이상이어야 합니다." });
      }

      let matched = lookup.accounts;

      // When the client knows which account to reset (multiple share a name +
      // phone), narrow down to the selected username.
      if (username) {
        matched = matched.filter((p) => p.username === username);
      }

      if (matched.length === 0) {
        return Response.json({ success: false, error: NO_MATCH_ERROR, code: "NO_MATCH" });
      }

      if (matched.length > 1) {
        return Response.json({
          success: false,
          error: "여러 계정이 확인되었습니다. 아이디를 선택해 주세요.",
          accounts: matched.map(publicAccount),
        });
      }

      const profile = matched[0];

      const { error: updateError } = await supabase.auth.admin.updateUserById(
        profile.id,
        { password: new_password }
      );

      if (updateError) {
        return Response.json({ success: false, error: "비밀번호 변경에 실패했습니다." });
      }

      // 비밀번호가 실제로 바뀐 뒤에 인증을 소진시킨다. 같은 문자 한 통으로
      // 계정을 몇 번이고 다시 잠글 수 없게 한다.
      await consumeVerification(verificationId);

      return Response.json({
        success: true,
        message: "비밀번호가 변경되었습니다.",
        username: profile.username,
        account_type: profile.account_type,
      });
    }

    return Response.json({ success: false, error: "Unknown action" });
  } catch (err: any) {
    return Response.json({ success: false, error: err?.message || "오류가 발생했습니다." });
  }
};

export const config: Config = {
  path: "/.netlify/functions/find-account",
  rateLimit: { windowSize: 60, windowLimit: 15, aggregateBy: "ip" },
};
