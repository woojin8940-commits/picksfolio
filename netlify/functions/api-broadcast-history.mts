import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const username = pathParts[2] ? decodeURIComponent(pathParts[2]) : url.searchParams.get("username");
    const historyId = pathParts[3] ? decodeURIComponent(pathParts[3]) : null;

    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), { status: 400, headers });
    }

    const normalizedUsername = username.toLowerCase();

    if (req.method === "GET") {
      if (historyId) {
        const result = await db.sql`
          SELECT id, title, category, viewer_count, total_sales, chat_count, duration_seconds, started_at, ended_at
          FROM broadcast_history WHERE id = ${historyId} AND username = ${normalizedUsername} LIMIT 1
        `;
        return new Response(JSON.stringify(result.rows[0] || null), { headers });
      }

      const result = await db.sql`
        SELECT id, title, category, viewer_count, total_sales, chat_count, duration_seconds, started_at, ended_at, created_at
        FROM broadcast_history WHERE username = ${normalizedUsername}
        ORDER BY started_at DESC LIMIT 50
      `;
      return new Response(JSON.stringify(result.rows), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const id = body.id || Date.now().toString();
      await db.sql`
        INSERT INTO broadcast_history (id, username, title, category, viewer_count, total_sales, chat_count, duration_seconds, started_at, ended_at)
        VALUES (${id}, ${normalizedUsername}, ${body.title || ""}, ${body.category || ""}, ${body.viewer_count || 0}, ${body.total_sales || 0}, ${body.chat_count || 0}, ${body.duration_seconds || 0}, ${body.started_at || new Date().toISOString()}, ${body.ended_at || new Date().toISOString()})
      `;
      return new Response(JSON.stringify({ success: true, id }), { headers });
    }

    if (req.method === "DELETE") {
      if (historyId) {
        await db.sql`DELETE FROM broadcast_history WHERE id = ${historyId} AND username = ${normalizedUsername}`;
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Broadcast history API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/broadcast-history/*" };
