import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const username = url.searchParams.get("username");

    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), {
        status: 400,
        headers,
      });
    }

    const normalizedUsername = username.toLowerCase();

    if (req.method === "GET") {
      const result = await db.sql`
        SELECT id, title, company_name, type, fee, date, end_date, start_date, status, memo, created_at
        FROM collabs
        WHERE username = ${normalizedUsername}
        ORDER BY created_at DESC
      `;
      return new Response(JSON.stringify(result.rows), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const id = body.id || Date.now().toString();
      await db.sql`
        INSERT INTO collabs (id, username, title, company_name, type, fee, date, end_date, start_date, status, memo)
        VALUES (${id}, ${normalizedUsername}, ${body.title}, ${body.company_name}, ${body.type || "광고"}, ${body.fee || 0}, ${body.date}, ${body.end_date || body.date}, ${body.start_date || body.date}, ${body.status || "scheduled"}, ${body.memo || null})
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          company_name = EXCLUDED.company_name,
          type = EXCLUDED.type,
          fee = EXCLUDED.fee,
          date = EXCLUDED.date,
          end_date = EXCLUDED.end_date,
          start_date = EXCLUDED.start_date,
          status = EXCLUDED.status,
          memo = EXCLUDED.memo,
          updated_at = now()
      `;
      return new Response(JSON.stringify({ success: true, id }), { headers });
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) {
        return new Response(JSON.stringify({ error: "id is required" }), {
          status: 400,
          headers,
        });
      }
      await db.sql`
        DELETE FROM collabs WHERE id = ${id} AND username = ${normalizedUsername}
      `;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  } catch (error: any) {
    console.error("Collabs API error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers }
    );
  }
};
