import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { buildDmMessages, sendDmMessages } from "./_shared/instagram-dm.mts";
import type { DmButton, DmCard } from "./_shared/instagram-dm.mts";

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

interface DmAutomationItem {
  id: string;
  name: string;
  enabled: boolean;
  commentMatch: "all" | "keyword";
  keywords: string[];
  replyEnabled: boolean;
  replies: string[];
  followFilter: "all" | "followers" | "non_followers";
  mediaScope?: "all" | "selected";
  mediaIds?: string[];
  messageType?: "text" | "carousel";
  message: string;
  buttons: DmButton[];
  cards?: DmCard[];
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
  // 인스타그램은 버튼 템플릿을 지원하지 않으므로 링크 버튼도 제네릭 템플릿
  // 카드로 감싸 보낸다. 자세한 내용은 _shared/instagram-dm.mts 참고.
  return buildDmMessages({
    messageType: a.messageType,
    message: a.message,
    buttons: a.buttons,
    cards: a.cards,
  });
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

function hasContent(a: DmAutomationItem): boolean {
  if (a.messageType === "carousel") {
    return (a.cards || []).some((c) => c && (c.title?.trim() || c.imageUrl?.trim()));
  }
  return Boolean(a.message?.trim());
}

function matchAutomation(a: DmAutomationItem, text: string, mediaId: string): boolean {
  if (!a.enabled || !hasContent(a)) return false;
  // 특정 게시물에만 적용하도록 설정된 경우 댓글이 달린 게시물이 목록에 있어야 한다.
  if (a.mediaScope === "selected") {
    if (!mediaId || !(a.mediaIds || []).includes(mediaId)) return false;
  }
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
        // 댓글이 달린 게시물(미디어) ID — 특정 게시물 대상 자동화 매칭에 사용.
        const mediaId = String(value?.media?.id || value?.media_id || "");
        // 자기 자신(계정 소유자)의 댓글은 무시
        if (!commentId || fromId === igId) continue;

        const automation = (settings.automations || []).find((a) => matchAutomation(a, commentText, mediaId));
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
          const result = await sendDmMessages({
            graphHost: graphHost(settings),
            graphVersion: GRAPH_VERSION,
            igId,
            accessToken: settings.accessToken,
            recipient: { comment_id: commentId },
            messages: buildMessagePayload(automation),
          });
          if (result.ok) {
            await appendLog(username, { status: "sent", recipientId: fromId, ruleId: automation.id, messageId: result.messageId });
          } else {
            await appendLog(username, { status: "failed", recipientId: fromId, ruleId: automation.id, error: result.error });
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
