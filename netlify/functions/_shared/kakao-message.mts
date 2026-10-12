import { createClient } from "@supabase/supabase-js";
import { SolapiMessageService } from "solapi";
import { alimtalkPaused } from "./alimtalk-pause.mts";

export type KakaoMessageRequest = {
  phone?: string;
  username?: string;
  message: string;
  templateId?: string;
  variables?: Record<string, string>;
};

export type KakaoMessageResult =
  | { success: true; type?: "alimtalk" | "sms"; skipped?: boolean; paused?: boolean }
  | { success: false; error: string };

const env = (name: string): string => {
  try {
    const value = (globalThis as any)?.Netlify?.env?.get?.(name);
    if (typeof value === "string" && value) return value;
  } catch {}
  return String((globalThis as any)?.process?.env?.[name] || "");
};

async function phoneForUsername(username: string): Promise<string> {
  const url = env("VITE_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return "";
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client
    .from("profiles")
    .select("phone")
    .eq("username", username.trim().toLowerCase())
    .maybeSingle();
  return error ? "" : String(data?.phone || "");
}

export async function sendKakaoAlimtalk(body: KakaoMessageRequest): Promise<KakaoMessageResult> {
  if (alimtalkPaused()) {
    return { success: true, skipped: true, paused: true };
  }

  const message = String(body.message || "").trim();
  if (!message || message.length > 2000) {
    return { success: false, error: "invalid message" };
  }

  const apiKey = env("SOLAPI_API_KEY");
  const apiSecret = env("SOLAPI_API_SECRET");
  const from = env("SOLAPI_FROM_NUMBER").replace(/\D/g, "");
  if (!apiKey || !apiSecret || !from) {
    return { success: false, error: "notification service not configured" };
  }

  const rawPhone = body.phone || (body.username ? await phoneForUsername(body.username) : "");
  const to = String(rawPhone || "").replace(/\D/g, "");
  if (!/^\d{10,11}$/.test(to)) {
    return { success: false, error: "recipient phone not found" };
  }

  const service = new SolapiMessageService(apiKey, apiSecret);
  const pfId = env("SOLAPI_KAKAO_PFID");
  const templateId = String(body.templateId || "").trim();

  if (pfId && templateId) {
    try {
      await service.sendOne({
        to,
        from,
        text: message,
        kakaoOptions: {
          pfId,
          templateId,
          variables: body.variables || {},
        },
      });
      return { success: true, type: "alimtalk" };
    } catch {}
  }

  try {
    await service.sendOne({ to, from, text: message });
    return { success: true, type: "sms" };
  } catch {
    return { success: false, error: "notification send failed" };
  }
}

export type KakaoChannelResult =
  | { success: true; type: "kakao" | "sms" }
  | { success: false; error: string };

/**
 * 담당자가 직접 쓴 문장을 픽스폴리오 카카오톡 채널 이름으로 보낸다.
 *
 * 알림톡은 심사받은 템플릿 문구만 나갈 수 있어서 담당자가 쓴 자유 문장을 실을 수
 * 없다. 자유 문장을 채널 이름으로 보내는 길은 친구톡이었고, 카카오가 2025-12-31 에
 * 친구톡을 끝내면서 브랜드 메시지(자유형)로 바뀌었다. 그래서 BMS_TEXT 로 보낸다.
 *
 * targeting 은 "I"(요청한 수신자 중 채널 친구)만 쓴다. M · N 은 카카오 승인을 받은
 * 대형 채널 전용이다. 채널을 추가하지 않은 사람에게는 카카오톡이 닿지 않으므로
 * disableSms 를 끄고 솔라피가 같은 문장을 문자로 대신 보내게 둔다 — 담당자는 "보냈는데
 * 안 갔다"보다 "문자로 갔다"를 원한다. 대체 발송은 솔라피 쪽에서 비동기로 일어나므로
 * 여기서 돌려주는 type 은 "카카오톡으로 접수"까지만 뜻한다.
 *
 * 알림톡 중지 스위치(ALIMTALK_PAUSED)는 보지 않는다. 그 스위치는 템플릿 심사 중
 * 자동 발송이 문자로 새는 것을 막으려는 것이고, 이 발송은 템플릿을 쓰지 않는다.
 */
export async function sendKakaoChannelMessage(body: {
  phone?: string;
  username?: string;
  message: string;
}): Promise<KakaoChannelResult> {
  const message = String(body.message || "").trim();
  if (!message || message.length > KAKAO_CHANNEL_MESSAGE_MAX) {
    return { success: false, error: "invalid message" };
  }

  const apiKey = env("SOLAPI_API_KEY");
  const apiSecret = env("SOLAPI_API_SECRET");
  const from = env("SOLAPI_FROM_NUMBER").replace(/\D/g, "");
  if (!apiKey || !apiSecret || !from) {
    return { success: false, error: "notification service not configured" };
  }

  const rawPhone = body.phone || (body.username ? await phoneForUsername(body.username) : "");
  const to = String(rawPhone || "").replace(/\D/g, "");
  if (!/^\d{10,11}$/.test(to)) {
    return { success: false, error: "recipient phone not found" };
  }

  const service = new SolapiMessageService(apiKey, apiSecret);
  const pfId = env("SOLAPI_KAKAO_PFID");

  if (pfId) {
    try {
      await service.sendOne({
        to,
        from,
        text: message,
        type: "BMS_TEXT",
        kakaoOptions: {
          pfId,
          disableSms: false,
          bms: { targeting: "I", chatBubbleType: "TEXT" },
        },
      } as any);
      return { success: true, type: "kakao" };
    } catch (e) {
      console.error("[kakao-channel] brand message failed, falling back to SMS:", e);
    }
  }

  try {
    await service.sendOne({ to, from, text: message });
    return { success: true, type: "sms" };
  } catch {
    return { success: false, error: "notification send failed" };
  }
}

/** 브랜드 메시지 텍스트형 본문 한도. 넘치는 글은 카카오가 거절한다. */
export const KAKAO_CHANNEL_MESSAGE_MAX = 1000;

export { phoneForUsername };
