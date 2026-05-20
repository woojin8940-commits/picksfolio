import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("business-proposals");
  const key = `biz_proposals_${username}`;

  if (req.method === "GET") {
    let data = (await store.get(key, { type: "json" })) as any[] | null;
    const existing = Array.isArray(data) ? data : [];
    const seenIds = new Set<string>(existing.map((p: any) => p.id));
    let added = 0;
    const proposalStoreItems: any[] = [];

    // 1) Scan proposals blob store for matching business proposals
    try {
      const proposalStore = getStore("proposals");
      const { blobs } = await proposalStore.list();

      for (const blob of blobs) {
        if (!blob.key.startsWith("proposals_")) continue;
        try {
          const items = (await proposalStore.get(blob.key, { type: "json" })) as any[];
          if (!Array.isArray(items)) continue;
          for (const item of items) {
            const itemBiz = (item.business_username || "").toLowerCase().replace(/^biz\//, "");
            if (itemBiz === username) {
              proposalStoreItems.push(item);
              if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                existing.push(item);
                added++;
              }
            }
          }
        } catch (blobErr) {
          console.error(`[business-proposals] Failed to read blob ${blob.key}:`, blobErr);
        }
      }
    } catch (e) {
      console.error("[business-proposals] Failed to scan proposals store:", e);
    }

    // 2) Scan timeline detail blobs for proposals only visible in timelines
    try {
      const timelineStore = getStore("timelines");
      const { blobs: timelineBlobs } = await timelineStore.list({ prefix: "detail_" });
      for (const tBlob of timelineBlobs) {
        try {
          const detail = (await timelineStore.get(tBlob.key, { type: "json" })) as any;
          if (!detail || !detail.proposalId) continue;
          const bizUser = (detail.businessUsername || "").toLowerCase().replace(/^biz\//, "");
          if (bizUser !== username) continue;
          if (seenIds.has(detail.proposalId)) continue;
          seenIds.add(detail.proposalId);
          existing.push({
            id: detail.proposalId,
            influencer_username: detail.influencerUsername || "",
            category: "광고",
            company_name: detail.companyName || "",
            title: detail.proposalTitle || "",
            content: "",
            start_date: "",
            end_date: "",
            fee: 0,
            business_username: bizUser,
            status: "accepted",
            created_at: detail.createdAt || new Date().toISOString(),
            createdAt: detail.createdAt || new Date().toISOString(),
          });
          added++;
        } catch (blobErr) {
          console.error(`[business-proposals] Failed to read timeline blob ${tBlob.key}:`, blobErr);
        }
      }
    } catch (e) {
      console.error("[business-proposals] Failed to scan timeline blobs:", e);
    }

    // 3) Check campaign_applications DB for accepted applications
    try {
      const { getDatabase } = await import("@netlify/database");
      const db = getDatabase();
      const rows = await db.sql`
        SELECT ca.*, c.title as campaign_title, c.business_username as biz_user, c.brand_name, c.type as campaign_type,
               c.description, c.start_date, c.end_date, c.reward_amount
        FROM campaign_applications ca
        JOIN campaigns c ON c.id = ca.campaign_id
        WHERE ca.status = 'accepted'
        AND LOWER(REPLACE(c.business_username, 'biz/', '')) = ${username}
      `;
      if (Array.isArray(rows)) {
        for (const row of rows as any[]) {
          const proposalId = `campaign_${row.campaign_id}_${(row.applicant_username || "").toLowerCase()}`;
          if (seenIds.has(proposalId)) continue;
          seenIds.add(proposalId);
          existing.push({
            id: proposalId,
            influencer_username: (row.applicant_username || "").toLowerCase(),
            category: row.campaign_type === "group_buy" ? "커머스" : "광고",
            company_name: row.brand_name || "",
            title: row.campaign_title || "",
            content: row.description || "",
            start_date: row.start_date || "",
            end_date: row.end_date || "",
            fee: parseInt(row.reward_amount) || 0,
            business_username: username,
            status: "accepted",
            created_at: row.created_at || new Date().toISOString(),
            createdAt: row.created_at || new Date().toISOString(),
            updated_at: row.updated_at || "",
          });
          added++;
        }
      }
    } catch (e) {
      console.error("[business-proposals] Failed to scan campaign_applications DB:", e);
    }

    // 4) Recover from SQL proposals table
    try {
      const { getDatabase } = await import("@netlify/database");
      const db = getDatabase();
      const dbRows = await db.sql`
        SELECT * FROM proposals
        WHERE LOWER(COALESCE(business_username, '')) = ${username}
        ORDER BY created_at DESC
      `;
      if (Array.isArray(dbRows)) {
        for (const row of dbRows as any[]) {
          if (seenIds.has(row.id)) continue;
          seenIds.add(row.id);
          existing.push({
            id: row.id,
            influencer_username: row.influencer_username || row.username || "",
            category: row.category || "광고",
            company_name: row.company_name || "",
            title: row.title || "",
            content: row.content || row.description || "",
            start_date: row.start_date || "",
            end_date: row.end_date || "",
            fee: parseInt(row.fee) || 0,
            contact_email: row.contact_email || "",
            contact_person: row.contact_person || "",
            contact_phone: row.contact_phone || "",
            business_username: username,
            status: row.status || "pending",
            created_at: row.created_at || new Date().toISOString(),
            createdAt: row.created_at || new Date().toISOString(),
            updated_at: row.updated_at || "",
          });
          added++;
        }
      }
    } catch (e) {
      console.error("[business-proposals] Failed to recover from SQL proposals table:", e);
    }

    if (added > 0) {
      existing.sort((a: any, b: any) => new Date(b.createdAt || b.created_at || 0).getTime() - new Date(a.createdAt || a.created_at || 0).getTime());
      await store.setJSON(key, existing);
    }

    // Sync status from proposal store for existing items
    const merged = existing.map((p: any) => ({ ...p }));
    let statusUpdated = false;
    for (const item of proposalStoreItems) {
      const match = merged.find((m: any) => m.id === item.id);
      if (match && match.status !== item.status) {
        match.status = item.status;
        if (item.rejection_reason) match.rejection_reason = item.rejection_reason;
        if (item.updatedAt) match.updatedAt = item.updatedAt;
        if (item.updated_at) match.updated_at = item.updated_at;
        statusUpdated = true;
      }
    }

    if (statusUpdated) {
      await store.setJSON(key, merged);
    }

    return Response.json({ proposals: statusUpdated ? merged : existing });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const existing = (await store.get(key, { type: "json" })) as any[] || [];
    existing.push({
      id: `biz_${Date.now()}`,
      ...body,
      createdAt: new Date().toISOString(),
    });
    await store.setJSON(key, existing);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/business-proposals/:username",
};
