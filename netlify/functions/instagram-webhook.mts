import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { buildDmMessages, describeDmError, sendDmMessages } from "./_shared/instagram-dm.mts";
import type { DmButton, DmCard } from "./_shared/instagram-dm.mts";
import { dmAutomationAllowed } from "./_shared/dm-automation-access.mts";
import { appendDmLog } from "./_shared/dm-automation-log.mts";
import {
  claimIfNew,
  contentHashOf,
  dmContentKey,
  noteSentText,
  privateReplyKey,
  publicReplyKey,
  release,
  wasSentByUs,
} from "./_shared/dm-send-registry.mts";
import { commentSeenRecently, noteCommentSeen, recordForeignDm } from "./_shared/dm-foreign-dm.mts";

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
 *
 * 멱등성: Meta 는 응답이 늦거나 실패하면 같은 이벤트를 다시 보낸다. 아무 장치가
 * 없으면 재전송 한 번이 곧 중복 DM·중복 답글이다. 발송 대장
 * (`_shared/dm-send-registry.mts`)에 댓글 단위로 선점 기록을 남겨 두 번째
 * 전달분은 조용히 건너뛴다.
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
  createdAt?: string;
  /** 설정 화면에서 이 자동화를 마지막으로 고친 시각(api-dm-automation 이 찍는다). */
  updatedAt?: string;
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

/**
 * 계정이 보낸 DM 에코 이벤트를 살펴, 우리가 보내지 않은 자동 DM 이면 기록한다.
 *
 * 인스타그램 계정에는 이 서비스 외에도 댓글에 자동 DM 을 보내는 경로가 있다
 * (인스타그램/메타 자체 자동 메시지, 예전에 연결해 둔 다른 자동화 서비스). 이런
 * 발송은 우리 설정과 무관하므로 화면에서 문구를 바꾸거나 자동 발송을 꺼도 예전
 * 문구가 계속 도착한다. 화면에 단서가 없으면 "앱이 예전 메시지를 보낸다"로 읽히기
 * 때문에, 감지해서 설정 화면에서 알려준다.
 *
 * 오탐을 피하려고 두 조건을 모두 만족할 때만 기록한다.
 *  - 댓글 이벤트를 받은 직후(10분 이내) 그 사람에게 나간 DM 일 것 — 사장님이 손으로
 *    보낸 답장을 자동 발송으로 표시하면 안 된다.
 *  - 우리가 보낸 적 없는 문구일 것.
 *
 * `is_echo` 는 이 계정이 보낸 메시지라는 뜻이다(받은 메시지에는 붙지 않는다).
 */
