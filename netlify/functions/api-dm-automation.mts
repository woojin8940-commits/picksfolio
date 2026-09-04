import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { BlobWriteConflictError, mutateBlobJSON } from "./_shared/blob-write.mts";
import {
  DM_AUTOMATION_REQUIRED_MESSAGE,
  DM_AUTOMATION_TIER,
  dmAutomationAllowed,
} from "./_shared/dm-automation-access.mts";
import { normalizeLinkUrl } from "./_shared/instagram-dm.mts";
import {
  ICE_BREAKER_MAX,
  ICE_BREAKER_QUESTION_MAX,
  clearIceBreakers,
  faqPayload,
  syncIceBreakers,
} from "./_shared/instagram-ice-breakers.mts";
import { clearForeignDm, readForeignDm } from "./_shared/dm-foreign-dm.mts";
import { subscribeInstagramWebhooks, WEBHOOK_FIELDS } from "./_shared/instagram-webhook-subscribe.mts";
import { indexDmAccount } from "./_shared/dm-webhook-index.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

/**
 * 인스타그램 DM 자동화 설정 저장/조회 (사용자별).
 * - Netlify Blobs 에 사용자별 JSON 설정을 보관한다.
 * - 액세스 토큰은 민감정보라 GET 응답에서는 원문을 내려주지 않고
 *   `hasAccessToken` / `connected` 플래그로만 노출한다.
 * - 계정 연동은 OAuth 콜백(instagram-oauth-callback)이 담당하며, 이 함수는
 *   자동화(automations) 목록과 연동 해제(disconnect)만 처리한다.
 *
 * automations: 인포크 링크식 "댓글 → DM" 자동화 목록.
 *   - commentMatch: 'all' | 'keyword'  (모든 댓글 / 특정 키워드)
 *   - replyEnabled + replies: 댓글에 공개 답글도 남길지 (랜덤)
 *   - followFilter: 'all' | 'followers' | 'non_followers'
 *   - message + buttons: 실제로 보낼 DM (텍스트 + 링크 버튼)
 *
 * faq: DM 창 첫 화면에 보이는 "자주 묻는 질문" 버튼(인스타그램 아이스브레이커).
 *   최대 4개이고, 이 값은 우리 블롭이 아니라 **인스타그램 프로필**에 저장돼야
 *   화면에 보이므로 저장할 때마다 Graph API 로 밀어 넣는다.
 *
 * direct: DM 자체를 트리거로 쓰는 자동화 — 처음 DM 을 받았을 때의 인사말과,
 *   받은 메시지에 특정 단어가 있을 때 보내는 자동 답장. 댓글 자동화(automations)와
 *   별개로 동작한다.
 *
 * rules: 구버전 트리거 규칙(welcome/new_follower 등) — 하위호환 위해 보존한다.
 *
 * 저장은 항상 "읽고 → 고치고 → 조건부로 쓰기"(mutateBlobJSON)로 한다. 예전처럼
 * 문서 전체를 그대로 덮어쓰면, 저장 요청 두 건이 겹치거나 응답 순서가 뒤바뀔 때
 * 늦게 도착한 옛 스냅샷이 방금 고친 메시지를 되돌려 놓는다. 화면에는 새 문구가
 * 남아 있으니 사용자는 "설정은 새 메시지인데 DM 은 예전 문구로 나간다"를 겪는다.
 * 그래서 편집 화면은 바뀐 자동화 한 건만(upsertAutomation) 보내고, 서버가 최신
 * 목록에 합친다.
 */

interface DmMessageButton {
  id: string;
  label: string;
  url: string;
}

interface DmCarouselCard {
  id: string;
  title: string;
  subtitle: string;
  /** 인스타그램이 발송 시점에 직접 받아가는 주소. http/https 절대주소만 저장한다. */
  imageUrl: string;
  buttonLabel: string;
  buttonUrl: string;
}

interface DmAutomationItem {
  id: string;
  name: string;
  enabled: boolean;
  commentMatch: "all" | "keyword";
  keywords: string[];
  replyEnabled: boolean;
  replies: string[];
  followFilter: "all" | "followers" | "non_followers";
  mediaScope: "all" | "selected";
  mediaIds: string[];
  messageType: "text" | "carousel";
  message: string;
  /** 캐러셀 앞에 먼저 보낼 인사말(선택). 텍스트 형식의 message 와 따로 둔다. */
  cardIntro: string;
  buttons: DmMessageButton[];
  cards: DmCarouselCard[];
  /**
   * 조건에 맞았을 때 DM 을 언제 보낼지.
   *  `instant`(기본) — 댓글을 받은 즉시 보낸다.
   *  `scheduled`     — `scheduledAt` 까지 기다렸다가 보낸다(예약 대기열로 들어간다).
   */
  sendMode: "instant" | "scheduled";
  /** 예약 발송 시각(ISO). 즉시 발송이면 빈 문자열. */
  scheduledAt: string;
  createdAt: string;
  /**
   * 이 자동화의 내용이 마지막으로 바뀐 시각.
   *
   * 발송기(instagram-webhook)가 조건이 겹치는 자동화 중 하나를 골라야 할 때
   * "가장 최근에 설정한 것"을 우선하는 기준으로 쓴다.
   */
  updatedAt?: string;
}

/**
 * "자주 묻는 질문" 한 건 — DM 창 첫 화면의 추천 버튼과, 눌렀을 때 나갈 답변.
 *
 * 인스타그램에 등록되는 것은 `question` 뿐이다. 사람이 버튼을 누르면 우리가 심어
 * 둔 payload(`faq_<id>`)가 postback 웹훅으로 돌아오고, 그때 이 `answer` 를 보낸다.
 */
interface DmFaqItem {
  id: string;
  question: string;
  answer: string;
  buttons: DmMessageButton[];
}

interface DmFaqSettings {
  enabled: boolean;
  items: DmFaqItem[];
  /** 인스타그램에 등록을 마친 시각. 비어 있으면 DM 창에는 아직 안 보인다. */
  syncedAt?: string;
  /** 등록에 실패한 이유. 화면에서 그대로 보여준다. */
  syncError?: string;
}

