export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ message: "Method not allowed" }, { status: 405 });
  }

  const apiKey = Netlify.env.get("SOLAPI_API_KEY");
  const apiSecret = Netlify.env.get("SOLAPI_API_SECRET");
  const fromNumber = Netlify.env.get("SOLAPI_FROM_NUMBER");

  if (!apiKey || !apiSecret || !fromNumber) {
    return Response.json(
      { message: "SMS 서비스가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { message: "잘못된 요청입니다." },
      { status: 400 }
    );
  }

  const { receiver } = body;
  if (!receiver) {
    return Response.json(
      { message: "휴대폰 번호를 입력해 주세요." },
      { status: 400 }
    );
  }

  const phone = receiver.replace(/[^0-9]/g, "");
  if (!/^01[016789]\d{7,8}$/.test(phone)) {
    return Response.json(
      { message: "올바른 휴대폰 번호를 입력해 주세요." },
      { status: 400 }
    );
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));

  try {
    const date = new Date().toISOString();
    const salt = crypto.randomUUID();
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(apiSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(date + salt)
    );
    const signature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({
        message: {
          to: phone,
          from: fromNumber,
          text: `[PICKSFOLIO] 인증번호는 [${code}] 입니다.`,
          type: "SMS",
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("Solapi API error:", res.status, errBody);
      return Response.json(
        { message: "인증번호 발송에 실패했습니다." },
        { status: 500 }
      );
    }

    return Response.json({ code });
  } catch (err) {
    console.error("SMS send error:", err);
    return Response.json(
      { message: "인증번호 발송에 실패했습니다." },
      { status: 500 }
    );
  }
};
