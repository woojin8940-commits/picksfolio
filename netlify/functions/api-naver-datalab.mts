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
      ORDER BY rank ASC
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

    return Response.json({
      mainInsight: {
        keyword: "트렌드 준비 중",
        changeRate: 0,
        category: "",
        trend: "up",
      },
    });
  } catch (err) {
    console.error("Naver datalab error:", err);
    return Response.json({
      mainInsight: {
        keyword: "트렌드 준비 중",
        changeRate: 0,
        category: "",
        trend: "up",
      },
    });
  }
};
