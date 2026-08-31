import { getDatabase } from "@picks/netlify-database";

/**
 * "이 번호는 방금 문자로 인증됐다"를 서버에서 확인한다.
 *
 * 가입 화면은 인증 성공을 브라우저 상태(isVerified)로만 들고 있었고, 서버는
 * sms_verifications 를 아예 보지 않았다. 그래서 함수로 직접 요청하면 인증하지 않은
 * 아무 번호로도 가입할 수 있었다. 계정에 적힌 번호를 믿을 수 없으면 그 번호로 계정을
 * 찾아 주는 기능(find-account) 전체가 근거를 잃는다.
 *
 * 판정 기준은 find-account 와 같다 — verified_at 이 채워져 있고(= verify-sms 가
 * 코드를 실제로 맞췄고), 그 시각이 창 안이고, 아직 쓰이지 않은 줄만 인정한다.
 */

/**
 * 인증이 유효한 창. 가입은 입력할 것이 많아(아이디 · 비밀번호 · 이메일 · 사업자 조회)
 * 아이디 찾기(10분)보다 넉넉하게 둔다.
 *
 * 이 값은 안내 문구에만 쓴다. 아래 질의는 같은 길이를 SQL 리터럴로 적는다 —
 * INTERVAL 을 파라미터로 곱하면(`$1 * INTERVAL '1 minute'`) Postgres 가 $1 의
 * 타입을 정하지 못해 "operator is not unique" 로 실패할 수 있다. 창을 바꿀 때는
 * 두 곳을 함께 고쳐야 한다.
 */
const WINDOW_MINUTES = 30;

export type PhoneVerification = { id: number } | null;

export async function findVerifiedPhone(
  phone: string,
  purpose: string,
): Promise<PhoneVerification> {
  const cleanPhone = String(phone || "").replace(/\D/g, "");
  if (!cleanPhone) return null;

  const rows = await getDatabase().sql`
    SELECT id FROM sms_verifications
    WHERE phone = ${cleanPhone}
      AND purpose = ${purpose}
      AND verified = TRUE
      AND verified_at IS NOT NULL
      AND verified_at > NOW() - INTERVAL '30 minutes' -- WINDOW_MINUTES
      AND consumed_at IS NULL
    ORDER BY verified_at DESC
    LIMIT 1
  `;
  return rows.length > 0 ? { id: Number(rows[0].id) } : null;
}

/** 가입이 실제로 끝난 뒤에만 호출한다 — 실패한 시도가 인증을 태워 버리면 안 된다. */
export async function consumePhoneVerification(id: number): Promise<void> {
  try {
    await getDatabase().sql`
      UPDATE sms_verifications
      SET consumed_at = NOW()
      WHERE id = ${id} AND consumed_at IS NULL
    `;
  } catch (err) {
    // 소진 처리 실패로 가입을 되돌리지는 않는다. 창(30분)이 지나면 어차피 못 쓴다.
    console.error("[phone-verification] 소진 처리 실패", err);
  }
}

/** 인증되지 않았을 때 돌려줄 응답. 화면이 그대로 보여 준다. */
export const phoneNotVerifiedResponse = () =>
  Response.json({
    success: false,
    error: `휴대폰 인증을 완료해 주세요. 인증 후 ${WINDOW_MINUTES}분이 지나면 다시 인증해야 합니다.`,
    code: "PHONE_NOT_VERIFIED",
  });