async function inspectEcho(username: string, event: any): Promise<void> {
  const message = event?.message;
  if (!message || message.is_echo !== true) return;
  const text = String(message?.text || "").trim();
  if (!text) return;
  const recipientId = String(event?.recipient?.id || "");
  if (!recipientId) return;
  if (!(await commentSeenRecently(username, recipientId))) return;
  if (await wasSentByUs(username, text)) return;

  await recordForeignDm(username, text);
  await appendLog(username, {
    kind: "dm",
    status: "external",
    recipientId,
    text: text.slice(0, 200),
  });
  console.warn("[ig-webhook] auto DM sent by another service detected");
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
 * 조건이 겹치는 자동화 중 무엇을 쓸지 정하는 우선순위.
 *
 * 예전에는 "목록에서 먼저 나오는 것"(= 먼저 만든 것)을 썼다. 그래서 "모든 게시물 /
 * 모든 댓글"로 넓게 걸어 둔 옛 자동화가 있으면, 사용자가 특정 게시물·키워드에
 * 맞춰 새로 만들거나 방금 문구를 고친 자동화가 있어도 옛 자동화의 예전 문구가
 * 발송됐다. 좁게 지정한 자동화를 먼저 쓰고, 범위가 같으면 가장 최근에 설정한
 * 것을 쓴다 — 사용자가 마지막에 입력한 메시지가 나가야 한다.
 */
function specificityOf(a: DmAutomationItem): number {
  let score = 0;
  if (a.mediaScope === "selected") score += 2;
  if (a.commentMatch === "keyword") score += 1;
  return score;
}

function configuredAt(a: DmAutomationItem): number {
  const ms = Date.parse(a.updatedAt || a.createdAt || "");
  return Number.isNaN(ms) ? 0 : ms;
}

/** 우선순위가 높은 자동화가 앞에 오도록 정렬한다(원본 배열은 건드리지 않는다). */
function byPriority(candidates: DmAutomationItem[]): DmAutomationItem[] {
  return candidates
    .map((a, index) => ({ a, index }))
    .sort((x, y) => {
      const spec = specificityOf(y.a) - specificityOf(x.a);
      if (spec !== 0) return spec;
      const recency = configuredAt(y.a) - configuredAt(x.a);
      if (recency !== 0) return recency;
      return x.index - y.index;
    })
    .map((entry) => entry.a);
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
      const username = await index.get(`ig_${igAccountId}`, { type: "text" });
      if (!username) continue;

      const settings = (await store.get(`dm_${username}`, { type: "json" })) as DmSettings | null;
      if (!settings) continue;
      const accessToken = settings.accessToken || "";
      const igId = settings.igUserId || settings.igAccountId || igAccountId;
      // 자기 자신의 댓글을 걸러낼 때 쓰는 ID 모음. 계정 연동 방식에 따라 웹훅의
      // entry.id 와 저장된 igUserId/igAccountId 가 서로 다를 수 있어, 하나만
      // 비교하면 계정 소유자의 댓글에 자기 자신에게 DM 을 보내려 시도한다.
      const ownIds = new Set(
        [igId, settings.igUserId, settings.igAccountId, igAccountId].filter(Boolean) as string[],
      );

      /**
       * 발신 메시지 에코 확인은 자동 발송 스위치와 무관하게 수행한다. "자동 발송을
       * 꺼놨는데도 DM 이 나갔다"가 정확히 이 검사가 필요한 상황이다.
       *
       * 댓글 표시를 먼저 남긴다 — 댓글 이벤트와 에코가 같은 요청에 함께 오더라도
       * "댓글 직후 나간 DM"으로 판별할 수 있어야 한다.
       */
      for (const change of entry?.changes || []) {
        if (change?.field !== "comments") continue;
        const commenterId = String(change?.value?.from?.id || "");
        if (commenterId && !ownIds.has(commenterId)) await noteCommentSeen(username, commenterId);
      }

      /**
       * 메시지 이벤트는 연동 방식에 따라 `entry.messaging` 또는 `entry.changes`
       * (field: messages / message_echoes)로 온다. 양쪽 다 받는다.
       */
      const echoEvents = [
        ...(Array.isArray(entry?.messaging) ? entry.messaging : []),
        ...(entry?.changes || [])
          .filter((c: any) => c?.field === "messages" || c?.field === "message_echoes")
          .map((c: any) => c?.value),
      ];
      for (const event of echoEvents) {
        await inspectEcho(username, event).catch((e) =>
          console.warn("[ig-webhook] echo check failed:", (e as Error)?.message),
        );
      }

      /**
       * 자동 발송이 가능한 상태인지(전체 스위치·연동 토큰·플랜). 댓글 이벤트를
       * 실제로 처리할 때만 확인한다 — 플랜 조회는 블롭 읽기라 매 이벤트마다 하지
       * 않는다.
       */
      let planAllowed: boolean | null = null;
      const canSend = async (): Promise<boolean> => {
        if (!settings.enabled || !accessToken) return false;
        if (planAllowed === null) planAllowed = await dmAutomationAllowed(username);
        return planAllowed;
      };

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
        if (!commentId || (fromId && ownIds.has(fromId))) continue;

        // 전체 스위치가 꺼져 있거나 플랜이 없으면 여기서 끝. 우리는 아무것도 보내지 않는다.
        if (!(await canSend())) continue;

        // 조건(게시물·키워드)에 맞는 자동화 후보를 모은 뒤, 팔로우 조건까지 통과하는
        // 첫 자동화를 고른다. 같은 게시물에 "팔로워용 / 비팔로워용" 자동화를 나눠
        // 걸어둔 경우에도 각각 의도대로 동작한다. 후보가 여럿이면 좁게 지정한 것 →
        // 최근에 설정한 것 순으로 본다(byPriority).
        const candidates = byPriority(
          (settings.automations || []).filter((a) => matchAutomation(a, commentText, mediaId)),
        );
        if (candidates.length === 0) continue;

        let follows: boolean | null = null;
        if (candidates.some((a) => a.followFilter === "followers" || a.followFilter === "non_followers")) {
          follows = await fetchFollowsBusiness({
            host: graphHost(settings),
            igsid: fromId,
            accessToken,
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
          } else if (!(await claimIfNew(username, publicReplyKey(commentId)))) {
            // 같은 댓글 이벤트가 재전송된 경우다. 다시 달면 답글이 두 개 붙는다.
            console.warn("[ig-webhook] duplicate comment event — public reply skipped");
          } else {
            const reply = pool[Math.floor(Math.random() * pool.length)];
            const replyResult = await postCommentReply({
              host: graphHost(settings),
              commentId: parentId || commentId,
              accessToken,
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
              // 실패한 답글은 선점을 되돌린다. Meta 가 이벤트를 다시 보내면
              // 그때 한 번 더 시도할 수 있어야 한다.
              await release(username, publicReplyKey(commentId));
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

        const messages = buildMessagePayload(automation);
        // 우리가 보낸 문구로 남긴다. 발송 직후 인스타그램이 돌려주는 발신 에코를
        // "외부 서비스가 보낸 DM"으로 잘못 표시하지 않으려면 발송 전에 남겨야 한다
        // (에코가 발송 응답보다 먼저 도착할 수 있다).
        for (const payload of messages) {
          const body = typeof (payload as any)?.text === "string" ? (payload as any).text : "";
          if (body) await noteSentText(username, body);
        }
        // 어떤 자동화의 어떤 문구가 나갔는지 기록에 남긴다. "예전 메시지가 나갔다"는
        // 신고를 받았을 때 화면의 설정과 실제 발송 내용을 맞춰볼 수 있어야 한다.
        const contentHash = contentHashOf(messages);
        const contentKey = dmContentKey(commentId, contentHash);
        const replyKey = privateReplyKey(commentId);

        // 같은 댓글에 같은 내용을 이미 보냈다면(웹훅 재전송·수동 발송과 겹침) 끝.
        if (!(await claimIfNew(username, contentKey))) {
          console.warn("[ig-webhook] duplicate DM suppressed for comment", commentId);
          continue;
        }

        try {
          const replyAvailable = await claimIfNew(username, replyKey);
          let result = replyAvailable
            ? await sendDmMessages({
                graphHost: graphHost(settings),
                graphVersion: GRAPH_VERSION,
                igId,
                accessToken,
                recipient: { comment_id: commentId },
                followUpRecipient: fromId ? { id: fromId } : undefined,
                messages,
              })
            : null;

          if (result && !result.ok && !result.partial && result.errorKind !== "already_sent") {
            await release(username, replyKey);
          }

          /**
           * IGSID 직접 발송으로 한 번 더 시도할지 정한다.
           *
           * 비공개 답장을 아예 못 쓴 경우(수동 발송이 그 댓글의 1회를 이미 써버린
           * 경우)와, 인스타그램이 "이미 답장했다"고 명시한 경우에만 다시 보낸다.
           *
           * 그 밖의 오류(대표적으로 "An unknown error has occurred.")에는 다시
           * 보내지 않는다. 이 오류들은 메시지가 도착했는지 아닌지를 알려주지
           * 않는데, 예전에는 무조건 IGSID 로 한 번 더 보내서 같은 문구가 두 번
           * 도착하는 일이 생겼다. 받는 사람에게는 같은 안내가 연달아 오는 것으로
           * 보이므로, 확실하지 않으면 다시 보내지 않고 실패로 기록한다.
           */
          const retryViaIgsid =
            Boolean(fromId) &&
            (!result || (!result.ok && !result.partial && result.errorKind === "already_sent"));

          if (retryViaIgsid) {
            result = await sendDmMessages({
              graphHost: graphHost(settings),
              graphVersion: GRAPH_VERSION,
              igId,
              accessToken,
              recipient: { id: fromId },
              messages,
            });
          }

          if (result && (result.ok || result.partial)) {
            // partial 은 본문이 이미 도착한 상태다. 실패로 기록하면 화면의 활동
            // 기록에서 도착한 DM 이 실패로 보인다.
            await appendLog(username, {
              kind: "dm",
              status: "sent",
              partial: result.partial,
              recipientId: fromId,
              ruleId: automation.id,
              ruleName: automation.name,
              ruleUpdatedAt: automation.updatedAt,
              contentHash,
              messageId: result.messageId,
              error: result.partial ? result.error : undefined,
            });
          } else {
            // 못 보냈으니 내용 기록을 지운다 — 재전송 때 다시 시도할 수 있어야 한다.
            await release(username, contentKey);
            const kind = result?.errorKind || "other";
            await appendLog(username, {
              kind: "dm",
              status: "failed",
              recipientId: fromId,
              ruleId: automation.id,
              ruleName: automation.name,
              ruleUpdatedAt: automation.updatedAt,
              contentHash,
              error: describeDmError(kind, result?.error),
              errorKind: kind,
            });
          }
        } catch (e: any) {
          await release(username, contentKey);
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
