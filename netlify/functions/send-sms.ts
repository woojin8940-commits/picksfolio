import type { Config } from "@netlify/functions";
import { SolapiMessageService } from "solapi";
import { getDatabase } from "@picks/netlify-database";

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

    // 아직 인증되지 않은 이전 코드를 무효화한다.
    //
    // 여기서 verified = TRUE 로 바꾸면 안 된다. 그 플래그는 이 시스템에서 "이 번호는
    // 인증을 통과했다"는 뜻이고, find-account 가 그것만 보고 비밀번호를 바꿔 준다.
    // 즉 같은 번호로 문자를 두 번 요청하는 것만으로 첫 번째 줄이 인증 완료로 승격돼,
    // 문자를 받지 못한 사람도 이름과 번호만 알면 남의 계정을 가져갈 수 있었다.
    // 무효화는 플래그가 아니라 만료로 처리한다.
    await db.sql`
      UPDATE sms_verifications
      SET expires_at = NOW()
      WHERE phone = ${cleanPhone}
        AND purpose = ${smsPurpose}
        AND verified = FALSE
        AND expires_at > NOW()
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
