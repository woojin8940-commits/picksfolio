import { createDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
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
    const pathParts = url.pathname.split("/").filter(Boolean);
    const username = pathParts[2] ? decodeURIComponent(pathParts[2]) : url.searchParams.get("username");

    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), { status: 400, headers });
    }

    const normalizedUsername = username.toLowerCase();

    if (req.method === "GET") {
      const session = await db.sql`
        SELECT id, username, title, category, is_live, viewer_count, total_viewers, total_sales, chat_count, started_at, ended_at
        FROM live_sessions WHERE username = ${normalizedUsername} LIMIT 1
      `;

      const store = getStore("live-state");
      let liveState: any = null;
      try {
        const stateStr = await store.get(`${normalizedUsername}/state`, { type: "text" });
        if (stateStr) liveState = JSON.parse(stateStr);
      } catch {}

      return new Response(JSON.stringify({
        session: session.rows[0] || null,
        liveState,
      }), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();

      if (body.heartbeat) {
        const store = getStore("live-state");
        const existingStr = await store.get(`${normalizedUsername}/state`, { type: "text" }).catch(() => null);
        const existing = existingStr ? JSON.parse(existingStr) : {};
        const viewers = existing.viewers || {};

        if (body.viewerId) {
          viewers[body.viewerId] = { lastSeen: Date.now(), nickname: body.nickname || "익명" };
        }

        const now = Date.now();
        const activeViewers: Record<string, any> = {};
        for (const [id, v] of Object.entries(viewers) as any) {
          if (now - v.lastSeen < 30000) activeViewers[id] = v;
        }

        await store.set(`${normalizedUsername}/state`, JSON.stringify({
          ...existing,
          viewers: activeViewers,
          viewerCount: Object.keys(activeViewers).length,
          lastHeartbeat: now,
        }));

        const viewerCount = Object.keys(activeViewers).length;
        await db.sql`
          UPDATE live_sessions SET viewer_count = ${viewerCount}, total_viewers = GREATEST(total_viewers, ${viewerCount}), updated_at = now()
          WHERE username = ${normalizedUsername}
        `;

        return new Response(JSON.stringify({
          success: true,
          viewerCount,
          chatMessages: existing.chatMessages || [],
        }), { headers });
      }

      if (body.chat) {
        const store = getStore("live-state");
        const existingStr = await store.get(`${normalizedUsername}/state`, { type: "text" }).catch(() => null);
        const existing = existingStr ? JSON.parse(existingStr) : {};
        const messages = existing.chatMessages || [];
        messages.push({
          id: Date.now().toString(),
          viewerId: body.viewerId,
          nickname: body.nickname || "익명",
          message: body.message,
          timestamp: Date.now(),
        });
        if (messages.length > 100) messages.splice(0, messages.length - 100);

        await store.set(`${normalizedUsername}/state`, JSON.stringify({ ...existing, chatMessages: messages }));

        await db.sql`
          UPDATE live_sessions SET chat_count = chat_count + 1, updated_at = now()
          WHERE username = ${normalizedUsername}
        `;

        return new Response(JSON.stringify({ success: true }), { headers });
      }

      if (body.endStream) {
        const store = getStore("live-state");
        await store.delete(`${normalizedUsername}/state`);
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Live API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/live/*" };
