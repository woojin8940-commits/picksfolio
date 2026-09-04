import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import {
  buildCommentDmPlan,
  buildDirectDmPlan,
  describeDmError,
  postCommentReply,
  sendDmMessages,
} from "./_shared/instagram-dm.mts";
import type { DmButton, DmCard, DmPlan } from "./_shared/instagram-dm.mts";
import { noteWebhookReceived, resolveDmAccountByIgId } from "./_shared/dm-webhook-index.mts";
import { dmAutomationAllowed } from "./_shared/dm-automation-access.mts";
import { appendDmLog } from "./_shared/dm-automation-log.mts";
import {
  claimIfNew,
  commentDmKey,
  contentHashOf,
  dmContentKey,
  inboundDmKey,
  noteSentText,
  privateReplyKey,
  publicReplyKey,
  release,
  wasSentByUs,
} from "./_shared/dm-send-registry.mts";
import { commentSeenRecently, noteCommentSeen, recordForeignDm } from "./_shared/dm-foreign-dm.mts";
import { createScheduledJob } from "./_shared/dm-schedule-store.mts";
import { fetchContactProfile, noteDmContact } from "./_shared/dm-contacts.mts";
import { faqIdFromPayload } from "./_shared/instagram-ice-breakers.mts";

/**
 * 인스타그램 웹훅 수신기.
 * - GET  : Meta 웹훅 검증 챌린지 응답(hub.challenge).
 * - POST : 세 가지 이벤트를 처리한다.
 *   · 게시물 "댓글" — 사용자의 DM 자동화 규칙과 매칭해 댓글 작성자에게 자동
 *     DM(및 선택 시 공개 답글)을 보낸다.
 *   · 받은 "메시지" — DM 자체를 트리거로 쓰는 자동화. 처음 대화하는 사람에게는
 *     인사말을, 메시지에 등록해 둔 단어가 있으면 그에 맞는 답장을 보낸다.
 *   · "postback" — DM 창 첫 화면의 "자주 묻는 질문"(아이스브레이커) 버튼을 누른
 *     이벤트. payload 로 어떤 질문인지 알아내 미리 정해 둔 답변을 보낸다.
 *
 * 받은 메시지·postback 에 답장하는 것은 인스타그램 24시간 창 안쪽이라 정책상
 * 안전하다(상대가 방금 우리에게 말을 걸었다). 승인된 권한
 * (`instagram_business_manage_messages`)만으로 동작하고 추가 심사는 필요하지 않다.
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
  /** 캐러셀 앞에 먼저 보낼 인사말(선택). */
  cardIntro?: string;
  buttons: DmButton[];
  cards?: DmCard[];
  /**
   * 이 자동화가 조건에 맞았을 때 DM 을 언제 보낼지.
   *  `instant`(기본) — 댓글을 받은 즉시 보낸다.
   *  `scheduled`     — `scheduledAt` 까지 기다렸다가 보낸다(예약 대기열에 넣는다).
   */
  sendMode?: "instant" | "scheduled";
  /** 예약 발송 시각(ISO). `sendMode === "scheduled"` 일 때만 의미가 있다. */
  scheduledAt?: string;
  createdAt?: string;
  /** 설정 화면에서 이 자동화를 마지막으로 고친 시각(api-dm-automation 이 찍는다). */
  updatedAt?: string;
}
/** DM 창 첫 화면의 "자주 묻는 질문" 한 건. */
interface DmFaqItem {
  id: string;
  question: string;
  answer: string;
  buttons?: DmButton[];
}

/** 처음 DM 을 받았을 때 보낼 인사말. */
interface DmGreetingSettings {
  enabled: boolean;
  message: string;
  buttons?: DmButton[];
  onlyFirstContact: boolean;
}

/** 받은 DM 에 특정 단어가 있을 때 보낼 자동 답장. */
interface DmKeywordReply {
  id: string;
  name: string;
  enabled: boolean;
  keywords: string[];
  message: string;
  buttons?: DmButton[];
  createdAt?: string;
  updatedAt?: string;
}

