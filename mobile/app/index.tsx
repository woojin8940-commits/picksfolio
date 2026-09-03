import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type {
  WebViewMessageEvent,
  WebViewNavigation,
} from 'react-native-webview';
import { config } from '@/constants/config';
import {
  isKakaoNativeLoginAvailable,
  signInWithKakaoTalk,
} from '@/services/kakaoAuth';
import { registerPushForUser } from '@/services/push';
import { colors } from '@/theme';

/** Schemes that are internal to the WebView and must never be delegated out. */
const INTERNAL_SCHEME = /^(https?|about|data|blob|file):/i;

/**
 * Custom URL schemes that belong to other apps (KakaoTalk hand-off, Korean
 * payment/PG apps, bank apps, dialer, mail, store …). These must be handed to
 * the OS instead of being loaded inside the WebView, otherwise Kakao login and
 * checkout silently fail. Anything that is not an internal scheme is treated as
 * an external app launch.
 */
const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** http(s) hosts that should always open in the system browser, not in-app. */
function isInternalUrl(url: string): boolean {
  // Everything on the web app, the auth providers it redirects through, and the
  // PG checkout pages stay inside the WebView so the session is preserved.
  return INTERNAL_SCHEME.test(url);
}

/** Deep link the web app can navigate to in order to open the native broadcast. */
const BROADCAST_DEEPLINK = /^picksfolio:\/\/broadcast/i;

/**
 * Android's `intent://…#Intent;…;end` links, which Korean apps (KakaoTalk's web
 * login button, PG/bank apps) hand to the browser. `Linking.openURL` cannot
 * launch them — Android's browsers understand the syntax, a plain intent URL
 * handed to the OS goes nowhere — so the parts we need are pulled out here:
 * the real app scheme, the `S.browser_fallback_url` to load instead, and the
 * package name (last resort: open its Play Store page).
 */
function parseAndroidIntent(url: string): {
  appUrl: string | null;
  fallbackUrl: string | null;
  packageName: string | null;
} {
  const marker = url.indexOf('#Intent;');
  if (marker < 0) return { appUrl: null, fallbackUrl: null, packageName: null };

  const params: Record<string, string> = {};
  for (const part of url.slice(marker + '#Intent;'.length).split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq)] = part.slice(eq + 1);
  }

  const scheme = params.scheme;
  // Everything between the `intent:` prefix and `#Intent;` is the data part
  // that gets re-attached to the real scheme (`intent://host/path` → `host/path`).
  let data = url.slice(url.indexOf(':') + 1, marker);
  if (data.startsWith('//')) data = data.slice(2);
  let fallbackUrl: string | null = null;
  if (params['S.browser_fallback_url']) {
    try {
      fallbackUrl = decodeURIComponent(params['S.browser_fallback_url']);
    } catch {
      fallbackUrl = params['S.browser_fallback_url'];
    }
  }

  return {
    appUrl: scheme ? `${scheme}://${data}` : null,
    fallbackUrl,
    packageName: params.package || null,
  };
}

