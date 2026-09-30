import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 가입할 때 인증한 휴대폰 번호를 Supabase Auth 사용자(auth.users.phone)에도 넣는다.
 *
 * 번호의 기준 저장소는 여전히 profiles.phone 이다. Auth 의 phone 칸은 번호마다
 * 한 계정만 허용하는데, 이 서비스는 한 번호로 계정을 여러 개(최대 10개) 만들 수
 * 있다. 그래서 계정을 먼저 만든 뒤 번호를 따로 넣고, 같은 번호를 이미 다른 계정이
 * 쓰고 있어 실패하면 로그만 남기고 넘어간다 — 번호 때문에 가입이 실패하면 안 된다.
 *
 * Auth 는 국제 형식(+82…)을 쓰므로 국내 형식(010…)을 변환해서 넣는다. 번호는
 * 방금 문자 인증을 통과한 것이므로 phone_confirm 으로 인증 완료 처리한다.
 */
export async function attachAuthPhone(
  supabase: SupabaseClient,
  userId: string,
  localPhone: string
): Promise<void> {
  const digits = (localPhone || "").replace(/\D/g, "");
  if (!/^01\d{8,9}$/.test(digits)) return;

  try {
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      phone: `+82${digits.slice(1)}`,
      phone_confirm: true,
    });
    if (error) {
      console.warn("attachAuthPhone: skipped (number likely used by another account)", error.message);
    }
  } catch (err: any) {
    console.warn("attachAuthPhone: failed", err?.message);
  }
}
