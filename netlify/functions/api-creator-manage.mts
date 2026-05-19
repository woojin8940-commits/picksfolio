import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";

function generateProfileCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const username = url.searchParams.get("username")?.trim().toLowerCase();
    if (!username) {
      return Response.json({ error: "Missing username" }, { status: 400 });
    }

    try {
      const result = await db.sql`
        SELECT username, data, profile_code, is_public, created_at, updated_at
        FROM site_data
        WHERE username = ${username}
      `;

      if (result.length === 0) {
        return Response.json({ profile: null });
      }

      const row = result[0];
      const d = row.data || {};
      return Response.json({
        profile: {
          username: row.username,
          display_name: d.profile?.name || d.profileName || row.username,
          bio: d.profile?.bio || "",
          avatar_url: d.profile?.avatar_url || "",
          cover_url: d.design?.portfolioHeaderImage || "",
          category: d.category || "",
          tags: Array.isArray(d.tags) ? d.tags.join(",") : (d.tags || ""),
          profile_code: row.profile_code,
          is_public: row.is_public,
          page_url: `/${row.username}`,
          block_count: Array.isArray(d.blocks) ? d.blocks.length : 0,
          sns_links: d.socials || {},
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      });
    } catch (err: any) {
      return Response.json({ error: err?.message || "Failed to fetch profile" }, { status: 500 });
    }
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const { action, username } = body;

      if (!username) {
        return Response.json({ error: "Missing username" }, { status: 400 });
      }

      const clean = username.trim().toLowerCase();

      if (action === "regenerate-code") {
        let newCode = generateProfileCode();
        let attempts = 0;
        while (attempts < 10) {
          const dup = await db.sql`
            SELECT 1 FROM site_data WHERE profile_code = ${newCode}
          `;
          if (dup.length === 0) break;
          newCode = generateProfileCode();
          attempts++;
        }

        await db.sql`
          UPDATE site_data
          SET profile_code = ${newCode}, updated_at = NOW()
          WHERE username = ${clean}
        `;

        return Response.json({ success: true, profile_code: newCode });
      }

      if (action === "toggle-visibility") {
        const isPublic = body.is_public !== false;
        await db.sql`
          UPDATE site_data
          SET is_public = ${isPublic}, updated_at = NOW()
          WHERE username = ${clean}
        `;
        return Response.json({ success: true, is_public: isPublic });
      }

      if (action === "update") {
        const { display_name, bio, category, tags, sns_links } = body;

        const existing = await db.sql`
          SELECT profile_code, data FROM site_data WHERE username = ${clean}
        `;

        if (existing.length === 0) {
          let profileCode = generateProfileCode();
          let attempts = 0;
          while (attempts < 5) {
            const dup = await db.sql`
              SELECT 1 FROM site_data WHERE profile_code = ${profileCode}
            `;
            if (dup.length === 0) break;
            profileCode = generateProfileCode();
            attempts++;
          }

          const newData = {
            profile: { name: display_name || clean, bio: bio || "", avatar_url: "" },
            design: {},
            socials: sns_links || {},
            category: category || "",
            tags: tags ? tags.split(",") : [],
            blocks: [],
          };

          await db.sql`
            INSERT INTO site_data (username, data, profile_code)
            VALUES (${clean}, ${JSON.stringify(newData)}, ${profileCode})
          `;

          return Response.json({ success: true, profile_code: profileCode });
        }

        const currentData = existing[0].data || {};
        if (display_name) {
          currentData.profile = currentData.profile || {};
          currentData.profile.name = display_name;
        }
        if (bio !== undefined) {
          currentData.profile = currentData.profile || {};
          currentData.profile.bio = bio;
        }
        if (category !== undefined) currentData.category = category;
        if (tags !== undefined) currentData.tags = tags ? tags.split(",") : [];
        if (sns_links) currentData.socials = sns_links;

        await db.sql`
          UPDATE site_data
          SET data = ${JSON.stringify(currentData)}, updated_at = NOW()
          WHERE username = ${clean}
        `;

        return Response.json({ success: true });
      }

      return Response.json({ error: "Unknown action" }, { status: 400 });
    } catch (err: any) {
      return Response.json({ error: err?.message || "Failed to update profile" }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/creators/manage",
};
