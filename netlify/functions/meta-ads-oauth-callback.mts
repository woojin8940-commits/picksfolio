import type { Config, Context } from "@netlify/functions";
import { consumeSignedState, sanitizeReturnPath } from "./_shared/oauth-state.mts";
import {
  appSecretProof,
  GRAPH_VERSION,
  MetaAdsAccount,
  MetaAdsDiagnosis,
  MetaAdsProbe,
  metaAdsAppId,
  metaAdsAppSecret,
  metaAdsRedirectUri,
  metaAdsScopes,
  writeMetaAdsDiagnosis,
  writeMetaAdsToken,
} from "./_shared/meta-ads.mts";

/**
 * 메타 광고 계정 연동 콜백 — 동의 화면에서 돌아온 code 를 진단 결과로 바꾼다.
 *
 * 하는 일:
 *   1) 서명된 state 검증·소비(어느 계정의 연동인지는 여기서만 정해진다).
 *   2) code → 액세스 토큰 교환.
 *   3) 그 토큰으로 네 가지를 물어본다 — 누구인지(/me), 무엇에 동의했는지
 *      (/me/permissions), 광고 계정(/me/adaccounts), 비즈니스(/me/businesses),
 *      그리고 첫 광고 계정의 캠페인(act_{id}/campaigns).
 *   4) 관리하는 페이스북 페이지(/me/accounts) — 광고 페이지 선택 목록의 출처.
 *   5) 토큰을 장기 토큰(60일)으로 바꿔 암호화해 저장하고, 진단 결과를 남긴다.
 *
 * 토큰을 저장하는 이유: '집행하기' 가 메타에 캠페인·광고 세트·소재·광고를 실제로 만들고,
 * 광고 현황이 상태·지표를, 광고 페이지 선택이 페이지 목록을 메타에서 읽어야 한다. 모두
 * 연동 뒤의 다른 요청에서 일어나는 일이라 토큰이 남아 있어야 한다. 토큰은 서버에만
 * 암호화해 두고 어떤 응답에도 싣지 않는다(meta-ads.mts 의 writeMetaAdsToken).
 *
 * 캠페인 조회를 굳이 한 번 해 보는 이유: 권한이 granted 로 찍혀 있어도 심사 전
 * 개발 모드에서는 자기 앱 관리자의 계정만 읽히고 그 밖에는 코드 200(권한 부족)으로
 * 막힌다. 그 차이는 권한 목록만 봐서는 알 수 없고, 실제로 한 번 읽어 봐야 나온다.
 */

