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
