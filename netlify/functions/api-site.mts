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
        SELECT username, data, profile_code, is_public, created_at, updated_at
        FROM site_data
        WHERE username = ${normalizedUsername}
        LIMIT 1
      `;
      if (result.rows.length === 0) {
        return new Response(JSON.stringify(null), { headers });
      }
      return new Response(JSON.stringify(result.rows[0]), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const profileCode = body.profile_code || normalizedUsername;
      await db.sql`
        INSERT INTO site_data (username, data, profile_code, is_public)
        VALUES (${normalizedUsername}, ${JSON.stringify(body.data || body)}, ${profileCode}, ${body.is_public !== false})
        ON CONFLICT (username) DO UPDATE SET
          data = EXCLUDED.data,
          is_public = EXCLUDED.is_public,
          updated_at = now()
      `;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Site API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/site/*" };