interface DmSettings {
  enabled: boolean;
  igUserId?: string;
  igAccountId?: string;
  accessToken?: string;
  tokenSource?: string;
  automations?: DmAutomationItem[];
  faq?: { enabled?: boolean; items?: DmFaqItem[] };
  direct?: { greeting?: DmGreetingSettings; replies?: DmKeywordReply[] };
  /**
   * 이 설정을 저장한 로그인 사용자 ID.
   *
   * 플랜 판정(dmAutomationAllowed)은 설정 화면에서는 로그인 사용자 ID 로, 웹훅에서는
   * 사용자명으로 조회했다. 운영자 지급 멤버십 행이 다른 사용자명으로 남아 있으면
   * 두 판정이 갈려 "설정은 저장되는데(=플랜 통과) 자동 발송만 막히는" 상태가 된다.
   * 저장 시점에 기록해 두고 웹훅도 같은 기준으로 조회한다.
   */
  ownerAuthUserId?: string;
}

function graphHost(settings: DmSettings) {
  return settings.tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com";
}

function dmContentOf(a: DmAutomationItem) {
  return {
    messageType: a.messageType,
    message: a.message,
    buttons: a.buttons,
    cards: a.cards,
    intro: a.cardIntro,
  };
}

/**
 * 댓글 비공개 답장용 계획. 캐러셀이 첫 통에 들어간다.
 *
 * 인스타그램은 버튼 템플릿을 지원하지 않으므로 링크 버튼도 제네릭 템플릿 카드로
 * 감싸 보낸다. 댓글 1건당 1통 제한 때문에 순서가 중요하다 —
 * 자세한 내용은 _shared/instagram-dm.mts 참고.
 */
function buildCommentPlan(a: DmAutomationItem): DmPlan {
  return buildCommentDmPlan(dmContentOf(a));
}

/** 대화창이 열린 상대에게 IGSID 로 직접 보낼 때 쓰는 계획(설정한 순서 그대로). */
function buildDirectPlan(a: DmAutomationItem): DmPlan {
  return buildDirectDmPlan(dmContentOf(a));
}

async function appendLog(username: string, entry: Record<string, unknown>) {
  await appendDmLog(username, entry, "ig-webhook");
}

/** 예약으로 넘길지 판단할 때 필요한 최소 여유. 이보다 가까우면 그냥 지금 보낸다. */
const SCHEDULE_MIN_LEAD_MS = 30_000;

/**
 * 이 자동화가 "예약 발송"이면 보낼 시각(ms)을, 즉시 발송이면 null 을 돌려준다.
 *
 * 예약 시각이 이미 지났거나 눈앞이면 즉시 발송으로 본다. 지난 시각을 대기열에
 * 넣어도 결국 다음 주기에 나가지만, 그 사이 발송기가 한 번 더 조건을 검사하는
 * 동안 댓글 비공개 답장 기회를 미룰 이유가 없다.
 */
