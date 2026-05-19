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
      const orders = body.orders || [];

      if (!username || orders.length === 0) {
        return new Response(JSON.stringify({ error: "username and orders are required" }), { status: 400, headers });
      }

      let totalBatchAmount = 0;
      for (const order of orders) {
        const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
        const items = order.items || [];
        const totalAmount = items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0);
        totalBatchAmount += totalAmount;

        await db.sql`
          INSERT INTO live_orders (id, username, viewer_id, viewer_name, viewer_phone, items, total_amount, status, address, memo)
          VALUES (${id}, ${username}, ${order.viewerId || null}, ${order.viewerName || null}, ${order.viewerPhone || null}, ${JSON.stringify(items)}, ${totalAmount}, 'completed', ${order.address || null}, ${order.memo || null})
        `;
      }

      await db.sql`
        UPDATE live_sessions SET total_sales = total_sales + ${totalBatchAmount}, updated_at = now()
        WHERE username = ${username}
      `;

      return new Response(JSON.stringify({ success: true, processedCount: orders.length, totalAmount: totalBatchAmount }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Live order batch API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/live-order-batch" };
