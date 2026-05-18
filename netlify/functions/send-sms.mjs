import { createHmac, randomUUID } from "node:crypto";

const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send";

function generateAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = randomUUID();
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isValidKoreanMobile(phone) {
  return /^01[016789]\d{7,8}$/.test(phone);
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ message: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  const apiKey = Netlify.env.get("SOLAPI_API_KEY");
  const apiSecret = Netlify.env.get("SOLAPI_API_SECRET");
  const fromNumber = Netlify.env.get("SOLAPI_FROM_NUMBER");

  if (!apiKey || !apiSecret || !fromNumber) {
    return new Response(
      JSON.stringify({ message: "SMS 서비스가 설정되지 않았습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ message: "잘못된 요청입니다." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { receiver } = body;
  if (!receiver) {
    return new Response(
      JSON.stringify({ message: "휴대폰 번호를 입력해 주세요." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const phone = receiver.replace(/[^0-9]/g, "");
  if (!isValidKoreanMobile(phone)) {
    return new Response(
      JSON.stringify({ message: "올바른 휴대폰 번호를 입력해 주세요." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const code = generateCode();

  try {
    const authorization = generateAuthHeader(apiKey, apiSecret);

    const res = await fetch(SOLAPI_SEND_URL, {
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

    if (!res.ok) {
      const errText = await res.text();
      console.error("Solapi API error:", res.status, errText);
      return new Response(
        JSON.stringify({ message: "인증번호 발송에 실패했습니다." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ code }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("SMS send error:", err);
    return new Response(
      JSON.stringify({ message: "인증번호 발송에 실패했습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
