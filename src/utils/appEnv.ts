/**
 * Runtime environment helpers for the web app.
 *
 * The web app is also rendered inside the PICKS Folio native shell (a React
 * Native WebView, see `mobile/`). The shell injects a flag onto `window` *before*
 * the page loads (`mobile/app/index.tsx` → NATIVE_BRIDGE), so it is available
 * synchronously on first render.
 */

/**
 * True when the web app is running inside the native app's WebView.
 *
 * Used to hide in-app purchases of *digital* goods — membership subscriptions
 * and Claude AI credits — and any payment-inducing UI (upsell banners, plan
 * menus, "구독/충전" buttons). Apple App Store and Google Play require digital
 * goods to be sold through their own in-app purchase systems, so PICKS Folio
 * sells them on the website only. Physical-product checkout in live commerce is
 * a real-world good and is unaffected.
 */
export function isNativeApp(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as unknown as { __PICKSFOLIO_NATIVE__?: boolean }).__PICKSFOLIO_NATIVE__ === true
  );
}

/**
 * True on phones and tablets (native shell, mobile Safari/Chrome, the KakaoTalk
 * in-app browser …). Detected from the user agent, with a touch-capable
 * coarse-pointer fallback for iPads that report a desktop UA.
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (isNativeApp()) return true;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile|KAKAOTALK/i.test(ua)) return true;
  // iPadOS 13+ presents a macOS UA; it is still a touch device.
  return (
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  );
}

/**
 * True where a login is meant to last indefinitely instead of expiring after a
 * period of inactivity.
 *
 * On a phone — whether in the native shell or the mobile web app — the login is
 * a personal, device-bound one (Kakao 간편로그인 in practice), the OS already
 * gates access behind a passcode/biometrics, and being logged out mid-week is
 * pure friction: the user has to leave the app, bounce through KakaoTalk and
 * come back. So mobile sessions are kept alive for as long as Supabase can
 * refresh the token, and the 2-hour idle logout only applies on desktop, where
 * a browser is much more likely to be shared or left unattended.
 */
export function isPersistentLoginEnv(): boolean {
  return isMobileDevice();
}
