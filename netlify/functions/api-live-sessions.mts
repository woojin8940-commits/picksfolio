import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const username = (pathParts[0] === "api" && pathParts[2]) ? decodeURIComponent(pathParts[2]) : url.searchParams.get("username");
    const action = url.searchParams.get("action");

    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), {
        status: 400,
        headers,
      });
    }

    const normalizedUsername = username.toLowerCase();

    if (req.method === "GET") {
      const session = await db.sql`
        SELECT id, username, title, category, is_live, viewer_count, total_viewers, total_sales, chat_count, started_at, ended_at
        FROM live_sessions
        WHERE username = ${normalizedUsername}
        LIMIT 1
      `;

      const history = await db.sql`
        SELECT id, title, category, viewer_count, total_sales, chat_count, duration_seconds, started_at, ended_at
        FROM broadcast_history
        WHERE username = ${normalizedUsername}
        ORDER BY started_at DESC
        LIMIT 20
      `;

      return new Response(
        JSON.stringify({
          session: session.rows[0] || null,
          history: history.rows,
        }),
        { headers }
      );
    }

    if (req.method === "POST") {
      const body = await req.json();

      if (action === "start") {
        const id = Date.now().toString();
        await db.sql`
          INSERT INTO live_sessions (id, username, title, category, is_live, viewer_count, started_at)
          VALUES (${id}, ${normalizedUsername}, ${body.title || ""}, ${body.category || ""}, true, 0, now())
          ON CONFLICT (username) DO UPDATE SET
            title = EXCLUDED.title,
            category = EXCLUDED.category,
            is_live = true,
            viewer_count = 0,
            started_at = now(),
            ended_at = NULL,
            updated_at = now()
        `;
        return new Response(JSON.stringify({ success: true, id }), { headers });
      }

      if (action === "stop") {
        const session = await db.sql`
          SELECT id, title, category, viewer_count, total_viewers, total_sales, chat_count, started_at
          FROM live_sessions
          WHERE username = ${normalizedUsername} AND is_live = true
          LIMIT 1
        `;

        if (session.rows[0]) {
          const s = session.rows[0];
          const startedAt = new Date(s.started_at as string);
          const duration = Math.floor(
            (Date.now() - startedAt.getTime()) / 1000
          );

          await db.sql`
            INSERT INTO broadcast_history (id, username, title, category, viewer_count, total_sales, chat_count, duration_seconds, started_at, ended_at)
            VALUES (${Date.now().toString()}, ${normalizedUsername}, ${s.title}, ${s.category}, ${s.total_viewers || 0}, ${s.total_sales || 0}, ${s.chat_count || 0}, ${duration}, ${s.started_at}, now())
          `;
        }

        await db.sql`
          UPDATE live_sessions SET is_live = false, viewer_count = 0, ended_at = now(), updated_at = now()
          WHERE username = ${normalizedUsername}
        `;
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      if (action === "update") {
        const updates: string[] = [];
        if (body.viewer_count !== undefined) {
          await db.sql`
            UPDATE live_sessions SET viewer_count = ${body.viewer_count}, total_viewers = GREATEST(total_viewers, ${body.viewer_count}), updated_at = now()
            WHERE username = ${normalizedUsername}
          `;
        }
        if (body.chat_count !== undefined) {
          await db.sql`
            UPDATE live_sessions SET chat_count = chat_count + 1, updated_at = now()
            WHERE username = ${normalizedUsername}
          `;
        }
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      if (action === "save-settings") {
        const id = Date.now().toString();
        await db.sql`
          INSERT INTO live_sessions (id, username, title, category, is_live)
          VALUES (${id}, ${normalizedUsername}, ${body.title || ""}, ${body.category || ""}, false)
          ON CONFLICT (username) DO UPDATE SET
            title = EXCLUDED.title,
            category = EXCLUDED.category,
            updated_at = now()
        `;
        return new Response(JSON.stringify({ success: true }), { headers });
      }
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  } catch (error: any) {
    console.error("Live sessions API error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers }
    );
  }
};

export const config = { path: ["/api/live-sessions", "/api/live-sessions/:username"] };
