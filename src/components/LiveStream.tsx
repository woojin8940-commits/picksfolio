
import React, { useState, useEffect, useCallback, useRef, useTransition } from 'react';
import { Users, MessageCircle, X, Send, Heart, LogIn, Loader2, Radio, Tv, ShoppingBag, ShoppingCart, Package, RefreshCw, Volume2, VolumeX, Wifi, CreditCard } from 'lucide-react';
import SafeImage from './SafeImage';
import { DEFAULT_AVATAR } from '../utils/defaultAvatar';
import { formatKRW, toAsciiSafeId } from '../utils/formatters';
import { trackClick } from '../services/analyticsService';
import { supabase } from '../services/supabase';
import { ViewerSignaling, ChatMessage, onTurnAllocationFailure } from '../services/webrtcSignaling';
import { apiService } from '../services/apiService';

declare global {
  interface Window {
    videojs?: any;
    PortOne?: any;
  }
}

// PortOne V2 — storeId and channelKey are public identifiers used by the
// browser SDK. The V2 API secret lives server-side only (PORTONE_V2_API_SECRET)
// and is used by /api/live-order-complete to verify payments.
const PORTONE_STORE_ID = 'store-1e85edf9-8f37-490c-9419-5a1f15db9ab5';
const PORTONE_KAKAOPAY_CHANNEL_KEY = 'channel-key-0abb70ff-069a-4a4f-9939-5e0c60298182';
const PORTONE_TOSSPAY_CHANNEL_KEY = 'channel-key-c110d840-4ee3-417d-9731-6f358e38e5c2';

// Extract a KRW integer price from a formatted string like "29,900원" → 29900.
// Returns 0 if no digits are present so the caller can decide to fall back to
// the external link for products without a structured price.
const parseKrwPrice = (raw: string | undefined): number => {
  if (!raw) return 0;
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
};

// Format a number to a Korean Won string used by cart/order payloads.
const formatKrwPrice = (amount: number): string => formatKRW(amount);

// For broadcast products, each option value can carry an override price and/or
// a discount %. Compute the effective unit price for the chosen variant:
//   - If any selected value has a price override, sum those (so add-on options
//     stack), otherwise fall back to the product's base price.
//   - Apply the largest discount among the selected values to that price.
const computeEffectivePrice = (
  product: any,
  selectedOptions?: Record<string, string>,
): number => {
  const basePrice = parseKrwPrice(product?.price);
  if (!product?.options || !selectedOptions) return basePrice;

  let overrideSum = 0;
  let hasOverride = false;
  let maxDiscount = 0;

  for (const opt of product.options as Array<{ name: string; values: any[] }>) {
    const chosen = selectedOptions[opt.name];
    if (!chosen) continue;
    const match = (opt.values || []).find((v: any) => (typeof v === 'string' ? v : v?.value) === chosen);
    if (match && typeof match === 'object') {
      if (typeof match.price === 'number' && match.price > 0) {
        overrideSum += match.price;
        hasOverride = true;
      }
      if (typeof match.discount === 'number' && match.discount > 0) {
        maxDiscount = Math.max(maxDiscount, Math.min(100, match.discount));
      }
    }
  }

  const unit = hasOverride ? overrideSum : basePrice;
  if (maxDiscount > 0) {
    return Math.max(0, Math.round(unit * (1 - maxDiscount / 100)));
  }
  return unit;
};

interface KakaoUser {
  nickname: string;
  profileImage?: string;
  provider?: 'kakao';
}

interface LiveStreamProps {
  username: string;
  currentProduct?: any;
  activeMaterial?: any;
  viewerCount: number;
  onClose: () => void;
  preConnectedSignaling?: ViewerSignaling | null;
}

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=3840&q=100';
const KAKAO_APP_KEY = typeof window !== 'undefined'
  ? (window as any).__KAKAO_APP_KEY__ || import.meta.env.VITE_KAKAO_APP_KEY || ''
  : '';

// Get IVS playback URL from env or fallback
const getPlaybackUrl = (): string => {
  return (typeof process !== 'undefined' && (process.env as any).VITE_IVS_PLAYBACK_URL) ||
    import.meta.env.VITE_IVS_PLAYBACK_URL || '';
};

