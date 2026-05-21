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
    const seenIds = new Set<string>();
    const allProposals: any[] = [];

    const [cachedData, sqlProposals, campaignRows] = await Promise.all([
      store.get(key, { type: "json" }).catch(() => null),
      (async () => {
        try {
          const { getDatabase } = await import("@netlify/database");
          const db = getDatabase();
          return await db.sql`
            SELECT * FROM proposals
            WHERE LOWER(COALESCE(business_username, '')) = ${username}
            ORDER BY created_at DESC
          ` as any[];
        } catch { return []; }
      })(),
      (async () => {
        try {
          const { getDatabase } = await import("@netlify/database");
          const db = getDatabase();
          return await db.sql`
            SELECT ca.*, c.title as campaign_title, c.business_username as biz_user, c.brand_name, c.type as campaign_type,
                   c.description, c.start_date, c.end_date, c.reward_amount
            FROM campaign_applications ca
            JOIN campaigns c ON c.id = ca.campaign_id
            WHERE ca.status = 'accepted'
            AND LOWER(REPLACE(c.business_username, 'biz/', '')) = ${username}
          ` as any[];
        } catch { return []; }
      })(),
    ]);

    if (Array.isArray(sqlProposals)) {
      for (const row of sqlProposals) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        allProposals.push({
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
          rejection_reason: row.rejection_reason || "",
          created_at: row.created_at || new Date().toISOString(),
          createdAt: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || "",
        });
      }
    }

    if (Array.isArray(campaignRows)) {
      for (const row of campaignRows) {
        const proposalId = `campaign_${row.campaign_id}_${(row.applicant_username || "").toLowerCase()}`;
        if (seenIds.has(proposalId)) continue;
        seenIds.add(proposalId);
        allProposals.push({
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
      }
    }

    const cached = Array.isArray(cachedData) ? cachedData as any[] : [];
    for (const item of cached) {
      if (item.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        allProposals.push(item);
      }
    }

    allProposals.sort((a: any, b: any) => new Date(b.createdAt || b.created_at || 0).getTime() - new Date(a.createdAt || a.created_at || 0).getTime());

    context.waitUntil(store.setJSON(key, allProposals).catch(() => {}));

    return Response.json({ proposals: allProposals });
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
