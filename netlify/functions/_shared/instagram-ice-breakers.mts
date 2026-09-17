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

/**
 * 요청을 보낼 노드 후보.
 *
 * Instagram Login 방식에서는 문서에 IG 계정 ID 를 쓰는 예시와 `me` 를 쓰는 예시가
 * 모두 있고, 계정에 따라 한쪽이 `Invalid parameter` 로 거절된다. 그래서 후보를
 * 순서대로 시도한다(둘 다 같은 계정을 가리키므로 중복 등록될 위험은 없다).
 */
function nodeCandidates(tokenSource?: string, igId?: string): { host: string; nodes: string[] } {
  if (tokenSource === "instagram_login") {
    const nodes = [igId, "me"].filter(Boolean) as string[];
    return { host: "graph.instagram.com", nodes: [...new Set(nodes)] };
  }
  return { host: "graph.facebook.com", nodes: [igId || "me"] };
}

export interface IceBreakerSyncResult {
  ok: boolean;
  error?: string;
}

interface CallResult extends IceBreakerSyncResult {
  /** 형식 문제로 보이는 오류인지. 이 경우에만 다른 형식으로 다시 시도한다. */
  retryable?: boolean;
}

/**
 * 오류가 "요청 형식" 문제인지 판단한다.
 *
 * 토큰 만료·권한 부족(190/200/104)은 형식을 바꿔도 똑같이 실패하므로 즉시 멈춰야
 * 한다. 반대로 code 100(`Invalid parameter`)은 본문 모양이 이 계정 연동 방식과 맞지
 * 않는다는 뜻이라 다른 조합을 시도할 가치가 있다.
 */
function looksLikeFormatError(err: any, status?: number): boolean {
  const code = Number(err?.code);
  const message = String(err?.message || "").toLowerCase();
  // 토큰·권한(190/200/104/10)과 발송 한도(4/17/32/613)는 형식과 무관하다.
  if ([190, 200, 104, 10, 4, 17, 32, 613].includes(code)) return false;
  return code === 100 || status === 400 || /invalid parameter|param|unsupported|unknown field/.test(message);
}

async function callProfile(args: {
  method: "POST" | "DELETE";
  host: string;
  node: string;
  accessToken: string;
  body: Record<string, unknown>;
}): Promise<CallResult> {
  const { method, host, node, accessToken, body } = args;
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
        retryable: looksLikeFormatError(data?.error, res.status),
      };
    }
    return { ok: true };
  } catch (e: any) {
    // 네트워크 오류는 형식 문제가 아니다. 같은 요청을 다른 모양으로 바꿔도 소용없다.
    return { ok: false, error: e?.message || "아이스브레이커 요청 실패", retryable: false };
  }
}

/**
 * 등록 본문 후보.
 *
 * 인스타그램 문서가 두 갈래다. Messenger 플랫폼 문서는 `platform: "instagram"` 과
 * 각 그룹의 `locale`(기본값 `default`)을 **필수**로 적고, Instagram Login 문서의
 * 예시는 `platform` 없이 `ice_breakers` 만 보낸다. 어느 쪽을 요구하는지는 계정
 * 연동 방식에 따라 다르고, 틀리면 응답은 한결같이 `Invalid parameter` 라서 구분할
 * 단서가 없다. 그래서 문서에 나온 조합을 순서대로 시도한다.
 *
 * 등록은 덮어쓰기(전체 교체)이므로 여러 번 시도해도 질문이 중복되지 않는다.
 */
function bodyVariants(entries: IceBreakerEntry[]): { label: string; body: Record<string, unknown> }[] {
  const group = { call_to_actions: entries, locale: "default" };
  return [
    { label: "platform+locale", body: { platform: "instagram", ice_breakers: [group] } },
    { label: "locale", body: { ice_breakers: [group] } },
    {
      label: "platform",
      body: { platform: "instagram", ice_breakers: [{ call_to_actions: entries }] },
    },
    { label: "flat", body: { platform: "instagram", ice_breakers: entries } },
  ];
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

  const { host, nodes } = nodeCandidates(tokenSource, igId);
  const variants = bodyVariants(entries);
  let lastError = "";

  for (const node of nodes) {
    for (const variant of variants) {
      const attempt = await callProfile({ method: "POST", host, node, accessToken, body: variant.body });
      if (attempt.ok) {
        if (lastError) {
          console.warn(
            `[ice-breakers] registered with node=${node === "me" ? "me" : "ig-id"} variant=${variant.label} after ${lastError}`,
          );
        }
        return { ok: true };
      }
      lastError = attempt.error || lastError;
      console.warn(
        `[ice-breakers] attempt failed (node=${node === "me" ? "me" : "ig-id"}, variant=${variant.label}): ${attempt.error}`,
      );
      // 형식 문제가 아니면(권한·토큰) 다른 조합도 똑같이 실패한다. 바로 알린다.
      if (!attempt.retryable) return { ok: false, error: explain(lastError) };
    }
  }

  return { ok: false, error: explain(lastError) };
}

/**
 * Graph API 원문 오류에 사용자가 할 수 있는 일을 덧붙인다.
 *
 * `Invalid parameter` 한 줄만 보여주면 사용자는 무엇을 고쳐야 할지 알 수 없다.
 * 이 단계까지 왔다면 문서에 있는 본문 조합을 모두 거절당한 것이므로, 원인은 대개
 * 계정 쪽 조건(프로페셔널 계정 · DM 접근 허용 · 메시지 권한)이다.
 */
function explain(raw: string): string {
  if (!raw) return "아이스브레이커 등록에 실패했습니다.";
  if (/invalid parameter|param/i.test(raw)) {
    return (
      `${raw} — 인스타그램이 질문 등록 요청을 거부했습니다. ` +
      "질문을 4개 이하·각 80자 이내로 줄이고, 인스타그램 앱에서 설정 → 메시지 → " +
      "'다른 앱에서 메시지 접근 허용'이 켜져 있는지 확인해 주세요. 그래도 계속되면 " +
      "DM 자동화 화면에서 계정을 다시 연동해 주세요."
    );
  }
  return raw;
}

/** 등록된 질문을 모두 지운다(기능을 끌 때). */
export async function clearIceBreakers(args: {
  accessToken: string;
  tokenSource?: string;
  igId?: string;
}): Promise<IceBreakerSyncResult> {
  const { accessToken, tokenSource, igId } = args;
  if (!accessToken) return { ok: false, error: "액세스 토큰이 없습니다." };

  const { host, nodes } = nodeCandidates(tokenSource, igId);
  // 삭제도 `platform` 을 요구하는 계정이 있고, 반대로 거부하는 계정이 있다.
  const variants: Record<string, unknown>[] = [
    { platform: "instagram", fields: ["ice_breakers"] },
    { fields: ["ice_breakers"] },
  ];
  let lastError = "";

  for (const node of nodes) {
    for (const body of variants) {
      const attempt = await callProfile({ method: "DELETE", host, node, accessToken, body });
      if (attempt.ok) return { ok: true };
      lastError = attempt.error || lastError;
      if (!attempt.retryable) return { ok: false, error: explain(lastError) };
    }
  }
  return { ok: false, error: explain(lastError) };
}
