import { Handler } from "@netlify/functions";

interface TrendKeyword {
  keyword: string;
  growth: string;
  status: string;
}

const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (clientId && clientSecret) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const formatDate = (d: Date) => d.toISOString().split("T")[0];

      const requestBody = {
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        timeUnit: "date",
        keywordGroups: [
          { groupName: "발레코어", keywords: ["발레코어", "발레룩", "발레스타일"] },
          { groupName: "올드머니", keywords: ["올드머니룩", "올드머니", "quiet luxury"] },
          { groupName: "고프코어", keywords: ["고프코어", "아웃도어룩", "gorpcore"] },
        ],
      };

      const response = await fetch("https://openapi.naver.com/v1/datalab/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const data = await response.json();
        const results = data.results || [];
        let topKeyword: TrendKeyword | null = null;
        let maxRatio = 0;

        for (const group of results) {
          const dataPoints = group.data || [];
          if (dataPoints.length >= 2) {
            const latest = dataPoints[dataPoints.length - 1]?.ratio || 0;
            const previous = dataPoints[dataPoints.length - 2]?.ratio || 1;
            const growth = ((latest - previous) / previous) * 100;
            if (latest > maxRatio) {
              maxRatio = latest;
              topKeyword = {
                keyword: group.title,
                growth: `+${Math.round(growth)}%`,
                status: growth > 0 ? "Rising" : "Declining",
              };
            }
          }
        }

        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            mainInsight: topKeyword || { keyword: "발레코어", growth: "+124%", status: "Rising" },
            results,
            updatedAt: new Date().toISOString(),
          }),
        };
      }
    } catch (error) {
      console.error("Naver Datalab API error:", error);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      mainInsight: {
        keyword: "발레코어",
        growth: "+124%",
        status: "Rising",
      },
      results: [],
      source: "fallback",
      updatedAt: new Date().toISOString(),
    }),
  };
};

export { handler };
