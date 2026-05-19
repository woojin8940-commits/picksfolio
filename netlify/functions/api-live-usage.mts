import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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
      const currentMonth = new Date().toISOString().slice(0, 7);

      const monthStats = await db.sql`
        SELECT month, total_duration_seconds, total_streams, total_viewers, total_sales
        FROM live_usage_stats WHERE username = ${normalizedUsername}
        ORDER BY month DESC LIMIT 12
      `;

      if (monthStats.rows.length === 0) {
        const history = await db.sql`
          SELECT COUNT(*) as total_streams,
            COALESCE(SUM(duration_seconds), 0) as total_duration,
            COALESCE(MAX(viewer_count), 0) as peak_viewers,
            COALESCE(SUM(total_sales), 0) as total_sales
          FROM broadcast_history WHERE username = ${normalizedUsername}
        `;
        return new Response(JSON.stringify({
          currentMonth,
          totalStreams: Number(history.rows[0]?.total_streams || 0),
          totalDuration: Number(history.rows[0]?.total_duration || 0),
          peakViewers: Number(history.rows[0]?.peak_viewers || 0),
          totalSales: Number(history.rows[0]?.total_sales || 0),
          monthlyHistory: [],
        }), { headers });
      }

      return new Response(JSON.stringify({
        currentMonth,
        monthlyHistory: monthStats.rows,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Live usage API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/live-usage/*" };
