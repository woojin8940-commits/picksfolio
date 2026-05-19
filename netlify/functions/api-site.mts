import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { createClient } from "@supabase/supabase-js";
import type { Config, Context } from "@netlify/functions";
import { createUniqueProfileCode, hasConnectedSiteContent, recoverSiteDataFromBlob } from "./_shared/site-data-recovery.mts";

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

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
        const dbData = result[0].data as Record<string, any>;
        if (hasConnectedSiteContent(dbData)) {
          return Response.json(dbData);
        }

        try {
          const restored = await recoverSiteDataFromBlob(db, username);
          if (restored && hasConnectedSiteContent(restored)) {
            return Response.json(restored);
          }
        } catch (blobErr) {
          console.warn("[api-site] Blob content recovery failed:", blobErr);
        }

        return Response.json(dbData);
      }

      // Check blob store as fallback (data may exist there from earlier saves)
      try {
        const blobData = await recoverSiteDataFromBlob(db, username);
        if (blobData) {
          return Response.json(blobData);
        }
      } catch (blobErr) {
        console.warn("[api-site] Blob fallback failed:", blobErr);
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

          const profileCode = await createUniqueProfileCode(db);

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
        const profileCode = await createUniqueProfileCode(db);

        await db.sql`
          INSERT INTO site_data (username, data, profile_code)
          VALUES (${username}, ${bodyJson}::jsonb, ${profileCode})
        `;
      }

      // Sync full merged data to blob store for backup and OG image proxy
      try {
        const mergedResult = await db.sql`
          SELECT data FROM site_data WHERE username = ${username}
        `;
        if (mergedResult.length > 0 && mergedResult[0].data) {
          const blobStore = getStore({ name: "site-data", consistency: "strong" });
          await blobStore.setJSON(username, mergedResult[0].data);
        }
      } catch (syncErr) {
        console.warn("[api-site] Blob sync failed:", syncErr);
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