const LiveStream: React.FC<LiveStreamProps> = ({ username, currentProduct, activeMaterial, viewerCount, onClose, preConnectedSignaling }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [likes, setLikes] = useState<number[]>([]);
  const [kakaoUser] = useState<KakaoUser | null>(() => {
    try {
      const saved = localStorage.getItem('picks_kakao_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Only accept Kakao-OAuth users; nickname-only entries (from
        // live-notify subscriptions) are not valid live-stream logins.
        if (parsed && parsed.nickname && parsed.provider === 'kakao') return parsed;
        return null;
      }
    } catch {}
    return null;
  });
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [liveConsentRequired, setLiveConsentRequired] = useState(false);
  const [liveConsentPrivacy, setLiveConsentPrivacy] = useState(false);
  const [liveConsentMarketing, setLiveConsentMarketing] = useState(false);
  const [showLiveConsentDetail, setShowLiveConsentDetail] = useState<null | 'privacy' | 'marketing'>(null);
  const [showChatOverlay, setShowChatOverlay] = useState(true);
  const [streamConnected, setStreamConnected] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [connectionState, setConnectionState] = useState<string>('connecting');
  const [streamMode, setStreamMode] = useState<'auto' | 'webrtc' | 'hls'>('auto');
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [hlsFailed, setHlsFailed] = useState(false);
  // Preflight live-state: before wasting 20s on a WebRTC handshake that will
  // never produce frames (because the broadcaster isn't live), ask the server
  // once on mount. `null` = not checked yet, `true` = live, `false` = offline.
  const [broadcastLive, setBroadcastLive] = useState<boolean | null>(null);
  // Track whether the <video> element is currently muted so the UI can surface
  // a persistent "tap for sound" button. Mobile autoplay policy forces muted
  // start, and many viewers never realize they need to tap — so we keep a
  // button visible the whole time audio is silenced.
  const [isVideoMuted, setIsVideoMuted] = useState(true);
  // Surfaced when the mobile relay-fallback timer escalates the viewer to
  // TURN-relay-only mode. Without visible feedback, mobile users watching a
  // blank screen can't tell whether the app is stuck or recovering.
  const [relayEscalating, setRelayEscalating] = useState(false);
  // Shown when every configured TURN server reports a hard allocate/auth
  // failure. Means the app cannot relay this viewer at all — usually a sign
  // that the TURN service has expired credentials or exhausted its quota.
  const [turnUnavailable, setTurnUnavailable] = useState(false);
  // One-time cellular/data-saver warning. Shown on cellular or when the user
  // has Data Saver enabled, and dismissed per-session.
  const [showDataWarning, setShowDataWarning] = useState(false);
  const lastConnectingDiagnosticsAtRef = useRef(0);
  // --- Diagnostic state (mobile debugging) ---
  const [lastErrorInfo, setLastErrorInfo] = useState<{
    source: string;
    code: string | number;
    message: string;
    at: string;
  } | null>(null);
  const [onStreamCallCount, setOnStreamCallCount] = useState(0);
  const pageProtocol = typeof window !== 'undefined' ? window.location.protocol : 'unknown';
  // Diagnostic banner/overlay is ON for normal users only when `?debug=1` is
  // present in the URL. Without this guard, every viewer sees a terminal-style
  // banner that is useful for debugging but looks broken to a real customer.
  const debugMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
  // Kakao in-app WebView has the worst WebRTC / TURN support of any major in-app
  // browser — even with relay-forced mode and the TURN fallback, a large share
  // of KakaoTalk viewers never receive a frame. For these WebViews we prefer
  // HLS-first (served via IVS CDN) because HLS over plain HTTPS is what in-app
  // WebViews handle most reliably. The external-browser banner stays up as an
  // escape hatch in case HLS is not configured for the broadcaster.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isKakaoInApp = /KAKAOTALK/i.test(ua);
  const isNaverInApp = /NAVER\(inapp/i.test(ua) || /; ?NAVER /i.test(ua);
  const isLineInApp = /\bLine\//i.test(ua);
  const isFacebookInApp = /FB_IAB|FBAN|FBAV|Instagram/i.test(ua);
  const isIOSInApp = /iPhone|iPad|iPod/i.test(ua) && (isKakaoInApp || isNaverInApp || isLineInApp || isFacebookInApp);
  const isInAppBrowser = isKakaoInApp || isNaverInApp || isLineInApp || isFacebookInApp || isIOSInApp;
  // Detect the specific in-app label for diagnostics reporting.
  const inAppLabel = isKakaoInApp ? 'kakao' : isNaverInApp ? 'naver' : isLineInApp ? 'line' : isFacebookInApp ? 'fb/ig' : (isIOSInApp ? 'ios-inapp' : '');
  const [inAppBannerDismissed, setInAppBannerDismissed] = useState(false);
  const showInAppBrowserBanner = isInAppBrowser && !inAppBannerDismissed;
  const openInExternalBrowser = useCallback(() => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (!url) return;
    try {
      if (isKakaoInApp) {
        // KakaoTalk in-app: this scheme asks KakaoTalk to open the URL in the OS default browser.
        window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
        return;
      }
      if (isLineInApp) {
        // LINE in-app: the `?openExternalBrowser=1` query param forces LINE to
        // open the URL in the system browser instead of its WebView.
        const u = new URL(url);
        u.searchParams.set('openExternalBrowser', '1');
        window.location.href = u.toString();
        return;
      }
      if (isNaverInApp && /Android/i.test(ua)) {
        // Naver in-app on Android: `intent://...#Intent;...;end` fires a system
        // intent that Android resolves to the default browser.
        const stripped = url.replace(/^https?:\/\//, '');
        window.location.href = `intent://${stripped}#Intent;scheme=https;package=com.android.chrome;end`;
        return;
      }
      // Generic iOS in-app browsers (Instagram, Facebook, etc.) have no reliable
      // escape scheme, so the best we can do is prompt the user to long-press the
      // address bar or tap the "open in Safari" button. Surface an alert with the
      // URL so they can copy it manually as a last resort.
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).catch(() => {});
      }
      alert('우측 상단 메뉴에서 "Safari로 열기" 또는 "다른 브라우저로 열기"를 선택해주세요.\n주소가 클립보드에 복사되었습니다.');
    } catch (e) {
      console.warn('[LiveStream] openInExternalBrowser failed:', e);
    }
  }, [isKakaoInApp, isLineInApp, isNaverInApp, ua]);

  // Wrap setConnectionFailed(true) with reason capture so the UI can expose *why* it failed
  const failConnection = useCallback((source: string, code: string | number, message: string) => {
    const info = { source, code, message, at: new Date().toISOString() };
    const webrtcDiagnostics = signalingRef.current?.getDiagnostics?.();
    console.error('[LiveStream][FAIL]', info);
    if (webrtcDiagnostics) {
      console.warn('[LiveStream][ICE][snapshot]', webrtcDiagnostics);
    }
    setLastErrorInfo(info);
    setConnectionFailed(true);
    // Ship a copy to the server so we can review real-world failures from
    // in-app WebViews where devtools cannot attach.
    apiService.reportViewerError(username, {
      userAgent: ua,
      pageProtocol,
      inApp: inAppLabel,
      isMobile: /Android|iPhone|iPad|iPod|Mobile|KAKAOTALK|NAVER|Line|FB_IAB|Instagram/i.test(ua),
      isRelayOnly: !!signalingRef.current?.isRelayOnly?.(),
      onStreamCallCount,
      webrtc: webrtcDiagnostics,
      error: info,
    });
  }, [username, ua, pageProtocol, inAppLabel, onStreamCallCount]);
  // Record a diagnostic reason without flipping connectionFailed (used by HLS path, which has its own flag)
  const recordErrorInfo = useCallback((source: string, code: string | number, message: string) => {
    const info = { source, code, message, at: new Date().toISOString() };
    const webrtcDiagnostics = signalingRef.current?.getDiagnostics?.();
    console.error('[LiveStream][ERR]', info);
    if (webrtcDiagnostics) {
      console.warn('[LiveStream][ICE][snapshot]', webrtcDiagnostics);
    }
    setLastErrorInfo(info);
    apiService.reportViewerError(username, {
      userAgent: ua,
      pageProtocol,
      inApp: inAppLabel,
      isMobile: /Android|iPhone|iPad|iPod|Mobile|KAKAOTALK|NAVER|Line|FB_IAB|Instagram/i.test(ua),
      isRelayOnly: !!signalingRef.current?.isRelayOnly?.(),
      onStreamCallCount,
      webrtc: webrtcDiagnostics,
      error: info,
    });
  }, [username, ua, pageProtocol, inAppLabel, onStreamCallCount]);
  const [errorCopied, setErrorCopied] = useState(false);
  const copyErrorDetails = useCallback(() => {
    if (!lastErrorInfo) return;
    const payload = [
      '[PICKS 방송 오류]',
      `username: ${username}`,
      `source: ${lastErrorInfo.source}`,
      `code: ${lastErrorInfo.code}`,
      `message: ${lastErrorInfo.message}`,
      `at: ${lastErrorInfo.at}`,
      `inApp: ${inAppLabel || 'none'}`,
      `onStream: ${onStreamCallCount}`,
      `proto: ${pageProtocol}`,
      `UA: ${ua}`,
    ].join('\n');
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(payload).then(() => {
          setErrorCopied(true);
          setTimeout(() => setErrorCopied(false), 2000);
        }).catch(() => {
          window.prompt('오류 정보를 복사해 운영팀에 보내주세요:', payload);
        });
      } else {
        window.prompt('오류 정보를 복사해 운영팀에 보내주세요:', payload);
      }
    } catch {}
  }, [lastErrorInfo, username, inAppLabel, onStreamCallCount, pageProtocol, ua]);
  // Diagnostic block: shown to anyone on an in-app browser (KakaoTalk/Instagram/
  // Naver/Line/Facebook WebView) when playback fails, so the viewer can see the
  // actual reason instead of a generic "connection failed" message. Also shown
  // with ?debug=1 on any browser. The error has already been shipped to the
  // server via reportViewerError — this panel just surfaces it locally so the
  // viewer can screenshot / copy it to the operator.
  const errorDetailsPanel = (debugMode || isInAppBrowser) && lastErrorInfo ? (
    <div className="mx-4 mb-4 px-3 py-2 rounded-lg border border-red-500 bg-black/70 font-mono text-center max-w-[92%] break-words">
      <p className="text-red-400 text-[11px] font-bold mb-1">[방송이 뜨지 않는 이유]</p>
      <p className="text-red-500 text-base font-black leading-tight">
        {lastErrorInfo.source}
      </p>
      <p className="text-red-400 text-sm font-bold leading-tight">
        code: {String(lastErrorInfo.code)}
      </p>
      <p className="text-red-300 text-[11px] mt-1 leading-snug">
        {lastErrorInfo.message}
      </p>
      <p className="text-red-300/80 text-[10px] mt-1">
        브라우저: {inAppLabel || 'default'} · onStream: {onStreamCallCount > 0 ? `✓ ${onStreamCallCount}x` : '✗ NEVER'} · proto: {pageProtocol.toUpperCase()}
      </p>
      <p className="text-red-300/50 text-[9px] mt-0.5">{lastErrorInfo.at}</p>
      <button
        onClick={copyErrorDetails}
        className="mt-2 w-full text-[11px] font-bold text-red-100 bg-red-900/50 border border-red-400/50 rounded px-2 py-1 active:scale-95"
      >
        {errorCopied ? '복사됨 ✓' : '오류 정보 복사'}
      </button>
    </div>
  ) : null;
  const reconnectAttemptsRef = useRef(0);
  // Mirrors the latest RTCPeerConnection state reported by `onConnectionState`.
  // Needed by async decisions (e.g. the 8s "no frames" check) that run inside
  // setTimeouts where the React `connectionState` closure is stale.
  const pcStateRef = useRef<string>('connecting');
  const videoMetadataLoadedRef = useRef(false);
  const webrtcEverConnectedRef = useRef(false);
  const relayFallbackTriedRef = useRef(false);
  const MAX_RECONNECT_ATTEMPTS = 3;

  // Cart state
  const [cartItems, setCartItems] = useState<{ productId: string; productName: string; productPrice?: string; productImage?: string; productLink: string; selectedOptions?: Record<string, string> }[]>([]);
  const [cartAdding, setCartAdding] = useState(false);
  const [cartAddedId, setCartAddedId] = useState<string | null>(null);
  const [showCartList, setShowCartList] = useState(false);
  const [showOptionPicker, setShowOptionPicker] = useState(false);
  const [pendingOptions, setPendingOptions] = useState<Record<string, string>>({});
  // When the viewer taps "바로 결제" on a product with options, we show the
  // option picker first and then flip into checkout mode once options confirm.
  const [optionPickerMode, setOptionPickerMode] = useState<'cart' | 'checkout'>('cart');
  // Checkout (simple pay) state for the PortOne-backed in-player purchase flow.
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutPayMethod, setCheckoutPayMethod] = useState<'KAKAOPAY' | 'TOSSPAY'>('KAKAOPAY');
  const [checkoutProcessing, setCheckoutProcessing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [checkoutProduct, setCheckoutProduct] = useState<any | null>(null);
  const [checkoutOptions, setCheckoutOptions] = useState<Record<string, string> | undefined>(undefined);
  // Batch checkout (multiple cart items at once) state
  const [showBatchCheckout, setShowBatchCheckout] = useState(false);
  const [batchPayMethod, setBatchPayMethod] = useState<'KAKAOPAY' | 'TOSSPAY'>('KAKAOPAY');
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchSuccess, setBatchSuccess] = useState(false);
  const viewerIdRef = useRef<string>((() => {
    try {
      const saved = localStorage.getItem('picks_viewer_id');
      if (saved) return saved;
    } catch {}
    const id = 'v_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('picks_viewer_id', id);
    return id;
  })());
  const [, startTransition] = useTransition();
  const [hlsReady, setHlsReady] = useState(false);
  const [hlsPlaybackUrl, setHlsPlaybackUrl] = useState<string>('');
  const videoResetCountRef = useRef(0); // Track how many times we've reset the video element
  const lastStreamRef = useRef<MediaStream | null>(null); // Keep reference to last assigned stream
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsVideoRef = useRef<HTMLVideoElement>(null);
  const videojsPlayerRef = useRef<any>(null);
  const signalingRef = useRef<ViewerSignaling | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Helper: reset the video element and re-assign the stream to unstick the decoder
  const resetVideoElement = useCallback(() => {
    const vid = videoRef.current;
    const stream = lastStreamRef.current;
    if (!vid || !stream) return false;

    videoResetCountRef.current += 1;
    const attempt = videoResetCountRef.current;
    console.log(`[LiveStream] Resetting video element (attempt ${attempt}) to unstick decoder`);

    // Step 1: Detach and fully reset the video element
    vid.pause();
    vid.srcObject = null;
    vid.removeAttribute('src');
    vid.load(); // Force the browser to reset internal decoder state

    // Step 2: Re-assign stream after a microtask to let the browser clean up
    setTimeout(() => {
      if (!videoRef.current || lastStreamRef.current !== stream) return;
      const v = videoRef.current;
      v.muted = true;
      v.autoplay = true;
      v.playsInline = true;
      v.srcObject = stream;
      console.log(`[LiveStream] Video element reset complete, re-assigned srcObject (readyState=${v.readyState})`);

      const tryPlay = () => {
        if (!videoRef.current) return;
        videoRef.current.muted = true;
        videoRef.current.play().then(() => {
          console.log('[LiveStream] play() succeeded after video reset');
          setVideoPlaying(true);
          setNeedsTap(false);
        }).catch(() => {});
      };

      // Try play immediately, and also on the next loadedmetadata/canplay
      tryPlay();
      v.addEventListener('loadedmetadata', tryPlay, { once: true });
      v.addEventListener('canplay', tryPlay, { once: true });
    }, 50);

    return true;
  }, []);

  // Preflight: is the broadcaster actually live right now? Without this, a
  // viewer who opens the page when the host hasn't started (or has ended) sits
  // on a black loading screen for ~20s until the WebRTC timeout fires. Ask the
  // server once on mount and re-check if it returned "not live", so stale
  // results self-heal when the broadcaster comes online moments later.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const state = await apiService.getLiveState(username);
      if (cancelled) return;
      // Treat a null response (network error, 404) as "unknown" and leave the
      // loader showing — flashing an "offline" message for a transient fetch
      // failure is worse than waiting for the next poll to clarify.
      if (state === null) return;
      setBroadcastLive(!!state.isLive);
    };
    check();
    // Re-poll while we still think the broadcast is offline, so the UI flips
    // automatically the moment the host goes live. Stops once live is confirmed
    // (the existing 5s interval at the bottom handles the live→offline case).
    const interval = setInterval(() => {
      if (!cancelled) check();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [username]);

  // Cellular / Data Saver warning. Mobile carriers charge by the GB, and live
  // video over WebRTC can burn ~500 MB/hour. Give the viewer one explicit
  // heads-up before playback, so they can close the tab if they're not on
  // Wi-Fi. Dismissal is session-local.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return;
    const isCellular = conn.type === 'cellular' || /cellular/i.test(String(conn.effectiveType));
    const isSaveData = conn.saveData === true;
    const isSlow = /^(slow-2g|2g|3g)$/i.test(String(conn.effectiveType));
    if (isCellular || isSaveData || isSlow) {
      try {
        if (sessionStorage.getItem('picks_data_warning_dismissed') === '1') return;
      } catch {}
      setShowDataWarning(true);
    }
  }, []);

  const dismissDataWarning = useCallback(() => {
    setShowDataWarning(false);
    try {
      sessionStorage.setItem('picks_data_warning_dismissed', '1');
    } catch {}
  }, []);

  // Toggle mute/unmute on the active video element. Used by the persistent
  // "tap for sound" button so the user can enable audio at any point — not
  // only during the initial autoplay overlay. Covers both WebRTC and HLS
  // video elements since either can be the active source.
  const toggleMute = useCallback(() => {
    const webrtcVid = videoRef.current;
    const hlsVid = hlsVideoRef.current;
    const active = (hlsVid && !hlsVid.paused) ? hlsVid : (webrtcVid || hlsVid);
    if (!active) return;
    const next = !active.muted;
    try {
      if (webrtcVid) webrtcVid.muted = next;
      if (hlsVid) hlsVid.muted = next;
      if (!next) {
        // On iOS Safari, setting muted=false alone doesn't always resume
        // audio — an explicit play() inside the user gesture does.
        active.play().catch(() => {});
      }
      setIsVideoMuted(next);
    } catch (e) {
      console.warn('[LiveStream] toggleMute failed:', e);
    }
  }, []);

  // Keep the isVideoMuted state in sync with the actual <video> elements so
  // the button label reflects reality (e.g. after programmatic resets).
  useEffect(() => {
    const unsubscribe = onTurnAllocationFailure(({ failedUrls, totalTurnUrls }) => {
      console.error(`[LiveStream] TURN unavailable — ${failedUrls.length}/${totalTurnUrls} URLs hard-failed`);
      setTurnUnavailable(true);
      // Last-ditch: the tightest recovery path is to force relay mode, which
      // will at least give any remaining healthy TURN URL a fresh chance.
      try {
        signalingRef.current?.forceRelayReconnect();
      } catch (e) {
        console.warn('[LiveStream] forceRelayReconnect failed:', e);
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const vid = videoRef.current;
    const hls = hlsVideoRef.current;
    if (!vid && !hls) return;
    const sync = () => {
      const activeEl = (hls && !hls.paused) ? hls : (vid || hls);
      setIsVideoMuted(activeEl ? activeEl.muted : true);
    };
    vid?.addEventListener('volumechange', sync);
    hls?.addEventListener('volumechange', sync);
    sync();
    return () => {
      vid?.removeEventListener('volumechange', sync);
      hls?.removeEventListener('volumechange', sync);
    };
  }, [streamConnected, videoPlaying]);

  // Connect to broadcaster's stream via WebRTC
  useEffect(() => {
    // Use pre-connected signaling if available (already connected, faster stream start)
    const signaling = preConnectedSignaling || new ViewerSignaling(username);
    signalingRef.current = signaling;
    let streamAssignTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStreamId = '';
    // Track event listeners to prevent accumulation across stream reconnects
    let currentVideoErrorHandler: (() => void) | null = null;
    let currentPlayingHandler: (() => void) | null = null;
    // Track ended listeners on video tracks to clean them up when a new stream arrives
    let currentTrackEndedCleanups: (() => void)[] = [];

    signaling.onStream((stream) => {
      // Claim this stream as the current one *synchronously*, before the debounced
      // srcObject assignment runs. The `track.ended` listener below compares
      // `lastStreamRef.current` against `currentStream` to decide whether the
      // ended event belongs to a stale stream — if we wait until the setTimeout
      // below to update the ref, a quickly-following renegotiation can fire
      // `ended` on this new stream's tracks in the gap and incorrectly skip the
      // reset (or vice versa). Note: `webrtcEverConnectedRef.current` is NOT set
      // here any more — it's set only when the first frame actually renders
      // (see `onPlaying` below). Treating track arrival as "ever connected"
      // caused the `connection=failed` branch to mis-classify never-rendered
      // streams as "transient", blocking the HLS fallback and recovery paths.
      lastStreamRef.current = stream;
      setOnStreamCallCount(prev => prev + 1);
      console.log('[LiveStream] Received remote stream, tracks:', stream.getTracks().map(t => `${t.kind}:${t.readyState}:enabled=${t.enabled}`).join(', '));

      // --- Video track validation & forced activation ---
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length === 0) {
        console.error('[LiveStream] No video tracks in received stream – audio-only?');
        return; // Wait for video track before assigning
      } else {
        // Clean up old track ended listeners before adding new ones
        currentTrackEndedCleanups.forEach(cleanup => cleanup());
        currentTrackEndedCleanups = [];

        videoTracks.forEach((track, i) => {
          if (!track.enabled) {
            console.warn(`[LiveStream] Video track ${i} was disabled, forcing enabled`);
            track.enabled = true;
          }
          if (track.readyState !== 'live') {
            console.warn(`[LiveStream] Video track ${i} readyState="${track.readyState}" (expected "live")`);
          }
          const settings = track.getSettings();
          console.log(`[LiveStream] Video track ${i} settings:`, JSON.stringify(settings));

          // Monitor track ended events — if a track ends, the stream is dead
          // Only trigger reset if the track still belongs to the current stream
          const currentStream = stream;
          const onEnded = () => {
            if (lastStreamRef.current !== currentStream) return; // Stale track, ignore
            console.warn(`[LiveStream] Video track ${i} ended — stream may be dead, triggering video reset`);
            if (videoResetCountRef.current < 3) {
              resetVideoElement();
            }
          };
          track.addEventListener('ended', onEnded);
          currentTrackEndedCleanups.push(() => track.removeEventListener('ended', onEnded));
        });
      }

      // Skip if same stream already assigned (prevents AbortError from repeated srcObject assignments)
      const streamId = stream.id;
      if (streamId === lastStreamId && videoRef.current?.srcObject === stream) {
        console.log('[LiveStream] Same stream already assigned, skipping');
        return;
      }

      // Debounce srcObject assignment to avoid rapid play/abort cycles
      if (streamAssignTimer) clearTimeout(streamAssignTimer);
      streamAssignTimer = setTimeout(() => {
        // Re-check inside debounce: stream may already be assigned by a prior callback
        if (streamId === lastStreamId && videoRef.current?.srcObject === stream) {
          console.log('[LiveStream] Same stream already assigned after debounce, skipping');
          return;
        }
        lastStreamId = streamId;

      reconnectAttemptsRef.current = 0;
      videoMetadataLoadedRef.current = false;
      videoResetCountRef.current = 0; // Reset counter for new stream
      setStreamConnected(true);
      setConnectionState('connected');
      setConnectionFailed(false);
      setNeedsTap(false);
      setRelayEscalating(false);
      if (videoRef.current) {
        const video = videoRef.current;

        // Fully reset the video element before assigning new stream
        // This prevents decoder stuck states, especially in in-app browsers (Kakao)
        video.pause();
        video.srcObject = null;
        video.removeAttribute('src');
        video.load();

        // Force all autoplay-critical attributes BEFORE assigning srcObject
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.setAttribute('muted', '');
        video.setAttribute('autoplay', '');

        // Assign after a microtask to let browser finish cleanup
        setTimeout(() => {
          if (!videoRef.current) return;
          const vid = videoRef.current;
          vid.srcObject = stream;
          lastStreamRef.current = stream; // Store reference for reset helper
          console.log('[LiveStream] srcObject assigned after reset, video.readyState:', vid.readyState,
            'paused:', vid.paused, 'muted:', vid.muted, 'srcObject tracks:',
            stream.getTracks().map(t => `${t.kind}:${t.readyState}`).join(', '));
        }, 10);

        // --- Error handler: detect broken stream / format errors and auto-reconnect ---
        // Remove previous error handler to prevent accumulation
        if (currentVideoErrorHandler) {
          video.removeEventListener('error', currentVideoErrorHandler);
        }
        const onVideoError = () => {
          const mediaError = videoRef.current?.error;
          const code = mediaError?.code ?? 'unknown';
          const message = mediaError?.message ?? 'no message';
          console.error(`[LiveStream] Video element error – code=${code}, message="${message}"`);

          // If the stream is broken, attempt automatic reconnect
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current += 1;
            console.warn(`[LiveStream] Auto-reconnecting after video error (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);
            if (signalingRef.current) {
              setConnectionState('connecting');
              setStreamConnected(false);
              setVideoPlaying(false);
              signalingRef.current.reconnect();
            }
          } else {
            console.error('[LiveStream] Max reconnect attempts reached after video error');
            failConnection('video-element-error', code, `Max reconnect attempts after video error: ${message}`);
          }
        };
        currentVideoErrorHandler = onVideoError;
        video.addEventListener('error', onVideoError);

        // Detect actual video frame rendering
        // Remove previous playing handler to prevent accumulation
        if (currentPlayingHandler) {
          video.removeEventListener('playing', currentPlayingHandler);
        }
        const onPlaying = () => {
          console.log('[LiveStream] Video is actually playing');
          // Only consider the WebRTC path "ever connected" once a real frame has
          // rendered. Before this point, the peer connection can fail and the
          // HLS fallback is still a valid recovery path. Moving this assignment
          // here (out of `onStream`) fixes the mobile-viewer case where
          // tracks arrive but the decoder stays at readyState=0 and the
          // "transient failure" branch in onConnectionState('failed') would
          // otherwise permanently block recovery.
          webrtcEverConnectedRef.current = true;
          setVideoPlaying(true);
          setNeedsTap(false);
        };
        currentPlayingHandler = onPlaying;
        video.addEventListener('playing', onPlaying);

        // In-flight guard: multiple code paths can call attemptPlay nearly
        // simultaneously (loadedmetadata, canplay, loadeddata, readyState
        // poll, visibility handlers). Without a guard, their `play()`
        // promises race and cancel each other via
        // `AbortError: interrupted by a call to pause()` when the reset path
        // calls `vid.pause()`. The guard lets only one play attempt be in
        // flight at a time; subsequent callers short-circuit.
        //
        // IMPORTANT: we no longer kick off an eager `setTimeout(attemptPlay,
        // 60)`. The browser fires `loadedmetadata` as soon as the decoder has
        // enough to know stream geometry — calling `play()` before that
        // frequently produces the `play() request was interrupted by a call
        // to pause()` race when the video element gets reset a few ms later.
        // Waiting for `loadedmetadata` (or `canplay` as a fallback) ensures
        // the element is actually ready to render when we ask it to play.
        let playInFlight = false;
        const attemptPlay = (retryCount = 0) => {
          if (!videoRef.current) return;
          if (playInFlight) {
            console.log(`[LiveStream] attemptPlay(${retryCount}) skipped — play() already in flight`);
            return;
          }
          const vid = videoRef.current;
          // Guarantee autoplay-critical attributes are still set. Something
          // else in the pipeline (a reset, a track replace) may have flipped
          // them; re-assert before calling play() so the promise doesn't
          // reject with NotAllowedError on iOS Safari / in-app WebViews.
          vid.muted = true;
          vid.playsInline = true;
          vid.setAttribute('playsinline', 'true');
          vid.setAttribute('webkit-playsinline', 'true');
          // Defensive: only call play() when the element has data. If we're
          // invoked before `loadedmetadata`, short-circuit — the readiness
          // event handler below will re-invoke us once metadata lands.
          if (vid.readyState === 0) {
            console.log(`[LiveStream] attemptPlay(${retryCount}) deferred — readyState=0, waiting for loadedmetadata`);
            return;
          }
          console.log(`[LiveStream] attemptPlay(${retryCount}): readyState=${vid.readyState}, paused=${vid.paused}, srcObject=${!!vid.srcObject}`);
          const playPromise = vid.play();
          if (playPromise !== undefined) {
            playInFlight = true;
            playPromise.then(() => {
              playInFlight = false;
              console.log('[LiveStream] play() succeeded on attempt', retryCount + 1);
              setVideoPlaying(true);
              setNeedsTap(false);
              // Do NOT auto-unmute here — on iOS Safari, programmatically setting
              // muted=false after muted autoplay causes the browser to pause the video
              // (unmuted playback requires a user gesture). Unmuting is handled by
              // explicit user interaction listeners below.
            }).catch((err) => {
              playInFlight = false;
              // AbortError is benign — it means another code path already called
              // pause()/load() (typically the reset path). We don't retry on
              // AbortError because the new reset will trigger its own play()
              // via its onLoadedMetadata/onCanPlay handlers.
              if (err && err.name === 'AbortError') {
                console.log('[LiveStream] play() aborted by concurrent pause/load (attempt ' + (retryCount + 1) + ') — not retrying');
                return;
              }
              console.warn('[LiveStream] play() rejected (attempt ' + (retryCount + 1) + '):', err.name, err.message);
              if (retryCount < 3) {
                // Retry muted autoplay after a short delay, increasing delay each time
                setTimeout(() => attemptPlay(retryCount + 1), 300 * (retryCount + 1));
              } else {
                console.error('[LiveStream] All play() attempts exhausted, showing tap overlay');
                // All retries failed - show tap overlay
                setNeedsTap(true);
              }
            });
          }
        };
        // Consolidate the three readiness events so only the first to fire
        // triggers the play attempt. This is now the ONLY place `play()` is
        // invoked during normal stream setup — removing the eager 60ms timer
        // eliminates the `play() request was interrupted by a call to
        // pause()` race.
        let readinessHandled = false;
        const onReadiness = (label: string) => () => {
          console.log(`[LiveStream] ${label} fired, readyState:`, video.readyState);
          videoMetadataLoadedRef.current = true;
          if (readinessHandled) return;
          readinessHandled = true;
          if (video.paused) attemptPlay(0);
        };
        video.addEventListener('loadedmetadata', onReadiness('loadedmetadata'), { once: true });
        video.addEventListener('canplay', onReadiness('canplay'), { once: true });
        video.addEventListener('loadeddata', onReadiness('loadeddata'), { once: true });

        // Periodic readyState check: some browsers/in-app webviews don't reliably fire
        // canplay/loadedmetadata for WebRTC streams. Poll readyState for the first 20s.
        let readyCheckCount = 0;
        const readyCheckInterval = setInterval(() => {
          readyCheckCount++;
          const vid = videoRef.current;
          if (!vid || readyCheckCount > 10) { // 10 checks × 2s = 20s
            clearInterval(readyCheckInterval);
            return;
          }
          console.log(`[LiveStream] readyState check #${readyCheckCount}: readyState=${vid.readyState}, paused=${vid.paused}, currentTime=${vid.currentTime}`);
          if (vid.readyState >= 2 && vid.paused) {
            console.log('[LiveStream] readyState >= 2 but paused, retrying play');
            attemptPlay(0);
          }
          // If readyState is still 0 after 4 checks (8s) and we have live tracks,
          // the decoder is likely stuck — this is handled by the 8s timeout below
        }, 2000);

        // Early recovery: if the decoder has produced no frames after 8s, decide
        // whether the problem is "RTP never arrived" (ICE/DTLS not yet
        // connected) or "decoder stuck with data flowing".
        //
        //   * If the peer connection is not in `connected` state, element reset
        //     is useless — no packets are arriving. Ask signaling to reconnect
        //     so the broadcaster emits a fresh offer (and a fresh keyframe).
        //
        //   * If the peer connection IS connected but currentTime never
        //     advanced, the decoder is probably stuck. A video-element reset
        //     is the right tool here. We still don't show the tap overlay at
        //     8s — that's reserved for the 15s safety timeout so the viewer
        //     isn't flashed with a manual-start prompt during normal ICE
        //     gathering on cellular.
        setTimeout(() => {
          if (!videoRef.current) return;
          const vid = videoRef.current;
          const hasStream = !!vid.srcObject;
          const noFrames = vid.currentTime === 0 || vid.readyState === 0;
          if (!hasStream || vid.ended || !noFrames) return;
          const pcState = pcStateRef.current;
          if (pcState !== 'connected') {
            // RTP path not established yet — reset would only interrupt the
            // handshake. Nudge signaling instead so the broadcaster sends a
            // new offer + keyframe.
            console.warn(`[LiveStream] No frames after 8s and pc=${pcState} — asking signaling to reconnect (skip element reset)`);
            if (signalingRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttemptsRef.current += 1;
              signalingRef.current.reconnect();
            }
            return;
          }
          console.warn(`[LiveStream] No frames after 8s (readyState=${vid.readyState}, paused=${vid.paused}, currentTime=${vid.currentTime}) with pc=connected — resetting video element to unstick decoder`);
          resetVideoElement();
        }, 8000);

        // Safety timeout: if video hasn't started playing within 15s, show the
        // tap-to-play overlay so the user has an interactive escape hatch. If
        // readyState is still 0 by now:
        //   - when pc !== 'connected', a full signaling reconnect is the only
        //     recovery that can produce RTP flow. Ask for it.
        //   - when pc === 'connected', the decoder is stuck; a video element
        //     reset is the right tool.
        setTimeout(() => {
          if (!videoRef.current) return;
          const vid = videoRef.current;
          const isActuallyPlaying = !vid.paused && vid.readyState >= 2 && vid.currentTime > 0;
          if (!isActuallyPlaying && !vid.ended) {
            console.warn(`[LiveStream] Video not actually playing after 15s (readyState=${vid.readyState}, paused=${vid.paused}, currentTime=${vid.currentTime}), showing tap overlay`);
            setNeedsTap(true);
            if (vid.readyState === 0) {
              const pcState = pcStateRef.current;
              if (pcState !== 'connected') {
                if (signalingRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
                  console.warn(`[LiveStream] 15s timeout with pc=${pcState} — signaling reconnect instead of element reset`);
                  reconnectAttemptsRef.current += 1;
                  signalingRef.current.reconnect();
                }
              } else if (videoResetCountRef.current < 3) {
                resetVideoElement();
              }
            } else if (vid.readyState >= 1) {
              attemptPlay(0);
            }
          }
        }, 15000);
      }
      }, 30); // End of debounce timer
    });

    signaling.onConnectionState((state) => {
      pcStateRef.current = state;
      setConnectionState(state);
      if (state === 'connected') {
        setStreamConnected(true);
        setConnectionFailed(false);
        // NOTE: Do NOT set webrtcEverConnectedRef here. PC=connected means
        // ICE+DTLS succeeded, but the decoder can still be stuck at
        // readyState=0 with zero frames rendered (common in Kakao in-app
        // WebView on Android). The ref is intentionally set only from
        // `onPlaying` so it reflects actual frame delivery. Setting it on
        // PC=connected re-introduces the "transient failure" mis-classification
        // that blocks the HLS fallback when frames never arrive.
        // Only clear needsTap if the video is actually rendering frames.
        // A Kakao in-app WebView peer connection can oscillate through
        // connected→disconnected→connected while the decoder is still stuck at
        // readyState=0 (no frames). Unconditionally clearing needsTap here would
        // hide the tap-to-play overlay the safety timeouts just tried to show,
        // leaving the user staring at a blank blue screen with no way to recover.
        const vid = videoRef.current;
        const isActuallyPlaying = vid && !vid.paused && vid.readyState >= 2 && vid.currentTime > 0;
        if (isActuallyPlaying) {
          setNeedsTap(false);
        }
        if (vid && vid.paused) {
          vid.muted = true;
          vid.play().then(() => {
            setVideoPlaying(true);
            setNeedsTap(false);
          }).catch(() => {});
        }
      } else if (state === 'failed') {
        // Only mark as failed if WebRTC never successfully played video
        // If video was playing, this is a transient failure — reconnect will handle it
        const vid = videoRef.current;
        const isPlaying = vid && !vid.paused && vid.readyState >= 2;
        if (!isPlaying && !webrtcEverConnectedRef.current) {
          setStreamConnected(false);
          setVideoPlaying(false);
          setNeedsTap(false);
          failConnection('peer-connection-state', 'failed', 'RTCPeerConnection reported state="failed" before any video frame rendered');
        } else {
          // WebRTC was working, treat as transient — signaling reconnect will handle it
          console.log('[LiveStream] Connection failed but video was playing/connected before, treating as transient');
        }
      } else if (state === 'disconnected') {
        // Don't reset state on transient disconnects — WebRTC may recover within seconds
        // Check video element directly (state closure would be stale)
        const isPlaying = videoRef.current && !videoRef.current.paused && videoRef.current.readyState >= 2;
        if (!isPlaying) {
          setStreamConnected(false);
        }
        setNeedsTap(false);
      } else if (state === 'connecting' || state === 'new') {
        // Distinguish "pc is still handshaking" from "pc is fully connected".
        // While connecting, there's no media to tap on, so the tap overlay
        // must stay hidden and streamConnected must reflect that we're not
        // ready yet. Previously the tap overlay could flash during an ICE
        // restart because streamConnected lingered as true from the prior
        // connected cycle.
        setNeedsTap(false);
        const isPlaying = videoRef.current && !videoRef.current.paused && videoRef.current.readyState >= 2 && videoRef.current.currentTime > 0;
        if (!isPlaying) {
          setStreamConnected(false);
        }
      }
    });

    // Listen for incoming chat messages from broadcaster and other viewers
    signaling.onChat((msg) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    // Only call connect() if we're NOT using a pre-connected signaling (it's already connected)
    if (!preConnectedSignaling) {
      signaling.connect();
    }

    return () => {
      if (streamAssignTimer) clearTimeout(streamAssignTimer);
      // Clean up accumulated event listeners
      if (videoRef.current) {
        if (currentVideoErrorHandler) videoRef.current.removeEventListener('error', currentVideoErrorHandler);
        if (currentPlayingHandler) videoRef.current.removeEventListener('playing', currentPlayingHandler);
      }
      // Clean up track ended listeners
      currentTrackEndedCleanups.forEach(cleanup => cleanup());
      currentTrackEndedCleanups = [];
      signaling.disconnect();
      signalingRef.current = null;
    };
  }, [username]);

  // Send viewer heartbeat to server for accurate viewer count tracking
  useEffect(() => {
    const viewerId = viewerIdRef.current;
    const encodedUsername = encodeURIComponent(username.toLowerCase());

    const sendHeartbeat = () => {
      fetch(`/api/live/${encodedUsername}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ heartbeat: true, viewerId })
      }).catch(() => {});
    };

    const sendLeave = () => {
      // Use sendBeacon for reliable delivery on page unload
      const payload = JSON.stringify({ leave: true, viewerId });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`/api/live/${encodedUsername}`, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(`/api/live/${encodedUsername}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(() => {});
      }
    };

    // Send initial heartbeat immediately
    sendHeartbeat();

    // Send heartbeat every 15 seconds
    const interval = setInterval(sendHeartbeat, 15000);

    // Send leave on page unload
    window.addEventListener('beforeunload', sendLeave);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', sendLeave);
      sendLeave();
    };
  }, [username]);

  // Fetch HLS playback URL from stream key API
  useEffect(() => {
    const fetchPlaybackUrl = async () => {
      try {
        const config = await apiService.getStreamKey(username);
        if (config?.playbackUrl) {
          setHlsPlaybackUrl(config.playbackUrl);
        } else {
          // Fallback to env variable
          const envUrl = getPlaybackUrl();
          if (envUrl) setHlsPlaybackUrl(envUrl);
        }
      } catch {
        const envUrl = getPlaybackUrl();
        if (envUrl) setHlsPlaybackUrl(envUrl);
      }
    };
    fetchPlaybackUrl();
  }, [username]);

  // Track videojs readiness
  const [videojsLoaded, setVideojsLoaded] = useState(!!window.videojs);

  useEffect(() => {
    if (window.videojs) {
      setVideojsLoaded(true);
      return;
    }
    // Poll for videojs availability (loaded from external script in index.html)
    let elapsed = 0;
    const POLL_INTERVAL = 200;
    const LOAD_TIMEOUT = 20000; // 20s — mobile networks (3G/weak LTE/in-app WebView) often need longer than 8s
    const interval = setInterval(() => {
      elapsed += POLL_INTERVAL;
      if (window.videojs) {
        setVideojsLoaded(true);
        clearInterval(interval);
      } else if (elapsed >= LOAD_TIMEOUT) {
        console.warn('[LiveStream] Video.js CDN failed to load within timeout — HLS fallback unavailable');
        // Mark HLS as failed so the error UI shows a reconnect button instead of a spinner
        recordErrorInfo('hls-videojs-cdn', 'load-timeout', `Video.js CDN did not load within ${LOAD_TIMEOUT}ms — HLS fallback unavailable`);
        setHlsFailed(true);
        clearInterval(interval);
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // Initialize Video.js HLS player for high-quality playback — only when HLS mode is active
  // Skip if WebRTC has ever connected (the IVS HLS URL won't have content for WebRTC-only streams)
  useEffect(() => {
    if (!hlsPlaybackUrl || !hlsVideoRef.current) return;
    if (!videojsLoaded || !window.videojs) return;
    // Only initialize Video.js when we're actually in HLS mode to avoid 404 errors on WebRTC streams
    if (streamMode !== 'hls') return;
    // If WebRTC ever connected successfully, IVS HLS URL is likely inactive (404)
    if (webrtcEverConnectedRef.current) {
      console.log('[LiveStream] Skipping HLS init — WebRTC was active, IVS URL likely inactive');
      return;
    }

    // Dispose previous player
    if (videojsPlayerRef.current) {
      videojsPlayerRef.current.dispose();
      videojsPlayerRef.current = null;
    }

    const player = window.videojs(hlsVideoRef.current, {
      autoplay: 'muted',
      muted: true,
      controls: false,
      preload: 'auto',
      fluid: true,
      responsive: true,
      fill: true,
      playsinline: true,
      html5: {
        vhs: {
          overrideNative: !(/iPad|iPhone|iPod/.test(navigator.userAgent)),
          // Start probing at a quality that matches a typical connection so
          // VHS reaches the top rendition quickly. On modern home/office Wi-Fi
          // and LTE/5G, seeding a realistic estimate avoids wasting the first
          // few seconds on the lowest rendition.
          enableLowInitialPlaylist: false,
          // Seed bandwidth at 8 Mbps so ABR can immediately select the top
          // rendition when available, then adapt downward if the real network
          // can't keep up. Previous 2.5 Mbps seed pinned viewers to mid
          // quality for the first 10+ seconds of playback.
          bandwidth: 8_000_000,
          maxPlaylistRetries: 10,
          smoothQualityChange: true,
          allowSeeksWithinUnsafeLiveWindow: true,
          handlePartialData: true,
          // Hold ~20s of already-played segments. Larger back-buffer absorbs
          // brief network stalls so the decoder can keep drawing frames
          // instead of spinning. Still small enough that memory stays bounded.
          backBufferLength: 20,
          // Let VHS base ABR decisions on buffer occupancy rather than only
          // instantaneous bandwidth. This smooths out quality switches and
          // resists the common "stutter → downshift → upshift" oscillation
          // that mobile networks provoke.
          experimentalBufferBasedABR: true,
          // Pull low-latency CMAF partial segments as soon as they're available
          // so the viewer sees new frames without waiting for a full segment to
          // finish on the origin.
          useNetworkInformationApi: true,
          fastQualityChange_: true,
        },
        nativeAudioTracks: /iPad|iPhone|iPod/.test(navigator.userAgent),
        nativeVideoTracks: /iPad|iPhone|iPod/.test(navigator.userAgent),
      },
      liveui: true,
      liveTracker: {
        trackingThreshold: 0.2,
        // Tighter tolerance so the player snaps back to the live edge after a
        // brief re-buffer instead of drifting several seconds behind the
        // broadcaster. The catch-up playback-rate logic below smooths the
        // resulting jump so viewers don't see a hard seek.
        liveTolerance: 10,
      },
    });

    player.src({
      src: hlsPlaybackUrl,
      type: 'application/x-mpegURL',
    });

    player.on('playing', () => {
      setHlsReady(true);
      console.log('[Video.js] HLS stream playing');
      // Try to unmute after playback starts (mobile autoplay workaround)
      const tryUnmute = () => {
        player.muted(false);
      };
      document.addEventListener('touchstart', tryUnmute, { once: true });
      document.addEventListener('click', tryUnmute, { once: true });
    });

    // Live-edge catch-up: if the viewer drifts more than 4s behind the live
    // edge (typically after a re-buffer, tab-switch, or network blip), nudge
    // playback rate up to 1.1× until the gap closes. This removes the
    // perceptible broadcaster/viewer delay without the jarring jump of a hard
    // currentTime seek. The rate is reset back to 1.0 as soon as we're within
    // 1s of the edge so audio pitch doesn't stay noticeably altered.
    const catchUpHandler = () => {
      try {
        const tech = player.tech && player.tech({ IWillNotUseThisInPlugins: true });
        const seekable = player.seekable();
        if (!seekable || !seekable.length) return;
        const liveEdge = seekable.end(seekable.length - 1);
        const current = player.currentTime();
        const behind = liveEdge - current;
        if (behind > 4 && player.playbackRate() < 1.09) {
          player.playbackRate(1.1);
        } else if (behind < 1 && player.playbackRate() > 1) {
          player.playbackRate(1.0);
        }
        // Hard-seek escape hatch: if the drift grows past 12s even with the
        // rate bump, the rate nudge clearly isn't enough — jump to the live
        // edge so the broadcaster action the viewer sees matches what's
        // happening now.
        if (behind > 12 && tech && typeof player.currentTime === 'function') {
          try { player.currentTime(Math.max(liveEdge - 0.5, 0)); } catch {}
        }
      } catch {}
    };
    const catchUpTimer = setInterval(catchUpHandler, 1000);

    player.on('error', (e: any) => {
      console.error('[Video.js] Error:', e);
      const err = player.error?.();
      const code = err?.code ?? 'unknown';
      const message = err?.message ?? (typeof e === 'string' ? e : 'Video.js error');
      recordErrorInfo('hls-videojs', code, message);
      setHlsReady(false);
      setHlsFailed(true);
    });

    // Let VHS manage quality adaptively. Previously this block force-enabled only
    // the top-rendition, which caused chronic re-buffering on mobile networks the
    // top bitrate couldn't sustain — the classic cause of stuttery mobile HLS
    // playback. Allowing all renditions lets the adaptive bitrate algorithm pick
    // the best quality the connection can actually maintain.

    videojsPlayerRef.current = player;

    return () => {
      clearInterval(catchUpTimer);
      if (videojsPlayerRef.current) {
        videojsPlayerRef.current.dispose();
        videojsPlayerRef.current = null;
      }
    };
  }, [hlsPlaybackUrl, videojsLoaded, streamMode]);

  // Auto-fallback to HLS when WebRTC connection fails and HLS is available (and not already failed)
  // Triple lock: never switch if video played, WebRTC ever connected, or video element has data
  useEffect(() => {
    // If any remote track has ever been delivered via WebRTC, the IVS HLS URL is
    // almost certainly inactive (broadcaster is on the WebRTC ingest path), so an
    // HLS fallback would fail with MEDIA_ERR_SRC_NOT_SUPPORTED. Stay on WebRTC and
    // let the video-element reset / tap-to-play paths recover the stalled decoder.
    if (onStreamCallCount > 0) return;
    if (connectionFailed && hlsPlaybackUrl && streamMode === 'auto' && !videoPlaying && !hlsFailed && !webrtcEverConnectedRef.current) {
      // Extra DOM check: if video element has any data, WebRTC is working
      const vid = videoRef.current;
      if (vid && (vid.readyState > 0 || vid.currentTime > 0 || videoMetadataLoadedRef.current)) {
        console.log('[LiveStream] WebRTC has data, skipping HLS fallback despite connectionFailed');
        return;
      }
      console.log('[LiveStream] WebRTC failed (never connected), auto-switching to HLS');
      setStreamMode('hls');
    }
  }, [connectionFailed, hlsPlaybackUrl, streamMode, videoPlaying, hlsFailed, onStreamCallCount]);

  // HLS-first preference for in-app WebViews (KakaoTalk, Naver, Line, Instagram,
  // Facebook). These browsers have chronically unreliable WebRTC — even with
  // relay-only mode and aggressive retries, many viewers never receive a frame.
  // HLS over plain HTTPS is what their WebView decoders handle most reliably,
  // so when the broadcaster exposes an HLS playback URL we skip WebRTC entirely
  // and go straight to HLS. Users who end up here still see the in-app banner
  // recommending an external browser as the fallback for higher quality + lower
  // latency. WebRTC signaling continues to run in the background, so if HLS
  // somehow fails we can flip back. We do NOT touch users who have already
  // received frames via WebRTC — rare but possible on newer WebView builds.
  useEffect(() => {
    if (!isInAppBrowser) return;
    if (!hlsPlaybackUrl) return;
    if (streamMode !== 'auto') return;
    if (webrtcEverConnectedRef.current) return;
    console.log(`[LiveStream] In-app WebView (${inAppLabel}) detected with HLS URL — preferring HLS-first`);
    setStreamMode('hls');
  }, [isInAppBrowser, inAppLabel, hlsPlaybackUrl, streamMode]);

  // If HLS fails in an in-app WebView, fall back to WebRTC one last time
  // instead of showing a dead-end error. WebRTC signaling has been running in
  // the background since mount, so flipping streamMode is enough to reveal
  // whatever frames it has produced.
  useEffect(() => {
    if (!isInAppBrowser) return;
    if (!hlsFailed) return;
    if (streamMode !== 'hls') return;
    console.warn('[LiveStream] HLS failed in in-app WebView — falling back to WebRTC');
    setStreamMode('webrtc');
  }, [isInAppBrowser, hlsFailed, streamMode]);

  // Auto-fallback to HLS if WebRTC hasn't connected within a mobile-friendly timeout and HLS URL exists (and HLS not failed)
  // Only triggers if WebRTC never connected at all (first attempt only)
  useEffect(() => {
    if (onStreamCallCount > 0) return; // Tracks already arriving — stay on WebRTC
    if (streamConnected || videoPlaying || connectionFailed || streamMode !== 'auto' || !hlsPlaybackUrl || hlsFailed) return;
    if (webrtcEverConnectedRef.current) return; // WebRTC worked before, don't fallback
    // Use shorter timeout on mobile — 20s leaves mobile viewers staring at a blank screen for too long.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobile = /Android|iPhone|iPad|iPod|Mobile|KAKAOTALK|NAVER|Line|FB_IAB|Instagram/i.test(ua);
    // On mobile, try TURN-relay fallback first (which bypasses carrier-grade NAT
    // symmetric-NAT blocks on direct P2P) before falling all the way back to HLS.
    // This follows the blog's ICE/STUN/TURN recovery path and keeps the viewer on
    // the low-latency WebRTC stream whenever the relay path is usable.
    // 9s (not 7s) gives slower cellular ICE gathering a better chance to finish
    // an answer before we tear it down and escalate.
    const relayRetryMs = isMobile ? 9000 : 20000;
    const fallbackMs = isMobile ? 16000 : 20000;
    const relayTimer = setTimeout(() => {
      if (streamConnected || videoPlaying || connectionFailed || hlsFailed) return;
      if (!signalingRef.current) return;
      if (relayFallbackTriedRef.current) return;
      if (signalingRef.current.isRelayOnly()) return;
      const vid = videoRef.current;
      if (vid && (vid.readyState > 0 || vid.currentTime > 0)) return;
      console.log(`[LiveStream] WebRTC no frames after ${relayRetryMs}ms (isMobile=${isMobile}) — escalating to TURN-relay-only retry`);
      relayFallbackTriedRef.current = true;
      setRelayEscalating(true);
      signalingRef.current.forceRelayReconnect();
    }, relayRetryMs);
    const timeout = setTimeout(() => {
      if (!streamConnected && !videoPlaying && !connectionFailed && hlsPlaybackUrl && !hlsFailed && !webrtcEverConnectedRef.current) {
        // Final DOM check before switching
        const vid = videoRef.current;
        if (vid && (vid.readyState > 0 || vid.currentTime > 0)) {
          console.log('[LiveStream] Video element has data, skipping HLS fallback');
          return;
        }
        console.log(`[LiveStream] WebRTC not connected after ${fallbackMs}ms (isMobile=${isMobile}), switching to HLS`);
        setStreamMode('hls');
      }
    }, fallbackMs);
    return () => {
      clearTimeout(relayTimer);
      clearTimeout(timeout);
    };
  }, [streamConnected, videoPlaying, connectionFailed, streamMode, hlsPlaybackUrl, hlsFailed, onStreamCallCount]);

  // Determine active stream source
  // Double lock: NEVER switch to HLS if WebRTC video is already playing (videoPlaying)
  const useHls = (streamMode === 'hls' || (streamMode === 'auto' && hlsReady && !streamConnected && !videoPlaying));

  // If the connection keeps sitting at "connecting", capture and report a
  // diagnostics snapshot once per 30s window so operations can verify whether
  // srflx/relay candidates are being collected and exchanged.
  useEffect(() => {
    if (useHls) return;
    if (connectionState !== 'connecting') return;
    const timer = setTimeout(() => {
      const now = Date.now();
      if (now - lastConnectingDiagnosticsAtRef.current < 30000) return;
      const webrtcDiagnostics = signalingRef.current?.getDiagnostics?.();
      if (!webrtcDiagnostics) return;
      lastConnectingDiagnosticsAtRef.current = now;
      console.warn('[LiveStream][ICE][connecting-stall]', webrtcDiagnostics);
      apiService.reportViewerError(username, {
        userAgent: ua,
        pageProtocol,
        inApp: inAppLabel,
        isMobile: /Android|iPhone|iPad|iPod|Mobile|KAKAOTALK|NAVER|Line|FB_IAB|Instagram/i.test(ua),
        isRelayOnly: !!signalingRef.current?.isRelayOnly?.(),
        onStreamCallCount,
        webrtc: webrtcDiagnostics,
        error: {
          source: 'webrtc-connecting-stall',
          code: 'connecting-timeout-10s',
          message: 'RTCPeerConnection stayed in connecting/new for over 10 seconds',
          at: new Date().toISOString(),
        },
      });
    }, 10000);
    return () => clearTimeout(timer);
  }, [useHls, connectionState, username, ua, pageProtocol, inAppLabel, onStreamCallCount]);

  // Handle manual reconnect (user-initiated via button)
  const handleReconnect = useCallback(() => {
    setConnectionFailed(false);
    setLastErrorInfo(null);
    setConnectionState('connecting');
    setStreamConnected(false);
    setVideoPlaying(false);
    setNeedsTap(false);
    setHlsFailed(false);
    setHlsReady(false);
    setRelayEscalating(false);
    videoMetadataLoadedRef.current = false;
    videoResetCountRef.current = 0; // Reset video reset counter for fresh reconnect
    lastStreamRef.current = null; // Clear stale stream reference
    relayFallbackTriedRef.current = false; // Let the relay-fallback timer arm again on a manual retry
    // NOTE: Do NOT reset webrtcEverConnectedRef here — if WebRTC worked before,
    // we should prefer WebRTC on reconnect rather than falling back to HLS (which may 404)
    reconnectAttemptsRef.current = 0;
    setStreamMode('auto');
    // Reset video element before reconnect to ensure clean state
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    if (signalingRef.current) {
      signalingRef.current.reconnect();
    }
  }, []);

  // Watchdog: if the stream is connected but the video isn't actually rendering
  // frames after 12s, re-show the tap-to-play overlay. Without this, unrelated
  // state transitions (e.g. peer-connection-state oscillating to 'connected'
  // again on a flaky mobile network) can flip needsTap back to false while the
  // decoder is still stuck at readyState=0 — leaving the user on a blank blue
  // screen with no way to recover. This guarantees the user always has an
  // interactive affordance.
  useEffect(() => {
    if (!streamConnected || videoPlaying || useHls || needsTap || connectionFailed) return;
    const timer = setTimeout(() => {
      const vid = videoRef.current;
      if (!vid) return;
      const isActuallyPlaying = !vid.paused && vid.readyState >= 2 && vid.currentTime > 0;
      if (!isActuallyPlaying && !vid.ended) {
        console.warn('[LiveStream] Watchdog: stream connected but video not rendering, re-showing tap overlay');
        setNeedsTap(true);
      }
    }, 12000);
    return () => clearTimeout(timer);
  }, [streamConnected, videoPlaying, useHls, needsTap, connectionFailed]);

  // Auto-play video on any user interaction when needsTap is true
  useEffect(() => {
    if (!needsTap || !streamConnected) return;
    const handleInteraction = () => {
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.muted = true;
        videoRef.current.play().then(() => {
          setNeedsTap(false);
          setVideoPlaying(true);
          if (videoRef.current) {
            try { videoRef.current.muted = false; } catch {}
          }
        }).catch(() => {});
      }
    };
    document.addEventListener('touchstart', handleInteraction, { once: true });
    document.addEventListener('click', handleInteraction, { once: true });
    return () => {
      document.removeEventListener('touchstart', handleInteraction);
      document.removeEventListener('click', handleInteraction);
    };
  }, [needsTap, streamConnected]);

  // Auto-reconnect if stream connected but video truly not playing after 25 seconds
  // Uses DOM checks (not React state) to avoid false positives from stale closures
  useEffect(() => {
    if (!streamConnected || videoPlaying || needsTap || useHls) return;
    const timeout = setTimeout(() => {
      if (!signalingRef.current) return;
      const vid = videoRef.current;

      // --- Direct DOM checks: is video actually working? ---
      // 1. If metadata has loaded, the stream pipeline is working
      if (videoMetadataLoadedRef.current) {
        console.log('[LiveStream] Metadata loaded, stream is progressing — skipping reconnect');
        return;
      }
      // 2. If readyState > 0, data is arriving
      if (vid && vid.readyState > 0) {
        console.log('[LiveStream] Video readyState > 0, data arriving — skipping reconnect');
        return;
      }
      // 3. If video is not paused and currentTime > 0, it's actually playing
      if (vid && !vid.paused && vid.currentTime > 0) {
        console.log('[LiveStream] Video currentTime > 0 and not paused — skipping reconnect');
        return;
      }
      // 4. If video has srcObject with live tracks but readyState is still 0 after 25s,
      //    try a video element reset first before doing a full WebRTC reconnect
      if (vid && vid.srcObject) {
        const tracks = (vid.srcObject as MediaStream).getTracks();
        const hasLiveTracks = tracks.some(t => t.readyState === 'live' && t.enabled);
        if (hasLiveTracks) {
          if (vid.readyState > 0) {
            // Data is arriving but video isn't "playing" per React state — give it more time
            console.log('[LiveStream] Live tracks present and readyState > 0 — skipping reconnect');
            return;
          }
          // readyState === 0 with live tracks for 25s = likely decoder stuck
          // Try video element reset first (cheaper than full WebRTC reconnect)
          if (videoResetCountRef.current < 3) {
            console.warn('[LiveStream] Live tracks present but readyState still 0 after 25s — trying video element reset before reconnect');
            resetVideoElement();
            // Schedule a follow-up check: if still stuck after 10s, do full reconnect
            setTimeout(() => {
              const v = videoRef.current;
              if (v && v.readyState === 0 && signalingRef.current) {
                console.warn('[LiveStream] Video still stuck after reset, proceeding with full reconnect');
                setConnectionState('connecting');
                setStreamConnected(false);
                setVideoPlaying(false);
                videoMetadataLoadedRef.current = false;
                reconnectAttemptsRef.current += 1;
                if (reconnectAttemptsRef.current <= MAX_RECONNECT_ATTEMPTS) {
                  signalingRef.current.reconnect();
                } else {
                  failConnection('video-reset-exhausted', 'ready-state-0', `Video element stuck at readyState=0 after ${videoResetCountRef.current} resets and ${reconnectAttemptsRef.current} signaling reconnects`);
                }
              }
            }, 10000);
            return;
          }
          console.warn('[LiveStream] Live tracks present but readyState still 0 after 25s — video resets exhausted, forcing full reconnect');
          // Fall through to reconnect below
        }
      }

      console.warn('[LiveStream] Connected but no video after 25s (no live tracks/data), auto-reconnecting...');
      // Use soft reconnect: only reconnect signaling, don't reset webrtcEverConnected
      setConnectionState('connecting');
      setStreamConnected(false);
      setVideoPlaying(false);
      videoMetadataLoadedRef.current = false;
      reconnectAttemptsRef.current += 1;
      if (reconnectAttemptsRef.current <= MAX_RECONNECT_ATTEMPTS) {
        signalingRef.current.reconnect();
      } else {
        console.error('[LiveStream] Max auto-reconnect attempts reached');
        failConnection('auto-reconnect-timeout', 'no-video-25s', `No video rendered after 25s across ${reconnectAttemptsRef.current} reconnect attempts`);
      }
    }, 25000);
    return () => clearTimeout(timeout);
  }, [streamConnected, videoPlaying, needsTap, useHls]);

  // Unmute video on first user interaction (touch/click) — must be in a user gesture
  // handler because mobile browsers block programmatic unmute without gesture.
  useEffect(() => {
    if (!videoPlaying) return;
    const tryUnmute = () => {
      if (videoRef.current && videoRef.current.muted) {
        videoRef.current.muted = false;
      }
    };
    document.addEventListener('touchstart', tryUnmute, { once: true });
    document.addEventListener('click', tryUnmute, { once: true });
    return () => {
      document.removeEventListener('touchstart', tryUnmute);
      document.removeEventListener('click', tryUnmute);
    };
  }, [videoPlaying]);

  // Keep the screen awake while the viewer is watching. Mobile browsers lock the
  // screen after ~60s of no touch input, which suspends video decoding and shows
  // a black frame. The Wake Lock API is auto-released on tab-hidden, so we
  // re-acquire it when visibility returns.
  useEffect(() => {
    const isWatching = streamConnected || videoPlaying || hlsReady;
    if (!isWatching) return;
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (!nav?.wakeLock?.request) return;

    let lock: any = null;
    let released = false;

    const acquire = async () => {
      if (released) return;
      try {
        lock = await nav.wakeLock.request('screen');
        lock.addEventListener?.('release', () => { lock = null; });
      } catch {
        // Non-fatal — older iOS/Android browsers don't expose wakeLock. Viewer
        // can still watch; they'll just need to tap the screen periodically.
      }
    };

    acquire();

    const onVis = () => {
      if (document.visibilityState === 'visible' && !lock && !released) acquire();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVis);
      if (lock) {
        try { lock.release?.(); } catch {}
        lock = null;
      }
    };
  }, [streamConnected, videoPlaying, hlsReady]);

  // --- MOBILE-ONLY recovery: backgrounding, network switch, and decoder stalls.
  // Desktop browsers keep WebRTC decoders running in background tabs and rarely
  // suffer buffer underruns on a stable LAN, so this entire effect is skipped
  // for non-mobile UAs to avoid touching the known-good web viewer path.
  useEffect(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobile = /Android|iPhone|iPad|iPod|Mobile|KAKAOTALK|NAVER|Line|FB_IAB|Instagram/i.test(ua);
    if (!isMobile) return;
    if (useHls) return; // HLS path is managed by Video.js; only touch the WebRTC <video>

    const resumeIfPaused = () => {
      const vid = videoRef.current;
      if (!vid || !vid.srcObject) return;
      // If the decoder never produced a frame after returning to foreground,
      // reset the element instead of just calling play() — iOS Safari and
      // Kakao in-app WebView often leave the decoder stuck at readyState=0
      // after a lock-screen or app-switch interruption.
      if (vid.readyState === 0 && lastStreamRef.current && videoResetCountRef.current < 3) {
        resetVideoElement();
        return;
      }
      if (vid.paused) {
        vid.muted = true;
        vid.play().then(() => {
          setVideoPlaying(true);
          setNeedsTap(false);
        }).catch(() => {
          // Autoplay was blocked after foreground — surface the tap affordance
          if (streamConnected) setNeedsTap(true);
        });
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') resumeIfPaused();
    };
    // iOS Safari back-forward cache restores the page with the video element
    // paused and, in some builds, detached from its MediaStream. `pageshow`
    // with `persisted=true` is the only reliable signal for this path.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) resumeIfPaused();
    };
    // Network switch (WiFi ↔ LTE) tears down ICE; trigger a full reconnect
    // when we come back online AND the video is not rendering. Guarded by
    // the same stuck-stream checks that the 25s watchdog uses, so we don't
    // interrupt a working stream just because the device briefly flapped.
    const onOnline = () => {
      const vid = videoRef.current;
      const stuck =
        !vid ||
        !vid.srcObject ||
        (vid.readyState === 0 && !videoMetadataLoadedRef.current) ||
        connectionFailed;
      if (stuck && signalingRef.current) {
        console.log('[LiveStream][mobile] online event with stuck stream — reconnecting');
        handleReconnect();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);

    // Decoder-stall watchdog: `waiting`/`stalled` fire when the media pipeline
    // underruns. On desktop these usually recover on their own; on mobile (esp.
    // Kakao/Android WebView) they often indicate a permanently stuck decoder
    // that only a video-element reset clears. Reset after a 6s grace period.
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStall = () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    };
    const onStall = () => {
      if (stallTimer) return;
      stallTimer = setTimeout(() => {
        stallTimer = null;
        const vid = videoRef.current;
        if (!vid || !vid.srcObject) return;
        const isRendering = !vid.paused && vid.readyState >= 2 && vid.currentTime > 0;
        if (isRendering) return;
        if (videoResetCountRef.current < 3 && lastStreamRef.current) {
          console.warn('[LiveStream][mobile] decoder stalled for 6s — resetting video element');
          resetVideoElement();
        }
      }, 6000);
    };
    const vid = videoRef.current;
    if (vid) {
      vid.addEventListener('waiting', onStall);
      vid.addEventListener('stalled', onStall);
      vid.addEventListener('suspend', onStall);
      vid.addEventListener('playing', clearStall);
      vid.addEventListener('timeupdate', clearStall);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      clearStall();
      if (vid) {
        vid.removeEventListener('waiting', onStall);
        vid.removeEventListener('stalled', onStall);
        vid.removeEventListener('suspend', onStall);
        vid.removeEventListener('playing', clearStall);
        vid.removeEventListener('timeupdate', clearStall);
      }
    };
  }, [useHls, connectionFailed, streamConnected, handleReconnect, resetVideoElement]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    const el = chatEndRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Initialize Kakao SDK (for share/send features)
  useEffect(() => {
    const initKakao = () => {
      if (typeof window !== 'undefined' && (window as any).Kakao) {
        const Kakao = (window as any).Kakao;
        if (!Kakao.isInitialized() && KAKAO_APP_KEY) {
          Kakao.init(KAKAO_APP_KEY);
        }
      }
    };

    // Check if script already loaded
    if ((window as any).Kakao) {
      initKakao();
      return;
    }

    // Load Kakao SDK script
    const script = document.createElement('script');
    script.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
    script.async = true;
    script.onload = initKakao;
    document.head.appendChild(script);
  }, []);

  const [kakaoLoginError, setKakaoLoginError] = useState('');
  const kakaoAvailable = !!supabase;

  // Reset consent state every time the login prompt opens so users
  // explicitly tick the boxes for each session.
  useEffect(() => {
    if (showLoginPrompt) {
      setLiveConsentRequired(false);
      setLiveConsentPrivacy(false);
      setLiveConsentMarketing(false);
      setShowLiveConsentDetail(null);
    }
  }, [showLoginPrompt]);

  const handleKakaoLogin = useCallback(async () => {
    setKakaoLoginError('');

    if (!liveConsentPrivacy) {
      setLiveConsentRequired(true);
      setKakaoLoginError('필수 동의항목에 체크해주세요.');
      return;
    }
    setLiveConsentRequired(false);

    if (!supabase) {
      setKakaoLoginError('서비스가 초기화되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    try {
      // Save redirect info so we can restore live stream after OAuth callback
      localStorage.setItem('picks_live_kakao_redirect', username);
      localStorage.setItem(
        'picks_live_consent',
        JSON.stringify({
          privacy: true,
          marketing: liveConsentMarketing,
          at: new Date().toISOString(),
        })
      );

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'kakao',
        options: {
          redirectTo: window.location.origin + '/' + username,
          scopes: 'openid profile_nickname account_email phone_number name',
          queryParams: {
            prompt: 'login',
            auth_type: 'reauthenticate',
          },
        },
      });

      if (error) {
        localStorage.removeItem('picks_live_kakao_redirect');
        setKakaoLoginError('카카오 로그인 실패: ' + error.message);
      }
    } catch (e: any) {
      localStorage.removeItem('picks_live_kakao_redirect');
      console.error('Kakao login error:', e);
      setKakaoLoginError('카카오 로그인 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
  }, [username, liveConsentPrivacy, liveConsentMarketing]);

  const handleSendMessage = () => {
    if (!kakaoUser) {
      setShowLoginPrompt(true);
      return;
    }
    if (!newMessage.trim()) return;
    const msg: ChatMessage = {
      id: Date.now().toString(),
      user: kakaoUser.nickname,
      text: newMessage,
      profileImage: kakaoUser.profileImage,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    // Send to broadcaster and other viewers via signaling channel
    signalingRef.current?.sendChat(msg);
    setNewMessage('');
  };

  // Add product to cart (optimistic update to avoid video freeze)
  const handleAddToCart = useCallback((e?: React.MouseEvent, selectedOpts?: Record<string, string>) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!kakaoUser) {
      setShowLoginPrompt(true);
      return;
    }
    if (!currentProduct || cartAdding) return;

    // If product has options and no options selected yet, show option picker
    const productOptions = currentProduct.options as { id: string; name: string; values: string[] }[] | undefined;
    if (productOptions && productOptions.length > 0 && !selectedOpts) {
      setPendingOptions({});
      setShowOptionPicker(true);
      return;
    }

    // Check if already in cart (with same options)
    const optKey = selectedOpts ? JSON.stringify(selectedOpts) : '';
    if (cartItems.some(item => item.productId === currentProduct.id && JSON.stringify(item.selectedOptions || {}) === (optKey || '{}'))) {
      setCartAddedId(currentProduct.id);
      setTimeout(() => setCartAddedId(null), 2000);
      return;
    }

    // Optimistic update - add to cart immediately without waiting for API
    // Use startTransition to prevent video playback from freezing during re-render
    const effectivePrice = computeEffectivePrice(currentProduct, selectedOpts);
    const cartPriceString = effectivePrice > 0 ? formatKrwPrice(effectivePrice) : currentProduct.price;
    const newItem = {
      productId: currentProduct.id,
      productName: currentProduct.name,
      productPrice: cartPriceString,
      productImage: currentProduct.image,
      productLink: currentProduct.link || '',
      selectedOptions: selectedOpts,
    };
    startTransition(() => {
      setCartItems(prev => [...prev, newItem]);
      setCartAddedId(currentProduct.id);
    });
    setTimeout(() => startTransition(() => setCartAddedId(null)), 2000);

    // Fire API call in background (non-blocking)
    startTransition(() => setCartAdding(true));
    apiService.addToLiveCart(username, {
      viewerId: viewerIdRef.current,
      viewerNickname: kakaoUser.nickname,
      viewerProfileImage: kakaoUser.profileImage,
      productId: currentProduct.id,
      productName: currentProduct.name,
      productPrice: cartPriceString,
      productImage: currentProduct.image,
      productLink: currentProduct.link || '',
      selectedOptions: selectedOpts,
    }).catch(err => {
      console.error('[Cart] Failed to sync:', err);
    }).finally(() => {
      startTransition(() => setCartAdding(false));
    });
  }, [kakaoUser, currentProduct, cartAdding, cartItems, username]);

  // Confirm option selection and add to cart (or open checkout in "checkout" mode)
  const handleConfirmOptions = useCallback(() => {
    if (!currentProduct) return;
    const productOptions = currentProduct.options as { id: string; name: string; values: string[] }[] | undefined;
    // Validate all options are selected
    if (productOptions) {
      for (const opt of productOptions) {
        if (!pendingOptions[opt.name]) return; // Not all options selected
      }
    }
    setShowOptionPicker(false);
    if (optionPickerMode === 'checkout') {
      // Branch into the simple-pay checkout modal with the chosen options.
      // Override the displayed/charged price using any per-option price /
      // discount the seller configured for the selected variant.
      const effective = computeEffectivePrice(currentProduct, pendingOptions);
      setCheckoutProduct({
        ...currentProduct,
        price: effective > 0 ? formatKrwPrice(effective) : currentProduct.price,
      });
      setCheckoutOptions({ ...pendingOptions });
      setCheckoutError(null);
      setCheckoutSuccess(false);
      setShowCheckout(true);
      return;
    }
    handleAddToCart(undefined, pendingOptions);
  }, [currentProduct, pendingOptions, handleAddToCart, optionPickerMode]);

  // Detect broadcast end for ALL viewers and auto-close the stream so they
  // return to the host's personal page.
  useEffect(() => {
    const endedRef = { current: false };
    const checkEnded = async () => {
      if (endedRef.current) return;
      const state = await apiService.getLiveState(username);
      if (state && !state.isLive) {
        endedRef.current = true;
        setTimeout(() => { onClose(); }, 1500);
      }
    };
    const interval = setInterval(checkEnded, 5000);
    return () => clearInterval(interval);
  }, [username, onClose]);

  // Open the simple-pay checkout modal (Toss / Kakao / Card). If the product
  // carries options and the viewer hasn't picked them, show the option picker
  // first and flip it into "checkout" mode so confirmation opens this modal
  // instead of the cart.
  const handleOpenCheckout = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!currentProduct) return;
    trackClick(username, currentProduct.id || 'live-product');

    if (!kakaoUser) {
      setShowLoginPrompt(true);
      return;
    }

    const price = parseKrwPrice(currentProduct.price);
    const productOptions = currentProduct.options as { id: string; name: string; values: any[] }[] | undefined;
    const hasPricedOption = (productOptions || []).some((opt) =>
      (opt.values || []).some((v: any) => typeof v === 'object' && (Number(v?.price) > 0 || Number(v?.discount) > 0)),
    );
    // Without any structured price (base or per-option override), fall back to
    // the seller's external link if one was provided. Live products may now be
    // saved with no link at all, in which case the bail is silent.
    if (price <= 0 && !hasPricedOption) {
      const link = currentProduct.link?.startsWith('http')
        ? currentProduct.link
        : currentProduct.link ? `https://${currentProduct.link}` : '';
      if (link) {
        window.open(link, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    if (productOptions && productOptions.length > 0) {
      setPendingOptions({});
      setOptionPickerMode('checkout');
      setShowOptionPicker(true);
      return;
    }

    setCheckoutProduct(currentProduct);
    setCheckoutOptions(undefined);
    setCheckoutError(null);
    setCheckoutSuccess(false);
    setShowCheckout(true);
  }, [currentProduct, kakaoUser, username]);

  // Run the PortOne V2 simple-pay flow, then verify the payment server-side.
  const handleConfirmCheckout = useCallback(async () => {
    if (!checkoutProduct || !kakaoUser) return;
    if (typeof window === 'undefined' || !window.PortOne) {
      setCheckoutError('결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }

    const amount = parseKrwPrice(checkoutProduct.price);
    if (amount <= 0) {
      setCheckoutError('상품 가격 정보가 올바르지 않습니다.');
      return;
    }

    setCheckoutError(null);
    setCheckoutProcessing(true);
    try {
      const paymentId = `live-${toAsciiSafeId(username)}-${checkoutProduct.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const channelKey =
        checkoutPayMethod === 'KAKAOPAY'
          ? PORTONE_KAKAOPAY_CHANNEL_KEY
          : PORTONE_TOSSPAY_CHANNEL_KEY;

      const optionSuffix = checkoutOptions && Object.keys(checkoutOptions).length > 0
        ? ` (${Object.values(checkoutOptions).join('/')})`
        : '';
      const orderName = `${checkoutProduct.name}${optionSuffix}`.slice(0, 100);

      const response = await window.PortOne.requestPayment({
        storeId: PORTONE_STORE_ID,
        channelKey,
        paymentId,
        orderName,
        totalAmount: amount,
        currency: 'KRW',
        payMethod: 'EASY_PAY',
        easyPay: { easyPayProvider: checkoutPayMethod },
        customer: {
          customerId: viewerIdRef.current,
          fullName: kakaoUser.nickname || undefined,
        },
      });

      if (!response || response.code) {
        if (response?.code) {
          setCheckoutError(response.message || `결제 실패 (${response.code})`);
        }
        return;
      }

      const returnedPaymentId = response.paymentId || paymentId;
      const verifyRes = await apiService.completeLiveOrder({
        paymentId: returnedPaymentId,
        username,
        expectedAmount: amount,
        product: {
          id: checkoutProduct.id,
          name: checkoutProduct.name,
          link: checkoutProduct.link,
          image: checkoutProduct.image,
          selectedOptions: checkoutOptions,
        },
        viewer: {
          viewerId: viewerIdRef.current,
          nickname: kakaoUser.nickname,
          profileImage: kakaoUser.profileImage,
        },
      });
      if (!verifyRes.success) {
        setCheckoutError(verifyRes.error || '결제 검증에 실패했습니다. 고객센터로 문의해 주세요.');
        return;
      }

      setCheckoutSuccess(true);
    } catch (err) {
      console.error('[LiveCheckout] PortOne payment error:', err);
      setCheckoutError('결제 처리 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setCheckoutProcessing(false);
    }
  }, [checkoutProduct, checkoutPayMethod, checkoutOptions, kakaoUser, username]);

  const handleCloseCheckout = useCallback(() => {
    if (checkoutProcessing) return;
    setShowCheckout(false);
    setCheckoutError(null);
    setCheckoutSuccess(false);
    setCheckoutProduct(null);
    setCheckoutOptions(undefined);
    setOptionPickerMode('cart');
  }, [checkoutProcessing]);

  // Remove a single item from the viewer's cart (optimistic; syncs to server).
  const handleRemoveCartItem = useCallback((productId: string, selectedOptions?: Record<string, string>) => {
    const optKey = selectedOptions ? JSON.stringify(selectedOptions) : '';
    setCartItems(prev => prev.filter(i => !(i.productId === productId && JSON.stringify(i.selectedOptions || {}) === (optKey || '{}'))));
    apiService.removeFromLiveCart(username, {
      viewerId: viewerIdRef.current,
      productId,
      selectedOptions,
    }).catch(err => console.error('[Cart] Failed to remove:', err));
  }, [username]);

  // Sum of priceable items in the cart (KRW). Items with an unparseable
  // price (e.g. sellers who didn't fill in 원) contribute 0 and are surfaced
  // separately so the viewer knows which items won't be paid via simple-pay.
  const batchPayableItems = cartItems.filter(i => parseKrwPrice(i.productPrice) > 0);
  const batchUnpriceableItems = cartItems.filter(i => parseKrwPrice(i.productPrice) <= 0);
  const batchTotal = batchPayableItems.reduce((s, i) => s + parseKrwPrice(i.productPrice), 0);

  const handleOpenBatchCheckout = useCallback(() => {
    if (!kakaoUser) { setShowLoginPrompt(true); return; }
    if (batchPayableItems.length === 0 || batchTotal <= 0) return;
    setBatchError(null);
    setBatchSuccess(false);
    setShowBatchCheckout(true);
  }, [kakaoUser, batchPayableItems.length, batchTotal]);

  const handleCloseBatchCheckout = useCallback(() => {
    if (batchProcessing) return;
    setShowBatchCheckout(false);
    setBatchError(null);
    // If the viewer just paid, also collapse the cart list because the items
    // have been cleared from local state and keeping the popup open would be
    // awkward (empty).
    if (batchSuccess) setShowCartList(false);
    setBatchSuccess(false);
  }, [batchProcessing, batchSuccess]);

  // Run PortOne V2 once for the full cart total, then fan it out to per-item
  // order records server-side. Clears payable cart items on success.
  const handleConfirmBatchCheckout = useCallback(async () => {
    if (!kakaoUser) return;
    if (typeof window === 'undefined' || !window.PortOne) {
      setBatchError('결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }
    if (batchPayableItems.length === 0 || batchTotal <= 0) {
      setBatchError('결제할 수 있는 상품이 없습니다.');
      return;
    }

    setBatchError(null);
    setBatchProcessing(true);
    try {
      const paymentId = `live-batch-${toAsciiSafeId(username)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const channelKey =
        batchPayMethod === 'KAKAOPAY'
          ? PORTONE_KAKAOPAY_CHANNEL_KEY
          : PORTONE_TOSSPAY_CHANNEL_KEY;

      const firstName = batchPayableItems[0]?.productName || '상품';
      const orderName = (batchPayableItems.length === 1
        ? firstName
        : `${firstName} 외 ${batchPayableItems.length - 1}건`
      ).slice(0, 100);

      const response = await window.PortOne.requestPayment({
        storeId: PORTONE_STORE_ID,
        channelKey,
        paymentId,
        orderName,
        totalAmount: batchTotal,
        currency: 'KRW',
        payMethod: 'EASY_PAY',
        easyPay: { easyPayProvider: batchPayMethod },
        customer: {
          customerId: viewerIdRef.current,
          fullName: kakaoUser.nickname || undefined,
        },
      });

      if (!response || response.code) {
        if (response?.code) setBatchError(response.message || `결제 실패 (${response.code})`);
        return;
      }

      const returnedPaymentId = response.paymentId || paymentId;
      const verifyRes = await apiService.completeLiveOrderBatch({
        paymentId: returnedPaymentId,
        username,
        expectedAmount: batchTotal,
        items: batchPayableItems.map(it => ({
          productId: it.productId,
          productName: it.productName,
          productLink: it.productLink,
          productImage: it.productImage,
          selectedOptions: it.selectedOptions,
          amount: parseKrwPrice(it.productPrice),
        })),
        viewer: {
          viewerId: viewerIdRef.current,
          nickname: kakaoUser.nickname,
          profileImage: kakaoUser.profileImage,
        },
      });

      if (!verifyRes.success) {
        setBatchError(verifyRes.error || '결제 검증에 실패했습니다. 고객센터로 문의해 주세요.');
        return;
      }

      // Remove paid items from local cart; keep any unpriceable ones so the
      // viewer can still jump to the seller's external link for those.
      const paidKeys = new Set(batchPayableItems.map(i => `${i.productId}|${JSON.stringify(i.selectedOptions || {})}`));
      setCartItems(prev => prev.filter(i => !paidKeys.has(`${i.productId}|${JSON.stringify(i.selectedOptions || {})}`)));
      setBatchSuccess(true);
    } catch (err) {
      console.error('[LiveBatchCheckout] PortOne payment error:', err);
      setBatchError('결제 처리 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setBatchProcessing(false);
    }
  }, [kakaoUser, batchPayableItems, batchTotal, batchPayMethod, username]);

  const addLike = () => {
    const id = Date.now();
    setLikes([...likes, id]);
    setTimeout(() => {
      setLikes(prev => prev.filter(l => l !== id));
    }, 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-black overflow-hidden live-stream-container"
      style={{
        // Prevent the browser's pull-to-refresh and rubber-band scroll from
        // interfering with the immersive player. Safe here because the inner
        // scrollable zones (chat) opt in via their own overscroll rules.
        overscrollBehavior: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        touchAction: 'manipulation',
      }}
    >
      {/* --- DIAGNOSTIC BANNER (top) ------------------------------------ */}
      {/* Protocol + onStream-callback indicator for mobile debugging.    */}
      {/* Only surfaced when ?debug=1 is present in the URL so normal     */}
      {/* viewers don't see terminal-style text at the top of their screen.*/}
      {debugMode && (
        <div
          className="absolute top-0 left-0 right-0 z-[300] flex items-center justify-between gap-2 px-3 text-[11px] font-mono font-bold pointer-events-none"
          style={{
            backgroundColor: 'rgba(0,0,0,0.75)',
            color: '#fff',
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 4px)',
            paddingBottom: '6px',
          }}
        >
          <span
            style={{
              color: pageProtocol === 'https:' ? '#4ade80' : '#f87171',
            }}
          >
            PROTO: {pageProtocol.toUpperCase() || 'UNKNOWN'}
          </span>
          <span style={{ color: onStreamCallCount > 0 ? '#4ade80' : '#fbbf24' }}>
            onStream: {onStreamCallCount > 0 ? `✓ ${onStreamCallCount}x` : '✗ NEVER'}
          </span>
          {lastErrorInfo && (
            <span style={{ color: '#f87171' }}>
              ERR: {lastErrorInfo.source}/{String(lastErrorInfo.code)}
            </span>
          )}
        </div>
      )}

      {/* --- IN-APP BROWSER BANNER ------------------------------------- */}
      {/* KakaoTalk / Instagram / Line in-app WebViews have unreliable   */}
      {/* WebRTC + TURN support, so prompt users to open the link in the */}
      {/* OS browser (Safari / Chrome) where playback is far more stable.*/}
      {showInAppBrowserBanner && (
        <div
          className="absolute left-0 right-0 z-[301] px-3 py-2 flex items-center justify-between gap-2 text-white"
          style={{
            top: debugMode ? 'calc(env(safe-area-inset-top, 0px) + 22px)' : 'env(safe-area-inset-top, 0px)',
            backgroundColor: 'rgba(124, 58, 237, 0.95)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          <span className="text-[12px] font-semibold leading-tight">
            {isKakaoInApp
              ? '카카오톡에서는 방송이 잘 보이지 않을 수 있어요. 외부 브라우저로 여는 것을 권장합니다.'
              : '인앱 브라우저에서는 방송이 불안정할 수 있어요. Safari/Chrome에서 여는 것을 권장합니다.'}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={openInExternalBrowser}
              className="px-2.5 py-1 rounded-md bg-white text-purple-700 text-[11px] font-bold active:scale-95"
            >
              {isKakaoInApp ? 'Safari/Chrome에서 열기' : '브라우저로 열기'}
            </button>
            <button
              onClick={() => setInAppBannerDismissed(true)}
              aria-label="닫기"
              className="px-1.5 py-1 rounded-md text-white/90 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* --- CELLULAR / DATA-SAVER WARNING ----------------------------- */}
      {/* Mobile viewers on cellular can burn through their data plan     */}
      {/* quickly on a live video stream — give them one dismissable      */}
      {/* heads-up before they watch.                                     */}
      {showDataWarning && !showInAppBrowserBanner && (
        <div
          className="absolute left-0 right-0 z-[301] px-3 py-2 flex items-center justify-between gap-2 text-white"
          style={{
            top: debugMode ? 'calc(env(safe-area-inset-top, 0px) + 22px)' : 'env(safe-area-inset-top, 0px)',
            backgroundColor: 'rgba(217, 119, 6, 0.95)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Wifi size={16} className="shrink-0" />
            <span className="text-[12px] font-semibold leading-tight truncate">
              모바일 데이터를 사용합니다. Wi-Fi를 권장해요.
            </span>
          </div>
          <button
            onClick={dismissDataWarning}
            aria-label="닫기"
            className="px-1.5 py-1 rounded-md text-white/90 hover:text-white shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* --- RELAY ESCALATION INDICATOR -------------------------------- */}
      {/* When the viewer is automatically switched to TURN-relay mode   */}
      {/* (mobile carrier NAT workaround), surface that so users don't   */}
      {/* think the app is frozen. Clears itself once frames arrive.     */}
      {relayEscalating && !streamConnected && !videoPlaying && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-[302] px-3 py-1.5 rounded-full flex items-center gap-2 text-white text-[11px] font-semibold"
          style={{
            top: debugMode ? 'calc(env(safe-area-inset-top, 0px) + 56px)' : 'calc(env(safe-area-inset-top, 0px) + 34px)',
            backgroundColor: 'rgba(30, 41, 59, 0.92)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <Loader2 size={12} className="animate-spin text-purple-300" />
          <span>네트워크가 느려요. 릴레이 서버로 전환 중…</span>
        </div>
      )}

      {/* --- TURN UNAVAILABLE BANNER ----------------------------------- */}
      {/* Every configured TURN server returned a hard allocate/auth      */}
      {/* failure. Means this viewer cannot be relayed — typically the    */}
      {/* TURN service has expired credentials or exhausted its quota.    */}
      {turnUnavailable && !streamConnected && !videoPlaying && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-[303] px-3 py-2 rounded-lg flex items-center gap-2 text-white text-[12px] font-semibold max-w-[92%]"
          style={{
            top: debugMode ? 'calc(env(safe-area-inset-top, 0px) + 96px)' : 'calc(env(safe-area-inset-top, 0px) + 74px)',
            backgroundColor: 'rgba(185, 28, 28, 0.94)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <Wifi size={14} className="text-white shrink-0" />
          <span className="leading-snug">
            네트워크 환경에서 영상 연결이 어렵습니다. Wi-Fi를 바꿔보거나 잠시 후 다시 시도해주세요.
          </span>
        </div>
      )}

      {/* Main Stream Area - Full Screen Edge-to-Edge */}
      <div className="absolute inset-0 bg-slate-900 overflow-hidden">
        {/* Live Video Stream */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 z-10 pointer-events-none" />

        {/* WebRTC Video - always render and keep visible when connected */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          preload="auto"
          // @ts-ignore - webkit-playsinline needed for older iOS Safari
          webkit-playsinline=""
          // @ts-ignore - x5-playsinline needed for Tencent/QQ/WeChat/Kakao WebViews on Android
          x5-playsinline=""
          // @ts-ignore - x5-video-player-type inline keeps video in flow on Android in-app browsers
          x5-video-player-type="h5-page"
          className={`absolute top-0 left-0 w-full h-full ${(streamConnected || videoPlaying) && !useHls ? 'z-[5]' : 'z-[1] opacity-0 pointer-events-none'}`}
          style={{ objectFit: 'contain', WebkitTransform: 'translateZ(0)', transform: 'translateZ(0)' }}
        />
        {/* HLS Video.js fallback */}
        {hlsPlaybackUrl && (
          <div className={`absolute top-0 left-0 w-full h-full ${useHls ? 'z-[5]' : 'z-[1] opacity-0 pointer-events-none'}`}>
            <video
              ref={hlsVideoRef}
              className="video-js vjs-big-play-centered vjs-fluid"
              autoPlay
              muted
              playsInline
              preload="auto"
              crossOrigin="anonymous"
              // @ts-ignore - webkit-playsinline needed for older iOS Safari
              webkit-playsinline=""
              // @ts-ignore - x5-playsinline needed for Tencent/QQ/WeChat/Kakao WebViews on Android
              x5-playsinline=""
              // @ts-ignore - x5-video-player-type inline keeps video in flow on Android in-app browsers
              x5-video-player-type="h5-page"
              style={{ objectFit: 'contain', width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
            />
          </div>
        )}

        {/* Tap to play overlay for mobile autoplay restriction - minimal floating button */}
        {/* Only shown once PC is actually connected — during `connecting`  */}
        {/* there's no media surface to play, so a tap would do nothing.    */}
        {needsTap && streamConnected && connectionState === 'connected' && (
          <div
            className="absolute inset-0 z-[6] cursor-pointer flex items-center justify-center"
            onClick={() => {
              if (videoRef.current) {
                const vid = videoRef.current;
                // If readyState is 0, try resetting the video element first (up to 3 times)
                // before falling back to a full WebRTC reconnect
                if (vid.readyState === 0) {
                  if (videoResetCountRef.current < 3 && lastStreamRef.current) {
                    console.log('[LiveStream] Tap overlay clicked, readyState=0, trying video element reset first');
                    setNeedsTap(false);
                    resetVideoElement();
                    // If still stuck after reset, show tap overlay again after 5s
                    setTimeout(() => {
                      if (videoRef.current && videoRef.current.readyState === 0) {
                        setNeedsTap(true);
                      }
                    }, 5000);
                  } else {
                    console.log('[LiveStream] Tap overlay clicked, readyState=0, video resets exhausted — triggering full reconnect');
                    handleReconnect();
                  }
                  return;
                }
                vid.muted = true;
                vid.play().then(() => {
                  setNeedsTap(false);
                  setVideoPlaying(true);
                  if (videoRef.current) {
                    try { videoRef.current.muted = false; } catch {}
                  }
                }).catch(() => {});
              }
            }}
          >
            <div className="flex flex-col items-center animate-pulse">
              <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center mb-3 border-2 border-white/40 shadow-2xl">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="white">
                  <polygon points="6,3 20,12 6,21" />
                </svg>
              </div>
              <p className="text-white text-sm font-black mb-0.5">터치하여 방송 시작</p>
              <p className="text-white/70 text-[11px] font-semibold">소리도 함께 켜집니다</p>
            </div>
          </div>
        )}

        {!streamConnected && !hlsReady && !useHls && !needsTap && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-[6]">
            {connectionFailed && (!hlsPlaybackUrl || hlsFailed) ? (
              <>
                <Radio size={40} className="text-red-400 mb-4" />
                <p className="text-white/80 text-sm font-bold mb-1">방송 연결에 실패했습니다</p>
                <p className="text-white/40 text-xs mb-4">
                  {isInAppBrowser
                    ? '인앱 브라우저 제약으로 실패할 수 있어요. 외부 브라우저에서 열면 대부분 해결돼요.'
                    : '네트워크 상태를 확인해주세요'}
                </p>
                {/* --- DIAGNOSTIC: last-known failure reason ---------------- */}
                {errorDetailsPanel}
                <div className="flex flex-col items-center gap-2">
                  {isInAppBrowser && (
                    <button
                      onClick={openInExternalBrowser}
                      className="flex items-center gap-2 px-5 py-2.5 bg-white text-purple-700 text-sm font-black rounded-xl active:scale-95"
                    >
                      {isKakaoInApp ? 'Safari/Chrome에서 열기' : '외부 브라우저로 열기'}
                    </button>
                  )}
                  <button
                    onClick={handleReconnect}
                    className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white text-sm font-bold rounded-xl hover:bg-purple-700 transition-all active:scale-95"
                  >
                    <RefreshCw size={16} />
                    다시 연결하기
                  </button>
                </div>
              </>
            ) : broadcastLive === false && !streamConnected && !videoPlaying && onStreamCallCount === 0 ? (
              <>
                <Radio size={40} className="text-white/40 mb-4" />
                <p className="text-white/80 text-sm font-bold mb-1">방송이 시작되지 않았거나 종료되었어요</p>
                <p className="text-white/40 text-xs">호스트가 방송을 시작하면 자동으로 연결됩니다</p>
              </>
            ) : (
              <>
                <Loader2 size={40} className="text-purple-500 animate-spin mb-4" />
                <p className="text-white/60 text-xs font-bold uppercase tracking-widest">
                  {connectionState === 'disconnected'
                    ? '재연결 시도 중...'
                    : connectionState === 'connecting' ? '방송에 연결 중...' : '방송 연결 대기 중...'}
                </p>
                <p className="text-white/30 text-[10px] mt-2">잠시만 기다려주세요</p>
              </>
            )}
          </div>
        )}

        {/* HLS loading overlay - show when HLS mode is active but stream hasn't started yet */}
        {(streamMode === 'hls' || useHls) && !hlsReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-[6]">
            {hlsFailed ? (
              <>
                <Radio size={40} className="text-red-400 mb-4" />
                <p className="text-white/80 text-sm font-bold mb-1">HD 방송 연결에 실패했습니다</p>
                <p className="text-white/40 text-xs mb-4">
                  {isInAppBrowser
                    ? '인앱 브라우저 제약으로 실패할 수 있어요. 외부 브라우저에서 열면 대부분 해결돼요.'
                    : '네트워크 상태를 확인해주세요'}
                </p>
                {/* --- DIAGNOSTIC: last-known failure reason (HLS path) ----- */}
                {errorDetailsPanel}
                <div className="flex flex-col items-center gap-2">
                  {isInAppBrowser && (
                    <button
                      onClick={openInExternalBrowser}
                      className="flex items-center gap-2 px-5 py-2.5 bg-white text-purple-700 text-sm font-black rounded-xl active:scale-95"
                    >
                      {isKakaoInApp ? 'Safari/Chrome에서 열기' : '외부 브라우저로 열기'}
                    </button>
                  )}
                  <button
                    onClick={handleReconnect}
                    className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white text-sm font-bold rounded-xl hover:bg-purple-700 transition-all active:scale-95"
                  >
                    <RefreshCw size={16} />
                    다시 연결하기
                  </button>
                </div>
              </>
            ) : (
              <>
                <Loader2 size={40} className="text-purple-500 animate-spin mb-4" />
                <p className="text-white/60 text-xs font-bold uppercase tracking-widest">HD 방송 연결 중...</p>
                <p className="text-white/30 text-[10px] mt-2">잠시만 기다려주세요</p>
              </>
            )}
          </div>
        )}

        {/* Top Overlay */}
        <div className="absolute top-0 left-0 right-0 z-20 flex justify-between items-start" style={{ padding: 'max(1rem, env(safe-area-inset-top, 1rem)) max(1rem, env(safe-area-inset-right, 1rem)) 0 max(1rem, env(safe-area-inset-left, 1rem))' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-purple-500 overflow-hidden bg-slate-800">
              <SafeImage src={DEFAULT_AVATAR} className="w-full h-full object-cover" />
            </div>
            <div>
              <p className="text-white text-xs font-black tracking-tight">@{username}</p>
              <div className="flex items-center gap-2">
                <div className="bg-red-600 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest animate-pulse">
                  LIVE
                </div>
                {(streamConnected || hlsReady || streamMode === 'hls') && (
                  <button
                    onClick={() => setStreamMode(prev => prev === 'webrtc' ? 'hls' : prev === 'hls' ? 'auto' : 'webrtc')}
                    className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded text-[8px] font-bold text-white/80 hover:bg-black/60 transition-all"
                    title={`현재: ${useHls ? 'HLS (Full HD)' : 'WebRTC (저지연)'}`}
                  >
                    {useHls ? <Tv size={10} /> : <Radio size={10} />}
                    {useHls ? 'HD' : 'LIVE'}
                  </button>
                )}
                <div className="flex items-center gap-1 text-white/60 text-[10px] font-bold">
                  <Users size={10} />
                  <span>{viewerCount.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {kakaoUser && (
              <span className="text-[10px] font-bold text-purple-300 bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-full">{kakaoUser.nickname}</span>
            )}
            {/* Persistent unmute toggle — mobile autoplay forces muted start,  */}
            {/* and many viewers never realize they can tap for sound. Showing  */}
            {/* this button whenever audio is muted gives them an always-on     */}
            {/* affordance instead of burying it in the transient tap overlay.  */}
            {(streamConnected || videoPlaying || hlsReady || useHls) && isVideoMuted && (
              <button
                onClick={toggleMute}
                aria-label="소리 켜기"
                className="px-3 py-2 bg-purple-600/90 backdrop-blur-md rounded-full text-white hover:bg-purple-700 transition-all active:scale-95 flex items-center gap-1.5 animate-pulse"
                style={{ boxShadow: '0 2px 8px rgba(124, 58, 237, 0.45)' }}
              >
                <VolumeX size={16} />
                <span className="text-[11px] font-black">소리 켜기</span>
              </button>
            )}
            {(streamConnected || videoPlaying || hlsReady || useHls) && !isVideoMuted && (
              <button
                onClick={toggleMute}
                aria-label="음소거"
                className="p-2 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-black/60 transition-all"
              >
                <Volume2 size={18} />
              </button>
            )}
            <button onClick={addLike} className="p-2 bg-black/40 backdrop-blur-md rounded-full text-red-400 hover:bg-black/60 transition-all">
              <Heart size={20} />
            </button>
            <button onClick={onClose} className="p-2 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-black/60 transition-all">
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Floating Likes */}
        <div className="absolute right-6 bottom-32 z-30 pointer-events-none">
          {likes.map(id => (
            <div key={id} className="absolute bottom-0 right-0 animate-bounce-up opacity-0">
              <Heart className="text-red-500 fill-red-500" size={32} />
            </div>
          ))}
        </div>

        {/* Active Material Overlay - mirrors broadcaster's material display */}
        {activeMaterial && activeMaterial.url && (
          <div className="absolute inset-0 pointer-events-none z-20">
            <div
              key={activeMaterial.id}
              style={{
                width: `${activeMaterial.width || 50}%`,
                height: activeMaterial.type === 'banner' ? `${activeMaterial.width || 50}%` : 'auto',
                opacity: (activeMaterial.opacity ?? 100) / 100,
                position: 'absolute',
                ...(activeMaterial.type === 'banner'
                  ? { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
                  : activeMaterial.type === 'product'
                  ? { right: '12px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }
                  : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }),
              }}
            >
              {activeMaterial.type === 'banner' ? (
                <div className="w-full h-full bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
                  <img
                    src={activeMaterial.url}
                    alt={activeMaterial.name}
                    className="w-full flex-1 object-cover min-h-0"
                    loading="eager"
                    decoding="sync"
                    fetchPriority="high"
                  />
                  {activeMaterial.name && (
                    <div className="p-3 bg-black/60 flex-shrink-0">
                      <p className="text-white font-black text-center uppercase tracking-widest text-sm">{activeMaterial.name}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-3xl overflow-hidden shadow-2xl border-4 border-white">
                  <img
                    src={activeMaterial.url}
                    alt={activeMaterial.name}
                    className="w-full h-auto object-cover"
                    loading="eager"
                    decoding="sync"
                    fetchPriority="high"
                  />
                  {activeMaterial.name && (
                    <div className="p-2 bg-black/60 backdrop-blur-md">
                      <p className="text-white text-xs font-black text-center">{activeMaterial.name}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Current Product Overlay - with Add to Cart */}
        {currentProduct && (
          <div
            className="absolute right-3 md:right-4 z-40 pointer-events-auto animate-in slide-in-from-bottom-4 duration-500 w-[52vw] max-w-[220px] md:w-[60vw] md:max-w-[280px]"
            style={{
              // Lift the product card above the chat input / login button when
              // the chat overlay is visible, so the "상품 담기" and "바로 결제"
              // buttons remain tappable. The chat input row (input or kakao
              // login button) is ~68px tall including padding, so we push the
              // card up by that amount when chat is open. Also keeps z-index
              // above the chat overlay's z-30 so taps land on the card.
              bottom: showChatOverlay
                ? 'calc(env(safe-area-inset-bottom, 0px) + 80px)'
                : 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
            }}
          >
            <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-2.5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 border border-white/20">
                  <SafeImage src={(currentProduct.image && currentProduct.image.trim()) || FALLBACK_IMAGE} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-white text-[11px] font-black truncate">{currentProduct.name}</h4>
                  {currentProduct.price && <p className="text-white/60 text-[9px] truncate">{currentProduct.price}</p>}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={(e) => handleAddToCart(e)}
                  disabled={cartAdding || cartAddedId === currentProduct.id}
                  className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide transition-all flex items-center justify-center gap-1 ${
                    cartAddedId === currentProduct.id
                      ? 'bg-green-600 text-white'
                      : cartItems.some(i => i.productId === currentProduct.id)
                      ? 'bg-white/20 text-white/60'
                      : 'bg-orange-500 text-white hover:bg-orange-600 active:scale-95'
                  }`}
                >
                  {cartAddedId === currentProduct.id ? (
                    <><ShoppingCart size={10} /> 담았어요!</>
                  ) : cartItems.some(i => i.productId === currentProduct.id) ? (
                    <><ShoppingCart size={10} /> 담기 완료</>
                  ) : (
                    <><ShoppingBag size={10} /> {cartAdding ? '담는중...' : '상품 담기'}</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleOpenCheckout}
                  className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide bg-purple-600 text-white hover:bg-purple-700 transition-all flex items-center justify-center gap-1 active:scale-95"
                >
                  <CreditCard size={10} /> 바로 결제
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cart Badge & Kakao Send Button */}
        {cartItems.length > 0 && (
          <div
            className="absolute right-4 z-40 flex flex-col gap-2"
            style={{
              // Sit just above the bottom-right product card so both remain tappable.
              // The product card shifts up when the chat overlay is open to clear
              // the chat input / login button, and the cart badge follows it.
              bottom: showChatOverlay
                ? 'calc(env(safe-area-inset-bottom, 0px) + 178px)'
                : 'calc(env(safe-area-inset-bottom, 0px) + 110px)',
            }}
          >
            {/* Cart count badge */}
            <button
              onClick={() => setShowCartList(!showCartList)}
              className="bg-orange-500 text-white p-3 rounded-full shadow-lg hover:bg-orange-600 transition-all active:scale-95 relative"
            >
              <ShoppingCart size={20} />
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center">{cartItems.length}</span>
            </button>
          </div>
        )}

        {/* Cart list popup */}
        {showCartList && cartItems.length > 0 && (
          <div
            className="absolute left-4 right-4 z-40 animate-in slide-in-from-bottom-4 duration-300"
            style={{
              bottom: showChatOverlay
                ? 'calc(min(38vh, 320px) + 1rem)'
                : 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
            }}
          >
            <div className="bg-black/80 backdrop-blur-xl border border-white/20 rounded-2xl p-4 max-h-[50vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-white text-sm font-black flex items-center gap-2">
                  <ShoppingCart size={16} className="text-orange-400" /> 담은 상품 ({cartItems.length}개)
                </h4>
                <button onClick={() => setShowCartList(false)} className="text-white/40 hover:text-white">
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-2 mb-3">
                {cartItems.map((item, idx) => (
                  <div key={`${item.productId}-${idx}`} className="flex items-center gap-3 bg-white/5 p-2.5 rounded-xl">
                    {item.productImage ? (
                      <img src={item.productImage} alt={item.productName} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                        <Package size={14} className="text-white/30" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-bold truncate">{item.productName}</p>
                      {item.selectedOptions && Object.keys(item.selectedOptions).length > 0 && (
                        <p className="text-purple-300 text-[10px]">{Object.entries(item.selectedOptions).map(([k, v]) => `${k}: ${v}`).join(' / ')}</p>
                      )}
                      {item.productPrice && <p className="text-white/40 text-[10px]">{item.productPrice}</p>}
                    </div>
                    <a
                      href={item.productLink?.startsWith('http') ? item.productLink : `https://${item.productLink}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-purple-400 text-[10px] font-bold hover:text-purple-300 flex-shrink-0 ${item.productLink ? '' : 'hidden'}`}
                    >
                      바로가기
                    </a>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRemoveCartItem(item.productId, item.selectedOptions); }}
                      aria-label="담기 취소"
                      className="text-white/30 hover:text-red-400 flex-shrink-0 p-1"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              {/* Total + batch checkout CTA */}
              {batchTotal > 0 && (
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-white/50 text-[10px] font-black uppercase tracking-widest">총 {batchPayableItems.length}개 합계</span>
                  <span className="text-white text-sm font-black">{batchTotal.toLocaleString()}원</span>
                </div>
              )}
              {batchTotal > 0 && (
                <button
                  onClick={handleOpenBatchCheckout}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-500 text-white py-3 rounded-xl font-black text-sm hover:from-purple-700 hover:to-pink-600 transition-all active:scale-95 mb-2"
                >
                  <CreditCard size={16} />
                  {batchTotal.toLocaleString()}원 한 번에 결제하기
                </button>
              )}
              {batchUnpriceableItems.length > 0 && (
                <p className="text-amber-300/80 text-[10px] font-medium text-center mb-2">
                  가격 정보가 없는 {batchUnpriceableItems.length}개 상품은 결제할 수 없습니다. 판매자에게 가격을 문의해주세요.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Option Picker Modal */}
        {showOptionPicker && currentProduct && currentProduct.options && (
          <div className="absolute inset-0 z-50 flex items-end justify-center" onClick={() => setShowOptionPicker(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-md bg-slate-900 border-t border-white/10 rounded-t-3xl p-5 animate-in slide-in-from-bottom-8 duration-300"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-white text-sm font-black">옵션 선택</h4>
                <button onClick={() => setShowOptionPicker(false)} className="text-white/40 hover:text-white"><X size={18} /></button>
              </div>
              <div className="flex items-center gap-3 mb-4 bg-white/5 p-3 rounded-xl">
                {currentProduct.image && (
                  <SafeImage src={currentProduct.image} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-bold truncate">{currentProduct.name}</p>
                  {currentProduct.price && <p className="text-white/50 text-[10px]">{currentProduct.price}</p>}
                </div>
              </div>
              <div className="space-y-4 mb-5">
                {(currentProduct.options as { id: string; name: string; values: any[] }[]).map((opt) => (
                  <div key={opt.id}>
                    <p className="text-white/60 text-[10px] font-black uppercase tracking-widest mb-2">{opt.name}</p>
                    <div className="flex flex-wrap gap-2">
                      {opt.values
                        .map((v: any) => (typeof v === 'string' ? { value: v } : v))
                        .filter((v: any) => v?.value && v.value.trim())
                        .map((v: any) => {
                          const selected = pendingOptions[opt.name] === v.value;
                          const meta: string[] = [];
                          if (typeof v.price === 'number' && v.price > 0) meta.push(`${v.price.toLocaleString()}원`);
                          if (typeof v.discount === 'number' && v.discount > 0) meta.push(`-${v.discount}%`);
                          return (
                            <button
                              key={v.value}
                              onClick={() => setPendingOptions(prev => ({ ...prev, [opt.name]: v.value }))}
                              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-0.5 ${
                                selected
                                  ? 'bg-purple-600 text-white ring-2 ring-purple-400'
                                  : 'bg-white/10 text-white/60 hover:bg-white/20'
                              }`}
                            >
                              <span>{v.value}</span>
                              {meta.length > 0 && (
                                <span className={`text-[9px] font-black ${selected ? 'text-purple-100' : 'text-white/40'}`}>
                                  {meta.join(' · ')}
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
                {(() => {
                  const allChosen = (currentProduct.options as { name: string }[]).every(opt => pendingOptions[opt.name]);
                  if (!allChosen) return null;
                  const eff = computeEffectivePrice(currentProduct, pendingOptions);
                  if (eff <= 0) return null;
                  return (
                    <div className="flex items-center justify-between bg-purple-500/15 border border-purple-400/30 rounded-xl px-4 py-3">
                      <span className="text-purple-200 text-[10px] font-black uppercase tracking-widest">결제 금액</span>
                      <span className="text-white text-base font-black">{formatKrwPrice(eff)}</span>
                    </div>
                  );
                })()}
              </div>
              <button
                onClick={handleConfirmOptions}
                disabled={!(currentProduct.options as { id: string; name: string; values: any[] }[]).every((opt) => pendingOptions[opt.name])}
                className={`w-full py-3 rounded-xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                  optionPickerMode === 'checkout'
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-orange-500 text-white hover:bg-orange-600'
                }`}
              >
                {optionPickerMode === 'checkout'
                  ? (<><CreditCard size={16} /> 결제하기</>)
                  : (<><ShoppingBag size={16} /> 담기</>)}
              </button>
            </div>
          </div>
        )}

        {/* Simple-Pay Checkout Modal (Toss / Kakao / Card via PortOne V2) */}
        {showCheckout && checkoutProduct && (
          <div
            className="absolute inset-0 z-[60] flex items-end justify-center"
            onClick={handleCloseCheckout}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-md bg-white rounded-t-3xl p-5 animate-in slide-in-from-bottom-8 duration-300 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] font-black text-purple-500 uppercase tracking-widest">간편결제</p>
                  <h4 className="text-slate-900 text-base font-black">바로 결제</h4>
                </div>
                <button
                  type="button"
                  onClick={handleCloseCheckout}
                  disabled={checkoutProcessing}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-xl disabled:opacity-50"
                  aria-label="닫기"
                >
                  <X size={18} />
                </button>
              </div>

              {checkoutSuccess ? (
                <div className="py-6 text-center">
                  <div className="mx-auto mb-3 w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-3xl">✓</div>
                  <h5 className="text-slate-900 font-black text-base mb-1">결제가 완료되었습니다</h5>
                  <p className="text-slate-500 text-xs mb-5">주문 내역은 판매자에게 자동 전달됩니다.</p>
                  <button
                    type="button"
                    onClick={handleCloseCheckout}
                    className="w-full py-3 rounded-xl text-sm font-black bg-slate-900 text-white hover:bg-slate-800 transition-all"
                  >
                    확인
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-4 bg-slate-50 border border-slate-100 p-3 rounded-xl">
                    {checkoutProduct.image && (
                      <SafeImage
                        src={checkoutProduct.image}
                        className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-900 text-sm font-bold truncate">{checkoutProduct.name}</p>
                      {checkoutOptions && Object.keys(checkoutOptions).length > 0 && (
                        <p className="text-slate-400 text-[11px] truncate">
                          {Object.entries(checkoutOptions).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-slate-400 text-[10px] font-bold uppercase">결제 금액</p>
                      <p className="text-slate-900 text-base font-black">
                        {parseKrwPrice(checkoutProduct.price).toLocaleString('ko-KR')}<span className="text-[10px] font-bold ml-0.5">원</span>
                      </p>
                    </div>
                  </div>

                  {checkoutError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-3 py-2 mb-3">
                      {checkoutError}
                    </div>
                  )}

                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">결제 수단</p>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <button
                      type="button"
                      onClick={() => setCheckoutPayMethod('KAKAOPAY')}
                      disabled={checkoutProcessing}
                      className={`py-3 px-2 rounded-xl border-2 text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                        checkoutPayMethod === 'KAKAOPAY'
                          ? 'border-yellow-400 bg-yellow-50 text-yellow-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      } disabled:opacity-50`}
                    >
                      <span className="font-black text-yellow-700 text-sm">pay</span>
                      <span>카카오페이</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckoutPayMethod('TOSSPAY')}
                      disabled={checkoutProcessing}
                      className={`py-3 px-2 rounded-xl border-2 text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                        checkoutPayMethod === 'TOSSPAY'
                          ? 'border-blue-400 bg-blue-50 text-blue-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      } disabled:opacity-50`}
                    >
                      <span className="font-black text-blue-600 text-sm">toss</span>
                      <span>토스페이</span>
                    </button>
                  </div>

                  {checkoutPayMethod === 'KAKAOPAY' && (
                    <p className="text-[11px] text-slate-400 font-medium mb-4">
                      카카오톡 앱에서 카카오페이로 간편하게 결제됩니다.
                    </p>
                  )}
                  {checkoutPayMethod === 'TOSSPAY' && (
                    <p className="text-[11px] text-slate-400 font-medium mb-4">
                      토스 앱에서 토스페이로 간편하게 결제됩니다.
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleConfirmCheckout}
                    disabled={checkoutProcessing}
                    className={`w-full py-3 rounded-xl text-sm font-black text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
                      checkoutPayMethod === 'KAKAOPAY'
                        ? 'bg-gradient-to-r from-yellow-400 to-amber-400 hover:from-yellow-500 hover:to-amber-500 text-yellow-900'
                        : 'bg-gradient-to-r from-blue-400 to-blue-500 hover:from-blue-500 hover:to-blue-600'
                    }`}
                  >
                    {checkoutProcessing ? (
                      <><Loader2 size={14} className="animate-spin" /> 결제 진행 중...</>
                    ) : (
                      <>
                        <CreditCard size={14} />
                        {parseKrwPrice(checkoutProduct.price).toLocaleString()}원 {checkoutPayMethod === 'KAKAOPAY' ? '카카오페이로 결제' : '토스페이로 결제'}
                      </>
                    )}
                  </button>
                  <p className="mt-3 text-[10px] text-slate-400 leading-relaxed text-center">
                    결제 진행 시 픽스폴리오의 결제 약관 및 PG사 약관에 동의하는 것으로 간주됩니다.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Batch Checkout Modal — pay for all cart items in one PortOne V2 call */}
        {showBatchCheckout && (
          <div
            className="absolute inset-0 z-[60] flex items-end justify-center"
            onClick={handleCloseBatchCheckout}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-md bg-white rounded-t-3xl p-5 animate-in slide-in-from-bottom-8 duration-300 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] font-black text-purple-500 uppercase tracking-widest">한번에 결제</p>
                  <h4 className="text-slate-900 text-base font-black">담은 상품 {batchPayableItems.length}개 결제</h4>
                </div>
                <button
                  type="button"
                  onClick={handleCloseBatchCheckout}
                  disabled={batchProcessing}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-xl disabled:opacity-50"
                  aria-label="닫기"
                >
                  <X size={18} />
                </button>
              </div>

              {batchSuccess ? (
                <div className="py-6 text-center">
                  <div className="mx-auto mb-3 w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-3xl">✓</div>
                  <h5 className="text-slate-900 font-black text-base mb-1">결제가 완료되었습니다</h5>
                  <p className="text-slate-500 text-xs mb-5">{batchPayableItems.length}건의 주문이 판매자에게 전달되었어요.</p>
                  <button
                    type="button"
                    onClick={handleCloseBatchCheckout}
                    className="w-full py-3 rounded-xl text-sm font-black bg-slate-900 text-white hover:bg-slate-800 transition-all"
                  >
                    확인
                  </button>
                </div>
              ) : (
                <>
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 mb-4 max-h-48 overflow-y-auto space-y-2">
                    {batchPayableItems.map((it, idx) => (
                      <div key={`batch-${it.productId}-${idx}`} className="flex items-center gap-2">
                        {it.productImage ? (
                          <SafeImage src={it.productImage} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0">
                            <Package size={14} className="text-slate-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-900 text-xs font-bold truncate">{it.productName}</p>
                          {it.selectedOptions && Object.keys(it.selectedOptions).length > 0 && (
                            <p className="text-slate-400 text-[10px] truncate">{Object.entries(it.selectedOptions).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
                          )}
                        </div>
                        <p className="text-slate-700 text-xs font-black flex-shrink-0">{parseKrwPrice(it.productPrice).toLocaleString()}원</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mb-4 px-1">
                    <p className="text-slate-400 text-[11px] font-bold uppercase">총 결제 금액</p>
                    <p className="text-slate-900 text-lg font-black">
                      {batchTotal.toLocaleString('ko-KR')}<span className="text-[11px] font-bold ml-0.5">원</span>
                    </p>
                  </div>

                  {batchError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-3 py-2 mb-3">
                      {batchError}
                    </div>
                  )}

                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">결제 수단</p>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <button
                      type="button"
                      onClick={() => setBatchPayMethod('KAKAOPAY')}
                      disabled={batchProcessing}
                      className={`py-3 px-2 rounded-xl border-2 text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                        batchPayMethod === 'KAKAOPAY'
                          ? 'border-yellow-400 bg-yellow-50 text-yellow-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      } disabled:opacity-50`}
                    >
                      <span className="font-black text-yellow-700 text-sm">pay</span>
                      <span>카카오페이</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBatchPayMethod('TOSSPAY')}
                      disabled={batchProcessing}
                      className={`py-3 px-2 rounded-xl border-2 text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 ${
                        batchPayMethod === 'TOSSPAY'
                          ? 'border-blue-400 bg-blue-50 text-blue-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      } disabled:opacity-50`}
                    >
                      <span className="font-black text-blue-600 text-sm">toss</span>
                      <span>토스페이</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleConfirmBatchCheckout}
                    disabled={batchProcessing}
                    className={`w-full py-3 rounded-xl text-sm font-black text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
                      batchPayMethod === 'KAKAOPAY'
                        ? 'bg-gradient-to-r from-yellow-400 to-amber-400 hover:from-yellow-500 hover:to-amber-500 text-yellow-900'
                        : 'bg-gradient-to-r from-blue-400 to-blue-500 hover:from-blue-500 hover:to-blue-600'
                    }`}
                  >
                    {batchProcessing ? (
                      <><Loader2 size={14} className="animate-spin" /> 결제 진행 중...</>
                    ) : (
                      <>
                        <CreditCard size={14} />
                        {batchTotal.toLocaleString()}원 {batchPayMethod === 'KAKAOPAY' ? '카카오페이로 결제' : '토스페이로 결제'}
                      </>
                    )}
                  </button>
                  <p className="mt-3 text-[10px] text-slate-400 leading-relaxed text-center">
                    여러 상품을 한 번의 결제로 처리합니다. 결제 진행 시 픽스폴리오 결제 약관 및 PG사 약관에 동의하는 것으로 간주됩니다.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Chat Overlay - Transparent over video */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-30 flex flex-col pointer-events-none transition-opacity duration-300 ${showChatOverlay ? 'opacity-100' : 'opacity-0'}`}
        style={{
          maxHeight: 'min(38vh, 320px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Chat toggle button */}
        <div className="absolute -top-12 right-4 pointer-events-auto">
          <button
            onClick={() => setShowChatOverlay(!showChatOverlay)}
            className="p-2 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-black/60 transition-all"
          >
            <MessageCircle size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-1 space-y-1.5 scrollbar-hide overscroll-contain pointer-events-auto" style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%)' }}>
          {messages.map((msg) => (
            <div key={msg.id} className="animate-in fade-in slide-in-from-bottom-1 duration-200 flex items-start gap-2 py-0.5">
              {msg.profileImage && (
                <img src={msg.profileImage} alt="" className="w-6 h-6 rounded-full object-cover mt-0.5 flex-shrink-0" />
              )}
              <div className="min-w-0 bg-black/30 backdrop-blur-sm rounded-xl px-2.5 py-1.5 max-w-[85%]">
                <span className="text-purple-300 text-[10px] font-black mr-1.5">{msg.user}</span>
                <span className="text-white/90 text-[13px] font-medium break-words">{msg.text}</span>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="px-4 pb-4 pt-2 pointer-events-auto shrink-0" style={{ touchAction: 'manipulation' }}>
          {kakaoUser ? (
            <div className="relative">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="메시지를 입력하세요..."
                className="w-full bg-black/40 backdrop-blur-md border border-white/15 rounded-full py-2.5 px-5 pr-12 text-white text-[14px] focus:outline-none focus:border-purple-500/50 transition-all placeholder:text-white/30"
              />
              <button
                onClick={handleSendMessage}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-purple-400 hover:text-purple-300"
              >
                <Send size={18} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowLoginPrompt(true)}
              className="w-full flex items-center justify-center gap-2 bg-[#FEE500]/90 backdrop-blur-md text-[#3C1E1E] py-2.5 rounded-full font-black text-sm hover:opacity-90 transition-all"
            >
              <MessageCircle size={16} />
              로그인하고 채팅 참여하기
            </button>
          )}
        </div>
      </div>

      {/* Login Prompt Modal - Kakao Login Required */}
      {showLoginPrompt && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 max-w-sm mx-4 text-center animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 bg-[#FEE500] rounded-full flex items-center justify-center mx-auto mb-4">
              <LogIn size={28} className="text-[#3C1E1E]" />
            </div>
            <h3 className="text-xl font-black text-slate-900 mb-2">카카오 로그인</h3>
            <p className="text-slate-500 text-sm font-medium mb-6">채팅 및 상품 담기 기능을 이용하려면<br />카카오 로그인이 필요합니다.</p>

            {/* Consent items */}
            <div className={`mb-4 rounded-xl border text-left ${liveConsentRequired && !liveConsentPrivacy ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'} p-3 space-y-2`}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={liveConsentPrivacy && liveConsentMarketing}
                  onChange={(e) => {
                    setLiveConsentPrivacy(e.target.checked);
                    setLiveConsentMarketing(e.target.checked);
                    if (e.target.checked) setLiveConsentRequired(false);
                  }}
                  className="mt-0.5 w-4 h-4 accent-yellow-500"
                />
                <span className="text-sm font-bold text-slate-900">전체 동의하기</span>
              </label>
              <div className="border-t border-slate-200 my-1"></div>
              <div className="flex items-start gap-2">
                <label className="flex items-start gap-2 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={liveConsentPrivacy}
                    onChange={(e) => {
                      setLiveConsentPrivacy(e.target.checked);
                      if (e.target.checked) setLiveConsentRequired(false);
                    }}
                    className="mt-0.5 w-4 h-4 accent-yellow-500"
                  />
                  <span className="text-xs text-slate-700">
                    <span className="font-bold text-yellow-600">[필수]</span> 개인정보 수집·이용 동의 (닉네임, 프로필 이미지)
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowLiveConsentDetail('privacy')}
                  className="text-xs text-slate-400 underline shrink-0"
                >
                  보기
                </button>
              </div>
              <div className="flex items-start gap-2">
                <label className="flex items-start gap-2 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={liveConsentMarketing}
                    onChange={(e) => setLiveConsentMarketing(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-yellow-500"
                  />
                  <span className="text-xs text-slate-700">
                    <span className="font-bold text-slate-500">[선택]</span> 라이브/이벤트 알림 수신 동의
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowLiveConsentDetail('marketing')}
                  className="text-xs text-slate-400 underline shrink-0"
                >
                  보기
                </button>
              </div>
            </div>

            {kakaoLoginError && (
              <p className="text-red-500 text-xs font-bold mb-4 bg-red-50 rounded-xl py-2 px-3">{kakaoLoginError}</p>
            )}

            {kakaoAvailable ? (
              <button
                onClick={handleKakaoLogin}
                disabled={!liveConsentPrivacy}
                className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-black text-base hover:opacity-90 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#FEE500', color: '#000000' }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3C6.48 3 2 6.36 2 10.44c0 2.62 1.72 4.92 4.32 6.24-.14.52-.92 3.36-.96 3.58 0 0-.02.16.08.22.1.06.22.02.22.02.3-.04 3.44-2.26 3.98-2.64.76.1 1.56.16 2.36.16 5.52 0 10-3.36 10-7.58C22 6.36 17.52 3 12 3z" fill="#000000"/>
                </svg>
                카카오로 1초 만에 시작하기
              </button>
            ) : (
              <p className="text-slate-500 text-xs font-medium bg-slate-50 rounded-xl py-3 px-4">
                카카오 로그인 서비스를 불러오는 중입니다. 잠시 후 다시 시도해주세요.
              </p>
            )}

            <button
              onClick={() => setShowLoginPrompt(false)}
              className="w-full text-slate-400 font-bold text-sm py-2 mt-3 hover:text-slate-600 transition-all"
            >
              닫기
            </button>
          </div>

          {/* Consent detail sub-modal */}
          {showLiveConsentDetail && (
            <div className="fixed inset-0 z-[310] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowLiveConsentDetail(null)}></div>
              <div className="relative bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl max-h-[80vh] overflow-y-auto text-left">
                <button onClick={() => setShowLiveConsentDetail(null)} className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
                {showLiveConsentDetail === 'privacy' ? (
                  <div>
                    <h4 className="text-base font-black text-slate-900 mb-3">개인정보 수집·이용 동의 (필수)</h4>
                    <div className="text-xs text-slate-700 space-y-2 leading-relaxed">
                      <p><span className="font-bold">수집 항목:</span> 카카오 닉네임, 프로필 이미지</p>
                      <p><span className="font-bold">수집 목적:</span> 라이브 채팅 표시, 상품 담기 및 주문 시 본인 식별</p>
                      <p><span className="font-bold">보유 기간:</span> 로그아웃 또는 회원 탈퇴 시까지</p>
                      <p className="text-slate-500">동의를 거부할 권리가 있으며, 거부 시 라이브 채팅·구매 기능을 이용할 수 없습니다.</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h4 className="text-base font-black text-slate-900 mb-3">라이브/이벤트 알림 수신 동의 (선택)</h4>
                    <div className="text-xs text-slate-700 space-y-2 leading-relaxed">
                      <p><span className="font-bold">수신 채널:</span> 카카오 알림톡</p>
                      <p><span className="font-bold">발송 내용:</span> 라이브 시작 알림, 이벤트·프로모션 안내</p>
                      <p><span className="font-bold">철회 방법:</span> 사용자 페이지에서 알림 해지 또는 채널 차단</p>
                      <p className="text-slate-500">선택 동의 항목으로, 거부하셔도 라이브 채팅·구매 기능 이용이 가능합니다.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes bounce-up {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-150px) scale(1.5); opacity: 0; }
        }
        .animate-bounce-up {
          animation: bounce-up 2s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default LiveStream;
