import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const influencer = url.searchParams.get("influencer");

    if (!influencer) {
      return new Response(JSON.stringify({ error: "influencer param is required" }), { status: 400, headers });
    }

    const normalizedInfluencer = influencer.toLowerCase();

    if (req.method === "GET") {
      const result = await db.sql`
        SELECT id, phone, nickname, created_at
        FROM live_notify_subscriptions WHERE influencer_username = ${normalizedInfluencer}
        ORDER BY created_at DESC
      `;
      return new Response(JSON.stringify(result.rows), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      if (!body.phone) {
        return new Response(JSON.stringify({ error: "phone is required" }), { status: 400, headers });
      }
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      await db.sql`
        INSERT INTO live_notify_subscriptions (id, influencer_username, phone, nickname)
        VALUES (${id}, ${normalizedInfluencer}, ${body.phone}, ${body.nickname || null})
        ON CONFLICT (influencer_username, phone) DO UPDATE SET nickname = EXCLUDED.nickname
      `;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (req.method === "DELETE") {
      const body = await req.json();
      if (body.phone) {
        await db.sql`DELETE FROM live_notify_subscriptions WHERE influencer_username = ${normalizedInfluencer} AND phone = ${body.phone}`;
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Live notify API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/live-notify" };
