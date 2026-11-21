import { INSTAGRAM_GRAPH_VERSION } from "./instagram-metrics.mts";

/**
 * DM 고정 메뉴(persistent menu) 동기화 — AI 공구 상담원 전용.
 *
 * 고객 DM 창 입력칸 옆 메뉴(☰)에 항상 보이는 버튼이다. 아이스브레이커는 대화를
 * 처음 여는 사람에게만 보이지만, 고정 메뉴는 이미 대화한 적 있는 고객도 언제든
 * 누를 수 있다. 그래서 상담원 시작 버튼을 아이스브레이커와 고정 메뉴 두 곳에 둔다.
 *
 * - 계정당 하나이고 받는 사람마다 다르게 보여줄 수 없다 → 버튼은 "공구 상품 문의" 하나뿐.
 * - 누르면 `postback` 웹훅으로 `AI_CONSULT_START_PAYLOAD` 가 돌아온다.
 * - 등록은 전체 교체라 여러 번 보내도 버튼이 중복되지 않는다.
 * - 아이스브레이커와 같은 messenger_profile 노드를 쓴다(필드만 다르다). 한쪽을 지워도
 *   다른 쪽은 그대로 남도록 DELETE 에는 항상 `fields` 를 지정한다.
 *
 * 권한: instagram_business_manage_messages (이미 심사 통과한 범위).
 */

const GRAPH_VERSION = INSTAGRAM_GRAPH_VERSION;

/** 상담원 시작 버튼의 postback 값(아이스브레이커 · 고정 메뉴 공통). */
export const AI_CONSULT_START_PAYLOAD = "aic_start";
/** 고객에게 보이는 버튼 문구. */
export const AI_CONSULT_BUTTON_LABEL = "🛍️ 공구 상품 문의";

export interface PersistentMenuSyncResult {
  ok: boolean;
  error?: string;
}

function target(tokenSource?: string, igId?: string): { host: string; nodes: string[] } {
  if (tokenSource === "instagram_login") {
    const nodes = [igId, "me"].filter(Boolean) as string[];
    return { host: "graph.instagram.com", nodes: [...new Set(nodes)] };
  }
  return { host: "graph.facebook.com", nodes: [igId || "me"] };
}

async function call(
  method: "POST" | "DELETE",
  host: string,
  node: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; retryable?: boolean }> {
  try {
    const res = await fetch(
      `https://${host}/${GRAPH_VERSION}/${encodeURIComponent(node)}/messenger_profile`,
      {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.error) {
      const code = Number(data?.error?.code);
      return {
        ok: false,
        error: data?.error?.message || `Graph API 오류 (HTTP ${res.status})`,
        // 토큰 · 권한 · 한도 오류는 본문 모양을 바꿔도 똑같이 실패한다.
        retryable: ![190, 200, 104, 10, 4, 17, 32, 613].includes(code) && (code === 100 || res.status === 400),
      };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "고정 메뉴 요청 실패", retryable: false };
  }
}

/** 고정 메뉴에 상담원 시작 버튼 하나를 등록한다. */
export async function syncAiConsultMenu(args: {
  accessToken: string;
  tokenSource?: string;
  igId?: string;
}): Promise<PersistentMenuSyncResult> {
  const { accessToken, tokenSource, igId } = args;
  if (!accessToken) return { ok: false, error: "액세스 토큰이 없습니다." };
  const button = { type: "postback", title: AI_CONSULT_BUTTON_LABEL, payload: AI_CONSULT_START_PAYLOAD };
  const group = { locale: "default", composer_input_disabled: false, call_to_actions: [button] };
  // 아이스브레이커와 같은 이유로 문서 두 갈래(platform 필수 / 생략)를 모두 시도한다.
  const variants = [
    { platform: "instagram", persistent_menu: [group] },
    { persistent_menu: [group] },
  ];
  const { host, nodes } = target(tokenSource, igId);
  let lastError = "";
  for (const node of nodes) {
    for (const body of variants) {
      const r = await call("POST", host, node, accessToken, body);
      if (r.ok) return { ok: true };
      lastError = r.error || lastError;
      console.warn(`[persistent-menu] attempt failed (node=${node === "me" ? "me" : "ig-id"}): ${r.error}`);
      if (!r.retryable) return { ok: false, error: lastError };
    }
  }
  return { ok: false, error: lastError || "고정 메뉴 등록에 실패했습니다." };
}

/** 고정 메뉴를 지운다(상담원을 끌 때). 아이스브레이커는 건드리지 않는다. */
export async function clearAiConsultMenu(args: {
  accessToken: string;
  tokenSource?: string;
  igId?: string;
}): Promise<PersistentMenuSyncResult> {
  const { accessToken, tokenSource, igId } = args;
  if (!accessToken) return { ok: false, error: "액세스 토큰이 없습니다." };
  const variants = [
    { platform: "instagram", fields: ["persistent_menu"] },
    { fields: ["persistent_menu"] },
  ];
  const { host, nodes } = target(tokenSource, igId);
  let lastError = "";
  for (const node of nodes) {
    for (const body of variants) {
      const r = await call("DELETE", host, node, accessToken, body);
      if (r.ok) return { ok: true };
      lastError = r.error || lastError;
      if (!r.retryable) return { ok: false, error: lastError };
    }
  }
  return { ok: false, error: lastError || "고정 메뉴를 지우지 못했습니다." };
}
