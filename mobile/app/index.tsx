import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
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
 * Injected before the web app loads. Advertises the native shell + native
 * broadcast capability and exposes `PicksFolioNative.openBroadcast(...)`, which
 * the web live console calls to hand the broadcast off to the native IVS screen
 * instead of running the in-WebView (getUserMedia) broadcast path.
 *
 * It also advertises native push support and exposes
 * `PicksFolioNative.registerPush(username, userType)` so the web app can hand
 * the signed-in user to the shell, which registers the device's push token for
 * new-message alerts.
 */
const NATIVE_BRIDGE = `
  (function () {
    if (window.__PICKSFOLIO_NATIVE__) return;
    window.__PICKSFOLIO_NATIVE__ = true;
    window.__PICKSFOLIO_NATIVE_BROADCAST__ = true;
    window.__PICKSFOLIO_NATIVE_PUSH__ = true;
    function post(payload) {
      try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
    }
    window.PicksFolioNative = {
      version: 2,
      broadcastSupported: true,
      pushSupported: true,
      openBroadcast: function (opts) {
        post({ type: 'OPEN_NATIVE_BROADCAST', payload: opts || {} });
      },
      registerPush: function (username, userType) {
        post({ type: 'REGISTER_PUSH', payload: { username: username, userType: userType } });
      },
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
  const canGoBack = useRef(false);
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
  }, []);

  // Route non-http(s) schemes (kakaotalk://, payment apps, tel:, mailto: …)
  // out to the OS; keep all web traffic inside the WebView.
  const onShouldStartLoad = useCallback((req: { url: string }): boolean => {
    const { url } = req;
    // Native broadcast deep link: open the IVS broadcast screen instead of
    // handing the custom scheme to the OS.
    if (BROADCAST_DEEPLINK.test(url)) {
      openNativeBroadcast(parseQuery(url));
      return false;
    }
    if (isInternalUrl(url)) return true;
    if (EXTERNAL_SCHEME.test(url)) {
      Linking.openURL(url).catch(() => {
        // App not installed / scheme unsupported — fail quietly so the web
        // page can show its own fallback.
      });
      return false;
    }
    return true;
  }, []);

  const reload = useCallback(() => {
    setErrored(false);
    setLoading(true);
    webRef.current?.reload();
  }, []);

  // Bridge: the web live console calls window.PicksFolioNative.openBroadcast()
  // to hand the broadcast off to the native IVS screen.
  const onMessage = useCallback((e: WebViewMessageEvent) => {
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
    }
  }, []);

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
  retryText: { color: colors.background, fontSize: 16, fontWeight: '600' },
});
