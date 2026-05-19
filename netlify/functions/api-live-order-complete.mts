import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method === "POST") {
      const body = await req.json();
      const username = body.username?.toLowerCase();

      if (!username) {
        return new Response(JSON.stringify({ error: "username is required" }), { status: 400, headers });
      }

      const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      const items = body.items || [];
      const totalAmount = items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0);

      await db.sql`
        INSERT INTO live_orders (id, username, viewer_id, viewer_name, viewer_phone, items, total_amount, status, address, memo)
        VALUES (${id}, ${username}, ${body.viewerId || null}, ${body.viewerName || null}, ${body.viewerPhone || null}, ${JSON.stringify(items)}, ${totalAmount}, 'completed', ${body.address || null}, ${body.memo || null})
      `;

      await db.sql`
        UPDATE live_sessions SET total_sales = total_sales + ${totalAmount}, updated_at = now()
        WHERE username = ${username}
      `;

      return new Response(JSON.stringify({ success: true, orderId: id, totalAmount }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Live order complete API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/live-order-complete" };
