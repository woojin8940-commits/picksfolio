import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";

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

    if (record.attempts >= 5) {
      return Response.json({
        success: false,
        error: "인증 시도 횟수를 초과했습니다. 새 인증번호를 요청해 주세요.",
      });
    }

    if (record.code !== code) {
      await db.sql`
        UPDATE sms_verifications SET attempts = attempts + 1 WHERE id = ${record.id}
      `;
      return Response.json({ success: false, error: "인증번호가 일치하지 않습니다." });
    }

    await db.sql`
      UPDATE sms_verifications SET verified = TRUE WHERE id = ${record.id}
    `;

    return Response.json({ success: true, message: "인증되었습니다." });
  } catch (err: any) {
    console.error("[verify-sms] Error:", err);
    return Response.json({ success: false, error: "오류가 발생했습니다." });
  }
};

export const config: Config = {
  path: "/.netlify/functions/verify-sms",
};
