import type { Config } from "@netlify/functions";
import { SolapiMessageService } from "solapi";
import { getDatabase } from "@netlify/database";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method Not Allowed" }, { status: 405 });
  }

  try {
    const { receiver, purpose } = await req.json() as { receiver?: string; purpose?: string };

    if (!receiver) {
      return Response.json({ error: "수신자 번호가 필요합니다." }, { status: 400 });
    }

    const apiKey = Netlify.env.get("SOLAPI_API_KEY");
    const apiSecret = Netlify.env.get("SOLAPI_API_SECRET");
    const fromNumber = Netlify.env.get("SOLAPI_FROM_NUMBER") || "01035638940";

    if (!apiKey || !apiSecret) {
      return Response.json({ error: "서버 설정 오류" }, { status: 500 });
    }

    const cleanPhone = receiver.replace(/\D/g, "");
    const smsPurpose = purpose || "general";

    const db = getDatabase();

    const recentCodes = await db.sql`
      SELECT COUNT(*) as cnt FROM sms_verifications
      WHERE phone = ${cleanPhone}
        AND created_at > NOW() - INTERVAL '1 minute'
    `;
    if (recentCodes[0]?.cnt > 0) {
      return Response.json({
        success: false,
        error: "1분 후에 다시 시도해 주세요.",
      }, { status: 429 });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const messageService = new SolapiMessageService(apiKey, apiSecret);

    await messageService.sendOne({
      to: receiver,
      from: fromNumber,
      text: `[픽스폴리오] 인증번호는 [${code}] 입니다.`,
    });

    await db.sql`
      UPDATE sms_verifications
      SET verified = TRUE
      WHERE phone = ${cleanPhone} AND purpose = ${smsPurpose} AND verified = FALSE
    `;

    await db.sql`
      INSERT INTO sms_verifications (phone, code, purpose, expires_at)
      VALUES (${cleanPhone}, ${code}, ${smsPurpose}, NOW() + INTERVAL '5 minutes')
    `;

    return Response.json({
      success: true,
      message: "인증번호가 발송되었습니다.",
    });
  } catch (error: any) {
    console.error("SMS Sending Error:", error);
    return Response.json({
      error: "서버 에러",
      message: error.message || "알 수 없는 에러가 발생했습니다.",
    }, { status: 500 });
  }
};

export const config: Config = {
  path: "/.netlify/functions/send-sms",
};
