import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const username = pathParts[2] ? decodeURIComponent(pathParts[2]) : null;
    const recordingId = pathParts[3] ? decodeURIComponent(pathParts[3]) : null;

    if (!username || !recordingId) {
      return new Response(JSON.stringify({ error: "username and recording id are required" }), { status: 400, headers });
    }

    const store = getStore("broadcast-recordings");
    const key = `${username.toLowerCase()}/${recordingId}`;
    const metadata = await store.getMetadata(key);

    if (!metadata) {
      return new Response(JSON.stringify({ error: "Recording not found" }), { status: 404, headers });
    }

    const siteUrl = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";
    return new Response(JSON.stringify({
      url: `${siteUrl}/.netlify/blobs/${key}`,
      metadata: metadata.metadata,
    }), { headers });
  } catch (error: any) {
    console.error("Broadcast recording API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/broadcast-recording/*" };
