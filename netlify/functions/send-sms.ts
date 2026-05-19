import { Handler } from "@netlify/functions";
import { SolapiMessageService } from "solapi";
import { getStore } from "@netlify/blobs";

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://picks-folio.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeadersFor(origin: string | undefined) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

// Per-phone-number rate limit: at most N requests per window.
const SMS_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SMS_MAX_PER_WINDOW = 5;
// Minimum spacing between two consecutive sends to the same number.
const SMS_MIN_SPACING_MS = 30 * 1000;

type SmsRateRecord = {
  count: number;
  windowStart: number;
  lastSentAt: number;
};

async function checkAndRecordRate(phone: string): Promise<{ ok: true } | { ok: false; retryAfterMs: number; reason: string }> {
  const store = getStore({ name: "sms-rate-limit", consistency: "strong" });
  const key = `phone:${phone}`;
  const now = Date.now();

  const existing = (await store.get(key, { type: "json" })) as SmsRateRecord | null;
  let record: SmsRateRecord;

  if (!existing || now - existing.windowStart > SMS_WINDOW_MS) {
    record = { count: 0, windowStart: now, lastSentAt: 0 };
  } else {
    record = existing;
  }

  if (record.lastSentAt && now - record.lastSentAt < SMS_MIN_SPACING_MS) {
    return {
      ok: false,
      retryAfterMs: SMS_MIN_SPACING_MS - (now - record.lastSentAt),
      reason: "잠시 후 다시 시도해주세요.",
    };
  }
  if (record.count >= SMS_MAX_PER_WINDOW) {
    return {
      ok: false,
      retryAfterMs: SMS_WINDOW_MS - (now - record.windowStart),
      reason: "시간당 인증번호 발송 한도를 초과했습니다.",
    };
  }

  record.count += 1;
  record.lastSentAt = now;
  await store.setJSON(key, record);
  return { ok: true };
}

const handler: Handler = async (event) => {
  const corsHeaders = corsHeadersFor(event.headers?.origin || event.headers?.Origin);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const { receiver } = JSON.parse(event.body || "{}");

    if (!receiver) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "수신자 번호가 필요합니다." }),
      };
    }

    const normalizedPhone = String(receiver).replace(/[^0-9]/g, "");
    if (normalizedPhone.length < 9 || normalizedPhone.length > 15) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "올바른 전화번호 형식이 아닙니다." }),
      };
    }

    const apiKey = process.env.SOLAPI_API_KEY;
    const apiSecret = process.env.SOLAPI_API_SECRET;
    const fromNumber = process.env.SOLAPI_FROM_NUMBER;

    if (!apiKey || !apiSecret || !fromNumber) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "서버 설정 오류", message: "SMS 발신 설정이 누락되었습니다." }),
      };
    }

    const rate = await checkAndRecordRate(normalizedPhone);
    if (!rate.ok) {
      return {
        statusCode: 429,
        headers: { ...corsHeaders, "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) },
        body: JSON.stringify({ error: "Too Many Requests", message: rate.reason }),
      };
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const messageService = new SolapiMessageService(apiKey, apiSecret);

    const result = await messageService.sendOne({
      to: normalizedPhone,
      from: fromNumber,
      text: `[픽스폴리오] 인증번호는 [${code}] 입니다.`,
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
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
      headers: corsHeaders,
      body: JSON.stringify({
        error: "서버 에러",
        message: error.message || "알 수 없는 에러가 발생했습니다.",
      }),
    };
  }
};

export { handler };
