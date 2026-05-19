import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const targetUsername = pathParts[3] ? decodeURIComponent(pathParts[3]) : null;

    if (req.method === "GET") {
      const profiles = await db.sql`SELECT username, data, is_public, created_at, updated_at FROM site_data ORDER BY updated_at DESC`;
      const influencers: any[] = [];
      const businesses: any[] = [];
      const liveCustomers: any[] = [];

      for (const row of profiles.rows) {
        const data = typeof row.data === "string" ? JSON.parse(row.data) : (row.data || {});
        const entry = {
          username: row.username,
          displayName: data.profile?.displayName || data.displayName || row.username,
          avatar: data.profile?.avatar || data.avatar || null,
          role: data.role || "influencer",
          isPublic: row.is_public,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
        if (data.role === "business") {
          businesses.push(entry);
        } else {
          influencers.push(entry);
          if (data.liveCommerce) liveCustomers.push(entry);
        }
      }

      return new Response(JSON.stringify({ influencers, businesses, liveCustomers }), { headers });
    }

    if (req.method === "PUT" && targetUsername) {
      const body = await req.json();
      const normalized = targetUsername.toLowerCase();
      const existing = await db.sql`SELECT data FROM site_data WHERE username = ${normalized} LIMIT 1`;
      if (existing.rows.length > 0) {
        const currentData = typeof existing.rows[0].data === "string" ? JSON.parse(existing.rows[0].data) : (existing.rows[0].data || {});
        const merged = { ...currentData, ...body };
        await db.sql`UPDATE site_data SET data = ${JSON.stringify(merged)}, updated_at = now() WHERE username = ${normalized}`;
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (req.method === "DELETE" && targetUsername) {
      const normalized = targetUsername.toLowerCase();
      await db.sql`DELETE FROM site_data WHERE username = ${normalized}`;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Admin influencers API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/admin/influencers/*" };
