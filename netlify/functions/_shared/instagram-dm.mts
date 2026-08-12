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

/** Graph API 는 http/https 절대 URL 만 web_url 버튼으로 받는다. */
export function isValidLinkUrl(raw: string): boolean {
  try {
    const u = new URL((raw || "").trim());
    return u.protocol === "http:" || u.protocol === "https:";
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

function toCardElements(cards?: DmCard[]) {
  return (Array.isArray(cards) ? cards : [])
    .filter((c) => c && (c.title?.trim() || c.imageUrl?.trim()))
    .slice(0, CARD_MAX)
    .map((c) => {
      const el: Record<string, unknown> = {
        title: (c.title?.trim() || " ").slice(0, CARD_TEXT_MAX),
      };
      if (c.subtitle?.trim()) el.subtitle = c.subtitle.trim().slice(0, CARD_TEXT_MAX);
      if (c.imageUrl?.trim()) el.image_url = c.imageUrl.trim();
      if (c.buttonLabel?.trim() && isValidLinkUrl(c.buttonUrl)) {
        const url = c.buttonUrl.trim();
        el.default_action = { type: "web_url", url };
        el.buttons = [
          { type: "web_url", url, title: c.buttonLabel.trim().slice(0, BUTTON_LABEL_MAX) },
        ];
      }
      return el;
    });
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
  const message = (content.message || "").trim();

  if (content.messageType === "carousel") {
    const elements = toCardElements(content.cards);
    if (elements.length > 0) return [genericTemplate(elements)];
    // 카드가 비어 있으면 아래 텍스트 처리로 폴백한다.
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
}

/**
 * 메시지 페이로드들을 순서대로 발송한다. 첫 실패에서 중단하고 오류를 돌려준다.
 *
 * 중단 시점까지 전송된 개수를 `sent` 로, 일부만 도착했는지를 `partial` 로 알려준다.
 * 호출부는 `partial` 인 결과를 "발송 실패"로 다루면 안 된다. 수신자에게는 이미
 * 메시지가 도착해 있으므로, 재시도하면 같은 본문이 두 번 도착한다.
 */
export async function sendDmMessages(args: SendDmArgs): Promise<SendDmResult> {
  const { graphHost, graphVersion, igId, accessToken, recipient, followUpRecipient, messages } = args;

  if (messages.length === 0) {
    return { ok: false, error: "보낼 메시지 내용이 없습니다.", sent: 0, total: 0, partial: false };
  }

  const url = `https://${graphHost}/${graphVersion}/${encodeURIComponent(igId)}/messages`;
  let messageId: string | undefined;
  let sent = 0;

  for (const message of messages) {
    const to = sent === 0 ? recipient : followUpRecipient || recipient;
    let res: Response;
    let result: any;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ recipient: to, message }),
      });
      result = (await res.json().catch(() => ({}))) as any;
    } catch (e: any) {
      // 네트워크 오류를 예외로 던지면 일괄 발송 루프가 중간에 통째로 죽어, 이미
      // 보낸 건수까지 함께 사라진다(화면에는 전체 실패로 보인다). 결과로 돌려준다.
      return {
        ok: false,
        messageId,
        sent,
        total: messages.length,
        partial: sent > 0,
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
        messageId,
        sent,
        total: messages.length,
        partial: sent > 0,
        error: graphError?.message || `Graph API 오류 (HTTP ${res.status})`,
        errorKind: classifyGraphError(graphError, res.status),
      };
    }

    messageId = result?.message_id || messageId;
    sent += 1;
  }

  return { ok: true, messageId, sent, total: messages.length, partial: false };
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
