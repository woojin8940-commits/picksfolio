/**
 * 인스타그램 계정별 웹훅 구독.
 *
 * Meta 앱 대시보드에 웹훅 콜백 URL 을 등록하는 것은 "앱" 수준 설정이고, 개별
 * 인스타그램 계정의 이벤트를 받으려면 계정 토큰으로 `subscribed_apps` 엣지를
 * 한 번 호출해 구독해야 한다. 이 호출이 빠지면 댓글 이벤트가 아예 도착하지
 * 않으므로 댓글 → 자동 DM / 자동 답글이 트리거되지 않는다.
 *
 * 계정 연동 직후(instagram-oauth-callback)와, 이미 연동된 계정이 자동화를
 * 저장할 때(api-dm-automation) 양쪽에서 호출한다.
 */

const GRAPH_VERSION = "v21.0";

/** 구독할 웹훅 필드 — 댓글(자동 답글·자동 DM 트리거)과 메시지. */
const SUBSCRIBED_FIELDS = "comments,messages";

export interface SubscribeResult {
  ok: boolean;
  error?: string;
}

export async function subscribeInstagramWebhooks(args: {
  accessToken: string;
  /** `instagram_login` 이면 graph.instagram.com, 그 외 구 페이지 토큰은 graph.facebook.com. */
  tokenSource?: string;
  /** 구 페이지 토큰 방식에서 대상 IG 계정 ID. Instagram Login 은 `me` 로 충분하다. */
  igId?: string;
}): Promise<SubscribeResult> {
  const { accessToken, tokenSource, igId } = args;
  if (!accessToken) return { ok: false, error: "액세스 토큰이 없습니다." };

  const host = tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com";
  const target = tokenSource === "instagram_login" ? "me" : igId || "me";

  try {
    const res = await fetch(
      `https://${host}/${GRAPH_VERSION}/${encodeURIComponent(target)}/subscribed_apps`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${accessToken}`,
        },
        body: new URLSearchParams({ subscribed_fields: SUBSCRIBED_FIELDS }),
      },
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.error) {
      return { ok: false, error: data?.error?.message || `Graph API 오류 (HTTP ${res.status})` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "웹훅 구독 요청 실패" };
  }
}
