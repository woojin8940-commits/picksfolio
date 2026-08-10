import { getDatabase } from "@picks/netlify-database";
import { getStore } from "@netlify/blobs";

const EXPECTED_CATEGORIES = [
  { cid: "50000000", label: "패션의류" },
  { cid: "50000002", label: "화장품/미용" },
  { cid: "50000003", label: "디지털/가전" },
  { cid: "50000004", label: "가구/인테리어" },
  { cid: "50000006", label: "식품" },
  { cid: "50000008", label: "생활/건강" },
];

const CID_ORDER = EXPECTED_CATEGORIES.map((c) => c.cid);

const CATEGORY_ENGLISH_LABELS: Record<string, string> = {
  "50000000": "Fashion / Apparel",
  "50000002": "Beauty / Cosmetics",
  "50000003": "Digital / Appliances",
  "50000004": "Furniture / Interior",
  "50000006": "Food",
  "50000008": "Living / Health",
};

const TRANSLATION_MODEL = "gemini-2.5-flash-lite";
const TRANSLATION_CACHE_KEY = "keyword-translations-ko-en";

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;

interface CategoryData {
  cid: string;
  label: string;
  rankings: { rank: number; keyword: string; ratio: number; delta: number; trend: string }[];
}

type TrendResult = { categories: CategoryData[]; updatedAt: string | null };

const hasKorean = (value: string) => /[가-힣]/.test(value);

function romanizeKorean(value: string): string {
  const initials = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
  const medials = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
  const finals = ["", "k", "k", "ks", "n", "nj", "nh", "t", "l", "lk", "lm", "lp", "ls", "lt", "lp", "lh", "m", "p", "ps", "t", "t", "ng", "t", "t", "k", "t", "p", "h"];

  return Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0) - 0xac00;
      if (code < 0 || code > 11171) return character;
      const initial = Math.floor(code / 588);
      const medial = Math.floor((code % 588) / 28);
      const final = code % 28;
      return `${initials[initial]}${medials[medial]}${finals[final]}`;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTranslationResponse(text: string, expectedLength: number): string[] | null {
  const normalized = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const parsed = JSON.parse(normalized) as { translations?: unknown } | unknown[];
    const translations = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.translations)
        ? parsed.translations
        : null;
    if (!translations || translations.length !== expectedLength) return null;
    return translations.map((value) => String(value || "").trim());
  } catch {
    return null;
  }
}

