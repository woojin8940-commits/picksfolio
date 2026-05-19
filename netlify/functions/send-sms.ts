import { Handler } from "@netlify/functions";
import { SolapiMessageService } from "solapi";

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const { receiver } = JSON.parse(event.body || "{}");

    if (!receiver) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "수신자 번호가 필요합니다." }),
      };
    }

    const apiKey = process.env.SOLAPI_API_KEY;
    const apiSecret = process.env.SOLAPI_API_SECRET;
    const fromNumber = process.env.SOLAPI_FROM_NUMBER || "01035638940";

    if (!apiKey || !apiSecret) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "서버 설정 오류", message: "API 키가 설정되지 않았습니다." }),
      };
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const messageService = new SolapiMessageService(apiKey, apiSecret);

    const result = await messageService.sendOne({
      to: receiver,
      from: fromNumber,
      text: `[픽스폴리오] 인증번호는 [${code}] 입니다.`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "인증번호가 발송되었습니다.",
        code: code,
        result: result,
      }),
    };
  } catch (error: any) {
    console.error("SMS Sending Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "서버 에러",
        message: error.message || "알 수 없는 에러가 발생했습니다.",
      }),
    };
  }
};

export { handler };
