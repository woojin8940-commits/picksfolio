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

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_SNAPSHOTS_PER_USER = 20;

function isDestructiveUpdate(existing: Record<string, any>, incoming: Record<string, any>): boolean {
  if (!hasConnectedSiteContent(existing)) return false;

  const existingBlockCount = Array.isArray(existing.blocks) ? existing.blocks.length : 0;
  const incomingBlocks = incoming.blocks;

  if (incomingBlocks !== undefined) {
    if (!Array.isArray(incomingBlocks)) return true;
    if (existingBlockCount > 3 && incomingBlocks.length === 0) return true;
  }

  const existingPortfolioCount = Array.isArray(existing.portfolio) ? existing.portfolio.length : 0;
  const incomingPortfolio = incoming.portfolio;

  if (incomingPortfolio !== undefined) {
    if (!Array.isArray(incomingPortfolio)) return true;
    if (existingPortfolioCount > 3 && incomingPortfolio.length === 0) return true;
  }

  return false;
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
        SELECT data, cover_updated_at FROM site_data WHERE username = ${username}
      `;

      if (result.length > 0 && result[0].data && Object.keys(result[0].data).length > 0) {
        const dbData = result[0].data as Record<string, any>;
        if (result[0].cover_updated_at) {
          dbData.coverUpdatedAt = result[0].cover_updated_at;
        }
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
          const legacySiteData = profile.site_data;
          const hasLegacyContent =
            legacySiteData &&
            typeof legacySiteData === "object" &&
            (
              (Array.isArray(legacySiteData.blocks) && legacySiteData.blocks.length > 0) ||
              (Array.isArray(legacySiteData.portfolio) && legacySiteData.portfolio.length > 0) ||
              (Array.isArray(legacySiteData.productFolders) && legacySiteData.productFolders.length > 0)
            );

          const initialData: Record<string, any> = hasLegacyContent
            ? {
                ...legacySiteData,
                profile: legacySiteData.profile || {
                  name: profile.nickname || profile.full_name || username,
                  bio: profile.bio || "",
                  avatar_url: profile.avatar_url || "",
                },
              }
            : {
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

          try {
            const blobStore = getStore({ name: "site-data", consistency: "strong" });
            await blobStore.setJSON(username, initialData);
          } catch (syncErr) {
            console.warn("[api-site] Blob sync after Supabase fallback failed:", syncErr);
          }

          return Response.json(initialData);
        }
      }

      return Response.json(null, { status: 404 });
    }

    if (req.method === "POST") {
      const bodyText = await req.text();

      if (bodyText.length > MAX_PAYLOAD_BYTES) {
        return Response.json({ error: "Payload too large" }, { status: 413 });
      }

      let body: Record<string, any>;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return Response.json({ error: "Invalid payload" }, { status: 400 });
      }

      const existing = await db.sql`
        SELECT data, profile_code FROM site_data WHERE username = ${username}
      `;

      const existingData = existing.length > 0 ? (existing[0].data as Record<string, any> || {}) : {};

      if (existing.length > 0 && hasConnectedSiteContent(existingData) && isDestructiveUpdate(existingData, body)) {
        return Response.json({
          error: "이 요청은 기존 콘텐츠를 모두 삭제합니다. force=true 파라미터를 포함하여 다시 시도해 주세요.",
          code: "DESTRUCTIVE_UPDATE",
        }, { status: 409 });
      }

      if (existing.length > 0 && hasConnectedSiteContent(existingData)) {
        try {
          await db.sql`
            INSERT INTO site_data_snapshots (username, data, snapshot_reason)
            VALUES (${username}, ${JSON.stringify(existingData)}::jsonb, ${'pre-update'})
          `;

          await db.sql`
            DELETE FROM site_data_snapshots
            WHERE id IN (
              SELECT id FROM site_data_snapshots
              WHERE username = ${username}
              ORDER BY created_at DESC
              OFFSET ${MAX_SNAPSHOTS_PER_USER}
            )
          `;
        } catch (snapshotErr) {
          console.warn("[api-site] Snapshot creation failed (non-blocking):", snapshotErr);
        }
      }

      const oldCoverImage =
        existingData?.design?.portfolioHeaderImage ||
        existingData?.blocks?.[0]?.coverMedia ||
        existingData?.profile?.avatar_url || null;
      const newCoverImage =
        body?.design?.portfolioHeaderImage ||
        body?.blocks?.[0]?.coverMedia ||
        body?.profile?.avatar_url || null;
      const coverChanged = newCoverImage !== null && newCoverImage !== oldCoverImage;

      const bodyJson = JSON.stringify(body);

      if (existing.length > 0) {
        await db.sql`
          UPDATE site_data
          SET data = jsonb_strip_nulls(COALESCE(data, '{}'::jsonb) || ${bodyJson}::jsonb),
              updated_at = NOW()
          WHERE username = ${username}
        `;
        if (coverChanged) {
          await db.sql`
            UPDATE site_data SET cover_updated_at = NOW() WHERE username = ${username}
          `;
        }
      } else {
        const profileCode = await createUniqueProfileCode(db);
        const initialCoverAt = newCoverImage ? new Date().toISOString() : null;

        await db.sql`
          INSERT INTO site_data (username, data, profile_code, cover_updated_at)
          VALUES (${username}, ${bodyJson}::jsonb, ${profileCode}, ${initialCoverAt})
        `;
      }

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
