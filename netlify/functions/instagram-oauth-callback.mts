import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

/**
 * 인스타그램 계정 연동 콜백.
 * - authorize 후 돌아온 code 를 단기 토큰 → 장기 토큰(60일)으로 교환한다.
 * - 연동한 계정의 user_id / username 을 조회해 사용자별 DM 자동화 설정
 *   (dm-automation 블롭)에 병합 저장한다. 기존 automations/rules 는 보존한다.
 * - 완료 후 앱으로 리다이렉트하며 결과를 쿼리스트링으로 전달한다.
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
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");
  const stateRaw = url.searchParams.get("state") || "";

  const fail = (reason: string) =>
    Response.redirect(`${origin}/?ig_error=${encodeURIComponent(reason)}`, 302);

  // 사용자가 동의를 취소한 경우
  if (errorParam) return fail(errorParam);
  if (!code) return fail("missing_code");

  let username = "";
  try {
    const parsed = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
    username = String(parsed?.u || "").toLowerCase().trim();
  } catch {
    /* ignore */
  }
  if (!username) return fail("bad_state");

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

    // 4) 설정 블롭에 병합 저장 (기존 automations/rules 보존)
    const store = getStore("dm-automation");
    const key = `dm_${username}`;
    const existing = ((await store.get(key, { type: "json" })) as DmSettings) || {};

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
    await store.setJSON(key, next);

    // 웹훅에서 IG 계정 → 우리 사용자명을 역추적하기 위한 인덱스.
    try {
      if (igUserId) {
        const index = getStore("dm-automation-index");
        await index.set(`ig_${igUserId}`, username);
      }
    } catch (e) {
      console.warn("[ig-oauth] index write failed:", e);
    }

    return Response.redirect(`${origin}/?ig_connected=1`, 302);
  } catch (e: any) {
    console.error("[ig-oauth] callback error:", e);
    return fail("unexpected_error");
  }
};

export const config: Config = {
  path: "/api/instagram/oauth/callback",
};
