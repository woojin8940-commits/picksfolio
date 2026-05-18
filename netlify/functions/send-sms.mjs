import { createHmac, randomUUID } from "node:crypto";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed", message: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = Netlify.env.get("SOLAPI_API_KEY");
  const apiSecret = Netlify.env.get("SOLAPI_API_SECRET");
  const fromNumber = Netlify.env.get("SOLAPI_FROM_NUMBER");

  if (!apiKey || !apiSecret || !fromNumber) {
    return new Response(
      JSON.stringify({ error: "SMS 서비스가 설정되지 않았습니다.", message: "SMS 서비스가 설정되지 않았습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "잘못된 요청입니다.", message: "잘못된 요청입니다." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const receiver = body.receiver;
  if (!receiver) {
    return new Response(
      JSON.stringify({ error: "수신자 번호가 필요합니다.", message: "수신자 번호가 필요합니다." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const phone = receiver.replace(/[^0-9]/g, "");
  if (!/^01[016789]\d{7,8}$/.test(phone)) {
    return new Response(
      JSON.stringify({ error: "올바른 휴대폰 번호를 입력해 주세요.", message: "올바른 휴대폰 번호를 입력해 주세요." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
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
      return new Response(
        JSON.stringify({ error: "인증번호 발송에 실패했습니다.", message: "인증번호 발송에 실패했습니다." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "인증번호가 발송되었습니다.",
        code,
        result,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("SMS send error:", err);
    return new Response(
      JSON.stringify({ error: "인증번호 발송에 실패했습니다.", message: "인증번호 발송에 실패했습니다." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
