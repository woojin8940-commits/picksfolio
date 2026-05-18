import { createHmac, randomUUID } from "node:crypto";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed", message: "Method not allowed" }),
    };
  }

  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const fromNumber = process.env.SOLAPI_FROM_NUMBER;

  if (!apiKey || !apiSecret || !fromNumber) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "SMS 서비스가 설정되지 않았습니다.", message: "SMS 서비스가 설정되지 않았습니다." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "잘못된 요청입니다.", message: "잘못된 요청입니다." }),
    };
  }

  const receiver = body.receiver;
  if (!receiver) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "수신자 번호가 필요합니다.", message: "수신자 번호가 필요합니다." }),
    };
  }

  const phone = receiver.replace(/[^0-9]/g, "");
  if (!/^01[016789]\d{7,8}$/.test(phone)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "올바른 휴대폰 번호를 입력해 주세요.", message: "올바른 휴대폰 번호를 입력해 주세요." }),
    };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const date = new Date().toISOString();
  const salt = randomUUID();
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  const authorization = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

  try {
    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({
        message: {
          to: phone,
          from: fromNumber.replace(/[^0-9]/g, ""),
          text: `[PICKSFOLIO] 인증번호는 [${code}] 입니다.`,
          type: "SMS",
        },
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      console.error("Solapi API error:", res.status, JSON.stringify(result));
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "인증번호 발송에 실패했습니다.", message: "인증번호 발송에 실패했습니다." }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        message: "인증번호가 발송되었습니다.",
        code,
        result,
      }),
    };
  } catch (err) {
    console.error("SMS send error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "인증번호 발송에 실패했습니다.", message: "인증번호 발송에 실패했습니다." }),
    };
  }
};
