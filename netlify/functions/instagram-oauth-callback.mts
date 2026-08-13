import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { subscribeInstagramWebhooks, WEBHOOK_FIELDS } from "./_shared/instagram-webhook-subscribe.mts";
import { consumeSignedState, sanitizeReturnPath } from "./_shared/oauth-state.mts";
import { syncChannelFromMeta } from "./_shared/instagram-metrics.mts";

/**
 * 인스타그램 계정 연동 콜백.
 * - authorize 후 돌아온 code 를 단기 토큰 → 장기 토큰(60일)으로 교환한다.
 * - 연동한 계정의 user_id / username 을 조회해 사용자별 보관함에 저장한다.
 *   보관함은 연동을 시작한 화면에 따라 갈린다(state 의 `p`).
 *     · 디엠 자동화  → dm-automation 블롭. 기존 automations/rules 는 보존한다.
 *     · 캠페인 등록  → collab-instagram 블롭. 캠페인 화면에서 직접 로그인한 계정만
 *       들어가고, 디엠 자동화 연동과 서로를 건드리지 않는다.
 * - 이어서 팔로워·팔로잉과 최근 릴스 평균 조회수를 받아 creator_channels 에 채운다.
 *   연동의 목적이 "픽스폴리오가 그 숫자를 갖고 있는 것"이므로, 동의한 순간 한 번은
 *   받아 둔다. 나중에 누가 갱신 버튼을 눌러 줄 때까지 명단이 비어 있으면 브랜드
 *   화면에서는 연동하지 않은 사람과 구별되지 않는다.
 * - 완료 후 state 에 서명해 둔 복귀 경로(없으면 /admin)로 리다이렉트하며 결과를
 *   쿼리스트링으로 전달한다.
 *
 * 참고: "Instagram API with Instagram Login" 방식이라 토큰은 graph.instagram.com
 * 엔드포인트에서 사용한다(페이스북 그래프 아님).
 */

interface DmSettings {
  enabled?: boolean;
  connected?: boolean;
  igUserId?: string;
  igAccountId?: string;
  igUsername?: string;
  accessToken?: string;
  tokenSource?: string;
  tokenExpiresAt?: string;
  automations?: unknown[];
  rules?: unknown[];
  updatedAt?: string;
  /** 계정별 웹훅(`subscribed_apps`) 구독을 마친 시각. */
  webhookSubscribedAt?: string;
  /** 마지막으로 구독을 건 필드 목록. 목록이 바뀌면 한 번 더 구독한다. */
  webhookFields?: string;
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");
  const stateRaw = url.searchParams.get("state") || "";

  // 연동 결과는 기본적으로 관리자 페이지의 DM 자동화 탭으로 복귀시킨다.
  // (/admin 경로 → admin 뷰, ?ig_connected/?ig_error → dm-automation 서브뷰 선택)
  // 브랜드 매칭 등록처럼 다른 화면에서 시작한 연동은 state 에 실려 온 경로로 돌아간다.
  // state 검증 전에 실패하는 경우에는 알 수 있는 게 없으니 기본값을 쓴다.
  let returnPath = "/admin";

  /** 복귀 경로에 결과 파라미터를 붙인다. 경로에 이미 쿼리가 있을 수 있다. */
  const redirectBack = (params: Record<string, string>) => {
    const target = new URL(returnPath, origin);
    for (const [key, value] of Object.entries(params)) {
      target.searchParams.set(key, value);
    }
    // sanitizeReturnPath 로 내부 경로만 통과시켰지만, 최종 목적지가 우리 도메인인지
    // 한 번 더 확인한다. 리다이렉트는 틀리면 조용히 외부로 나가는 종류의 실수다.
    if (target.origin !== origin) return Response.redirect(`${origin}/admin`, 302);
    return Response.redirect(target.toString(), 302);
  };

  const fail = (reason: string) => redirectBack({ ig_error: reason });

  // 사용자가 동의를 취소한 경우
  if (errorParam) return fail(errorParam);
  if (!code) return fail("missing_code");