/** 처음 DM 을 받았을 때 보낼 인사말. */
interface DmGreetingSettings {
  enabled: boolean;
  message: string;
  buttons: DmMessageButton[];
  /**
   * 처음 대화하는 사람에게만 보낼지.
   *
   * 껐다면 24시간 넘게 조용했던 대화가 다시 시작될 때도 한 번 더 보낸다. 매 메시지에
   * 인사말을 붙이는 선택지는 두지 않는다 — 대화 중에 같은 인사말이 반복되면 받는
   * 사람에게는 그냥 스팸이다.
   */
  onlyFirstContact: boolean;
}

/** 받은 DM 에 특정 단어가 있을 때 보낼 자동 답장. */
interface DmKeywordReply {
  id: string;
  name: string;
  enabled: boolean;
  keywords: string[];
  message: string;
  buttons: DmMessageButton[];
  createdAt: string;
  updatedAt?: string;
}

/** DM 자체를 트리거로 쓰는 자동화 설정. */
interface DmDirectSettings {
  greeting: DmGreetingSettings;
  replies: DmKeywordReply[];
}

interface DmSettings {
  enabled: boolean;
  connected: boolean;
  igUserId: string;
  igAccountId: string;
  igUsername: string;
  accessToken?: string;
  tokenSource?: string;
  tokenExpiresAt?: string;
  automations: DmAutomationItem[];
  /** DM 창 첫 화면의 "자주 묻는 질문"(아이스브레이커). */
  faq?: DmFaqSettings;
  /** DM 수신을 트리거로 쓰는 자동화(첫 인사말 · 키워드 자동 답장). */
  direct?: DmDirectSettings;
  rules: unknown[];
  updatedAt?: string;
  /** 계정별 웹훅(`subscribed_apps`) 구독을 마친 시각. */
  webhookSubscribedAt?: string;
  /** 마지막으로 구독을 건 필드 목록. 목록이 바뀌면 한 번 더 구독한다. */
  webhookFields?: string;
  /**
   * 이 설정을 저장한 로그인 사용자 ID.
   *
   * 플랜 판정을 설정 화면과 발송기(웹훅)가 같은 기준으로 하도록 남긴다. 웹훅에는
   * 로그인 세션이 없어 사용자명으로만 조회했는데, 운영자 지급 멤버십이 다른
   * 사용자명으로 기록돼 있으면 "설정은 저장되는데 자동 발송만 막히는" 상태가 됐다.
   */
  ownerAuthUserId?: string;
}

const DEFAULT_SETTINGS: DmSettings = {
  enabled: false,
  connected: false,
  igUserId: "",
  igAccountId: "",
  igUsername: "",
  automations: [],
  faq: { enabled: false, items: [] },
  direct: {
    greeting: { enabled: false, message: "", buttons: [], onlyFirstContact: true },
    replies: [],
  },
  rules: [],
};

/** 설정 문서를 보관하는 블롭 스토어 이름. 발송기(instagram-webhook)와 같아야 한다. */
const STORE_NAME = "dm-automation";

const genId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** 저장을 거절해야 하는 잘못된 링크를 모아 두는 예외. */
class InvalidLinkError extends Error {
  constructor(message: string, readonly code: string = "INVALID_BUTTON_URL") {
    super(message);
  }
}

/** 링크를 정규화하고, 못 살리면 저장 자체를 실패시킨다. */
function requireLink(raw: string, where: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  const normalized = normalizeLinkUrl(value);
  if (!normalized) {
    throw new InvalidLinkError(
      `${where}의 링크 주소가 올바르지 않습니다: "${value.slice(0, 80)}" — https:// 로 시작하는 주소를 입력해 주세요.`,
    );
  }
  return normalized.slice(0, 1000);
}

/**
 * 카드 이미지 주소를 확인한다.
 *
 * 이 주소는 우리 화면이 아니라 인스타그램이 발송 시점에 직접 받아간다. 그래서
 * 화면에서만 열리는 값(상대 경로 · `blob:` · `data:`)이 저장되면, 설정은 정상으로
 * 보이는데 카드가 이미지 없이 도착하거나 메시지 전체가 거부된다. 저장 단계에서
 * 막아 두면 사용자가 원인을 화면에서 바로 안다.
 */
function requireImage(raw: string, where: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  const normalized = normalizeLinkUrl(value);
  if (!normalized) {
    throw new InvalidLinkError(
      `${where}의 이미지 주소가 올바르지 않습니다: "${value.slice(0, 80)}" — 이미지를 올리거나 https:// 로 시작하는 주소를 입력해 주세요.`,
      "INVALID_CARD_IMAGE",
    );
  }
  return normalized.slice(0, 1000);
}

/** 링크 버튼 목록을 정리한다(자동화·FAQ·인사말이 같은 규칙을 쓴다). */
function sanitizeButtons(raw: any, where: string): DmMessageButton[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 3)
    .map((b: any) => ({
      id: String(b?.id || genId("btn")),
      label: String(b?.label || "").slice(0, 30),
      url: requireLink(b?.url, where).slice(0, 500),
    }))
    .filter((b: DmMessageButton) => b.label || b.url);
}

