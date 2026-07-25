import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { buildDmMessages, sendDmMessages } from "./_shared/instagram-dm.mts";
import type { DmButton, DmCard } from "./_shared/instagram-dm.mts";
import { dmAutomationAllowed } from "./_shared/dm-automation-access.mts";

/**
 * 인스타그램 웹훅 수신기.
 * - GET  : Meta 웹훅 검증 챌린지 응답(hub.challenge).
 * - POST : 게시물 "댓글" 이벤트를 받아 해당 사용자의 DM 자동화 규칙과 매칭하고,
 *          조건에 맞으면 댓글 작성자에게 자동 DM(및 선택 시 공개 답글)을 보낸다.
 *
 * 실제 트리거를 받으려면 Meta 앱 대시보드에서 이 URL(/api/instagram/webhook)을
 * 웹훅 콜백으로 등록하고 comments 필드를 구독해야 한다. 앱 수준 등록만으로는
 * 부족하고 계정별로도 구독해야 하는데, 이는 연동 시점에
 * `_shared/instagram-webhook-subscribe.mts` 가 처리한다. 인스타그램 정책상
 * 댓글에 대한 DM 은 comment_id 기반 "비공개 답장(private reply)"으로 발송한다.
 *
 * 공개 답글은 `/{comment-id}/replies` 로 보내며, 이 엣지는 `message` 를 폼
 * 파라미터로 받는다(JSON 본문은 인식하지 못한다).
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

/** 공개 답글로 남길 문구가 하나라도 설정돼 있는지. */
function hasReplyContent(a: DmAutomationItem): boolean {
  return Boolean(a.replyEnabled) && (a.replies || []).some((r) => r && r.trim());
}

function matchAutomation(a: DmAutomationItem, text: string, mediaId: string): boolean {
  // DM 본문이 없어도 공개 답글만 남기는 자동화는 동작해야 한다.
  if (!a.enabled || (!hasContent(a) && !hasReplyContent(a))) return false;
  // 특정 게시물에만 적용하도록 설정된 경우 댓글이 달린 게시물이 목록에 있어야 한다.
  if (a.mediaScope === "selected") {
    if (!mediaId || !(a.mediaIds || []).includes(mediaId)) return false;
  }
  if (a.commentMatch === "all") return true;
  const lower = text.toLowerCase();
  return (a.keywords || []).some((k) => k && lower.includes(k.toLowerCase()));
}

/**
 * 댓글에 공개 답글을 남긴다.
 *
 * Graph API 의 `/{comment-id}/replies` 엣지는 `message` 를 **폼 파라미터**로 받는다.
 * JSON 본문으로 보내면 파라미터를 인식하지 못해 `message is required`(code 100) 로
 * 거절되는데, 이전 구현은 JSON 으로 보내면서 응답조차 확인하지 않아 실패가 조용히
 * 묻혔다(로그에도 남지 않아 화면에서는 "답글 기능이 그냥 안 된다"로 보였다).
 */
async function postCommentReply(args: {
  host: string;
  commentId: string;
  accessToken: string;
  message: string;
}): Promise<{ ok: boolean; replyId?: string; error?: string }> {
  const { host, commentId, accessToken, message } = args;
  try {
    const res = await fetch(
      `https://${host}/${GRAPH_VERSION}/${encodeURIComponent(commentId)}/replies`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${accessToken}`,
        },
        body: new URLSearchParams({ message }),
      },
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.error) {
      return {
        ok: false,
        error: data?.error?.message || `Graph API 오류 (HTTP ${res.status})`,
      };
    }
    return { ok: true, replyId: data?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || "답글 전송 중 오류" };
  }
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
      // 디엠 자동화는 프로 플랜 전용 — 플랜이 없거나 만료된 계정은 발송하지 않는다.
      if (!(await dmAutomationAllowed(username))) continue;
      const igId = settings.igUserId || settings.igAccountId || igAccountId;

      for (const change of entry?.changes || []) {
        if (change?.field !== "comments") continue;
        const value = change.value || {};
        const commentId = String(value?.id || "");
        const commentText = String(value?.text || "");
        const fromId = String(value?.from?.id || "");
        // 댓글이 달린 게시물(미디어) ID — 특정 게시물 대상 자동화 매칭에 사용.
        const mediaId = String(value?.media?.id || value?.media_id || "");
        // 대댓글이면 부모 댓글 ID 가 함께 온다. 인스타그램은 답글에 다시 답글을
        // 달 수 없으므로, 공개 답글은 항상 최상위 댓글에 남긴다.
        const parentId = String(value?.parent_id || "");
        // 자기 자신(계정 소유자)의 댓글은 무시
        if (!commentId || fromId === igId) continue;

        const automation = (settings.automations || []).find((a) => matchAutomation(a, commentText, mediaId));
        if (!automation) continue;

        // 1) 선택 시 공개 답글 (랜덤). 성공·실패 모두 로그에 남겨 화면의 활동
        //    기록에서 답글이 실제로 달렸는지 확인할 수 있게 한다.
        if (automation.replyEnabled) {
          const pool = (automation.replies || []).filter((r) => r && r.trim());
          if (pool.length === 0) {
            await appendLog(username, {
              kind: "reply",
              status: "skipped",
              reason: "답글 문구가 비어 있습니다.",
              recipientId: fromId,
              ruleId: automation.id,
            });
          } else {
            const reply = pool[Math.floor(Math.random() * pool.length)];
            const replyResult = await postCommentReply({
              host: graphHost(settings),
              commentId: parentId || commentId,
              accessToken: settings.accessToken,
              message: reply,
            });
            if (replyResult.ok) {
              await appendLog(username, {
                kind: "reply",
                status: "sent",
                recipientId: fromId,
                ruleId: automation.id,
                messageId: replyResult.replyId,
              });
            } else {
              console.warn("[ig-webhook] public reply failed:", replyResult.error);
              await appendLog(username, {
                kind: "reply",
                status: "failed",
                recipientId: fromId,
                ruleId: automation.id,
                error: replyResult.error,
              });
            }
          }
        }

        // 2) 비공개 답장(DM) — recipient.comment_id 사용. 답글만 설정한 자동화는
        //    보낼 DM 본문이 없으므로 발송을 건너뛴다(실패로 기록하지 않는다).
        if (!hasContent(automation)) continue;
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
            await appendLog(username, { kind: "dm", status: "sent", recipientId: fromId, ruleId: automation.id, messageId: result.messageId });
          } else {
            await appendLog(username, { kind: "dm", status: "failed", recipientId: fromId, ruleId: automation.id, error: result.error });
          }
        } catch (e: any) {
          await appendLog(username, { kind: "dm", status: "failed", recipientId: fromId, ruleId: automation.id, error: e?.message || "send error" });
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
