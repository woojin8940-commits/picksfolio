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
    const pathParts = url.pathname.split("/").filter(Boolean);
    const username = (pathParts[0] === "api" && pathParts[2]) ? decodeURIComponent(pathParts[2]) : url.searchParams.get("username");

    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), {
        status: 400,
        headers,
      });
    }

    const normalizedUsername = username.toLowerCase();

    if (req.method === "GET") {
      const result = await db.sql`
        SELECT id, title, company_name, description, fee, start_date, end_date, status, contact_email, created_at
        FROM proposals
        WHERE username = ${normalizedUsername}
        ORDER BY created_at DESC
      `;
      return new Response(JSON.stringify(result.rows), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const id = body.id || Date.now().toString();
      await db.sql`
        INSERT INTO proposals (id, username, title, company_name, description, fee, start_date, end_date, status, contact_email)
        VALUES (${id}, ${normalizedUsername}, ${body.title}, ${body.company_name}, ${body.description || null}, ${body.fee || 0}, ${body.start_date || null}, ${body.end_date || null}, ${body.status || "pending"}, ${body.contact_email || null})
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          company_name = EXCLUDED.company_name,
          description = EXCLUDED.description,
          fee = EXCLUDED.fee,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date,
          status = EXCLUDED.status,
          contact_email = EXCLUDED.contact_email,
          updated_at = now()
      `;
      return new Response(JSON.stringify({ success: true, id }), { headers });
    }

    if (req.method === "PUT") {
      const body = await req.json();
      if (!body.id) {
        return new Response(JSON.stringify({ error: "id is required" }), {
          status: 400,
          headers,
        });
      }
      await db.sql`
        UPDATE proposals SET status = ${body.status}, updated_at = now()
        WHERE id = ${body.id} AND username = ${normalizedUsername}
      `;
      return new Response(JSON.stringify({ success: true }), { headers });
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
        DELETE FROM proposals WHERE id = ${id} AND username = ${normalizedUsername}
      `;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  } catch (error: any) {
    console.error("Proposals API error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers }
    );
  }
};

export const config = { path: ["/api/proposals", "/api/proposals/:username", "/api/proposals/:username/:id"] };
