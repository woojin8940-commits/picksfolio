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
      const totalUsers = await db.sql`SELECT COUNT(*) as count FROM site_data`;
      const newUsersToday = await db.sql`SELECT COUNT(*) as count FROM site_data WHERE created_at >= CURRENT_DATE`;
      const newUsersWeek = await db.sql`SELECT COUNT(*) as count FROM site_data WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'`;
      const totalStreams = await db.sql`SELECT COUNT(*) as count FROM broadcast_history`;
      const totalProposals = await db.sql`SELECT COUNT(*) as count FROM proposals`;
      const activeStreams = await db.sql`SELECT COUNT(*) as count FROM live_sessions WHERE is_live = true`;

      const dailySignups = await db.sql`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM site_data
        WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY DATE(created_at) ORDER BY date
      `;

      return new Response(JSON.stringify({
        totalUsers: Number(totalUsers.rows[0]?.count || 0),
        newUsersToday: Number(newUsersToday.rows[0]?.count || 0),
        newUsersWeek: Number(newUsersWeek.rows[0]?.count || 0),
        totalStreams: Number(totalStreams.rows[0]?.count || 0),
        totalProposals: Number(totalProposals.rows[0]?.count || 0),
        activeStreams: Number(activeStreams.rows[0]?.count || 0),
        dailySignups: dailySignups.rows,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Admin growth API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/admin/growth" };
