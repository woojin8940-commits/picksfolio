import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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
    const viewerId = url.searchParams.get("viewerId");

    if (req.method === "GET") {
      if (!viewerId) {
        const result = await db.sql`
          SELECT id, viewer_id, product_id, product_name, product_price, product_image, quantity
          FROM live_cart_items WHERE username = ${normalizedUsername}
          ORDER BY created_at DESC
        `;
        return new Response(JSON.stringify(result.rows), { headers });
      }
      const result = await db.sql`
        SELECT id, product_id, product_name, product_price, product_image, quantity
        FROM live_cart_items
        WHERE username = ${normalizedUsername} AND viewer_id = ${viewerId}
        ORDER BY created_at DESC
      `;
      return new Response(JSON.stringify(result.rows), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      await db.sql`
        INSERT INTO live_cart_items (id, username, viewer_id, product_id, product_name, product_price, product_image, quantity)
        VALUES (${id}, ${normalizedUsername}, ${body.viewerId}, ${body.productId}, ${body.productName || ""}, ${body.productPrice || 0}, ${body.productImage || null}, ${body.quantity || 1})
      `;
      return new Response(JSON.stringify({ success: true, id }), { headers });
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      if (body.id && body.quantity !== undefined) {
        await db.sql`
          UPDATE live_cart_items SET quantity = ${body.quantity}, updated_at = now()
          WHERE id = ${body.id} AND username = ${normalizedUsername}
        `;
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      if (body.id) {
        await db.sql`DELETE FROM live_cart_items WHERE id = ${body.id} AND username = ${normalizedUsername}`;
      } else if (body.viewerId) {
        await db.sql`DELETE FROM live_cart_items WHERE username = ${normalizedUsername} AND viewer_id = ${body.viewerId}`;
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Live cart API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/live-cart/*" };
