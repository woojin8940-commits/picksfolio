import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const subPath = pathParts.slice(3).join("/");

    if (req.method === "GET") {
      if (subPath === "usage") {
        const result = await db.sql`
          SELECT username, COUNT(*) as total_streams,
            SUM(duration_seconds) as total_duration,
            SUM(total_sales) as total_sales,
            MAX(viewer_count) as peak_viewers
          FROM broadcast_history
          GROUP BY username ORDER BY total_streams DESC
        `;
        return new Response(JSON.stringify(result.rows), { headers });
      }

      if (subPath === "moderation") {
        const result = await db.sql`
          SELECT ls.username, ls.title, ls.viewer_count, ls.started_at,
            ls.is_live, ls.chat_count
          FROM live_sessions ls WHERE ls.is_live = true
          ORDER BY ls.viewer_count DESC
        `;
        return new Response(JSON.stringify(result.rows), { headers });
      }

      if (subPath.includes("/end")) {
        const targetUser = decodeURIComponent(pathParts[3] || "").toLowerCase();
        await db.sql`UPDATE live_sessions SET is_live = false, ended_at = now(), updated_at = now() WHERE username = ${targetUser}`;
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      if (subPath.includes("/highlight")) {
        const targetUser = decodeURIComponent(pathParts[3] || "").toLowerCase();
        const history = await db.sql`
          SELECT id, title, viewer_count, total_sales, duration_seconds, started_at
          FROM broadcast_history WHERE username = ${targetUser}
          ORDER BY viewer_count DESC LIMIT 5
        `;
        return new Response(JSON.stringify(history.rows), { headers });
      }

      const limit = parseInt(url.searchParams.get("limit") || "20", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const status = url.searchParams.get("status");

      let sessions;
      if (status === "live") {
        sessions = await db.sql`
          SELECT username, title, category, is_live, viewer_count, total_viewers, total_sales, chat_count, started_at
          FROM live_sessions WHERE is_live = true
          ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        sessions = await db.sql`
          SELECT username, title, category, is_live, viewer_count, total_viewers, total_sales, chat_count, started_at, ended_at
          FROM live_sessions
          ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}
        `;
      }

      return new Response(JSON.stringify(sessions.rows), { headers });
    }

    if (req.method === "POST" && subPath === "moderation") {
      const body = await req.json();
      if (body.action === "end-stream" && body.username) {
        const u = body.username.toLowerCase();
        await db.sql`UPDATE live_sessions SET is_live = false, ended_at = now(), updated_at = now() WHERE username = ${u}`;
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Admin live overview API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/admin/live-overview/*" };
