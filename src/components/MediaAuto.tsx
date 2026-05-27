import React, { useRef, useEffect, useState } from 'react';

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
}

const MediaAuto: React.FC<MediaAutoProps> = ({ src, className, style, alt, forceVideo }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    setVideoReady(false);
  }, [src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const tryPlay = () => {
      el.play().catch(() => {});
    };
    if (el.readyState >= 2) {
      setVideoReady(true);
      tryPlay();
      return;
    }
    const onData = () => {
      setVideoReady(true);
      tryPlay();
    };
    el.addEventListener('loadeddata', onData);
    el.load();
    return () => el.removeEventListener('loadeddata', onData);
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
        preload="metadata"
        disablePictureInPicture
        controls={false}
      />
    );
  }
  return (
    <img
      src={src}
      className={className}
      style={style}
      alt={alt}
      referrerPolicy="no-referrer"
      decoding="async"
      loading="eager"
    />
  );
};

export default MediaAuto;
