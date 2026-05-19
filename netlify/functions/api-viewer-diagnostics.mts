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
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      await db.sql`
        INSERT INTO viewer_diagnostics (id, username, viewer_id, error_type, error_message, user_agent, metadata)
        VALUES (${id}, ${normalizedUsername}, ${body.viewerId || null}, ${body.errorType || null}, ${body.errorMessage || null}, ${body.userAgent || null}, ${JSON.stringify(body.metadata || {})})
      `;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (req.method === "GET") {
      const result = await db.sql`
        SELECT id, viewer_id, error_type, error_message, user_agent, created_at
        FROM viewer_diagnostics WHERE username = ${normalizedUsername}
        ORDER BY created_at DESC LIMIT 100
      `;
      return new Response(JSON.stringify(result.rows), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Viewer diagnostics API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/viewer-diagnostics/*" };
