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
};

export default async (req: Request, context: Context) => {
  if (req.method !== "GET") {
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
    result.metadata?.contentType ||
    CONTENT_TYPES[ext] ||
    "application/octet-stream";

  return new Response(result.data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};

export const config: Config = {
  path: "/api/images/*",
};
