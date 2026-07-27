import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import {
  ALLOWED_CONTENT_TYPES,
  protectiveHeaders,
  safeExtension,
} from "./_shared/upload-media.mts";

// Netlify Functions cap the response body at ~6MB. Videos can be much larger,
// so we never return more than this per request and rely on HTTP range requests
// to deliver the rest in chunks. This is also what makes <video> seekable.
const MAX_CHUNK = 4 * 1024 * 1024;

/**
 * 내려줄 형식은 확장자를 기준으로 서버가 정한다. 블롭에 저장된 형식은 허용 목록에
 * 있는 값일 때만 참고한다 — 예전에 저장된 레코드에는 브라우저가 보낸 임의 문자열
 * (`text/html` 등)이 들어 있을 수 있고, 그대로 내려주면 우리 도메인에서 실행된다.
 */
function safeContentType(key: string, stored: unknown): string {
  const byExt = ALLOWED_CONTENT_TYPES[safeExtension(key)];
  if (byExt) return byExt;

  const declared = String(stored || "").split(";")[0].trim().toLowerCase();
  if (declared && Object.values(ALLOWED_CONTENT_TYPES).includes(declared)) return declared;

  return "application/octet-stream";
}

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

  const contentType = safeContentType(key, result.metadata?.contentType);
  const guards = protectiveHeaders(contentType);

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
        ...guards,
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
      ...guards,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};

export const config: Config = {
  path: "/api/images/*",
};
