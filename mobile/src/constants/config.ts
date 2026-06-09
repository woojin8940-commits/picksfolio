/**
 * Runtime configuration for the PICKS Folio native shell.
 *
 * The native app is a thin wrapper around the production mobile web app, so
 * everything (login, Kakao OAuth, payments, live commerce, settlements …)
 * behaves exactly like the website. The only thing that needs configuring is
 * which web origin to load. `EXPO_PUBLIC_`-prefixed vars are inlined into the
 * JS bundle at build time, so the URL can be overridden per build/channel
 * without touching code.
 */
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://picks-folio.com';

export const config = {
  /** Origin of the production web app the shell renders. */
  webUrl: WEB_URL,
  brandName: 'PICKS Folio',
  /** Background shown behind the WebView (matches the web app canvas). */
  backgroundColor: '#0B0B0F',
} as const;
