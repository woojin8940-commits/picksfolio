import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import {
  buildBaitCommentPlan,
  buildCommentDmPlan,
  buildDirectDmPlan,
  buildMainDmPlan,
  DEFAULT_FOLLOW_GATE_BUTTON_LABEL,
  DEFAULT_FOLLOW_GATE_MESSAGE,
  describeDmError,
  postbackCard,
  postCommentReply,
  sendDmMessages,
  sentTextsOf,
} from "./_shared/instagram-dm.mts";
import type { DmButton, DmCard, DmPlan } from "./_shared/instagram-dm.mts";
import { noteWebhookReceived, resolveDmAccountByIgId } from "./_shared/dm-webhook-index.mts";
import { dmAutomationAllowed } from "./_shared/dm-automation-access.mts";
import { linkFeatureOff, type MetaLink } from "./_shared/instagram-metrics.mts";
import { appendDmLog } from "./_shared/dm-automation-log.mts";
import {
  claimIfNew,
  confirmFailed,
  confirmedFailure,
  confirmSent,
  confirmedSent,
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
import { createScheduledJob, queueRemainingDmMessages } from "./_shared/dm-schedule-store.mts";
import { backupCommentEvents, enqueueCommentEvents } from "./_shared/dm-jobs.mts";
import type { QueuedComment } from "./_shared/dm-jobs.mts";
import { fetchContactProfile, getDmContact, noteDmContact, withinDmWindow } from "./_shared/dm-contacts.mts";
import { faqIdFromPayload } from "./_shared/instagram-ice-breakers.mts";
import {
  baitGateKey,
  baitMainKey,
  baitPayload,
  baitSuspended,
  commentIdFromBaitPayload,
  getBaitPending,
  noteBaitFailure,
  noteBaitSuccess,
  notifyAdminBaitIssue,
  saveBaitPending,
} from "./_shared/dm-bait.mts";

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
  /**
   * 2단계 발송(미끼 → 본 메시지) 사용 여부. 켜져 있으면 댓글 비공개 답장으로는
   * `baitMessage` + postback 버튼만 보내고, 버튼을 누른 사람에게 위의
   * message/buttons/cards(+ mainIntro)를 본 메시지로 보낸다. 팔로우 조건이 있는
   * 자동화는 저장 시점에 항상 켜진다(클릭 전에는 팔로우 여부를 알 수 없다).
   */
  baitEnabled?: boolean;
  baitMessage?: string;
  baitButtonLabel?: string;
  /** 본 메시지 앞에 먼저 보낼 텍스트(선택). 캐러셀 본 메시지에만 쓴다. */
  mainIntro?: string;
  /** 팔로우 조건에 맞지 않는 사람이 버튼을 눌렀을 때 보낼 안내와 재확인 버튼 라벨. */
  followGateMessage?: string;
  followGateButtonLabel?: string;
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
  };
}

/**
 * 댓글 비공개 답장용 계획. 캐러셀이 첫 통에 들어간다.
 *
 * 인스타그램은 버튼 템플릿을 지원하지 않으므로 링크 버튼도 제네릭 템플릿 카드로
 * 감싸 보낸다. 댓글 1건당 1통 제한 때문에 순서가 중요하다 —
 * 자세한 내용은 _shared/instagram-dm.mts 참고.
 */
/** 인사말은 캐러셀 본 메시지에만 붙인다(텍스트는 본문에 바로 적으면 된다). */
function mainIntroOf(a: DmAutomationItem): string {
  return a.messageType === "carousel" ? (a.mainIntro || "").trim() : "";
}

function buildCommentPlan(a: DmAutomationItem): DmPlan {
  return buildCommentDmPlan(dmContentOf(a));
}

/** 대화창이 열린 상대에게 IGSID 로 직접 보낼 때 쓰는 계획(설정한 순서 그대로). */
function buildDirectPlan(a: DmAutomationItem): DmPlan {
  if (usesBait(a)) return buildMainDmPlan(dmContentOf(a), mainIntroOf(a));
  return buildDirectDmPlan(dmContentOf(a));
}

/** 설정상 2단계 발송을 쓰는 자동화인지(팔로우 조건이 있으면 항상 쓴다). */
function usesBait(a: DmAutomationItem): boolean {
  return Boolean(a.baitEnabled) || a.followFilter === "followers" || a.followFilter === "non_followers";
}

/**
 * 1단계(미끼) 비공개 답장 계획. 미끼 카드가 거부되면 기존 1통 카드가 대신 나간다
 * (buildBaitCommentPlan 의 fallback).
 */
function buildBaitPlan(a: DmAutomationItem, commentId: string): DmPlan {
  return buildBaitCommentPlan(
    { message: a.baitMessage, buttonLabel: a.baitButtonLabel, payload: baitPayload(commentId) },
    dmContentOf(a),
  );
}

async function appendLog(username: string, entry: Record<string, unknown>) {
  await appendDmLog(username, entry, "ig-webhook");
}

