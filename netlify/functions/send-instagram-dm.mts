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
  igUsername: string;
  accessToken?: string;
  rules: { id: string; trigger: string; keyword?: string; message: string; enabled: boolean }[];
}

interface SendBody {
  username: string;
  recipientId: string;
  message: string;
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

  if (!settings || !settings.igAccountId || !settings.accessToken) {
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
          "인스타그램 계정이 아직 연결되지 않았습니다. DM 자동화 설정에서 계정 ID와 액세스 토큰을 저장한 뒤 다시 시도하세요.",
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

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
      settings.igAccountId,
    )}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
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
