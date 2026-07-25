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
  messages: Record<string, unknown>[];
}

export interface SendDmResult {
  ok: boolean;
  /** 마지막으로 성공한 메시지 ID. */
  messageId?: string;
  error?: string;
  /** 실제로 전송에 성공한 메시지 수. */
  sent: number;
}

/**
 * 메시지 페이로드들을 순서대로 발송한다. 첫 실패에서 중단하고 오류를 돌려준다.
 */
export async function sendDmMessages(args: SendDmArgs): Promise<SendDmResult> {
  const { graphHost, graphVersion, igId, accessToken, recipient, messages } = args;

  if (messages.length === 0) {
    return { ok: false, error: "보낼 메시지 내용이 없습니다.", sent: 0 };
  }

  const url = `https://${graphHost}/${graphVersion}/${encodeURIComponent(igId)}/messages`;
  let messageId: string | undefined;
  let sent = 0;

  for (const message of messages) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ recipient, message }),
    });
    const result = (await res.json().catch(() => ({}))) as any;

    if (!res.ok) {
      return {
        ok: false,
        messageId,
        sent,
        error: result?.error?.message || `Graph API 오류 (HTTP ${res.status})`,
      };
    }

    messageId = result?.message_id || messageId;
    sent += 1;
  }

  return { ok: true, messageId, sent };
}
