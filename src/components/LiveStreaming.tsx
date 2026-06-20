
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, MessageCircle, X, Send, Camera, Mic, MicOff, CameraOff, Monitor, Settings, Image as ImageIcon, Layout, Upload, Trash2, FlipHorizontal2, SwitchCamera, Sparkles, Radio, Copy, Check, ShoppingBag, Package, BarChart3, TrendingUp, Plus, Zap, UserPlus, UserCheck } from 'lucide-react';
import { apiService } from '../services/apiService';
import {
  CHARGE_RATE_KRW_PER_HOUR,
  CHARGE_PAY_METHODS,
  payAndChargeLiveTime,
  type ChargePayMethod,
} from '../utils/liveCharge';
import { isNativeApp } from '../utils/appEnv';
import { BroadcasterSignaling, ChatMessage } from '../services/webrtcSignaling';
import { IVSBroadcaster } from '../services/ivsBroadcaster';

import MediaAuto from './MediaAuto';
import { PartnerFeed } from './PartnerFeed';
import {
  type FaceShapeSettings,
  FACE_SHAPE_OFF,
  hasFaceShape,
  ensureFaceLandmarker,
  detectFaceLandmarks,
  warpFaceShape,
} from '../utils/faceReshape';

interface LiveStreamingProps {
  userName: string;
  onClose: () => void;
  // Ephemeral product selection picked in 라이브 커머스 → 방송 상품 설정 for this
  // broadcast. Empty array means "no filter, show every registered product".
  selectedProductIds?: string[];
}

interface MaterialItem {
  id: string;
  name: string;
  type: 'banner' | 'product' | 'image';
  url: string;
  width: number; // percentage 10-100
  opacity: number; // 0-100
}

// 얼굴 보정 (face beauty) — modeled on beauty-cam platforms (yycam 등). The
// remaining feature is geometric face-shape reshaping, applied on-device in the
// canvas draw loop (drawFrame) with no SDK/token required. (The previous skin-
// tone color controls — 피부 보정/미백/혈색/밝기 — have been removed.)

// 얼굴형 조정 (face-shape reshaping) — physically warps the face using detected
// landmarks (see utils/faceReshape). Kept very gentle so the face never looks
// distorted; the geometric warp is what most easily looks unnatural ("외계인").
// The face/jaw 강도 scale is intentionally soft — even at full 100 the warp is
// subtle — so a mid value (~40) is the natural, comfortable default.
const DEFAULT_FACE_SHAPE: FaceShapeSettings = { face: 40, jaw: 40, eye: 8, nose: 6, midface: 0 };

// Broadcast quality profile for mobile live commerce.
//
// frameRate / bitrate / keyframe settings describe the ENCODER target. The
// broadcast frame itself is NOT forced to a fixed resolution or aspect ratio:
// every frame is composited onto a canvas sized to the camera's native
// resolution, so the stream keeps the camera's default ratio and full field of
// view. (Forcing a 9:16 portrait capture used to crop the sensor and make the
// feed look heavily zoomed in.) width/height below are only a fallback used by
// the IVS/HLS path before the live canvas size is known.
//
// 30fps + a 2-second GOP keeps a phone's software encoder within thermal budget,
// and the WebRTC sender's degradationPreference scales resolution down
// automatically on weaker devices/networks rather than stuttering. Bitrate is
// 6 Mbps to feed high-resolution detail (product labels, fabric/cosmetic
// texture) — the whole point of live commerce.
const MAX_QUALITY = {
  width: 1080,
  height: 1920,
  frameRate: 30,
  bitrate: 6_000_000,
  keyframeIntervalSec: 2,
  description: '카메라 기본 비율 (라이브 커머스 최적화)',
};

// In-app browsers (KakaoTalk, Naver, Instagram, etc.) frequently block
// getUserMedia outright, and even when the OS permission is the real problem,
// there is no web API that opens the system camera-permission screen directly.
// The most actionable escape we can offer is to bounce the page out to the
// device's default browser (Safari/Chrome), where the standard permission
// prompt works. These helpers detect the in-app context and perform that bounce
// using the same per-app schemes proven in LiveStream.tsx (viewer side).
const detectInApp = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isKakao = /KAKAOTALK/i.test(ua);
  const isNaver = /NAVER\(inapp/i.test(ua) || /; ?NAVER /i.test(ua);
  const isLine = /\bLine\//i.test(ua);
  const isFacebook = /FB_IAB|FBAN|FBAV|Instagram/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isInApp = isKakao || isNaver || isLine || isFacebook;
  return { ua, isKakao, isNaver, isLine, isFacebook, isIOS, isInApp };
};

const openCameraSettings = () => {
  const url = typeof window !== 'undefined' ? window.location.href : '';
  if (!url) return;
  const { isKakao, isLine, isNaver, isInApp, ua } = detectInApp();
  try {
    if (isInApp) {
      // Inside an in-app WebView the only real fix is to reopen in the default
      // browser, where camera permission can actually be granted.
      if (isKakao) {
        window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
        return;
      }
      if (isLine) {
        const u = new URL(url);
        u.searchParams.set('openExternalBrowser', '1');
        window.location.href = u.toString();
        return;
      }
      if (isNaver && /Android/i.test(ua)) {
        const stripped = url.replace(/^https?:\/\//, '');
        window.location.href = `intent://${stripped}#Intent;scheme=https;package=com.android.chrome;end`;
        return;
      }
      // Instagram/Facebook and other iOS in-app browsers expose no escape scheme;
      // copy the link and tell the user to open it in Safari/Chrome.
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
      alert('우측 상단 메뉴에서 "Safari로 열기" 또는 "기본 브라우저로 열기"를 선택해 주세요.\n주소가 클립보드에 복사되었습니다.');
      return;
    }
    // A normal browser whose camera permission was denied: there is no JS hook
    // into the OS settings page, so copy the address and surface step-by-step
    // guidance for granting permission, then reopening.
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    alert(
      '브라우저 설정에서 카메라·마이크 권한을 허용해 주세요.\n\n' +
        '· iPhone(Safari): 설정 > Safari > 카메라/마이크 > "허용"\n' +
        '· Android(Chrome): 주소창 좌측 자물쇠 > 권한 > 카메라/마이크 > "허용"\n\n' +
        '권한을 허용한 뒤 "다시 시도"를 눌러 주세요. 주소가 클립보드에 복사되었습니다.'
    );
  } catch (e) {
    console.warn('[LiveStreaming] openCameraSettings failed:', e);
  }
};

// In-app browsers (KakaoTalk, Naver, etc.) and many older mobile browsers can
// open the camera, but they routinely reject the strict ideal/min constraints
// we prefer (specific resolution mins, a frame-rate floor, stereo 48kHz audio)
// with OverconstrainedError or NotReadableError — even though the device is
// perfectly capable of streaming with simpler settings. Instead of treating
// that as "this browser can't broadcast" and pushing the user to the default
// browser, we walk down a ladder of progressively relaxed constraints and use
// the first set that succeeds. The final rung ({ video: true, audio: true }) is
// what virtually every getUserMedia-capable browser — in-app or not — accepts,
// so broadcasting works in KakaoTalk, Naver, and friends without leaving the app.
const getBroadcastStream = async (
  q: typeof MAX_QUALITY,
  facingMode: 'user' | 'environment' = 'user'
): Promise<MediaStream> => {
  const ladder: MediaStreamConstraints[] = [
    {
      // Ask for a 1080p (1920×1080) capture as a soft `ideal` hint to nudge the
      // camera toward its high-resolution mode for crisper detail. We use `ideal`
      // (never `exact`/`min`) on purpose: a hard portrait/landscape resolution
      // forced phone cameras to crop their sensor to that aspect, throwing away
      // most of the horizontal field of view so the broadcaster looked heavily
      // zoomed in. With `ideal`, the device is free to hand back its NATIVE
      // resolution and aspect ratio when it can't match exactly — preserving the
      // stock camera app's default framing while preferring 1080p when available.
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: q.frameRate, max: q.frameRate, min: 15 },
        facingMode,
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 2,
      },
    },
    {
      // Drop the frame-rate min/max and stereo/sample-rate hints that in-app
      // WebViews often can't satisfy, but keep the requested camera.
      video: {
        frameRate: { ideal: q.frameRate },
        facingMode,
      },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    },
    // Just ask for the requested camera and audio with no quality hints at all.
    { video: { facingMode }, audio: true },
    // Last resort: whatever camera and mic the browser is willing to hand over.
    { video: true, audio: true },
  ];

  let lastErr: any;
  for (const constraints of ladder) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e: any) {
      lastErr = e;
      // A denied permission won't be fixed by relaxing constraints, so stop
      // immediately and let the caller surface the permission guidance.
      if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') throw e;
    }
  }
  throw lastErr;
};

