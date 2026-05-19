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
    const role = url.searchParams.get("role");

    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), {
        status: 400,
        headers,
      });
    }

    const normalizedUsername = username.toLowerCase();

    if (req.method === "GET") {
      let result;
      if (role === "influencer") {
        result = await db.sql`
          SELECT id, influencer_username, title, amount, scheduled_date, status, memo, created_at
          FROM settlements
          WHERE influencer_username = ${normalizedUsername}
          ORDER BY created_at DESC
        `;
      } else {
        result = await db.sql`
          SELECT id, influencer_username, title, amount, scheduled_date, status, memo, created_at
          FROM settlements
          WHERE username = ${normalizedUsername}
          ORDER BY created_at DESC
        `;
      }
      return new Response(JSON.stringify(result.rows), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const id = body.id || Date.now().toString();
      await db.sql`
        INSERT INTO settlements (id, username, influencer_username, title, amount, scheduled_date, status, memo)
        VALUES (${id}, ${normalizedUsername}, ${body.influencer_username}, ${body.title}, ${body.amount || 0}, ${body.scheduled_date || null}, ${body.status || "pending"}, ${body.memo || null})
        ON CONFLICT (id) DO UPDATE SET
          influencer_username = EXCLUDED.influencer_username,
          title = EXCLUDED.title,
          amount = EXCLUDED.amount,
          scheduled_date = EXCLUDED.scheduled_date,
          status = EXCLUDED.status,
          memo = EXCLUDED.memo,
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
        UPDATE settlements SET status = ${body.status}, updated_at = now()
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
        DELETE FROM settlements WHERE id = ${id} AND username = ${normalizedUsername}
      `;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  } catch (error: any) {
    console.error("Settlements API error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers }
    );
  }
};

export const config = { path: ["/api/settlements", "/api/settlements/:username"] };
