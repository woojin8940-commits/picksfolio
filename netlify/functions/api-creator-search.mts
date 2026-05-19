import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const db = getDatabase();
  const url = new URL(req.url);

  const query = url.searchParams.get("q")?.trim() || "";
  const category = url.searchParams.get("category")?.trim() || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  try {
    let result;

    if (query && category) {
      const pattern = `%${query}%`;
      result = await db.sql`
        SELECT username, data, profile_code, is_public, updated_at
        FROM site_data
        WHERE is_public = true
          AND data->>'category' = ${category}
          AND (
            data->'profile'->>'name' ILIKE ${pattern}
            OR username ILIKE ${pattern}
            OR data->'profile'->>'bio' ILIKE ${pattern}
            OR profile_code ILIKE ${pattern}
          )
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (query) {
      const pattern = `%${query}%`;
      result = await db.sql`
        SELECT username, data, profile_code, is_public, updated_at
        FROM site_data
        WHERE is_public = true
          AND (
            data->'profile'->>'name' ILIKE ${pattern}
            OR username ILIKE ${pattern}
            OR data->'profile'->>'bio' ILIKE ${pattern}
            OR profile_code ILIKE ${pattern}
          )
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (category) {
      result = await db.sql`
        SELECT username, data, profile_code, is_public, updated_at
        FROM site_data
        WHERE is_public = true AND data->>'category' = ${category}
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      result = await db.sql`
        SELECT username, data, profile_code, is_public, updated_at
        FROM site_data
        WHERE is_public = true
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const creators = result.map((row: any) => {
      const d = row.data || {};
      return {
        username: row.username,
        display_name: d.profile?.name || row.username,
        bio: d.profile?.bio || "",
        avatar_url: d.profile?.avatar_url || "",
        category: d.category || "",
        tags: Array.isArray(d.tags) ? d.tags.join(",") : (d.tags || ""),
        profile_code: row.profile_code,
        page_url: `/${row.username}`,
        block_count: Array.isArray(d.blocks) ? d.blocks.length : 0,
        updated_at: row.updated_at,
      };
    });

    return Response.json({
      creators,
      count: creators.length,
      offset,
      limit,
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || "Search failed" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/creators/search",
};