const SEND_SPACING_MS = 400;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function scheduledSendAt(a: DmAutomationItem): number | null {
  if (a.sendMode !== "scheduled") return null;
  const at = Date.parse(a.scheduledAt || "");
  if (Number.isNaN(at)) return null;
  return at > Date.now() ? at : null;
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

/**
 * 키워드 비교용으로 글자를 맞춘다.
 *
 * 입력칸 앞에 # 아이콘이 있어 사용자가 "#가격" 처럼 넣는 경우가 많은데, 그대로 비교하면
 * "가격 얼마예요?" 댓글에 걸리지 않았다. 앞의 # 을 떼고, 한글 자모 조합 차이(NFC)와
 * 연속 공백 · 대소문자를 맞춘 뒤 부분 일치로 본다.
 */
function normalizeMatchText(value: string): string {
  return String(value || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

function keywordHit(keywords: string[] | undefined, text: string): boolean {
  const haystack = normalizeMatchText(text);
  return (keywords || []).some((k) => {
    const needle = normalizeMatchText(String(k || "").replace(/^#+/, ""));
    return needle.length > 0 && haystack.includes(needle);
  });
}

function matchAutomation(a: DmAutomationItem, text: string, mediaId: string): boolean {
  // DM 본문이 없어도 공개 답글만 남기는 자동화는 동작해야 한다.
  if (!a.enabled || (!hasContent(a) && !hasReplyContent(a))) return false;
  // 특정 게시물에만 적용하도록 설정된 경우 댓글이 달린 게시물이 목록에 있어야 한다.
  if (a.mediaScope === "selected") {
    if (!mediaId || !(a.mediaIds || []).includes(mediaId)) return false;
  }
  if (a.commentMatch === "all") return true;
  return keywordHit(a.keywords, text);
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
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(3_000) },
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
  return keywordHit(r.keywords, text);
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

  if (!(await claimIfNew(username, claimKey, true))) {
    console.warn("[ig-webhook] duplicate messaging event — trigger DM skipped", claimKey);
    return;
  }

  // 우리가 보낸 문구로 먼저 남긴다. 발신 에코가 발송 응답보다 먼저 도착해도
  // "외부 서비스가 보낸 DM"으로 잘못 표시되지 않는다.
  for (const body of sentTextsOf(plan.messages)) await noteSentText(username, body);

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
      // 본문 텍스트 뒤 링크 버튼 카드가 발송 간격에 걸렸으면 대기열로 이어 보낸다.
      const followUpQueued = await queueRemainingDmMessages({
        id: `trigger_rest_${claimKey}`,
        username,
        igAccountId: igId,
        recipientId,
        messages: plan.messages,
        result,
        ruleId,
        ruleName,
      });
      await appendLog(username, {
        kind: "dm",
        status: "sent",
        trigger,
        partial: result.partial && !followUpQueued,
        followUpQueued: followUpQueued || undefined,
        recipientId,
        ruleId,
        ruleName,
        messageId: result.messageId,
        error: result.partial ? result.error : undefined,
      });
      return;
    }

    const kind = result.errorKind || "other";
    if (kind === "rate_limit" || kind === "throttled") {
      try {
        await createScheduledJob({
          id: `trigger_${claimKey}`,
          username,
          igAccountId: igId,
          recipientId,
          sendAt: new Date(Date.now() + (result.retryAfterMs || 60_000)).toISOString(),
          message: args.message || "",
          buttons: args.buttons || [],
          source: "trigger",
          createdAt: new Date().toISOString(),
          status: "pending",
          ruleId,
          ruleName,
        });
        await appendLog(username, { kind: "dm", status: "scheduled", trigger, recipientId, ruleId, ruleName });
      } catch (e) {
        await release(username, claimKey, true);
        throw e;
      }
      return;
    }
    if (kind !== "uncertain") await release(username, claimKey, true);
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
 * 2단계 발송 — 댓글 비공개 답장으로 보낸 미끼 카드의 버튼을 누른 이벤트(postback).
 *
 * 이 클릭은 인스타그램에서 "상대가 우리에게 말을 건 것"으로 처리돼 24시간 대화창이
 * 열린다. 그래서 여기서부터는 IGSID 로 여러 통(긴 텍스트 · 여러 버튼 · 캐러셀)을
 * 보낼 수 있다.
 *
 * 순서:
 *  1) payload(`bait_<댓글ID>`)로 대기 기록을 찾고, 누른 사람이 댓글 작성자인지 본다.
 *  2) 후보 자동화 중 팔로우 조건이 있으면 지금(대화창이 열린 뒤) 팔로우 여부를 조회해
 *     맞는 자동화를 고른다. 맞는 게 없으면 "팔로우 후 다시 눌러 주세요" 안내와 같은
 *     payload 의 재확인 버튼을 보낸다 — 다시 누르면 이 함수가 처음부터 다시 판정한다.
 *  3) 본 메시지는 댓글당 1회만 보낸다(여러 번 눌러도 한 번).
 *
 * 본 메시지가 "대화창 밖"으로 거부되면 Meta 가 버튼 클릭을 더 이상 대화 수락으로
 * 인정하지 않는다는 신호다. 연달아 그러면 2단계 발송을 멈추고(dm-bait 서킷 브레이커)
 * 이후 댓글에는 기존 1통 카드가 나가게 하며, 운영자에게 알린다. 형식 오류로 거부되면
 * 이 사람에게는 기존 1통 카드 내용으로 한 번 더 보낸다.
 */
async function handleBaitPostback(ctx: DmTriggerContext, event: any): Promise<void> {
  const postback = event?.postback;
  if (!postback) return;
  const senderId = String(event?.sender?.id || "");
  if (!senderId || ctx.ownIds.has(senderId)) return;
  const commentId = commentIdFromBaitPayload(String(postback?.payload || ""));
  if (!commentId) return;

  const { username, settings, igId, accessToken } = ctx;
  await noteDmContact({ username, igsid: senderId, text: postback?.title, kind: "postback" }).catch(() => undefined);

  const skip = (reason: string, extra: Record<string, unknown> = {}) =>
    appendLog(username, { kind: "dm", status: "skipped", trigger: "bait_click", reason, recipientId: senderId, commentId, ...extra });

  const pending = await getBaitPending(username, commentId);
  if (!pending) return skip("대기 중인 1단계 메시지를 찾지 못했습니다(오래된 버튼일 수 있습니다).");
  if (pending.fromId && pending.fromId !== senderId) return skip("댓글 작성자가 아닌 사람이 누른 버튼입니다.");

  const blocked = await ctx.blocked();
  if (blocked) return skip(blocked);

  const candidates = pending.automationIds
    .map((id) => (settings.automations || []).find((a) => a.id === id))
    .filter((a): a is DmAutomationItem => Boolean(a && a.enabled && hasContent(a)));
  if (candidates.length === 0) return skip("연결된 자동화가 삭제되었거나 꺼져 있습니다.");

  let follows: boolean | null = null;
  if (candidates.some((a) => a.followFilter === "followers" || a.followFilter === "non_followers")) {
    follows = await fetchFollowsBusiness({ host: graphHost(settings), igsid: senderId, accessToken });
    if (follows === null) console.warn("[ig-webhook] follow state unknown at bait click — sending without follow filter");
  }
  const automation = candidates.find((a) => passesFollowFilter(a, follows));
  const eventId = String(postback?.mid || `${senderId}_${event?.timestamp || ""}`);
  const send = (messages: Record<string, unknown>[]) =>
    sendDmMessages({
      graphHost: graphHost(settings),
      graphVersion: GRAPH_VERSION,
      igId,
      accessToken,
      recipient: { id: senderId },
      messages,
      bestEffortFrom: messages.length,
      continuation: true,
    });

  // 팔로우 조건에 맞지 않음 → 안내 + 재확인 버튼(같은 payload).
  if (!automation) {
    const gateRule = candidates[0];
    const gateKey = baitGateKey(eventId);
    if (!(await claimIfNew(username, gateKey, true))) return;
    const text = (gateRule.followGateMessage || "").trim() || DEFAULT_FOLLOW_GATE_MESSAGE;
    const card = postbackCard(text, gateRule.followGateButtonLabel || "", baitPayload(commentId), DEFAULT_FOLLOW_GATE_BUTTON_LABEL);
    const result = await send([card]);
    if (result.errorKind === "throttled" || result.errorKind === "rate_limit") {
      try {
        await createScheduledJob({
          id: `bait_gate_${eventId}`,
          username,
          igAccountId: igId,
          recipientId: senderId,
          sendAt: new Date(Date.now() + Math.max(result.retryAfterMs || 0, 1000)).toISOString(),
          message: "",
          buttons: [],
          payloads: [card],
          source: "trigger",
          createdAt: new Date().toISOString(),
          status: "pending",
          ruleId: gateRule.id,
          ruleName: gateRule.name,
        });
      } catch (e) {
        await release(username, gateKey, true);
        throw e;
      }
      await appendLog(username, {
        kind: "dm", status: "scheduled", trigger: "bait_follow_gate", recipientId: senderId,
        commentId, ruleId: gateRule.id, ruleName: gateRule.name,
      });
      return;
    }
    if (!result.ok && result.errorKind !== "uncertain") await release(username, gateKey, true);
    await appendLog(username, {
      kind: "dm",
      status: result.ok ? "sent" : "failed",
      trigger: "bait_follow_gate",
      recipientId: senderId,
      commentId,
      ruleId: gateRule.id,
      ruleName: gateRule.name,
      reason: gateRule.followFilter === "followers" ? "팔로워가 아니어서 팔로우 안내를 보냈습니다." : "이미 팔로워여서 안내를 보냈습니다.",
      messageId: result.messageId,
      error: result.ok ? undefined : describeDmError(result.errorKind || "other", result.error),
      errorKind: result.ok ? undefined : result.errorKind,
    });
    return;
  }

  const mainKey = baitMainKey(commentId);
  if (!(await claimIfNew(username, mainKey, true))) {
    console.warn("[ig-webhook] bait main message already sent — click ignored", commentId);
    return;
  }

  const plan = buildMainDmPlan(dmContentOf(automation), mainIntroOf(automation));
  for (const body of sentTextsOf(plan.messages)) await noteSentText(username, body);

  try {
    let resultMessages = plan.messages;
    let result = await send(resultMessages);
    let usedFallback = false;

    // 본 메시지가 형식 오류로 거부됨(카드 이미지 등) → 기존 1통 카드 내용으로 한 번 더.
    if (!result.ok && !result.partial && result.errorKind === "invalid_payload") {
      const single = buildCommentPlan(automation);
      const fallbackMessages = single.messages.slice(0, 1);
      if (fallbackMessages.length > 0) {
        resultMessages = fallbackMessages;
        const retried = await send(resultMessages);
        if (!retried.ok && single.fallback && retried.errorKind === "invalid_payload") {
          resultMessages = [single.fallback];
          result = await send(resultMessages);
        } else {
          result = retried;
        }
        usedFallback = result.ok;
      }
    }

    if (result.ok || result.partial) {
      await noteBaitSuccess(username);
      /**
       * 긴 본문 + 링크 버튼은 [텍스트] → [버튼 카드] 2통이다. 계정 발송 간격(기본 약
       * 9초) 때문에 두 번째 통이 `throttled` 로 끝나면 예전에는 그대로 버려져 텍스트만
       * 도착했다. 남은 통은 대기열이 간격에 맞춰 이어 보낸다.
       */
      const followUpQueued = await queueRemainingDmMessages({
        id: `bait_rest_${commentId}`,
        username,
        igAccountId: igId,
        recipientId: senderId,
        messages: resultMessages,
        result,
        ruleId: automation.id,
        ruleName: automation.name,
      });
      await appendLog(username, {
        kind: "dm",
        status: "sent",
        trigger: "bait_main",
        stage: "main",
        partial: result.partial && !followUpQueued,
        followUpQueued: followUpQueued || undefined,
        recipientId: senderId,
        commentId,
        ruleId: automation.id,
        ruleName: automation.name,
        ruleUpdatedAt: automation.updatedAt,
        messageId: result.messageId,
        usedFallback: usedFallback || undefined,
        error: result.partial ? result.error : undefined,
      });
      return;
    }

    const kind = result.errorKind || "other";
    if (kind !== "uncertain") await release(username, mainKey, true);

    if (kind === "rate_limit" || kind === "throttled") {
      // 발송 한도 — 대기열로 넘긴다(대화창은 방금 열렸으므로 24시간 안에 나간다).
      // 만들어 둔 본 메시지 페이로드를 그대로 싣는다. 문구·버튼·카드로 다시 조립하면
      // 캐러셀 앞 인사말이 빠진다(캐러셀 설정은 카드 한 통만 만든다).
      try {
        await createScheduledJob({
          id: `bait_${commentId}`,
          username,
          igAccountId: igId,
          recipientId: senderId,
          sendAt: new Date(Date.now() + (result.retryAfterMs || 60_000)).toISOString(),
          message: "",
          buttons: [],
          payloads: resultMessages,
          source: "trigger",
          createdAt: new Date().toISOString(),
          status: "pending",
          ruleId: automation.id,
          ruleName: automation.name,
        });
        await claimIfNew(username, mainKey, true);
        await appendLog(username, { kind: "dm", status: "scheduled", trigger: "bait_main", recipientId: senderId, commentId, ruleId: automation.id, ruleName: automation.name });
        return;
      } catch (e) {
        console.error("[ig-webhook] bait main scheduling failed:", (e as Error)?.message);
      }
    }

    /**
     * 대화창 밖 / 권한 오류 — 버튼 클릭이 대화 수락으로 인정되지 않았다는 뜻이다.
     * 이 사람에게는 더 보낼 방법이 없다(비공개 답장 1통은 이미 미끼로 썼다).
     */
    if (kind === "outside_window" || kind === "permission" || kind === "other") {
      const tripped = await noteBaitFailure(username, describeDmError(kind, result.error));
      if (tripped) {
        await notifyAdminBaitIssue(
          username,
          `버튼 클릭 뒤 본 메시지가 연달아 거부돼(${kind}) 24시간 동안 기존 1통 카드 방식으로 전환했습니다. Meta 정책 변경 여부를 확인하세요.`,
          "suspended",
        );
      }
    }
    await appendLog(username, {
      kind: "dm",
      status: "failed",
      trigger: "bait_main",
      stage: "main",
      recipientId: senderId,
      commentId,
      ruleId: automation.id,
      ruleName: automation.name,
      error: describeDmError(kind, result.error),
      errorKind: kind,
    });
  } catch (e: any) {
    await appendLog(username, {
      kind: "dm",
      status: "failed",
      trigger: "bait_main",
      recipientId: senderId,
      commentId,
      ruleId: automation.id,
      error: e?.message || "send error",
    });
  }
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
 * 흘려 넣어 고객 계정으로 DM 을 보내게 만들 수 있다.
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
  if (!appSecret) {
    console.error("[ig-webhook] rejected: INSTAGRAM_APP_SECRET not set");
    return new Response("Forbidden", { status: 403 });
  }
  if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret)) {
    console.warn("[ig-webhook] rejected: invalid x-hub-signature-256");
    return new Response("Forbidden", { status: 403 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  const commentEvents = (payload?.entry || []).flatMap((entry: any) =>
    (entry?.changes || [])
      .filter((change: any) => change?.field === "comments" && change?.value?.id && entry?.id)
      .map((change: any) => ({
        igAccountId: String(entry.id),
        entryTime: Number(entry.time) || undefined,
        change,
      })),
  );
  if (commentEvents.length > 0) {
    try {
      await enqueueCommentEvents(commentEvents);
    } catch (e) {
      console.error("[ig-webhook] comment queue failed:", (e as Error)?.message);
      try {
        await backupCommentEvents(commentEvents as QueuedComment[]);
      } catch {
        return new Response("Queue unavailable", { status: 503 });
      }
    }
  }

  const messagingEntries = (payload?.entry || []).filter((entry: any) =>
    (Array.isArray(entry?.messaging) && entry.messaging.length > 0) ||
    (entry?.changes || []).some((change: any) =>
      ["messages", "message_echoes", "messaging_postbacks"].includes(change?.field),
    ),
  );
  if (messagingEntries.length > 0) {
    await processWebhookPayload({ entry: messagingEntries }, true).catch((e) =>
      console.error("[ig-webhook] messaging processing error:", e),
    );
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
};

export interface WebhookProcessResult {
  retryable: boolean;
  retryAfterMs?: number;
  sent?: number;
  failed?: number;
  partial?: boolean;
  uncertain?: boolean;
  sideEffectAttempted?: boolean;
  error?: string;
  errorKind?: string;
}

export async function processWebhookPayload(
  payload: any,
  skipComments = false,
  onlyAutomationId = "",
): Promise<WebhookProcessResult> {
  const outcome: WebhookProcessResult = { retryable: false };

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
        outcome.retryable = true;
        outcome.errorKind = "account_lookup";
        outcome.error = "인스타그램 계정 연결 정보를 찾지 못했습니다.";
        continue;
      }

      const settings = (await store.get(`dm_${username}`, { type: "json" })) as DmSettings | null;
      if (!settings) {
        outcome.retryable = true;
        outcome.errorKind = "settings_lookup";
        outcome.error = "자동 DM 설정을 찾지 못했습니다.";
        continue;
      }
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
        // 자동 디엠을 직접 끊어 둔 계정. 해제할 때 구독과 역인덱스를 함께 풀었으니
        // 여기까지 오는 이벤트는 없어야 하지만, 연동 토큰은 인사이트·브랜드 매칭받기
        // 때문에 남겨 두므로 발송 직전에 한 번 더 확인한다 — 끊은 사람의 계정에서
        // 자동 DM 이 나가는 것은 되돌릴 수 없는 일이다.
        if (linkFeatureOff(settings as MetaLink, "dm")) return "not_connected";
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
        await handleBaitPostback(triggerCtx, event).catch((e) =>
          console.warn("[ig-webhook] bait postback failed:", (e as Error)?.message),
        );
        await handleInboundMessage(triggerCtx, event).catch((e) =>
          console.warn("[ig-webhook] inbound DM trigger failed:", (e as Error)?.message),
        );
      }

      for (const change of entry?.changes || []) {
        if (skipComments) break;
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
          (settings.automations || []).filter((a) =>
            (!onlyAutomationId || a.id === onlyAutomationId) && matchAutomation(a, commentText, mediaId)),
        );
        if (candidates.length === 0) continue;

        /**
         * 2단계 발송(미끼 → 본 메시지)을 쓰는 자동화는 팔로우 조건을 지금 보지 않는다.
         * 댓글 시점에는 대화 이력이 없어 팔로우 조회가 대부분 응답하지 않으므로, 미끼를
         * 먼저 보내고 버튼을 누른 순간(대화창이 열린 뒤) 조회해 알맞은 본 메시지를
         * 고른다. 2단계 방식이 막혀 멈춰 있으면(baitSuspended) 기존 방식 그대로다.
         */
        const baitPaused = candidates.some(usesBait) ? await baitSuspended(username) : false;
        const baitOn = (a: DmAutomationItem) => usesBait(a) && !baitPaused;

        let follows: boolean | null = null;
        if (candidates.some((a) => !baitOn(a) && (a.followFilter === "followers" || a.followFilter === "non_followers"))) {
          follows = await fetchFollowsBusiness({
            host: graphHost(settings),
            igsid: fromId,
            accessToken,
          });
          if (follows === null) {
            console.warn("[ig-webhook] follow state unknown — sending without follow filter");
          }
        }

        const automation = candidates.find((a) => baitOn(a) || passesFollowFilter(a, follows));
        if (!automation) continue;
        const bait = baitOn(automation);
        // 버튼을 누른 시점에 다시 고를 후보(우선순위 순). 팔로워용·비팔로워용을 나눠
        // 걸어 둔 경우에도 클릭한 사람에게 맞는 쪽이 나간다.
        const baitCandidateIds = bait ? candidates.filter(baitOn).map((a) => a.id) : [];
        if (usesBait(automation) && baitPaused) {
          console.warn("[ig-webhook] 2-step DM suspended — sending single-card fallback", commentId);
        }

        if (onlyAutomationId && automation.sendMode !== "scheduled") continue;
        const configuredSchedule = Date.parse(automation.scheduledAt || "");
        if (onlyAutomationId && Number.isNaN(configuredSchedule)) continue;
        const scheduledMs = onlyAutomationId
          ? Math.max(configuredSchedule, Date.now())
          : scheduledSendAt(automation);
        if (scheduledMs !== null) {
          const pool = automation.replyEnabled
            ? (automation.replies || []).filter((r) => r && r.trim())
            : [];
          const reply = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
          if (automation.replyEnabled && !reply) {
            await appendLog(username, {
              kind: "reply",
              status: "skipped",
              reason: "답글 문구가 비어 있습니다.",
              recipientId: fromId,
              ruleId: automation.id,
            });
          }
          if (!(await claimIfNew(username, commentDmKey(commentId), true))) {
            console.warn("[ig-webhook] comment already handled — scheduling skipped", commentId);
            continue;
          }
          const commentMs = Date.parse(String(value?.timestamp || ""));
          const entryMs = !Number.isNaN(commentMs)
            ? commentMs
            : Number(entry?.time) > 0 ? Number(entry.time) * 1000 : Date.now();
          const sendAt = new Date(scheduledMs).toISOString();
          const carousel = automation.messageType === "carousel";
          let sendDm = hasContent(automation);
          if (sendDm && buildCommentPlan(automation).messages.length === 0) {
            sendDm = false;
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
          }
          if (!sendDm && !reply) continue;
          try {
            await createScheduledJob({
              id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
              username,
              igAccountId: igId,
              recipientId: fromId,
              recipientName: String(value?.from?.username || "") || undefined,
              sendAt,
              message: carousel ? "" : automation.message || "",
              buttons: automation.buttons || [],
              messageType: carousel ? "carousel" : "text",
              cards: carousel ? automation.cards : undefined,
              commentId,
              commentAt: new Date(entryMs).toISOString(),
              publicReply: reply ? { commentId: parentId || commentId, message: reply } : undefined,
              sendDm,
              bait: bait
                ? {
                    message: automation.baitMessage || "",
                    buttonLabel: automation.baitButtonLabel || "",
                    automationIds: baitCandidateIds,
                  }
                : undefined,
              source: "comment",
              backfill: Boolean(onlyAutomationId),
              ruleId: automation.id,
              ruleName: automation.name,
              createdAt: new Date().toISOString(),
              status: "pending",
            });
            if (reply) {
              await appendLog(username, {
                kind: "reply",
                status: "scheduled",
                recipientId: fromId,
                commentId,
                ruleId: automation.id,
                sendAt,
              });
            }
            if (sendDm) {
              await appendLog(username, {
                kind: "dm",
                status: "scheduled",
                recipientId: fromId,
                commentId,
                ruleId: automation.id,
                ruleName: automation.name,
                sendAt,
              });
            }
            console.log(`[ig-webhook] comment automation scheduled for ${sendAt}`);
          } catch (e: any) {
            await release(username, commentDmKey(commentId), true);
            console.error("[ig-webhook] scheduling failed:", e?.message);
            await appendLog(username, {
              kind: "dm",
              status: "failed",
              recipientId: fromId,
              commentId,
              ruleId: automation.id,
              ruleName: automation.name,
              error: "예약 대기열에 넣지 못했습니다. 잠시 후 다시 시도해 주세요.",
              errorKind: "queue",
            });
            outcome.retryable = true;
            outcome.error = e?.message || "예약 대기열 저장 실패";
            outcome.errorKind = "queue";
          }
          continue;
        }

        let repliedNow = false;
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
          } else if (!(await claimIfNew(username, publicReplyKey(commentId), true))) {
            const previousFailure = await confirmedFailure(username, publicReplyKey(commentId));
            if (previousFailure) {
              outcome.failed = (outcome.failed || 0) + 1;
              outcome.error = previousFailure.error;
              outcome.errorKind = previousFailure.kind;
            } else if (!(await confirmedSent(username, publicReplyKey(commentId)))) {
              outcome.uncertain = true;
              outcome.error = "이 댓글 답글의 이전 발송 결과를 확인해야 합니다.";
              outcome.errorKind = "uncertain";
              continue;
            }
            // 같은 댓글 이벤트가 재전송된 경우다. 다시 달면 답글이 두 개 붙는다.
            console.warn("[ig-webhook] duplicate comment event — public reply skipped");
          } else {
            const reply = pool[Math.floor(Math.random() * pool.length)];
            outcome.sideEffectAttempted = true;
            repliedNow = true;
            const replyResult = await postCommentReply({
              igId,
              host: graphHost(settings),
              graphVersion: GRAPH_VERSION,
              commentId: parentId || commentId,
              accessToken,
              message: reply,
            });
            if (replyResult.ok) {
              await confirmSent(username, publicReplyKey(commentId));
              outcome.sent = (outcome.sent || 0) + 1;
              await appendLog(username, {
                kind: "reply",
                status: "sent",
                recipientId: fromId,
                ruleId: automation.id,
                messageId: replyResult.replyId,
              });
            } else {
              // 일시적인 실패(한도·발송 간격)는 선점을 되돌려 다시 시도할 수 있게 한다.
              // 인스타그램이 거절한 영구 실패("Object ... does not exist" 등)는 다시 해도
              // 같은 결과라 처리 끝으로 표시한다. 되돌리면 DM 이 발송 간격 때문에 대기열로
              // 돌아갈 때마다 답글부터 다시 시도해 실패하고, 그 DM 은 영영 나가지 못한 채
              // 시간당 발송 한도만 계속 써 버린다.
              const transientReply = replyResult.errorKind === "rate_limit" || replyResult.errorKind === "throttled";
              if (!replyResult.uncertain) {
                if (transientReply) await release(username, publicReplyKey(commentId), true);
                else await confirmFailed(username, publicReplyKey(commentId), replyResult.error || "답글 발송 실패", replyResult.errorKind || "other");
              }
              if (replyResult.errorKind === "rate_limit" || replyResult.errorKind === "throttled") {
                outcome.retryable = true;
                outcome.error = replyResult.error;
                outcome.errorKind = replyResult.errorKind;
                outcome.retryAfterMs = replyResult.retryAfterMs;
              } else if (replyResult.uncertain) {
                outcome.uncertain = true;
                outcome.error = replyResult.error;
                outcome.errorKind = "uncertain";
              } else {
                outcome.failed = (outcome.failed || 0) + 1;
                outcome.error = replyResult.error;
                outcome.errorKind = replyResult.errorKind;
              }
              console.warn("[ig-webhook] public reply failed:", replyResult.error);
              // 발송 간격 조절(throttled)은 실패가 아니다 — 대기열이 곧 다시 보낸다.
              // 기록을 남기면 대기할 때마다 활동 기록에 실패가 쌓인다.
              if (replyResult.errorKind !== "throttled") {
                await appendLog(username, {
                  kind: "reply",
                  status: "failed",
                  recipientId: fromId,
                  ruleId: automation.id,
                  error: replyResult.error,
                });
              }
              if (outcome.retryable || outcome.uncertain) continue;
            }
          }
        }

        // 2) 비공개 답장(DM) — recipient.comment_id 사용. 답글만 설정한 자동화는
        //    보낼 DM 본문이 없으므로 발송을 건너뛴다(실패로 기록하지 않는다).
        if (!hasContent(automation)) continue;
        if (repliedNow) await wait(SEND_SPACING_MS);

        const legacyPlan = buildCommentPlan(automation);
        /**
         * 설정에는 내용이 있는데 실제로 보낼 수 있는 메시지가 없는 경우.
         *
         * 대표적으로 카드에 제목만 적고 이미지·설명·버튼을 비워 둔 캐러셀이다.
         * 제네릭 템플릿은 제목 외 속성이 최소 하나 있어야 해서 그 카드는 뺄 수밖에
         * 없고, 전부 그런 카드면 남는 메시지가 없다. 조용히 넘기면 사용자는 이유를
         * 알 수 없으니 활동 기록에 남긴다.
         */
        if (legacyPlan.messages.length === 0) {
          outcome.failed = (outcome.failed || 0) + 1;
          outcome.error = "보낼 수 있는 메시지가 없습니다.";
          outcome.errorKind = "invalid_payload";
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

        // 2단계 발송이면 비공개 답장 한 통은 미끼 카드다(거부되면 기존 1통 카드로 대체).
        const plan = bait ? buildBaitPlan(automation, commentId) : legacyPlan;
        const messages = plan.messages;
        if (plan.fallback) {
          for (const body of sentTextsOf([plan.fallback])) await noteSentText(username, body);
        }
        // 우리가 보낸 문구로 남긴다. 발송 직후 인스타그램이 돌려주는 발신 에코를
        // "외부 서비스가 보낸 DM"으로 잘못 표시하지 않으려면 발송 전에 남겨야 한다
        // (에코가 발송 응답보다 먼저 도착할 수 있다).
        for (const body of sentTextsOf(messages)) await noteSentText(username, body);
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
        if (!(await claimIfNew(username, commentKey, true))) {
          console.warn("[ig-webhook] comment already auto-DMed — skipped", commentId);
          continue;
        }

        // 같은 댓글에 같은 내용을 이미 보냈다면(웹훅 재전송·수동 발송과 겹침) 끝.
        // 댓글 단위 선점은 되돌리지 않는다 — 이 댓글에는 이미 DM 이 나갔으므로,
        // 나중에 문구가 바뀐 재전송이 들어와도 다시 보내면 안 된다.
        let contentClaimed: boolean;
        try {
          contentClaimed = await claimIfNew(username, contentKey, true);
        } catch (e) {
          await release(username, commentKey, true);
          throw e;
        }
        if (!contentClaimed) {
          console.warn("[ig-webhook] duplicate DM suppressed for comment", commentId);
          continue;
        }

        let sendAttempted = false;
        try {
          const replyAvailable = await claimIfNew(username, replyKey, true);
          if (!replyAvailable) {
            outcome.uncertain = true;
            outcome.error = "이 댓글의 이전 발송 결과를 확인해야 합니다.";
            outcome.errorKind = "uncertain";
            continue;
          }
          sendAttempted = true;
          outcome.sideEffectAttempted = true;
          let result = await sendDmMessages({
            graphHost: graphHost(settings),
            graphVersion: GRAPH_VERSION,
            igId,
            accessToken,
            recipient: { comment_id: commentId },
            followUpRecipient: fromId && messages.length > 1 &&
              withinDmWindow(await getDmContact(username, fromId)) ? { id: fromId } : undefined,
            messages,
            bestEffortFrom: plan.bestEffortFrom,
            fallback: plan.fallback,
          });

          if (result && !result.ok && !result.partial &&
            result.errorKind !== "already_sent" && result.errorKind !== "uncertain") {
            await release(username, replyKey, true);
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
          let directFollowUpQueued = false;
          const retryViaIgsid =
            Boolean(fromId) &&
            Boolean(result && !result.ok && !result.partial && result.errorKind === "already_sent") &&
            withinDmWindow(await getDmContact(username, fromId));

          if (retryViaIgsid) {
            // 이 경로는 대화창이 열려 있어야 성공한다. 열려 있다면 여러 통을 보낼 수
            // 있으므로, 설정한 순서(인사말 → 카드)를 그대로 살린다.
            const direct = buildDirectPlan(automation);
            const directMessages = direct.messages.length > 0 ? direct.messages : messages;
            sendAttempted = true;
            outcome.sideEffectAttempted = true;
            result = await sendDmMessages({
              graphHost: graphHost(settings),
              graphVersion: GRAPH_VERSION,
              igId,
              accessToken,
              recipient: { id: fromId },
              messages: directMessages,
              bestEffortFrom: direct.bestEffortFrom,
            });
            // 본문 뒤 링크 버튼 카드 등 못 보낸 나머지 통은 대기열이 이어 보낸다.
            directFollowUpQueued = await queueRemainingDmMessages({
              id: `comment_rest_${commentId}`,
              username,
              igAccountId: igId,
              recipientId: fromId,
              messages: directMessages,
              result,
              ruleId: automation.id,
              ruleName: automation.name,
            });
          }

          /**
           * 미끼 카드가 거부돼 기존 1통 카드로 대신 나간 경우. 받는 사람에게는 본문이
           * 도착했지만 2단계 방식은 실패한 것이다 — Meta 가 postback 버튼을 막았을 수
           * 있어 상태 기록과 운영자 알림을 남긴다.
           */
          const baitFellBack = bait && !retryViaIgsid && Boolean(result?.ok && result.usedFallback);
          if (bait && !retryViaIgsid && result?.ok && !result.usedFallback) {
            await saveBaitPending(username, {
              commentId,
              fromId,
              automationIds: baitCandidateIds,
              createdAt: new Date().toISOString(),
            });
          }
          if (baitFellBack) {
            const tripped = await noteBaitFailure(username, "1단계(미끼) 카드가 거부돼 1통 카드로 대체 발송했습니다.");
            if (tripped) {
              await notifyAdminBaitIssue(username, "미끼 카드(postback 버튼)가 연달아 거부돼 24시간 동안 기존 1통 카드 방식으로 전환했습니다.", "suspended");
            }
          }

          if (result && (result.ok || result.partial)) {
            outcome.sent = (outcome.sent || 0) + result.sent;
            outcome.partial = Boolean(outcome.partial || (result.partial && !directFollowUpQueued) || result.followUpError);
            // partial 은 본문이 이미 도착한 상태다. 실패로 기록하면 화면의 활동
            // 기록에서 도착한 DM 이 실패로 보인다.
            await appendLog(username, {
              kind: "dm",
              status: "sent",
              partial: result.partial && !directFollowUpQueued,
              followUpQueued: directFollowUpQueued || undefined,
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
              // 2단계 발송: 미끼가 나갔으면 "bait", 막혀서 1통 카드로 보냈으면 "single_fallback".
              stage: bait && !retryViaIgsid ? (baitFellBack ? "single_fallback" : "bait") : undefined,
              baitSuspended: usesBait(automation) && baitPaused ? true : undefined,
            });
          } else {
            // 못 보냈으니 기록을 지운다 — 재전송 때 다시 시도할 수 있어야 한다.
            const kind = result?.errorKind || "other";
            if (kind !== "uncertain") {
              await release(username, contentKey, true);
              await release(username, commentKey, true);
            } else {
              outcome.uncertain = true;
              outcome.error = result?.error || "발송 결과를 확인하지 못했습니다.";
              outcome.errorKind = kind;
            }
            if (kind === "rate_limit" || kind === "throttled") {
              outcome.retryable = true;
              outcome.error = result?.error || "인스타그램 발송 한도";
              outcome.errorKind = kind;
              outcome.retryAfterMs = result?.retryAfterMs;
            } else if (kind !== "uncertain") {
              outcome.failed = (outcome.failed || 0) + 1;
              outcome.error = result?.error;
              outcome.errorKind = kind;
            }
            if (kind !== "throttled") {
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
          }
        } catch (e: any) {
          if (!sendAttempted) {
            await release(username, contentKey, true);
            await release(username, commentKey, true);
            outcome.retryable = true;
            outcome.errorKind = "registry";
          } else {
            outcome.uncertain = true;
            outcome.errorKind = "other";
          }
          await appendLog(username, { kind: "dm", status: "failed", recipientId: fromId, ruleId: automation.id, error: e?.message || "send error" });
          outcome.error = e?.message || "발송 결과를 확인하지 못했습니다.";
        }
      }
    }
  } catch (e) {
    console.error("[ig-webhook] processing error:", e);
    if (outcome.sideEffectAttempted) {
      outcome.uncertain = true;
      outcome.error = (e as Error)?.message || "댓글 처리 결과를 확인하지 못했습니다.";
      outcome.errorKind = "uncertain";
      return outcome;
    }
    throw e;
  }

  return outcome;
}

export const config: Config = {
  path: "/api/instagram/webhook",
};
