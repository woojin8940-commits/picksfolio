import { Handler } from "@netlify/functions";

interface CategoryItem {
  rank: number;
  text: string;
  trend: string;
}

interface Category {
  cid: string;
  name: string;
  items: CategoryItem[];
}

const FALLBACK_CATEGORIES: Category[] = [
  {
    cid: "50000000",
    name: "패션의류",
    items: [
      { rank: 1, text: "러닝코어 룩북", trend: "up" },
      { rank: 2, text: "린넨 와이드 팬츠", trend: "up" },
      { rank: 3, text: "크롭 볼레로 가디건", trend: "up" },
      { rank: 4, text: "리조트 원피스", trend: "up" },
      { rank: 5, text: "쿨링 기능성 티셔츠", trend: "down" },
    ],
  },
  {
    cid: "50000002",
    name: "패션잡화",
    items: [
      { rank: 1, text: "메쉬 러닝화", trend: "up" },
      { rank: 2, text: "라탄 미니백", trend: "up" },
      { rank: 3, text: "스포츠 선글라스", trend: "up" },
      { rank: 4, text: "플랫폼 샌들", trend: "down" },
      { rank: 5, text: "버킷햇 UV차단", trend: "up" },
    ],
  },
];

const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (clientId && clientSecret) {
    try {
      const categories = [];
      const categoryIds = [
        { cid: "50000000", name: "패션의류" },
        { cid: "50000002", name: "패션잡화" },
      ];

      for (const cat of categoryIds) {
        const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(cat.name)}&display=5&sort=date&filter=`;
        const response = await fetch(url, {
          headers: {
            "X-Naver-Client-Id": clientId,
            "X-Naver-Client-Secret": clientSecret,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const items: CategoryItem[] = (data.items || []).slice(0, 5).map((item: any, idx: number) => ({
            rank: idx + 1,
            text: item.title.replace(/<[^>]*>/g, ""),
            trend: idx < 3 ? "up" : "down",
          }));

          categories.push({ cid: cat.cid, name: cat.name, items });
        }
      }

      if (categories.length > 0) {
        return {
          statusCode: 200,
          headers: { "Cache-Control": "public, max-age=1800" },
          body: JSON.stringify({
            categories,
            source: "naver-api",
            updatedAt: new Date().toISOString(),
          }),
        };
      }
    } catch (error) {
      console.error("Naver category rankings error:", error);
    }
  }

  return {
    statusCode: 200,
    headers: { "Cache-Control": "public, max-age=3600" },
    body: JSON.stringify({
      categories: FALLBACK_CATEGORIES,
      source: "fallback",
      updatedAt: new Date().toISOString(),
    }),
  };
};

export { handler };
