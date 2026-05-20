import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const url = new URL(req.url);
  const userType = url.searchParams.get("type") || "influencer";

  const store = getStore("timelines");
  const indexKey = `index_${userType}_${username}`;

  if (req.method === "GET") {
    let data = (await store.get(indexKey, { type: "json" })) as any[] | null;

    if (!data || data.length === 0) {
      const proposalStore = getStore("proposals");
      const { blobs } = await proposalStore.list();
      const rebuilt: any[] = [];

      for (const blob of blobs) {
        if (!blob.key.startsWith("proposals_")) continue;
        const items = (await proposalStore.get(blob.key, { type: "json" })) as any[];
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          if (item.status !== "accepted" && item.status !== "completed") continue;

          const bizUser = (item.business_username || "").toLowerCase().replace(/^biz\//, "");
          const infUser = (item.influencer_username || blob.key.replace("proposals_", "")).toLowerCase();

          const isMatch =
            (userType === "business" && bizUser === username) ||
            (userType === "influencer" && infUser === username);
          if (!isMatch) continue;

          const proposalId = item.id;
          const detailKey = `detail_${proposalId}`;
          let detail = await store.get(detailKey, { type: "json" });

          if (!detail) {
            const companyName = item.company_name || "";
            const proposalTitle = item.title || "";
            const timelineData = {
              proposalId,
              influencerUsername: infUser,
              businessUsername: bizUser,
              companyName,
              proposalTitle,
              comments: [
                {
                  id: `tc_${Date.now()}_rebuild_${proposalId}`,
                  proposalId,
                  authorType: "business",
                  authorName: companyName || bizUser,
                  authorUsername: bizUser,
                  content: `"${proposalTitle}" 협업 제안이 수락되었습니다. 메시지를 보내 소통을 시작해보세요!`,
                  createdAt: item.updatedAt || item.createdAt || new Date().toISOString(),
                  readBy: [infUser],
                },
              ],
              createdAt: item.updatedAt || item.createdAt || new Date().toISOString(),
            };
            await store.setJSON(detailKey, timelineData);
            detail = timelineData;

            const otherType = userType === "business" ? "influencer" : "business";
            const otherUser = userType === "business" ? infUser : bizUser;
            if (otherUser) {
              const otherIndexKey = `index_${otherType}_${otherUser}`;
              const otherIndex = ((await store.get(otherIndexKey, { type: "json" })) as any[]) || [];
              if (!otherIndex.some((t: any) => t.proposalId === proposalId)) {
                otherIndex.unshift({
                  proposalId,
                  influencerUsername: infUser,
                  businessUsername: bizUser,
                  companyName: item.company_name || "",
                  proposalTitle: item.title || "",
                  createdAt: timelineData.createdAt,
                });
                await store.setJSON(otherIndexKey, otherIndex);
              }
            }
          }

          rebuilt.push({
            proposalId,
            influencerUsername: infUser,
            businessUsername: bizUser,
            companyName: item.company_name || "",
            proposalTitle: item.title || "",
            createdAt: (detail as any)?.createdAt || item.createdAt,
          });
        }
      }

      if (rebuilt.length > 0) {
        rebuilt.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        await store.setJSON(indexKey, rebuilt);
        data = rebuilt;
      }
    }

    const timelines = data || [];

    const enriched = await Promise.all(
      timelines.map(async (t: any) => {
        const detailKey = `detail_${t.proposalId}`;
        const detail = (await store.get(detailKey, { type: "json" })) as any;
        const comments = detail?.comments || [];
        const unreadCount = comments.filter(
          (c: any) => !c.readBy?.includes(username)
        ).length;
        return {
          ...t,
          comments,
          unreadCount,
        };
      })
    );

    return Response.json({ timelines: enriched });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/list/:username",
};