/** Parse a `key=value&…` query string without relying on URLSearchParams. */
function parseQuery(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = url.split('?')[1];
  if (!q) return out;
  for (const pair of q.split('&')) {
    const [k, v = ''] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

/** Open the native broadcast screen, forwarding only the params we recognise. */
function openNativeBroadcast(raw: Record<string, unknown>): void {
  const params: Record<string, string> = {};
  for (const key of ['username', 'ingestServer', 'streamKey'] as const) {
    const value = raw[key];
    if (typeof value === 'string' && value) params[key] = value;
  }
  router.push({ pathname: '/broadcast', params });
}

/**
 * Is the native Kakao SDK linked into this build? Development builds made
 * without `EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY` and Expo Go do not have it, and
 * the answer never changes at runtime — so it is resolved once, here.
 */
const KAKAO_NATIVE_READY = isKakaoNativeLoginAvailable();

/**
 * `PicksFolioNative.kakaoLogin()` — only advertised when the native SDK is
 * actually present. Returns a promise the web app awaits: the shell logs in
 * through KakaoTalk app-to-app and injects the result back by request id.
 *
 * This exists because the web flow cannot finish inside an in-app WebView.
 * KakaoTalk returns the authorization code to the phone's DEFAULT browser, so
 * the hand-off leaves the app and the WebView never sees the answer. Going
 * through the native SDK keeps the whole round trip inside the app; the web app
 * receives the ID token and creates the very same Supabase session it would
 * have created on the web.
 */
const KAKAO_BRIDGE_METHOD = KAKAO_NATIVE_READY
  ? `
      kakaoLogin: function () {
        return new Promise(function (resolve, reject) {
          var id = 'k' + Date.now() + '_' + Math.random().toString(36).slice(2);
          kakaoWaiters[id] = { resolve: resolve, reject: reject };
          post({ type: 'KAKAO_LOGIN', payload: { requestId: id } });
        });
      },`
  : '';

/**
 * Injected before the web app loads. Advertises the native shell + native push
 * support and exposes `PicksFolioNative.registerPush(username, userType)` so the
 * web app can hand the signed-in user to the shell, which registers the device's
 * push token for new-message alerts. When the native Kakao SDK is linked it also
 * exposes `PicksFolioNative.kakaoLogin()` for KakaoTalk 간편로그인.
 *
 * Native broadcast handoff is intentionally NOT advertised
 * (`__PICKSFOLIO_NATIVE_BROADCAST__ = false`). Handing the broadcast off to the
 * standalone fullscreen IVS screen hid the live console (chat, product push,
 * cart status) that the host needs while live. Instead the broadcast now runs
 * inside the WebView (getUserMedia + WebRTC, with the same IVS/RTMPS fallback),
 * so the host keeps the full console on screen while broadcasting and web
 * viewers receive the WebRTC stream as before. `openBroadcast` is still exposed
 * for backwards compatibility but the web app no longer calls it.
 */
const NATIVE_BRIDGE = `
  (function () {
    if (window.__PICKSFOLIO_NATIVE__) return;
    window.__PICKSFOLIO_NATIVE__ = true;
    window.__PICKSFOLIO_NATIVE_BROADCAST__ = false;
    window.__PICKSFOLIO_NATIVE_PUSH__ = true;
    window.__PICKSFOLIO_NATIVE_KAKAO__ = ${KAKAO_NATIVE_READY};
    function post(payload) {
      try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
    }
    // Promises waiting for a native reply, keyed by request id. The shell calls
    // window.__picksFolioKakaoResult(id, payload) once KakaoTalk is done.
    var kakaoWaiters = {};
    window.__picksFolioKakaoResult = function (id, payload) {
      var waiter = kakaoWaiters[id];
      delete kakaoWaiters[id];
      if (!waiter) return;
      if (payload && payload.ok) waiter.resolve(payload.tokens || {});
      else waiter.reject(new Error((payload && payload.error) || '카카오 로그인에 실패했습니다.'));
    };
    window.PicksFolioNative = {
      version: 3,
      broadcastSupported: false,
      pushSupported: true,
      kakaoSupported: ${KAKAO_NATIVE_READY},
      openBroadcast: function (opts) {
        post({ type: 'OPEN_NATIVE_BROADCAST', payload: opts || {} });
      },
      registerPush: function (username, userType) {
        post({ type: 'REGISTER_PUSH', payload: { username: username, userType: userType } });
      },${KAKAO_BRIDGE_METHOD}
    };
  })();
  true;
`;

/** Resolve a deep-link path (or absolute url) from a push payload to a full url. */
function resolveUrl(path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${config.webUrl}${path}`;
}

export default function WebAppScreen() {
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [sourceUri, setSourceUri] = useState(config.webUrl);
  // Tracked both as a ref (read synchronously by the Android hardware back
  // handler) and as state (drives the visible back button's appearance).
  const canGoBack = useRef(false);
  const [showBack, setShowBack] = useState(false);
  const loadedRef = useRef(false);

  // Jump the WebView to a deep-linked path (used when a push is tapped). If the
  // page is already loaded, navigate in place; otherwise point the initial load
  // at the target (cold start from a notification tap).
  const navigateTo = useCallback((path: string) => {
    const url = resolveUrl(path);
    if (loadedRef.current && webRef.current) {
      webRef.current.injectJavaScript(
        `(function(){ try { window.location.href = ${JSON.stringify(url)}; } catch (e) {} })(); true;`,
      );
    } else {
      setSourceUri(url);
    }
  }, []);

  // Handle taps on push notifications. Expo buffers the response that launched
  // the app from a cold start and delivers it once the listener is attached, so
  // this covers both warm and cold opens.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data as
        | { path?: unknown }
        | undefined;
      if (data && typeof data.path === 'string' && data.path) {
        navigateTo(data.path);
      }
    });
    return () => sub.remove();
  }, [navigateTo]);

  // Android hardware back button mirrors browser history.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (canGoBack.current) {
          webRef.current?.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, []),
  );

  const onNavStateChange = useCallback((nav: WebViewNavigation) => {
    canGoBack.current = nav.canGoBack;
    setShowBack(nav.canGoBack);
  }, []);

  // Visible back button: navigate the WebView's history back one step. Gives
  // iOS users (who otherwise only have the edge-swipe gesture) and Android
  // users an always-visible way out of any page the WebView lands on.
  const goBack = useCallback(() => {
    webRef.current?.goBack();
  }, []);

  // Ask for the camera + microphone permission once, up front, so the in-WebView
  // live broadcast can start without a permission prompt interrupting "라이브 시작".
  // Android remembers the grant, so this is a no-op (no dialog) after the first
  // time; the system dialog itself is shown in the device's language (Korean).
  // iOS surfaces its permission prompt from the Info.plist usage strings the
  // first time getUserMedia runs and likewise remembers the choice.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
      } catch {
        // Non-fatal: the WebView will request again on first getUserMedia.
      }
    })();
  }, []);

  // Android `intent://` link: launch the app it points at, and when that app is
  // missing fall back the way a browser would. A web fallback is loaded in the
  // WebView (not the system browser) so the login/checkout session survives.
  const openAndroidIntent = useCallback(
    (url: string) => {
      const { appUrl, fallbackUrl, packageName } = parseAndroidIntent(url);

      const fallback = () => {
        if (fallbackUrl && isInternalUrl(fallbackUrl)) {
          navigateTo(fallbackUrl);
        } else if (fallbackUrl) {
          Linking.openURL(fallbackUrl).catch(() => {});
        } else if (packageName) {
          Linking.openURL(`market://details?id=${packageName}`).catch(() => {});
        }
      };

      if (!appUrl) {
        fallback();
        return;
      }
      Linking.openURL(appUrl).catch(fallback);
    },
    [navigateTo],
  );

  // Route non-http(s) schemes (kakaotalk://, payment apps, tel:, mailto: …)
  // out to the OS; keep all web traffic inside the WebView.
  const onShouldStartLoad = useCallback(
    (req: { url: string }): boolean => {
      const { url } = req;
      // Native broadcast deep link: open the IVS broadcast screen instead of
      // handing the custom scheme to the OS.
      if (BROADCAST_DEEPLINK.test(url)) {
        openNativeBroadcast(parseQuery(url));
        return false;
      }
      if (isInternalUrl(url)) return true;
      // `intent://` needs unwrapping first — handing it to the OS as-is does
      // nothing, which is how the KakaoTalk/PG app buttons used to dead-end.
      if (/^intent:/i.test(url)) {
        openAndroidIntent(url);
        return false;
      }
      if (EXTERNAL_SCHEME.test(url)) {
        Linking.openURL(url).catch(() => {
          // App not installed / scheme unsupported — fail quietly so the web
          // page can show its own fallback.
        });
        return false;
      }
      return true;
    },
    [openAndroidIntent],
  );

  const reload = useCallback(() => {
    setErrored(false);
    setLoading(true);
    webRef.current?.reload();
  }, []);

  // Resolve the promise the web app is holding for a `kakaoLogin()` call. U+2028
  // / U+2029 are legal in JSON but not inside a JS string literal, so they are
  // escaped before the payload is injected as code.
  const settleKakaoLogin = useCallback(
    (requestId: string, payload: Record<string, unknown>) => {
      const encoded = JSON.stringify(payload)
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
      webRef.current?.injectJavaScript(
        `(function(){ try { window.__picksFolioKakaoResult(${JSON.stringify(
          requestId,
        )}, ${encoded}); } catch (e) {} })(); true;`,
      );
    },
    [],
  );

  // KakaoTalk 간편로그인: log in through the native SDK and hand the tokens back
  // to the web app, which turns them into a Supabase session.
  const runKakaoLogin = useCallback(
    async (requestId: string) => {
      try {
        const tokens = await signInWithKakaoTalk();
        settleKakaoLogin(requestId, { ok: true, tokens });
      } catch (err) {
        // The web app decides what to show; a user-cancelled login is silent
        // there and recognised from the message text.
        settleKakaoLogin(requestId, {
          ok: false,
          error: (err as Error)?.message || '카카오 로그인에 실패했습니다.',
        });
      }
    },
    [settleKakaoLogin],
  );

  // Bridge: the web live console calls window.PicksFolioNative.openBroadcast()
  // to hand the broadcast off to the native IVS screen, and the login screens
  // call kakaoLogin() to reach the KakaoTalk app.
  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: { type?: string; payload?: Record<string, unknown> } | null = null;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg?.type === 'OPEN_NATIVE_BROADCAST') {
        openNativeBroadcast(msg.payload ?? {});
      } else if (msg?.type === 'REGISTER_PUSH') {
        const username = msg.payload?.username;
        const userType = msg.payload?.userType === 'business' ? 'business' : 'influencer';
        if (typeof username === 'string' && username) {
          registerPushForUser(username, userType);
        }
      } else if (msg?.type === 'KAKAO_LOGIN') {
        const requestId = msg.payload?.requestId;
        if (typeof requestId === 'string' && requestId) {
          void runKakaoLogin(requestId);
        }
      }
    },
    [runKakaoLogin],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <WebView
        ref={webRef}
        source={{ uri: sourceUri }}
        style={styles.web}
        // Advertise the native shell + expose the native broadcast hand-off.
        injectedJavaScriptBeforeContentLoaded={NATIVE_BRIDGE}
        // Keep the auth/session cookies that Kakao + Supabase rely on.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        // Live commerce video + camera/mic for streaming and uploads.
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        // Camera/mic for in-WebView live broadcasting. Auto-grant the WebView's
        // getUserMedia request from the app's already-held OS permission so the
        // host is asked at most once (the system camera/mic dialog, in Korean)
        // instead of every time they open the live console or go live.
        mediaCapturePermissionGrantType="grant"
        // File pickers for portfolio/image uploads.
        allowFileAccess
        originWhitelist={['*']}
        // Open target=_blank links in the same view to preserve the session.
        setSupportMultipleWindows={false}
        // Append a recognisable token while keeping a real mobile browser UA so
        // providers don't reject the in-app browser.
        applicationNameForUserAgent="PicksFolioApp"
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        onNavigationStateChange={onNavStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoad}
        onMessage={onMessage}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => {
          setLoading(false);
          loadedRef.current = true;
        }}
        onError={() => {
          setErrored(true);
          setLoading(false);
        }}
        onHttpError={() => setLoading(false)}
        renderError={() => <View style={styles.fill} />}
      />

      {showBack && !errored && (
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
          hitSlop={8}
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
      )}

      {loading && !errored && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      )}

      {errored && (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>연결할 수 없어요</Text>
          <Text style={styles.errorBody}>
            네트워크 상태를 확인한 뒤 다시 시도해 주세요.
          </Text>
          <Pressable
            onPress={reload}
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  web: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1, backgroundColor: colors.background },
  backButton: {
    position: 'absolute',
    top: 8,
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(15,17,23,0.78)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonPressed: { opacity: 0.7 },
  backIcon: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 32,
    marginTop: -2,
    fontWeight: '600',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  errorTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  errorBody: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  retry: {
    marginTop: 8,
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
  },
  retryPressed: { opacity: 0.85 },
  retryText: { color: colors.text, fontSize: 16, fontWeight: '600' },
});
