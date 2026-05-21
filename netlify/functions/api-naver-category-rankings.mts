import { getDatabase } from "@netlify/database";
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

const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;

interface CategoryData {
  cid: string;
  label: string;
  rankings: { rank: number; keyword: string; ratio: number; delta: number; trend: string }[];
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
      return Response.json({ ...dbResult, source: "db" });
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
      return Response.json({ ...result, source: "merged" });
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
