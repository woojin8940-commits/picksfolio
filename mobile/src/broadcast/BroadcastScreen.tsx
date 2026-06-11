import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  IVSBroadcastCameraView,
  type CameraPosition,
  type IBroadcastSessionError,
  type IIVSBroadcastCameraView,
  type StateStatusUnion,
} from 'amazon-ivs-react-native-broadcast';
import { broadcastConfig } from '@/constants/config';
import { fetchStreamKey, setLiveState } from '@/services/streamKey';
import { colors, radius, spacing } from '@/theme';

/** Re-assert live state on this cadence so a brief interruption doesn't drop viewers. */
const HEARTBEAT_MS = 8000;

/**
 * Aspect ratio (width / height) of the encoded stream. The camera preview is
 * locked to this exact box so the host sees precisely the frame viewers receive
 * — see the preview wrapper below.
 */
const BROADCAST_ASPECT = broadcastConfig.video.width / broadcastConfig.video.height;

type Phase = 'idle' | 'connecting' | 'live' | 'error';

interface StatusMeta {
  label: string;
  color: string;
  pulse: boolean;
}

/** Map the SDK broadcast state to a Korean status the host understands. */
function phaseMeta(phase: Phase): StatusMeta {
  switch (phase) {
    case 'connecting':
      return { label: '연결 중', color: colors.accent, pulse: true };
    case 'live':
      return { label: '방송 중', color: colors.danger, pulse: true };
    case 'error':
      return { label: '오류', color: colors.danger, pulse: false };
    default:
      return { label: '대기 중', color: colors.textMuted, pulse: false };
  }
}

