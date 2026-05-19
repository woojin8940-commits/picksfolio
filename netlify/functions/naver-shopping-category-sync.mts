import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const CATEGORIES: Array<{
  cid: string;
  label: string;
  keywords: string[];
}> = [
  {
    cid: "50000000",
    label: "패션",
    keywords: ["원피스", "청바지", "트렌치코트", "가디건", "트위드자켓"],
  },
  {
    cid: "50000002",
    label: "뷰티",
    keywords: ["립스틱", "쿠션", "향수", "선크림", "토너"],
  },
];

interface NaverShoppingResult {
  title: string;
  keyword: string[];
  data: { period: string; ratio: number }[];
}

interface RankingItem {
  rank: number;
  keyword: string;
  ratio: number;
  delta: number;
  trend: "up" | "down" | "flat";
}

function recentAvg(data: { period: string; ratio: number }[], days: number): number {
  if (!data || data.length === 0) return 0;
  const slice = data.slice(-days);
  if (slice.length === 0) return 0;
  return slice.reduce((sum, d) => sum + d.ratio, 0) / slice.length;
}

async function fetchCategoryRanking(
  clientId: string,
  clientSecret: string,
  category: { cid: string; label: string; keywords: string[] },
): Promise<RankingItem[] | null> {
  const endDate = new Date();
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const response = await fetch(
    "https://openapi.naver.com/v1/datalab/shopping/category/keywords",
    {
      method: "POST",
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        timeUnit: "date",
        category: category.cid,
        keyword: category.keywords.map((k) => ({ name: k, param: [k] })),
      }),
    },
  );

  if (!response.ok) {
    console.error(
      `[naver-shopping-category-sync] API error for ${category.label}:`,
      response.status,
      await response.text(),
    );
    return null;
  }

  const data = await response.json();
  if (!data.results || !Array.isArray(data.results)) {
    console.error(
      `[naver-shopping-category-sync] Unexpected response for ${category.label}`,
    );
    return null;
  }

  const enriched = (data.results as NaverShoppingResult[]).map((result) => {
    const recent = recentAvg(result.data, 3);
    const previous = recentAvg(result.data.slice(0, -3), 3);
    const safePrev = Math.max(previous, 0.5);
    const delta = Math.round(((recent - safePrev) / safePrev) * 100);
    return {
      keyword: result.title,
      ratio: Number(recent.toFixed(2)),
      delta,
      trend:
        delta > 2 ? ("up" as const) : delta < -2 ? ("down" as const) : ("flat" as const),
    };
  });

  enriched.sort((a, b) => b.ratio - a.ratio);

  return enriched.slice(0, 5).map((item, i) => ({
    rank: i + 1,
    ...item,
  }));
}

export default async (req: Request) => {
  const { next_run } = await req.json().catch(() => ({ next_run: "n/a" }));
  console.log(
    `[naver-shopping-category-sync] Running scheduled sync. Next run: ${next_run}`,
  );

  const clientId = Netlify.env.get("NAVER_CLIENT_ID");
  const clientSecret = Netlify.env.get("NAVER_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error(
      "[naver-shopping-category-sync] Missing NAVER_CLIENT_ID or NAVER_CLIENT_SECRET",
    );
    return;
  }

  try {
    const results = await Promise.all(
      CATEGORIES.map(async (cat) => ({
        cid: cat.cid,
        label: cat.label,
        rankings: await fetchCategoryRanking(clientId, clientSecret, cat),
      })),
    );

    const successful = results.filter((r) => r.rankings && r.rankings.length > 0);
    if (successful.length === 0) {
      console.error("[naver-shopping-category-sync] No categories returned data");
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
      `[naver-shopping-category-sync] Synced ${successful.length} categories`,
    );
  } catch (error) {
    console.error("[naver-shopping-category-sync] Failed:", error);
  }
};

export const config: Config = {
  schedule: "5 15 * * *",
};
