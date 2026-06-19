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
export const PartnerFeed: React.FC<PartnerFeedProps> = ({ channel, className, onConnectedChange }) => {
  const webrtcRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HTMLVideoElement>(null);
  const sigRef = useRef<ViewerSignaling | null>(null);
  const playerRef = useRef<any>(null);
  const webrtcConnectedRef = useRef(false);

  const [webrtcConnected, setWebrtcConnected] = useState(false);
  const [hlsActive, setHlsActive] = useState(false);
  const [hlsUrl, setHlsUrl] = useState('');

  // Bubble the combined connection state up to the caller.
  useEffect(() => {
    onConnectedChange?.(webrtcConnected || hlsActive);
  }, [webrtcConnected, hlsActive, onConnectedChange]);

  // ── WebRTC attempt ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!channel) return;
    webrtcConnectedRef.current = false;
    setWebrtcConnected(false);
    setHlsActive(false);

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
    const t = setTimeout(() => {
      if (!webrtcConnectedRef.current) setHlsActive(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [webrtcConnected, hlsUrl, channel]);

  // ── Build the Video.js HLS player when HLS is active ────────────────────
  useEffect(() => {
    if (!hlsActive || !hlsUrl || !hlsRef.current || !window.videojs) return;
    if (playerRef.current) {
      playerRef.current.dispose();
      playerRef.current = null;
    }
    const player = window.videojs(hlsRef.current, {
      autoplay: 'muted',
      muted: true,
      controls: false,
      preload: 'auto',
      fill: true,
      playsinline: true,
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
    player.src({ src: hlsUrl, type: 'application/x-mpegURL' });
    playerRef.current = player;

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
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
        style={{ objectFit: 'contain', display: showHls ? 'none' : 'block' }}
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
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
    </div>
  );
};

export default PartnerFeed;
