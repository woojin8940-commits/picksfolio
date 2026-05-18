import { SolapiMessageService } from "solapi";

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

  const messageService = new SolapiMessageService(apiKey, apiSecret);

  try {
    await messageService.send({
      to: phone,
      from: fromNumber,
      text: `[PICKSFOLIO] 인증번호는 [${code}] 입니다.`,
      type: "SMS",
    });

    return Response.json({ code });
  } catch (err) {
    console.error("SMS send error:", err);
    return Response.json(
      { message: "인증번호 발송에 실패했습니다." },
      { status: 500 }
    );
  }
};