function sanitizeAutomation(a: any): DmAutomationItem {
  const name = String(a?.name || "새 자동화").slice(0, 60);

  const buttons = sanitizeButtons(a?.buttons, `'${name}' 버튼`);

  const keywords: string[] = Array.isArray(a?.keywords)
    ? a.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 20)
    : [];

  const replies: string[] = Array.isArray(a?.replies)
    ? a.replies.map((r: any) => String(r).slice(0, 300)).filter(Boolean).slice(0, 10)
    : [];

  const mediaIds: string[] = Array.isArray(a?.mediaIds)
    ? a.mediaIds.map((m: any) => String(m).trim()).filter(Boolean).slice(0, 50)
    : [];

  const cards: DmCarouselCard[] = Array.isArray(a?.cards)
    ? a.cards
        .slice(0, 10)
        .map((c: any) => ({
          id: String(c?.id || genId("card")),
          title: String(c?.title || "").slice(0, 80),
          subtitle: String(c?.subtitle || "").slice(0, 80),
          imageUrl: requireImage(c?.imageUrl, `'${name}' 카드`),
          buttonLabel: String(c?.buttonLabel || "").slice(0, 20),
          buttonUrl: requireLink(c?.buttonUrl, `'${name}' 카드 버튼`),
        }))
        .filter((c: DmCarouselCard) => c.title || c.imageUrl || c.buttonUrl)
    : [];

  const mediaScope = a?.mediaScope === "selected" && mediaIds.length > 0 ? "selected" : "all";
  const messageType = a?.messageType === "carousel" ? "carousel" : "text";

  /**
   * 예약 발송 시각.
   *
   * 해석할 수 없는 값이면 예약이 아니라 즉시 발송으로 되돌린다 — 시각을 못 읽는
   * 예약을 그대로 두면 "예약으로 설정했는데 아무것도 나가지 않는다"가 된다.
   * 지난 시각은 지우지 않는다. 발송기와 웹훅이 "이미 지난 예약은 즉시 발송"으로
   * 다루므로 동작에는 문제가 없고, 사용자가 화면에서 자기가 넣은 값을 그대로
   * 다시 볼 수 있어야 한다.
   */
  const scheduledMs = Date.parse(String(a?.scheduledAt || ""));
  const scheduled = a?.sendMode === "scheduled" && !Number.isNaN(scheduledMs);

  return {
    id: String(a?.id || genId("auto")),
    name,
    enabled: a?.enabled !== false,
    commentMatch: a?.commentMatch === "keyword" ? "keyword" : "all",
    keywords,
    replyEnabled: Boolean(a?.replyEnabled),
    replies,
    followFilter:
      a?.followFilter === "followers" || a?.followFilter === "non_followers"
        ? a.followFilter
        : "all",
    mediaScope,
    mediaIds,
    messageType,
    message: String(a?.message || "").slice(0, 1000),
    cardIntro: String(a?.cardIntro || "").slice(0, 1000),
    buttons,
    cards,
    sendMode: scheduled ? "scheduled" : "instant",
    scheduledAt: scheduled ? new Date(scheduledMs).toISOString() : "",
    createdAt: String(a?.createdAt || new Date().toISOString()),
    updatedAt: a?.updatedAt ? String(a.updatedAt) : undefined,
  };
}

/**
 * "자주 묻는 질문" 설정을 정리한다.
 *
 * 개수 상한(4개)은 인스타그램이 정한 값이라 우리가 늘릴 수 없다. 넘겨받은 목록을
 * 잘라내는 대신 오류로 되돌려주지는 않는다 — 화면에서 이미 4개로 막고 있고, 여기서
 * 저장 자체를 실패시키면 5번째 항목을 지우기 전까지 아무 수정도 저장하지 못한다.
 */
function sanitizeFaq(raw: any): DmFaqSettings {
  const items: DmFaqItem[] = Array.isArray(raw?.items)
    ? raw.items
        .slice(0, ICE_BREAKER_MAX)
        .map((f: any) => ({
          id: String(f?.id || genId("faq")),
          question: String(f?.question || "").trim().slice(0, ICE_BREAKER_QUESTION_MAX),
          answer: String(f?.answer || "").slice(0, 1000),
          buttons: sanitizeButtons(f?.buttons, "자주 묻는 질문 버튼"),
        }))
        // 질문과 답변이 모두 있어야 의미가 있다. 질문만 등록하면 버튼을 눌러도
        // 아무 답이 없고, 답변만 있으면 버튼 자체가 만들어지지 않는다.
        .filter((f: DmFaqItem) => f.question && (f.answer.trim() || f.buttons.length > 0))
    : [];
  return { enabled: Boolean(raw?.enabled), items };
}

/** DM 트리거 설정(인사말 · 키워드 자동 답장)을 정리한다. */
function sanitizeDirect(raw: any): DmDirectSettings {
  const g = raw?.greeting || {};
  const greeting: DmGreetingSettings = {
    enabled: Boolean(g?.enabled),
    message: String(g?.message || "").slice(0, 1000),
    buttons: sanitizeButtons(g?.buttons, "인사말 버튼"),
    onlyFirstContact: g?.onlyFirstContact !== false,
  };

  const replies: DmKeywordReply[] = Array.isArray(raw?.replies)
    ? raw.replies.slice(0, 20).map((r: any) => {
        const name = String(r?.name || "키워드 답장").slice(0, 60);
        return {
          id: String(r?.id || genId("kw")),
          name,
          enabled: r?.enabled !== false,
          keywords: Array.isArray(r?.keywords)
            ? r.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 20)
            : [],
          message: String(r?.message || "").slice(0, 1000),
          buttons: sanitizeButtons(r?.buttons, `'${name}' 버튼`),
          createdAt: String(r?.createdAt || new Date().toISOString()),
          updatedAt: r?.updatedAt ? String(r.updatedAt) : undefined,
        };
      })
    : [];

  return { greeting, replies };
}

/**
 * 내용 비교용 지문. 저장 시점에 붙는 시각 필드는 제외한다 — 같은 내용을 다시
 * 저장했다는 이유로 "최근에 설정한 자동화"가 뒤바뀌면 안 된다.
 */
function contentSignature(a: DmAutomationItem): string {
  const { updatedAt: _u, createdAt: _c, ...rest } = a;
  return JSON.stringify(rest);
}

/** 내용이 실제로 바뀐 자동화에만 변경 시각을 새로 찍는다. */
function stampUpdatedAt(
  next: DmAutomationItem,
  prev: DmAutomationItem | undefined,
  now: string,
): DmAutomationItem {
  if (prev && contentSignature(prev) === contentSignature(next)) {
    return { ...next, updatedAt: prev.updatedAt || prev.createdAt };
  }
  return { ...next, updatedAt: now };
}

