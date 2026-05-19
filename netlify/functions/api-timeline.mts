import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const action = pathParts[2] || "";
    const param = pathParts[3] ? decodeURIComponent(pathParts[3]) : null;

    if (action === "magic-login" && req.method === "POST") {
      const body = await req.json();
      const token = body.token;
      if (!token) {
        return new Response(JSON.stringify({ error: "Token required" }), { status: 400, headers });
      }
      return new Response(JSON.stringify({ success: true, valid: true }), { headers });
    }

    if (action === "create" && req.method === "POST" && param) {
      const body = await req.json();
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      await db.sql`
        INSERT INTO timeline_entries (id, proposal_id, influencer_username, business_username, type, title, content, data)
        VALUES (${id}, ${param}, ${body.influencerUsername || ""}, ${body.businessUsername || ""}, ${body.type || "proposal"}, ${body.title || ""}, ${body.content || ""}, ${JSON.stringify(body.data || {})})
      `;
      return new Response(JSON.stringify({ success: true, id }), { headers });
    }

    if (action === "list" && req.method === "GET" && param) {
      const type = url.searchParams.get("type") || "all";
      let entries;
      if (type === "all") {
        entries = await db.sql`
          SELECT id, proposal_id, influencer_username, business_username, type, title, content, status, data, created_at
          FROM timeline_entries WHERE influencer_username = ${param.toLowerCase()} OR business_username = ${param.toLowerCase()}
          ORDER BY created_at DESC LIMIT 50
        `;
      } else {
        entries = await db.sql`
          SELECT id, proposal_id, influencer_username, business_username, type, title, content, status, data, created_at
          FROM timeline_entries
          WHERE (influencer_username = ${param.toLowerCase()} OR business_username = ${param.toLowerCase()})
            AND type = ${type}
          ORDER BY created_at DESC LIMIT 50
        `;
      }
      return new Response(JSON.stringify(entries.rows), { headers });
    }

    if (action === "detail" && req.method === "GET" && param) {
      const entry = await db.sql`
        SELECT id, proposal_id, influencer_username, business_username, type, title, content, status, data, created_at, updated_at
        FROM timeline_entries WHERE id = ${param} LIMIT 1
      `;
      if (entry.rows.length === 0) {
        return new Response(JSON.stringify(null), { headers });
      }

      const comments = await db.sql`
        SELECT id, author_type, author_name, author_username, content, created_at
        FROM timeline_comments WHERE proposal_id = ${entry.rows[0].proposal_id || param}
        ORDER BY created_at ASC
      `;
      return new Response(JSON.stringify({ ...entry.rows[0], comments: comments.rows }), { headers });
    }

    if (action === "read" && req.method === "PATCH" && param) {
      const body = await req.json();
      await db.sql`UPDATE timeline_entries SET status = 'read', updated_at = now() WHERE id = ${param}`;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    if (action === "comment" && req.method === "POST" && param) {
      const body = await req.json();
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      await db.sql`
        INSERT INTO timeline_comments (id, proposal_id, author_type, author_name, author_username, content)
        VALUES (${id}, ${param}, ${body.authorType || "influencer"}, ${body.authorName || ""}, ${body.authorUsername || ""}, ${body.content || ""})
      `;
      return new Response(JSON.stringify({ success: true, id }), { headers });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers });
  } catch (error: any) {
    console.error("Timeline API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/timeline/*" };
