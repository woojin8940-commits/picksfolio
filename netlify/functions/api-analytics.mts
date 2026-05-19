import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

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

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (cur <= last) {
    dates.push(cur.toISOString().split("T")[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("analytics");

  if (req.method === "GET") {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");

    if (type === "stats" && start && end) {
      const dates = dateRange(start, end);
      let totalViews = 0;
      let totalClicks = 0;

      for (const date of dates) {
        const data = (await store.get(dayKey(username, date), { type: "json" })) as DayData | null;
        if (data) {
          totalViews += data.views || 0;
          totalClicks += data.clicks || 0;
        }
      }

      const ctr = totalViews > 0 ? Math.round((totalClicks / totalViews) * 100) : 0;
      return Response.json({ views: totalViews, clicks: totalClicks, ctr });
    }

    if (type === "top-items" && start && end) {
      const dates = dateRange(start, end);
      const merged: Record<string, number> = {};

      for (const date of dates) {
        const data = (await store.get(dayKey(username, date), { type: "json" })) as DayData | null;
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

      return Response.json({ topItems });
    }

    const key = dayKey(username, new Date().toISOString().split("T")[0]);
    const data = await store.get(key, { type: "json" });
    return Response.json(data || emptyDay());
  }

  if (req.method === "POST") {
    const body = await req.json();
    const date = body.date || new Date().toISOString().split("T")[0];
    const key = dayKey(username, date);

    const existing = ((await store.get(key, { type: "json" })) as DayData | null) || emptyDay();

    if (body.action === "track-click" && body.blockId) {
      existing.clicks = (existing.clicks || 0) + 1;
      existing.blockClicks = existing.blockClicks || {};
      existing.blockClicks[body.blockId] = (existing.blockClicks[body.blockId] || 0) + 1;
    } else {
      existing.views = (existing.views || 0) + 1;
      if (body.visitorId) {
        existing.visitors = existing.visitors || [];
        if (!existing.visitors.includes(body.visitorId)) {
          existing.visitors.push(body.visitorId);
        }
      }
    }

    await store.setJSON(key, existing);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/analytics/:username",
};
