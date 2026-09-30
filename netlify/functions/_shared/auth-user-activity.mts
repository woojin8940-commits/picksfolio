import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Supabase Auth 의 전체 사용자 목록.
 *
 * `profiles` 에는 가입 시각(created_at) · 마지막 로그인(last_login_at) 칸이 없다
 * (updated_at 만 있다). 예전 운영 콘솔 코드는 그 칸을 골라 조회해서 쿼리가 통째로
 * 42703(없는 칸) 오류로 실패했고, 그 결과 회원 목록 · 가입 추이 · 운영 요약이 전부
 * 0명 또는 가짜 줄로 보였다. 가입 · 로그인 시각의 원본은 Auth 이므로 여기서 읽는다.
 */
export async function listAllAuthUsers(supabase: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }
  return users;
}

export interface AuthActivity {
  created_at: string | null;
  last_login_at: string | null;
}

/** 사용자 ID → 가입 · 마지막 로그인 시각. 조회에 실패하면 빈 맵(시각만 비어 보인다). */
export async function authActivityById(
  supabase: SupabaseClient,
  users?: User[] | null,
): Promise<Map<string, AuthActivity>> {
  let list = users;
  if (!list) {
    try {
      list = await listAllAuthUsers(supabase);
    } catch (e) {
      console.warn("[auth-user-activity] listUsers failed:", e);
      list = [];
    }
  }
  return new Map(
    list.map((u) => [u.id, { created_at: u.created_at || null, last_login_at: u.last_sign_in_at || null }]),
  );
}

/** profiles.role 에서 비즈니스 계정을 뜻하는 값. 가입(business-auth)은 "operator" 로 저장한다. */
export const BUSINESS_ROLES = ["business", "operator"];
