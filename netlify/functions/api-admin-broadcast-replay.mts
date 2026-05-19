import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const username = pathParts[3] ? decodeURIComponent(pathParts[3]) : null;

    if (req.method === "GET" && username) {
      const result = await db.sql`
        SELECT id, title, thumbnail_url, video_url, duration_seconds, viewer_count, created_at
        FROM broadcast_replays WHERE username = ${username.toLowerCase()}
        ORDER BY created_at DESC LIMIT 20
      `;
      return new Response(JSON.stringify(result.rows), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Admin broadcast replay API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/admin/broadcast-replay/*" };
