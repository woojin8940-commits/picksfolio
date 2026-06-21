import React, { useEffect, useRef, useState } from 'react';
import { ViewerSignaling } from '../services/webrtcSignaling';
import { apiService } from '../services/apiService';

declare global {
  interface Window {
    videojs?: any;
  }
}

const envPlaybackUrl = (): string =>
  (typeof process !== 'undefined' && (process.env as any).VITE_IVS_PLAYBACK_URL) ||
  (import.meta as any).env?.VITE_IVS_PLAYBACK_URL ||
  '';

interface PartnerFeedProps {
  /** The co-broadcast partner's channel (username) to subscribe to. */
  channel: string;
  /** Wrapper classes — the caller positions/sizes this half of the split. */
  className?: string;
  /** How the partner video fills its half. The broadcaster's full-height
      TikTok-style split wants 'cover'; the viewer's letterboxed middle band
      keeps 'contain' so nothing is zoom-cropped. */
  objectFit?: 'cover' | 'contain';
  /** Notified whenever the partner feed connects/disconnects, so the caller can
      hide its "연결 중…" placeholder. */
  onConnectedChange?: (connected: boolean) => void;
}

/**
 * Plays a co-broadcast partner's channel inside one half of the split screen.
 *
 * A partner host can be broadcasting two different ways:
 *   • from the web   → WebRTC (the same signaling path a normal viewer uses)
 *   • from the phone → RTMP push → IVS, played back over HLS
 *
 * The original split only ever attempted WebRTC, so a mobile partner never
 * appeared — the viewer saw one feed and an empty half stuck on "연결 중…". This
 * component mirrors the main viewer's two-path strategy: try WebRTC first and,
 * if no media arrives within a short grace window, fall back to the IVS HLS
 * playback URL. Whichever path produces frames wins; WebRTC is always preferred
 * if it connects.
 */
