import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

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
    const participantId = url.searchParams.get("participantId");
    const since = url.searchParams.get("since");

    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), { status: 400, headers });
    }

    const normalizedUsername = username.toLowerCase();
    const store = getStore("signal-messages");

    if (req.method === "GET") {
      const key = `${normalizedUsername}/messages`;
      const dataStr = await store.get(key, { type: "text" }).catch(() => null);
      let messages: any[] = dataStr ? JSON.parse(dataStr) : [];

      if (participantId) {
        messages = messages.filter((m: any) => m.to === participantId || m.to === "all");
      }
      if (since) {
        const sinceTs = parseInt(since, 10);
        messages = messages.filter((m: any) => m.timestamp > sinceTs);
      }

      return new Response(JSON.stringify(messages), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const key = `${normalizedUsername}/messages`;
      const dataStr = await store.get(key, { type: "text" }).catch(() => null);
      let messages: any[] = dataStr ? JSON.parse(dataStr) : [];

      messages.push({
        id: Date.now().toString(),
        from: body.from || body.participantId,
        to: body.to || "all",
        type: body.type || "signal",
        data: body.data || body.signal,
        timestamp: Date.now(),
      });

      const cutoff = Date.now() - 60000;
      messages = messages.filter((m: any) => m.timestamp > cutoff);

      await store.set(key, JSON.stringify(messages));
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Signal API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/signal/*" };