async function translateKeywords(keywords: string[]): Promise<Record<string, string>> {
  const store = getStore("naver-trend-translations");
  let cache: Record<string, string> = {};

  try {
    cache = ((await store.get(TRANSLATION_CACHE_KEY, { type: "json" })) as Record<string, string> | null) || {};
  } catch (error) {
    console.error("Trend translation cache read error:", error);
  }

  const missing = keywords.filter((keyword) => !cache[keyword] || hasKorean(cache[keyword]));
  if (missing.length === 0) return cache;

  let translated: string[] | null = null;
  if (process.env.GEMINI_API_KEY && process.env.GOOGLE_GEMINI_BASE_URL) {
    try {
      const response = await fetch(
        `${process.env.GOOGLE_GEMINI_BASE_URL}/v1beta/models/${TRANSLATION_MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: "Translate Korean shopping search keywords into concise, natural English shopping terms. Preserve brand names and model numbers. Return only valid JSON with the shape {\"translations\":[\"...\"]}, in exactly the same order and with no extra text.",
              }],
            },
            contents: [{ role: "user", parts: [{ text: JSON.stringify(missing) }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
          }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        const text = (data?.candidates?.[0]?.content?.parts || [])
          .map((part: { text?: string }) => part.text || "")
          .join("")
          .trim();
        translated = parseTranslationResponse(text, missing.length);
      } else {
        console.error("Trend keyword translation failed:", response.status);
      }
    } catch (error) {
      console.error("Trend keyword translation request error:", error);
    }
  }

  missing.forEach((keyword, index) => {
    const candidate = translated?.[index];
    if (candidate && !hasKorean(candidate)) cache[keyword] = candidate;
  });

  if (translated) {
    try {
      await store.setJSON(TRANSLATION_CACHE_KEY, cache);
    } catch (error) {
      console.error("Trend translation cache write error:", error);
    }
  }

  return cache;
}

async function localizeTrendResult(result: TrendResult, language: string | null): Promise<TrendResult> {
  if (language !== "en" || result.categories.length === 0) return result;

  const keywords = Array.from(new Set(
    result.categories.flatMap((category) => category.rankings.map((item) => item.keyword)),
  ));
  const translations = await translateKeywords(keywords);

  return {
    ...result,
    categories: result.categories.map((category) => ({
      ...category,
      label: CATEGORY_ENGLISH_LABELS[category.cid] || romanizeKorean(category.label),
      rankings: category.rankings.map((item) => ({
        ...item,
        keyword: translations[item.keyword] || romanizeKorean(item.keyword),
      })),
    })),
  };
}

async function fetchLiveForCategory(cid: string, label: string): Promise<CategoryData | null> {
  const now = new Date();
  const endDate = now.toISOString().split("T")[0];
  const startDate = new Date(now.getTime() - 14 * 86400000).toISOString().split("T")[0];

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

  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const days = data
    .filter(
      (d: Record<string, unknown>) =>
        d.statusCode === 200 && Array.isArray(d.ranks),
    )
    .map((d: Record<string, unknown>) => ({
      date: d.date as string,
      ranks: (d.ranks as { rank: number; keyword: string }[]).map((r) => ({
        rank: r.rank,
        keyword: r.keyword,
      })),
    }));

  if (days.length === 0) return null;

  const latest = days[days.length - 1];
  const previous = days.length > 1 ? days[days.length - 2] : null;

  const prevMap = new Map<string, number>();
  if (previous) {
    for (const r of previous.ranks) prevMap.set(r.keyword, r.rank);
  }

  const rankings = latest.ranks.slice(0, 5).map((item) => {
    const prevRank = prevMap.get(item.keyword);
    let delta = 0;
    let trend = "flat";
    if (prevRank !== undefined) {
      delta = prevRank - item.rank;
      trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    }
    return { rank: item.rank, keyword: item.keyword, ratio: 0, delta, trend };
  });

  return { cid, label, rankings };
}

export default async (req: Request) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const language = new URL(req.url).searchParams.get("lang");

  try {
    const db = getDatabase();
    const rows = await db.sql`SELECT * FROM trend_items ORDER BY cid, rank`;

    const dbResult: { categories: CategoryData[]; updatedAt: string | null } =
      rows.length > 0 ? formatDbRows(rows) : { categories: [], updatedAt: null };

    const isStale =
      !dbResult.updatedAt ||
      Date.now() - new Date(dbResult.updatedAt).getTime() > STALE_THRESHOLD_MS;

    const dbCids = new Set(dbResult.categories.map((c) => c.cid));
    const hasAllCategories = EXPECTED_CATEGORIES.every((c) => dbCids.has(c.cid));

    if (!isStale && hasAllCategories) {
      dbResult.categories.sort(
        (a, b) => CID_ORDER.indexOf(a.cid) - CID_ORDER.indexOf(b.cid),
      );
      return Response.json({ ...(await localizeTrendResult(dbResult, language)), source: "db" });
    }

    const categoriesToFetch = isStale
      ? EXPECTED_CATEGORIES
      : EXPECTED_CATEGORIES.filter((c) => !dbCids.has(c.cid));

    const liveResults = await Promise.allSettled(
      categoriesToFetch.map((c) => fetchLiveForCategory(c.cid, c.label)),
    );

    const liveCategories = liveResults
      .filter(
        (r): r is PromiseFulfilledResult<CategoryData> =>
          r.status === "fulfilled" && r.value !== null,
      )
      .map((r) => r.value);

    const result: { categories: CategoryData[]; updatedAt: string | null } = {
      categories: [],
      updatedAt: null,
    };

    if (isStale && liveCategories.length > 0) {
      const liveCidSet = new Set(liveCategories.map((c) => c.cid));
      const keptFromDb = dbResult.categories.filter((c) => !liveCidSet.has(c.cid));
      result.categories = [...keptFromDb, ...liveCategories];
      result.updatedAt = new Date().toISOString();
    } else {
      result.categories = [...dbResult.categories, ...liveCategories];
      result.updatedAt = dbResult.updatedAt || (liveCategories.length > 0 ? new Date().toISOString() : null);
    }

    let haveCids = new Set(result.categories.map((c) => c.cid));
    let missing = EXPECTED_CATEGORIES.filter((c) => !haveCids.has(c.cid));

    if (missing.length > 0) {
      try {
        const store = getStore("naver-datalab");
        const blob = (await store.get("category-rankings-latest", {
          type: "json",
        })) as {
          categories?: CategoryData[];
          updatedAt?: string;
        } | null;

        if (blob?.categories) {
          const missingSet = new Set(missing.map((c) => c.cid));
          const blobCategories = blob.categories
            .filter((c) => missingSet.has(c.cid))
            .map((c) => ({
              cid: c.cid,
              label: c.label,
              rankings: c.rankings.map((r) => ({
                rank: r.rank || 0,
                keyword: r.keyword,
                ratio: r.ratio || 0,
                delta: r.delta || 0,
                trend: r.trend || "flat",
              })),
            }));
          result.categories = [...result.categories, ...blobCategories];
          if (!result.updatedAt && blob.updatedAt) {
            result.updatedAt = blob.updatedAt;
          }

          haveCids = new Set(result.categories.map((c) => c.cid));
          missing = EXPECTED_CATEGORIES.filter((c) => !haveCids.has(c.cid));
        }
      } catch (blobErr) {
        console.error("Blob fallback error:", blobErr);
      }
    }

    if (missing.length > 0 && !isStale) {
      const extraLive = await Promise.allSettled(
        missing.map((c) => fetchLiveForCategory(c.cid, c.label)),
      );
      const extraCategories = extraLive
        .filter(
          (r): r is PromiseFulfilledResult<CategoryData> =>
            r.status === "fulfilled" && r.value !== null,
        )
        .map((r) => r.value);

      if (extraCategories.length > 0) {
        result.categories = [...result.categories, ...extraCategories];
        if (!result.updatedAt) result.updatedAt = new Date().toISOString();
      }
    }

    result.categories.sort(
      (a, b) => CID_ORDER.indexOf(a.cid) - CID_ORDER.indexOf(b.cid),
    );

    if (liveCategories.length > 0) {
      try {
        const store = getStore("naver-datalab");
        await store.setJSON("category-rankings-latest", {
          categories: result.categories,
          updatedAt: result.updatedAt,
        });
      } catch (_) {
        /* best-effort cache */
      }
    }

    if (result.categories.length > 0) {
      return Response.json({ ...(await localizeTrendResult(result, language)), source: "merged" });
    }

    return Response.json({ categories: [], updatedAt: null, source: "empty" });
  } catch (err) {
    console.error("Trend rankings error:", err);
    return Response.json({ categories: [], updatedAt: null, source: "error" });
  }
};

function formatDbRows(rows: Record<string, unknown>[]) {
  const map = new Map<
    number,
    CategoryData
  >();
  let latest: Date | null = null;

  for (const row of rows) {
    const cid = row.cid as number;
    if (!map.has(cid)) {
      map.set(cid, {
        cid: String(cid),
        label: row.category_label as string,
        rankings: [],
      });
    }
    map.get(cid)!.rankings.push({
      rank: (row.rank as number) || 0,
      keyword: row.keyword as string,
      ratio: 0,
      delta: row.change_rate as number,
      trend: (row.trend as string) || "flat",
    });
    const ts = new Date(row.updated_at as string);
    if (!latest || ts > latest) latest = ts;
  }

  return {
    categories: Array.from(map.values()),
    updatedAt: latest?.toISOString() || null,
  };
}
