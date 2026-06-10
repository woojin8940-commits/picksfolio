import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import {
  IVSBroadcastCameraView,
  type CameraPosition,
  type IBroadcastSessionError,
  type IIVSBroadcastCameraView,
  type StateStatusUnion,
} from 'amazon-ivs-react-native-broadcast';
import { config, broadcastConfig } from '@/constants/config';
import { fetchStreamKey } from '@/services/streamKey';

type Phase = 'idle' | 'connecting' | 'live' | 'error';

/** Normalise the state coming back from the native event (string or numeric). */
function toPhase(state: StateStatusUnion | number): Phase {
  const s =
    typeof state === 'number'
      ? (['INVALID', 'DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR'][state] ?? 'INVALID')
      : state;
  switch (s) {
    case 'CONNECTING':
      return 'connecting';
    case 'CONNECTED':
      return 'live';
    case 'ERROR':
      return 'error';
    default:
      return 'idle';
  }
}

/**
 * Injected before the embedded console loads. Flags the web live console so it
 * runs in "broadcast console" mode: it skips its own camera/WebRTC/IVS pipeline
 * (the native layer below owns broadcast-grade video) and runs purely as the
 * control surface — products, banners, cart, chat and all live-state/usage
 * bookkeeping — delegating start/stop/flip/mute to native over this bridge.
 *
 * The body is made transparent so the native Amazon IVS camera preview shows
 * through the console's (now-transparent) video area.
 */
const CONSOLE_BRIDGE = `
  (function () {
    window.__PICKSFOLIO_BROADCAST_CONSOLE__ = true;
    try {
      var s = document.createElement('style');
      s.innerHTML = 'html,body{background:transparent !important;}';
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();
  true;
`;

export interface BroadcastScreenProps {
  /** Seller username; passed to the embedded console and stream-key lookup. */
  username?: string;
  /** Per-broadcast product selection forwarded to the console (comma-separated). */
  productIds?: string;
  /** Leave the broadcast screen (returns to the WebView shell). */
  onClose: () => void;
}

/**
 * Native live-broadcast studio.
 *
 * Two layers:
 *  1. `IVSBroadcastCameraView` (full screen) — the phone camera streamed to
 *     Amazon IVS over RTMPS via the device's hardware encoder. This is the video
 *     viewers see, at broadcast-grade quality.
 *  2. A transparent full-screen WebView (on top) — the production web live
 *     console in "broadcast console" mode. It owns all merchandising (products,
 *     banners), chat, cart and the live-state/usage bookkeeping, and renders its
 *     controls over the camera exactly like the web console.
 *
 * The console drives the broadcast through the WebView bridge: it sends
 * REQUEST_START (with the seller's IVS ingest server + stream key it already
 * loaded), REQUEST_STOP, FLIP_CAMERA and SET_MUTED; this screen reports the
 * encoder state back via `window.__picksNativeBroadcastState(...)` so the
 * console can confirm the broadcast actually went live before writing state.
 */
