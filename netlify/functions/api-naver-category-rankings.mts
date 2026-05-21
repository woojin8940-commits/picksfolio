import { getDatabase } from "@netlify/database";

export default async (req: Request) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const db = getDatabase();
    const rows = await db.sql`SELECT * FROM trend_items ORDER BY cid, rank`;

    if (rows.length > 0) {
      return Response.json(formatDbRows(rows));
    }

    return Response.json({ categories: [], updatedAt: null, source: "empty" });
  } catch (err) {
    console.error("Trend rankings error:", err);
    return Response.json({ categories: [], updatedAt: null, source: "error" });
  }
};

function formatDbRows(rows: Record<string, unknown>[]) {
  const map = new Map<
    number,
    { cid: string; label: string; rankings: { rank: number; keyword: string; ratio: number; delta: number; trend: string }[] }
  >();
  let latest: Date | null = null;

  for (const row of rows) {
    const cid = row.cid as number;
    if (!map.has(cid)) {
      map.set(cid, { cid: String(cid), label: row.category_label as string, rankings: [] });
    }
    map.get(cid)!.rankings.push({
      rank: (row.rank as number) || 0,
      keyword: row.keyword as string,
      ratio: 0,
      delta: row.change_rate as number,
      trend: (row.trend as string) || "flat",
    });
    const ts = new Date(row.updated_at as string);
    if (!latest || ts > latest) latest = ts;
  }

  return {
    categories: Array.from(map.values()),
    updatedAt: latest?.toISOString() || null,
    source: "daily_cache",
  };
}
