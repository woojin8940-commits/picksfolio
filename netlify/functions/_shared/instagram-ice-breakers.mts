/**
 * 아이스브레이커(대화 시작 질문) 동기화.
 *
 * DM 창을 처음 여는 사람에게 인스타그램이 보여주는 "추천 질문" 버튼이다. 우리
 * 서비스에서는 "자주 묻는 질문"으로 부른다. 최대 4개까지 등록할 수 있고, 사람이
 * 버튼을 누르면 일반 메시지가 아니라 `postback` 웹훅 이벤트가 도착한다
 * (`postback.payload` 에 우리가 심어 둔 값이 실려 온다 → instagram-webhook 이
 * 그 값으로 미리 정해 둔 답변을 보낸다).
 *
 * 이 설정은 **인스타그램 쪽에 저장되는 프로필 값**이라, 우리 블롭에만 저장해도
 * DM 창에는 아무것도 보이지 않는다. 그래서 저장할 때마다 Graph API 로 밀어 넣고
 * 결과(성공 시각 / 실패 이유)를 설정에 함께 기록한다 — 실패를 조용히 넘기면
 * 사용자는 "저장했는데 DM 창에 버튼이 없다"를 겪으면서 원인을 알 수 없다.
 *
 * 권한: `instagram_business_basic` + `instagram_business_manage_messages`.
 * 둘 다 2026-08-30 심사를 통과한 범위라 추가 심사가 필요하지 않다.
 *
 * 주의: 아이스브레이커는 **모바일 앱**의 DM 창에서만 보인다(웹 instagram.com 은
 * 지원하지 않는다). 화면 안내에도 같은 내용을 적어 둔다.
 */

const GRAPH_VERSION = "v21.0";

/** 인스타그램이 허용하는 최대 개수. */
export const ICE_BREAKER_MAX = 4;
/** 질문 버튼에 들어갈 수 있는 글자 수(버튼이라 짧다). */
export const ICE_BREAKER_QUESTION_MAX = 80;

/**
 * postback payload 를 만든다.
 *
 * 인스타그램은 버튼에 우리가 정한 문자열을 그대로 실어 되돌려 준다. 질문 문구가
 * 아니라 항목 ID 를 쓰는 이유는, 문구를 고친 뒤에도 이미 DM 창에 떠 있던 예전
 * 버튼이 여전히 올바른 답변을 찾아가야 하기 때문이다.
 */
export const faqPayload = (id: string) => `faq_${id}`;

/** postback payload 에서 항목 ID 를 되돌린다. 우리 형식이 아니면 null. */
export function faqIdFromPayload(payload: string): string | null {
  const value = String(payload || "");
  return value.startsWith("faq_") ? value.slice(4) : null;
}

export interface IceBreakerEntry {
  question: string;
  payload: string;
}

interface Target {
  host: string;
  /** Instagram Login 은 `me` 로 충분하고, 구 페이지 토큰은 IG 계정 ID 가 필요하다. */
  node: string;
}

function targetOf(tokenSource?: string, igId?: string): Target {
  return tokenSource === "instagram_login"
    ? { host: "graph.instagram.com", node: "me" }
    : { host: "graph.facebook.com", node: igId || "me" };
}

export interface IceBreakerSyncResult {
  ok: boolean;
  error?: string;
}

async function callProfile(args: {
  method: "POST" | "DELETE";
  accessToken: string;
  tokenSource?: string;
  igId?: string;
  body: Record<string, unknown>;
}): Promise<IceBreakerSyncResult> {
  const { method, accessToken, tokenSource, igId, body } = args;
  const { host, node } = targetOf(tokenSource, igId);
  try {
    const res = await fetch(
      `https://${host}/${GRAPH_VERSION}/${encodeURIComponent(node)}/messenger_profile`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.error) {
      return {
        ok: false,
        error: data?.error?.message || `Graph API 오류 (HTTP ${res.status})`,
      };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "아이스브레이커 요청 실패" };
  }
}

/**
 * 질문 목록을 인스타그램에 등록한다. 목록이 비어 있으면 등록을 지운다
 * (빈 배열을 보내면 거부되므로 삭제 호출로 갈라진다).
 */
export async function syncIceBreakers(args: {
  accessToken: string;
  tokenSource?: string;
  igId?: string;
  entries: IceBreakerEntry[];
}): Promise<IceBreakerSyncResult> {
  const { accessToken, tokenSource, igId } = args;
  if (!accessToken) return { ok: false, error: "액세스 토큰이 없습니다." };

  const entries = args.entries
    .filter((e) => e.question.trim() && e.payload)
    .slice(0, ICE_BREAKER_MAX)
    .map((e) => ({
      question: e.question.trim().slice(0, ICE_BREAKER_QUESTION_MAX),
      payload: e.payload,
    }));

  if (entries.length === 0) return clearIceBreakers({ accessToken, tokenSource, igId });

  return callProfile({
    method: "POST",
    accessToken,
    tokenSource,
    igId,
    body: {
      platform: "instagram",
      // `locale` 은 생략한다 — 언어별 목록을 따로 두지 않으므로 기본(default) 하나면 된다.
      ice_breakers: [{ call_to_actions: entries }],
    },
  });
}

/** 등록된 질문을 모두 지운다(기능을 끌 때). */
export async function clearIceBreakers(args: {
  accessToken: string;
  tokenSource?: string;
  igId?: string;
}): Promise<IceBreakerSyncResult> {
  if (!args.accessToken) return { ok: false, error: "액세스 토큰이 없습니다." };
  return callProfile({
    method: "DELETE",
    accessToken: args.accessToken,
    tokenSource: args.tokenSource,
    igId: args.igId,
    body: { fields: ["ice_breakers"] },
  });
}
