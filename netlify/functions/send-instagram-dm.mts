import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

/**
 * 인스타그램 DM 발송.
 * - 사용자별로 저장된 DM 자동화 설정(계정 ID + 액세스 토큰)을 읽어
 *   Instagram Graph API(메시징)로 실제 DM 을 전송한다.
 * - 자격 정보가 없으면 배포/연동 없이도 UI 흐름을 확인할 수 있도록
 *   친절한 안내 메시지를 반환한다(에러가 아닌 안내).
 * - 발송 결과는 사용자별 로그(dm-automation-log)에 최근 50건까지 남긴다.
 *
 * Instagram 메시징 정책상 사용자가 먼저 메시지를 보낸 뒤 24시간 이내에만
 * 자유 형식 메시지를 보낼 수 있고, 수신자는 IGSID(Instagram-scoped ID)로
 * 지정해야 한다.
 */

const GRAPH_VERSION = "v21.0";

interface DmSettings {
  enabled: boolean;
  igAccountId: string;
  igUserId?: string;
  igUsername: string;
  accessToken?: string;
  tokenSource?: string;
  rules?: unknown[];
}

interface SendButton {
  label: string;
  url: string;
}

interface SendCard {
  title: string;
  subtitle: string;
  imageUrl: string;
  buttonLabel: string;
  buttonUrl: string;
}

interface SendBody {
  username: string;
  recipientId: string;
  message: string;
  buttons?: SendButton[];
  messageType?: "text" | "carousel";
  cards?: SendCard[];
  ruleId?: string;
  test?: boolean;
}

async function appendLog(username: string, entry: Record<string, unknown>) {
  try {
    const logStore = getStore("dm-automation-log");
    const key = `log_${username}`;
    const existing = ((await logStore.get(key, { type: "json" })) as any[]) || [];
    existing.unshift({ ...entry, at: new Date().toISOString() });
    await logStore.setJSON(key, existing.slice(0, 50));
  } catch (e) {
    console.error("[send-instagram-dm] failed to write log:", e);
  }
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username = (body.username || "").toLowerCase();
  const recipientId = (body.recipientId || "").trim();
  const message = (body.message || "").trim();

  if (!username || !message) {
    return Response.json({ error: "username 과 message 는 필수입니다." }, { status: 400 });
  }

  const store = getStore("dm-automation");
  const settings = (await store.get(`dm_${username}`, { type: "json" })) as DmSettings | null;

  const igId = settings?.igUserId || settings?.igAccountId;
  if (!settings || !igId || !settings.accessToken) {
    await appendLog(username, {
      status: "skipped",
      reason: "not_connected",
      recipientId,
      ruleId: body.ruleId,
    });
    return Response.json(
      {
        success: false,
        connected: false,
        message:
          "인스타그램 계정이 아직 연동되지 않았습니다. DM 자동화 화면에서 계정을 연동한 뒤 다시 시도하세요.",
      },
      { status: 200 },
    );
  }

  if (!recipientId) {
    return Response.json(
      { success: false, message: "수신자 IGSID(recipientId)가 필요합니다." },
      { status: 400 },
    );
  }

  // Instagram Login(신) 토큰은 graph.instagram.com, 구 페이지 토큰은 graph.facebook.com 사용.
  const graphHost =
    settings.tokenSource === "instagram_login"
      ? "graph.instagram.com"
      : "graph.facebook.com";

  // 캐러셀 카드가 있으면 제네릭 템플릿, 링크 버튼이 있으면 버튼 템플릿,
  // 둘 다 없으면 일반 텍스트로 발송한다.
  const cards = Array.isArray(body.cards)
    ? body.cards
        .filter((c) => c && (c.title || c.imageUrl))
        .slice(0, 10)
        .map((c) => {
          const el: any = { title: (c.title || " ").slice(0, 80) };
          if (c.subtitle) el.subtitle = c.subtitle.slice(0, 80);
          if (c.imageUrl) el.image_url = c.imageUrl;
          if (c.buttonUrl && c.buttonLabel) {
            el.default_action = { type: "web_url", url: c.buttonUrl };
            el.buttons = [{ type: "web_url", url: c.buttonUrl, title: c.buttonLabel.slice(0, 20) }];
          }
          return el;
        })
    : [];

  const buttons = Array.isArray(body.buttons)
    ? body.buttons
        .filter((b) => b && b.url && b.label)
        .slice(0, 3)
        .map((b) => ({ type: "web_url", url: b.url, title: b.label.slice(0, 20) }))
    : [];

  const messagePayload =
    body.messageType === "carousel" && cards.length > 0
      ? {
          attachment: {
            type: "template",
            payload: { template_type: "generic", elements: cards },
          },
        }
      : buttons.length > 0
      ? {
          attachment: {
            type: "template",
            payload: { template_type: "button", text: message.slice(0, 640), buttons },
          },
        }
      : { text: message };

  try {
    const url = `https://${graphHost}/${GRAPH_VERSION}/${encodeURIComponent(igId)}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: messagePayload,
      }),
    });

    const result = (await res.json().catch(() => ({}))) as any;

    if (!res.ok) {
      const errMsg = result?.error?.message || `Graph API 오류 (HTTP ${res.status})`;
      await appendLog(username, {
        status: "failed",
        recipientId,
        ruleId: body.ruleId,
        error: errMsg,
      });
      return Response.json({ success: false, connected: true, message: errMsg }, { status: 200 });
    }

    await appendLog(username, {
      status: "sent",
      recipientId,
      ruleId: body.ruleId,
      messageId: result?.message_id,
      test: Boolean(body.test),
    });

    return Response.json({ success: true, connected: true, messageId: result?.message_id });
  } catch (e: any) {
    const errMsg = e?.message || "발송 중 알 수 없는 오류가 발생했습니다.";
    await appendLog(username, { status: "failed", recipientId, ruleId: body.ruleId, error: errMsg });
    return Response.json({ success: false, connected: true, message: errMsg }, { status: 200 });
  }
};

export const config: Config = {
  path: "/api/send-instagram-dm",
};
