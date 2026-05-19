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

    if (req.method === "POST") {
      const body = await req.json();
      const action = body.action;
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 8);

      if (action === "track-view") {
        const date = body.date || new Date().toISOString().slice(0, 10);
        await db.sql`
          INSERT INTO analytics_events (id, username, action, date, metadata)
          VALUES (${id}, ${normalizedUsername}, 'view', ${date}, ${JSON.stringify(body.metadata || {})})
        `;
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      if (action === "track-click") {
        const date = body.date || new Date().toISOString().slice(0, 10);
        await db.sql`
          INSERT INTO analytics_events (id, username, action, block_id, date, metadata)
          VALUES (${id}, ${normalizedUsername}, 'click', ${body.blockId || null}, ${date}, ${JSON.stringify(body.metadata || {})})
        `;
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
    }

    if (req.method === "GET") {
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      const type = url.searchParams.get("type");

      if (type === "stats") {
        const views = await db.sql`
          SELECT date, COUNT(*) as count FROM analytics_events
          WHERE username = ${normalizedUsername} AND action = 'view'
          AND date >= ${start || '2000-01-01'} AND date <= ${end || '2099-12-31'}
          GROUP BY date ORDER BY date
        `;
        const clicks = await db.sql`
          SELECT date, COUNT(*) as count FROM analytics_events
          WHERE username = ${normalizedUsername} AND action = 'click'
          AND date >= ${start || '2000-01-01'} AND date <= ${end || '2099-12-31'}
          GROUP BY date ORDER BY date
        `;
        return new Response(JSON.stringify({ views: views.rows, clicks: clicks.rows }), { headers });
      }

      if (type === "top-items") {
        const items = await db.sql`
          SELECT block_id, COUNT(*) as click_count FROM analytics_events
          WHERE username = ${normalizedUsername} AND action = 'click' AND block_id IS NOT NULL
          AND date >= ${start || '2000-01-01'} AND date <= ${end || '2099-12-31'}
          GROUP BY block_id ORDER BY click_count DESC LIMIT 10
        `;
        return new Response(JSON.stringify(items.rows), { headers });
      }

      const today = new Date().toISOString().slice(0, 10);
      const viewCount = await db.sql`
        SELECT COUNT(*) as count FROM analytics_events
        WHERE username = ${normalizedUsername} AND action = 'view' AND date = ${today}
      `;
      const clickCount = await db.sql`
        SELECT COUNT(*) as count FROM analytics_events
        WHERE username = ${normalizedUsername} AND action = 'click' AND date = ${today}
      `;
      return new Response(JSON.stringify({
        views: Number(viewCount.rows[0]?.count || 0),
        clicks: Number(clickCount.rows[0]?.count || 0),
      }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Analytics API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/analytics/*" };