/** 그래프 호출 한 번. 실패도 진단 결과이므로 던지지 않고 담아서 돌려준다. */
async function graph(
  path: string,
  token: string,
  proof: string,
  extra: Record<string, string> = {},
): Promise<{ probe: MetaAdsProbe; data: any }> {
  const params = new URLSearchParams({ access_token: token, ...extra });
  if (proof) params.set("appsecret_proof", proof);
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${path}?${params.toString()}`,
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.error) {
      return {
        probe: {
          ok: false,
          status: res.status,
          // 메시지에는 토큰이 실리지 않는다(그래프는 오류 문장만 돌려준다).
          error: String(data?.error?.message || `HTTP ${res.status}`),
          errorCode: Number(data?.error?.code) || undefined,
        },
        data,
      };
    }
    return { probe: { ok: true, status: res.status }, data };
  } catch (e) {
    return {
      probe: { ok: false, status: 0, error: (e as Error)?.message || "요청 실패" },
      data: {},
    };
  }
}

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const errorParam =
    url.searchParams.get("error_reason") || url.searchParams.get("error") || "";
  const stateRaw = url.searchParams.get("state") || "";

  // 광고 현황은 화면 상태로 열리는 하위 화면이라, 복귀 경로 없이 돌아오면 대시보드
  // 첫 화면에 떨어진다. state 를 검증하기 전에 실패하는 경우에는 아는 게 없으니
  // 비즈니스 대시보드로 보낸다(대시보드가 아래 파라미터를 보고 광고 현황을 연다).
  let returnPath = "/business/admin";

  const redirectBack = (params: Record<string, string>) => {
    const target = new URL(returnPath, origin);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    // 서명된 값이라고 그대로 믿지 않는다. 리다이렉트는 틀리면 조용히 외부로 나간다.
    if (target.origin !== origin) return Response.redirect(`${origin}/business/admin`, 302);
    return Response.redirect(target.toString(), 302);
  };

  const fail = (reason: string) => redirectBack({ meta_ads_error: reason });

  // 사람이 동의를 취소한 경우. code 없이 error 만 붙어 돌아온다.
  if (errorParam) return fail(errorParam);
  if (!code) return fail("missing_code");

  const verified = await consumeSignedState(stateRaw, req.headers.get("cookie"));
  if (!verified.ok) return fail(verified.error);
  // 인스타그램 연동과 서명 키를 함께 쓰므로, 이 콜백은 광고용으로 발급된 state 만 받는다.
  if (verified.payload.p !== "ads") return fail("bad_state_purpose");
  const username = verified.payload.u;
  if (!username) return fail("bad_state");
  returnPath = sanitizeReturnPath(verified.payload.r) || returnPath;

  const appId = metaAdsAppId();
  const appSecret = metaAdsAppSecret();
  if (!appId || !appSecret) return fail("missing_app_config");

  const redirectUri = metaAdsRedirectUri(origin);

  try {
    // 1) code → 액세스 토큰. 아래에서 장기 토큰으로 바꿔 암호화해 저장한다.
    const tokenParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    });
    const tokenRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${tokenParams.toString()}`,
    );
    const tokenData = (await tokenRes.json().catch(() => ({}))) as any;
    if (!tokenRes.ok || !tokenData?.access_token) {
      // 토큰은 로그에도 남기지 않는다. 남는 것은 오류 메시지뿐이다.
      console.error("[meta-ads] token exchange failed:", tokenData?.error?.message || tokenRes.status);
      return fail("token_exchange_failed");
    }
    let token: string = tokenData.access_token;
    let expiresIn = Number(tokenData.expires_in) || 0;

    // 단기 토큰(1~2시간)을 장기 토큰(60일)으로 바꾼다. 실패하면 단기 토큰을 그대로
    // 쓴다 — 연동 직후의 집행·조회는 되고, 만료되면 화면이 다시 연동을 안내한다.
    const longParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: token,
    });
    const longRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${longParams.toString()}`,
    );
    const longData = (await longRes.json().catch(() => ({}))) as any;
    if (longRes.ok && longData?.access_token) {
      token = String(longData.access_token);
      expiresIn = Number(longData.expires_in) || 60 * 24 * 60 * 60;
    } else {
      console.warn("[meta-ads] long-lived exchange failed:", longData?.error?.message || longRes.status);
    }
    const proof = appSecretProof(token, appSecret);

    // 2) 누구로 로그인했는지. 화면이 '연동된 계정' 으로 적어 주는 이름이다.
    const me = await graph("me", token, proof, { fields: "id,name" });

    // 3) 무엇에 동의했는지. 동의 화면에서 끈 권한은 declined 로 온다 — '거부'와
    //    '요청하지 않음'을 구별할 수 있는 유일한 출처다.
    const perms = await graph("me/permissions", token, proof);
    const granted: string[] = [];
    const declined: string[] = [];
    for (const row of Array.isArray(perms.data?.data) ? perms.data.data : []) {
      const name = String(row?.permission || "");
      if (!name) continue;
      if (row?.status === "granted") granted.push(name);
      else if (row?.status === "declined") declined.push(name);
    }
    if (perms.probe.ok) perms.probe.count = granted.length;

    // 4) 광고 계정. 화면의 '광고 계정 선택' 목록이 이 응답으로 채워진다.
    const adAccounts = await graph("me/adaccounts", token, proof, {
      fields: "id,account_id,name,currency,account_status,business{id,name}",
      limit: "50",
    });
    const accounts: MetaAdsAccount[] = (
      Array.isArray(adAccounts.data?.data) ? adAccounts.data.data : []
    ).map((row: any) => ({
      // /me/adaccounts 의 id 는 act_ 접두어를 포함해 온다. 없을 때만 붙인다.
      id: String(row?.id || "").startsWith("act_")
        ? String(row.id)
        : `act_${String(row?.account_id || row?.id || "")}`,
      name: String(row?.name || "이름 없는 광고 계정"),
      businessName: String(row?.business?.name || "비즈니스 미연결"),
      currency: String(row?.currency || ""),
      accountStatus: Number(row?.account_status) || undefined,
      businessId: row?.business?.id ? String(row.business.id) : undefined,
    }));
    if (adAccounts.probe.ok) adAccounts.probe.count = accounts.length;

    // 5) 비즈니스. 광고 계정이 어느 비즈니스에 매달렸는지 확인하는 용도다.
    const businessRes = await graph("me/businesses", token, proof, {
      fields: "id,name",
      limit: "50",
    });
    const businesses = (Array.isArray(businessRes.data?.data) ? businessRes.data.data : []).map(
      (row: any) => ({ id: String(row?.id || ""), name: String(row?.name || "") }),
    );
    if (businessRes.probe.ok) businessRes.probe.count = businesses.length;

    // 6) 첫 광고 계정의 캠페인. 권한이 실제로 데이터까지 내주는지는 이 호출에서만 드러난다.
    let campaigns: MetaAdsProbe;
    if (accounts.length === 0) {
      campaigns = {
        ok: false,
        status: 0,
        error: "이 Meta 계정에서 접근할 수 있는 광고 계정이 없어 캠페인을 조회하지 않았습니다.",
      };
    } else {
      const first = accounts[0].id;
      const res = await graph(`${first}/campaigns`, token, proof, {
        fields: "id,name,status,effective_status,objective",
        limit: "10",
      });
      campaigns = { ...res.probe, accountId: first };
      if (res.probe.ok) {
        campaigns.count = Array.isArray(res.data?.data) ? res.data.data.length : 0;
      }
    }

    // 7) 관리하는 페이스북 페이지(pages_show_list). 목록 자체는 화면이 열릴 때마다
    //    다시 읽고, 여기서는 권한이 실제로 데이터를 내주는지만 확인해 둔다.
    const pagesRes = await graph("me/accounts", token, proof, { fields: "id,name", limit: "100" });
    if (pagesRes.probe.ok) {
      pagesRes.probe.count = Array.isArray(pagesRes.data?.data) ? pagesRes.data.data.length : 0;
    }

    const tokenExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined;
    const tokenStored = await writeMetaAdsToken(username, token, {
      expiresAt: tokenExpiresAt,
      metaUserId: String(me.data?.id || ""),
    });

    const diagnosis: MetaAdsDiagnosis = {
      connected: true,
      connectedAt: new Date().toISOString(),
      metaUserId: String(me.data?.id || ""),
      metaUserName: String(me.data?.name || ""),
      scopesRequested: metaAdsScopes(),
      granted,
      declined,
      accounts,
      businesses,
      probes: {
        me: me.probe,
        permissions: perms.probe,
        adaccounts: adAccounts.probe,
        businesses: businessRes.probe,
        campaigns,
        pages: pagesRes.probe,
      },
      tokenStored,
      tokenExpiresAt: tokenStored ? tokenExpiresAt : undefined,
    };

    const saved = await writeMetaAdsDiagnosis(username, diagnosis);
    if (!saved || !tokenStored) return fail("diagnosis_store_failed");

    return redirectBack({ meta_ads_connected: "1" });
  } catch (e: any) {
    console.error("[meta-ads] callback error:", e?.message || e);
    return fail("unexpected_error");
  }
};

export const config: Config = {
  path: "/api/meta-ads/oauth/callback",
};