export default function BroadcastScreen({
  username,
  productIds,
  onClose,
}: BroadcastScreenProps) {
  const cameraRef = useRef<IIVSBroadcastCameraView>(null);
  const webRef = useRef<WebView>(null);

  const [ingestServer, setIngestServer] = useState(broadcastConfig.defaultIngestServer);
  const [streamKey, setStreamKey] = useState('');
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('back');
  const [muted, setMuted] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);

  const broadcastingRef = useRef(false);
  broadcastingRef.current = broadcasting;

  const consoleUri = `${config.webUrl.replace(/\/$/, '')}/?broadcastConsole=1&user=${encodeURIComponent(
    username ?? '',
  )}&products=${encodeURIComponent(productIds ?? '')}`;

  // --- Android runtime permissions (camera + microphone) ---------------------
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]).catch(() => {});
  }, []);

  /** Tell the embedded console the current encoder phase. */
  const notifyConsole = useCallback((phase: Phase) => {
    webRef.current?.injectJavaScript(
      `(function(){ try { window.__picksNativeBroadcastState && window.__picksNativeBroadcastState(${JSON.stringify(
        phase,
      )}); } catch (e) {} })(); true;`,
    );
  }, []);

  const startBroadcast = useCallback(
    async (ingest?: string, key?: string) => {
      let rtmps = (ingest ?? '').trim() || ingestServer.trim();
      let sk = (key ?? '').trim() || streamKey.trim();

      // Fall back to the backend lookup if the console didn't hand us credentials.
      if ((!rtmps || !sk) && username) {
        const res = await fetchStreamKey(username);
        if (res.ok) {
          rtmps = res.data.ingestServer;
          sk = res.data.streamKey;
        }
      }
      if (!rtmps || !sk) {
        notifyConsole('error');
        return;
      }

      setIngestServer(rtmps);
      setStreamKey(sk);
      setBroadcasting(true);
      cameraRef.current?.start({ rtmpsUrl: rtmps, streamKey: sk });
    },
    [ingestServer, streamKey, username, notifyConsole],
  );

  const stopBroadcast = useCallback(() => {
    cameraRef.current?.stop();
    setBroadcasting(false);
    notifyConsole('idle');
  }, [notifyConsole]);

  // Going to the background while live should not leave a ghost broadcast.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && broadcastingRef.current) {
        cameraRef.current?.stop();
      }
    });
    return () => sub.remove();
  }, []);

  // Console → native control messages.
  const onConsoleMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: { type?: string; payload?: Record<string, unknown> } | null = null;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      switch (msg?.type) {
        case 'REQUEST_START': {
          const ingest = typeof msg.payload?.ingestServer === 'string' ? msg.payload.ingestServer : undefined;
          const key = typeof msg.payload?.streamKey === 'string' ? msg.payload.streamKey : undefined;
          void startBroadcast(ingest, key);
          break;
        }
        case 'REQUEST_STOP':
          stopBroadcast();
          break;
        case 'FLIP_CAMERA':
          setCameraPosition((p) => (p === 'back' ? 'front' : 'back'));
          break;
        case 'SET_MUTED':
          setMuted(msg.payload?.muted === true);
          break;
        case 'CLOSE_BROADCAST':
          if (broadcastingRef.current) cameraRef.current?.stop();
          onClose();
          break;
        default:
          break;
      }
    },
    [startBroadcast, stopBroadcast, onClose],
  );

  const handleStateChange = useCallback(
    (state: StateStatusUnion | number) => {
      const next = toPhase(state);
      notifyConsole(next);
      if (next === 'idle' || next === 'error') setBroadcasting(false);
    },
    [notifyConsole],
  );

  const handleError = useCallback(() => {
    setBroadcasting(false);
    notifyConsole('error');
  }, [notifyConsole]);

  const handleBroadcastError = useCallback(
    (error: IBroadcastSessionError) => {
      if (error?.isFatal) {
        setBroadcasting(false);
        notifyConsole('error');
      }
    },
    [notifyConsole],
  );

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* Layer 1: native camera + hardware encoder → Amazon IVS (the video). */}
      <IVSBroadcastCameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        rtmpsUrl={ingestServer.trim()}
        streamKey={streamKey.trim()}
        cameraPosition={cameraPosition}
        cameraPreviewAspectMode="fill"
        isCameraPreviewMirrored={cameraPosition === 'front'}
        isMuted={muted}
        videoConfig={{
          width: broadcastConfig.video.width,
          height: broadcastConfig.video.height,
          targetFrameRate: broadcastConfig.video.targetFrameRate,
          keyframeInterval: broadcastConfig.video.keyframeInterval,
          bitrate: broadcastConfig.video.bitrate,
          minBitrate: broadcastConfig.video.minBitrate,
          maxBitrate: broadcastConfig.video.maxBitrate,
          isAutoBitrate: broadcastConfig.video.isAutoBitrate,
        }}
        audioConfig={{ bitrate: broadcastConfig.audio.bitrate }}
        onBroadcastStateChanged={handleStateChange}
        onError={handleError}
        onBroadcastError={handleBroadcastError}
      />

      {/* Layer 2: transparent web live console overlaid on the camera. It is the
          entire UI — products, banners, chat, cart and the go-live controls —
          and delegates the actual broadcast to the native encoder above. */}
      <WebView
        ref={webRef}
        source={{ uri: consoleUri }}
        style={styles.console}
        // Transparent so the native camera shows through the console's video area.
        opaque={false}
        backgroundColor="transparent"
        injectedJavaScriptBeforeContentLoaded={CONSOLE_BRIDGE}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        originWhitelist={['*']}
        setSupportMultipleWindows={false}
        applicationNameForUserAgent="PicksFolioApp"
        onMessage={onConsoleMessage}
        renderError={() => <View style={styles.fill} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  console: { flex: 1, backgroundColor: 'transparent' },
  fill: { flex: 1, backgroundColor: 'transparent' },
});
