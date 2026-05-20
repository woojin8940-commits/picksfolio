import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const proposalId = context.params.proposalId;
  if (!proposalId) {
    return Response.json({ error: "Missing proposalId" }, { status: 400 });
  }

  const store = getStore("timelines");
  const key = `detail_${proposalId}`;

  if (req.method === "POST") {
    const body = await req.json();
    const existing = (await store.get(key, { type: "json" })) as any || {
      proposalId,
      influencerUsername: body.influencerUsername || "",
      businessUsername: body.businessUsername || "",
      companyName: body.companyName || "",
      proposalTitle: body.proposalTitle || "",
      comments: [],
      createdAt: new Date().toISOString(),
    };

    const comment = {
      id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      proposalId,
      authorType: body.authorType,
      authorName: body.authorName,
      authorUsername: body.authorUsername,
      content: body.content || "",
      createdAt: new Date().toISOString(),
      readBy: [body.authorUsername?.toLowerCase()],
      ...(body.attachments ? { attachments: body.attachments } : {}),
    };

    existing.comments = existing.comments || [];
    existing.comments.push(comment);

    if (body.influencerUsername) existing.influencerUsername = body.influencerUsername;
    if (body.businessUsername) existing.businessUsername = body.businessUsername;
    if (body.companyName) existing.companyName = body.companyName;
    if (body.proposalTitle) existing.proposalTitle = body.proposalTitle;

    await store.setJSON(key, existing);

    const ensureIndex = async (type: string, username: string) => {
      const indexKey = `index_${type}_${username.toLowerCase()}`;
      const indexData = ((await store.get(indexKey, { type: "json" })) as any[]) || [];
      const exists = indexData.some((t: any) => t.proposalId === proposalId);
      if (!exists) {
        indexData.unshift({
          proposalId,
          influencerUsername: existing.influencerUsername,
          businessUsername: existing.businessUsername,
          companyName: existing.companyName,
          proposalTitle: existing.proposalTitle,
          createdAt: existing.createdAt,
        });
        await store.setJSON(indexKey, indexData);
      }
    };

    if (existing.influencerUsername) {
      await ensureIndex("influencer", existing.influencerUsername);
    }
    if (existing.businessUsername) {
      await ensureIndex("business", existing.businessUsername);
    }

    return Response.json({ success: true, comment });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/comment/:proposalId",
};
