import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const db = getDatabase();

  try {
    if (req.method === "GET") {
      const snapshots = await db.sql`
        SELECT id, snapshot_reason, created_at,
               jsonb_array_length(COALESCE(data->'blocks', '[]'::jsonb)) as block_count,
               jsonb_array_length(COALESCE(data->'portfolio', '[]'::jsonb)) as portfolio_count
        FROM site_data_snapshots
        WHERE username = ${username}
        ORDER BY created_at DESC
        LIMIT 20
      `;

      return Response.json({ snapshots });
    }

    if (req.method === "POST") {
      const { snapshot_id } = await req.json() as { snapshot_id?: number };

      if (!snapshot_id) {
        return Response.json({ error: "snapshot_id is required" }, { status: 400 });
      }

      const snapshots = await db.sql`
        SELECT data FROM site_data_snapshots
        WHERE id = ${snapshot_id} AND username = ${username}
      `;

      if (snapshots.length === 0) {
        return Response.json({ error: "Snapshot not found" }, { status: 404 });
      }

      const snapshotData = snapshots[0].data as Record<string, any>;

      const current = await db.sql`
        SELECT data FROM site_data WHERE username = ${username}
      `;
      if (current.length > 0 && current[0].data) {
        await db.sql`
          INSERT INTO site_data_snapshots (username, data, snapshot_reason)
          VALUES (${username}, ${JSON.stringify(current[0].data)}::jsonb, ${'pre-restore'})
        `;
      }

      await db.sql`
        UPDATE site_data
        SET data = ${JSON.stringify(snapshotData)}::jsonb,
            updated_at = NOW()
        WHERE username = ${username}
      `;

      try {
        const blobStore = getStore({ name: "site-data", consistency: "strong" });
        await blobStore.setJSON(username, snapshotData);
      } catch (syncErr) {
        console.warn("[api-site-restore] Blob sync failed:", syncErr);
      }

      return Response.json({ success: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (err: any) {
    console.error("[api-site-restore]", err);
    return Response.json({ error: err?.message || "Internal server error" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/site-restore/:username",
};