/**
 * 요청이 들고 온 자동화 한 건.
 *
 * `enabled` 를 명시했는지 따로 기억한다. sanitizeAutomation 은 값이 없으면 켜짐으로
 * 보는데(새로 만드는 자동화의 기본값), 그 규칙을 수정 요청에도 그대로 적용하면
 * 필드를 싣지 않은 요청 한 번이 꺼 둔 자동화를 되살린다. 저장돼 있던 상태를 그대로
 * 두는 쪽이 안전하다 — 켜는 건 사용자가 스위치를 눌렀을 때만 일어나야 한다.
 */
interface IncomingAutomation {
  item: DmAutomationItem;
  enabledExplicit: boolean;
}

function readIncoming(a: any): IncomingAutomation {
  return { item: sanitizeAutomation(a), enabledExplicit: typeof a?.enabled === "boolean" };
}

/** 요청이 켜짐/꺼짐을 말하지 않았으면 저장본의 값을 유지한다. */
function resolveEnabled(
  incoming: IncomingAutomation,
  prev: DmAutomationItem | undefined,
): DmAutomationItem {
  if (incoming.enabledExplicit || !prev) return incoming.item;
  return { ...incoming.item, enabled: prev.enabled };
}

/** 저장된 목록에 자동화 한 건을 끼워 넣거나 갈아끼운다. */
function upsertOne(
  existing: DmAutomationItem[],
  incoming: IncomingAutomation,
  now: string,
): DmAutomationItem[] {
  const prev = existing.find((a) => a.id === incoming.item.id);
  const stamped = stampUpdatedAt(resolveEnabled(incoming, prev), prev, now);
  return prev
    ? existing.map((a) => (a.id === incoming.item.id ? stamped : a))
    : [...existing, stamped];
}

