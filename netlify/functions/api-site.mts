import { getDatabase } from "@netlify/database";
import { createClient } from "@supabase/supabase-js";
import type { Config, Context } from "@netlify/functions";

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

function generateProfileCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getSupabaseAdmin() {
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return null;
  return createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  try {
    const db = getDatabase();

    if (req.method === "GET") {
      const result = await db.sql`
        SELECT data FROM site_data WHERE username = ${username}
      `;

      if (result.length > 0 && result[0].data && Object.keys(result[0].data).length > 0) {
        return Response.json(result[0].data);
      }

      const supabase = getSupabaseAdmin();
      if (supabase) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("username", username)
          .maybeSingle();

        if (profile) {
          const initialData: Record<string, any> = {
            profile: {
              name: profile.nickname || profile.full_name || username,
              bio: profile.bio || "",
              avatar_url: profile.avatar_url || "",
            },
            design: {},
            socials: {},
            blocks: [],
          };

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

          await db.sql`
            INSERT INTO site_data (username, data, profile_code)
            VALUES (${username}, ${JSON.stringify(initialData)}, ${profileCode})
            ON CONFLICT (username) DO NOTHING
          `;

          return Response.json(initialData);
        }
      }

      return Response.json(null, { status: 404 });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const bodyJson = JSON.stringify(body);

      const existing = await db.sql`
        SELECT profile_code FROM site_data WHERE username = ${username}
      `;

      if (existing.length > 0) {
        await db.sql`
          UPDATE site_data
          SET data = jsonb_strip_nulls(COALESCE(data, '{}'::jsonb) || ${bodyJson}::jsonb),
              updated_at = NOW()
          WHERE username = ${username}
        `;
      } else {
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

        await db.sql`
          INSERT INTO site_data (username, data, profile_code)
          VALUES (${username}, ${bodyJson}::jsonb, ${profileCode})
        `;
      }

      return Response.json({ success: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (err: any) {
    const message = err?.cause?.message || err?.message || "Internal server error";
    console.error("[api-site]", req.method, username, message);
    return Response.json({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/site/:username",
};
