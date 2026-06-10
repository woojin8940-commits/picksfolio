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
  backgroundColor: '#050507',
} as const;

/**
 * Native live-broadcast (Amazon IVS) defaults.
 *
 * The native broadcast screen pushes the phone camera straight to an Amazon IVS
 * channel over RTMPS using the device's hardware encoder, replacing the old
 * WebView (getUserMedia) broadcast path. Ingest server + stream key are loaded
 * from the web app's `/api/stream-key/:username` endpoint (which is backed by
 * the seller's stored channel config) or typed in by hand. Everything else here
 * is the encoder profile: a portrait 1080p / 30fps target tuned for product
 * detail, matching the web broadcast's intent.
 */
export const broadcastConfig = {
  /** Fallback ingest server prefilled when the seller has no stored channel. */
  defaultIngestServer:
    'rtmps://9bb0dddfd063.global-contribute.live-video.net:443/app/',
  /**
   * Portrait 1080p encoder profile. `bitrate` values are in bits-per-second as
   * expected by amazon-ivs-react-native-broadcast. Auto-bitrate lets IVS dial
   * the rate down on weak uplinks instead of dropping frames.
   */
  video: {
    width: 1080,
    height: 1920,
    targetFrameRate: 30,
    keyframeInterval: 2 as const,
    bitrate: 6_000_000,
    minBitrate: 1_000_000,
    maxBitrate: 6_500_000,
    isAutoBitrate: true,
  },
  audio: {
    bitrate: 128_000,
  },
} as const;

