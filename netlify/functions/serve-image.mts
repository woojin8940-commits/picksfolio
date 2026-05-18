import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

export const config = {
  path: "/api/images/*",
};

export default async (req: Request, context: Context) => {
  try {
    const url = new URL(req.url);
    const key = url.pathname.replace("/api/images/", "");

    if (!key) {
      return new Response("Not found", { status: 404 });
    }

    const store = getStore("portfolio-images");
    const blob = await store.getWithMetadata(key);

    if (!blob || !blob.data) {
      return new Response("Image not found", { status: 404 });
    }

    const contentType =
      (blob.metadata as any)?.contentType || "application/octet-stream";

    return new Response(blob.data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    console.error("Image serve error:", error);
    return new Response("Internal server error", { status: 500 });
  }
};
