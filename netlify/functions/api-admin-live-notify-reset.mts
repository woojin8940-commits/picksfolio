import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method === "POST") {
      const deleted = await db.sql`DELETE FROM live_notify_subscriptions RETURNING id`;
      return new Response(JSON.stringify({
        ok: true,
        removedKeys: deleted.rows.length,
        removedSubscribers: deleted.rows.length,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Admin live notify reset API error:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/admin/live-notify/reset" };
