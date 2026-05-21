import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";

const CATEGORIES = [
  { cid: "50000000", label: "패션의류" },
  { cid: "50000002", label: "화장품/미용" },
  { cid: "50000003", label: "디지털/가전" },
  { cid: "50000004", label: "가구/인테리어" },
  { cid: "50000006", label: "식품" },
  { cid: "50000008", label: "생활/건강" },
];

interface RankEntry {
  rank: number;
  keyword: string;
}

interface DayData {
  date: string;
  ranks: RankEntry[];
}

async function fetchLiveRankings(cid: string): Promise<DayData[]> {
  const now = new Date();
  const endDate = now.toISOString().split("T")[0];
  const startDate = new Date(now.getTime() - 14 * 86400000)
    .toISOString()
    .split("T")[0];

  const res = await fetch(
    "https://datalab.naver.com/shoppingInsight/getKeywordRank.naver",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://datalab.naver.com/shoppingInsight/sCategory.naver",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: new URLSearchParams({
        cid,
        timeUnit: "date",
        startDate,
        endDate,
        age: "",
        gender: "",
        device: "",
      }),
    },
  );

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0)
    throw new Error("Empty response");

  return data
    .filter(
      (d: Record<string, unknown>) =>
        d.statusCode === 200 && Array.isArray(d.ranks),
    )
    .map((d: Record<string, unknown>) => ({
      date: d.date as string,
      ranks: (d.ranks as Record<string, unknown>[]).map((r) => ({
        rank: r.rank as number,
        keyword: r.keyword as string,
      })),
    }));
}

async function fetchChangeRates(
  cid: string,
  keywords: string[],
  clientId: string,
  clientSecret: string,
): Promise<Map<string, { changeRate: number; trend: string }>> {
  const rateMap = new Map<string, { changeRate: number; trend: string }>();

  const now = new Date();
  const endDate = now.toISOString().split("T")[0];
  const startDate = new Date(now.getTime() - 14 * 86400000)
    .toISOString()
    .split("T")[0];

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
        category: cid,
        keyword: keywords.slice(0, 5).map((k) => ({ name: k, param: [k] })),
      }),
    },
  );

  if (!res.ok) return rateMap;

  const data = await res.json();
  for (const r of (data.results || []) as {
    title: string;
    data?: { ratio: number }[];
  }[]) {
    const periods = r.data || [];
    const cur = periods.length > 0 ? periods[periods.length - 1].ratio : 0;
    const prev = periods.length > 1 ? periods[periods.length - 2].ratio : 0;
    const changeRate =
      prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
    rateMap.set(r.title, {
      changeRate,
      trend: changeRate > 2 ? "up" : changeRate < -2 ? "down" : "flat",
    });
  }

  return rateMap;
}

function rankBasedTrends(
  days: DayData[],
): { keyword: string; rank: number; changeRate: number; trend: string }[] {
  if (days.length === 0) return [];

  const latest = days[days.length - 1];
  const previous = days.length > 1 ? days[days.length - 2] : null;

  const prevMap = new Map<string, number>();
  if (previous) {
    for (const r of previous.ranks) {
      prevMap.set(r.keyword, r.rank);
    }
  }

  return latest.ranks.slice(0, 5).map((item) => {
    const prevRank = prevMap.get(item.keyword);
    let changeRate = 0;
    let trend = "flat";

    if (prevRank !== undefined) {
      changeRate = prevRank - item.rank;
      trend = changeRate > 0 ? "up" : changeRate < 0 ? "down" : "flat";
    } else if (previous) {
      changeRate = 1;
      trend = "up";
    }

    return { keyword: item.keyword, rank: item.rank, changeRate, trend };
  });
}

export default async () => {
  const clientId = Netlify.env.get("NAVER_CLIENT_ID") || "";
  const clientSecret = Netlify.env.get("NAVER_CLIENT_SECRET") || "";

  const allItems: Array<{
    cid: string;
    categoryLabel: string;
    keyword: string;
    rank: number;
    changeRate: number;
    trend: string;
  }> = [];

  for (const cat of CATEGORIES) {
    try {
      const days = await fetchLiveRankings(cat.cid);
      const latest = days.length > 0 ? days[days.length - 1] : null;

      if (!latest || latest.ranks.length === 0) {
        console.error(`No ranking data for ${cat.label}`);
        continue;
      }

      const keywords = latest.ranks.slice(0, 5).map((r) => r.keyword);

      let items: {
        keyword: string;
        rank: number;
        changeRate: number;
        trend: string;
      }[];

      if (clientId && clientSecret) {
        const rateMap = await fetchChangeRates(
          cat.cid,
          keywords,
          clientId,
          clientSecret,
        );
        if (rateMap.size > 0) {
          items = keywords.map((kw, idx) => {
            const rates = rateMap.get(kw) || { changeRate: 0, trend: "flat" };
            return {
              keyword: kw,
              rank: idx + 1,
              changeRate: rates.changeRate,
              trend: rates.trend,
            };
          });
        } else {
          items = rankBasedTrends(days);
        }
      } else {
        items = rankBasedTrends(days);
      }

      for (const item of items) {
        allItems.push({
          cid: cat.cid,
          categoryLabel: cat.label,
          ...item,
        });
      }

      console.log(
        `Fetched ${items.length} trending keywords for ${cat.label}: ${items.map((t) => t.keyword).join(", ")}`,
      );
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
        VALUES (${Number(item.cid)}, ${item.categoryLabel}, ${item.rank}, ${item.keyword}, ${item.keyword}, ${item.trend}, ${item.changeRate}, NOW())
      `;
    }
    console.log(`Trend cache refreshed: ${allItems.length} items updated`);
  } catch (err) {
    console.error("Database update error:", err);
  }
};

export const config: Config = {
  schedule: "0 5 * * *",
};
