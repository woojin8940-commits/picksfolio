import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { mapConcurrent } from "./_shared/concurrency.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

interface DayData {
  views: number;
  visitors: string[];
  clicks: number;
  blockClicks: Record<string, number>;
  referrers: Record<string, number>;
}

function emptyDay(): DayData {
  return { views: 0, visitors: [], clicks: 0, blockClicks: {}, referrers: {} };
}

function dayKey(username: string, date: string): string {
  return `analytics_${username}_${date}`;
}

function dateRange(start: string, end: string): string[] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return null;
  if (endMs - startMs > 366 * 24 * 60 * 60 * 1000) return null;
  const dates: string[] = [];
  const cur = new Date(startMs);
  const last = new Date(endMs);
  while (cur <= last) {
    dates.push(cur.toISOString().split("T")[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username || !/^[a-z0-9_]{3,20}$/.test(username)) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("analytics");

  if (req.method === "GET") {
    const auth = await requireAccountOwner(req, username);
    if (!auth.ok) return auth.response;
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");

    if ((type === "stats" || type === "top-items" || type === "summary") && start && end) {
      const dates = dateRange(start, end);
      if (!dates) return Response.json({ error: "Invalid date range" }, { status: 400 });
      let totalViews = 0;
      let totalClicks = 0;
      const merged: Record<string, number> = {};
      const days = await mapConcurrent(dates, 8, date =>
        store.get(dayKey(username, date), { type: "json" }) as Promise<DayData | null>,
      );
      for (const data of days) {
        if (data) {
          totalViews += data.views || 0;
          totalClicks += data.clicks || 0;
        }
        if (data?.blockClicks) {
          for (const [blockId, count] of Object.entries(data.blockClicks)) {
            merged[blockId] = (merged[blockId] || 0) + (count as number);
          }
        }
      }

      const topItems = Object.entries(merged)
        .map(([blockId, clicks]) => ({ blockId, clicks }))
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 10);

      const ctr = totalViews > 0 ? Math.round((totalClicks / totalViews) * 100) : 0;
      const stats = { views: totalViews, clicks: totalClicks, ctr };
      if (type === "stats") return Response.json(stats);
      if (type === "top-items") return Response.json({ topItems });
      return Response.json({ ...stats, topItems });
    }

    const key = dayKey(username, new Date().toISOString().split("T")[0]);
    const data = await store.get(key, { type: "json" });
    return Response.json(data || emptyDay());
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (action !== "track-view" && action !== "track-click") {
      return Response.json({ error: "Invalid action" }, { status: 400 });
    }
    const blockId = String(body.blockId || "");
    if (action === "track-click" && !/^[a-zA-Z0-9_-]{1,100}$/.test(blockId)) {
      return Response.json({ error: "Invalid blockId" }, { status: 400 });
    }
    const visitorId = String(body.visitorId || "").slice(0, 100);
    const date = new Date().toISOString().split("T")[0];
    const key = dayKey(username, date);

    await mutateBlobJSON<DayData>("analytics", key, (current) => {
      const existing = current || emptyDay();
      if (action === "track-click") {
        existing.clicks = (existing.clicks || 0) + 1;
        existing.blockClicks = existing.blockClicks || {};
        existing.blockClicks[blockId] = (existing.blockClicks[blockId] || 0) + 1;
      } else {
        existing.views = (existing.views || 0) + 1;
        if (visitorId) {
          existing.visitors = existing.visitors || [];
          if (existing.visitors.length < 10000 && !existing.visitors.includes(visitorId)) {
            existing.visitors.push(visitorId);
          }
        }
      }
      return existing;
    });
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/analytics/:username",
  rateLimit: { windowSize: 60, windowLimit: 300, aggregateBy: "ip" },
};