export const PartnerFeed: React.FC<PartnerFeedProps> = ({ channel, className, objectFit = 'contain', onConnectedChange }) => {
  const webrtcRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HTMLVideoElement>(null);
  const sigRef = useRef<ViewerSignaling | null>(null);
  const playerRef = useRef<any>(null);
  const webrtcConnectedRef = useRef(false);

  const [webrtcConnected, setWebrtcConnected] = useState(false);
  const [hlsActive, setHlsActive] = useState(false);
  const [hlsPlaying, setHlsPlaying] = useState(false);
  const [hlsUrl, setHlsUrl] = useState('');

  // Bubble the combined connection state up to the caller. "Connected" means a
  // feed is actually producing frames — WebRTC media arrived, or the HLS player
  // reached real playback. Merely *attempting* HLS (hlsActive) is NOT enough:
  // a partner who hasn't started pushing yet leaves the HLS playlist 404ing, and
  // reporting that as connected hid the "연결 중…" placeholder while the player
  // showed a raw "media could not be loaded" error instead.
  useEffect(() => {
    onConnectedChange?.(webrtcConnected || hlsPlaying);
  }, [webrtcConnected, hlsPlaying, onConnectedChange]);

  // ── WebRTC attempt ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!channel) return;
    webrtcConnectedRef.current = false;
    setWebrtcConnected(false);
    setHlsActive(false);
    setHlsPlaying(false);

    const sig = new ViewerSignaling(channel);
    sigRef.current = sig;
    sig.onStream((stream) => {
      const v = webrtcRef.current;
      if (v) {
        v.srcObject = stream;
        v.muted = true;
        v.play().catch(() => {});
      }
      webrtcConnectedRef.current = true;
      setWebrtcConnected(true);
      // Prefer WebRTC: if HLS had kicked in, retire it now that live P2P media
      // is flowing.
      setHlsActive(false);
    });
    sig.connect();

    return () => {
      sig.disconnect();
      if (sigRef.current === sig) sigRef.current = null;
      webrtcConnectedRef.current = false;
      setWebrtcConnected(false);
    };
  }, [channel]);

  // ── Resolve the HLS playback URL (shared IVS channel) ───────────────────
  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await apiService.getStreamKey(channel);
        if (cancelled) return;
        setHlsUrl(cfg?.playbackUrl || envPlaybackUrl());
      } catch {
        if (!cancelled) setHlsUrl(envPlaybackUrl());
      }
    })();
    return () => { cancelled = true; };
  }, [channel]);

  // ── Fall back to HLS if WebRTC hasn't produced media in time ────────────
  useEffect(() => {
    if (webrtcConnected) { setHlsActive(false); return; }
    if (!hlsUrl) return;
    // Keep this grace window short: a mobile partner only ever arrives over
    // HLS, so waiting too long left viewers staring at a "연결 중…" half while
    // the other feed was already playing. 3s is enough for a web partner's
    // WebRTC to win when it's going to.
    const t = setTimeout(() => {
      if (!webrtcConnectedRef.current) setHlsActive(true);
    }, 3000);
    return () => clearTimeout(t);
  }, [webrtcConnected, hlsUrl, channel]);

  // ── Build the Video.js HLS player when HLS is active ────────────────────
  useEffect(() => {
    if (!hlsActive || !hlsUrl || !hlsRef.current || !window.videojs) return;
    if (playerRef.current) {
      playerRef.current.dispose();
      playerRef.current = null;
    }
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const player = window.videojs(hlsRef.current, {
      autoplay: 'muted',
      muted: true,
      controls: false,
      preload: 'auto',
      fill: true,
      playsinline: true,
      // Suppress Video.js's built-in error banner ("The media could not be
      // loaded…"). A co-broadcast partner often hasn't started pushing yet, so
      // the playlist 404s for a few seconds; we show our own "연결 중…" overlay
      // and keep retrying instead of flashing a scary error over their half.
      errorDisplay: false,
      html5: {
        vhs: {
          overrideNative: !(/iPad|iPhone|iPod/.test(navigator.userAgent)),
          allowSeeksWithinUnsafeLiveWindow: true,
        },
        nativeAudioTracks: /iPad|iPhone|iPod/.test(navigator.userAgent),
        nativeVideoTracks: /iPad|iPhone|iPod/.test(navigator.userAgent),
      },
      liveui: true,
    });
    const loadSource = () => {
      if (disposed) return;
      player.src({ src: hlsUrl, type: 'application/x-mpegURL' });
      player.play?.().catch(() => {});
    };
    loadSource();
    playerRef.current = player;

    // Real playback reached → tell the caller the partner half is live.
    const markPlaying = () => { if (!disposed) setHlsPlaying(true); };
    player.on('playing', markPlaying);
    player.on('loadeddata', markPlaying);
    // The live playlist may not exist yet (partner still warming up). Clear the
    // error and retry on a short loop until frames arrive, keeping the parent's
    // "연결 중…" placeholder visible meanwhile.
    player.on('error', () => {
      if (disposed) return;
      setHlsPlaying(false);
      player.error(null);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(loadSource, 2500);
    });

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
      setHlsPlaying(false);
    };
  }, [hlsActive, hlsUrl]);

  const showHls = hlsActive && !webrtcConnected;

  return (
    <div className={className}>
      <video
        ref={webrtcRef}
        autoPlay
        playsInline
        muted
        preload="auto"
        // @ts-ignore - inline playback hints for iOS / Android in-app WebViews
        webkit-playsinline=""
        // @ts-ignore
        x5-playsinline=""
        className="absolute inset-0 w-full h-full bg-black"
        style={{ objectFit, display: showHls ? 'none' : 'block' }}
      />
      <div className="absolute inset-0 w-full h-full" style={{ display: showHls ? 'block' : 'none' }}>
        <video
          ref={hlsRef}
          className="video-js"
          autoPlay
          muted
          playsInline
          preload="auto"
          // @ts-ignore
          webkit-playsinline=""
          style={{ width: '100%', height: '100%', objectFit }}
        />
      </div>
    </div>
  );
};

export default PartnerFeed;
