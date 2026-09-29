/**
 * 인스타그램 DM 메시지 페이로드 빌더 / 발송기.
 *
 * 인스타그램 메시징은 메신저(페이스북)와 달리 버튼 템플릿
 * (`template_type: "button"`)을 지원하지 않는다. 지원되는 구조화 메시지는
 * 제네릭 템플릿과 상품 템플릿뿐이라, 버튼 템플릿을 보내면 링크 버튼이 빠진
 * 본문만 도착하거나 요청 자체가 거부된다. 그래서 링크 버튼은 항상 제네릭
 * 템플릿 카드에 담아 보낸다.
 *
 * 제네릭 템플릿의 title/subtitle 은 각각 80자 제한이라 긴 본문은 카드에 담을
 * 수 없다. 이 경우 본문을 일반 텍스트로 먼저 보내고, 링크 버튼만 담은 카드를
 * 이어서 보낸다(메시지 2건). 짧은 본문은 카드 하나에 본문+버튼을 함께 담아
 * 한 개의 버블로 도착한다.
 *
 * ── 댓글 비공개 답장은 "한 통"이 전부다 ──
 * 댓글에 대한 자동 DM 은 `recipient: { comment_id }` 로 보내는데, 인스타그램은
 * 댓글 1건당 비공개 답장을 **1통만** 허용하고 댓글 자체는 대화창(메시징 윈도우)을
 * 열어주지 않는다. 즉 상대가 먼저 DM 을 보낸 적이 없다면 두 번째 메시지는
 * IGSID 로도 보낼 수 없다. 그래서 메시지가 2건인 설정(인사말 + 캐러셀)을 순서대로
 * 보내면 첫 통만 도착한다 — 인사말을 먼저 보내면 "텍스트만 오고 캐러셀은 안 오는"
 * 상태가 된다. 이 파일의 `buildCommentDmPlan` 은 그 한 통에 가장 중요한 내용
 * (캐러셀 카드)을 담고, 인사말은 대화창이 이미 열려 있을 때만 도착하는 부가
 * 메시지로 뒤에 붙인다.
 *
 * 참고: 제네릭 템플릿은 인스타그램 모바일 앱에서만 렌더링되고 웹 버전
 * (instagram.com)의 DM 화면에서는 표시되지 않는다.
 */

import { finishDmSend, reserveDmSend, retryAfterMs } from "./dm-send-budget.mts";
import { checkWorkerLease } from "./dm-worker.mts";

export interface DmButton {
  label: string;
  url: string;
}

export interface DmCard {
  title: string;
  subtitle: string;
  imageUrl: string;
  buttonLabel: string;
  buttonUrl: string;
  /**
   * 카드 버튼 목록(최대 3개). 있으면 이 목록을 쓰고, 없으면(예전에 저장된 카드)
   * buttonLabel/buttonUrl 한 개를 버튼으로 쓴다. 첫 버튼은 buttonLabel/buttonUrl 에도
   * 같이 적혀 있다.
   */
  buttons?: DmButton[];
}

/** 카드 한 장에 달 수 있는 버튼 수(제네릭 템플릿 요소당 최대 3개). */
export const CARD_BUTTON_MAX = 3;

/** 카드에서 보낼 수 있는 버튼(라벨과 올바른 링크가 모두 있는 것)만 골라 낸다. */
export function cardButtons(c: DmCard): DmButton[] {
  const raw = Array.isArray(c.buttons) && c.buttons.length > 0
    ? c.buttons
    : [{ label: c.buttonLabel || "", url: c.buttonUrl || "" }];
  const out: DmButton[] = [];
  for (const b of raw) {
    const label = String(b?.label || "").trim();
    const url = normalizeLinkUrl(String(b?.url || ""));
    if (label && url) out.push({ label, url });
    if (out.length >= CARD_BUTTON_MAX) break;
  }
  return out;
}

export interface DmContent {
  messageType?: "text" | "carousel";
  message?: string;
  buttons?: DmButton[];
  cards?: DmCard[];
}

/** 제네릭 템플릿 카드 제목/부제목 길이 제한. */
const CARD_TEXT_MAX = 80;
/** 텍스트 메시지 길이 제한. */
const TEXT_MAX = 1000;
/** 버튼 라벨 길이 제한. */
const BUTTON_LABEL_MAX = 20;
/** 카드 최대 개수. */
const CARD_MAX = 10;
/** 카드당 버튼 최대 개수. */
const BUTTON_MAX = 3;
/** 본문이 길어 버튼만 별도 카드로 보낼 때 쓰는 카드 제목. */
const BUTTON_ONLY_CARD_TITLE = "👇 아래 버튼을 눌러주세요";
/**
 * 제목을 비워 둔 카드에 쓰는 대체 제목.
 *
 * 제네릭 템플릿은 title 이 필수다. 빈 문자열을 실으면 요소가 거부되고, 공백 한 칸도
 * 안전하지 않다. 이미지만 올린 카드를 살리기 위한 최소 문구다.
 */
