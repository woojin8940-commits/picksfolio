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

/**
 * 구독할 웹훅 필드.
 *
 * - `comments`       : 댓글 → 자동 답글·자동 DM 트리거.
 * - `messages`       : 받은 메시지.
 * - `message_echoes` : **계정이 보낸** 메시지 알림. 이게 없으면 이 앱을 거치지 않고
 *   나간 자동 DM(인스타그램 자체 자동 메시지, 예전에 연결해 둔 다른 자동화 서비스)을
 *   감지할 수 없다. 감지하지 못하면 "자동 발송을 껐는데도 예전 문구가 도착한다"의
 *   진짜 발신원을 화면에서 알려줄 방법이 없어, 사용자는 이 앱을 의심하게 된다.
 *
 * 에코 필드는 계정 연동 방식·앱 권한에 따라 거절될 수 있다. 그때 요청 전체가
 * 실패하면 댓글 구독까지 함께 날아가 자동화가 아예 트리거되지 않으므로, 거절되면
 * 기본 필드만으로 한 번 더 구독한다.
 */
export const WEBHOOK_FIELDS = "comments,messages,message_echoes";
const FALLBACK_FIELDS = "comments,messages";

export interface SubscribeResult {
  ok: boolean;
  error?: string;
  /** 실제로 구독에 성공한 필드 목록. 재구독이 필요한지 판단하는 데 쓴다. */
  fields?: string;
}

async function subscribeFields(args: {
  host: string;
  target: string;
  accessToken: string;
  fields: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { host, target, accessToken, fields } = args;
  try {
    const res = await fetch(
      `https://${host}/${GRAPH_VERSION}/${encodeURIComponent(target)}/subscribed_apps`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${accessToken}`,
        },
        body: new URLSearchParams({ subscribed_fields: fields }),
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

  const full = await subscribeFields({ host, target, accessToken, fields: WEBHOOK_FIELDS });
  if (full.ok) return { ok: true, fields: WEBHOOK_FIELDS };

  // 에코 필드가 거절된 경우. 댓글 구독만이라도 반드시 살려 둔다.
  console.warn("[ig-webhook-subscribe] echo field rejected, retrying without it:", full.error);
  const base = await subscribeFields({ host, target, accessToken, fields: FALLBACK_FIELDS });
  if (base.ok) return { ok: true, fields: FALLBACK_FIELDS };
  return { ok: false, error: base.error || full.error };
}