/** 목록 전체를 갈아끼운다(구버전 클라이언트 호환). 변경된 항목만 시각을 새로 찍는다. */
function replaceAll(
  existing: DmAutomationItem[],
  incoming: IncomingAutomation[],
  now: string,
): DmAutomationItem[] {
  const prevById = new Map(existing.map((a) => [a.id, a]));
  return incoming.map((entry) => {
    const prev = prevById.get(entry.item.id);
    return stampUpdatedAt(resolveEnabled(entry, prev), prev, now);
  });
}

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 본인(또는 관리자)만 자기 자동화를 보고 고칠 수 있다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  // 자동화 편집 직후 댓글이 달려도 웹훅이 이전 문구를 읽지 않도록 최신 설정을 보장한다.
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const key = `dm_${username}`;

  if (req.method === "GET") {
    const data = ((await store.get(key, { type: "json" })) as DmSettings) || DEFAULT_SETTINGS;
    const { accessToken, ownerAuthUserId, ...safe } = data;
    return Response.json({
      ...DEFAULT_SETTINGS,
      ...safe,
      automations: Array.isArray(data.automations) ? data.automations : [],
      // 예전에 저장된 문서에는 이 두 블록이 없다. 화면이 `undefined` 를 만나
      // 빈 화면을 그리지 않도록 기본값으로 채워 내려준다.
      faq: { ...DEFAULT_SETTINGS.faq!, ...(data.faq || {}) },
      direct: {
        greeting: { ...DEFAULT_SETTINGS.direct!.greeting, ...(data.direct?.greeting || {}) },
        replies: Array.isArray(data.direct?.replies) ? data.direct!.replies : [],
      },
      /** 아이스브레이커·DM 트리거를 받을 수 있는 웹훅 필드가 구독돼 있는지. */
      postbackSubscribed: String(data.webhookFields || "").includes("messaging_postbacks"),
      messagesSubscribed: String(data.webhookFields || "").includes("messages"),
      connected: Boolean(accessToken) && Boolean(data.igUserId || data.igAccountId),
      hasAccessToken: Boolean(accessToken),
      /**
       * 발신 에코(`message_echoes`) 구독 여부. 구독돼 있지 않으면 이 앱을 거치지
       * 않고 나간 자동 DM 을 감지할 수 없으므로, 화면에서 그 한계를 알려준다.
       */
      echoSubscribed: String(data.webhookFields || "").includes("message_echoes"),
      // 이 앱이 보내지 않은 자동 DM(인스타그램 자체 자동 메시지·다른 자동화 서비스)이
      // 감지됐다면 함께 내려준다. 화면에서 "왜 설정과 다른 문구가 오는지" 안내한다.
      externalDm: await readForeignDm(username),
      // 디엠 자동화는 프로 플랜 전용이다. 화면에서 업그레이드 안내를 띄울 수 있게 함께 내려준다.
      entitled: await dmAutomationAllowed(username, auth.userId),
      requiredTier: DM_AUTOMATION_TIER,
    });
  }

  if (req.method === "POST") {
    const body = (await req.json()) as any;
    const now = new Date().toISOString();

    // 연동 해제
    if (body?.action === "disconnect") {
      let staleIgIds: string[] = [];
      await mutateBlobJSON<DmSettings>(STORE_NAME, key, (current) => {
        const existing = { ...DEFAULT_SETTINGS, ...(current || {}) };
        staleIgIds = Array.from(
          new Set([existing.igUserId, existing.igAccountId].filter(Boolean) as string[]),
        );
        return {
          ...existing,
          enabled: false,
          connected: false,
          igUserId: "",
          igAccountId: "",
          igUsername: "",
          accessToken: "",
          tokenSource: undefined,
          tokenExpiresAt: undefined,
          // 재연동 시 웹훅 구독을 다시 걸도록 플래그도 비운다.
          webhookSubscribedAt: undefined,
          automations: Array.isArray(existing.automations) ? existing.automations : [],
          rules: Array.isArray(existing.rules) ? existing.rules : [],
          updatedAt: now,
        };
      });
      // 웹훅 역인덱스(ig_<계정ID> → 사용자명)도 함께 비운다. 남겨두면 연동을 끊은 뒤에도
      // 이벤트가 들어올 때마다 설정을 읽어보는 헛일이 계속된다.
      if (staleIgIds.length > 0) {
        try {
          const index = getStore({ name: "dm-automation-index", consistency: "strong" });
          await Promise.all(staleIgIds.map((id) => index.delete(`ig_${id}`)));
        } catch (e) {
          console.warn("[dm-automation] index cleanup failed:", (e as Error)?.message);
        }
      }
      return Response.json({ success: true, connected: false });
    }

    // 외부 자동 DM 안내 확인 — 사용자가 안내를 읽고 닫으면 기록을 지운다.
    // (연동 해제와 마찬가지로 플랜과 무관하게 처리한다.)
    if (body?.action === "dismissExternalDm") {
      await clearForeignDm(username);
      return Response.json({ success: true, externalDm: null });
    }

    // 자동화 저장/켜기는 프로 플랜에서만 가능하다. (연동 해제는 위에서 이미 처리 — 플랜과
    // 무관하게 언제든 계정을 끊을 수 있어야 한다.)
    if (!(await dmAutomationAllowed(username, auth.userId))) {
      return Response.json(
        {
          error: DM_AUTOMATION_REQUIRED_MESSAGE,
          code: "DM_AUTOMATION_PLAN_REQUIRED",
          requiredTier: DM_AUTOMATION_TIER,
        },
        { status: 403 },
      );
    }

    /**
     * "자주 묻는 질문"(아이스브레이커) 저장.
     *
     * 우리 블롭에만 저장하면 DM 창에는 아무것도 보이지 않는다. 이 값은 인스타그램
     * 프로필에 등록되는 것이라 저장할 때마다 Graph API 로 밀어 넣어야 한다. 등록
     * 결과(성공 시각 / 실패 이유)를 문서에 함께 남겨 화면에서 상태를 그대로 보여준다
     * — 실패를 조용히 넘기면 사용자는 "저장했는데 버튼이 없다"의 이유를 알 수 없다.
     *
     * 저장 순서가 중요하다. 먼저 문서에 쓰고(사용자가 입력한 내용은 무슨 일이
     * 있어도 잃지 않는다), 그다음 인스타그램에 등록한다.
     */
    if (body?.action === "saveFaq") {
      let faq: DmFaqSettings;
      try {
        faq = sanitizeFaq(body?.faq);
      } catch (e) {
        if (e instanceof InvalidLinkError) {
          return Response.json({ error: e.message, code: e.code }, { status: 400 });
        }
        throw e;
      }

      let stored: DmSettings | null;
      try {
        stored = await mutateBlobJSON<DmSettings>(STORE_NAME, key, (current) => {
          const existing = { ...DEFAULT_SETTINGS, ...(current || {}) };
          return {
            ...existing,
            // 등록 결과는 아래에서 다시 찍는다. 지금은 "아직 반영되지 않았다"로 둔다.
            faq: { ...faq, syncedAt: undefined, syncError: undefined },
            ownerAuthUserId: !auth.isAdmin && auth.userId ? auth.userId : existing.ownerAuthUserId,
            updatedAt: now,
          };
        });
      } catch (e) {
        if (e instanceof BlobWriteConflictError) {
          return Response.json(
            {
              error: "다른 저장이 동시에 진행돼 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
              code: "SAVE_CONFLICT",
            },
            { status: 409 },
          );
        }
        throw e;
      }

      const current = { ...DEFAULT_SETTINGS, ...(stored || {}) };
      if (!current.accessToken) {
        return Response.json({
          success: true,
          faq: current.faq,
          warning: "인스타그램 계정을 연동하면 DM 창에 질문 버튼이 표시됩니다.",
        });
      }

      /**
       * 전체 자동 발송 스위치가 꺼져 있으면 인스타그램에 올리지 않는다(올라가 있던
       * 것은 내린다).
       *
       * 웹훅은 버튼 클릭(postback)을 처리하기 전에 이 스위치를 먼저 보므로, 스위치가
       * 꺼진 채 버튼만 등록해 두면 눌러도 아무 답변이 나가지 않는 버튼이 DM 창에
       * 남는다. 화면 안내도 "스위치를 끄면 질문 버튼도 함께 내려간다"고 약속하고
       * 있다.
       */
      const switchOff = !current.enabled;
      const active = current.enabled && faq.enabled ? faq.items : [];
      const sync = active.length > 0
        ? await syncIceBreakers({
            accessToken: current.accessToken,
            tokenSource: current.tokenSource,
            igId: current.igUserId || current.igAccountId,
            entries: active.map((f) => ({ question: f.question, payload: faqPayload(f.id) })),
          })
        : await clearIceBreakers({
            accessToken: current.accessToken,
            tokenSource: current.tokenSource,
            igId: current.igUserId || current.igAccountId,
          });

      // 아무것도 등록하지 않았다면 "등록했다"고 표시하지 않는다.
      const syncedAt = sync.ok && active.length > 0 ? new Date().toISOString() : undefined;
      const syncError = sync.ok ? undefined : sync.error || "인스타그램에 등록하지 못했습니다.";
      await mutateBlobJSON<DmSettings>(STORE_NAME, key, (doc) =>
        doc ? { ...doc, faq: { ...faq, syncedAt, syncError } } : null,
      ).catch((e) => console.warn("[dm-automation] faq sync flag save failed:", (e as Error)?.message));

      /**
       * 질문 버튼을 눌렀을 때 오는 postback 이벤트를 받으려면 계정별 웹훅에
       * `messaging_postbacks` 가 들어 있어야 한다. 예전에 연동한 계정은 이 필드가
       * 없어서, 버튼은 보이는데 눌러도 답변이 나가지 않는다. 여기서 한 번 더 건다.
       */
      let webhookWarning = "";
      if (!String(current.webhookFields || "").includes("messaging_postbacks")) {
        const sub = await subscribeInstagramWebhooks({
          accessToken: current.accessToken,
          tokenSource: current.tokenSource,
          igId: current.igUserId || current.igAccountId,
        });
        if (sub.ok) {
          const achieved = sub.fields || WEBHOOK_FIELDS;
          await mutateBlobJSON<DmSettings>(STORE_NAME, key, (doc) =>
            doc
              ? { ...doc, webhookSubscribedAt: new Date().toISOString(), webhookFields: achieved }
              : null,
          ).catch(() => undefined);
          /**
           * 구독은 성공했지만 postback 필드가 빠진 경우(계정 연동 방식·앱 권한에
           * 따라 거절된다). 조용히 넘기면 "버튼은 등록됐는데 눌러도 답이 없다"의
           * 원인을 화면에서 알 수 없다.
           */
          if (!achieved.includes("messaging_postbacks")) {
            webhookWarning =
              "질문 버튼 클릭을 받을 웹훅(messaging_postbacks)을 인스타그램이 허용하지 않았습니다. " +
              "버튼은 보이지만 눌렀을 때 답변이 나가지 않을 수 있어요. 계정을 다시 연동해 주세요.";
          }
        } else {
          webhookWarning = `질문 버튼 클릭을 받을 웹훅을 연결하지 못했습니다: ${sub.error || "알 수 없는 오류"}`;
        }
      }

      const warning =
        [
          switchOff && faq.enabled && faq.items.length > 0
            ? "자동 발송 스위치가 꺼져 있어 질문 버튼을 DM 창에 올리지 않았습니다. 스위치를 켜면 함께 올라갑니다."
            : "",
          webhookWarning,
        ]
          .filter(Boolean)
          .join(" ") || undefined;

      return Response.json({
        success: sync.ok,
        faq: { ...faq, syncedAt, syncError },
        error: syncError,
        warning,
      });
    }

    /**
     * DM 트리거 자동화(첫 인사말 · 키워드 자동 답장) 저장.
     *
     * 댓글 자동화와 달리 인스타그램에 등록할 것이 없다. 다만 받은 메시지를 트리거로
     * 쓰기 때문에 `messages` 웹훅 구독이 반드시 있어야 하고, 예전에 연동한 계정은
     * 그 구독이 없을 수 있어 저장할 때 한 번 확인한다.
     */
    if (body?.action === "saveDmTriggers") {
      let direct: DmDirectSettings;
      try {
        direct = sanitizeDirect(body?.direct);
      } catch (e) {
        if (e instanceof InvalidLinkError) {
          return Response.json({ error: e.message, code: e.code }, { status: 400 });
        }
        throw e;
      }

      let stored: DmSettings | null;
      try {
        stored = await mutateBlobJSON<DmSettings>(STORE_NAME, key, (current) => {
          const existing = { ...DEFAULT_SETTINGS, ...(current || {}) };
          return {
            ...existing,
            direct,
            ownerAuthUserId: !auth.isAdmin && auth.userId ? auth.userId : existing.ownerAuthUserId,
            updatedAt: now,
          };
        });
      } catch (e) {
        if (e instanceof BlobWriteConflictError) {
          return Response.json(
            {
              error: "다른 저장이 동시에 진행돼 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
              code: "SAVE_CONFLICT",
            },
            { status: 409 },
          );
        }
        throw e;
      }

      const current = { ...DEFAULT_SETTINGS, ...(stored || {}) };
      let webhookFields = current.webhookFields;
      if (current.accessToken && !String(webhookFields || "").includes("messages")) {
        const sub = await subscribeInstagramWebhooks({
          accessToken: current.accessToken,
          tokenSource: current.tokenSource,
          igId: current.igUserId || current.igAccountId,
        });
        if (sub.ok) {
          webhookFields = sub.fields || WEBHOOK_FIELDS;
          const subscribedAt = new Date().toISOString();
          await mutateBlobJSON<DmSettings>(STORE_NAME, key, (doc) =>
            doc ? { ...doc, webhookSubscribedAt: subscribedAt, webhookFields } : null,
          ).catch(() => undefined);
        }
      }

      return Response.json({ success: true, direct, webhookFields });
    }

    /**
     * 계정별 웹훅 구독을 다시 건다(자동 발송이 안 될 때의 자기 수리 버튼).
     *
     * 댓글 이벤트는 Meta 앱의 웹훅 등록과 **계정별 `subscribed_apps` 구독**이 둘 다
     * 있어야 도착한다. 계정 구독은 토큰 재발급·권한 변경 등으로 조용히 풀릴 수 있고,
     * 그러면 화면상 자동 발송은 켜져 있는데 댓글에 아무 일도 일어나지 않는다. 그때
     * 사용자가 직접 다시 걸 수 있어야 한다(예전에는 자동화를 저장할 때 한 번만
     * 시도하고, 성공 기록이 남아 있으면 다시 시도하지 않았다).
     */
    if (body?.action === "resubscribeWebhook") {
      const current = ((await store.get(key, { type: "json" })) as DmSettings) || DEFAULT_SETTINGS;
      if (!current.accessToken) {
        return Response.json(
          { success: false, error: "인스타그램 계정을 먼저 연동해 주세요.", code: "NOT_CONNECTED" },
          { status: 200 },
        );
      }

      const sub = await subscribeInstagramWebhooks({
        accessToken: current.accessToken,
        tokenSource: current.tokenSource,
        igId: current.igUserId || current.igAccountId,
      });

      if (!sub.ok) {
        return Response.json(
          {
            success: false,
            error:
              `웹훅 구독에 실패했습니다. (${sub.error || "알 수 없는 오류"}) ` +
              `계정을 다시 연동하면 해결되는 경우가 많습니다.`,
            code: "WEBHOOK_SUBSCRIBE_FAILED",
          },
          { status: 200 },
        );
      }

      const subscribedAt = new Date().toISOString();
      const achieved = sub.fields || WEBHOOK_FIELDS;
      await mutateBlobJSON<DmSettings>(STORE_NAME, key, (stored) =>
        stored ? { ...stored, webhookSubscribedAt: subscribedAt, webhookFields: achieved } : null,
      ).catch((e) => console.warn("[dm-automation] webhook flag save failed:", (e as Error)?.message));
      // 역인덱스도 함께 채운다 — 이벤트가 도착해도 주인을 못 찾으면 그대로 버려진다.
      await indexDmAccount(username, [current.igUserId, current.igAccountId]);

      return Response.json({
        success: true,
        webhookSubscribedAt: subscribedAt,
        webhookFields: achieved,
        echoSubscribed: achieved.includes("message_echoes"),
      });
    }

    /**
     * 요청 종류를 먼저 해석한다.
     *
     * - upsertAutomation : 편집 화면이 방금 고친 자동화 한 건만 보낸다(권장 경로).
     *   목록 전체를 보내지 않으므로, 다른 자동화를 동시에 고쳐도 서로의 변경을
     *   되돌리지 않는다.
     * - deleteAutomation : 자동화 한 건 삭제.
     * - automations      : 목록 전체 교체(구버전 클라이언트 호환).
     * - 그 외            : enabled/rules 같은 설정만 갱신.
     *
     * 링크 정규화는 저장 전에 끝내야 한다. 잘못된 링크는 400 으로 되돌려주고
     * 문서는 손대지 않는다.
     */
    let op:
      | { kind: "upsert"; incoming: IncomingAutomation }
      | { kind: "delete"; id: string }
      | { kind: "replace"; incoming: IncomingAutomation[] }
      | { kind: "settings" };
    try {
      if (body?.action === "upsertAutomation" || body?.automation) {
        const raw = body?.automation ?? body?.item;
        if (!raw || typeof raw !== "object") {
          return Response.json({ error: "automation 이 필요합니다." }, { status: 400 });
        }
        op = { kind: "upsert", incoming: readIncoming(raw) };
      } else if (body?.action === "deleteAutomation") {
        const id = String(body?.id || body?.automationId || "").trim();
        if (!id) return Response.json({ error: "삭제할 자동화 id 가 필요합니다." }, { status: 400 });
        op = { kind: "delete", id };
      } else if (Array.isArray(body?.automations)) {
        op = { kind: "replace", incoming: body.automations.map(readIncoming) };
      } else {
        op = { kind: "settings" };
      }
    } catch (e) {
      if (e instanceof InvalidLinkError) {
        // 잘못된 링크·이미지는 발송 때 조용히 빠지므로, 저장 단계에서 되돌려준다.
        return Response.json({ error: e.message, code: e.code }, { status: 400 });
      }
      throw e;
    }

    let saved: DmSettings | null;
    /**
     * 요청이 들고 온 자동화가 저장본보다 오래된 버전이면 쓰지 않고 되돌려준다.
     *
     * (다른 탭·다른 기기에서 먼저 고친 경우다. 그대로 쓰면 그쪽 수정이 사라지고,
     * 사용자는 "설정한 문구가 아닌 예전 문구가 나간다"를 다시 겪는다.)
     */
    let staleWrite = false;
    try {
      saved = await mutateBlobJSON<DmSettings>(STORE_NAME, key, (current) => {
        const existing = { ...DEFAULT_SETTINGS, ...(current || {}) };
        const stored: DmAutomationItem[] = Array.isArray(existing.automations)
          ? existing.automations
          : [];

        if (op.kind === "upsert") {
          const prev = stored.find((a) => a.id === op.incoming.item.id);
          const baseAt = Date.parse(op.incoming.item.updatedAt || "");
          const storedAt = Date.parse(prev?.updatedAt || "");
          if (prev && !Number.isNaN(baseAt) && !Number.isNaN(storedAt) && baseAt < storedAt) {
            staleWrite = true;
            return null;
          }
        }

        let automations = stored;
        if (op.kind === "upsert") automations = upsertOne(stored, op.incoming, now);
        else if (op.kind === "delete") automations = stored.filter((a) => a.id !== op.id);
        else if (op.kind === "replace") automations = replaceAll(stored, op.incoming, now);

        /**
         * 전체 스위치는 "자동 발송" 토글이 보낸 요청에서만 켠다.
         *
         * 예전 화면(그리고 브라우저에 캐시된 옛 번들)은 자동화를 저장하면서
         * `enabled: true` 를 함께 실어 보냈다. 그래서 자동 발송을 일부러 꺼 둔
         * 사람이 문구를 다듬거나 자동화 하나를 켜기만 해도 전체 스위치가 조용히
         * 다시 켜졌고, 다음 댓글에 예전에 설정해 둔 메시지가 나갔다. 끄는 요청은
         * 언제나 받아들이고, 켜는 요청은 자동화 저장에 곁들여 온 것이면 무시한다.
         */
        const wanted = typeof body.enabled === "boolean" ? body.enabled : null;
        const enabled =
          wanted === null || (wanted === true && op.kind !== "settings")
            ? existing.enabled
            : wanted;

        return {
          ...existing,
          enabled,
          automations,
          /**
           * 소유자 ID 는 본인이 저장할 때만 채운다. 관리자가 대신 저장한 경우
           * 관리자 ID 가 들어가면 발송기의 플랜 판정이 엉뚱한 사람을 조회한다.
           */
          ownerAuthUserId:
            !auth.isAdmin && auth.userId ? auth.userId : existing.ownerAuthUserId,
          // 구버전 rules 는 전달되면 갱신, 아니면 유지
          rules: Array.isArray(body.rules) ? body.rules : existing.rules || [],
          updatedAt: now,
        };
      });
    } catch (e) {
      if (e instanceof BlobWriteConflictError) {
        // 같은 계정에서 저장이 계속 겹치는 아주 드문 경우. 아무것도 쓰지 않았으니
        // 화면에서 다시 시도하게 안내한다(조용히 성공으로 넘기면 예전 설정이 남는다).
        console.warn("[dm-automation] save conflict:", (e as Error)?.message);
        return Response.json(
          {
            error: "다른 저장이 동시에 진행돼 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            code: "SAVE_CONFLICT",
          },
          { status: 409 },
        );
      }
      throw e;
    }

    const next: DmSettings = { ...DEFAULT_SETTINGS, ...(saved || {}) };

    if (staleWrite) {
      // 저장본이 더 최신이다. 화면이 최신 목록으로 맞출 수 있게 함께 돌려준다.
      return Response.json(
        {
          error:
            "이 자동화가 다른 곳(다른 탭·기기)에서 먼저 수정됐습니다. 최신 설정을 불러왔으니 확인한 뒤 다시 저장해 주세요.",
          code: "STALE_AUTOMATION",
          automations: Array.isArray(next.automations) ? next.automations : [],
        },
        { status: 409 },
      );
    }

    /**
     * 웹훅 역인덱스(ig_<계정ID> → 사용자명)를 저장할 때마다 채워 둔다.
     *
     * 예전에는 OAuth 콜백에서 한 번만 기록했다. 그 코드가 없던 시절에 연동한 계정은
     * 인덱스가 비어 있어, 댓글 이벤트가 도착해도 주인을 찾지 못해 조용히 버려졌다
     * (자동 발송만 안 되고 수동 발송은 되는 상태의 원인 중 하나다).
     */
    if (next.igUserId || next.igAccountId) {
      await indexDmAccount(username, [next.igUserId, next.igAccountId]).catch((e) =>
        console.warn("[dm-automation] index refresh failed:", (e as Error)?.message),
      );
    }

    // 이미 연동돼 있던 계정은 OAuth 콜백을 다시 거치지 않으므로, 자동화를 저장하는
    // 시점에 한 번 계정별 웹훅 구독을 채워준다. 구독이 없으면 댓글 이벤트가 도착하지
    // 않아 자동 DM·자동 답글이 트리거되지 않는다. 성공하면 시각을 기록해 매번
    // 호출하지 않는다.
    //
    // 구독 필드 목록이 바뀌었을 때도 한 번 더 건다. 예전에 연동한 계정은 발신 메시지
    // 에코를 구독하지 않은 상태라, 이 앱을 거치지 않고 나간 자동 DM 을 감지하지 못한다.
    if (next.accessToken && (!next.webhookSubscribedAt || next.webhookFields !== WEBHOOK_FIELDS)) {
      const sub = await subscribeInstagramWebhooks({
        accessToken: next.accessToken,
        tokenSource: next.tokenSource,
        igId: next.igUserId || next.igAccountId,
      });
      if (sub.ok) {
        const subscribedAt = new Date().toISOString();
        const achieved = sub.fields || WEBHOOK_FIELDS;
        next.webhookSubscribedAt = subscribedAt;
        /**
         * 실제로 구독에 성공한 목록을 기록한다.
         *
         * 예전에는 시도한 목록(WEBHOOK_FIELDS)을 그대로 찍었다. 그래서 에코 필드가
         * 거절돼 `comments,messages` 로 내려앉은 계정도 "최신 목록으로 구독 완료"로
         * 표시됐고, 다시 구독을 걸어보는 일이 영영 없었다. 발신 에코를 못 받으면
         * 이 앱을 거치지 않고 나간 자동 DM 을 감지할 수 없어, 사용자는 예전 문구가
         * 어디서 오는지 확인할 방법이 없다.
         */
        next.webhookFields = achieved;
        await mutateBlobJSON<DmSettings>(STORE_NAME, key, (current) =>
          current
            ? { ...current, webhookSubscribedAt: subscribedAt, webhookFields: achieved }
            : null,
        ).catch((e) => console.warn("[dm-automation] webhook flag save failed:", (e as Error)?.message));
      } else {
        console.warn("[dm-automation] webhook subscribe failed:", sub.error);
      }
    }

    /**
     * 전체 스위치를 끄면 DM 창의 "자주 묻는 질문" 버튼도 함께 내린다(다시 켜면 올린다).
     *
     * 이 버튼은 우리 서버가 아니라 인스타그램 프로필에 등록돼 있어서, 스위치를 껐다고
     * 사라지지 않는다. 그대로 두면 상대 DM 창에는 버튼이 보이는데 눌러도 아무 답이
     * 오지 않는다 — 받는 사람에게는 그냥 고장난 계정이다.
     */
    if (op.kind === "settings" && typeof body.enabled === "boolean" && next.accessToken) {
      const faq = next.faq;
      if (faq?.enabled && (faq.items || []).length > 0) {
        const sync = next.enabled
          ? await syncIceBreakers({
              accessToken: next.accessToken,
              tokenSource: next.tokenSource,
              igId: next.igUserId || next.igAccountId,
              entries: faq.items.map((f) => ({ question: f.question, payload: faqPayload(f.id) })),
            })
          : await clearIceBreakers({
              accessToken: next.accessToken,
              tokenSource: next.tokenSource,
              igId: next.igUserId || next.igAccountId,
            });
        const syncedAt = sync.ok && next.enabled ? new Date().toISOString() : undefined;
        const syncError = sync.ok ? undefined : sync.error;
        next.faq = { ...faq, syncedAt, syncError };
        await mutateBlobJSON<DmSettings>(STORE_NAME, key, (doc) =>
          doc ? { ...doc, faq: { ...faq, syncedAt, syncError } } : null,
        ).catch((e) =>
          console.warn("[dm-automation] faq toggle sync save failed:", (e as Error)?.message),
        );
      }
    }

    // 저장된 목록을 그대로 돌려준다. 화면이 이 응답으로 상태를 맞추면, 실제로
    // 발송에 쓰일 내용과 화면에 보이는 내용이 어긋나지 않는다.
    return Response.json({
      success: true,
      connected: Boolean(next.accessToken) && Boolean(next.igUserId || next.igAccountId),
      enabled: next.enabled,
      automations: Array.isArray(next.automations) ? next.automations : [],
      faq: next.faq,
      direct: next.direct,
      updatedAt: next.updatedAt,
    });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/dm-automation/:username",
};