const LiveStreaming: React.FC<LiveStreamingProps> = ({ userName, onClose, selectedProductIds }) => {
  const [isLive, setIsLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  // Surfaces camera access failures (denied permission, or in-app browsers such
  // as the KakaoTalk webview that block getUserMedia) so the broadcaster sees a
  // clear message instead of a silent black preview on mobile.
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null);
  const [showMaterialPanel, setShowMaterialPanel] = useState(false);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [newMaterialName, setNewMaterialName] = useState('');
  const [newMaterialType, setNewMaterialType] = useState<'banner' | 'product' | 'image'>('banner');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isMirrored, setIsMirrored] = useState(true);
  // Which physical camera to broadcast from: 'user' = front (셀카), 'environment'
  // = rear (후면). Switching re-acquires the stream with the new facingMode.
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  // 얼굴형 조정 (geometric face reshaping). faceModelReady flips true once the
  // on-device landmark model has loaded; faceDetected reflects whether a face is
  // currently being tracked.
  const [faceShape, setFaceShape] = useState<FaceShapeSettings>(DEFAULT_FACE_SHAPE);
  const [faceModelReady, setFaceModelReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  // 얼굴 보정 master switch. Off by default so the broadcast starts with the raw
  // camera; the user must turn beauty on for any correction to be applied.
  const [beautyEnabled, setBeautyEnabled] = useState(false);
  const [actualResolution, setActualResolution] = useState<string>('');

  // AWS IVS Stream State
  const [ivsConfig, setIvsConfig] = useState<{ ingestServer: string; streamKey: string; playbackUrl: string; rtmpUrl: string } | null>(null);
  const [ivsLoading, setIvsLoading] = useState(true);
  const [showStreamInfo, setShowStreamInfo] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [capBlock, setCapBlock] = useState<{ kind: 'monthly' | 'daily' | 'exhausted'; message: string } | null>(null);

  // Live Products & Cart State
  const [liveProducts, setLiveProducts] = useState<{ id: string; name: string; price?: string; image?: string; link?: string; blockTitle?: string; options?: { id: string; name: string; values: any[] }[] }[]>([]);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [showProductPanel, setShowProductPanel] = useState(false);
  const [showCartPanel, setShowCartPanel] = useState(false);
  const [showBannerPanel, setShowBannerPanel] = useState(false);
  const [cartStats, setCartStats] = useState<{ totalViewers: number; totalItems: number; totalRevenue: number; productCounts: { productId: string; name: string; count: number; image?: string; link: string; price?: string; optionCounts: Record<string, Record<string, number>> }[] } | null>(null);
  const [cartCarts, setCartCarts] = useState<any[]>([]);
  const [cartError, setCartError] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const signalingRef = useRef<BroadcasterSignaling | null>(null);
  const ivsBroadcasterRef = useRef<IVSBroadcaster | null>(null);
  const [ivsBroadcasting, setIvsBroadcasting] = useState(false);
  const [liveUsage, setLiveUsage] = useState<{
    monthLabel: string;
    totalMinutes: number;
    includedMinutesRemaining: number;
    chargedMinutes: number;
    remainingMinutes: number;
    exhausted: boolean;
    overageMinutes: number;
    overageAmountKrw: number;
  } | null>(null);
  // Time-charging ("시간 충전하기") modal state.
  const [showChargeModal, setShowChargeModal] = useState(false);
  const [chargeHours, setChargeHours] = useState(1);
  const [chargePayMethod, setChargePayMethod] = useState<ChargePayMethod>('CARD');
  const [charging, setCharging] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  // Low-time warning while broadcasting: elapsed seconds this session, and a
  // one-shot flag so the 30분 알림 fires only once per broadcast.
  const [liveElapsedSec, setLiveElapsedSec] = useState(0);
  const [lowTimeWarned, setLowTimeWarned] = useState(false);
  const [showLowTimeBanner, setShowLowTimeBanner] = useState(false);

  // 함께 방송하기 (co-broadcast, Method A). The host invites another creator by
  // their (unique) username — or picks a saved friend — and once accepted both
  // keep broadcasting on their own channels while viewers see a split screen.
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [friends, setFriends] = useState<{ username: string; display_name: string; avatar_url: string }[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  // When inviting by username, also save them to the friend list by default so
  // next time they can be invited from the list without retyping the username.
  const [saveAsFriend, setSaveAsFriend] = useState(true);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  // The user's current co-broadcast session (host or guest side), incoming
  // invites addressed to this user, and the partner's live preview stream.
  const [coSession, setCoSession] = useState<{ id: string; status: string; role: 'host' | 'guest'; partner: string; partner_display_name: string; partner_avatar_url: string } | null>(null);
  const [incomingInvites, setIncomingInvites] = useState<{ id: string; host: string; host_display_name: string; host_avatar_url: string }[]>([]);
  const [partnerStreamReady, setPartnerStreamReady] = useState(false);
  // 함께 방송 guest gate: a creator who accepted an invite lands here in
  // 방송 설정 mode. They must explicitly press 참여하기 before 라이브 시작 will
  // transmit, so co-broadcasting is never started by accident. Hosts and solo
  // broadcasters are unaffected.
  const [coJoined, setCoJoined] = useState(false);
  const coJoinedRef = useRef(false);
  useEffect(() => { coJoinedRef.current = coJoined; }, [coJoined]);
  // Clear the joined flag when there is no active session (invite ended/declined)
  // so the next co-broadcast starts from the 참여하기 step again.
  useEffect(() => { if (!coSession) setCoJoined(false); }, [coSession]);
  const coSessionRef = useRef<typeof coSession>(null);
  useEffect(() => { coSessionRef.current = coSession; }, [coSession]);
  const isLiveRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMirroredRef = useRef(true);
  // 얼굴 보정 master switch, mirrored into a ref so the canvas draw loop reads it
  // without re-creating the loop on every toggle.
  const beautyEnabledRef = useRef(false);
  // 얼굴형 조정 live values + offscreen processing canvas. The (optionally
  // mirrored) frame is rendered onto procCanvas first, then warped onto the
  // broadcast canvas.
  const faceShapeRef = useRef<FaceShapeSettings>(DEFAULT_FACE_SHAPE);
  const procCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const procCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const faceDetectedRef = useRef(false);
  const broadcastStartTimeRef = useRef<string>('');
  const broadcastIdRef = useRef<string>('');
  const peakViewerCountRef = useRef(0);

  // Local recording: capture the same canvas stream that gets broadcast, plus
  // the live audio track. The full recording is uploaded to Netlify Blobs on
  // broadcast stop so an admin can replay it later in the admin dashboard.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef<string>('video/webm');

  // Background tab streaming: WebAudio timing loop keeps canvas alive when tab is hidden
  const audioContextRef = useRef<AudioContext | null>(null);
  const bgTimerNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const isBackgroundRef = useRef(false);
  const lastDrawTimeRef = useRef(0);
  const TARGET_FPS = 30;
  const FRAME_INTERVAL = 1000 / TARGET_FPS; // ~33.3ms


  // Draw a single frame to the canvas (shared by both rAF and background timer)
  const drawFrame = useCallback((rawVideo: HTMLVideoElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    const sourceVideo = rawVideo;
    if (!sourceVideo.videoWidth) return;

    // 30fps throttle: skip frame if not enough time has elapsed
    const now = performance.now();
    if (now - lastDrawTimeRef.current < FRAME_INTERVAL) return;
    lastDrawTimeRef.current = now;

    // The canvas IS the broadcast frame (captureStream reads from it). Normalize
    // it to a portrait 9:16 frame so a web broadcaster (whose camera is usually
    // landscape) produces the SAME shape/size a mobile broadcaster does, instead
    // of a short letterboxed landscape strip inside the viewer's portrait stage.
    // The source is center-cropped to 9:16 (cover) — the same framing the phone
    // app sends — rather than squashed.
    const vw = sourceVideo.videoWidth;
    const vh = sourceVideo.videoHeight;
    const TARGET_AR = 9 / 16; // portrait, width / height
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (vw / vh > TARGET_AR) {
      // Wider than 9:16 (landscape webcam) → crop the sides.
      sw = Math.round(vh * TARGET_AR);
      sx = Math.round((vw - sw) / 2);
    } else {
      // Taller than 9:16 → crop top/bottom.
      sh = Math.round(vw / TARGET_AR);
      sy = Math.round((vh - sh) / 2);
    }
    const cw = sw; // broadcast frame dimensions (the cropped 9:16 region)
    const ch = sh;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      // Re-apply after resize (canvas state resets on dimension change)
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    // 얼굴 보정 — geometric face-shape reshaping. When the switch is off we fall
    // back to the untouched camera frame.
    const beautyOn = beautyEnabledRef.current;
    const shape = beautyOn ? faceShapeRef.current : FACE_SHAPE_OFF;
    const mirror = isMirroredRef.current;

    // The (optionally mirrored) frame is drawn onto an offscreen "processing"
    // canvas so it can serve as the texture source for the face-shape warp.
    // (Warping in place on the canvas you're reading from is not possible.)
    let proc = procCanvasRef.current;
    if (!proc) {
      proc = document.createElement('canvas');
      procCanvasRef.current = proc;
      procCtxRef.current = proc.getContext('2d');
    }
    const pctx = procCtxRef.current;
    if (!pctx) return;
    if (proc.width !== cw || proc.height !== ch) {
      proc.width = cw;
      proc.height = ch;
      pctx.imageSmoothingEnabled = true;
      pctx.imageSmoothingQuality = 'high';
    }

    // Draw the source (optionally mirrored) onto the proc canvas. Mirror is
    // baked in here so landmark detection and warping operate in the same
    // orientation the viewer sees. The source is center-cropped to 9:16 here.
    pctx.save();
    pctx.filter = 'none';
    pctx.globalAlpha = 1;
    pctx.globalCompositeOperation = 'source-over';
    if (mirror) {
      pctx.translate(cw, 0);
      pctx.scale(-1, 1);
    }
    pctx.drawImage(sourceVideo, sx, sy, sw, sh, 0, 0, cw, ch);
    pctx.restore();

    // Composite the processed frame onto the broadcast canvas. If 얼굴형 조정 is
    // active and a face is tracked, warp the face region; otherwise copy 1:1.
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(proc, 0, 0);

    let detected = false;
    if (beautyOn && hasFaceShape(shape)) {
      const landmarks = detectFaceLandmarks(proc, now, cw, ch);
      if (landmarks) {
        detected = true;
        warpFaceShape(ctx, proc, landmarks, cw, ch, shape);
      }
    }
    if (detected !== faceDetectedRef.current) {
      faceDetectedRef.current = detected;
      setFaceDetected(detected);
    }

    // Reset shared context state for the next frame / other drawers.
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }, []);

  // Start WebAudio-based background timer (keeps canvas alive when tab is hidden)
  const startBackgroundTimer = useCallback((sourceVideo: HTMLVideoElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    if (audioContextRef.current) return; // Already running

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      // Use ScriptProcessorNode (deprecated but widely supported) as a timing source
      // The onaudioprocess callback fires reliably even when the tab is in the background
      const bufferSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      bgTimerNodeRef.current = processor;

      processor.onaudioprocess = () => {
        if (isBackgroundRef.current) {
          drawFrame(sourceVideo, canvas, ctx);
        }
      };

      // Connect to destination (required for the callback to fire)
      // Create a silent oscillator to keep the audio context alive
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = 0; // Silent
      oscillator.connect(gainNode);
      gainNode.connect(processor);
      processor.connect(audioCtx.destination);
      oscillator.start();

      console.log('[LiveStreaming] Background WebAudio timer started');
    } catch (e) {
      console.warn('[LiveStreaming] WebAudio background timer failed, falling back to setInterval:', e);
    }
  }, [drawFrame]);

  const stopBackgroundTimer = useCallback(() => {
    if (bgTimerNodeRef.current) {
      bgTimerNodeRef.current.disconnect();
      bgTimerNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  // Handle page visibility changes for background tab streaming
  useEffect(() => {
    const handleVisibilityChange = () => {
      const hidden = document.hidden;
      isBackgroundRef.current = hidden;

      if (hidden && isLiveRef.current) {
        console.log('[LiveStreaming] Tab hidden — switching to WebAudio background timer');
        const sourceVideo = videoRef.current;
        const canvas = canvasRef.current;
        if (sourceVideo && canvas) {
          const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
          if (ctx) {
            startBackgroundTimer(sourceVideo, canvas, ctx);
          }
        }
      } else {
        console.log('[LiveStreaming] Tab visible — switching back to rAF');
        // Background timer keeps running alongside rAF; drawFrame's throttle
        // ensures we don't double-draw
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopBackgroundTimer();
    };
  }, [startBackgroundTimer, stopBackgroundTimer]);

  // Keep the screen awake while the broadcaster is live. Without this, mobile
  // devices lock after a minute of no touch input, which suspends getUserMedia
  // and kills the broadcast. The Wake Lock API is auto-released when the page
  // is hidden, so we also re-acquire on visibilitychange.
  const wakeLockRef = useRef<any>(null);
  useEffect(() => {
    if (!isLive) {
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release?.(); } catch {}
        wakeLockRef.current = null;
      }
      return;
    }
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (!nav?.wakeLock?.request) return;

    const acquire = async () => {
      try {
        const lock = await nav.wakeLock.request('screen');
        wakeLockRef.current = lock;
        lock.addEventListener?.('release', () => {
          // Browser released it (e.g., tab hidden); acquire again when visible.
          wakeLockRef.current = null;
        });
        console.log('[LiveStreaming] Screen wake lock acquired');
      } catch (e) {
        console.warn('[LiveStreaming] Wake lock request failed (non-fatal):', e);
      }
    };

    acquire();

    const onVis = () => {
      if (document.visibilityState === 'visible' && isLiveRef.current && !wakeLockRef.current) {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (wakeLockRef.current) {
        try { wakeLockRef.current.release?.(); } catch {}
        wakeLockRef.current = null;
      }
    };
  }, [isLive]);

  // Clean up live state across all storage layers (called on unmount and explicit stop)
  const cleanupLiveState = useCallback(async () => {
    const normalizedUsername = userName.toLowerCase();
    const liveData = { isLive: false, viewerCount: 0, currentProduct: null };
    try { localStorage.setItem(`picks_live_${normalizedUsername}`, JSON.stringify(liveData)); } catch {}
    try { await apiService.saveLiveState(userName, liveData); } catch {}
  }, [userName]);

  // Initialize signaling once
  useEffect(() => {
    const signaling = new BroadcasterSignaling(userName);
    signalingRef.current = signaling;

    // Listen for incoming chat messages from viewers
    signaling.onChat((msg) => {
      setMessages(prev => {
        // Prevent duplicates
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    return () => {
      signaling.stop();
      signalingRef.current = null;
      if (ivsBroadcasterRef.current) {
        ivsBroadcasterRef.current.stop().catch(() => {});
        ivsBroadcasterRef.current = null;
      }
      // Explicitly release all MediaStream tracks to free hardware (camera/mic)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (canvasStreamRef.current) {
        canvasStreamRef.current.getTracks().forEach(track => track.stop());
        canvasStreamRef.current = null;
      }
      stopBackgroundTimer();
      // Always clean up live state when component unmounts (e.g., closing the panel)
      cleanupLiveState();
    };
  }, [userName, cleanupLiveState]);

  // Handle browser tab close / navigation: clean up live state via beacon API
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isLiveRef.current) {
        const normalizedUsername = userName.toLowerCase();
        const liveData = JSON.stringify({ isLive: false, viewerCount: 0, currentProduct: null });
        // Use sendBeacon for reliable delivery during page unload
        navigator.sendBeacon(
          `/api/live/${encodeURIComponent(normalizedUsername)}`,
          new Blob([liveData], { type: 'application/json' })
        );
        try { localStorage.setItem(`picks_live_${normalizedUsername}`, liveData); } catch {}
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [userName]);

  // Fetch AWS IVS stream key automatically (one-click broadcast)
  useEffect(() => {
    const fetchStreamConfig = async () => {
      setIvsLoading(true);
      setCapBlock(null);
      try {
        const config = await apiService.getStreamKey(userName);
        if (config && (config as any).capReached) {
          setCapBlock({
            kind: (config as any).capReached,
            message: (config as any).error || '라이브 송출 한도에 도달했습니다.',
          });
          setIvsConfig(null);
        } else if (config && (config as any).streamKey) {
          setIvsConfig(config as any);
        }
      } catch (e) {
        console.error('[IVS] Failed to fetch stream config:', e);
      } finally {
        setIvsLoading(false);
      }
    };
    fetchStreamConfig();
  }, [userName]);

  // Live time usage (current month: 3h included + 8,900원/h overage). Refresh
  // when the broadcast ends so the badge reflects the just-finished session.
  const refreshLiveUsage = useCallback(async () => {
    try {
      const result = await apiService.getLiveUsage(userName);
      if (result?.usage) {
        setLiveUsage({
          monthLabel: result.usage.monthLabel,
          totalMinutes: result.usage.totalMinutes,
          includedMinutesRemaining: result.usage.includedMinutesRemaining,
          chargedMinutes: result.usage.chargedMinutes,
          remainingMinutes: result.usage.remainingMinutes,
          exhausted: result.usage.exhausted,
          overageMinutes: result.usage.overageMinutes,
          overageAmountKrw: result.usage.overageAmountKrw,
        });
        // Keep the broadcast gate in sync: if the seller charged time, clear an
        // "exhausted" block; if they're now out of time, raise it.
        if (result.usage.exhausted) {
          setCapBlock({
            kind: 'exhausted',
            message: '이번 달 라이브 잔여시간을 모두 사용했습니다. 시간을 충전해주세요.',
          });
        } else {
          setCapBlock((prev) => (prev?.kind === 'exhausted' ? null : prev));
        }
      }
    } catch (e) {
      console.warn('[Live] getLiveUsage failed (non-blocking):', e);
    }
  }, [userName]);

  useEffect(() => {
    refreshLiveUsage();
  }, [refreshLiveUsage]);

  // Charge prepaid broadcast time by the hour (시간당 8,900원) via a one-time
  // PortOne payment (토스페이먼츠/토스페이/카카오페이). On success the usage badge
  // and the broadcast gate refresh immediately. Works while live so a seller can
  // top up mid-broadcast when time is running low.
  const handleChargeTime = useCallback(async () => {
    if (charging) return;
    setCharging(true);
    setChargeError(null);
    try {
      const outcome = await payAndChargeLiveTime(userName, chargeHours, chargePayMethod);
      if (!outcome.success) {
        setChargeError(outcome.error || '충전에 실패했습니다.');
        return;
      }
      await refreshLiveUsage();
      // A successful top-up extends the allowance — clear the low-time warning so
      // it can re-arm if the freshly added time later runs low again.
      setLowTimeWarned(false);
      setShowLowTimeBanner(false);
      setShowChargeModal(false);
    } catch (e) {
      setChargeError('충전 중 오류가 발생했습니다.');
    } finally {
      setCharging(false);
    }
  }, [userName, chargeHours, chargePayMethod, charging, refreshLiveUsage]);

  // ─── 함께 방송하기 (co-broadcast) ──────────────────────────────────────────

  // Load saved friends when the invite modal opens.
  useEffect(() => {
    if (!showInviteModal) return;
    setFriendsLoading(true);
    apiService.listLiveFriends(userName)
      .then(setFriends)
      .finally(() => setFriendsLoading(false));
  }, [showInviteModal, userName]);

  // Poll for incoming invites (this creator is the invitee) and for the user's
  // own active session. Lightweight enough to run for the whole live screen so
  // an invite shows up even before going live.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [invites, active] = await Promise.all([
          apiService.getCobroadcastInvites(userName),
          apiService.getActiveCobroadcast(userName),
        ]);
        if (cancelled) return;
        setIncomingInvites(invites);
        setCoSession(active);
      } catch { /* non-blocking */ }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [userName]);

  // Subscribe to the partner's channel for a live preview once a session is
  // accepted/live, so each host can see the other. <PartnerFeed/> handles both
  // a web partner (WebRTC) and a mobile partner (HLS) — no extra media infra.
  const partnerChannel = coSession?.partner || '';
  useEffect(() => {
    if (!partnerChannel) setPartnerStreamReady(false);
  }, [partnerChannel]);

  // When this host is live and has an accepted/live session, keep it promoted to
  // 'live' AND heartbeat it so the partner channel stays discoverable to viewers
  // (the 2-up split). The server only surfaces a 'live' session to viewers while
  // its updated_at is fresh (~45s), so a single best-effort POST isn't enough:
  // we re-assert 'live' every 15s. This is also what makes "방송종료하면 협업방송도
  // 종료" reliable — the moment this host stops broadcasting the heartbeat stops,
  // and the viewers' split turns itself off within seconds even if the explicit
  // end call was missed (crash/app close). The initial promotion retries quickly
  // so the split turns on without waiting for the next heartbeat tick.
  useEffect(() => {
    if (!isLive || !coSession) return;
    const status = coSession.status;
    if (status !== 'accepted' && status !== 'live') return;
    let cancelled = false;
    const sessionId = coSession.id;
    const beat = async (retries = 0) => {
      const ok = await apiService.respondCobroadcast('live', sessionId, userName).catch(() => false);
      if (cancelled) return;
      if (ok) {
        setCoSession(prev => (prev && prev.id === sessionId && prev.status !== 'live' ? { ...prev, status: 'live' } : prev));
      } else if (retries < 3) {
        setTimeout(() => { if (!cancelled) beat(retries + 1); }, 1500 * (retries + 1));
      }
    };
    beat();
    const id = setInterval(() => beat(), 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isLive, coSession?.id, coSession?.status, userName]);

  // Send an invite to a specific username (from the friend list or the input).
  const sendInvite = useCallback(async (target: string, alsoSaveFriend: boolean) => {
    const guest = target.trim().toLowerCase();
    if (!guest || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    setInviteNotice(null);
    try {
      const res = await apiService.inviteCobroadcast(userName, guest);
      if (!res.success) {
        setInviteError(res.error || '초대에 실패했습니다.');
        return;
      }
      if (alsoSaveFriend && !friends.some(f => f.username === guest)) {
        const add = await apiService.addLiveFriend(userName, guest);
        if (add.success && add.friend) setFriends(prev => [add.friend!, ...prev]);
      }
      setInviteNotice(`@${guest}님에게 초대를 보냈어요. 상대가 수락하면 함께 방송이 시작됩니다.`);
      setInviteUsername('');
    } catch {
      setInviteError('초대 중 오류가 발생했습니다.');
    } finally {
      setInviteBusy(false);
    }
  }, [userName, friends, inviteBusy]);

  // Add a friend by username without sending an invite.
  const addFriend = useCallback(async (target: string) => {
    const friend = target.trim().toLowerCase();
    if (!friend || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    setInviteNotice(null);
    try {
      const res = await apiService.addLiveFriend(userName, friend);
      if (!res.success) {
        setInviteError(res.error || '친구 추가에 실패했습니다.');
        return;
      }
      if (res.friend && !friends.some(f => f.username === res.friend!.username)) {
        setFriends(prev => [res.friend!, ...prev]);
      }
      setInviteNotice(`@${friend}님을 친구 목록에 추가했어요.`);
      setInviteUsername('');
    } catch {
      setInviteError('친구 추가 중 오류가 발생했습니다.');
    } finally {
      setInviteBusy(false);
    }
  }, [userName, friends, inviteBusy]);

  const removeFriend = useCallback(async (friend: string) => {
    const ok = await apiService.removeLiveFriend(userName, friend);
    if (ok) setFriends(prev => prev.filter(f => f.username !== friend));
  }, [userName]);

  const acceptInvite = useCallback(async (inviteId: string) => {
    const ok = await apiService.respondCobroadcast('accept', inviteId, userName);
    if (ok) {
      setIncomingInvites(prev => prev.filter(i => i.id !== inviteId));
      const active = await apiService.getActiveCobroadcast(userName);
      setCoSession(active);
    }
  }, [userName]);

  const declineInvite = useCallback(async (inviteId: string) => {
    await apiService.respondCobroadcast('decline', inviteId, userName);
    setIncomingInvites(prev => prev.filter(i => i.id !== inviteId));
  }, [userName]);

  const endCobroadcast = useCallback(async () => {
    const cs = coSessionRef.current;
    if (!cs) return;
    await apiService.respondCobroadcast('end', cs.id, userName);
    setCoSession(null);
  }, [userName]);

  // Tick the elapsed broadcast time while live. The server only learns the used
  // minutes when the broadcast STOPS (the record is written then), so during a
  // live session we estimate remaining time on the client: remaining-at-start
  // (liveUsage.remainingMinutes) minus minutes elapsed this session.
  useEffect(() => {
    if (!isLive) { setLiveElapsedSec(0); return; }
    const tick = () => {
      const startIso = broadcastStartTimeRef.current;
      const startMs = startIso ? new Date(startIso).getTime() : Date.now();
      setLiveElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [isLive]);

  // Estimated remaining broadcast time during a live session (null when usage
  // hasn't loaded yet). Used for the ticking badge and the 30분 잔여 알림.
  const liveRemainingMinutes = liveUsage
    ? Math.max(0, liveUsage.remainingMinutes - Math.floor(liveElapsedSec / 60))
    : null;

  // 잔여시간 30분 알림: when broadcasting and the estimated remaining time drops
  // to 30 minutes, alert the broadcaster once and surface an in-broadcast charge
  // banner so they can top up without leaving the live screen.
  useEffect(() => {
    if (!isLive || liveRemainingMinutes === null) return;
    if (liveRemainingMinutes <= 30 && !lowTimeWarned) {
      setLowTimeWarned(true);
      setShowLowTimeBanner(true);
      try { navigator.vibrate?.([200, 100, 200]); } catch {}
      setMessages((prev) => [
        ...prev,
        {
          id: `system-lowtime-${Date.now()}`,
          user: 'System',
          text: `라이브 잔여시간이 약 ${liveRemainingMinutes}분 남았습니다. 방송이 끊기지 않도록 시간을 충전해주세요.`,
          timestamp: Date.now(),
        },
      ]);
    }
  }, [isLive, liveRemainingMinutes, lowTimeWarned]);

  // Sync refs for use in animation loop
  useEffect(() => { beautyEnabledRef.current = beautyEnabled; }, [beautyEnabled]);
  useEffect(() => { faceShapeRef.current = faceShape; }, [faceShape]);
  useEffect(() => { isMirroredRef.current = isMirrored; }, [isMirrored]);

  // Load the on-device face-landmark model once the beauty panel is opened, so
  // 얼굴형 조정 has landmarks to work with. Loading is lazy + idempotent and
  // failures degrade gracefully (shape warp simply stays inactive).
  useEffect(() => {
    if (!showFilterPanel || faceModelReady) return;
    let cancelled = false;
    ensureFaceLandmarker().then((lm) => {
      if (!cancelled && lm) setFaceModelReady(true);
    });
    return () => { cancelled = true; };
  }, [showFilterPanel, faceModelReady]);

  // Flip between the front (셀카) and rear (후면) camera. Rear-camera footage of
  // the real world should not be mirrored, while the front camera defaults to a
  // mirror so the broadcaster sees themselves naturally — so we move the mirror
  // toggle along with the camera.
  const switchCamera = useCallback(() => {
    setFacingMode(prev => {
      const next = prev === 'user' ? 'environment' : 'user';
      setIsMirrored(next === 'user');
      return next;
    });
  }, []);

  // Load pre-configured live products. Filter to the seller's per-broadcast
  // selection passed in from LiveCommerceManagement; if no selection was made,
  // fall back to showing every registered product.
  useEffect(() => {
    const loadProducts = async () => {
      const products = await apiService.getLiveProducts(userName);
      if (!products.length) return;
      const selected = Array.isArray(selectedProductIds) ? selectedProductIds : [];
      const filtered = selected.length
        ? products.filter(p => selected.includes(p.id))
        : products;
      setLiveProducts(filtered.length ? filtered : products);
    };
    loadProducts();
  }, [userName, selectedProductIds]);

  // Poll cart stats while live
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    const fetchCartStats = async () => {
      try {
        const data = await apiService.getLiveCartStats(userName);
        if (cancelled) return;
        if (data) {
          const stats = data.stats && typeof data.stats === 'object' ? data.stats : null;
          const carts = Array.isArray(data.carts) ? data.carts : [];
          if (stats) {
            setCartStats({
              totalViewers: stats.totalViewers ?? 0,
              totalItems: stats.totalItems ?? 0,
              totalRevenue: stats.totalRevenue ?? 0,
              productCounts: Array.isArray(stats.productCounts) ? stats.productCounts : [],
            });
          } else {
            setCartStats(null);
          }
          setCartCarts(carts);
          setCartError(false);
        } else {
          setCartError(true);
        }
      } catch {
        if (!cancelled) setCartError(true);
      }
    };
    fetchCartStats();
    const interval = setInterval(fetchCartStats, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isLive, userName]);

  // Push active product + active material to live state so viewers can see them
  useEffect(() => {
    if (!isLive) return;
    const activeProduct = liveProducts.find(p => p.id === activeProductId) || null;
    const material = materials.find(m => m.id === activeMaterialId) || null;
    apiService.saveLiveState(userName, {
      isLive: true,
      viewerCount,
      currentProduct: activeProduct,
      activeMaterial: material,
      heartbeatAt: Date.now(),
    });
  }, [activeProductId, activeMaterialId, isLive, userName, viewerCount, liveProducts, materials]);

  // Live-state heartbeat: while broadcasting, re-assert isLive=true every few
  // seconds. Mobile browsers can fire a spurious pagehide/beforeunload (e.g. the
  // host briefly switches apps, answers a call, or the screen is touched), which
  // writes isLive=false to the shared store. Without a heartbeat that flip would
  // persist — kicking every viewer out mid-broadcast and dropping the "라이브 중"
  // banner on the host's page until the host happens to change a product. The
  // heartbeat heals any accidental false within ~8s, well inside the viewers'
  // confirm-before-close window.
  useEffect(() => {
    if (!isLive) return;
    const sendHeartbeat = () => {
      const activeProduct = liveProducts.find(p => p.id === activeProductId) || null;
      const material = materials.find(m => m.id === activeMaterialId) || null;
      apiService.saveLiveState(userName, {
        isLive: true,
        viewerCount,
        currentProduct: activeProduct,
        activeMaterial: material,
        // Freshness stamp: api-live treats an isLive=true record with a stale
        // heartbeatAt as offline, so a crashed/force-quit broadcast self-heals
        // instead of pinning "방송중" forever.
        heartbeatAt: Date.now(),
      }).catch(() => {});
    };
    const interval = setInterval(sendHeartbeat, 8000);
    return () => clearInterval(interval);
  }, [isLive, userName, viewerCount, activeProductId, activeMaterialId, liveProducts, materials]);

  // Canvas rendering loop: draws video with filters + mirror, produces stream for WebRTC
  // Uses shared drawFrame() with 30fps throttling and background tab support
  const startCanvasLoop = useCallback((sourceVideo: HTMLVideoElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    // Maximize rendering quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Reset timing for fresh start
    lastDrawTimeRef.current = 0;

    // Warm up the on-device face-landmark model so 얼굴형 조정 works as soon as
    // the camera is live (defaults ship with gentle reshaping on).
    ensureFaceLandmarker().then((lm) => { if (lm) setFaceModelReady(true); });

    const draw = () => {
      drawFrame(sourceVideo, canvas, ctx);
      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);

    // Create stream from canvas at 30fps for reliable WebRTC transmission.
    // Some in-app WebViews (older Android WebView and certain KakaoTalk/Naver
    // builds) do not implement HTMLCanvasElement.captureStream. Calling it
    // unconditionally would throw out of camera setup and abort the broadcast,
    // so we guard it: when it is unavailable we return null and toggleLive
    // falls back to broadcasting the raw camera stream (streamRef) — the picture
    // loses the canvas filters/mirror, but in-app broadcasting still works.
    let canvasStream: MediaStream | null = null;
    if (typeof canvas.captureStream === 'function') {
      try {
        canvasStream = canvas.captureStream(TARGET_FPS);
      } catch (e) {
        console.warn('[LiveStreaming] canvas.captureStream failed — broadcasting raw camera stream instead:', e);
      }
    } else {
      console.warn('[LiveStreaming] canvas.captureStream unsupported in this browser — broadcasting raw camera stream instead.');
    }
    canvasStreamRef.current = canvasStream;

    // Start background timer preemptively so it's ready when tab goes hidden
    startBackgroundTimer(sourceVideo, canvas, ctx);

    return canvasStream;
  }, [drawFrame, startBackgroundTimer]);

  const stopCanvasLoop = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    // Stop WebAudio background timer
    stopBackgroundTimer();
    if (canvasStreamRef.current) {
      canvasStreamRef.current.getTracks().forEach(t => t.stop());
      canvasStreamRef.current = null;
    }
  }, [stopBackgroundTimer]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    const el = chatEndRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Update viewer count from signaling + server heartbeats
  useEffect(() => {
    if (!isLive) return;
    const updateViewerCount = async () => {
      const webrtcCount = signalingRef.current?.getViewerCount() ?? 0;

      // Also fetch server-side viewer count from heartbeats
      let serverCount = 0;
      try {
        const state = await apiService.getLiveState(userName);
        if (state) {
          serverCount = state.viewerCount || 0;
        }
      } catch {}

      // Use the maximum of WebRTC peers and server-tracked viewers
      const totalCount = Math.max(webrtcCount, serverCount);
      setViewerCount(totalCount);
      if (totalCount > peakViewerCountRef.current) {
        peakViewerCountRef.current = totalCount;
      }
    };
    updateViewerCount();
    const interval = setInterval(updateViewerCount, 3000);
    return () => clearInterval(interval);
  }, [isLive, userName]);

  // Get camera stream and pipe through canvas for filters/mirror
  useEffect(() => {
    let mounted = true;

    if (isCameraOn) {
      const q = MAX_QUALITY;

      getBroadcastStream(q, facingMode)
        .then(stream => {
          if (!mounted) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          streamRef.current = stream;
          setCameraError(null);

          // Set content hint for video tracks to optimize encoding for detail
          stream.getVideoTracks().forEach(track => {
            if ('contentHint' in track) {
              track.contentHint = 'detail';
            }
          });

          // Log actual video resolution for debugging
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            const settings = videoTrack.getSettings();
            console.log(`[Camera] Actual resolution: ${settings.width}x${settings.height} @ ${settings.frameRate}fps`);
            setActualResolution(`${settings.width}x${settings.height}`);
          }

          // Set up hidden source video for canvas rendering
          const sourceVideo = videoRef.current;
          if (sourceVideo) {
            sourceVideo.srcObject = stream;
            // Explicitly play to ensure frames are decoded
            sourceVideo.play().catch(() => {});
          }

          // Apply current mic state to new stream
          stream.getAudioTracks().forEach(track => {
            track.enabled = isMicOn;
          });

          // Start canvas rendering loop
          if (sourceVideo) {
            const canvasStream = startCanvasLoop(sourceVideo);
            // Combine canvas video track + original audio tracks for WebRTC
            if (canvasStream) {
              const audioTracks = stream.getAudioTracks();
              audioTracks.forEach(t => canvasStream.addTrack(t));
              // Update signaling with the canvas stream if live
              if (signalingRef.current && isLiveRef.current) {
                signalingRef.current.updateStream(canvasStream);
              }
            } else if (signalingRef.current && isLiveRef.current) {
              // No canvas stream (in-app WebView without captureStream): keep the
              // broadcast alive by pushing the raw camera stream to viewers.
              signalingRef.current.updateStream(stream);
            }
          }
        })
        .catch(err => {
          console.error("Error accessing camera:", err);
          if (!mounted) return;
          // Map common failures to a Korean message the broadcaster can act on.
          const name = err?.name || '';
          if (name === 'NotAllowedError' || name === 'SecurityError') {
            setCameraError('카메라·마이크 권한을 허용해 주세요. 카카오톡·네이버 등 인앱 브라우저에서도 권한을 허용하면 바로 방송할 수 있어요. 권한 창이 보이지 않으면 "기본 브라우저로 열기"를 눌러 주세요.');
          } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
            setCameraError('사용 가능한 카메라를 찾을 수 없습니다. 기기의 카메라를 확인해 주세요.');
          } else if (name === 'NotReadableError') {
            setCameraError('다른 앱에서 카메라를 사용 중입니다. 해당 앱을 종료한 뒤 다시 시도해 주세요.');
          } else {
            setCameraError('카메라를 시작할 수 없습니다. 페이지를 새로고침하거나 다른 브라우저로 시도해 주세요.');
          }
        });
    } else {
      setCameraError(null);
      stopCanvasLoop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    return () => {
      mounted = false;
      stopCanvasLoop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [isCameraOn, facingMode, startCanvasLoop, stopCanvasLoop]);

  // Toggle mic by enabling/disabling audio tracks (no stream recreation)
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMicOn;
      });
    }
  }, [isMicOn]);

  // Load saved materials from localStorage, then cloud
  const materialsLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`picks_materials_${userName.toLowerCase()}`);
      if (saved) setMaterials(JSON.parse(saved));
    } catch {}

    // Load from cloud API (authoritative source)
    apiService.getSiteData(userName).then(apiData => {
      if (apiData && Array.isArray(apiData.materials) && apiData.materials.length > 0) {
        setMaterials(apiData.materials);
        localStorage.setItem(`picks_materials_${userName.toLowerCase()}`, JSON.stringify(apiData.materials));
      }
    })
      .catch(e => console.warn('[LiveStreaming] Failed to load materials from cloud:', e))
      .finally(() => { materialsLoadedRef.current = true; });
  }, [userName]);

  // Save materials to both localStorage and cloud on change (skip until initial load completes
  // so we don't overwrite cloud-stored banners with an empty initial state)
  const saveMaterialsRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!materialsLoadedRef.current) return;
    localStorage.setItem(`picks_materials_${userName.toLowerCase()}`, JSON.stringify(materials));
    // Debounce cloud save to avoid excessive API calls
    if (saveMaterialsRef.current) clearTimeout(saveMaterialsRef.current);
    saveMaterialsRef.current = setTimeout(() => {
      apiService.saveSiteData(userName, { materials }).catch(e =>
        console.warn('[LiveStreaming] Failed to save materials to cloud:', e)
      );
    }, 2000);
  }, [materials, userName]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const id = Date.now().toString();
    const name = newMaterialName || file.name.replace(/\.[^.]+$/, '');
    const type = newMaterialType;
    const width = type === 'banner' ? 90 : 50;

    // Read as data URL first so the thumbnail preview is available instantly,
    // then upload to blob storage and swap in the hosted URL. The hosted URL
    // keeps the live-state payload small so viewers render the banner
    // immediately instead of waiting for a huge base64 string to arrive.
    const dataUrl: string = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve((ev.target?.result as string) || '');
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    }).catch(() => '');

    if (!dataUrl) {
      setNewMaterialName('');
      return;
    }

    const item: MaterialItem = { id, name, type, url: dataUrl, width, opacity: 100 };
    setMaterials(prev => [...prev, item]);
    setNewMaterialName('');

    try {
      const hostedUrl = await apiService.uploadImage(userName, file, file.name);
      if (hostedUrl) {
        // Preload the hosted image so the URL swap does not cause a flash
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = hostedUrl;
        });
        setMaterials(prev => prev.map(m => (m.id === id ? { ...m, url: hostedUrl } : m)));
      }
    } catch (err) {
      console.warn('[LiveStreaming] Banner upload fell back to inline data URL:', err);
    }
  }, [newMaterialName, newMaterialType, userName]);

  const removeMaterial = useCallback((id: string) => {
    setMaterials(prev => prev.filter(m => m.id !== id));
    if (activeMaterialId === id) setActiveMaterialId(null);
  }, [activeMaterialId]);

  const updateMaterialSize = useCallback((id: string, width: number) => {
    setMaterials(prev => prev.map(m => m.id === id ? { ...m, width: Math.max(10, Math.min(100, width)) } : m));
  }, []);

  const activeMaterial = materials.find(m => m.id === activeMaterialId);
  // Banner-type materials, surfaced in the 배너 tab so they can be previewed and
  // toggled from the panel instead of only via the floating 방송 자료 overlay.
  const bannerMaterials = materials.filter(m => m.type === 'banner');

  // Preload all material images once loaded so activation renders instantly
  useEffect(() => {
    materials.forEach(m => {
      if (!m.url) return;
      const img = new Image();
      img.decoding = 'sync';
      img.src = m.url;
    });
  }, [materials]);

  /** Validate stream and start WebRTC broadcast — reused by toggleLive and auto-retry */
  const startLocalRecorder = (stream: MediaStream) => {
    if (recorderRef.current) return;
    if (typeof MediaRecorder === 'undefined') {
      console.warn('[Recording] MediaRecorder not supported in this browser; replay will be unavailable.');
      return;
    }

    // Build a recorder stream that combines the broadcast canvas (with filters
    // already baked in) with the live mic audio from the raw camera stream.
    const tracks: MediaStreamTrack[] = [];
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) tracks.push(videoTrack);
    const cameraAudio = streamRef.current?.getAudioTracks()[0];
    const fallbackAudio = stream.getAudioTracks()[0];
    const audioTrack = cameraAudio || fallbackAudio;
    if (audioTrack) tracks.push(audioTrack);
    if (tracks.length === 0) return;

    const recorderStream = new MediaStream(tracks);

    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    const mimeType = candidates.find(t => {
      try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
    }) || '';
    recorderMimeRef.current = mimeType || 'video/webm';

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(recorderStream, { mimeType, videoBitsPerSecond: 1_500_000 })
        : new MediaRecorder(recorderStream, { videoBitsPerSecond: 1_500_000 });
    } catch (e) {
      console.warn('[Recording] MediaRecorder init failed:', e);
      return;
    }

    recorderChunksRef.current = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recorderChunksRef.current.push(ev.data);
    };
    recorder.onerror = (ev) => console.warn('[Recording] recorder error:', ev);
    try {
      // 5-second slice keeps memory growth bounded and lets us recover most of
      // the recording if the tab is closed without a clean stop.
      recorder.start(5000);
      recorderRef.current = recorder;
      console.log('[Recording] started', mimeType);
    } catch (e) {
      console.warn('[Recording] recorder.start failed:', e);
    }
  };

  const stopAndUploadLocalRecorder = async (broadcastId: string, durationSeconds: number) => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    const chunks = recorderChunksRef.current;
    recorderChunksRef.current = [];

    // Wait for the recorder to flush its final chunk.
    await new Promise<void>(resolve => {
      const finalize = () => resolve();
      recorder.addEventListener('stop', finalize, { once: true });
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        else finalize();
      } catch {
        finalize();
      }
      // Hard timeout in case 'stop' never fires.
      setTimeout(finalize, 4000);
    });

    if (chunks.length === 0) {
      console.warn('[Recording] no chunks captured; skipping upload.');
      return;
    }

    const mime = recorderMimeRef.current || 'video/webm';
    const blob = new Blob(chunks, { type: mime });
    if (blob.size === 0) return;

    try {
      const url = `/api/broadcast-recording/${encodeURIComponent(userName.toLowerCase())}/${encodeURIComponent(broadcastId)}`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': mime,
          'x-recording-duration-seconds': String(Math.max(0, Math.round(durationSeconds))),
          'x-recording-size-bytes': String(blob.size),
        },
        body: blob,
      });
      if (!res.ok) {
        console.warn('[Recording] upload failed:', res.status, await res.text().catch(() => ''));
      } else {
        console.log('[Recording] upload complete', blob.size, 'bytes');
      }
    } catch (e) {
      console.warn('[Recording] upload threw:', e);
    }
  };

  const startBroadcastWithStream = (stream: MediaStream) => {
    if (!signalingRef.current) return;

    // Start the local MediaRecorder once we know the broadcast stream is good.
    // The recorder writes to memory; the final blob is uploaded on stop.
    startLocalRecorder(stream);

    const videoTracks = stream.getVideoTracks().filter(t => t.readyState === 'live');
    const audioTracks = stream.getAudioTracks().filter(t => t.readyState === 'live');
    console.log(`[Broadcast] Starting with ${videoTracks.length} video, ${audioTracks.length} audio tracks`);

    if (videoTracks.length === 0) {
      console.error('[Broadcast] CRITICAL: No live video tracks available! Viewers will see black screen.');
    }
    videoTracks.forEach((track, i) => {
      const settings = track.getSettings();
      console.log(`[Broadcast] Video track ${i}: enabled=${track.enabled}, readyState=${track.readyState}, ` +
        `resolution=${settings.width}x${settings.height}, frameRate=${settings.frameRate}, ` +
        `deviceId=${settings.deviceId || 'canvas'}`);
      if (!track.enabled) {
        console.warn(`[Broadcast] Video track ${i} was disabled, forcing enabled`);
        track.enabled = true;
      }
    });
    audioTracks.forEach((track, i) => {
      console.log(`[Broadcast] Audio track ${i}: enabled=${track.enabled}, readyState=${track.readyState}`);
    });

    try {
      if (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities) {
        const videoCapabilities = RTCRtpSender.getCapabilities('video');
        if (videoCapabilities) {
          const supportedCodecs = videoCapabilities.codecs.map(c => c.mimeType).filter((v, i, a) => a.indexOf(v) === i);
          console.log('[Broadcast] Supported video codecs:', supportedCodecs.join(', '));
          const hasH264 = supportedCodecs.some(c => c.toLowerCase().includes('h264'));
          const hasVP8 = supportedCodecs.some(c => c.toLowerCase().includes('vp8'));
          if (!hasH264 && !hasVP8) {
            console.warn('[Broadcast] WARNING: Neither H.264 nor VP8 supported – viewers on mobile may see black screen');
          }
          if (hasH264) {
            console.log('[Broadcast] H.264 available – good compatibility with mobile/in-app browsers');
          }
        }
      }
    } catch (e) {
      console.warn('[Broadcast] Could not check codec capabilities:', e);
    }

    signalingRef.current.start(stream);

    // Parallel: push the same canvas stream to AWS IVS via RTMPS so viewers
    // have an HLS fallback and we absorb scale beyond WebRTC peer capacity.
    // Runs best-effort — a failure here must not take down the WebRTC path.
    if (ivsConfig && !ivsBroadcasterRef.current) {
      const broadcaster = new IVSBroadcaster();
      ivsBroadcasterRef.current = broadcaster;
      (async () => {
        try {
          await broadcaster.init({
            // Match the live canvas (camera-native) resolution so the HLS/IVS
            // path keeps the same default aspect ratio as WebRTC instead of
            // letterboxing the frame into a fixed 9:16 composition.
            width: canvasRef.current?.width || MAX_QUALITY.width,
            height: canvasRef.current?.height || MAX_QUALITY.height,
            frameRate: MAX_QUALITY.frameRate,
            bitrate: MAX_QUALITY.bitrate,
            keyframeIntervalSec: MAX_QUALITY.keyframeIntervalSec,
          });
          broadcaster.onError((err) => console.warn('[IVS] client error:', err));
          broadcaster.onConnectionStateChange((s) => console.log('[IVS] connection state:', s));
          await broadcaster.start(stream, ivsConfig.ingestServer, ivsConfig.streamKey);
          setIvsBroadcasting(true);
          console.log('[IVS] broadcast started to', ivsConfig.ingestServer);
        } catch (err) {
          console.error('[IVS] Failed to start IVS broadcast (WebRTC continues):', err);
          try { await broadcaster.stop(); } catch {}
          if (ivsBroadcasterRef.current === broadcaster) ivsBroadcasterRef.current = null;
          setIvsBroadcasting(false);
        }
      })();
    }
  };

  const toggleLive = async () => {
    const newState = !isLive;
    const normalizedUsername = userName.toLowerCase();

    if (newState) {
      // 함께 방송으로 초대를 수락한 게스트는 '참여하기'를 먼저 눌러야 송출이
      // 시작됩니다. (방송 설정 → 참여하기 → 라이브 시작) 호스트/단독 방송은 해당 없음.
      const csGate = coSessionRef.current;
      if (csGate && csGate.role === 'guest' && csGate.status === 'accepted' && !coJoinedRef.current) {
        return;
      }
      // Inside the PICKS Folio native app: hand the broadcast off to the native
      // Amazon IVS broadcast screen (hardware encoder) instead of running the
      // in-WebView getUserMedia pipeline. The native shell loads the stream key
      // itself; we forward the username (and any already-resolved IVS config).
      const native = (window as unknown as {
        __PICKSFOLIO_NATIVE_BROADCAST__?: boolean;
        PicksFolioNative?: { openBroadcast?: (opts: Record<string, unknown>) => void };
      });
      // Diagnostic: log the native-handoff decision at the moment a broadcast
      // actually starts. Confirms whether the __PICKSFOLIO_NATIVE_BROADCAST__
      // branch is taken and surfaces the exact conditions that gate it.
      console.log('[LiveStreaming] toggleLive start — native broadcast handoff check:', {
        nativeBroadcastFlag: native.__PICKSFOLIO_NATIVE_BROADCAST__ ?? false,
        hasOpenBroadcast: typeof native.PicksFolioNative?.openBroadcast === 'function',
        willHandOffToNative:
          !!native.__PICKSFOLIO_NATIVE_BROADCAST__ &&
          typeof native.PicksFolioNative?.openBroadcast === 'function',
      });
      if (native.__PICKSFOLIO_NATIVE_BROADCAST__ && native.PicksFolioNative?.openBroadcast) {
        console.log('[LiveStreaming] __PICKSFOLIO_NATIVE_BROADCAST__ branch ACTIVE — handing broadcast off to native IVS screen.');
        native.PicksFolioNative.openBroadcast({
          username: normalizedUsername,
          ...(ivsConfig
            ? { ingestServer: ivsConfig.ingestServer, streamKey: ivsConfig.streamKey }
            : {}),
        });
        return;
      }

      // Block starting a broadcast when this month's time is exhausted. The
      // stream-key endpoint also enforces this server-side, but guarding here
      // gives immediate feedback and opens the charge modal.
      if (liveUsage?.exhausted || capBlock?.kind === 'exhausted') {
        setChargeError(null);
        setShowChargeModal(true);
        return;
      }

      // Re-enable camera/mic before going live. Stopping a broadcast turns the
      // camera off to release the device (see the "방송 종료" branch below), which
      // tears down the canvas/camera streams. Without turning them back on here,
      // restarting the broadcast never reacquires a stream — the broadcaster's
      // preview and every viewer would see a black screen. Setting these as early
      // as possible gives getUserMedia time to finish before the stream-readiness
      // retry loop runs. It is a harmless no-op on the first broadcast (camera is
      // already on).
      setIsCameraOn(true);
      setIsMicOn(true);

      // Clear previous cart data BEFORE going live to prevent stale data in polls
      try { await apiService.clearLiveCart(userName); } catch (e) { console.warn('[Live] clearLiveCart failed (non-blocking):', e); }

      const vCount = 0;
      setViewerCount(vCount);
      broadcastStartTimeRef.current = new Date().toISOString();
      // Keep id strictly URL-safe so it round-trips through the recording
      // upload route (`:broadcastId`) and the admin replay route without
      // any encoding surprises.
      broadcastIdRef.current = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      peakViewerCountRef.current = 0;
      // Re-arm the 30분 잔여 알림 for this new session.
      setLowTimeWarned(false);
      setShowLowTimeBanner(false);
      setLiveElapsedSec(0);

      // Reset all stats from previous broadcast
      setCartStats(null);
      setCartCarts([]);
      setCartError(false);
      setMessages([]);
      setActiveProductId(null);

      // Now set live state - this triggers cart polling, which will see empty cart
      setIsLive(newState);
      isLiveRef.current = newState;

      // 함께 방송: 라이브 시작 직후 세션 상태를 즉시 갱신한다. 8초 폴링을 기다리지
      // 않고 곧바로 세션이 'live'로 승격되어(아래 승격 effect), 시청자 화면의 2분할이
      // 바로 켜진다. (상대가 막 수락한 직후 송출을 시작한 경우의 지연을 없앤다.)
      apiService.getActiveCobroadcast(normalizedUsername)
        .then((s) => { if (s) setCoSession(s); })
        .catch(() => {});

      // Start WebRTC signaling to broadcast canvas stream (with filters) to viewers
      // Try canvas stream first (has filters/mirror), then raw camera, with retry
      let broadcastStream = canvasStreamRef.current || streamRef.current;

      // If no stream available yet, wait for camera to initialize with retries
      if (!broadcastStream) {
        for (let i = 0; i < 6; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          broadcastStream = canvasStreamRef.current || streamRef.current;
          if (broadcastStream) break;
        }
      }

      // If still no stream after initial retries, show notice and auto-retry after 1 second
      if (!broadcastStream) {
        console.warn('[Broadcast] 카메라 준비 중 — 1초 후 자동 재시도합니다.');
        setMessages(prev => [
          ...prev,
          {
            id: `system-camera-${Date.now()}`,
            user: 'System',
            text: '카메라 준비 중입니다. 잠시 후 자동으로 재시도합니다.',
            timestamp: Date.now(),
          },
        ]);
        setTimeout(async () => {
          const retryStream = canvasStreamRef.current || streamRef.current;
          if (retryStream && signalingRef.current && isLiveRef.current) {
            console.log('[Broadcast] 자동 재시도 — 스트림 발견, 방송 시작');
            startBroadcastWithStream(retryStream);
          } else {
            console.error('[Broadcast] 자동 재시도 실패 — 여전히 스트림 없음. 방송을 다시 시작해주세요.');
          }
        }, 1000);
      } else if (signalingRef.current && broadcastStream) {
        startBroadcastWithStream(broadcastStream);
      }

      const initialActiveMaterial = activeMaterialId
        ? materials.find(m => m.id === activeMaterialId) || null
        : null;

      let savedBroadcastTitle = '';
      try {
        savedBroadcastTitle = localStorage.getItem(`picks_broadcast_title_${normalizedUsername}`) || '';
      } catch {}

      const liveData = {
        isLive: true,
        viewerCount: vCount,
        currentProduct: null,
        activeMaterial: initialActiveMaterial,
        broadcastTitle: savedBroadcastTitle,
        startedAt: broadcastStartTimeRef.current,
        heartbeatAt: Date.now(),
      };

      // Update LocalStorage for immediate local sync
      localStorage.setItem(`picks_live_${normalizedUsername}`, JSON.stringify(liveData));

      // Fire-and-forget: API sync must NEVER block or crash the broadcast
      apiService.saveLiveState(userName, liveData).catch(e => console.warn('[Live] saveLiveState failed (non-blocking):', e));
    } else {
      setIsLive(newState);
      isLiveRef.current = newState;

      // End any co-broadcast session tied to this host when the broadcast stops.
      endCobroadcast().catch(() => {});

      // Save broadcast history before cleanup
      const endTime = new Date().toISOString();
      const startTime = broadcastStartTimeRef.current || endTime;
      const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
      // Meter live time by rounding UP to the whole minute: any broadcast that
      // actually went live consumes at least 1 minute of the monthly allowance,
      // so short test sessions still reduce the remaining time (a sub-30s round
      // to 0 would otherwise read as "usage never decreased").
      const durationMinutes = durationMs > 0 ? Math.max(1, Math.ceil(durationMs / 60000)) : 0;

      // Get final cart stats (non-blocking — default to empty if fetch fails)
      let finalCartStats = { totalViewers: 0, totalItems: 0, totalRevenue: 0, productCounts: [] as any[] };
      try {
        const finalCartData = await apiService.getLiveCartStats(userName);
        if (finalCartData?.stats) finalCartStats = finalCartData.stats;
      } catch (e) { console.warn('[Live] getLiveCartStats failed:', e); }

      // Save broadcast record (non-blocking). Once the row is inserted, kick
      // off the recording upload so the back-fill UPDATE finds an existing row.
      const broadcastId = broadcastIdRef.current || Date.now().toString();
      apiService.saveBroadcastRecord(userName, {
        id: broadcastId,
        startedAt: startTime,
        endedAt: endTime,
        durationMinutes,
        products: liveProducts,
        cartStats: finalCartStats,
        peakViewers: peakViewerCountRef.current,
        totalMessages: messages.length,
      })
        .then(() => refreshLiveUsage())
        .then(() => stopAndUploadLocalRecorder(broadcastId, durationMs / 1000))
        .catch(e => console.warn('[Live] saveBroadcastRecord/upload failed (non-blocking):', e));

      setViewerCount(0);
      setIsCameraOn(false);
      setIsMicOn(false);
      setActiveProductId(null);
      setActiveMaterialId(null);

      // Stop WebRTC signaling
      signalingRef.current?.stop();

      // Stop IVS broadcast (if running) — fire-and-forget so the UI doesn't
      // stall on network teardown.
      if (ivsBroadcasterRef.current) {
        const b = ivsBroadcasterRef.current;
        ivsBroadcasterRef.current = null;
        b.stop().catch(e => console.warn('[IVS] stop failed:', e));
        setIvsBroadcasting(false);
      }

      const liveData = { isLive: false, viewerCount: 0, currentProduct: null, activeMaterial: null };

      // Update LocalStorage
      localStorage.setItem(`picks_live_${normalizedUsername}`, JSON.stringify(liveData));

      // Fire-and-forget: cleanup sync — must not block UI.
      // Note: registered live products are intentionally preserved across
      // broadcasts; only the seller can remove them from BroadcastSettings.
      apiService.saveLiveState(userName, liveData).catch(e => console.warn('[Live] saveLiveState (off) failed:', e));
      apiService.clearLiveCart(userName).catch(e => console.warn('[Live] clearLiveCart failed:', e));
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;
    const msg: ChatMessage = {
      id: Date.now().toString(),
      user: '나(스트리머)',
      text: newMessage,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    // Send to viewers via signaling channel
    signalingRef.current?.sendChat(msg);
    setNewMessage('');
  };

  /* On the web, the chat/상품/담기현황 panel sits in a right-hand column
     (md:flex-row) so the broadcast stage can take the full viewport height —
     the largest possible mobile 9:16 preview. On phones the panel docks at the
     bottom beneath the stage, matching what a viewer sees. */
  return (
    <>
    {/* Full-screen black backdrop behind the console, so any space on either
        side of the centered portrait 9:16 stage reads as clean black side
        margins. Hidden on phones, where the console already fills the screen. */}
    <div className="hidden md:block fixed inset-0 z-[199] bg-black" />
    {/* The broadcaster console = the broadcast stage + the chat/상품/담기현황 panel.
        On phones they stack vertically (stage on top, panel docked at the bottom)
        so it matches what a viewer sees on their phone. On the web the panel moves
        to a right-hand column (md:flex-row) and the stage fills the full viewport
        height, so the portrait 9:16 preview is as large as the screen allows while
        keeping the exact mobile viewing proportions. */}
    <div className="fixed inset-0 z-[200] bg-slate-950 flex flex-col md:flex-row">
      {/* Main Stream Area */}
      <div className="flex-1 min-h-0 relative bg-black overflow-hidden flex items-center justify-center">
        {/* Viewer frame: the broadcast frame (built on a canvas sized to the
            camera's native resolution) is shown with object-contain so the host
            sees the full, un-cropped camera framing — the same default ratio the
            stock camera app shows — letterboxed within the stage rather than
            zoom-cropped to fill it. */}
        {/* Lock the broadcast frame to a portrait 9:16 column — the exact shape
            and size a viewer sees — centered in the black stage so the space on
            either side reads as clean black side margins (instead of the camera
            stretching edge-to-edge on the web). The canvas below is 9:16, so it
            fills this box exactly and fully hides the raw source <video> behind
            it — no more two-frames-overlapping look. */}
        <div
          className={`overflow-hidden bg-black ${coSession?.partner ? 'absolute left-0 w-1/2' : 'relative h-full aspect-[9/16] max-w-full mx-auto'}`}
          style={coSession?.partner ? { top: '15%', bottom: '24%' } : undefined}
        >
        {/* Source video: rendered as a full-size base layer (not a 1px hidden
            element) so mobile browsers — especially iOS Safari — keep decoding
            and playing frames that feed the canvas. On desktop the opaque canvas
            on top covers it; if the canvas pipeline ever stalls on mobile, the
            broadcaster still sees their live camera through this layer instead of
            a black screen. object-cover (center-crop to the portrait box) matches
            the canvas's 9:16 crop so this layer never peeks out as a wider
            landscape frame behind the canvas. */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="block w-full h-full object-cover pointer-events-none"
        />
        {/* Canvas shows filtered/mirrored output at the camera's native aspect
            ratio, displayed with object-contain so the whole frame is visible
            (no zoom crop). It is layered on top of the source video; if the
            canvas pipeline stalls on mobile the broadcaster still sees the live
            camera underneath. */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-contain"
          style={{ objectFit: 'contain' }}
        />
        {!isCameraOn && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
            <div className="text-center space-y-4">
              <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mx-auto">
                <CameraOff size={40} className="text-slate-600" />
              </div>
              <p className="text-slate-500 font-black uppercase tracking-widest text-xs">Camera is Off</p>
            </div>
          </div>
        )}

        {/* Camera access error — shown when the camera is meant to be on but the
            stream could not start (e.g. blocked permission or an in-app browser). */}
        {isCameraOn && cameraError && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/95 p-6">
            <div className="text-center space-y-4 max-w-xs">
              <div className="w-20 h-20 bg-red-500/20 border border-red-500/40 rounded-full flex items-center justify-center mx-auto">
                <CameraOff size={36} className="text-red-400" />
              </div>
              <p className="text-white font-black text-sm">카메라를 시작할 수 없어요</p>
              <p className="text-slate-300 text-xs font-medium leading-relaxed">{cameraError}</p>
              <div className="flex flex-col gap-2.5">
                {/* Primary action: retry in the current browser. Broadcasting is
                    supported inside in-app browsers (KakaoTalk, Naver, etc.), so
                    re-requesting the camera after the user grants permission is
                    the path that keeps them in the app. */}
                <button
                  onClick={() => { setCameraError(null); setIsCameraOn(false); setTimeout(() => setIsCameraOn(true), 50); }}
                  className="px-5 py-2.5 bg-blue-primary text-white rounded-full text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                >
                  다시 시도
                </button>
                {/* Last-resort fallback: open the OS/browser settings, or — only
                    when the in-app browser truly refuses camera access — bounce
                    out to the default browser where permission can be granted. */}
                <button
                  onClick={openCameraSettings}
                  className="px-5 py-2.5 bg-white text-slate-900 rounded-full text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                >
                  {detectInApp().isInApp ? '기본 브라우저로 열기' : '카메라 권한 설정 열기'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Material Overlays — only 상품/이미지 자료 float over the broadcaster's
            own preview. Banner-type materials are managed and previewed entirely
            in the 배너 탭 ("배너 관리"); they no longer float as a bar over the host's
            live video here. Viewers still see a toggled banner via their own
            renderer (LiveStream), so removing the host-side float only declutters
            the broadcaster's screen — it does not hide banners from viewers. */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {activeMaterial && activeMaterial.type !== 'banner' && (
            <div
              key={activeMaterial.id}
              style={{
                width: `${activeMaterial.width}%`,
                height: 'auto',
                opacity: activeMaterial.opacity / 100,
                position: 'absolute',
                ...(activeMaterial.type === 'product'
                  ? { right: '12px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }
                  : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }),
              }}
            >
              <div className="bg-white rounded-3xl overflow-hidden shadow-2xl border-4 border-white">
                <img
                  src={activeMaterial.url}
                  alt={activeMaterial.name}
                  className="w-full h-auto object-cover"
                  loading="eager"
                  decoding="sync"
                  fetchPriority="high"
                />
                <div className="p-2 bg-black/60 backdrop-blur-md">
                  <p className="text-white text-xs font-black text-center">{activeMaterial.name}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Active Product Preview Overlay - shows seller what viewers see */}
        {activeProductId && (() => {
          const activeProduct = liveProducts.find(p => p.id === activeProductId);
          if (!activeProduct) return null;
          return (
            <div
              className="absolute right-3 md:right-4 w-[60vw] max-w-[240px] md:max-w-[280px] z-20 pointer-events-none"
              style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
            >
              <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-2.5 relative">
                <div className="absolute -top-2 left-3 px-2 py-0.5 bg-green-600 rounded-full">
                  <span className="text-white text-[8px] font-black uppercase tracking-widest">시청자 화면 미리보기</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {activeProduct.image ? (
                    <MediaAuto src={activeProduct.image} className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-white/20" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 border border-white/20">
                      <Package size={16} className="text-white/30" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-white text-[11px] font-black truncate">{activeProduct.name}</h4>
                    {activeProduct.price && <p className="text-white/60 text-[9px] truncate">{activeProduct.price}</p>}
                  </div>
                </div>
                <div className="flex gap-1.5 mt-2">
                  <div className="flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide bg-orange-500/50 text-white/70 flex items-center justify-center gap-1">
                    <ShoppingBag size={10} /> 상품 담기
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide bg-blue-600/50 text-white/70 flex items-center justify-center">
                    구매
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        </div>
        {/* End viewer frame */}

        {/* 함께 방송 split — the partner's live feed fills the right half so the
            broadcaster sees the same 2-up layout viewers see. Both feeds are
            confined to a centered middle band so they no longer stretch full
            height and overlap; the top/bottom stay as clean black margins under
            the existing control HUD (which shows 잔여시간 and the partner name). */}
        {coSession?.partner && (
          <>
            <PartnerFeed
              channel={coSession.partner}
              className="absolute right-0 w-1/2 top-[15%] bottom-[24%] bg-black"
              onConnectedChange={setPartnerStreamReady}
            />
            {/* Divider line between the two halves (middle band only) */}
            <div className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-violet-500/60 pointer-events-none" style={{ top: '15%', bottom: '24%' }} />
            {/* Per-half name labels, pinned to the top of the middle band. */}
            <div className="absolute left-1/4 -translate-x-1/2 bg-black/55 backdrop-blur-md px-2.5 py-1 rounded-full text-white text-[10px] font-black pointer-events-none" style={{ top: 'calc(15% + 8px)' }}>
              @{userName} (나)
            </div>
            <div className="absolute left-3/4 -translate-x-1/2 bg-black/55 backdrop-blur-md px-2.5 py-1 rounded-full text-white text-[10px] font-black pointer-events-none flex items-center gap-1" style={{ top: 'calc(15% + 8px)' }}>
              <Users size={10} className="text-violet-300" /> @{coSession.partner}
            </div>
            {!partnerStreamReady && (
              <div className="absolute right-0 w-1/2 flex items-center justify-center text-white/60 text-xs font-bold pointer-events-none" style={{ top: '15%', bottom: '24%' }}>
                @{coSession.partner} 연결 중…
              </div>
            )}
            {/* A pushed banner is confirmed via the 배너 tab ("노출 중") rather than
                floating over the split, so neither face is covered. */}
          </>
        )}

        {/* Overlay UI */}
        <div className="absolute inset-0 p-3 md:p-8 flex flex-col justify-between pointer-events-none safe-area-pad">
          <div className="flex justify-between items-start pointer-events-auto">
            <div className="flex items-center gap-2 md:gap-4 flex-wrap">
              <div className="bg-black/40 backdrop-blur-md px-3 md:px-4 py-2 rounded-2xl border border-white/10 flex items-center gap-2 md:gap-3">
                <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`} />
                <span className="text-white text-xs font-black uppercase tracking-widest">
                  {isLive ? 'LIVE' : 'PREVIEW'}
                </span>
                {isLive && (
                  <div className="h-4 w-[1px] bg-white/20 mx-1" />
                )}
                {isLive && (
                  <span className="text-white/60 text-[10px] font-bold flex items-center gap-1">
                    <Users size={12} /> {viewerCount}
                  </span>
                )}
              </div>
              {liveUsage && (() => {
                // While live, show the ticking client-side estimate; otherwise the
                // server figure. Flag a low (≤30분) running balance in amber/red.
                const shownRemaining =
                  isLive && liveRemainingMinutes !== null
                    ? liveRemainingMinutes
                    : liveUsage.remainingMinutes;
                const lowRunning = isLive && shownRemaining <= 30;
                return (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div
                    className={`backdrop-blur-md px-3 md:px-4 py-2 rounded-2xl border text-white text-[10px] md:text-[11px] font-bold flex items-center gap-2 ${liveUsage.exhausted || shownRemaining <= 0 ? 'bg-red-600/40 border-red-400/40' : lowRunning ? 'bg-amber-600/40 border-amber-400/40' : 'bg-black/40 border-white/10'}`}
                    title="이번 달 라이브 잔여시간 (포함 3시간 + 충전 시간) · 후불 누적 (시간당 8,900원) · 매출 수수료 8.5%(PG 포함)"
                  >
                    <span className="text-white/40 uppercase tracking-widest text-[9px]">잔여</span>
                    <span className={liveUsage.exhausted || shownRemaining <= 0 ? 'text-red-200' : lowRunning ? 'text-amber-100' : ''}>
                      {Math.floor(shownRemaining / 60)}시간{' '}
                      {shownRemaining % 60}분 남음
                    </span>
                    {liveUsage.chargedMinutes > 0 && (
                      <>
                        <span className="text-white/30">·</span>
                        <span className="text-emerald-300">
                          충전 {Math.floor(liveUsage.chargedMinutes / 60)}시간
                        </span>
                      </>
                    )}
                    {liveUsage.overageAmountKrw > 0 && (
                      <>
                        <span className="text-white/30">·</span>
                        <span className="text-amber-300">
                          후불 {liveUsage.overageAmountKrw.toLocaleString()}원
                        </span>
                      </>
                    )}
                  </div>
                  {!isNativeApp() && (
                    <button
                      type="button"
                      onClick={() => { setChargeError(null); setShowChargeModal(true); }}
                      className="backdrop-blur-md px-3 py-2 rounded-2xl border border-emerald-400/40 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-100 text-[10px] md:text-[11px] font-black flex items-center gap-1 transition-all active:scale-95"
                      title="라이브 시간 충전하기 (시간당 8,900원)"
                    >
                      <Plus size={12} /> 시간 충전
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setInviteError(null); setInviteNotice(null); setShowInviteModal(true); }}
                    className={`backdrop-blur-md px-3 py-2 rounded-2xl border text-[10px] md:text-[11px] font-black flex items-center gap-1 transition-all active:scale-95 ${coSession ? 'border-violet-400/60 bg-violet-500/30 text-white' : 'border-violet-400/40 bg-violet-500/20 hover:bg-violet-500/30 text-violet-100'}`}
                    title="다른 크리에이터를 초대해 함께 방송하기"
                  >
                    <UserPlus size={12} /> {coSession ? `함께: @${coSession.partner}` : '초대하기'}
                  </button>
                </div>
                );
              })()}
              {capBlock && (
                <div className="bg-red-600/90 backdrop-blur-md px-3 md:px-4 py-2 rounded-2xl border border-red-400/40 text-white text-[10px] md:text-[11px] font-black flex items-center gap-2">
                  <span className="uppercase tracking-widest text-[9px]">자동 차단</span>
                  <span>{capBlock.message}</span>
                </div>
              )}
              {isLive && showLowTimeBanner && (
                <div className="w-full md:w-auto bg-amber-500/90 backdrop-blur-md px-3 md:px-4 py-2 rounded-2xl border border-amber-300/50 text-white text-[10px] md:text-[11px] font-black flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                  <Zap size={14} className="shrink-0" />
                  <span>
                    {isNativeApp()
                      ? `라이브 잔여시간이 ${liveRemainingMinutes ?? 30}분 남았습니다. 시간 충전은 웹사이트에서 할 수 있습니다.`
                      : `라이브 잔여시간이 ${liveRemainingMinutes ?? 30}분 남았습니다. 방송이 끊기기 전에 충전하세요.`}
                  </span>
                  {!isNativeApp() && (
                    <button
                      type="button"
                      onClick={() => { setChargeError(null); setShowChargeModal(true); }}
                      className="ml-1 bg-white text-amber-700 px-2.5 py-1 rounded-full text-[10px] font-black hover:bg-amber-50 active:scale-95 transition-all shrink-0"
                    >
                      지금 충전
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowLowTimeBanner(false)}
                    className="text-white/80 hover:text-white shrink-0"
                    aria-label="닫기"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-2 md:gap-3 items-start flex-wrap justify-end">
              {/* Quality Badge - Always Max */}
              <div className="hidden md:flex bg-black/40 backdrop-blur-md px-3 py-3 rounded-full text-white items-center gap-2">
                <Monitor size={18} />
                <span className="text-[10px] font-black uppercase tracking-widest text-green-400">
                  {MAX_QUALITY.description}
                </span>
                {actualResolution && (
                  <span className="text-[9px] font-mono text-white/40">{actualResolution}</span>
                )}
              </div>
              {/* IVS Stream Status */}
              <button
                onClick={() => setShowStreamInfo(!showStreamInfo)}
                className={`p-2 md:p-3 backdrop-blur-md rounded-full text-white transition-all ${
                  ivsConfig ? (isLive ? 'bg-red-600 animate-pulse' : 'bg-green-600') : 'bg-yellow-600'
                }`}
                title="AWS IVS 송출 정보"
              >
                <Radio size={18} />
              </button>
              {/* Mirror toggle */}
              <button
                onClick={() => setIsMirrored(!isMirrored)}
                className={`p-2 md:p-3 backdrop-blur-md rounded-full text-white transition-all ${isMirrored ? 'bg-blue-600' : 'bg-black/40 hover:bg-black/60'}`}
                title="거울 모드"
              >
                <FlipHorizontal2 size={20} />
              </button>
              {/* Front/rear camera switch */}
              <button
                onClick={switchCamera}
                disabled={!isCameraOn}
                className={`p-2 md:p-3 backdrop-blur-md rounded-full text-white transition-all ${facingMode === 'environment' ? 'bg-blue-600' : 'bg-black/40 hover:bg-black/60'} disabled:opacity-40`}
                title={facingMode === 'user' ? '후면 카메라로 전환' : '전면 카메라로 전환'}
              >
                <SwitchCamera size={20} />
              </button>
              {/* 얼굴 보정 panel toggle */}
              <button
                onClick={() => { setShowFilterPanel(!showFilterPanel); setShowMaterialPanel(false); }}
                className={`p-2 md:p-3 backdrop-blur-md rounded-full text-white transition-all ${showFilterPanel ? 'bg-pink-600' : 'bg-black/40 hover:bg-black/60'}`}
                title="얼굴 보정"
              >
                <Sparkles size={20} />
              </button>
              <button
                onClick={() => { setShowMaterialPanel(!showMaterialPanel); setShowFilterPanel(false); }}
                className={`p-2 md:p-3 backdrop-blur-md rounded-full text-white transition-all ${showMaterialPanel ? 'bg-blue-600' : 'bg-black/40 hover:bg-black/60'}`}
              >
                <Settings size={20} />
              </button>
              <button onClick={onClose} className="p-2 md:p-3 bg-black/40 backdrop-blur-md rounded-full text-white hover:bg-black/60 transition-all">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Bottom Menu Bar */}
          <div className="flex flex-col gap-3 md:gap-4 pointer-events-auto max-h-[70vh] md:max-h-none overflow-y-auto scrollbar-hide">
            {/* AWS IVS Stream Info Panel (One-Click Broadcast) */}
            {showStreamInfo && (
              <div className="bg-black/60 backdrop-blur-xl border border-white/10 p-4 md:p-5 rounded-2xl md:rounded-[2rem] w-full max-w-lg animate-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-white font-black text-xs md:text-sm uppercase tracking-widest flex items-center gap-2">
                    <Radio size={16} className="text-red-400" /> AWS IVS 송출 설정
                  </h4>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                    ivsConfig ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {ivsLoading ? '로딩중...' : ivsConfig ? '연결됨' : '미설정'}
                  </div>
                </div>

                {ivsConfig ? (
                  <div className="space-y-3">
                    <div className="bg-white/5 rounded-xl p-3">
                      <label className="text-white/40 text-[10px] font-bold uppercase tracking-widest block mb-1">Ingest Server</label>
                      <div className="flex items-center gap-2">
                        <code className="text-white/80 text-xs font-mono flex-1 truncate">{ivsConfig.ingestServer}</code>
                        <button
                          onClick={() => copyToClipboard(ivsConfig.ingestServer, 'ingest')}
                          className="p-1.5 bg-white/10 rounded-lg hover:bg-white/20 transition-all flex-shrink-0"
                        >
                          {copiedField === 'ingest' ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-white/60" />}
                        </button>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-xl p-3">
                      <label className="text-white/40 text-[10px] font-bold uppercase tracking-widest block mb-1">Stream Key (자동 연동)</label>
                      <div className="flex items-center gap-2">
                        <code className="text-white/80 text-xs font-mono flex-1 truncate">{'*'.repeat(20)}...{ivsConfig.streamKey.slice(-6)}</code>
                        <button
                          onClick={() => copyToClipboard(ivsConfig.streamKey, 'key')}
                          className="p-1.5 bg-white/10 rounded-lg hover:bg-white/20 transition-all flex-shrink-0"
                        >
                          {copiedField === 'key' ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-white/60" />}
                        </button>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-xl p-3">
                      <label className="text-white/40 text-[10px] font-bold uppercase tracking-widest block mb-1">RTMP URL (OBS 연동용)</label>
                      <div className="flex items-center gap-2">
                        <code className="text-white/80 text-xs font-mono flex-1 truncate">{ivsConfig.rtmpUrl}</code>
                        <button
                          onClick={() => copyToClipboard(ivsConfig.rtmpUrl, 'rtmp')}
                          className="p-1.5 bg-white/10 rounded-lg hover:bg-white/20 transition-all flex-shrink-0"
                        >
                          {copiedField === 'rtmp' ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-white/60" />}
                        </button>
                      </div>
                    </div>

                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 mt-2">
                      <p className="text-green-400 text-xs font-bold">
                        원클릭 송출 활성화됨 - [라이브 시작] 버튼을 누르면 자동으로 송출이 시작됩니다.
                      </p>
                      <p className="text-green-400/60 text-[10px] mt-1">
                        OBS Studio 사용 시 위 정보를 복사해 설정하세요.
                      </p>
                      {ivsBroadcasting && (
                        <p className="text-red-400 text-[11px] font-bold mt-2 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span>
                          IVS 송출 중 (RTMPS)
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 text-center">
                    <p className="text-yellow-400 text-xs font-bold mb-2">스트림 키가 설정되지 않았습니다</p>
                    <p className="text-yellow-400/60 text-[10px]">관리자에게 문의하거나 환경 변수를 확인해주세요.</p>
                  </div>
                )}
              </div>
            )}

            {/* 얼굴 보정 Panel is rendered inside the sidebar (채팅/상품/담기현황)
                instead of here, so the controls never cover the broadcaster's
                face — see the showFilterPanel overlay in the sidebar below. */}

            {/* Material Management Panel */}
            {showMaterialPanel && (
              <div className="bg-black/60 backdrop-blur-xl border border-white/10 p-4 md:p-5 rounded-2xl md:rounded-[2rem] w-full max-w-lg animate-in slide-in-from-bottom-4 duration-300">
                <h4 className="text-white font-black text-xs md:text-sm mb-4 uppercase tracking-widest flex items-center gap-2">
                  <ImageIcon size={16} /> 방송 자료 관리
                </h4>

                {/* Add new material */}
                <div className="space-y-3 mb-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMaterialName}
                      onChange={(e) => setNewMaterialName(e.target.value)}
                      placeholder="자료 이름"
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-white text-xs placeholder:text-white/30"
                    />
                    <select
                      value={newMaterialType}
                      onChange={(e) => setNewMaterialType(e.target.value as any)}
                      className="bg-white/5 border border-white/10 rounded-xl py-2 px-3 text-white text-xs appearance-none"
                    >
                      <option value="banner">배너</option>
                      <option value="product">상품</option>
                      <option value="image">이미지</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 flex items-center justify-center gap-2 bg-blue-600/20 border border-blue-500/30 text-blue-400 rounded-xl py-2 px-3 text-xs font-bold hover:bg-blue-600/30 transition-all"
                    >
                      <Upload size={14} /> 파일 업로드
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>

                {/* Material list */}
                <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-hide">
                  {materials.length === 0 && (
                    <p className="text-white/30 text-xs text-center py-3">등록된 자료가 없습니다</p>
                  )}
                  {materials.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-2 rounded-xl border transition-all cursor-pointer ${
                        activeMaterialId === item.id
                          ? 'bg-blue-600/20 border-blue-500/40'
                          : 'bg-white/5 border-white/5 hover:bg-white/10'
                      }`}
                    >
                      <img src={item.url} alt={item.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-bold truncate">{item.name}</p>
                        <span className="text-white/40 text-[10px] uppercase">{item.type}</span>
                      </div>
                      {/* Size preset control */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); updateMaterialSize(item.id, 30); }}
                          className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-all ${item.width === 30 ? 'bg-blue-600 text-white' : 'bg-white/10 text-white/40 hover:text-white'}`}
                          title="작은 크기"
                        >
                          S
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateMaterialSize(item.id, 50); }}
                          className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-all ${item.width === 50 ? 'bg-blue-600 text-white' : 'bg-white/10 text-white/40 hover:text-white'}`}
                          title="중간 크기"
                        >
                          M
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); updateMaterialSize(item.id, 90); }}
                          className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold transition-all ${item.width === 90 ? 'bg-blue-600 text-white' : 'bg-white/10 text-white/40 hover:text-white'}`}
                          title="큰 크기"
                        >
                          L
                        </button>
                      </div>
                      {/* Toggle display */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMaterialId(activeMaterialId === item.id ? null : item.id);
                        }}
                        className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${
                          activeMaterialId === item.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-white/10 text-white/60 hover:bg-white/20'
                        }`}
                      >
                        {activeMaterialId === item.id ? 'ON' : 'OFF'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeMaterial(item.id); }}
                        className="p-1 text-red-400/60 hover:text-red-400 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick material toggle bar */}
            {materials.length > 0 && (
              <div className="bg-black/40 backdrop-blur-md p-2 rounded-2xl border border-white/10 flex gap-2 flex-wrap">
                {materials.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setActiveMaterialId(activeMaterialId === item.id ? null : item.id)}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ${
                      activeMaterialId === item.id ? 'bg-blue-600 text-white' : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {item.type === 'banner' ? <Layout size={12} /> : <ImageIcon size={12} />}
                    {item.name}
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-between items-end gap-2 flex-wrap">
              <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                <button
                  onClick={() => setIsCameraOn(!isCameraOn)}
                  className={`p-3 md:p-4 rounded-full backdrop-blur-md transition-all ${isCameraOn ? 'bg-white/10 text-white' : 'bg-red-500 text-white'}`}
                >
                  {isCameraOn ? <Camera size={20} /> : <CameraOff size={20} />}
                </button>
                <button
                  onClick={() => setIsMicOn(!isMicOn)}
                  className={`p-3 md:p-4 rounded-full backdrop-blur-md transition-all ${isMicOn ? 'bg-white/10 text-white' : 'bg-red-500 text-white'}`}
                >
                  {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
                <button
                  onClick={() => setIsMirrored(!isMirrored)}
                  className={`p-3 md:p-4 rounded-full backdrop-blur-md transition-all ${isMirrored ? 'bg-blue-500/80 text-white' : 'bg-white/10 text-white'}`}
                  title="거울 모드"
                >
                  <FlipHorizontal2 size={20} />
                </button>
                <button
                  onClick={switchCamera}
                  disabled={!isCameraOn}
                  className={`p-3 md:p-4 rounded-full backdrop-blur-md transition-all ${facingMode === 'environment' ? 'bg-blue-500/80 text-white' : 'bg-white/10 text-white'} disabled:opacity-40`}
                  title={facingMode === 'user' ? '후면 카메라로 전환' : '전면 카메라로 전환'}
                >
                  <SwitchCamera size={20} />
                </button>
                <button className="hidden md:block p-4 bg-white/10 backdrop-blur-md text-white rounded-full hover:bg-white/20 transition-all">
                  <Monitor size={24} />
                </button>
              </div>

              <button
                onClick={toggleLive}
                disabled={!isLive && (((!!capBlock && capBlock.kind !== 'exhausted')) || (coSession?.role === 'guest' && coSession.status === 'accepted' && !coJoined))}
                title={capBlock ? capBlock.message : (coSession?.role === 'guest' && coSession.status === 'accepted' && !coJoined) ? "먼저 '참여하기'를 눌러주세요" : undefined}
                className={`shrink-0 whitespace-nowrap ml-auto px-6 md:px-10 py-3 md:py-5 rounded-full text-sm md:text-lg font-black transition-all shadow-2xl active:scale-95 flex items-center gap-2 md:gap-3 ${isLive ? 'bg-red-600 text-white hover:bg-red-700' : capBlock ? (capBlock.kind === 'exhausted' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-500 text-white/80 cursor-not-allowed') : (coSession?.role === 'guest' && coSession.status === 'accepted' && !coJoined) ? 'bg-slate-500 text-white/80 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                {ivsConfig && <Radio size={20} className={isLive ? 'animate-pulse' : ''} />}
                {isLive ? '방송 종료' : capBlock ? (capBlock.kind === 'monthly' ? '월 한도 도달' : capBlock.kind === 'exhausted' ? '시간 충전 필요' : '오늘 한도 도달') : (coSession?.role === 'guest' && coSession.status === 'accepted' && !coJoined) ? '참여 후 시작' : '라이브 시작'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar (Chat, Products & Cart Stats) — docked at the bottom on phones
          (full width), and moved to a fixed right-hand column on the web (md) so
          the broadcast stage beside it can use the full viewport height. */}
      <div className="relative w-full md:w-[22rem] bg-slate-900 border-t md:border-t-0 md:border-l border-white/5 flex flex-col h-[30vh] md:h-full shrink-0">
        {/* 얼굴 보정 Panel — beauty-cam style controls (yycam 등) applied on-device
            in the canvas draw loop (no SDK/token). Rendered as an overlay over
            the 채팅/상품/담기현황 sidebar so the broadcaster's face on the video
            stays fully visible while the sliders are adjusted. */}
        {showFilterPanel && (
          <div className="absolute inset-0 z-30 bg-slate-900 flex flex-col animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between p-4 md:p-5 border-b border-white/5 shrink-0">
              <h4 className="text-white font-black text-xs md:text-sm uppercase tracking-widest flex items-center gap-2">
                <Sparkles size={16} className="text-pink-400" /> 얼굴 보정
              </h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setFaceShape(DEFAULT_FACE_SHAPE); }}
                  className="text-white/40 text-[10px] font-bold uppercase tracking-widest hover:text-white transition-all px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10"
                >
                  초기화
                </button>
                <button
                  onClick={() => setShowFilterPanel(false)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all"
                  title="닫기"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-5 scrollbar-hide">
                    {/* Master on/off — off broadcasts the untouched camera. */}
                    <div className="mb-4 p-3 rounded-2xl bg-gradient-to-r from-pink-500/10 to-purple-500/10 border border-pink-400/20">
                      <div className="flex items-center justify-between">
                        <span className="text-white text-xs md:text-sm font-bold flex items-center gap-2">
                          <Sparkles size={15} className="text-pink-400" /> 보정 사용
                        </span>
                        <button
                          onClick={() => setBeautyEnabled(v => !v)}
                          role="switch"
                          aria-checked={beautyEnabled}
                          title="얼굴 보정 켜기/끄기"
                          className={`relative w-11 h-6 rounded-full transition-all flex-shrink-0 ${beautyEnabled ? 'bg-pink-500' : 'bg-white/20'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${beautyEnabled ? 'translate-x-5' : ''}`} />
                        </button>
                      </div>
                      <p className="text-white/40 text-[10px] mt-2">
                        얼굴형(축소·턱선·중안부·눈·코)을 자연스럽게 다듬어 줍니다.
                      </p>
                    </div>

                    {/* 얼굴형 조정 — real geometric reshaping driven by on-device
                        face landmarks (not a color filter). */}
                    <div className={`transition-opacity ${beautyEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="text-white/80 text-[11px] md:text-xs font-black uppercase tracking-widest flex items-center gap-2">
                          <SwitchCamera size={14} className="text-purple-400" /> 얼굴형 조정
                        </h5>
                        {/* Live detection status so the broadcaster knows the
                            geometric reshaping is actually tracking a face. */}
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                            !faceModelReady
                              ? 'bg-white/10 text-white/40'
                              : faceDetected
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            !faceModelReady ? 'bg-white/40' : faceDetected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                          }`} />
                          {!faceModelReady ? '모델 로딩 중' : faceDetected ? '얼굴 인식됨' : '얼굴 찾는 중'}
                        </span>
                      </div>

                      <div className="space-y-4">
                        {([
                          { key: 'face' as const, label: '광대 슬림', dot: 'bg-purple-400', accent: 'accent-purple-400' },
                          { key: 'jaw' as const, label: '턱 슬림', dot: 'bg-fuchsia-400', accent: 'accent-fuchsia-400' },
                          { key: 'midface' as const, label: '중안부 줄이기', dot: 'bg-rose-400', accent: 'accent-rose-400' },
                          { key: 'eye' as const, label: '눈 크게', dot: 'bg-indigo-400', accent: 'accent-indigo-400' },
                          { key: 'nose' as const, label: '코 슬림', dot: 'bg-violet-400', accent: 'accent-violet-400' },
                        ]).map(({ key, label, dot, accent }) => (
                          <div key={key} className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label className="text-white/60 text-xs font-bold flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${dot}`} /> {label}
                              </label>
                              <span className="text-white/40 text-[10px] font-mono">{faceShape[key]}</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={faceShape[key]}
                              onChange={(e) => setFaceShape(s => ({ ...s, [key]: Number(e.target.value) }))}
                              className={`w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer ${accent}`}
                            />
                          </div>
                        ))}
                      </div>

                      {/* 얼굴형 presets */}
                      <div className="flex gap-2 mt-3 flex-wrap">
                        <button
                          onClick={() => { setBeautyEnabled(true); setFaceShape(FACE_SHAPE_OFF); }}
                          className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/10 text-white/60 hover:text-white transition-all"
                        >
                          원본
                        </button>
                        <button
                          onClick={() => { setBeautyEnabled(true); setFaceShape({ face: 25, jaw: 22, eye: 18, nose: 12, midface: 12 }); }}
                          className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-all"
                        >
                          은은하게
                        </button>
                        <button
                          onClick={() => { setBeautyEnabled(true); setFaceShape(DEFAULT_FACE_SHAPE); }}
                          className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-fuchsia-500/20 text-fuchsia-300 hover:bg-fuchsia-500/30 transition-all"
                        >
                          V라인
                        </button>
                        <button
                          onClick={() => { setBeautyEnabled(true); setFaceShape({ face: 60, jaw: 55, eye: 55, nose: 35, midface: 30 }); }}
                          className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition-all"
                        >
                          또렷하게
                        </button>
                      </div>
                      <p className="text-white/40 text-[10px] mt-2">
                        광대·턱·중안부·눈·코를 실제로 조정합니다. 정면을 바라볼 때 가장 자연스럽습니다.
                      </p>
                    </div>
            </div>
          </div>
        )}
        {/* Tab navigation */}
        <div className="flex border-b border-white/5">
          <button
            onClick={() => { setShowProductPanel(false); setShowCartPanel(false); setShowBannerPanel(false); }}
            className={`flex-1 py-2.5 md:py-3 flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-widest transition-all ${
              !showProductPanel && !showCartPanel && !showBannerPanel ? 'text-blue-400 border-b-2 border-blue-500' : 'text-white/40 hover:text-white/60'
            }`}
          >
            <MessageCircle size={14} /> 채팅
          </button>
          <button
            onClick={() => { setShowProductPanel(true); setShowCartPanel(false); setShowBannerPanel(false); }}
            className={`flex-1 py-2.5 md:py-3 flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-widest transition-all ${
              showProductPanel ? 'text-green-400 border-b-2 border-green-500' : 'text-white/40 hover:text-white/60'
            }`}
          >
            <ShoppingBag size={14} /> 상품
            {liveProducts.length > 0 && <span className="bg-green-600 text-white text-[9px] px-1.5 rounded-full">{liveProducts.length}</span>}
          </button>
          <button
            onClick={() => { setShowCartPanel(true); setShowProductPanel(false); setShowBannerPanel(false); }}
            className={`flex-1 py-2.5 md:py-3 flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-widest transition-all ${
              showCartPanel ? 'text-orange-400 border-b-2 border-orange-500' : 'text-white/40 hover:text-white/60'
            }`}
          >
            <BarChart3 size={14} /> 담기현황
            {cartStats && cartStats.totalItems > 0 && <span className="bg-orange-600 text-white text-[9px] px-1.5 rounded-full">{cartStats.totalItems}</span>}
          </button>
          <button
            onClick={() => { setShowBannerPanel(true); setShowProductPanel(false); setShowCartPanel(false); }}
            className={`flex-1 py-2.5 md:py-3 flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-widest transition-all ${
              showBannerPanel ? 'text-violet-400 border-b-2 border-violet-500' : 'text-white/40 hover:text-white/60'
            }`}
          >
            <Layout size={14} /> 배너
            {bannerMaterials.length > 0 && <span className="bg-violet-600 text-white text-[9px] px-1.5 rounded-full">{bannerMaterials.length}</span>}
          </button>
        </div>

        {/* Chat Panel */}
        {!showProductPanel && !showCartPanel && !showBannerPanel && (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-hide overscroll-contain">
              {messages.map(msg => (
                <div key={msg.id} className="animate-in slide-in-from-bottom-2 duration-200">
                  <span className="text-blue-400 text-xs font-black uppercase tracking-wide block mb-1">{msg.user}</span>
                  <div className="bg-white/5 border border-white/5 p-3 rounded-2xl rounded-tl-none text-white text-[15px] leading-snug">
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-4 bg-slate-950/50">
              <div className="relative">
                <input
                  type="text"
                  placeholder="메시지를 입력하세요..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 px-5 text-white text-[15px] outline-none focus:border-blue-500/50 transition-all placeholder:text-white/30"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                />
                <button
                  onClick={handleSendMessage}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-blue-500 hover:text-blue-400"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        )}

        {/* Product Push Panel */}
        {showProductPanel && (
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-3 scrollbar-hide">
            <p className="text-white/40 text-xs font-medium mb-2">
              상품을 선택하면 시청자 화면에 표시됩니다. 시청자가 '상품 담기' 버튼으로 담을 수 있습니다.
            </p>
            {liveProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-3">
                  <Package size={28} className="text-white/20" />
                </div>
                <p className="text-white/40 font-bold text-sm">등록된 상품이 없습니다</p>
                <p className="text-white/20 text-xs mt-1">라이브 커머스 메뉴에서 상품을 먼저 설정해주세요</p>
              </div>
            ) : (
              liveProducts.map(product => {
                const isActive = activeProductId === product.id;
                return (
                  <div
                    key={product.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      isActive ? 'bg-green-600/20 border-green-500/40' : 'bg-white/5 border-white/5 hover:bg-white/10'
                    }`}
                  >
                    {product.image ? (
                      <MediaAuto src={product.image} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                        <Package size={18} className="text-white/30" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-bold truncate">{product.name}</p>
                      {product.price && <p className="text-white/40 text-[10px]">{product.price}</p>}
                      {product.link && <p className="text-blue-400 text-[9px] truncate">{product.link}</p>}
                    </div>
                    <button
                      onClick={() => setActiveProductId(isActive ? null : product.id)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                        isActive ? 'bg-green-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
                      }`}
                    >
                      {isActive ? '표시중' : '띄우기'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Cart Stats Panel */}
        {showCartPanel && (
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4 scrollbar-hide">
            {/* Error State */}
            {cartError && !cartStats && (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-3">
                  <BarChart3 size={22} className="text-red-400" />
                </div>
                <p className="text-red-400 font-bold text-sm">데이터를 불러오지 못했습니다</p>
                <p className="text-white/30 text-xs mt-1">잠시 후 자동으로 재시도합니다</p>
              </div>
            )}

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">담은 시청자</p>
                <p className="text-white text-xl font-black">{cartStats?.totalViewers || 0}<span className="text-white/40 text-xs">명</span></p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">총 담은 수</p>
                <p className="text-orange-400 text-xl font-black">{cartStats?.totalItems || 0}<span className="text-white/40 text-xs">개</span></p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">예상 매출</p>
                <p className="text-green-400 text-lg font-black">{(cartStats?.totalRevenue || 0).toLocaleString()}<span className="text-white/40 text-xs">원</span></p>
              </div>
            </div>

            {/* Product Ranking */}
            {cartStats && Array.isArray(cartStats.productCounts) && cartStats.productCounts.length > 0 && (
              <div>
                <h5 className="text-white/60 text-xs font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                  <TrendingUp size={14} className="text-orange-400" /> 상품별 담기 순위
                </h5>
                <div className="space-y-2">
                  {cartStats.productCounts.map((item, i) => (
                    <div key={item.productId || i} className="bg-white/5 p-2.5 rounded-xl">
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${
                          i === 0 ? 'bg-yellow-500 text-black' : i === 1 ? 'bg-slate-300 text-black' : i === 2 ? 'bg-orange-700 text-white' : 'bg-white/10 text-white/40'
                        }`}>
                          {i + 1}
                        </span>
                        {item.image ? (
                          <MediaAuto src={item.image} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                            <Package size={12} className="text-white/30" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-bold truncate">{item.name}</p>
                          {item.price && <p className="text-white/30 text-[10px]">{item.price}</p>}
                        </div>
                        <span className="text-orange-400 text-sm font-black">{item.count}</span>
                      </div>
                      {/* Option breakdown */}
                      {item.optionCounts && Object.keys(item.optionCounts).length > 0 && (
                        <div className="mt-2 ml-9 space-y-1.5">
                          {Object.entries(item.optionCounts).map(([optName, values]) => (
                            <div key={optName}>
                              <p className="text-white/30 text-[9px] font-bold uppercase tracking-wider mb-1">{optName}</p>
                              <div className="flex flex-wrap gap-1">
                                {values && typeof values === 'object' ? Object.entries(values).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0)).map(([val, cnt]) => (
                                  <span key={val} className="text-[9px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full font-bold">
                                    {val} <span className="text-blue-400">{cnt}</span>
                                  </span>
                                )) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Viewer Carts Detail */}
            {Array.isArray(cartCarts) && cartCarts.length > 0 && (
              <div>
                <h5 className="text-white/60 text-xs font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Users size={14} className="text-blue-400" /> 시청자별 담은 상품
                </h5>
                <div className="space-y-2">
                  {cartCarts.map((cart, cartIdx) => (
                    <div key={cart.viewerId || cartIdx} className="bg-white/5 p-3 rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        {cart.viewerProfileImage && (
                          <img src={cart.viewerProfileImage} alt="" className="w-6 h-6 rounded-full object-cover" />
                        )}
                        <span className="text-blue-400 text-xs font-bold">{cart.viewerNickname || '시청자'}</span>
                        <span className="text-white/20 text-[10px]">{Array.isArray(cart.items) ? cart.items.length : 0}개</span>
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        {Array.isArray(cart.items) && cart.items.map((item: any, idx: number) => (
                          <span key={`${item.productId}-${idx}`} className="text-white/60 text-[10px] bg-white/5 px-2 py-0.5 rounded-full">
                            {item.productName}
                            {item.selectedOptions && typeof item.selectedOptions === 'object' && Object.keys(item.selectedOptions).length > 0 && (
                              <span className="text-blue-300 ml-1">({Object.values(item.selectedOptions).join('/')})</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!cartStats || cartStats.totalItems === 0) && !cartError && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-3">
                  <BarChart3 size={28} className="text-white/20" />
                </div>
                <p className="text-white/40 font-bold text-sm">아직 담은 데이터가 없습니다</p>
                <p className="text-white/20 text-xs mt-1">{isLive ? '시청자가 상품을 담으면 여기에 표시됩니다' : '방송을 시작하면 실시간으로 확인할 수 있습니다'}</p>
              </div>
            )}
          </div>
        )}

        {/* Banner Panel — preview and toggle banner materials here instead of
            having them permanently float over the live video. Toggling a banner
            ON pushes it to viewers (shown in the co-broadcast info band, or as a
            standard overlay in solo broadcasts); OFF removes it from the screen. */}
        {showBannerPanel && (
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-3 scrollbar-hide">
            <p className="text-white/40 text-xs font-medium mb-1">
              배너를 켜면 시청자 화면에 노출됩니다. 함께 방송 중에는 영상 위가 아니라 하단 정보 영역에 표시돼 얼굴을 가리지 않습니다.
            </p>
            {bannerMaterials.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-3">
                  <Layout size={26} className="text-white/20" />
                </div>
                <p className="text-white/40 font-bold text-sm">등록된 배너가 없습니다</p>
                <p className="text-white/20 text-xs mt-1">상단의 '방송 자료 관리'에서 배너 이미지를 업로드하세요</p>
              </div>
            ) : (
              bannerMaterials.map(item => {
                const isOn = activeMaterialId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border overflow-hidden transition-all ${
                      isOn ? 'bg-violet-600/15 border-violet-500/40' : 'bg-white/5 border-white/5'
                    }`}
                  >
                    {item.url && (
                      <div className="w-full aspect-[16/9] bg-black/40 flex items-center justify-center overflow-hidden">
                        <img src={item.url} alt={item.name || ''} className="w-full h-full object-contain" loading="lazy" />
                      </div>
                    )}
                    <div className="flex items-center gap-2 p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-bold truncate">{item.name || '배너'}</p>
                        <p className="text-white/30 text-[10px]">{isOn ? '시청자 화면에 노출 중' : '꺼짐'}</p>
                      </div>
                      <button
                        onClick={() => setActiveMaterialId(isOn ? null : item.id)}
                        className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                          isOn ? 'bg-violet-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
                        }`}
                      >
                        {isOn ? '내리기' : '띄우기'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
      {showChargeModal && (
        <div
          className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => { if (!charging) setShowChargeModal(false); }}
        >
          <div
            className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-white text-lg font-black flex items-center gap-2">
                <Zap size={18} className="text-emerald-400" /> 라이브 시간 충전
              </h3>
              <button
                onClick={() => { if (!charging) setShowChargeModal(false); }}
                className="text-white/40 hover:text-white p-1 rounded-full"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-white/50 text-xs mb-5">
              {isNativeApp()
                ? '이번 달 라이브 시간을 모두 사용했습니다. 시간 충전은 PICKS Folio 웹사이트에서 진행해 주세요. 웹에서 충전한 시간은 앱에서도 그대로 사용할 수 있습니다.'
                : `시간당 ${CHARGE_RATE_KRW_PER_HOUR.toLocaleString()}원 · 충전한 시간은 이번 달 잔여시간에 즉시 추가됩니다. (1회 결제)`}
            </p>

            {!isNativeApp() && liveUsage && (
              <div className="bg-white/5 rounded-2xl px-4 py-3 mb-5 text-[11px] text-white/60 flex items-center justify-between">
                <span>현재 잔여시간</span>
                <span className="text-white font-bold">
                  {Math.floor((isLive && liveRemainingMinutes !== null ? liveRemainingMinutes : liveUsage.remainingMinutes) / 60)}시간 {(isLive && liveRemainingMinutes !== null ? liveRemainingMinutes : liveUsage.remainingMinutes) % 60}분
                </span>
              </div>
            )}

            {!isNativeApp() && (
              <>
                <div className="flex items-center justify-center gap-4 mb-5">
                  <button
                    onClick={() => setChargeHours((h) => Math.max(1, h - 1))}
                    disabled={charging || chargeHours <= 1}
                    className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl font-black flex items-center justify-center disabled:opacity-30"
                  >
                    −
                  </button>
                  <div className="text-center min-w-[80px]">
                    <div className="text-white text-3xl font-black">{chargeHours}<span className="text-base font-bold text-white/50">시간</span></div>
                  </div>
                  <button
                    onClick={() => setChargeHours((h) => Math.min(50, h + 1))}
                    disabled={charging || chargeHours >= 50}
                    className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl font-black flex items-center justify-center disabled:opacity-30"
                  >
                    +
                  </button>
                </div>

                {/* 결제 수단 — 토스페이먼츠(카드) / 토스페이 / 카카오페이 (1회 결제) */}
                <div className="mb-4">
                  <p className="text-white/40 text-[11px] font-bold mb-2">결제 수단</p>
                  <div className="grid grid-cols-3 gap-2">
                    {CHARGE_PAY_METHODS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setChargePayMethod(m.id)}
                        disabled={charging}
                        className={`py-2.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-50 ${
                          chargePayMethod === m.id
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'bg-white/5 border-white/10 text-white/60 hover:border-emerald-400/40'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-400/20 rounded-2xl px-4 py-3 mb-4">
                  <span className="text-emerald-200/80 text-xs font-bold">결제 금액</span>
                  <span className="text-emerald-300 text-lg font-black">
                    {(chargeHours * CHARGE_RATE_KRW_PER_HOUR).toLocaleString()}원
                  </span>
                </div>

                {chargeError && (
                  <p className="text-red-400 text-xs font-bold mb-3 text-center">{chargeError}</p>
                )}

                <button
                  onClick={handleChargeTime}
                  disabled={charging}
                  className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {charging ? '결제 진행 중…' : <><Zap size={16} /> {(chargeHours * CHARGE_RATE_KRW_PER_HOUR).toLocaleString()}원 결제하고 {chargeHours}시간 충전</>}
                </button>
              </>
            )}

            {isNativeApp() && (
              <button
                onClick={() => setShowChargeModal(false)}
                className="w-full py-3.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-black text-sm transition-all active:scale-95"
              >
                확인
              </button>
            )}
          </div>
        </div>
      )}

      {/* 함께 방송 초대 도착 — incoming invite banner (this user is the invitee) */}
      {!coSession && incomingInvites.length > 0 && (
        <div className="fixed top-3 inset-x-0 z-[260] flex flex-col items-center gap-2 px-3 pointer-events-none">
          {incomingInvites.map((inv) => (
            <div
              key={inv.id}
              className="pointer-events-auto w-full max-w-md bg-slate-900/95 backdrop-blur-md border border-violet-400/40 rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2"
            >
              <div className="w-9 h-9 rounded-full bg-violet-500/30 overflow-hidden shrink-0 flex items-center justify-center">
                {inv.host_avatar_url
                  ? <img src={inv.host_avatar_url} alt="" className="w-full h-full object-cover" />
                  : <UserPlus size={16} className="text-violet-200" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-black truncate">{inv.host_display_name}</p>
                <p className="text-white/50 text-[11px]">함께 방송하자고 초대했어요</p>
              </div>
              <button
                type="button"
                onClick={() => acceptInvite(inv.id)}
                className="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-black active:scale-95 transition-all shrink-0"
              >
                수락
              </button>
              <button
                type="button"
                onClick={() => declineInvite(inv.id)}
                className="px-2.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/70 text-[11px] font-bold active:scale-95 transition-all shrink-0"
              >
                거절
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 함께 방송 참여하기 — guest gate. After accepting an invite the guest lands
          in 방송 설정; they finish setup, press 참여하기 here, then 라이브 시작 to
          actually transmit. The go-live button stays locked until 참여하기. */}
      {coSession && coSession.role === 'guest' && coSession.status === 'accepted' && !isLive && !coJoined && (
        <div className="fixed top-3 inset-x-0 z-[260] flex flex-col items-center gap-2 px-3 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-md bg-slate-900/95 backdrop-blur-md border border-violet-400/40 rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
            <div className="w-9 h-9 rounded-full bg-violet-500/30 overflow-hidden shrink-0 flex items-center justify-center">
              {coSession.partner_avatar_url
                ? <img src={coSession.partner_avatar_url} alt="" className="w-full h-full object-cover" />
                : <Users size={16} className="text-violet-200" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-black truncate">@{coSession.partner}님과 함께 방송</p>
              <p className="text-white/50 text-[11px]">설정을 마치고 참여하기를 누르세요</p>
            </div>
            <button
              type="button"
              onClick={() => setCoJoined(true)}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-black active:scale-95 transition-all shrink-0"
            >
              참여하기
            </button>
          </div>
        </div>
      )}

      {/* 참여 완료 안내 — once joined, prompt the guest to press 라이브 시작. */}
      {coSession && coSession.role === 'guest' && coSession.status === 'accepted' && !isLive && coJoined && (
        <div className="fixed top-3 inset-x-0 z-[260] flex flex-col items-center gap-2 px-3 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-md bg-emerald-900/90 backdrop-blur-md border border-emerald-400/40 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
            <Users size={14} className="text-emerald-300 shrink-0" />
            <p className="text-white text-[11px] font-bold">참여했어요! '라이브 시작'을 누르면 함께 방송이 송출됩니다.</p>
          </div>
        </div>
      )}

      {/* 함께 방송하기 — invite + friends modal */}
      {showInviteModal && (
        <div
          className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => { if (!inviteBusy) setShowInviteModal(false); }}
        >
          <div
            className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-sm p-6 shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-white text-lg font-black flex items-center gap-2">
                <Users size={18} className="text-violet-400" /> 함께 방송하기
              </h3>
              <button
                onClick={() => { if (!inviteBusy) setShowInviteModal(false); }}
                className="text-white/40 hover:text-white p-1 rounded-full"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-white/50 text-xs mb-5">
              다른 크리에이터를 초대하면 두 방송이 함께 진행되고, 시청자는 두 화면을 동시에 볼 수 있어요.
            </p>

            {coSession ? (
              <div className="bg-violet-500/10 border border-violet-400/30 rounded-2xl px-4 py-4 mb-4 text-center">
                <p className="text-white text-sm font-black mb-1">
                  @{coSession.partner}님과 {coSession.status === 'live' ? '함께 방송 중' : '함께 방송 준비 중'}
                </p>
                <p className="text-white/50 text-[11px] mb-3">
                  {coSession.role === 'host' ? '내가 초대했어요' : '초대를 수락했어요'}
                </p>
                <button
                  type="button"
                  onClick={() => { endCobroadcast(); }}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold active:scale-95"
                >
                  함께 방송 종료
                </button>
              </div>
            ) : (
              <>
                {/* 유저네임으로 초대 */}
                <label className="text-white/40 text-[11px] font-bold mb-2 block">유저네임으로 초대</label>
                <div className="flex gap-2 mb-2">
                  <div className="flex-1 flex items-center bg-white/5 border border-white/10 rounded-xl px-3">
                    <span className="text-white/30 text-sm font-bold">@</span>
                    <input
                      type="text"
                      value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value.replace(/\s/g, '').toLowerCase())}
                      onKeyDown={(e) => { if (e.key === 'Enter') sendInvite(inviteUsername, saveAsFriend); }}
                      placeholder="유저네임"
                      disabled={inviteBusy}
                      className="flex-1 bg-transparent text-white text-sm py-2.5 px-1 outline-none placeholder:text-white/30"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => sendInvite(inviteUsername, saveAsFriend)}
                    disabled={inviteBusy || inviteUsername.trim().length < 3}
                    className="px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black active:scale-95 disabled:opacity-40"
                  >
                    초대
                  </button>
                </div>
                <label className="flex items-center gap-2 mb-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveAsFriend}
                    onChange={(e) => setSaveAsFriend(e.target.checked)}
                    className="accent-violet-500 w-4 h-4"
                  />
                  <span className="text-white/60 text-[11px]">초대하면서 친구 목록에 추가</span>
                </label>
                <button
                  type="button"
                  onClick={() => addFriend(inviteUsername)}
                  disabled={inviteBusy || inviteUsername.trim().length < 3}
                  className="text-violet-300 hover:text-violet-200 text-[11px] font-bold mb-4 inline-flex items-center gap-1 disabled:opacity-40"
                >
                  <UserPlus size={12} /> 초대 없이 친구로만 추가
                </button>

                {inviteError && <p className="text-red-400 text-xs font-bold mb-3">{inviteError}</p>}
                {inviteNotice && <p className="text-emerald-300 text-xs font-bold mb-3">{inviteNotice}</p>}

                {/* 친구 목록 */}
                <div className="border-t border-white/10 pt-4">
                  <p className="text-white/40 text-[11px] font-bold mb-3">친구 목록에서 초대</p>
                  {friendsLoading ? (
                    <p className="text-white/30 text-xs py-4 text-center">불러오는 중…</p>
                  ) : friends.length === 0 ? (
                    <p className="text-white/30 text-xs py-4 text-center">아직 추가한 친구가 없어요. 유저네임으로 초대하면 자동으로 추가됩니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {friends.map((f) => (
                        <div key={f.username} className="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2">
                          <div className="w-8 h-8 rounded-full bg-violet-500/30 overflow-hidden shrink-0 flex items-center justify-center">
                            {f.avatar_url
                              ? <img src={f.avatar_url} alt="" className="w-full h-full object-cover" />
                              : <UserCheck size={14} className="text-violet-200" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-xs font-bold truncate">{f.display_name}</p>
                            <p className="text-white/40 text-[10px] truncate">@{f.username}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => sendInvite(f.username, false)}
                            disabled={inviteBusy}
                            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-black active:scale-95 disabled:opacity-40 shrink-0"
                          >
                            초대
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFriend(f.username)}
                            className="text-white/30 hover:text-red-400 p-1 shrink-0"
                            title="친구 삭제"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  );
};

export default LiveStreaming;
