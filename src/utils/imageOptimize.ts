// Lightweight wrapper around the Netlify Image CDN (`/.netlify/images`).
//
// Uploaded media lives in our own Netlify Blob store and is served, full
// resolution, from `/api/images/*`. Phone photos are routinely several
// thousand pixels wide and multiple megabytes — far larger than they are
// ever displayed — which is why cover photos and product images appear
// slowly on a user's public page. Routing these same-origin assets through
// the Image CDN resizes them on demand and negotiates a modern format
// (WebP/AVIF) per request, cutting the bytes a viewer downloads by an order
// of magnitude.
//
// Remote / third-party URLs (Kakao avatars, scraped product images, Unsplash
// fallbacks, Supabase storage) are returned untouched: they are not in the
// `remote_images` allowlist, and a failed transform would break the image
// entirely — slow is better than broken.

const VIDEO_EXT_RE = /\.(mp4|webm|ogg|ogv|mov|m4v|avi|mkv)(\?.*)?$/i;

interface OptimizeOptions {
  width?: number;
  height?: number;
  quality?: number;
  fit?: 'cover' | 'contain' | 'fill';
}

export const optimizeImageUrl = (src?: string | null, opts: OptimizeOptions = {}): string => {
  if (!src) return src || '';

  // Never touch inline data, blobs, already-optimized URLs, or video sources.
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (src.includes('/.netlify/images')) return src;
  if (VIDEO_EXT_RE.test(src)) return src;

  // Only same-origin assets are safe to transform without allowlisting.
  let isLocal = false;
  if (src.startsWith('/') && !src.startsWith('//')) {
    isLocal = true;
  } else if (typeof window !== 'undefined') {
    try {
      const u = new URL(src, window.location.href);
      if (u.origin === window.location.origin) isLocal = true;
    } catch {
      /* malformed URL — leave it alone */
    }
  }
  if (!isLocal) return src;

  const { width, height, quality = 72, fit } = opts;
  const params = new URLSearchParams();
  params.set('url', src);
  if (width) params.set('w', String(width));
  if (height) params.set('h', String(height));
  if (fit) params.set('fit', fit);
  params.set('q', String(quality));
  return `/.netlify/images?${params.toString()}`;
};
