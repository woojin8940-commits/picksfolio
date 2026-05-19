import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method === "GET") {
      const totalSettlements = await db.sql`SELECT COUNT(*) as count FROM settlements`;
      const pending = await db.sql`SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM settlements WHERE status = 'pending'`;
      const completed = await db.sql`SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM settlements WHERE status = 'completed'`;

      const recentSettlements = await db.sql`
        SELECT id, username, influencer_username, title, amount, status, scheduled_date, created_at
        FROM settlements ORDER BY created_at DESC LIMIT 20
      `;

      return new Response(JSON.stringify({
        total: Number(totalSettlements.rows[0]?.count || 0),
        pendingCount: Number(pending.rows[0]?.count || 0),
        pendingAmount: Number(pending.rows[0]?.total || 0),
        completedCount: Number(completed.rows[0]?.count || 0),
        completedAmount: Number(completed.rows[0]?.total || 0),
        recent: recentSettlements.rows,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Admin settlements overview API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/admin/settlements-overview" };
