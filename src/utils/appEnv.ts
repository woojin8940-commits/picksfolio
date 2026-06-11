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
