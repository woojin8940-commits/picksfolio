import React from 'react';

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
  if (!src) return null;
  const isVideo = forceVideo || isVideoSource(src);
  if (isVideo) {
    return (
      <video
        src={src}
        className={className}
        style={style}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
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
