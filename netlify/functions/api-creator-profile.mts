import { getDatabase } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const db = getDatabase();
  const identifier = context.params.identifier?.trim().toLowerCase();

  if (!identifier) {
    return Response.json({ error: "Missing identifier" }, { status: 400 });
  }

  try {
    const byUsername = await db.sql`
      SELECT username, data, profile_code, is_public, updated_at
      FROM site_data
      WHERE username = ${identifier} AND is_public = true
    `;

    if (byUsername.length > 0) {
      return Response.json({ creator: formatCreator(byUsername[0]) });
    }

    const byCode = await db.sql`
      SELECT username, data, profile_code, is_public, updated_at
      FROM site_data
      WHERE profile_code = ${identifier} AND is_public = true
    `;

    if (byCode.length > 0) {
      return Response.json({ creator: formatCreator(byCode[0]) });
    }

    return Response.json({ error: "Creator not found" }, { status: 404 });
  } catch (err: any) {
    return Response.json({ error: err?.message || "Lookup failed" }, { status: 500 });
  }
};

function formatCreator(row: any) {
  const d = row.data || {};
  return {
    username: row.username,
    display_name: d.profile?.name || row.username,
    bio: d.profile?.bio || "",
    avatar_url: d.profile?.avatar_url || "",
    cover_url: d.design?.portfolioHeaderImage || "",
    category: d.category || "",
    tags: Array.isArray(d.tags) ? d.tags.join(",") : (d.tags || ""),
    profile_code: row.profile_code,
    page_url: `/${row.username}`,
    block_count: Array.isArray(d.blocks) ? d.blocks.length : 0,
    sns_links: d.socials || {},
    updated_at: row.updated_at,
  };
}

export const config: Config = {
  path: "/api/creators/:identifier",
};
