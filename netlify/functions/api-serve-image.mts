import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import {
  ALLOWED_CONTENT_TYPES,
  PART_SIZE,
  partKey,
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

/** 요청한 구간의 시작·끝(둘 다 포함). 전체 크기를 넘지 않고 4MB 를 넘기지 않는다. */
function resolveRange(rangeHeader: string | null, total: number) {
  let start = 0;
  let end = total - 1;

  const match = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null;
  if (match) {
    if (match[1]) start = parseInt(match[1], 10);
    if (match[2]) end = parseInt(match[2], 10);
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start >= total) return null;
  if (end >= total) end = total - 1;
  // Cap the chunk so the response stays under the function payload limit.
  if (end - start + 1 > MAX_CHUNK) end = start + MAX_CHUNK - 1;
  return { start, end };
}

/**
 * 조각으로 올라온 파일에서 요청 구간만 읽어 만든다.
 *
 * 조각 업로드(api-upload-chunk)는 파일을 이어 붙이지 않는다. 그래서 여기서 구간에
 * 걸치는 조각만 골라 읽는다 — 4MB 구간이면 3MB 조각 두세 개다. 전체를 한 번 읽어
 * 잘라 내던 아래 경로와 달리, 80MB 영상이라도 한 요청이 다루는 양은 늘 10MB 안쪽이다.
 */
async function readParts(
  store: ReturnType<typeof getStore>,
  key: string,
  parts: number,
  partSize: number,
  start: number,
  end: number,
): Promise<Uint8Array | null> {
  const first = Math.floor(start / partSize);
  const last = Math.floor(end / partSize);
  if (first < 0 || last >= parts) return null;

  const out = new Uint8Array(end - start + 1);
  let written = 0;
  for (let i = first; i <= last; i += 1) {
    const raw = (await store.get(partKey(key, i), { type: "arrayBuffer" })) as ArrayBuffer | null;
    // 조각 하나가 없으면 그 구간을 만들 수 없다. 0 으로 메우면 재생이 조용히
    // 깨지므로, 여기서 실패로 돌려 404 를 내보낸다.
    if (!raw) return null;
    const bytes = new Uint8Array(raw);
    const partStart = i * partSize;
    const from = Math.max(0, start - partStart);
    const to = Math.min(bytes.byteLength, end - partStart + 1);
    if (to <= from) continue;
    out.set(bytes.subarray(from, to), written);
    written += to - from;
  }
  return written === out.byteLength ? out : out.subarray(0, written);
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
  // 조각은 내부 저장 단위다. 주소로 직접 열 자리가 아니고, 확장자가 없어 형식도
  // 정할 수 없다 — 목록표 키로만 내려준다.
  if (/\.part\d+$/.test(key)) {
    return new Response("Image not found", { status: 404 });
  }

  const store = getStore("images");
  const result = await store.getWithMetadata(key, { type: "arrayBuffer" });

  if (!result) {
    return new Response("Image not found", { status: 404 });
  }

  const contentType = safeContentType(key, result.metadata?.contentType);
  const guards = protectiveHeaders(contentType);

  /**
   * 조각으로 올라온 파일. 본문은 비어 있고 메타데이터에 조각 수와 전체 크기가 있다.
   * 브라우저는 영상을 구간으로 요청하므로, 이 경로가 곧 정상 재생 경로다.
   */
  const parts = Number(result.metadata?.parts || 0);
  if (Number.isInteger(parts) && parts > 0) {
    const total = Number(result.metadata?.size || 0);
    const partSize = Number(result.metadata?.partSize || PART_SIZE) || PART_SIZE;
    if (!total) return new Response("Image not found", { status: 404 });

    const range = resolveRange(req.headers.get("range"), total);
    if (!range) {
      return new Response("Requested range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
      });
    }

    if (req.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          ...guards,
          "Content-Type": contentType,
          "Content-Length": String(total),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    const chunk = await readParts(store, key, parts, partSize, range.start, range.end);
    if (!chunk) return new Response("Image not found", { status: 404 });

    const end = range.start + chunk.byteLength - 1;
    return new Response(chunk, {
      status: 206,
      headers: {
        ...guards,
        "Content-Type": contentType,
        "Content-Range": `bytes ${range.start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const data = result.data as ArrayBuffer;
  const total = data.byteLength;
  const isVideo = contentType.startsWith("video/");
  const rangeHeader = req.headers.get("range");

  // Serve videos (and any explicit range request) as partial content. Browsers
  // request video in ranges; responding with 206 + Accept-Ranges keeps every
  // response under the function size limit and enables smooth playback/seeking.
  if (isVideo || rangeHeader) {
    const range = resolveRange(rangeHeader, total);
    if (!range) {
      return new Response("Requested range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
      });
    }

    const chunk = data.slice(range.start, range.end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        ...guards,
        "Content-Type": contentType,
        "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(range.end - range.start + 1),
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