const CARD_TITLE_FALLBACK = "자세히 보기";

function cleanLinkInput(raw: string): string {
  return String(raw || "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[：]/g, ":")
    .replace(/[／]/g, "/")
    .replace(/[．]/g, ".")
    .trim()
    .replace(/^[<>'\"“”‘’]+|[<>'\"“”‘’]+$/g, "")
    .trim();
}

/**
 * Graph API 는 http/https 절대 URL 만 web_url 버튼·카드 이미지로 받는다.
 *
 * 호스트 형태까지 본다. `/api/images/x` 같은 상대 경로에 스킴만 붙이면
 * `https://api/images/x` 로 파싱돼 형식 검사만으로는 통과하는데, 인스타그램
 * 서버는 그 주소를 찾아갈 수 없다. 이미지 한 장이 아니라 메시지 전체가 거부되므로
 * (카드·버튼까지 통째로 도착하지 않는다) 여기서 걸러야 한다.
 */
export function isValidLinkUrl(raw: string): boolean {
  try {
    const u = new URL(cleanLinkInput(raw));
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    // 점으로 구분된 공개 호스트명(example.com)만 허용한다. localhost·내부 호스트는
    // 인스타그램 쪽에서 접근할 수 없으니 저장 단계에서 막는 게 낫다.
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * 저장 시점에 링크를 정리한다.
 * - `example.com/abc` 처럼 스킴이 빠진 입력은 `https://` 를 붙여 살린다.
 * - 그래도 http/https 절대 URL 이 아니면 빈 문자열을 돌려준다. 호출부는 이걸
 *   보고 저장을 거절한다 — 발송 시점에 조용히 버려지면 사용자는 버튼이 왜
 *   안 보이는지 알 수 없다.
 */
export function normalizeLinkUrl(raw: string): string {
  const trimmed = cleanLinkInput(raw);
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) {
    const withScheme = `https:${trimmed}`;
    return isValidLinkUrl(withScheme) ? withScheme : "";
  }
  if (isValidLinkUrl(trimmed)) return trimmed;
  // 스킴 없이 도메인만 적은 경우만 구제한다. (javascript:, mailto: 등은 걸러진다)
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const withScheme = `https://${trimmed}`;
    if (isValidLinkUrl(withScheme)) return withScheme;
  }
  return "";
}

export function normalizeImageUrl(raw: string): string {
  const value = cleanLinkInput(raw);
  if (value.startsWith("/api/images/")) {
    const origin = String(process.env.URL || "https://picks-folio.com").replace(/\/+$/, "");
    return `${origin}${value}`;
  }
  return normalizeLinkUrl(value);
}

function toWebUrlButtons(buttons?: DmButton[]) {
  return (Array.isArray(buttons) ? buttons : [])
    .map((b) => ({ ...b, url: normalizeLinkUrl(b?.url || "") }))
    .filter((b) => b && b.label?.trim() && b.url)
    .slice(0, BUTTON_MAX)
    .map((b) => ({
      type: "web_url",
      url: b.url.trim(),
      title: b.label.trim().slice(0, BUTTON_LABEL_MAX),
    }));
}

/**
 * 카드 목록을 제네릭 템플릿 요소로 바꾼다.
 *
 * 이미지 주소는 인스타그램이 발송 시점에 직접 받아가므로 http/https 절대주소만
 * 싣는다. 그 밖의 값(상대 경로 · `blob:` · 오타)을 그대로 실으면 카드 하나가 아니라
 * 메시지 전체가 거부돼, 제목·버튼까지 통째로 도착하지 않는다.
 */
export function toCardElements(cards?: DmCard[]): Record<string, unknown>[] {
  const elements: Record<string, unknown>[] = [];

  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c) continue;
    const title = (c.title || "").trim();
    const subtitle = (c.subtitle || "").trim();
    const image = normalizeImageUrl(c.imageUrl);
    const buttons = cardButtons(c);
    const hasButton = buttons.length > 0;

    // 제목 외에 아무 속성도 없는 요소는 Graph API 가 거부한다("At least one
    // property must be set in addition to title"). 그 한 장 때문에 캐러셀 전체가
    // 도착하지 않으므로, 보낼 수 없는 카드는 여기서 뺀다.
    if (!image && !subtitle && !hasButton) continue;

    const el: Record<string, unknown> = {
      title: (title || CARD_TITLE_FALLBACK).slice(0, CARD_TEXT_MAX),
    };
    if (subtitle) el.subtitle = subtitle.slice(0, CARD_TEXT_MAX);
    if (image) el.image_url = image;
    if (hasButton) {
      // 카드 자체를 눌렀을 때는 첫 버튼 링크로 보낸다.
      el.default_action = { type: "web_url", url: buttons[0].url };
      el.buttons = buttons.map((b) => ({
        type: "web_url",
        url: b.url,
        title: b.label.slice(0, BUTTON_LABEL_MAX),
      }));
    }

    elements.push(el);
    if (elements.length >= CARD_MAX) break;
  }

  return elements;
}

/**
 * 캐러셀이 거부됐을 때 대신 보낼 텍스트.
 *
 * 카드 이미지를 인스타그램이 받아가지 못하는 등의 이유로 템플릿이 거절되면, 예전에는
 * 아무것도 도착하지 않았다. 댓글 비공개 답장은 한 번뿐이라 그 한 통을 그냥 날리는
 * 대신 제목·설명·링크만이라도 글로 보낸다.
 */
function cardsFallbackText(cards?: DmCard[]): string {
  const blocks: string[] = [];
  for (const c of (Array.isArray(cards) ? cards : []).slice(0, CARD_MAX)) {
    if (!c) continue;
    const lines = [(c.title || "").trim(), (c.subtitle || "").trim()].filter(Boolean);
    for (const b of cardButtons(c)) lines.push(`${b.label}: ${b.url}`);
    if (lines.length > 0) blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n").slice(0, TEXT_MAX);
}

function genericTemplate(elements: unknown[]) {
  return {
    attachment: {
      type: "template",
      payload: { template_type: "generic", elements },
    },
  };
}

/**
 * 하나의 DM 설정을 실제로 보낼 메시지 페이로드 배열로 변환한다.
 * 반환된 순서대로 발송해야 한다(본문 → 버튼 카드).
 */
export function buildDmMessages(content: DmContent): Record<string, unknown>[] {
  let message = (content.message || "").trim();

  if (content.messageType === "carousel") {
    const elements = toCardElements(content.cards);
    // 캐러셀은 카드 한 통이 메시지 전부다. 인스타그램은 메시지 한 통에 텍스트와
    // 첨부를 함께 담지 못하고, 댓글 비공개 답장은 한 통이 전부라서 텍스트를 따로
    // 붙여도 확실히 도착하지 않는다. 그래서 문구는 카드의 제목·설명으로만 나간다.
    if (elements.length > 0) return [genericTemplate(elements)];
    // 보낼 카드가 하나도 없으면 아래 텍스트 처리로 폴백한다 — 카드가 전부 비어
    // 있는데 아무것도 보내지 않으면 그 한 번의 발송 기회를 그냥 날린다.
    if (!message) message = cardsFallbackText(content.cards);
  }

  const buttons = toWebUrlButtons(content.buttons);

  if (buttons.length === 0) {
    return message ? [{ text: message.slice(0, TEXT_MAX) }] : [];
  }

  // 본문이 카드 제목 한도에 들어가면 본문+버튼을 카드 하나로 합쳐 보낸다.
  if (message.length <= CARD_TEXT_MAX) {
    return [genericTemplate([{ title: message || BUTTON_ONLY_CARD_TITLE, buttons }])];
  }

  // 긴 본문은 텍스트로 먼저 보내고 버튼 카드를 이어 보낸다.
  return [
    { text: message.slice(0, TEXT_MAX) },
    genericTemplate([{ title: BUTTON_ONLY_CARD_TITLE, buttons }]),
  ];
}

/**
 * 발송 계획 — 실제로 보낼 메시지와, 그중 무엇이 "꼭 도착해야 하는 통"인지.
 *
 * 수신자에 따라 보낼 수 있는 통 수가 다르기 때문에 필요하다. 대화창이 열린 상대
 * (IGSID)에게는 여러 통을 순서대로 보낼 수 있지만, 댓글 비공개 답장은 한 통이
 * 전부다. 발송기가 이 구분을 모르면 도착하지 못할 통의 실패를 "발송 실패"로
 * 기록하거나(활동 기록이 실제와 어긋난다), 반대로 중요한 내용을 두 번째 통에
 * 담아 통째로 잃는다.
 */
export interface DmPlan {
  /** 순서대로 보낼 메시지. */
  messages: Record<string, unknown>[];
  /**
   * 이 인덱스부터는 부가 메시지다 — 실패해도 발송 성공으로 본다.
   * (댓글 비공개 답장에서는 첫 통만 확실히 도착한다.)
   */
  bestEffortFrom: number;
  /**
   * 첫 통이 형식 오류로 거부됐을 때 대신 보낼 메시지.
   * 캐러셀은 이미지 주소 하나 때문에도 통째로 거부될 수 있어, 그때 글로라도 보낸다.
   */
  fallback?: Record<string, unknown>;
}

/**
 * 댓글 비공개 답장(`recipient: { comment_id }`)용 발송 계획.
 *
 * 인스타그램은 댓글 1건당 비공개 답장 1통만 허용하고, 댓글은 대화창을 열어주지
 * 않는다. 그래서 **가장 중요한 내용이 첫 통이어야** 한다. 캐러셀 설정이면 그 한 통이
 * 카드이고, 카드가 형식 오류로 거부될 때만 제목·설명·링크를 글로 옮긴 대체 텍스트가
 * 나간다. 카드 앞뒤에 텍스트를 따로 붙이지 않는다 — 그 통은 도착하지 못한다.
 */
export function buildCommentDmPlan(content: DmContent): DmPlan {
  if (content.messageType === "carousel") {
    const elements = toCardElements(content.cards);
    if (elements.length > 0) {
      const fallbackText = cardsFallbackText(content.cards);
      return {
        messages: [genericTemplate(elements)],
        bestEffortFrom: 1,
        fallback: fallbackText ? { text: fallbackText.slice(0, TEXT_MAX) } : undefined,
      };
    }
  }

  /**
   * 텍스트 + 링크 버튼. 본문이 카드 제목 한도(80자)를 넘으면 buildDmMessages 는
   * [본문 텍스트] → [버튼 카드] 2통으로 나누는데, 비공개 답장은 첫 통만 도착하므로
   * 버튼 카드가 통째로 빠졌다("종종 링크 버튼이 안 온다"). 그래서 댓글 답장에서는
   * 본문과 버튼을 항상 카드 한 장에 담는다 — 제목(80자) + 설명(80자)까지 본문을
   * 싣고, 그보다 긴 본문은 잘리더라도 버튼이 반드시 도착하게 한다.
   * 카드가 형식 오류로 거부될 때만 본문 + 링크 주소를 글로 보낸다.
   */
  const buttons = toWebUrlButtons(content.buttons);
  const message = (content.message || "").trim();
  if (buttons.length > 0 && message.length > CARD_TEXT_MAX) {
    const { title, subtitle } = splitCardText(message);
    const element: Record<string, unknown> = { title, buttons };
    if (subtitle) element.subtitle = subtitle;
    const fallbackText = [message, ...buttons.map((b) => `${b.title}: ${b.url}`)].join("\n\n");
    return {
      messages: [genericTemplate([element])],
      bestEffortFrom: 1,
      fallback: { text: fallbackText.slice(0, TEXT_MAX) },
    };
  }

  const messages = buildDmMessages(content);
  return { messages, bestEffortFrom: Math.min(1, messages.length) };
}

/**
 * 긴 본문을 카드 제목/설명(각 80자)으로 나눈다. 가능하면 줄바꿈·공백에서 끊고,
 * 설명에도 다 들어가지 않으면 끝을 '…'로 줄인다.
 */
function splitCardText(message: string): { title: string; subtitle: string } {
  const head = message.slice(0, CARD_TEXT_MAX);
  let cut = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
  if (cut < CARD_TEXT_MAX / 2) cut = CARD_TEXT_MAX;
  const title = message.slice(0, cut).trim();
  const rest = message.slice(cut).trim();
  const subtitle = rest.length > CARD_TEXT_MAX ? `${rest.slice(0, CARD_TEXT_MAX - 1).trimEnd()}…` : rest;
  return { title, subtitle };
}

/** 대화창이 열린 상대(IGSID)용 계획 — 설정한 순서 그대로 전부 보낸다. */
export function buildDirectDmPlan(content: DmContent): DmPlan {
  const messages = buildDmMessages(content);
  return { messages, bestEffortFrom: messages.length };
}

/* ────────────────────────── 2단계 발송(미끼 → 본 메시지) ────────────────────────── */

/** 1단계(미끼) 문구 길이 상한 — 제네릭 템플릿 카드 제목 한도와 같다. */
export const BAIT_TEXT_MAX = CARD_TEXT_MAX;
/** 버튼 라벨 길이 상한. */
export const BAIT_BUTTON_LABEL_MAX = BUTTON_LABEL_MAX;
export const DEFAULT_BAIT_MESSAGE = "댓글 감사합니다! 아래 버튼을 눌러주세요 👇";
export const DEFAULT_BAIT_BUTTON_LABEL = "메시지 받기";
export const DEFAULT_FOLLOW_GATE_MESSAGE = "팔로우 후 아래 버튼을 다시 눌러주시면 안내 메시지를 보내드릴게요!";
export const DEFAULT_FOLLOW_GATE_BUTTON_LABEL = "팔로우했어요";

/**
 * postback 버튼 하나를 담은 카드 한 장.
 *
 * 링크(web_url) 버튼이 아니라 postback 버튼이어야 한다. 사람이 누르면 인스타그램이
 * `messaging_postbacks` 웹훅을 보내는데, 이 클릭은 "상대가 우리에게 말을 건 것"이라
 * 24시간 대화창이 열린다. 링크 버튼은 브라우저만 열 뿐 우리에게 아무것도 알리지
 * 않아 대화가 열리지 않는다.
 */
export function postbackCard(text: string, buttonLabel: string, payload: string, fallbackLabel: string) {
  const title = (text || "").trim().slice(0, CARD_TEXT_MAX) || BUTTON_ONLY_CARD_TITLE;
  const label = (buttonLabel || "").trim().slice(0, BUTTON_LABEL_MAX) || fallbackLabel;
  return genericTemplate([
    { title, buttons: [{ type: "postback", title: label, payload: payload.slice(0, 1000) }] },
  ]);
}

/**
 * 1단계(미끼) 댓글 비공개 답장 계획.
 *
 * 비공개 답장 한 통에는 짧은 문구 + postback 버튼 카드만 싣는다. 인스타그램이 이
 * 카드를 형식 오류로 거부하면(정책 변경으로 postback 버튼을 막는 경우 등) 그 한 번의
 * 비공개 답장 기회는 아직 남아 있으므로, 기존 "1통 카드"(buildCommentDmPlan)를 대신
 * 보낸다 — 2단계로 넘어가지 못해도 받는 사람에게는 본문과 링크가 도착한다.
 */
export function buildBaitCommentPlan(
  bait: { message?: string; buttonLabel?: string; payload: string },
  legacy: DmContent,
): DmPlan {
  const card = postbackCard(
    bait.message || DEFAULT_BAIT_MESSAGE,
    bait.buttonLabel || "",
    bait.payload,
    DEFAULT_BAIT_BUTTON_LABEL,
  );
  const single = buildCommentDmPlan(legacy).messages[0];
  return { messages: [card], bestEffortFrom: 1, fallback: single };
}

/**
 * 2단계(본 메시지) 계획 — 버튼 클릭으로 대화창이 열린 상대에게 IGSID 로 보낸다.
 *
 * 창이 열려 있으니 여러 통을 순서대로 보낼 수 있다. 선택 인트로 텍스트 → 본문
 * (긴 텍스트는 텍스트 + 버튼 카드로 나뉘고, 캐러셀은 카드 한 통) 순서다. 모든 통이
 * 도착해야 성공으로 본다.
 */
export function buildMainDmPlan(content: DmContent, intro?: string): DmPlan {
  const messages = buildDmMessages(content);
  const lead = (intro || "").trim();
  if (lead) messages.unshift({ text: lead.slice(0, TEXT_MAX) });
  return { messages, bestEffortFrom: messages.length };
}

export interface SendDmArgs {
  graphHost: string;
  graphVersion: string;
  /** 발신 IG 계정 ID. */
  igId: string;
  accessToken: string;
  /** `{ id: IGSID }` 또는 댓글 비공개 답장용 `{ comment_id }`. */
  recipient: Record<string, string>;
  /**
   * 두 번째 이후 메시지에 쓸 수신자.
   *
   * 비공개 답장(`comment_id`)은 댓글 한 건당 1통만 허용된다. 본문 텍스트와 링크
   * 버튼 카드처럼 메시지가 2건인 설정을 전부 `comment_id` 로 보내면 첫 통은
   * 도착하고 두 번째부터 거부된다. 첫 통이 대화를 열어주므로 이어지는 메시지는
   * IGSID(`{ id }`)로 보내야 한다.
   */
  followUpRecipient?: Record<string, string>;
  messages: Record<string, unknown>[];
  /**
   * 이 인덱스부터는 부가 메시지 — 실패해도 발송 성공으로 본다(`DmPlan.bestEffortFrom`).
   * 기본값은 "전부 필수".
   */
  bestEffortFrom?: number;
  /** 첫 통이 형식 오류로 거부됐을 때 대신 보낼 메시지(`DmPlan.fallback`). */
  fallback?: Record<string, unknown>;
  /**
   * 첫 통부터 발송 간격 없이 곧바로 보낼지.
   *
   * 발송 간격(기본 약 9초)은 댓글마다 먼저 나가는 발송끼리 벌리려는 것이다. 다음
   * 두 경우는 이미 시작된 대화에 이어지는 발송이라 간격을 두지 않는다.
   *  - 1단계(예고) 메시지의 버튼을 누른 사람에게 보내는 본 메시지 — 상대가 방금
   *    눌렀으니 몇 통이든 바로 도착해야 한다.
   *  - 방금 거부된 발송을 대신하는 대체 메시지 — 순서를 새로 받으려 하면 간격에
   *    걸려 throttled 로 끝나고, 대기열은 거부될 원래 메시지를 다시 보내므로 대체
   *    메시지는 끝내 나가지 않는다.
   */
  continuation?: boolean;
}

/**
 * Graph API 오류 분류.
 *
 * 화면에 "실패"라고 띄우기 전에 왜 실패했는지를 구분해야 한다. 특히
 * `already_sent`(댓글당 1회 제한)와 `outside_window`(24시간 창)는 우리 쪽 버그가
 * 아니라 인스타그램 정책이고, 이미 DM 을 받은 사용자에게서 발생한다. 이 둘을
 * 그냥 실패로 표시하면 "DM 은 도착했는데 화면은 실패"라는 모순이 생긴다.
 */
export type DmErrorKind =
  | "already_sent"
  | "outside_window"
  | "permission"
  | "rate_limit"
  | "throttled"
  | "uncertain"
  | "other";

export function classifyGraphError(err: any, httpStatus?: number): DmErrorKind {
  const message = String(err?.message || "").toLowerCase();
  const code = Number(err?.code);
  const subcode = Number(err?.error_subcode);

  // 비공개 답장은 댓글 1건당 1회. 이미 썼으면 재시도해도 거부된다.
  // Meta 의 문구가 버전마다 조금씩 다르므로("already been replied to",
  // "only one private reply per comment" 등) 넉넉하게 잡는다.
  if (
    /one private reply/.test(message) ||
    (/already/.test(message) && /(repl|sent|private|respond)/.test(message))
  ) {
    return "already_sent";
  }
  // 표준 메시징 창(상대의 마지막 상호작용 이후 24시간) 밖.
  if (subcode === 2534015 || /outside of allowed window|outside the allowed window|messaging window|24 hour/.test(message)) {
    return "outside_window";
  }
  if (httpStatus === 429 || code === 4 || code === 17 || code === 32 || code === 613 || /rate limit|too many/.test(message)) {
    return "rate_limit";
  }
  if (httpStatus && httpStatus >= 500) return "uncertain";
  if (/unknown error|temporarily unavailable/.test(message)) return "uncertain";
  if (code === 190 || code === 200 || code === 102 || /permission|access token|expired/.test(message)) {
    return "permission";
  }
  return "other";
}

/** 분류된 오류를 사용자가 읽을 수 있는 안내로 바꾼다. */
export function describeDmError(kind: DmErrorKind, raw?: string): string {
  switch (kind) {
    case "already_sent":
      return "인스타그램은 댓글 1건당 DM(비공개 답장)을 1회만 허용합니다. 이 댓글에는 이미 DM이 발송됐습니다.";
    case "outside_window":
      return "인스타그램 정책상 상대가 마지막으로 댓글·메시지를 보낸 뒤 24시간이 지나면 DM을 보낼 수 없습니다.";
    case "permission":
      return "인스타그램 연동 권한이 만료됐거나 부족합니다. DM 자동화 화면에서 계정을 다시 연동해 주세요.";
    case "rate_limit":
      return "인스타그램 발송 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.";
    case "throttled":
      return "발송 순서를 기다리고 있습니다. 잠시 후 이어서 진행해 주세요.";
    case "uncertain":
      return "발송 결과를 확인하지 못했습니다. 인스타그램 DM 함을 확인해 주세요.";
    default:
      return raw || "인스타그램에서 발송을 거부했습니다.";
  }
}

export interface SendDmResult {
  retryAfterMs?: number;
  /** 모든 메시지가 전송된 경우에만 true. */
  ok: boolean;
  /** 마지막으로 성공한 메시지 ID. */
  messageId?: string;
  error?: string;
  /** 오류 분류 — 실패를 화면에 어떻게 표시할지 정하는 데 쓴다. */
  errorKind?: DmErrorKind;
  /** 실제로 전송에 성공한 메시지 수. */
  sent: number;
  /** 보내려고 했던 메시지 수. */
  total: number;
  /** 첫 메시지는 도착했지만 뒤따르는 메시지가 실패한 상태. */
  partial: boolean;
  /**
   * 부가 메시지가 실패한 이유(있으면). 발송 자체는 성공이므로 `ok` 는 true 다.
   * 화면에 실패로 띄우지 말고, 필요하면 안내 문구에만 쓴다.
   */
  followUpError?: string;
  /** 첫 통이 거부돼 대체 텍스트로 보냈는지. */
  usedFallback?: boolean;
}

/** 한 통 발송 결과(내부용). */
interface SendOneResult {
  retryAfterMs?: number;
  ok: boolean;
  messageId?: string;
  error?: string;
  errorKind?: DmErrorKind;
}

/** 한 DM 의 뒤 통을 보내기 전 두는 간격. */
const FOLLOW_UP_GAP_MS = 400;

async function postOneMessage(args: {
  igId: string;
  url: string;
  accessToken: string;
  recipient: Record<string, string>;
  message: Record<string, unknown>;
  /**
   * 같은 DM 을 이루는 뒤 통(본문 텍스트 뒤의 링크 버튼 카드 등)인지.
   *
   * 발송 간격(기본 약 9초)은 "DM 한 건"끼리 벌리려는 것이다. 한 DM 이 여러 통으로
   * 나뉜 경우 그 뒤 통까지 간격을 적용하면 텍스트만 먼저 오고 버튼 카드는 한참
   * 뒤에(또는 웹훅이 기다리지 못해 아예) 도착한다. 그래서 첫 통이 예약을 받아
   * 나갔다면 뒤 통은 예약 없이 짧은 간격만 두고 곧바로 보낸다.
   */
  followUp?: boolean;
}): Promise<SendOneResult> {
  const { url, accessToken, recipient, message } = args;
  let reservation: Awaited<ReturnType<typeof reserveDmSend>> | null = null;
  if (args.followUp) {
    // 인스타그램이 순서를 뒤바꾸지 않도록 바로 앞 통과 최소 간격만 둔다.
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_UP_GAP_MS));
  } else {
    try {
      reservation = await reserveDmSend(args.igId, recipient.comment_id ? "private_reply" : "direct");
    } catch {
      return { ok: false, error: "발송 대기열에 연결하지 못했습니다.", errorKind: "throttled", retryAfterMs: 60_000 };
    }
    if (!reservation.allowed) return { ok: false, errorKind: "throttled", retryAfterMs: reservation.retryAfterMs };
  }
  const finish = async (result: SendOneResult) => {
    if (reservation?.token) await finishDmSend(args.igId, reservation.token, result);
    return result;
  };
  try {
    await checkWorkerLease();
  } catch {
    return finish({ ok: false, errorKind: "throttled", retryAfterMs: 60_000 });
  }
  let res: Response;
  let result: any;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ recipient, message }),
      signal: AbortSignal.timeout(8_000),
    });
    result = (await res.json().catch(() => ({}))) as any;
  } catch (e: any) {
    // 네트워크 오류를 예외로 던지면 일괄 발송 루프가 중간에 통째로 죽어, 이미
    // 보낸 건수까지 함께 사라진다(화면에는 전체 실패로 보인다). 결과로 돌려준다.
    return finish({
      ok: false,
      error: e?.message || "인스타그램 서버 연결에 실패했습니다.",
      errorKind: "uncertain",
    });
  }

  // Graph API 는 드물게 HTTP 200 으로 오류 본문을 돌려준다. 본문의 error 를
  // 확인하지 않으면 도착하지 않은 메시지를 "발송 성공"으로 기록한다.
  if (!res.ok || result?.error) {
    const graphError = result?.error;
    return finish({
      ok: false,
      error: graphError?.message || `Graph API 오류 (HTTP ${res.status})`,
      errorKind: classifyGraphError(graphError, res.status),
      retryAfterMs: retryAfterMs(res),
    });
  }

  if (!result?.message_id) return finish({ ok: false, errorKind: "uncertain", error: "발송 응답에 메시지 ID가 없습니다." });
  return finish({ ok: true, messageId: result.message_id });
}