function scheduledSendAt(a: DmAutomationItem): number | null {
  if (a.sendMode !== "scheduled") return null;
  const at = Date.parse(a.scheduledAt || "");
  if (Number.isNaN(at)) return null;
  return at - Date.now() > SCHEDULE_MIN_LEAD_MS ? at : null;
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
    return (a.cards || []).some(
      (c) => c && (c.title?.trim() || c.imageUrl?.trim() || c.buttonUrl?.trim()),
    );
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

function configuredAt(a: { updatedAt?: string; createdAt?: string }): number {
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

/** 자동 발송을 막고 있는 이유. 화면의 활동 기록에 그대로 남긴다. */
type SendBlock = "switch_off" | "not_connected" | "plan_required";

/**
 * DM 트리거 자동화(인사말 · 키워드 답장 · 질문 버튼 답변)를 실행하는 데 필요한 것들.
 *
 * 댓글 자동화와 같은 발송 함수를 쓰지만 수신자가 다르다. 여기서는 상대가 방금
 * 우리에게 메시지를 보냈으므로 IGSID(`{ id }`)로 곧장 보낼 수 있고, 24시간 창이
 * 열려 있어 여러 통을 순서대로 보낼 수 있다(댓글 비공개 답장은 한 통이 전부다).
 */
interface DmTriggerContext {
  username: string;
  settings: DmSettings;
  igId: string;
  accessToken: string;
  /** 계정 자신의 ID 모음 — 우리가 보낸 메시지를 트리거로 삼지 않기 위해 쓴다. */
  ownIds: Set<string>;
  blocked: () => Promise<SendBlock | null>;
}

/** 보낼 내용이 하나라도 있는지(본문이 비었어도 링크 버튼만으로 보낼 수 있다). */
function hasTriggerContent(content: { message?: string; buttons?: DmButton[] }): boolean {
  if (content.message?.trim()) return true;
  return (content.buttons || []).some((b) => b?.url?.trim());
}

/**
 * 받은 메시지에 이 키워드 답장이 걸리는지.
 *
 * 부분 일치로 본다("가격" 이 "가격 얼마예요?" 에 걸린다). 사람이 보내는 문장에서
 * 정확히 일치하는 경우는 거의 없어, 완전 일치로 만들면 사실상 아무도 못 맞춘다.
 */
function matchKeywordReply(r: DmKeywordReply, text: string): boolean {
  if (r.enabled === false) return false;
  if (!hasTriggerContent(r)) return false;
  const lower = text.toLowerCase();
  return (r.keywords || []).some((k) => k && lower.includes(k.toLowerCase()));
}

/**
 * 조건이 겹치는 키워드 답장 중 무엇을 쓸지 고른다.
 *
 * 댓글 자동화와 같은 기준이다 — 키워드를 좁게 적어 둔 것을 먼저 보고, 범위가 같으면
 * 가장 최근에 설정한 것을 쓴다. 사용자가 마지막에 입력한 문구가 나가야 한다.
 */
function pickKeywordReply(replies: DmKeywordReply[], text: string): DmKeywordReply | undefined {
  return replies
    .filter((r) => matchKeywordReply(r, text))
    .map((r, index) => ({ r, index }))
    .sort((x, y) => {
      const specific = (y.r.keywords || []).length - (x.r.keywords || []).length;
      // 키워드를 하나만 적어 둔 답장이 더 "좁게 지정한" 것이다.
      if (specific !== 0) return -specific;
      const recency = configuredAt(y.r) - configuredAt(x.r);
      if (recency !== 0) return recency;
      return x.index - y.index;
    })
    .map((entry) => entry.r)[0];
}

/**
 * DM 한 통을 보내고 결과를 활동 기록에 남긴다.
 *
 * 같은 이벤트가 재전송돼도 한 번만 보내도록 발송 대장에 먼저 선점 기록을 남긴다.
 * 못 보냈으면 선점을 되돌려, Meta 가 이벤트를 다시 보낼 때 한 번 더 시도할 수 있게
 * 한다.
 */
async function sendTriggerDm(
  ctx: DmTriggerContext,
  args: {
    recipientId: string;
    message?: string;
    buttons?: DmButton[];
    claimKey: string;
    /** 활동 기록에 남길 트리거 종류. */
    trigger: "greeting" | "keyword" | "faq";
    ruleId?: string;
    ruleName?: string;
  },
): Promise<void> {
  const { username, settings, igId, accessToken } = ctx;
  const { recipientId, claimKey, trigger, ruleId, ruleName } = args;
  if (!recipientId) return;

  const plan = buildDirectDmPlan({
    messageType: "text",
    message: args.message,
    buttons: args.buttons,
  });
  /**
   * 보낼 내용이 없는 경우(문구를 비워 둔 인사말·답변, 라벨만 있는 버튼).
   *
   * 예전에는 조용히 끝나서, 사용자는 "버튼을 눌렀는데 아무 답이 없다"의 이유를
   * 활동 기록에서도 찾을 수 없었다.
   */
  if (plan.messages.length === 0) {
    await appendLog(username, {
      kind: "dm",
      status: "skipped",
      trigger,
      reason: "보낼 문구가 비어 있습니다.",
      recipientId,
      ruleId,
      ruleName,
    });
    return;
  }

  if (!(await claimIfNew(username, claimKey))) {
    console.warn("[ig-webhook] duplicate messaging event — trigger DM skipped", claimKey);
    return;
  }

  // 우리가 보낸 문구로 먼저 남긴다. 발신 에코가 발송 응답보다 먼저 도착해도
  // "외부 서비스가 보낸 DM"으로 잘못 표시되지 않는다.
  for (const payload of plan.messages) {
    const body = typeof (payload as any)?.text === "string" ? (payload as any).text : "";
    if (body) await noteSentText(username, body);
  }

  try {
    const result = await sendDmMessages({
      graphHost: graphHost(settings),
      graphVersion: GRAPH_VERSION,
      igId,
      accessToken,
      recipient: { id: recipientId },
      messages: plan.messages,
      bestEffortFrom: plan.bestEffortFrom,
    });

    if (result.ok || result.partial) {
      await appendLog(username, {
        kind: "dm",
        status: "sent",
        trigger,
        partial: result.partial,
        recipientId,
        ruleId,
        ruleName,
        messageId: result.messageId,
        error: result.partial ? result.error : undefined,
      });
      return;
    }

    await release(username, claimKey);
    const kind = result.errorKind || "other";
    await appendLog(username, {
      kind: "dm",
      status: "failed",
      trigger,
      recipientId,
      ruleId,
      ruleName,
      error: describeDmError(kind, result.error),
      errorKind: kind,
    });
  } catch (e: any) {
    await release(username, claimKey);
    await appendLog(username, {
      kind: "dm",
      status: "failed",
      trigger,
      recipientId,
      ruleId,
      ruleName,
      error: e?.message || "send error",
    });
  }
}

/**
 * "자주 묻는 질문" 버튼을 누른 이벤트(postback) 처리.
 *
 * payload 에는 질문 문구가 아니라 항목 ID 가 실려 있다(`faq_<id>`). 문구를 고친
 * 뒤에도 상대 DM 창에 떠 있던 예전 버튼이 올바른 답변을 찾아가야 하기 때문이다.
 */
async function handleFaqPostback(ctx: DmTriggerContext, event: any): Promise<void> {
  const postback = event?.postback;
  if (!postback) return;
  const senderId = String(event?.sender?.id || "");
  if (!senderId || ctx.ownIds.has(senderId)) return;

  const faqId = faqIdFromPayload(String(postback?.payload || ""));
  if (!faqId) return;

  const faq = ctx.settings.faq;
  const clicked = (faq?.items || []).find((f) => f.id === faqId);

  /**
   * 버튼 클릭도 상대가 우리에게 말을 건 것이다 — 24시간 창이 열리고, 예약 발송
   * 대상 명단에도 올라야 한다. 예전에는 postback 을 명단에 남기지 않아서, DM 창을
   * 열어 버튼만 누른 사람에게는 예약을 걸 방법이 없었다.
   *
   * "처음 대화"로는 세지 않는다(`kind: "postback"`). 이 사람이 나중에 직접 첫
   * 메시지를 보낼 때 인사말이 나가야 한다.
   */
  await noteDmContact({
    username: ctx.username,
    igsid: senderId,
    text: clicked?.question,
    kind: "postback",
  }).catch(() => undefined);
  const item = clicked;
  if (!item) {
    // 질문을 지운 뒤에도 상대 화면에는 버튼이 남아 있을 수 있다. 답할 내용이 없으니
    // 아무것도 보내지 않지만, 왜 조용했는지는 기록에 남긴다.
    await appendLog(ctx.username, {
      kind: "dm",
      status: "skipped",
      trigger: "faq",
      reason: "삭제된 질문 버튼입니다.",
      recipientId: senderId,
    });
    return;
  }

  const blocked = await ctx.blocked();
  if (blocked) {
    await appendLog(ctx.username, {
      kind: "dm",
      status: "skipped",
      trigger: "faq",
      reason: blocked,
      recipientId: senderId,
      ruleId: item.id,
    });
    return;
  }

  const eventId = String(postback?.mid || event?.message?.mid || `${senderId}_${event?.timestamp || ""}`);
  await sendTriggerDm(ctx, {
    recipientId: senderId,
    message: item.answer,
    buttons: item.buttons,
    claimKey: inboundDmKey("faq", eventId),
    trigger: "faq",
    ruleId: item.id,
    ruleName: item.question,
  });
}

/**
 * 받은 DM 처리 — 첫 인사말과 키워드 자동 답장.
 *
 * 명단 기록(`noteDmContact`)은 발송이 막혀 있어도 먼저 남긴다. 이 명단이 예약
 * 발송의 대상 목록이자 "처음 대화하는 사람인지"의 근거라, 자동 발송 스위치가 꺼져
 * 있는 동안 온 메시지를 빠뜨리면 나중에 예약을 걸 상대를 고를 수 없다.
 */
async function handleInboundMessage(ctx: DmTriggerContext, event: any): Promise<void> {
  const message = event?.message;
  // 에코(우리가 보낸 메시지)는 여기서 다루지 않는다 — inspectEcho 가 따로 본다.
  if (!message || message.is_echo === true) return;
  const senderId = String(event?.sender?.id || "");
  if (!senderId || ctx.ownIds.has(senderId)) return;

  const text = String(message?.text || "").trim();
  const { username, settings } = ctx;

  // 상대 이름은 있으면 화면(예약 발송 대상 목록)에서 알아보기 쉬워지는 부가 정보다.
  // 조회에 실패해도 발송에는 아무 지장이 없다.
  const profile = ctx.accessToken
    ? await fetchContactProfile({
        host: graphHost(settings),
        graphVersion: GRAPH_VERSION,
        igsid: senderId,
        accessToken: ctx.accessToken,
      })
    : {};

  const noted = await noteDmContact({
    username,
    igsid: senderId,
    text,
    name: profile.name,
    igHandle: profile.username,
    kind: "message",
  });

  const greeting = settings.direct?.greeting;
  const replies = settings.direct?.replies || [];
  const greetingWanted =
    Boolean(greeting?.enabled) &&
    hasTriggerContent(greeting!) &&
    // 처음 대화하는 사람에게만 보내는 게 기본값이다. 껐다면 24시간 넘게 조용했던
    // 대화가 다시 시작될 때도 한 번 더 보낸다(대화 중에는 다시 보내지 않는다).
    (noted.first ||
      (greeting!.onlyFirstContact === false && conversationWentQuiet(noted.prevLastAt)));
  const matched = text ? pickKeywordReply(replies, text) : undefined;

  if (!greetingWanted && !matched) return;

  const blocked = await ctx.blocked();
  if (blocked) {
    await appendLog(username, {
      kind: "dm",
      status: "skipped",
      trigger: matched ? "keyword" : "greeting",
      reason: blocked,
      recipientId: senderId,
      ruleId: matched?.id,
    });
    return;
  }

  const eventId = String(message?.mid || `${senderId}_${event?.timestamp || ""}`);

  // 인사말을 먼저 보낸다. 처음 보낸 메시지에 문의 키워드가 들어 있으면 인사말에
  // 이어 답장이 도착하는 것이 자연스럽다.
  if (greetingWanted) {
    await sendTriggerDm(ctx, {
      recipientId: senderId,
      message: greeting!.message,
      buttons: greeting!.buttons,
      claimKey: inboundDmKey("greet", eventId),
      trigger: "greeting",
      ruleName: "첫 인사말",
    });
  }

  if (matched) {
    await sendTriggerDm(ctx, {
      recipientId: senderId,
      message: matched.message,
      buttons: matched.buttons,
      claimKey: inboundDmKey("kw", `${matched.id}_${eventId}`),
      trigger: "keyword",
      ruleId: matched.id,
      ruleName: matched.name,
    });
  }
}

/** 마지막으로 받은 메시지가 24시간보다 오래됐는지(대화가 끊겼다고 볼 기준). */
function conversationWentQuiet(prevLastAt?: string): boolean {
  const last = Date.parse(prevLastAt || "");
  if (Number.isNaN(last)) return true;
  return Date.now() - last > 24 * 60 * 60 * 1000;
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
 * 댓글 공개 답글은 `_shared/instagram-dm.mts` 의 postCommentReply 를 쓴다.
 * 수동 발송(send-instagram-dm)도 같은 함수를 쓴다.
 */

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

    for (const entry of payload?.entry || []) {
      const igAccountId = String(entry?.id || "");
      if (!igAccountId) continue;

      /**
       * 이 IG 계정이 어느 사용자 소유인지 조회.
       *
       * 조회 결과와 무관하게 "이벤트가 도착했다"는 흔적을 먼저 남긴다. 자동 발송이
       * 안 될 때 Meta 가 이벤트를 안 보내는 것인지, 받고도 주인을 못 찾은 것인지
       * 설정 화면에서 구분할 수 있어야 한다.
       */
      const username = await resolveDmAccountByIgId(igAccountId);
      await noteWebhookReceived(igAccountId, username);
      if (!username) {
        console.warn("[ig-webhook] no account for IG id", igAccountId);
        continue;
      }

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
       * (field: messages / message_echoes / messaging_postbacks)로 온다. 양쪽 다 받는다.
       *
       * 한 배열에 받은 메시지 · 우리가 보낸 에코 · 질문 버튼 클릭이 섞여 오므로,
       * 아래에서 각 처리기가 자기 것만 골라낸다.
       */
      const messagingEvents = [
        ...(Array.isArray(entry?.messaging) ? entry.messaging : []),
        ...(entry?.changes || [])
          .filter(
            (c: any) =>
              c?.field === "messages" ||
              c?.field === "message_echoes" ||
              c?.field === "messaging_postbacks",
          )
          .map((c: any) => c?.value),
      ];
      for (const event of messagingEvents) {
        await inspectEcho(username, event).catch((e) =>
          console.warn("[ig-webhook] echo check failed:", (e as Error)?.message),
        );
      }

      /**
       * 자동 발송이 가능한 상태인지(전체 스위치·연동 토큰·플랜). 막혀 있으면 그
       * 이유를 돌려준다. 댓글 이벤트를 실제로 처리할 때만 확인한다 — 플랜 조회는
       * 블롭 읽기라 매 이벤트마다 하지 않는다.
       */
      let planAllowed: boolean | null = null;
      const sendBlockedReason = async (): Promise<SendBlock | null> => {
        if (!settings.enabled) return "switch_off";
        if (!accessToken) return "not_connected";
        if (planAllowed === null) {
          planAllowed = await dmAutomationAllowed(username, settings.ownerAuthUserId);
        }
        return planAllowed ? null : "plan_required";
      };

      /**
       * DM 자체를 트리거로 쓰는 자동화 — 받은 메시지(인사말 · 키워드 답장)와
       * 질문 버튼 클릭(postback).
       *
       * 댓글 자동화와 달리 상대가 방금 우리에게 말을 걸었으므로 24시간 창이 열려
       * 있고, IGSID 로 곧장 보낼 수 있다.
       */
      const triggerCtx: DmTriggerContext = {
        username,
        settings,
        igId,
        accessToken,
        ownIds,
        blocked: sendBlockedReason,
      };
      for (const event of messagingEvents) {
        await handleFaqPostback(triggerCtx, event).catch((e) =>
          console.warn("[ig-webhook] faq postback failed:", (e as Error)?.message),
        );
        await handleInboundMessage(triggerCtx, event).catch((e) =>
          console.warn("[ig-webhook] inbound DM trigger failed:", (e as Error)?.message),
        );
      }

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
        const blocked = await sendBlockedReason();
        if (blocked) {
          /**
           * 조건에 맞는 자동화가 있었는데도 보내지 않았다는 사실을 남긴다.
           *
           * "발송을 꺼놨는데 댓글 달자마자 DM 이 갔다"는 신고가 들어왔을 때, 이 기록이
           * 곧 근거가 된다. 여기 skipped 만 남아 있다면 그 DM 은 이 앱이 보낸 것이
           * 아니다(인스타그램 자체 자동 메시지이거나 예전에 연결해 둔 다른 자동화
           * 서비스다 — 화면의 '외부 자동 DM' 안내가 그 경우를 알려준다).
           */
          if ((settings.automations || []).some((a) => matchAutomation(a, commentText, mediaId))) {
            await appendLog(username, {
              kind: "dm",
              status: "skipped",
              reason: blocked,
              recipientId: fromId,
              commentId,
            });
          }
          continue;
        }

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
              graphVersion: GRAPH_VERSION,
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

        const plan = buildCommentPlan(automation);
        /**
         * 설정에는 내용이 있는데 실제로 보낼 수 있는 메시지가 없는 경우.
         *
         * 대표적으로 카드에 제목만 적고 이미지·설명·버튼을 비워 둔 캐러셀이다.
         * 제네릭 템플릿은 제목 외 속성이 최소 하나 있어야 해서 그 카드는 뺄 수밖에
         * 없고, 전부 그런 카드면 남는 메시지가 없다. 조용히 넘기면 사용자는 이유를
         * 알 수 없으니 활동 기록에 남긴다.
         */
        if (plan.messages.length === 0) {
          await appendLog(username, {
            kind: "dm",
            status: "failed",
            recipientId: fromId,
            ruleId: automation.id,
            ruleName: automation.name,
            error:
              "보낼 수 있는 카드가 없습니다. 카드마다 이미지를 올리거나 설명·버튼을 채워 주세요(제목만 있는 카드는 인스타그램이 거부합니다).",
            errorKind: "other",
          });
          continue;
        }

        /**
         * "예약 발송"으로 설정된 자동화 — 지금 보내지 않고 대기열에 넣는다.
         *
         * 발송은 1분마다 도는 scheduled-dm-sender 가 맡는다. 댓글에서 만든 예약은
         * `comment_id` 비공개 답장으로 나가므로 상대가 우리에게 DM 을 보낸 적이
         * 없어도 되지만, 그 기회는 **댓글 작성 후 7일**까지다. 그래서 댓글 시각을
         * 함께 넣어 발송기가 창을 판정할 수 있게 한다.
         *
         * 여기서 내용을 그대로 복사해 두는 이유: 예약이 나가는 시점에 설정이 바뀌어
         * 있을 수 있는데, 사용자가 예약을 걸 때 화면에서 본 문구가 나가야 한다.
         */
        const scheduledMs = scheduledSendAt(automation);
        if (scheduledMs !== null) {
          /**
           * 댓글 단위 선점을 예약을 넣기 전에 해 둔다. Meta 가 같은 댓글 이벤트를
           * 다시 보내도 같은 댓글에 예약이 두 건 쌓이지 않는다.
           */
          if (!(await claimIfNew(username, commentDmKey(commentId)))) {
            console.warn("[ig-webhook] comment already handled — scheduling skipped", commentId);
            continue;
          }
          // 웹훅 entry.time 은 초 단위다. 없으면 지금(이벤트를 받은 시각)으로 본다.
          const entryMs = Number(entry?.time) > 0 ? Number(entry.time) * 1000 : Date.now();
          const sendAt = new Date(scheduledMs).toISOString();
          const carousel = automation.messageType === "carousel";
          try {
            await createScheduledJob({
              id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
              username,
              recipientId: fromId,
              recipientName: String(value?.from?.username || "") || undefined,
              sendAt,
              message: carousel ? "" : automation.message || "",
              buttons: automation.buttons || [],
              messageType: carousel ? "carousel" : "text",
              cards: carousel ? automation.cards : undefined,
              intro: automation.cardIntro,
              commentId,
              commentAt: new Date(entryMs).toISOString(),
              source: "comment",
              ruleId: automation.id,
              ruleName: automation.name,
              createdAt: new Date().toISOString(),
              status: "pending",
            });
            await appendLog(username, {
              kind: "dm",
              status: "scheduled",
              recipientId: fromId,
              commentId,
              ruleId: automation.id,
              ruleName: automation.name,
              sendAt,
            });
            console.log(`[ig-webhook] comment DM scheduled for ${sendAt}`);
          } catch (e: any) {
            // 대기열에 넣지 못했다면 선점을 되돌린다. Meta 가 이벤트를 다시 보내면
            // 그때 한 번 더 시도할 수 있어야 한다.
            await release(username, commentDmKey(commentId));
            console.error("[ig-webhook] scheduling failed:", e?.message);
            await appendLog(username, {
              kind: "dm",
              status: "failed",
              recipientId: fromId,
              commentId,
              ruleId: automation.id,
              ruleName: automation.name,
              error: "예약 대기열에 넣지 못했습니다. 잠시 후 다시 시도해 주세요.",
              errorKind: "other",
            });
          }
          continue;
        }

        const messages = plan.messages;
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
        const commentKey = commentDmKey(commentId);
        const replyKey = privateReplyKey(commentId);

        /**
         * 댓글 하나가 만들어 낼 자동 DM 은 1통이다.
         *
         * 내용해시 키보다 먼저 확인해야 한다. Meta 가 같은 댓글 이벤트를 나중에
         * 다시 보냈고 그 사이 문구가 바뀌었다면 내용해시 키는 새 값이라 통과하는데,
         * 그러면 이 댓글 작성자에게 예전 문구에 이어 새 문구까지 도착한다
         * ("hello 만 가야 하는데 예전 메시지도 왔다"가 정확히 이 상황이다).
         */
        if (!(await claimIfNew(username, commentKey))) {
          console.warn("[ig-webhook] comment already auto-DMed — skipped", commentId);
          continue;
        }

        // 같은 댓글에 같은 내용을 이미 보냈다면(웹훅 재전송·수동 발송과 겹침) 끝.
        // 댓글 단위 선점은 되돌리지 않는다 — 이 댓글에는 이미 DM 이 나갔으므로,
        // 나중에 문구가 바뀐 재전송이 들어와도 다시 보내면 안 된다.
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
                bestEffortFrom: plan.bestEffortFrom,
                fallback: plan.fallback,
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
            // 이 경로는 대화창이 열려 있어야 성공한다. 열려 있다면 여러 통을 보낼 수
            // 있으므로, 설정한 순서(인사말 → 카드)를 그대로 살린다.
            const direct = buildDirectPlan(automation);
            result = await sendDmMessages({
              graphHost: graphHost(settings),
              graphVersion: GRAPH_VERSION,
              igId,
              accessToken,
              recipient: { id: fromId },
              messages: direct.messages.length > 0 ? direct.messages : messages,
              bestEffortFrom: direct.bestEffortFrom,
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
              /**
               * 인사말처럼 "도착하면 좋은" 부가 메시지가 빠진 경우. 댓글 비공개
               * 답장은 한 통이 전부라 정상적인 결과이므로 실패로 남기지 않는다.
               */
              followUpSkipped: result.followUpError || undefined,
              usedFallback: result.usedFallback || undefined,
            });
          } else {
            // 못 보냈으니 기록을 지운다 — 재전송 때 다시 시도할 수 있어야 한다.
            await release(username, contentKey);
            await release(username, commentKey);
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
          await release(username, commentKey);
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
