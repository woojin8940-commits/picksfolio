/**
 * 아이스브레이커(대화 시작 질문) 지우기.
 *
 * DM 창을 처음 여는 사람에게 인스타그램이 보여주던 "추천 질문" 버튼이다. 우리
 * 서비스에서는 "자주 묻는 질문"으로 불렀고, 그 기능은 지웠다. 다만 이 값은 우리
 * 블롭이 아니라 **인스타그램 프로필에 저장되는 값**이라, 기능을 지운 것만으로는
 * 사라지지 않는다. 예전에 등록해 둔 계정에서는 버튼이 계속 보이고 눌러도 아무
 * 답이 오지 않는다 — 받는 사람에게는 그냥 고장난 계정이다.
 *
 * 그래서 등록(syncIceBreakers)과 payload 해석은 지우고, "남은 것을 내리는" 호출만
 * 남겨 둔다. 설정 화면을 여는 길에 api-dm-automation 이 한 번 호출한다.
 *
 * 권한: `instagram_business_basic` + `instagram_business_manage_messages`.
 */

const GRAPH_VERSION = "v21.0";

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

export interface IceBreakerClearResult {
  ok: boolean;
  error?: string;
}

interface CallResult extends IceBreakerClearResult {
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
  method: "DELETE";
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
 * Graph API 원문 오류를 로그에 남길 문장으로 다듬는다.
 *
 * 이 호출은 사용자가 시킨 일이 아니라(기능은 이미 지웠다) 잔재를 치우는 일이라
 * 화면에 띄우지 않는다. 그래도 실패 이유는 남겨 둬야 "왜 어떤 계정에는 버튼이
 * 아직 보이는가"를 나중에 추적할 수 있다.
 */
function explain(raw: string): string {
  return raw || "아이스브레이커를 지우지 못했습니다.";
}

/** 인스타그램 프로필에 등록돼 있는 질문 버튼을 모두 지운다. */
export async function clearIceBreakers(args: {
  accessToken: string;
  tokenSource?: string;
  igId?: string;
}): Promise<IceBreakerClearResult> {
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