/**
 * 메시지 페이로드들을 순서대로 발송한다.
 *
 * - `bestEffortFrom` 이후의 메시지는 "도착하면 좋은" 부가 메시지다. 실패해도
 *   발송 성공으로 보고 이유만 `followUpError` 로 알려준다. 댓글 비공개 답장은 한
 *   통이 전부라서, 두 번째 통의 실패는 정책상 정상이며 실패로 기록하면 활동
 *   기록이 실제와 어긋난다.
 * - 첫 통이 형식 오류로 거부되고 `fallback` 이 있으면 대체 메시지로 한 번 더
 *   시도한다. 캐러셀은 이미지 주소 하나 때문에도 통째로 거부되는데, 그 한 번의
 *   비공개 답장 기회를 그냥 날리면 상대에게 아무것도 도착하지 않는다.
 *
 * 중단 시점까지 전송된 개수를 `sent` 로, 일부만 도착했는지를 `partial` 로 알려준다.
 * 호출부는 `partial` 인 결과를 "발송 실패"로 다루면 안 된다. 수신자에게는 이미
 * 메시지가 도착해 있으므로, 재시도하면 같은 본문이 두 번 도착한다.
 */
export async function sendDmMessages(args: SendDmArgs): Promise<SendDmResult> {
  const { graphHost, graphVersion, igId, accessToken, recipient, followUpRecipient, messages, fallback } = args;

  if (messages.length === 0) {
    return { ok: false, error: "보낼 메시지 내용이 없습니다.", sent: 0, total: 0, partial: false };
  }

  const url = `https://${graphHost}/${graphVersion}/${encodeURIComponent(igId)}/messages`;
  const total = messages.length;
  const required = Math.max(1, Math.min(args.bestEffortFrom ?? total, total));
  let messageId: string | undefined;
  let sent = 0;
  let usedFallback = false;

  for (let i = 0; i < messages.length; i += 1) {
    const to = i === 0 ? recipient : followUpRecipient || recipient;
    // 첫 통이 이미 나갔으면 뒤 통은 발송 간격 없이 이어 보낸다(한 DM 의 일부다).
    let attempt = await postOneMessage({
      igId,
      url,
      accessToken,
      recipient: to,
      message: messages[i],
      followUp: (i > 0 && sent > 0) || (i === 0 && Boolean(args.continuation)),
    });

    /**
     * 첫 통이 "형식" 문제로 거부된 경우에만 대체 메시지를 쓴다.
     *
     * 권한 만료·발송 한도·이미 답장함 같은 오류는 대체 메시지로도 똑같이 실패하고,
     * 이미 도착했을 수 있는 메시지를 한 번 더 보낼 위험만 남는다.
     *
     * 대체 메시지는 거부된 첫 통의 발송 순서를 이어 쓴다(`followUp`). 순서를 새로
     * 받으려 하면 발송 간격에 걸려 throttled 로 끝나고, 대기열이 다시 시도할 때도
     * 원래 메시지가 또 거부돼 대체 메시지는 영영 나가지 않았다.
     */
    if (!attempt.ok && i === 0 && fallback && attempt.errorKind === "other") {
      const retried = await postOneMessage({ igId, url, accessToken, recipient: to, message: fallback, followUp: true });
      usedFallback = retried.ok;
      attempt = retried;
    }

    if (attempt.ok) {
      messageId = attempt.messageId || messageId;
      sent += 1;
      continue;
    }

    // 부가 메시지 실패 — 발송 자체는 성공이다.
    if (i >= required) {
      return {
        ok: true,
        messageId,
        sent,
        total,
        partial: false,
        usedFallback,
        followUpError: attempt.error,
      };
    }

    return {
      ok: false,
      messageId,
      sent,
      total,
      partial: sent > 0,
      usedFallback,
      error: attempt.error,
      errorKind: attempt.errorKind || "other",
      retryAfterMs: attempt.retryAfterMs,
    };
  }

  return { ok: true, messageId, sent, total, partial: false, usedFallback };
}

