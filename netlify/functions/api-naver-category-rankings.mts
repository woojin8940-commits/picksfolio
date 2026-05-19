import { getDatabase } from "@netlify/database";

const CATEGORIES = [
  {
    cid: 50000000,
    label: "패션의류",
    keywords: ["반팔티", "린넨셔츠", "와이드팬츠", "스니커즈", "바람막이"],
  },
  {
    cid: 50000002,
    label: "화장품/미용",
    keywords: ["선크림", "톤업크림", "클렌징오일", "쿠션팩트", "립틴트"],
  },
];

const CACHE_TTL_MS = 60 * 60 * 1000;

export default async (req: Request) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const clientId = Netlify.env.get("NAVER_CLIENT_ID");
    const clientSecret = Netlify.env.get("NAVER_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return Response.json({ categories: [], updatedAt: null, source: "no_credentials" });
    }

    const db = getDatabase();
    const cached = await db.sql`SELECT * FROM trend_items ORDER BY cid, rank`;

    const now = new Date();
    if (cached.length > 0) {
      const latestUpdate = new Date(cached[0].updated_at);
      if (now.getTime() - latestUpdate.getTime() < CACHE_TTL_MS) {
        return Response.json(formatDbRows(cached));
      }
    }

    const allItems: TrendItem[] = [];
    const endDate = toDateStr(now);
    const startDate = toDateStr(new Date(now.getTime() - 14 * 86400000));

    for (const cat of CATEGORIES) {
      const res = await fetch(
        "https://openapi.naver.com/v1/datalab/shopping/category/keywords",
        {
          method: "POST",
          headers: {
            "X-Naver-Client-Id": clientId,
            "X-Naver-Client-Secret": clientSecret,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate,
            endDate,
            timeUnit: "week",
            category: String(cat.cid),
            keyword: cat.keywords.map((k) => ({ name: k, param: [k] })),
          }),
        }
      );

      if (!res.ok) continue;

      const data = await res.json();
      const items = (data.results || []).map(
        (r: { title: string; data?: { ratio: number }[] }) => {
          const periods = r.data || [];
          const cur =
            periods.length > 0 ? periods[periods.length - 1].ratio : 0;
          const prev =
            periods.length > 1 ? periods[periods.length - 2].ratio : 0;
          const changeRate =
            prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;

          return {
            cid: cat.cid,
            categoryLabel: cat.label,
            keyword: r.title,
            ratio: cur,
            changeRate,
            trend: changeRate >= 0 ? "up" : "down",
            rank: 0,
          };
        }
      );

      items.sort(
        (a: { ratio: number }, b: { ratio: number }) => b.ratio - a.ratio
      );
      items.forEach((item: TrendItem, i: number) => {
        item.rank = i + 1;
      });

      allItems.push(...items);
    }

    if (allItems.length > 0) {
      await db.sql`DELETE FROM trend_items`;
      for (const item of allItems) {
        await db.sql`
          INSERT INTO trend_items (cid, category_label, rank, keyword, title, trend, change_rate, updated_at)
          VALUES (${item.cid}, ${item.categoryLabel}, ${item.rank}, ${item.keyword}, ${item.keyword}, ${item.trend}, ${item.changeRate}, NOW())
        `;
      }
      return Response.json(formatItems(allItems));
    }

    if (cached.length > 0) {
      return Response.json(formatDbRows(cached));
    }

    return Response.json({ categories: [], updatedAt: null, source: "empty" });
  } catch (err) {
    console.error("Naver category rankings error:", err);

    try {
      const db = getDatabase();
      const cached = await db.sql`SELECT * FROM trend_items ORDER BY cid, rank`;
      if (cached.length > 0) {
        return Response.json(formatDbRows(cached));
      }
    } catch {}

    return Response.json({ categories: [], updatedAt: null, source: "error" });
  }
};

interface TrendItem {
  cid: number;
  categoryLabel: string;
  keyword: string;
  ratio: number;
  changeRate: number;
  trend: string;
  rank: number;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

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
    source: "naver_shopping_api",
  };
}

function formatItems(items: TrendItem[]) {
  const map = new Map<
    number,
    { cid: string; label: string; rankings: { rank: number; keyword: string; ratio: number; delta: number; trend: string }[] }
  >();

  for (const item of items) {
    if (!map.has(item.cid)) {
      map.set(item.cid, { cid: String(item.cid), label: item.categoryLabel, rankings: [] });
    }
    map.get(item.cid)!.rankings.push({
      rank: item.rank,
      keyword: item.keyword,
      ratio: item.ratio,
      delta: item.changeRate,
      trend: item.trend,
    });
  }

  return {
    categories: Array.from(map.values()),
    updatedAt: new Date().toISOString(),
    source: "naver_shopping_api",
  };
}
