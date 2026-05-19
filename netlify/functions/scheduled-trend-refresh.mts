import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";

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

export default async () => {
  const clientId = Netlify.env.get("NAVER_CLIENT_ID");
  const clientSecret = Netlify.env.get("NAVER_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.log("Naver API credentials not configured, skipping refresh");
    return;
  }

  const now = new Date();
  const endDate = now.toISOString().split("T")[0];
  const startDate = new Date(now.getTime() - 14 * 86400000).toISOString().split("T")[0];

  const allItems: Array<{
    cid: number;
    categoryLabel: string;
    keyword: string;
    ratio: number;
    changeRate: number;
    trend: string;
    rank: number;
  }> = [];

  for (const cat of CATEGORIES) {
    try {
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

      if (!res.ok) {
        console.error(`Naver API error for ${cat.label}: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const items = (data.results || []).map(
        (r: { title: string; data?: { ratio: number }[] }) => {
          const periods = r.data || [];
          const cur = periods.length > 0 ? periods[periods.length - 1].ratio : 0;
          const prev = periods.length > 1 ? periods[periods.length - 2].ratio : 0;
          const changeRate = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;

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
      items.forEach(
        (item: { rank: number }, i: number) => {
          item.rank = i + 1;
        }
      );

      allItems.push(...items);
    } catch (err) {
      console.error(`Error fetching category ${cat.label}:`, err);
    }
  }

  if (allItems.length === 0) {
    console.log("No data fetched, keeping existing cache");
    return;
  }

  try {
    const db = getDatabase();
    await db.sql`DELETE FROM trend_items`;
    for (const item of allItems) {
      await db.sql`
        INSERT INTO trend_items (cid, category_label, rank, keyword, title, trend, change_rate, updated_at)
        VALUES (${item.cid}, ${item.categoryLabel}, ${item.rank}, ${item.keyword}, ${item.keyword}, ${item.trend}, ${item.changeRate}, NOW())
      `;
    }
    console.log(`Trend cache refreshed: ${allItems.length} items updated`);
  } catch (err) {
    console.error("Database update error:", err);
  }
};

export const config: Config = {
  schedule: "0 * * * *",
};
