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
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const subPath = pathParts.slice(3).join("/");

    if (req.method === "GET") {
      if (subPath.startsWith("timeline/")) {
        const username = decodeURIComponent(pathParts[4] || "").toLowerCase();
        const entries = await db.sql`
          SELECT id, proposal_id, type, title, content, status, data, created_at
          FROM timeline_entries WHERE influencer_username = ${username}
          ORDER BY created_at DESC LIMIT 50
        `;
        return new Response(JSON.stringify(entries.rows), { headers });
      }

      const totalProposals = await db.sql`SELECT COUNT(*) as count FROM proposals`;
      const accepted = await db.sql`SELECT COUNT(*) as count FROM proposals WHERE status = 'accepted'`;
      const rejected = await db.sql`SELECT COUNT(*) as count FROM proposals WHERE status = 'rejected'`;
      const pending = await db.sql`SELECT COUNT(*) as count FROM proposals WHERE status = 'pending'`;
      const totalFee = await db.sql`SELECT COALESCE(SUM(fee), 0) as total FROM proposals WHERE status = 'accepted'`;

      const recentProposals = await db.sql`
        SELECT username, company_name, fee, status, created_at
        FROM proposals ORDER BY created_at DESC LIMIT 10
      `;

      return new Response(JSON.stringify({
        total: Number(totalProposals.rows[0]?.count || 0),
        accepted: Number(accepted.rows[0]?.count || 0),
        rejected: Number(rejected.rows[0]?.count || 0),
        pending: Number(pending.rows[0]?.count || 0),
        totalRevenue: Number(totalFee.rows[0]?.total || 0),
        recent: recentProposals.rows,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Admin proposals analytics API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/admin/proposals-analytics/*" };
