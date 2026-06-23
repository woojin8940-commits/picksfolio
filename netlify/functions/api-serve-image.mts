import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  pdf: "application/pdf",
  // Video types so uploaded clips are served with the correct content type and
  // can be played back (range requests below keep each response small).
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  ogv: "video/ogg",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

// Netlify Functions cap the response body at ~6MB. Videos can be much larger,
// so we never return more than this per request and rely on HTTP range requests
// to deliver the rest in chunks. This is also what makes <video> seekable.
const MAX_CHUNK = 4 * 1024 * 1024;

export default async (req: Request, context: Context) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const key = url.pathname.replace(/^\/api\/images\//, "");

  if (!key) {
    return new Response("Missing image key", { status: 400 });
  }

  const store = getStore("images");
  const result = await store.getWithMetadata(key, { type: "arrayBuffer" });

  if (!result) {
    return new Response("Image not found", { status: 404 });
  }

  const ext = key.split(".").pop()?.toLowerCase() || "";
  const contentType =
    (result.metadata?.contentType as string) ||
    CONTENT_TYPES[ext] ||
    "application/octet-stream";

  const data = result.data as ArrayBuffer;
  const total = data.byteLength;
  const isVideo = contentType.startsWith("video/");
  const rangeHeader = req.headers.get("range");

  // Serve videos (and any explicit range request) as partial content. Browsers
  // request video in ranges; responding with 206 + Accept-Ranges keeps every
  // response under the function size limit and enables smooth playback/seeking.
  if (isVideo || rangeHeader) {
    let start = 0;
    let end = total - 1;

    const match = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null;
    if (match) {
      if (match[1]) start = parseInt(match[1], 10);
      if (match[2]) end = parseInt(match[2], 10);
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start >= total) {
      return new Response("Requested range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
      });
    }

    if (end >= total) end = total - 1;
    // Cap the chunk so the response stays under the function payload limit.
    if (end - start + 1 > MAX_CHUNK) end = start + MAX_CHUNK - 1;

    const chunk = data.slice(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};

export const config: Config = {
  path: "/api/images/*",
};
