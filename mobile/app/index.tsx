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
import { useFocusEffect } from 'expo-router';
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

/** KakaoTalk universal links must be resolved by the OS, not rendered in WebView. */
const KAKAO_TALK_UNIVERSAL_LINK = /^https:\/\/talk-apps\.kakao\.com\/scheme\//i;

/** http(s) hosts that should always open in the system browser, not in-app. */
function isInternalUrl(url: string): boolean {
  // Everything on the web app, the auth providers it redirects through, and the
  // PG checkout pages stay inside the WebView so the session is preserved.
  return INTERNAL_SCHEME.test(url);
}

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

/**
 * Injected before the web app loads. Advertises the native shell + native push
 * support and exposes `PicksFolioNative.registerPush(username, userType)` so the
 * web app can hand the signed-in user to the shell, which registers the device's
 * push token for new-message alerts. Kakao login stays on the web flow; the
 * WebView only hands KakaoTalk URLs to the OS.
 */
const NATIVE_BRIDGE = `
  (function () {
    if (window.__PICKSFOLIO_NATIVE__) return;
    window.__PICKSFOLIO_NATIVE__ = true;
    window.__PICKSFOLIO_NATIVE_PUSH__ = true;
    window.__PICKSFOLIO_NATIVE_KAKAO__ = false;
    function post(payload) {
      try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}
    }
    window.PicksFolioNative = {
      version: 5,
      pushSupported: true,
      kakaoSupported: false,
      registerPush: function (username, userType, accessToken) {
        post({ type: 'REGISTER_PUSH', payload: { username: username, userType: userType, accessToken: accessToken } });
      }
    };
  })();
  true;
`;

/** Resolve a deep-link path (or absolute url) from a push payload to a full url. */
function resolveUrl(path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${config.webUrl}${path}`;
}

/** Host part of an http(s) url, lower-cased, with a leading `www.` dropped. */
function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ''));
  return match ? match[1].toLowerCase().replace(/^www\./, '') : '';
}

const WEB_HOST = hostOf(config.webUrl);

/**
 * Renderer crashes within this window count towards the crash-loop cap. Past
 * the cap a remount goes back to the start url instead of the page that keeps
 * taking the renderer down.
 */
const CRASH_WINDOW_MS = 2 * 60 * 1000;
const CRASH_LOOP_CAP = 3;

/**
 * Where a fresh WebView resumes after the renderer died: the web app page the
 * user was on, without its query/hash (those can carry one-shot OAuth codes and
 * tokens), plus a marker that tells the web app to reopen the dashboard tab it
 * was showing (src/utils/resumeTab).
 */
function resumeUrl(url: string): string {
  const match = /^(https?:\/\/[^/?#]+)(\/[^?#]*)?/i.exec(url);
  if (!match) return config.webUrl;
  return `${match[1]}${match[2] || '/'}?picks_resume=1`;
}

/**
 * Whether a bridge message came from the web app itself. Login and checkout
 * pages of other sites are opened inside the same WebView (and get the injected
 * bridge too), so their messages must not be able to change which account this
 * device receives push notifications for.
 */
function isOwnPage(url: string): boolean {
  return Boolean(WEB_HOST) && hostOf(url) === WEB_HOST;
}

export default function WebAppScreen() {
  const webRef = useRef<WebView>(null);
  // Bumped to mount a fresh WebView after Android kills its renderer process.
  const [webKey, setWebKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [sourceUri, setSourceUri] = useState(config.webUrl);
  // Tracked both as a ref (read synchronously by the Android hardware back
  // handler) and as state (drives the visible back button's appearance).
  const canGoBack = useRef(false);
  const [showBack, setShowBack] = useState(false);
  const loadedRef = useRef(false);
  // Last page of the web app itself the WebView showed. A renderer crash
  // remounts the WebView, and starting over at the start url dropped the user on
  // the first screen in the middle of whatever they were doing.
  const lastOwnUrl = useRef(config.webUrl);
  const crashTimes = useRef<number[]>([]);
  // The web app reports an open editor with unsaved input; pull-to-refresh is
  // switched off meanwhile so a downward drag cannot reload the page under it.
  const [unsavedWork, setUnsavedWork] = useState(false);

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
    if (nav.url && isOwnPage(nav.url)) lastOwnUrl.current = nav.url;
  }, []);

  // Visible back button: navigate the WebView's history back one step. Gives
  // iOS users (who otherwise only have the edge-swipe gesture) and Android
  // users an always-visible way out of any page the WebView lands on.
  const goBack = useCallback(() => {
    webRef.current?.goBack();
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
      if (KAKAO_TALK_UNIVERSAL_LINK.test(url)) {
        Linking.openURL(url).catch(() => {
          // If KakaoTalk is unavailable, keep the current Kakao login page in
          // place so its account-login fallback remains usable.
        });
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

  // The OS may kill the web content process while the app is in the background
  // (most often while the camera or photo picker is open on top of it). Without
  // handling, the WebView is left blank and the app looks crashed.
  //
  // iOS: the same WebView can simply load the page again.
  const onContentProcessDidTerminate = useCallback(() => {
    setLoading(true);
    webRef.current?.reload();
  }, []);

  // Android: a WebView whose renderer is gone cannot be reused, so mount a new one
  // on the page the user was on.
  const onRenderProcessGone = useCallback(() => {
    const now = Date.now();
    crashTimes.current = [...crashTimes.current.filter((t) => now - t < CRASH_WINDOW_MS), now];
    const looping = crashTimes.current.length >= CRASH_LOOP_CAP;
    loadedRef.current = false;
    canGoBack.current = false;
    setShowBack(false);
    setErrored(false);
    setLoading(true);
    setUnsavedWork(false);
    setSourceUri(looping ? config.webUrl : resumeUrl(lastOwnUrl.current));
    setWebKey((key) => key + 1);
  }, []);

  // Bridge: push registration and the unsaved-work flag. Kakao app hand-off is
  // handled by URL interception above, without a native Kakao SDK bridge.
  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      if (!isOwnPage(e.nativeEvent.url)) return;
      let msg: { type?: string; payload?: Record<string, unknown> } | null = null;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg?.type === 'UNSAVED_WORK') {
        setUnsavedWork(msg.payload?.unsaved === true);
        return;
      }
      if (msg?.type === 'REGISTER_PUSH') {
        const username = msg.payload?.username;
        const accessToken = msg.payload?.accessToken;
        const userType = msg.payload?.userType === 'business' ? 'business' : 'influencer';
        if (typeof username === 'string' && username && typeof accessToken === 'string' && accessToken) {
          registerPushForUser(username, userType, accessToken);
        }
      }
    },
    [],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <WebView
        key={webKey}
        ref={webRef}
        source={{ uri: sourceUri }}
        style={styles.web}
        // Advertise the native shell + expose the push-registration bridge.
        injectedJavaScriptBeforeContentLoaded={NATIVE_BRIDGE}
        // Keep the auth/session cookies that Kakao + Supabase rely on.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        // 페이지 안에 실린 영상(캠페인 소재 미리보기 등)은 전체화면으로 튀지 않고
        // 그 자리에서 재생한다.
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
        pullToRefreshEnabled={!unsavedWork}
        allowsBackForwardNavigationGestures
        onNavigationStateChange={onNavStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoad}
        onContentProcessDidTerminate={onContentProcessDidTerminate}
        onRenderProcessGone={onRenderProcessGone}
        onMessage={onMessage}
        onLoadStart={() => {
          setLoading(true);
          // A new document starts with no editor open; it reports again if needed.
          setUnsavedWork(false);
        }}
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
