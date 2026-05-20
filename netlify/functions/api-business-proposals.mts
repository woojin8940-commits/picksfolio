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

    if (!data || data.length === 0) {
      const proposalStore = getStore("proposals");
      const { blobs } = await proposalStore.list();
      const rebuilt: any[] = [];
      const seenIds = new Set<string>();

      for (const blob of blobs) {
        if (!blob.key.startsWith("proposals_")) continue;
        const items = (await proposalStore.get(blob.key, { type: "json" })) as any[];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const itemBiz = (item.business_username || "").toLowerCase().replace(/^biz\//, "");
          if (itemBiz === username && !seenIds.has(item.id)) {
            seenIds.add(item.id);
            rebuilt.push(item);
          }
        }
      }

      // Also check timeline detail blobs for campaign-based collaborations
      try {
        const timelineStore = getStore("timelines");
        const { blobs: timelineBlobs } = await timelineStore.list({ prefix: "detail_campaign_" });
        for (const tBlob of timelineBlobs) {
          const detail = (await timelineStore.get(tBlob.key, { type: "json" })) as any;
          if (!detail || !detail.proposalId) continue;
          const bizUser = (detail.businessUsername || "").toLowerCase().replace(/^biz\//, "");
          if (bizUser !== username) continue;
          if (seenIds.has(detail.proposalId)) continue;
          seenIds.add(detail.proposalId);
          rebuilt.push({
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
        }
      } catch (e) {
        console.error("[business-proposals] Failed to scan timeline blobs:", e);
      }

      if (rebuilt.length > 0) {
        rebuilt.sort((a, b) => new Date(b.createdAt || b.created_at || 0).getTime() - new Date(a.createdAt || a.created_at || 0).getTime());
        await store.setJSON(key, rebuilt);
        data = rebuilt;
      }
    }

    return Response.json({ proposals: data || [] });
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
