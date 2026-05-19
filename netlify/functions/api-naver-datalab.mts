import { getDatabase } from "@netlify/database";

export default async (req: Request) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const db = getDatabase();
    const result = await db.sql`
      SELECT keyword, change_rate, category_label, trend
      FROM trend_items
      ORDER BY change_rate DESC
      LIMIT 1
    `;

    if (result.length > 0) {
      const top = result[0];
      return Response.json({
        mainInsight: {
          keyword: top.keyword as string,
          changeRate: top.change_rate as number,
          category: top.category_label as string,
          trend: top.trend as string,
        },
      });
    }

    const clientId = Netlify.env.get("NAVER_CLIENT_ID");
    const clientSecret = Netlify.env.get("NAVER_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return Response.json({
        mainInsight: { keyword: "트렌드 준비 중", changeRate: 0, category: "", trend: "up" },
      });
    }

    const now = new Date();
    const endDate = now.toISOString().split("T")[0];
    const startDate = new Date(now.getTime() - 14 * 86400000).toISOString().split("T")[0];

    const categories = [
      { cid: 50000000, label: "패션의류", keywords: ["반팔티", "린넨셔츠", "와이드팬츠", "스니커즈", "바람막이"] },
      { cid: 50000002, label: "화장품/미용", keywords: ["선크림", "톤업크림", "클렌징오일", "쿠션팩트", "립틴트"] },
    ];

    let bestKeyword = "트렌드 준비 중";
    let bestChangeRate = -Infinity;
    let bestCategory = "";
    let bestTrend = "up";

    for (const cat of categories) {
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
      for (const r of data.results || []) {
        const periods = r.data || [];
        const cur = periods.length > 0 ? periods[periods.length - 1].ratio : 0;
        const prev = periods.length > 1 ? periods[periods.length - 2].ratio : 0;
        const changeRate = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;

        if (changeRate > bestChangeRate) {
          bestChangeRate = changeRate;
          bestKeyword = r.title;
          bestCategory = cat.label;
          bestTrend = changeRate >= 0 ? "up" : "down";
        }
      }
    }

    return Response.json({
      mainInsight: {
        keyword: bestKeyword,
        changeRate: bestChangeRate === -Infinity ? 0 : bestChangeRate,
        category: bestCategory,
        trend: bestTrend,
      },
    });
  } catch (err) {
    console.error("Naver datalab error:", err);
    return Response.json({
      mainInsight: { keyword: "트렌드 준비 중", changeRate: 0, category: "", trend: "up" },
    });
  }
};
