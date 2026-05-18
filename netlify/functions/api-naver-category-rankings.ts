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
      { rank: 1, text: "린넨 셔츠", trend: "up" },
      { rank: 2, text: "와이드 슬랙스", trend: "up" },
      { rank: 3, text: "크롭 가디건", trend: "down" },
      { rank: 4, text: "미니 스커트", trend: "up" },
      { rank: 5, text: "오버핏 티셔츠", trend: "up" },
    ],
  },
  {
    cid: "50000002",
    name: "패션잡화",
    items: [
      { rank: 1, text: "메쉬 스니커즈", trend: "up" },
      { rank: 2, text: "미니 크로스백", trend: "up" },
      { rank: 3, text: "와이드 데님 팬츠", trend: "down" },
      { rank: 4, text: "살로몬 XT-6", trend: "up" },
      { rank: 5, text: "봄 자켓 추천", trend: "up" },
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
    body: JSON.stringify({
      categories: FALLBACK_CATEGORIES,
      source: "fallback",
      updatedAt: new Date().toISOString(),
    }),
  };
};

export { handler };
