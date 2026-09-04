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
}

export interface DmContent {
  messageType?: "text" | "carousel";
  message?: string;
  buttons?: DmButton[];
  cards?: DmCard[];
  /**
   * 캐러셀 앞에 먼저 보낼 인사말(선택). 텍스트 형식의 `message` 와 따로 둔다 —
   * 형식만 캐러셀로 바꿨다고 텍스트용 본문이 함께 나가면, 사용자가 편집 화면에서
   * 본 적 없는 문구가 발송된다.
   */
  intro?: string;
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
    const u = new URL((raw || "").trim());
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
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (isValidLinkUrl(trimmed)) return trimmed;
  // 스킴 없이 도메인만 적은 경우만 구제한다. (javascript:, mailto: 등은 걸러진다)
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const withScheme = `https://${trimmed}`;
    if (isValidLinkUrl(withScheme)) return withScheme;
  }
  return "";
}

function toWebUrlButtons(buttons?: DmButton[]) {
  return (Array.isArray(buttons) ? buttons : [])
    .filter((b) => b && b.label?.trim() && isValidLinkUrl(b.url))
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
    const image = isValidLinkUrl(c.imageUrl) ? c.imageUrl.trim() : "";
    const hasButton = Boolean((c.buttonLabel || "").trim() && isValidLinkUrl(c.buttonUrl));

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
      const url = c.buttonUrl.trim();
      el.default_action = { type: "web_url", url };
      el.buttons = [
        { type: "web_url", url, title: c.buttonLabel.trim().slice(0, BUTTON_LABEL_MAX) },
      ];
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
    if (isValidLinkUrl(c.buttonUrl)) lines.push(c.buttonUrl.trim());
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
  const intro = (content.intro || "").trim();

  if (content.messageType === "carousel") {
    const elements = toCardElements(content.cards);
    if (elements.length > 0) {
      // 인사말을 적어 두면 텍스트 한 통이 먼저 도착하고, 이어서 카드가 도착한다.
      return intro
        ? [{ text: intro.slice(0, TEXT_MAX) }, genericTemplate(elements)]
        : [genericTemplate(elements)];
    }
    // 보낼 카드가 하나도 없으면 아래 텍스트 처리로 폴백한다. 이때 인사말은 본문
    // 자리를 대신한다 — 카드가 전부 비어 있다고 인사말까지 버리면, 문구를 적어 둔
    // 사용자에게 아무것도 도착하지 않는다.
    if (!message) message = intro;
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
 * 않는다. 그래서 **가장 중요한 내용이 첫 통이어야** 한다. 캐러셀 설정이라면 카드가
 * 먼저 나가고, 인사말은 (대화창이 이미 열려 있는 상대에게만 도착하는) 부가 메시지로
 * 뒤에 붙는다. 예전에는 인사말을 먼저 보내 캐러셀이 사라졌다.
 */
export function buildCommentDmPlan(content: DmContent): DmPlan {
  const intro = (content.intro || "").trim();

  if (content.messageType === "carousel") {
    const elements = toCardElements(content.cards);
    if (elements.length > 0) {
      const messages: Record<string, unknown>[] = [genericTemplate(elements)];
      if (intro) messages.push({ text: intro.slice(0, TEXT_MAX) });
      const fallbackText = intro || cardsFallbackText(content.cards);
      return {
        messages,
        bestEffortFrom: 1,
        fallback: fallbackText ? { text: fallbackText.slice(0, TEXT_MAX) } : undefined,
      };
    }
  }

  // 텍스트 형식. 본문이 길어 버튼 카드가 두 번째 통이 되는 경우, 그 카드는 부가
  // 메시지로 둔다 — 본문은 이미 도착했으므로 실패로 기록하면 안 된다.
  const messages = buildDmMessages(content);
  return { messages, bestEffortFrom: Math.min(1, messages.length) };
}

/** 대화창이 열린 상대(IGSID)용 계획 — 설정한 순서 그대로 전부 보낸다. */
export function buildDirectDmPlan(content: DmContent): DmPlan {
  const messages = buildDmMessages(content);
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
    default:
      return raw || "인스타그램에서 발송을 거부했습니다.";
  }
}

export interface SendDmResult {
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
  ok: boolean;
  messageId?: string;
  error?: string;
  errorKind?: DmErrorKind;
}

async function postOneMessage(args: {
  url: string;
  accessToken: string;
  recipient: Record<string, string>;
  message: Record<string, unknown>;
}): Promise<SendOneResult> {
  const { url, accessToken, recipient, message } = args;
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
    });
    result = (await res.json().catch(() => ({}))) as any;
  } catch (e: any) {
    // 네트워크 오류를 예외로 던지면 일괄 발송 루프가 중간에 통째로 죽어, 이미
    // 보낸 건수까지 함께 사라진다(화면에는 전체 실패로 보인다). 결과로 돌려준다.
    return {
      ok: false,
      error: e?.message || "인스타그램 서버 연결에 실패했습니다.",
      errorKind: "other",
    };
  }

  // Graph API 는 드물게 HTTP 200 으로 오류 본문을 돌려준다. 본문의 error 를
  // 확인하지 않으면 도착하지 않은 메시지를 "발송 성공"으로 기록한다.
  if (!res.ok || result?.error) {
    const graphError = result?.error;
    return {
      ok: false,
      error: graphError?.message || `Graph API 오류 (HTTP ${res.status})`,
      errorKind: classifyGraphError(graphError, res.status),
    };
  }

  return { ok: true, messageId: result?.message_id };
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
    let attempt = await postOneMessage({ url, accessToken, recipient: to, message: messages[i] });

    /**
     * 첫 통이 "형식" 문제로 거부된 경우에만 대체 메시지를 쓴다.
     *
     * 권한 만료·발송 한도·이미 답장함 같은 오류는 대체 메시지로도 똑같이 실패하고,
     * 이미 도착했을 수 있는 메시지를 한 번 더 보낼 위험만 남는다.
     */
    if (!attempt.ok && i === 0 && fallback && attempt.errorKind === "other") {
      const retried = await postOneMessage({ url, accessToken, recipient: to, message: fallback });
      if (retried.ok) {
        usedFallback = true;
        attempt = retried;
      }
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
  host: string;
  graphVersion: string;
  commentId: string;
  accessToken: string;
  message: string;
}): Promise<{ ok: boolean; replyId?: string; error?: string }> {
  const { host, graphVersion, commentId, accessToken, message } = args;
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