/**
 * 댓글에 공개 답글을 남긴다.
 *
 * Graph API 의 `/{comment-id}/replies` 엣지는 `message` 를 **폼 파라미터**로 받는다.
 * JSON 본문으로 보내면 파라미터를 인식하지 못해 `message is required`(code 100) 로
 * 거절된다.
 *
 * 웹훅(자동 발송)과 수동 발송이 같은 경로를 쓰도록 여기에 둔다. 두 곳에 같은
 * 요청을 따로 적어 두면 한쪽만 고쳐졌을 때 "자동은 답글이 달리는데 수동은 안
 * 달린다" 같은 차이가 생긴다.
 */
export async function postCommentReply(args: {
  igId: string;
  host: string;
  graphVersion: string;
  commentId: string;
  accessToken: string;
  message: string;
}): Promise<{ ok: boolean; replyId?: string; error?: string; uncertain?: boolean; errorKind?: DmErrorKind; retryAfterMs?: number }> {
  const { host, graphVersion, commentId, accessToken, message } = args;
  let reservation: Awaited<ReturnType<typeof reserveDmSend>>;
  try {
    reservation = await reserveDmSend(args.igId, "public_reply");
  } catch {
    return { ok: false, errorKind: "throttled", retryAfterMs: 60_000 };
  }
  if (!reservation.allowed) return { ok: false, errorKind: "throttled", retryAfterMs: reservation.retryAfterMs };
  const finish = async <T extends { ok: boolean; errorKind?: DmErrorKind; retryAfterMs?: number }>(result: T): Promise<T> => {
    await finishDmSend(args.igId, reservation.token!, result);
    return result;
  };
  try {
    await checkWorkerLease();
  } catch {
    return finish({ ok: false, errorKind: "throttled" as const, retryAfterMs: 60_000 });
  }
  try {
    const res = await fetch(
      `https://${host}/${graphVersion}/${encodeURIComponent(commentId)}/replies`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${accessToken}`,
        },
        body: new URLSearchParams({ message }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.error) {
      const errorKind = classifyGraphError(data?.error, res.status);
      return finish({
        ok: false,
        error: data?.error?.message || `Graph API 오류 (HTTP ${res.status})`,
        uncertain: errorKind === "uncertain",
        errorKind,
        retryAfterMs: retryAfterMs(res),
      });
    }
    if (!data?.id) return finish({ ok: false, uncertain: true, errorKind: "uncertain" as const, error: "답글 응답에 ID가 없습니다." });
    return finish({ ok: true, replyId: data.id });
  } catch (e: any) {
    return finish({ ok: false, error: e?.message || "답글 전송 중 오류", uncertain: true, errorKind: "uncertain" as const });
  }
}
