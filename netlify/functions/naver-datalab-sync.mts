import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const KEYWORD_GROUPS = [
  { groupName: "바람막이", keywords: ["바람막이", "아노락", "고어텍스", "윈드브레이커"] },
  { groupName: "트위드 자켓", keywords: ["트위드자켓", "트위드", "트위드셋업", "하객룩"] },
  { groupName: "가디건", keywords: ["가디건", "봄가디건", "니트가디건", "긱시크"] },
  { groupName: "트렌치코트", keywords: ["트렌치코트", "봄코트", "트렌치", "롱코트"] },
  { groupName: "슬랙스", keywords: ["슬랙스", "와이드슬랙스", "세미와이드슬랙스"] },
];

const TREND_COLORS = [
  "bg-emerald-500",
  "bg-purple-600",
  "bg-pink-500",
  "bg-blue-600",
  "bg-amber-500",
];

interface NaverDataResult {
  title: string;
  keywords: string[];
  data: { period: string; ratio: number }[];
}

function calculateGrowth(data: { period: string; ratio: number }[]): number {
  if (!data || data.length < 14) {
    return 0;
  }
  const recentDays = data.slice(-7);
  const previousDays = data.slice(-14, -7);

  const recentAvg =
    recentDays.reduce((sum, d) => sum + d.ratio, 0) / recentDays.length;
  const previousAvg =
    previousDays.reduce((sum, d) => sum + d.ratio, 0) / previousDays.length;

  // Use a small floor for previousAvg to prevent exaggerated growth percentages from tiny volumes
  const adjustedPreviousAvg = Math.max(previousAvg, 0.5);
  return Math.round(((recentAvg - adjustedPreviousAvg) / adjustedPreviousAvg) * 100);
}

function getStatus(growth: number): string {
  if (growth >= 30) return "Rising";
  if (growth >= 0) return "Stable";
  return "Declining";
}

export default async (req: Request) => {
  const { next_run } = await req.json();
  console.log(
    `[naver-datalab-sync] Running scheduled sync. Next run: ${next_run}`
  );

  const clientId = Netlify.env.get("NAVER_CLIENT_ID");
  const clientSecret = Netlify.env.get("NAVER_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error(
      "[naver-datalab-sync] Missing NAVER_CLIENT_ID or NAVER_CLIENT_SECRET"
    );
    return;
  }

  const endDate = new Date();
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  try {
    const response = await fetch(
      "https://openapi.naver.com/v1/datalab/search",
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
          keywordGroups: KEYWORD_GROUPS,
        }),
      }
    );

    if (!response.ok) {
      console.error(
        "[naver-datalab-sync] Naver API Error:",
        response.status,
        await response.text()
      );
      return;
    }

    const data = await response.json();

    if (!data.results || !Array.isArray(data.results)) {
      console.error(
        "[naver-datalab-sync] Unexpected response format:",
        JSON.stringify(data).slice(0, 200)
      );
      return;
    }

    const trends = (data.results as NaverDataResult[])
      .map((result, index) => {
        const growth = calculateGrowth(result.data);
        return {
          id: index + 1,
          keyword: result.title,
          growth: `${growth >= 0 ? "+" : ""}${growth}%`,
          growthValue: growth,
          status: getStatus(growth),
          color: TREND_COLORS[index % TREND_COLORS.length],
        };
      })
      .sort((a, b) => b.growthValue - a.growthValue);

    // Re-assign IDs and colors after sorting
    trends.forEach((t, i) => {
      t.id = i + 1;
      t.color = TREND_COLORS[i % TREND_COLORS.length];
    });

    const top = trends[0];
    const growthText =
      top.growthValue >= 0
        ? `${top.growthValue}% 상승`
        : `${Math.abs(top.growthValue)}% 하락`;

    const payload = {
      trends,
      mainInsight: {
        keyword: top.keyword,
        description: `최근 1주일간 네이버 검색량이 전주 대비 ${growthText}했습니다. 현재 가장 주목받는 패션 트렌드 키워드입니다.`,
      },
      updatedAt: new Date().toISOString(),
    };

    const store = getStore("naver-datalab");
    await store.setJSON("latest-trends-v2", payload);

    console.log(
      `[naver-datalab-sync] Successfully synced ${trends.length} trends. Top: ${top.keyword} (${top.growth})`
    );
  } catch (error) {
    console.error("[naver-datalab-sync] Failed to sync:", error);
  }
};

// Run daily at midnight KST (15:00 UTC)
export const config: Config = {
  schedule: "0 15 * * *",
};
