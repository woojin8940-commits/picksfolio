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
    const user = url.searchParams.get("user");

    if (!user) {
      return new Response(JSON.stringify({ error: "user param is required" }), { status: 400, headers });
    }

    const normalizedUser = user.toLowerCase();

    if (req.method === "GET") {
      const result = await db.sql`
        SELECT username, live_alert, order_alert, proposal_alert, phone
        FROM alimtalk_settings WHERE username = ${normalizedUser} LIMIT 1
      `;
      return new Response(JSON.stringify(result.rows[0] || { live_alert: false, order_alert: false, proposal_alert: false }), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      await db.sql`
        INSERT INTO alimtalk_settings (username, live_alert, order_alert, proposal_alert, phone)
        VALUES (${normalizedUser}, ${body.live_alert || false}, ${body.order_alert || false}, ${body.proposal_alert || false}, ${body.phone || null})
        ON CONFLICT (username) DO UPDATE SET
          live_alert = EXCLUDED.live_alert,
          order_alert = EXCLUDED.order_alert,
          proposal_alert = EXCLUDED.proposal_alert,
          phone = EXCLUDED.phone,
          updated_at = now()
      `;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Alimtalk settings API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/alimtalk-settings" };
