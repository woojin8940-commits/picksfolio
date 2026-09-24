import type { Config } from "@netlify/functions";
import { SolapiMessageService } from "solapi";
import { getDatabase } from "@picks/netlify-database";
import { randomInt } from "node:crypto";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";

const PURPOSES = new Set(["signup", "business_signup", "find-id", "reset-password"]);

/**
 * 인증번호 문자의 발신번호.
 *
 * 픽스폴리오 고객센터 번호와 같은 번호로 나간다 — 문자를 받은 사람이 그 번호를
 * 그대로 저장해 두면 되고, 되전화가 고객센터로 연결된다.
 *
 * 실제 값은 `SOLAPI_FROM_NUMBER` 환경변수가 정한다. 알림톡 대체 발송과 라이브
 * 알림 문자도 같은 변수를 읽으므로, 번호를 바꿀 때는 그 변수 하나만 바꾸면 된다.
 * 여기 상수는 변수가 비어 있을 때의 기본값이자 "지금 쓰는 번호가 무엇인지"를
 * 코드에 남겨 두는 자리다. SOLAPI 는 사전등록된 발신번호만 허용하므로, 이 번호는
 * SOLAPI 콘솔에 등록돼 있어야 문자가 나간다.
 */
const DEFAULT_FROM_NUMBER = "070-7954-8452";

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
    const fromNumber = Netlify.env.get("SOLAPI_FROM_NUMBER") || DEFAULT_FROM_NUMBER;

    if (!apiKey || !apiSecret || !fromNumber) {
      return Response.json({ error: "서버 설정 오류" }, { status: 500 });
    }

    const cleanPhone = receiver.replace(/\D/g, "");
    const smsPurpose = purpose || "general";
    if (!/^01\d{8,9}$/.test(cleanPhone) || !PURPOSES.has(smsPurpose)) {
      return Response.json({ error: "잘못된 인증 요청입니다." }, { status: 400 });
    }

    for (const limit of [
      { bucket: "sms-phone-minute", key: cleanPhone, limit: 1, windowSeconds: 60 },
      { bucket: "sms-phone-day", key: cleanPhone, limit: 10, windowSeconds: 86400 },
      { bucket: "sms-ip-day", key: clientIp(req), limit: 30, windowSeconds: 86400 },
    ]) {
      const checked = await checkRateLimit(limit);
      if (!checked.ok) return checked.response;
    }

    const db = getDatabase();

    const recentCodes = await db.sql`
      SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 minute') AS recent,
             COUNT(*) AS daily
      FROM sms_verifications
      WHERE phone = ${cleanPhone}
        AND created_at > NOW() - INTERVAL '1 day'
    `;
    if (Number(recentCodes[0]?.recent || 0) > 0 || Number(recentCodes[0]?.daily || 0) >= 10) {
      return Response.json({
        success: false,
        error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      }, { status: 429 });
    }

    const code = randomInt(100000, 1000000).toString();

    const reserved = await db.sql`
      INSERT INTO sms_verifications (phone, code, purpose, expires_at)
      VALUES (${cleanPhone}, ${code}, ${smsPurpose}, NOW() + INTERVAL '5 minutes')
      RETURNING id
    `;
    const reservationId = reserved[0]?.id;
    if (!reservationId) throw new Error("SMS reservation failed");

    const messageService = new SolapiMessageService(apiKey, apiSecret);

    try {
      await messageService.sendOne({
        to: cleanPhone,
        from: fromNumber,
        text: `[픽스폴리오] 인증번호는 [${code}] 입니다.`,
      });
    } catch (sendError) {
      try {
        await db.sql`
          UPDATE sms_verifications SET expires_at = NOW()
          WHERE id = ${reservationId}
        `;
      } catch {}
      throw sendError;
    }

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
        AND id < ${reservationId}
        AND verified = FALSE
        AND expires_at > NOW()
    `;

    return Response.json({
      success: true,
      message: "인증번호가 발송되었습니다.",
    });
  } catch (error: any) {
    console.error("SMS Sending Error:", error);
    return Response.json({
      error: "서버 에러",
      message: "인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }, { status: 500 });
  }
};

export const config: Config = {
  path: "/.netlify/functions/send-sms",
  rateLimit: { windowSize: 60, windowLimit: 5, aggregateBy: "ip" },
};
