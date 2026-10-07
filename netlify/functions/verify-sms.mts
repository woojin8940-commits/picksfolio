import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { issueVerifyToken } from "./_shared/sms-verify-token.mts";

const PURPOSES = new Set(["signup", "business_signup", "find-id", "reset-password"]);

/** 계정 찾기 인증. 인증을 마친 화면에만 확인값을 준다(sms-verify-token). */
const ACCOUNT_RECOVERY_PURPOSES = new Set(["find-id", "reset-password"]);

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { phone, code, purpose } = await req.json() as {
      phone?: string;
      code?: string;
      purpose?: string;
    };

    if (!phone || !code) {
      return Response.json({ success: false, error: "전화번호와 인증번호를 입력해 주세요." });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const smsPurpose = purpose || "general";
    const cleanCode = String(code).trim();
    if (!/^01\d{8,9}$/.test(cleanPhone) || !/^\d{6}$/.test(cleanCode) || !PURPOSES.has(smsPurpose)) {
      return Response.json({ success: false, error: "잘못된 인증 요청입니다." }, { status: 400 });
    }
    const db = getDatabase();

    const records = await db.sql`
      SELECT id, code, attempts FROM sms_verifications
      WHERE phone = ${cleanPhone}
        AND purpose = ${smsPurpose}
        AND verified = FALSE
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (records.length === 0) {
      return Response.json({
        success: false,
        error: "인증번호가 만료되었거나 존재하지 않습니다. 다시 요청해 주세요.",
      });
    }

    const record = records[0];

    // 시도 횟수는 비교하기 전에 한 번에 올린다. 읽고 비교한 뒤에 올리면 같은 순간에
    // 들어온 요청들이 모두 "아직 5번 미만"을 보고 각자 번호를 맞춰 볼 수 있었다.
    const counted = await db.sql`
      UPDATE sms_verifications SET attempts = attempts + 1
      WHERE id = ${record.id} AND attempts < 5
      RETURNING attempts
    `;
    if (counted.length === 0) {
      return Response.json({
        success: false,
        error: "인증 시도 횟수를 초과했습니다. 새 인증번호를 요청해 주세요.",
      });
    }

    if (String(record.code) !== cleanCode) {
      return Response.json({ success: false, error: "인증번호가 일치하지 않습니다." });
    }

    // 확인값을 먼저 만든다. 만들지 못했는데 인증만 끝나 버리면 계정 찾기를 진행할 수
    // 없는 인증이 남는다. 이때는 인증을 끝내지 않아 같은 인증번호로 다시 시도할 수 있다.
    let verifyToken: string | undefined;
    if (ACCOUNT_RECOVERY_PURPOSES.has(smsPurpose)) {
      try {
        verifyToken = await issueVerifyToken({ id: Number(record.id), phone: cleanPhone, purpose: smsPurpose });
      } catch (e) {
        console.error("[verify-sms] verify token store failed:", (e as Error)?.message);
        return Response.json({ success: false, error: "인증을 마치지 못했습니다. 잠시 후 다시 시도해 주세요." });
      }
    }

    // verified_at 을 여기서만 채운다. 인증 창(아이디 찾기 · 비밀번호 재설정)은
    // 발송 시각(expires_at)이 아니라 이 시각을 기준으로 열려야 한다.
    await db.sql`
      UPDATE sms_verifications
      SET verified = TRUE, verified_at = NOW()
      WHERE id = ${record.id}
    `;

    return Response.json({ success: true, message: "인증되었습니다.", ...(verifyToken ? { verifyToken } : {}) });
  } catch (err: any) {
    console.error("[verify-sms] Error:", err);
    return Response.json({ success: false, error: "오류가 발생했습니다." });
  }
};

export const config: Config = {
  path: "/.netlify/functions/verify-sms",
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: "ip" },
};
