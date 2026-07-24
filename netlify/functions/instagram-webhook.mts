import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

/**
 * 인스타그램 웹훅 수신기.
 * - GET  : Meta 웹훅 검증 챌린지 응답(hub.challenge).
 * - POST : 게시물 "댓글" 이벤트를 받아 해당 사용자의 DM 자동화 규칙과 매칭하고,
 *          조건에 맞으면 댓글 작성자에게 자동 DM(및 선택 시 공개 답글)을 보낸다.
 *
 * 실제 트리거를 받으려면 Meta 앱 대시보드에서 이 URL(/api/instagram/webhook)을
 * 웹훅 콜백으로 등록하고 comments 필드를 구독해야 한다. 인스타그램 정책상
 * 댓글에 대한 DM 은 comment_id 기반 "비공개 답장(private reply)"으로 발송한다.
 */

const GRAPH_VERSION = "v21.0";

interface DmMessageButton { id?: string; label: string; url: string; }
interface DmAutomationItem {
  id: string;
  name: string;
  enabled: boolean;
  commentMatch: "all" | "keyword";
  keywords: string[];
  replyEnabled: boolean;
  replies: string[];
  followFilter: "all" | "followers" | "non_followers";
  message: string;
  buttons: DmMessageButton[];
}
interface DmSettings {
  enabled: boolean;
  igUserId?: string;
  igAccountId?: string;
  accessToken?: string;
  tokenSource?: string;
  automations?: DmAutomationItem[];
}

function graphHost(settings: DmSettings) {
  return settings.tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com";
}

function buildMessagePayload(a: DmAutomationItem) {
  const buttons = (a.buttons || [])
    .filter((b) => b && b.url && b.label)
    .slice(0, 3)
    .map((b) => ({ type: "web_url", url: b.url, title: b.label.slice(0, 20) }));
  if (buttons.length > 0) {
    return {
      attachment: {
        type: "template",
        payload: { template_type: "button", text: a.message.slice(0, 640), buttons },
      },
    };
  }
  return { text: a.message };
}

async function appendLog(username: string, entry: Record<string, unknown>) {
  try {
    const logStore = getStore("dm-automation-log");
    const key = `log_${username}`;
    const existing = ((await logStore.get(key, { type: "json" })) as any[]) || [];
    existing.unshift({ ...entry, at: new Date().toISOString() });
    await logStore.setJSON(key, existing.slice(0, 50));
  } catch (e) {
    console.error("[ig-webhook] log write failed:", e);
  }
}

function matchAutomation(a: DmAutomationItem, text: string): boolean {
  if (!a.enabled || !a.message?.trim()) return false;
  if (a.commentMatch === "all") return true;
  const lower = text.toLowerCase();
  return (a.keywords || []).some((k) => k && lower.includes(k.toLowerCase()));
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);

  // ── 웹훅 검증 (GET) ──
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
      return new Response(challenge || "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Meta 는 빠른 200 응답을 기대한다. 처리 중 오류가 나도 200 을 돌려준다.
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  try {
    const store = getStore("dm-automation");
    const index = getStore("dm-automation-index");

    for (const entry of payload?.entry || []) {
      const igAccountId = String(entry?.id || "");
      if (!igAccountId) continue;

      // 이 IG 계정이 어느 사용자 소유인지 조회
      const username = (await index.get(`ig_${igAccountId}`)) as string | null;
      if (!username) continue;

      const settings = (await store.get(`dm_${username}`, { type: "json" })) as DmSettings | null;
      if (!settings || !settings.enabled || !settings.accessToken) continue;
      const igId = settings.igUserId || settings.igAccountId || igAccountId;

      for (const change of entry?.changes || []) {
        if (change?.field !== "comments") continue;
        const value = change.value || {};
        const commentId = String(value?.id || "");
        const commentText = String(value?.text || "");
        const fromId = String(value?.from?.id || "");
        // 자기 자신(계정 소유자)의 댓글은 무시
        if (!commentId || fromId === igId) continue;

        const automation = (settings.automations || []).find((a) => matchAutomation(a, commentText));
        if (!automation) continue;

        // 1) 선택 시 공개 답글 (랜덤)
        if (automation.replyEnabled && (automation.replies || []).filter(Boolean).length > 0) {
          const pool = automation.replies.filter(Boolean);
          const reply = pool[Math.floor(Math.random() * pool.length)];
          try {
            await fetch(`https://${graphHost(settings)}/${GRAPH_VERSION}/${encodeURIComponent(commentId)}/replies`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.accessToken}` },
              body: JSON.stringify({ message: reply }),
            });
          } catch (e) {
            console.warn("[ig-webhook] public reply failed:", e);
          }
        }

        // 2) 비공개 답장(DM) — recipient.comment_id 사용
        try {
          const res = await fetch(`https://${graphHost(settings)}/${GRAPH_VERSION}/${encodeURIComponent(igId)}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.accessToken}` },
            body: JSON.stringify({
              recipient: { comment_id: commentId },
              message: buildMessagePayload(automation),
            }),
          });
          const result = (await res.json().catch(() => ({}))) as any;
          if (res.ok) {
            await appendLog(username, { status: "sent", recipientId: fromId, ruleId: automation.id, messageId: result?.message_id });
          } else {
            await appendLog(username, { status: "failed", recipientId: fromId, ruleId: automation.id, error: result?.error?.message || `HTTP ${res.status}` });
          }
        } catch (e: any) {
          await appendLog(username, { status: "failed", recipientId: fromId, ruleId: automation.id, error: e?.message || "send error" });
        }
      }
    }
  } catch (e) {
    console.error("[ig-webhook] processing error:", e);
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
};

export const config: Config = {
  path: "/api/instagram/webhook",
};
