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
        SELECT id, name, price, image, link, sort_order FROM live_products
        WHERE username = ${normalizedUsername}
        ORDER BY sort_order ASC, created_at DESC
      `;
      return new Response(JSON.stringify(result.rows), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const products = Array.isArray(body) ? body : body.products || [];

      await db.sql`DELETE FROM live_products WHERE username = ${normalizedUsername}`;

      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const id = p.id || Date.now().toString() + i;
        await db.sql`
          INSERT INTO live_products (id, username, name, price, image, link, sort_order)
          VALUES (${id}, ${normalizedUsername}, ${p.name || ""}, ${p.price || 0}, ${p.image || null}, ${p.link || null}, ${i})
        `;
      }

      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Live products API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/live-products/*" };
