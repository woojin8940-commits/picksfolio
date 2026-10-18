import type { Config } from "@netlify/functions";
import { signLaunch, verifyAppLaunch } from "./_shared/cafe24-oauth.mts";

/**
 * 카페24 관리자에서 앱을 실행하면 들어오는 곳(개발자센터 App URL: https://picks-folio.com/cafe24/app).
 *
 * 카페24 는 `?auth_config(부운영자 · 공급사만)&is_multi_shop&lang&mall_id&nation&shop_no
 * &timestamp&user_id&user_name&user_type&hmac` 을 붙여 부른다. 문서('앱 실행 권한') 방식대로
 * hmac(클라이언트 시크릿 HMAC-SHA256, Base64)과 timestamp(5분 이내)를 확인한다 —
 * 규칙은 _shared/cafe24-oauth.mts 의 verifyAppLaunch.
 *
 * 통과하면 검증된 몰 아이디를 서명 값(launch, 10분)에 담아 쇼핑몰 연동 화면으로 보낸다.
 * 픽스폴리오 로그인 정보는 브라우저에만 있어 서버가 알 수 없다. 그래서 작은 페이지가
 * 돌아갈 주소를 sessionStorage 에 남긴 뒤 이동한다: 로그인돼 있으면 화면이 곧바로 연동을
 * 이어 가고, 아니면 브랜드 로그인 화면을 거친 뒤 같은 주소로 돌아와 이어 간다.
 */

const page = (title: string, body: string, script = "", status = 200) =>
  new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
main{background:#fff;border:1px solid #e2e8f0;border-radius:24px;padding:32px;max-width:420px;text-align:center}h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#64748b;line-height:1.6;margin:0}a{color:#2563eb;font-weight:700}</style>
</head><body><main>${body}</main>${script}</body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );

const REASON_TEXT: Record<string, string> = {
  stale_timestamp: "실행 요청이 만료되었습니다. 카페24 관리자에서 앱을 다시 실행해 주세요.",
  config: "연동 설정이 준비되지 않았습니다. 픽스폴리오 고객센터로 문의해 주세요.",
};

export default async (req: Request) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const result = verifyAppLaunch(url.search);

  if (!result.ok) {
    console.warn(`[cafe24-app] launch rejected (${result.reason})`);
    return page(
      "픽스폴리오 · 카페24",
      `<h1>요청을 확인하지 못했습니다</h1><p>${REASON_TEXT[result.reason] || "카페24 관리자 &gt; 앱 메뉴에서 픽스폴리오를 다시 실행해 주세요."}</p>`,
      "",
      result.reason === "config" ? 503 : 400,
    );
  }

  const launch = signLaunch(result.mallId);
  const target = `/business-admin?tab=shop-settings&cafe24_launch=${encodeURIComponent(launch)}`;
  // 브랜드 로그인 화면은 로그인을 마치면 이 값으로 돌아간다(App.tsx 의 picks_business_redirect).
  const script = `<script>(function(){var t=${JSON.stringify(target)};try{sessionStorage.setItem('picks_business_redirect',t)}catch(e){}location.replace(t)})();</script>`;
  return page(
    "픽스폴리오 · 카페24 연동",
    `<h1>픽스폴리오로 이동하는 중…</h1><p>자동으로 이동하지 않으면 <a href="${target}">여기</a>를 눌러 주세요.</p>`,
    script,
  );
};

export const config: Config = {
  path: ["/cafe24/app", "/cafe24/app/"],
};
