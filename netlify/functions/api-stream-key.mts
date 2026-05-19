import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const username = pathParts[2] ? decodeURIComponent(pathParts[2]) : url.searchParams.get("username");

    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), { status: 400, headers });
    }

    const normalizedUsername = username.toLowerCase();

    if (req.method === "GET") {
      const result = await db.sql`
        SELECT username, stream_key, ingest_url, playback_url, channel_arn
        FROM stream_keys WHERE username = ${normalizedUsername} LIMIT 1
      `;
      return new Response(JSON.stringify(result.rows[0] || null), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      await db.sql`
        INSERT INTO stream_keys (username, stream_key, ingest_url, playback_url, channel_arn)
        VALUES (${normalizedUsername}, ${body.stream_key || null}, ${body.ingest_url || null}, ${body.playback_url || null}, ${body.channel_arn || null})
        ON CONFLICT (username) DO UPDATE SET
          stream_key = EXCLUDED.stream_key,
          ingest_url = EXCLUDED.ingest_url,
          playback_url = EXCLUDED.playback_url,
          channel_arn = EXCLUDED.channel_arn,
          updated_at = now()
      `;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Stream key API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/stream-key/*" };
