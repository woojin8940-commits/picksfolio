import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";

const EXPECTED_CIDS = ["50000000", "50000002", "50000003", "50000004", "50000006", "50000008"];

export default async (req: Request) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const db = getDatabase();
    const rows = await db.sql`SELECT * FROM trend_items ORDER BY cid, rank`;

    const dbResult = rows.length > 0 ? formatDbRows(rows) : { categories: [], updatedAt: null };
    const dbCids = new Set(dbResult.categories.map((c: { cid: string }) => c.cid));
    const missingCids = EXPECTED_CIDS.filter((cid) => !dbCids.has(cid));

    if (missingCids.length > 0) {
      try {
        const store = getStore("naver-datalab");
        const blob = await store.get("category-rankings-latest", { type: "json" }) as {
          categories?: { cid: string; label: string; rankings: unknown[] }[];
          updatedAt?: string;
        } | null;

        if (blob?.categories) {
          const missingSet = new Set(missingCids);
          const blobCategories = blob.categories
            .filter((c) => missingSet.has(c.cid))
            .map((c) => ({
              cid: c.cid,
              label: c.label,
              rankings: c.rankings.map((r: Record<string, unknown>) => ({
                rank: (r.rank as number) || 0,
                keyword: r.keyword as string,
                ratio: (r.ratio as number) || 0,
                delta: (r.delta as number) || 0,
                trend: (r.trend as string) || "flat",
              })),
            }));
          dbResult.categories = [...dbResult.categories, ...blobCategories];
          if (!dbResult.updatedAt && blob.updatedAt) {
            dbResult.updatedAt = blob.updatedAt;
          }
        }
      } catch (blobErr) {
        console.error("Blob fallback error:", blobErr);
      }
    }

    if (dbResult.categories.length > 0) {
      return Response.json({ ...dbResult, source: "merged" });
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
  };
}