  let username = "";
  // state 는 인증된 발급 경로(instagram-oauth-start, POST)에서만 만들어진 HMAC 서명값이다.
  // 서명·만료·1회용 nonce 를 모두 통과해야 어떤 계정에 저장할지 신뢰할 수 있다. 서명 없는
  // state 를 받아주면 임의의 사용자명으로 연동을 강제하는 CSRF 가 다시 열린다.
  const verified = await consumeSignedState(stateRaw);
  if (!verified.ok) return fail(verified.error);
  username = verified.payload.u;
  if (!username) return fail("bad_state");
  // 복귀 경로는 발급 때 검증했지만, 서명된 값이라고 그대로 믿지 않고 다시 통과시킨다.
  returnPath = sanitizeReturnPath(verified.payload.r) || returnPath;
  // 캠페인 등록 화면에서 시작한 연동인지. 아래 저장 위치가 이 값으로 갈린다.
  const isCollab = verified.payload.p === "collab";

  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) return fail("missing_app_config");

  const redirectUri = `${origin}/api/instagram/oauth/callback`;

  try {
    // 1) code → 단기 액세스 토큰
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    const shortData = (await shortRes.json().catch(() => ({}))) as any;
    if (!shortRes.ok || !shortData?.access_token) {
      console.error("[ig-oauth] short token error:", shortData);
      return fail("token_exchange_failed");
    }
    const shortToken: string = shortData.access_token;
    const userId: string = String(shortData.user_id || "");

    // 2) 단기 → 장기 토큰(60일)
    let longToken = shortToken;
    let expiresIn = 0;
    try {
      const longRes = await fetch(
        `https://graph.instagram.com/access_token?grant_type=ig_exchange_token` +
          `&client_secret=${encodeURIComponent(appSecret)}` +
          `&access_token=${encodeURIComponent(shortToken)}`,
      );
      const longData = (await longRes.json().catch(() => ({}))) as any;
      if (longRes.ok && longData?.access_token) {
        longToken = longData.access_token;
        expiresIn = Number(longData.expires_in || 0);
      }
    } catch (e) {
      console.warn("[ig-oauth] long token exchange failed, using short token:", e);
    }

    // 3) 프로필 조회 (username)
    let igUsername = "";
    let igUserId = userId;
    try {
      const meRes = await fetch(
        `https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(longToken)}`,
      );
      const meData = (await meRes.json().catch(() => ({}))) as any;
      if (meRes.ok) {
        igUsername = String(meData?.username || "");
        igUserId = String(meData?.user_id || userId);
      }
    } catch (e) {
      console.warn("[ig-oauth] profile fetch failed:", e);
    }

    // 4) 보관함에 저장
    //
    // 캠페인 연동은 방금 로그인한 계정 하나만 담는다. 지난 연동 정보를 물려받으면
    // 전에 붙여 뒀던 계정의 흔적(아이디·만료 표시)이 새 연동에 섞여, 화면이 지금
    // 로그인한 계정이 아닌 값을 보여 주게 된다. 디엠 자동화는 반대로 병합해야 한다 —
    // 그쪽 블롭에는 사람이 만들어 둔 자동 응답 규칙이 함께 들어 있다.
    const storeName = isCollab ? "collab-instagram" : "dm-automation";
    const key = isCollab ? `ig_${username}` : `dm_${username}`;
    const store = getStore({ name: storeName, consistency: "strong" });
    const existing = isCollab
      ? ({} as DmSettings)
      : ((await store.get(key, { type: "json" })) as DmSettings) || {};

    const next: DmSettings = {
      ...existing,
      connected: true,
      igUserId,
      igAccountId: igUserId, // 하위호환: 기존 필드에도 채워둔다
      igUsername: igUsername || existing.igUsername || "",
      accessToken: longToken,
      tokenSource: "instagram_login",
      tokenExpiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : existing.tokenExpiresAt,
      updatedAt: new Date().toISOString(),
    };
    // 방금 새 토큰을 받았다. 지난 토큰이 죽어 남겨 둔 재연동 표시를 여기서 지우지
    // 않으면, 재연동을 마치고 돌아온 화면이 계속 "다시 연동해 주세요"라고 말한다.
    delete (next as any).needsReauth;
    delete (next as any).tokenInvalidAt;
    await store.setJSON(key, next);

    // 웹훅 구독과 역추적 인덱스는 디엠 자동화(댓글·메시지 이벤트)를 위한 것이다.
    // 캠페인 연동은 지표를 읽기만 하므로 계정에 아무 것도 걸지 않는다.
    if (!isCollab) {
      // 웹훅에서 IG 계정 → 우리 사용자명을 역추적하기 위한 인덱스.
      try {
        if (igUserId) {
          const index = getStore({ name: "dm-automation-index", consistency: "strong" });
          await index.set(`ig_${igUserId}`, username);
        }
      } catch (e) {
        console.warn("[ig-oauth] index write failed:", e);
      }

      // 이 계정을 앱 웹훅에 구독시킨다. Meta 앱 대시보드에 콜백 URL 을 등록하는 것만으로는
      // 개별 계정의 이벤트가 오지 않고, 계정별로 `subscribed_apps` 를 호출해야 comments /
      // messages 이벤트가 실제로 전달된다. 이 호출이 빠지면 댓글 자동 DM·자동 답글이
      // 트리거 자체를 받지 못한다. 연동 자체를 막지는 않도록 실패는 경고로만 남긴다.
      const sub = await subscribeInstagramWebhooks({
        accessToken: longToken,
        tokenSource: "instagram_login",
        igId: igUserId,
      });
      if (sub.ok) {
        try {
          await store.setJSON(key, {
            ...next,
            webhookSubscribedAt: new Date().toISOString(),
            webhookFields: WEBHOOK_FIELDS,
          });
        } catch (e) {
          console.warn("[ig-oauth] subscribe flag write failed:", e);
        }
      } else {
        console.warn("[ig-oauth] webhook subscribe failed:", sub.error);
      }
    }

    // 동의한 순간 팔로워·팔로잉과 최근 릴스 평균 조회수를 한 번 받아 둔다.
    // 이게 연동의 목적이므로 여기서 실패하면 알려는 주되(ig_metrics=0), 연동 자체를
    // 되돌리지는 않는다. 토큰은 이미 저장됐으니 갱신 버튼으로 다시 시도할 수 있다.
    //
    // 데이터베이스 모듈은 여기서만 필요하고 optional dependency 라, 파일 맨 위에서
    // 정적으로 가져오면 그 모듈이 없는 환경에서 계정 연동 전체가 실패한다. 지표는
    // 부가 기능이고 연동은 그렇지 않으므로 필요한 순간에만 불러온다.
    let metricsSynced = false;
    /**
     * 방금 받아 온 숫자를 복귀 주소에 함께 실어 보낸다(캠페인 연동만).
     *
     * 여기서 이미 팔로워·조회수를 받아 저장했는데, 돌아간 화면은 그것을 모른 채
     * 다시 물어본다. 그 왕복 동안 연동을 마치고 온 사람은 "연동 상태 확인 중..."
     * 만 본다. 답을 알고 있으면서 기다리게 할 이유가 없다. 화면은 이 값으로 카드를
     * 먼저 그리고, 곧 도착하는 서버 응답으로 덮는다(정확한 값은 언제나 서버가 정한다).
     */
    let syncedSummary: Record<string, string> = {};
    try {
      const { getDatabase } = await import("@picks/netlify-database");
      const synced = await syncChannelFromMeta(
        getDatabase(),
        username,
        next,
        isCollab ? "collab" : "dm",
      );
      if (synced.ok) {
        metricsSynced = true;
        if (isCollab) {
          const row = (synced.row || {}) as any;
          syncedSummary = {
            ig_handle: String(row.instagram_handle || next.igUsername || ""),
            ig_followers: String(Math.max(0, Number(row.followers || 0))),
            ig_following: String(Math.max(0, Number(row.following || 0))),
            ig_views: String(Math.max(0, Number(row.avg_views || 0))),
          };
        }
      } else {
        console.warn("[ig-oauth] metrics sync failed:", synced.error);
      }
    } catch (e) {
      console.warn("[ig-oauth] metrics sync error:", (e as Error)?.message);
    }

    return redirectBack({
      ig_connected: "1",
      ig_metrics: metricsSynced ? "1" : "0",
      ...syncedSummary,
    });
  } catch (e: any) {
    console.error("[ig-oauth] callback error:", e);
    return fail("unexpected_error");
  }
};

export const config: Config = {
  path: "/api/instagram/oauth/callback",
};
