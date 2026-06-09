import React, { useCallback, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type {
  WebViewMessageEvent,
  WebViewNavigation,
} from 'react-native-webview';
import { config } from '@/constants/config';
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

export default function WebAppScreen() {
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const canGoBack = useRef(false);

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

  // Bridge: lets the web app trigger native behaviours later if needed
  // (currently a no-op sink so postMessage calls never throw in-app).
  const onMessage = useCallback((_e: WebViewMessageEvent) => {}, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <WebView
        ref={webRef}
        source={{ uri: config.webUrl }}
        style={styles.web}
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
        onLoadEnd={() => setLoading(false)}
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
