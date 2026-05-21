import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const CATEGORIES = [
  { cid: "50000000", label: "패션의류" },
  { cid: "50000002", label: "화장품/미용" },
  { cid: "50000003", label: "디지털/가전" },
  { cid: "50000004", label: "가구/인테리어" },
  { cid: "50000006", label: "식품" },
  { cid: "50000008", label: "생활/건강" },
  { cid: "50000009", label: "여가/생활편의" },
];

interface RankingItem {
  rank: number;
  keyword: string;
  ratio: number;
  delta: number;
  trend: "up" | "down" | "flat";
}

interface DayData {
  date: string;
  ranks: { rank: number; keyword: string }[];
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
): Promise<Map<string, { ratio: number; delta: number; trend: "up" | "down" | "flat" }>> {
  const rateMap = new Map<
    string,
    { ratio: number; delta: number; trend: "up" | "down" | "flat" }
  >();

  const now = new Date();
  const endDate = now.toISOString().split("T")[0];
  const startDate = new Date(now.getTime() - 30 * 86400000)
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
        timeUnit: "date",
        category: cid,
        keyword: keywords.slice(0, 5).map((k) => ({ name: k, param: [k] })),
      }),
    },
  );

  if (!res.ok) return rateMap;

  const data = await res.json();
  for (const r of (data.results || []) as {
    title: string;
    data?: { period: string; ratio: number }[];
  }[]) {
    const periods = r.data || [];
    const recentSlice = periods.slice(-3);
    const prevSlice = periods.slice(-6, -3);
    const recent =
      recentSlice.length > 0
        ? recentSlice.reduce((s, d) => s + d.ratio, 0) / recentSlice.length
        : 0;
    const prev =
      prevSlice.length > 0
        ? prevSlice.reduce((s, d) => s + d.ratio, 0) / prevSlice.length
        : 0;
    const safePrev = Math.max(prev, 0.5);
    const delta = Math.round(((recent - safePrev) / safePrev) * 100);

    rateMap.set(r.title, {
      ratio: Number(recent.toFixed(2)),
      delta,
      trend: delta > 2 ? "up" : delta < -2 ? "down" : "flat",
    });
  }

  return rateMap;
}

export default async (req: Request) => {
  const { next_run } = await req.json().catch(() => ({ next_run: "n/a" }));
  console.log(
    `[naver-shopping-category-sync] Running scheduled sync. Next run: ${next_run}`,
  );

  const clientId = Netlify.env.get("NAVER_CLIENT_ID") || "";
  const clientSecret = Netlify.env.get("NAVER_CLIENT_SECRET") || "";

  try {
    const results = await Promise.all(
      CATEGORIES.map(async (cat) => {
        try {
          const days = await fetchLiveRankings(cat.cid);
          const latest = days.length > 0 ? days[days.length - 1] : null;
          const previous = days.length > 1 ? days[days.length - 2] : null;

          if (!latest || latest.ranks.length === 0) return null;

          const keywords = latest.ranks.slice(0, 5).map((r) => r.keyword);

          const prevMap = new Map<string, number>();
          if (previous) {
            for (const r of previous.ranks) {
              prevMap.set(r.keyword, r.rank);
            }
          }

          let rankings: RankingItem[];

          if (clientId && clientSecret) {
            const rateMap = await fetchChangeRates(
              cat.cid,
              keywords,
              clientId,
              clientSecret,
            );
            rankings = keywords.map((kw, idx) => {
              const rates = rateMap.get(kw);
              if (rates) {
                return { rank: idx + 1, keyword: kw, ...rates };
              }
              const prevRank = prevMap.get(kw);
              const delta =
                prevRank !== undefined ? prevRank - (idx + 1) : previous ? 1 : 0;
              return {
                rank: idx + 1,
                keyword: kw,
                ratio: 0,
                delta,
                trend: (delta > 0 ? "up" : delta < 0 ? "down" : "flat") as
                  | "up"
                  | "down"
                  | "flat",
              };
            });
          } else {
            rankings = keywords.map((kw, idx) => {
              const prevRank = prevMap.get(kw);
              const delta =
                prevRank !== undefined ? prevRank - (idx + 1) : previous ? 1 : 0;
              return {
                rank: idx + 1,
                keyword: kw,
                ratio: 0,
                delta,
                trend: (delta > 0 ? "up" : delta < 0 ? "down" : "flat") as
                  | "up"
                  | "down"
                  | "flat",
              };
            });
          }

          return { cid: cat.cid, label: cat.label, rankings };
        } catch (err) {
          console.error(
            `[naver-shopping-category-sync] Error for ${cat.label}:`,
            err,
          );
          return null;
        }
      }),
    );

    const successful = results.filter(
      (r): r is NonNullable<typeof r> =>
        r !== null && r.rankings.length > 0,
    );

    if (successful.length === 0) {
      console.error(
        "[naver-shopping-category-sync] No categories returned data",
      );
      return;
    }

    const payload = {
      categories: successful.map((r) => ({
        cid: r.cid,
        label: r.label,
        rankings: r.rankings,
      })),
      updatedAt: new Date().toISOString(),
    };

    const store = getStore("naver-datalab");
    await store.setJSON("category-rankings-latest", payload);

    console.log(
      `[naver-shopping-category-sync] Synced ${successful.length} categories with live keywords`,
    );
  } catch (error) {
    console.error("[naver-shopping-category-sync] Failed:", error);
  }
};

export const config: Config = {
  schedule: "5 5 * * *",
};
