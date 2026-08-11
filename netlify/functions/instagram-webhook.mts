import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { buildDmMessages, sendDmMessages } from "./_shared/instagram-dm.mts";
import type { DmButton, DmCard } from "./_shared/instagram-dm.mts";
import { dmAutomationAllowed } from "./_shared/dm-automation-access.mts";
import { appendDmLog } from "./_shared/dm-automation-log.mts";

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
  await appendDmLog(username, entry, "ig-webhook");
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
 * 댓글 작성자가 이 계정을 팔로우하는지 조회한다.
 *
 * 화면의 "누구에게 보낼까요?"(followFilter)를 실제로 적용하려면 필요한 정보인데,
 * 인스타그램 유저 프로필 조회(`is_user_follow_business`)는 대화 이력이 있는 사용자
 * 등 일부 경우에만 응답한다. 판정이 불가능하면 `null` 을 돌려주고, 호출부는 기존
 * 동작대로 발송한다(필터 때문에 정상 발송이 막히는 쪽이 더 나쁘다).
 */
async function fetchFollowsBusiness(args: {
  host: string;
  igsid: string;
  accessToken: string;
}): Promise<boolean | null> {
  const { host, igsid, accessToken } = args;
  if (!igsid) return null;
  try {
    const res = await fetch(
      `https://${host}/${GRAPH_VERSION}/${encodeURIComponent(igsid)}` +
        `?fields=is_user_follow_business`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.error || typeof data?.is_user_follow_business !== "boolean") {
      return null;
    }
    return data.is_user_follow_business;
  } catch {
    return null;
  }
}

/** 팔로우 조건을 통과하는지. 판정 불가(null)면 통과로 본다. */
function passesFollowFilter(a: DmAutomationItem, follows: boolean | null): boolean {
  if (a.followFilter !== "followers" && a.followFilter !== "non_followers") return true;
  if (follows === null) return true;
  return a.followFilter === "followers" ? follows : !follows;
}

/**
 * Meta 웹훅 서명(`x-hub-signature-256`) 검증.
 *
 * 이 엔드포인트는 공개 URL 이라 서명을 확인하지 않으면 누구나 가짜 댓글 이벤트를
 * 흘려 넣어 고객 계정으로 DM 을 보내게 만들 수 있다. 앱 시크릿이 설정돼 있으면
 * 반드시 검증하고, 없으면(로컬/미설정 환경) 경고만 남기고 통과시킨다.
 */
function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const got = Buffer.from(header);
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
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
  const rawBody = await req.text().catch(() => "");
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (appSecret) {
    if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret)) {
      console.warn("[ig-webhook] rejected: invalid x-hub-signature-256");
      return new Response("Forbidden", { status: 403 });
    }
  } else {
    console.warn("[ig-webhook] INSTAGRAM_APP_SECRET not set — skipping signature check");
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  try {
    // 설정 저장 직후 들어온 댓글에도 방금 편집한 메시지를 사용해야 한다. 기본 eventual
    // consistency 는 이전 설정을 최대 60초간 반환할 수 있어 자동 DM 내용이 어긋난다.
    const store = getStore({ name: "dm-automation", consistency: "strong" });
    const index = getStore({ name: "dm-automation-index", consistency: "strong" });

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

        // 조건(게시물·키워드)에 맞는 자동화 후보를 모은 뒤, 팔로우 조건까지 통과하는
        // 첫 자동화를 고른다. 같은 게시물에 "팔로워용 / 비팔로워용" 자동화를 나눠
        // 걸어둔 경우에도 각각 의도대로 동작한다.
        const candidates = (settings.automations || []).filter((a) =>
          matchAutomation(a, commentText, mediaId),
        );
        if (candidates.length === 0) continue;

        let follows: boolean | null = null;
        if (candidates.some((a) => a.followFilter === "followers" || a.followFilter === "non_followers")) {
          follows = await fetchFollowsBusiness({
            host: graphHost(settings),
            igsid: fromId,
            accessToken: settings.accessToken,
          });
          if (follows === null) {
            console.warn("[ig-webhook] follow state unknown — sending without follow filter");
          }
        }

        const automation = candidates.find((a) => passesFollowFilter(a, follows));
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