/** Normalise the state coming back from the native event (string or numeric). */
function toPhase(state: StateStatusUnion | number): Phase {
  const s = typeof state === 'number'
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

export interface BroadcastScreenProps {
  /** Seller username; when present, the stream key is auto-loaded from the backend. */
  username?: string;
  /** Optional credentials handed in by the web app, to skip the lookup. */
  initialIngestServer?: string;
  initialStreamKey?: string;
  /** Leave the broadcast screen (returns to the WebView shell). */
  onClose: () => void;
}

export default function BroadcastScreen({
  username,
  initialIngestServer,
  initialStreamKey,
  onClose,
}: BroadcastScreenProps) {
  const cameraRef = useRef<IIVSBroadcastCameraView>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [permissionGranted, setPermissionGranted] = useState(Platform.OS === 'ios');
  const [ingestServer, setIngestServer] = useState(
    initialIngestServer ?? broadcastConfig.defaultIngestServer,
  );
  const [streamKey, setStreamKey] = useState(initialStreamKey ?? '');
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('back');
  const [muted, setMuted] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [broadcasting, setBroadcasting] = useState(false);
  const [loadingKey, setLoadingKey] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const broadcastingRef = useRef(false);
  broadcastingRef.current = broadcasting;

  // --- Android runtime permissions (camera + microphone) ---------------------
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
        const ok =
          result[PermissionsAndroid.PERMISSIONS.CAMERA] === 'granted' &&
          result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === 'granted';
        setPermissionGranted(ok);
        if (!ok) setNotice('카메라·마이크 권한을 허용해야 방송할 수 있어요.');
      } catch {
        setPermissionGranted(false);
      }
    })();
  }, []);

  // --- Load the seller's IVS credentials from the backend --------------------
  useEffect(() => {
    if (!username || (initialIngestServer && initialStreamKey)) return;
    let cancelled = false;
    setLoadingKey(true);
    fetchStreamKey(username).then((res) => {
      if (cancelled) return;
      setLoadingKey(false);
      if (res.ok) {
        setIngestServer(res.data.ingestServer);
        setStreamKey(res.data.streamKey);
      } else if (res.reason === 'cap') {
        setNotice(res.message);
      } else if (res.reason === 'not-found') {
        setNotice('저장된 스트림 정보가 없어요. 인제스트 서버와 스트림 키를 입력해 주세요.');
        setShowSettings(true);
      } else {
        setNotice(res.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [username, initialIngestServer, initialStreamKey]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const markOffline = useCallback(() => {
    stopHeartbeat();
    if (username) void setLiveState(username, false);
  }, [stopHeartbeat, username]);

  // Going to the background while live should not leave a ghost "라이브 중" state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && broadcastingRef.current) {
        cameraRef.current?.stop();
      }
    });
    return () => sub.remove();
  }, []);

  // Ensure live state is cleared if the screen unmounts mid-broadcast.
  useEffect(() => () => markOffline(), [markOffline]);

  const canBroadcast =
    permissionGranted && ingestServer.trim().length > 0 && streamKey.trim().length > 0;

  const handleStart = useCallback(() => {
    if (!canBroadcast || broadcasting) return;
    setNotice(null);
    setPhase('connecting');
    setBroadcasting(true);
    cameraRef.current?.start({
      rtmpsUrl: ingestServer.trim(),
      streamKey: streamKey.trim(),
    });
  }, [canBroadcast, broadcasting, ingestServer, streamKey]);

  const handleStop = useCallback(() => {
    cameraRef.current?.stop();
    setBroadcasting(false);
    setPhase('idle');
    markOffline();
  }, [markOffline]);

  const handleStateChange = useCallback(
    (state: StateStatusUnion | number) => {
      const next = toPhase(state);
      setPhase(next);
      if (next === 'live') {
        // Now actually connected — surface as "라이브 중" to web viewers and
        // re-assert it on a heartbeat the way the web console does.
        if (username) {
          void setLiveState(username, true, { startedAt: new Date().toISOString() });
          stopHeartbeat();
          heartbeatRef.current = setInterval(() => {
            void setLiveState(username, true);
          }, HEARTBEAT_MS);
        }
      } else if (next === 'idle' || next === 'error') {
        setBroadcasting(false);
        markOffline();
      }
    },
    [username, stopHeartbeat, markOffline],
  );

  const handleError = useCallback((message: string) => {
    setPhase('error');
    setBroadcasting(false);
    setNotice(message || '방송 중 오류가 발생했어요. 다시 시도해 주세요.');
  }, []);

  const handleBroadcastError = useCallback((error: IBroadcastSessionError) => {
    setNotice(error?.detail || '방송 세션 오류가 발생했어요.');
    if (error?.isFatal) {
      setPhase('error');
      setBroadcasting(false);
    }
  }, []);

  const status = phaseMeta(phase);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* The preview is locked to the exact aspect ratio of the encoded stream
          (broadcastConfig.video → 1080×1920, 9:16). With "fill" the camera is
          cropped to this same box, which matches how the IVS encoder composes
          the camera onto its 9:16 canvas. The result is WYSIWYG: the host sees
          precisely the frame the viewers receive — no content that's off-screen
          for the host but visible to viewers (or vice-versa). The rest of the
          (taller) phone screen is letterboxed against the black stage. */}
      <View style={styles.previewWrap} pointerEvents="none">
        <IVSBroadcastCameraView
          ref={cameraRef}
          style={styles.cameraPreview}
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
      </View>

      {/* Top bar: close + live status pill */}
      <View style={styles.topBar} pointerEvents="box-none">
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-down" size={24} color={colors.text} />
        </Pressable>

        <View style={[styles.statusPill, { borderColor: status.color }]}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: status.color, opacity: status.pulse ? 1 : 0.6 },
            ]}
          />
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>

        <Pressable
          onPress={() => setShowSettings((s) => !s)}
          hitSlop={12}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="options-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      {notice && (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      {loadingKey && (
        <View style={styles.notice} pointerEvents="none">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.noticeText}>스트림 정보를 불러오는 중…</Text>
        </View>
      )}

      {/* Stream settings: manual ingest server / stream key entry */}
      {showSettings && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.settingsWrap}
        >
          <ScrollView
            style={styles.settings}
            contentContainerStyle={styles.settingsContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.settingsTitle}>스트림 설정</Text>
            <Text style={styles.fieldLabel}>인제스트 서버 (RTMPS)</Text>
            <TextInput
              value={ingestServer}
              onChangeText={setIngestServer}
              editable={!broadcasting}
              placeholder="rtmps://…live-video.net:443/app/"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>스트림 키</Text>
            <TextInput
              value={streamKey}
              onChangeText={setStreamKey}
              editable={!broadcasting}
              placeholder="sk_..."
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
            />
            {username ? (
              <Pressable
                disabled={loadingKey || broadcasting}
                onPress={() => {
                  setLoadingKey(true);
                  setNotice(null);
                  fetchStreamKey(username).then((res) => {
                    setLoadingKey(false);
                    if (res.ok) {
                      setIngestServer(res.data.ingestServer);
                      setStreamKey(res.data.streamKey);
                      setNotice('스트림 정보를 불러왔어요.');
                    } else if (res.reason === 'cap') {
                      setNotice(res.message);
                    } else {
                      setNotice('저장된 스트림 정보를 찾지 못했어요.');
                    }
                  });
                }}
                style={({ pressed }) => [styles.reloadButton, pressed && styles.pressed]}
              >
                <Ionicons name="cloud-download-outline" size={16} color={colors.accent} />
                <Text style={styles.reloadText}>저장된 정보 불러오기</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Bottom controls: camera flip · start/stop · mic */}
      <View style={styles.controls} pointerEvents="box-none">
        <Pressable
          onPress={() => setCameraPosition((p) => (p === 'back' ? 'front' : 'back'))}
          style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}
        >
          <Ionicons name="camera-reverse-outline" size={26} color={colors.text} />
          <Text style={styles.controlLabel}>{cameraPosition === 'back' ? '후면' : '전면'}</Text>
        </Pressable>

        <Pressable
          onPress={broadcasting ? handleStop : handleStart}
          disabled={!broadcasting && !canBroadcast}
          style={({ pressed }) => [
            styles.liveButton,
            broadcasting ? styles.liveButtonStop : styles.liveButtonStart,
            !broadcasting && !canBroadcast && styles.liveButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons
            name={broadcasting ? 'stop' : 'radio-outline'}
            size={26}
            color={colors.text}
          />
          <Text style={styles.liveButtonText}>
            {broadcasting ? '방송 종료' : '방송 시작'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMuted((m) => !m)}
          style={({ pressed }) => [styles.controlButton, pressed && styles.pressed]}
        >
          <Ionicons name={muted ? 'mic-off-outline' : 'mic-outline'} size={26} color={muted ? colors.danger : colors.text} />
          <Text style={[styles.controlLabel, muted && { color: colors.danger }]}>
            {muted ? '음소거' : '마이크'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  previewWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full screen width, height derived from the encoded aspect ratio so the
  // preview shows exactly the 9:16 frame the encoder sends. Letterboxed against
  // the black root on taller phones.
  cameraPreview: {
    width: '100%',
    aspectRatio: BROADCAST_ASPECT,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '700' },
  notice: {
    position: 'absolute',
    top: 72,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  noticeText: { color: colors.text, fontSize: 13, textAlign: 'center', flexShrink: 1 },
  settingsWrap: {
    position: 'absolute',
    top: 116,
    left: spacing.lg,
    right: spacing.lg,
    maxHeight: '50%',
  },
  settings: {
    backgroundColor: 'rgba(11,11,15,0.92)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsContent: { padding: spacing.lg, gap: spacing.sm },
  settingsTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
  fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  reloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  reloadText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  controls: {
    position: 'absolute',
    bottom: spacing.xxl,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.xl,
  },
  controlButton: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  controlLabel: { color: colors.text, fontSize: 11, fontWeight: '600' },
  liveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    minWidth: 150,
    justifyContent: 'center',
  },
  liveButtonStart: { backgroundColor: colors.accent },
  liveButtonStop: { backgroundColor: colors.danger },
  liveButtonDisabled: { opacity: 0.4 },
  liveButtonText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
