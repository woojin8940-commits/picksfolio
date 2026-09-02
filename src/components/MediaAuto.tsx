import React, { useRef, useEffect, useState } from 'react';
import { optimizeImageUrl } from '../utils/imageOptimize';

const VIDEO_EXT_RE = /\.(mp4|webm|ogg|ogv|mov|m4v|avi|mkv)(\?.*)?$/i;

export const isVideoSource = (src?: string | null): boolean => {
  if (!src) return false;
  if (src.startsWith('data:video/')) return true;
  if (src.startsWith('blob:')) return false;
  try {
    const url = new URL(src, typeof window !== 'undefined' ? window.location.href : 'http://x');
    if (VIDEO_EXT_RE.test(url.pathname)) return true;
    const ct = url.searchParams.get('contentType') || url.searchParams.get('content-type');
    if (ct && ct.startsWith('video/')) return true;
  } catch {
    if (VIDEO_EXT_RE.test(src)) return true;
  }
  return false;
};

interface MediaAutoProps {
  src?: string;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
  forceVideo?: boolean;
  // Above-the-fold media (e.g. the page cover) should load eagerly with high
  // priority so it paints first. Everything else defaults to lazy loading so
  // it doesn't compete with the cover for bandwidth.
  priority?: boolean;
  // Target render width in CSS px; used to size the on-demand image transform.
  width?: number;
  /**
   * Cross-fade the image in once it has decoded, instead of letting it snap
   * over whatever was painted underneath.
   *
   * Only worth it where the element underneath is a placeholder the visitor
   * will notice being replaced — the page cover. A thumbnail in a grid is
   * small and arrives with dozens of siblings, so fading each one in just
   * makes the grid shimmer. Off by default for that reason.
   */
  fadeIn?: boolean;
}

const MediaAuto: React.FC<MediaAutoProps> = ({ src, className, style, alt, forceVideo, priority, width, fadeIn }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgReady, setImgReady] = useState(false);

  useEffect(() => {
    setVideoReady(false);
  }, [src]);

  useEffect(() => {
    setImgReady(false);
  }, [src]);

  // A cached image can finish decoding before React attaches onLoad, which
  // would leave it faded out forever. `complete` is the only reliable check
  // for that case, and it has to run after the ref exists.
  useEffect(() => {
    if (!fadeIn) return;
    if (imgRef.current?.complete) setImgReady(true);
  }, [fadeIn, src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      setVideoReady(true);
    };
    const tryPlay = () => {
      el.play().catch(() => {});
    };
    const onReady = () => {
      reveal();
      tryPlay();
    };

    // Reveal on the earliest signal that a frame/metadata is available. Relying
    // on a single 'loadeddata' event sometimes left covers/videos permanently
    // hidden (event fired before the listener attached, or never fired).
    const readyEvents = ['loadeddata', 'loadedmetadata', 'canplay', 'canplaythrough', 'playing'];
    readyEvents.forEach(ev => el.addEventListener(ev, onReady));

    // If the source fails to load, reveal the element instead of keeping it invisible.
    const onError = () => reveal();
    el.addEventListener('error', onError);

    // Already buffered (e.g. served from cache) — show immediately. Otherwise
    // explicitly kick off loading.
    if (el.readyState >= 2) {
      onReady();
    } else {
      try { el.load(); } catch { /* ignore */ }
    }
    tryPlay();

    // Safety net: a slow or missed readiness event must never leave the media
    // hidden forever — reveal regardless after a short grace period.
    const fallbackTimer = setTimeout(reveal, 2500);

    return () => {
      clearTimeout(fallbackTimer);
      readyEvents.forEach(ev => el.removeEventListener(ev, onReady));
      el.removeEventListener('error', onError);
    };
  }, [src]);

  if (!src) return null;
  const isVideo = forceVideo || isVideoSource(src);
  if (isVideo) {
    return (
      <video
        ref={videoRef}
        src={src}
        className={className}
        style={{ ...style, opacity: videoReady ? 1 : 0, transition: 'opacity 0.3s ease' }}
        autoPlay
        loop
        muted
        playsInline
        preload={priority ? 'auto' : 'metadata'}
        disablePictureInPicture
        controls={false}
      />
    );
  }
  return (
    <img
      ref={imgRef}
      src={optimizeImageUrl(src, { width: width ?? 1280 })}
      className={className}
      style={
        fadeIn
          ? { ...style, opacity: imgReady ? 1 : 0, transition: 'opacity 0.35s ease' }
          : style
      }
      alt={alt}
      referrerPolicy="no-referrer"
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      // A broken image reveals too. Staying at opacity 0 would hide the
      // browser's own broken-image state and look like an empty cover.
      onLoad={fadeIn ? () => setImgReady(true) : undefined}
      onError={fadeIn ? () => setImgReady(true) : undefined}
    />
  );
};

export default MediaAuto;
