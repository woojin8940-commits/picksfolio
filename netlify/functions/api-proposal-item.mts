import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  const proposalId = context.params.id;
  if (!username || !proposalId) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  const store = getStore("proposals");
  const key = `proposals_${username}`;

  if (req.method === "PATCH") {
    const body = await req.json();
    const existing = (await store.get(key, { type: "json" })) as any[] || [];
    const idx = existing.findIndex((p: any) => p.id === proposalId);
    if (idx === -1) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const updatedProposal = { ...existing[idx], ...body, updatedAt: new Date().toISOString() };
    existing[idx] = updatedProposal;
    await store.setJSON(key, existing);

    const bizUsername = (updatedProposal.business_username || "").toLowerCase().replace(/^biz\//, "");
    if (bizUsername) {
      const bizStore = getStore("business-proposals");
      const bizKey = `biz_proposals_${bizUsername}`;
      const bizExisting = ((await bizStore.get(bizKey, { type: "json" })) as any[]) || [];
      const bizIdx = bizExisting.findIndex((p: any) => p.id === proposalId);
      if (bizIdx !== -1) {
        bizExisting[bizIdx] = { ...bizExisting[bizIdx], ...body, updatedAt: updatedProposal.updatedAt };
      } else {
        bizExisting.push({ ...updatedProposal });
      }
      await bizStore.setJSON(bizKey, bizExisting);
    }

    if (body.status === "accepted") {
      try {
        const timelineStore = getStore("timelines");
        const detailKey = `detail_${proposalId}`;
        const existingTimeline = await timelineStore.get(detailKey, { type: "json" });

        if (!existingTimeline) {
          const influencerUsername = username;
          const companyName = updatedProposal.company_name || "";
          const proposalTitle = updatedProposal.title || "";

          const timelineData = {
            proposalId,
            influencerUsername,
            businessUsername: bizUsername,
            companyName,
            proposalTitle,
            comments: [
              {
                id: `tc_${Date.now()}_system`,
                proposalId,
                authorType: "business",
                authorName: companyName || bizUsername,
                authorUsername: bizUsername,
                content: `"${proposalTitle}" 협업 제안이 수락되었습니다. 메시지를 보내 소통을 시작해보세요!`,
                createdAt: new Date().toISOString(),
                readBy: [influencerUsername],
              },
            ],
            createdAt: new Date().toISOString(),
          };

          await timelineStore.setJSON(detailKey, timelineData);

          const ensureIndex = async (type: string, uname: string) => {
            const indexKey = `index_${type}_${uname.toLowerCase()}`;
            const indexData = ((await timelineStore.get(indexKey, { type: "json" })) as any[]) || [];
            if (!indexData.some((t: any) => t.proposalId === proposalId)) {
              indexData.unshift({
                proposalId,
                influencerUsername,
                businessUsername: bizUsername,
                companyName,
                proposalTitle,
                createdAt: timelineData.createdAt,
              });
              await timelineStore.setJSON(indexKey, indexData);
            }
          };

          if (influencerUsername) await ensureIndex("influencer", influencerUsername);
          if (bizUsername) await ensureIndex("business", bizUsername);
        }
      } catch (e) {
        console.error("Failed to create timeline on accept:", e);
      }
    }

    return Response.json({ success: true });
  }

  if (req.method === "DELETE") {
    const existing = (await store.get(key, { type: "json" })) as any[] || [];
    const proposal = existing.find((p: any) => p.id === proposalId);
    const filtered = existing.filter((p: any) => p.id !== proposalId);
    await store.setJSON(key, filtered);

    if (proposal) {
      const bizUsername = (proposal.business_username || "").toLowerCase().replace(/^biz\//, "");
      if (bizUsername) {
        const bizStore = getStore("business-proposals");
        const bizKey = `biz_proposals_${bizUsername}`;
        const bizExisting = ((await bizStore.get(bizKey, { type: "json" })) as any[]) || [];
        const bizFiltered = bizExisting.filter((p: any) => p.id !== proposalId);
        await bizStore.setJSON(bizKey, bizFiltered);
      }
    }

    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/proposals/:username/:id",
};
