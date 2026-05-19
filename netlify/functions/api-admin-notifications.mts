import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method === "GET") {
      const result = await db.sql`
        SELECT id, type, title, message, data, is_read, created_at
        FROM admin_notifications
        ORDER BY created_at DESC LIMIT 50
      `;
      return new Response(JSON.stringify(result.rows), { headers });
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      if (body.markAllRead) {
        await db.sql`UPDATE admin_notifications SET is_read = true`;
      } else if (body.ids && Array.isArray(body.ids)) {
        for (const id of body.ids) {
          await db.sql`UPDATE admin_notifications SET is_read = true WHERE id = ${id}`;
        }
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      await db.sql`
        INSERT INTO admin_notifications (id, type, title, message, data)
        VALUES (${id}, ${body.type || "info"}, ${body.title || ""}, ${body.message || null}, ${JSON.stringify(body.data || {})})
      `;
      return new Response(JSON.stringify({ success: true, id }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Admin notifications API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/admin/notifications" };
