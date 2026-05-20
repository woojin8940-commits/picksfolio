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

    // Update SQL database
    try {
      const { getDatabase } = await import("@netlify/database");
      const db = getDatabase();
      await db.sql`
        UPDATE proposals SET
          status = ${body.status || updatedProposal.status || 'pending'},
          updated_at = NOW()
        WHERE id = ${proposalId}
      `;
    } catch (dbErr) {
      console.error("[api-proposal-item] Failed to update SQL:", dbErr);
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
          const nowISO = new Date().toISOString();

          const systemComment = {
            id: `tc_${Date.now()}_system`,
            proposalId,
            authorType: "business",
            authorName: companyName || bizUsername,
            authorUsername: bizUsername,
            content: `"${proposalTitle}" 협업 제안이 수락되었습니다. 메시지를 보내 소통을 시작해보세요!`,
            createdAt: nowISO,
            readBy: [influencerUsername],
          };

          const timelineData = {
            proposalId,
            influencerUsername,
            businessUsername: bizUsername,
            companyName,
            proposalTitle,
            comments: [systemComment],
            createdAt: nowISO,
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

          // Persist timeline to SQL
          try {
            const { getDatabase } = await import("@netlify/database");
            const db = getDatabase();
            await db.sql`
              INSERT INTO timelines (proposal_id, influencer_username, business_username, company_name, proposal_title, created_at)
              VALUES (${proposalId}, ${influencerUsername}, ${bizUsername}, ${companyName}, ${proposalTitle}, NOW())
              ON CONFLICT (proposal_id) DO NOTHING
            `;
            await db.sql`
              INSERT INTO timeline_messages (id, proposal_id, author_type, author_name, author_username, content, read_by, created_at)
              VALUES (${systemComment.id}, ${proposalId}, ${systemComment.authorType}, ${systemComment.authorName}, ${systemComment.authorUsername}, ${systemComment.content}, ${[influencerUsername]}, NOW())
              ON CONFLICT (id) DO NOTHING
            `;
          } catch (dbErr) {
            console.error("[api-proposal-item] Failed to persist timeline to SQL:", dbErr);
          }
        }
      } catch (e) {
        console.error("Failed to create timeline on accept:", e);
      }
    }

    // Send alimtalk notification to business when proposal status changes
    if (bizUsername && (body.status === "accepted" || body.status === "rejected")) {
      try {
        const siteOrigin = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";
        const templateId = Netlify.env.get("SOLAPI_KAKAO_TIMELINE_TEMPLATE_ID") || "";
        const proposalTitle = updatedProposal.title || "협업 제안";
        const statusText = body.status === "accepted" ? "수락" : "거절";
        const magicLink = body.status === "accepted"
          ? `${siteOrigin}/admin?tab=timeline&proposal=${proposalId}`
          : `${siteOrigin}/admin?tab=inbox`;

        await fetch(`${siteOrigin}/api/send-kakao-alimtalk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: bizUsername,
            message: `[픽스폴리오] 협업 제안 ${statusText}\n\n@${username}님이 "${proposalTitle}" 협업 제안을 ${statusText}했습니다.\n\n아래 링크에서 확인하세요.\n${magicLink}`,
            templateId,
            variables: {
              "#{고객명}": bizUsername,
              "#{업체명}": updatedProposal.company_name || bizUsername,
              "#{프로젝트명}": proposalTitle,
              "#{메시지내용}": `@${username}님이 협업 제안을 ${statusText}했습니다.`,
              "#{링크연결}": magicLink,
            },
          }),
        });
      } catch (notifErr) {
        console.error("[api-proposal-item] Failed to send status alimtalk to business:", notifErr);
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

    // Delete from SQL
    try {
      const { getDatabase } = await import("@netlify/database");
      const db = getDatabase();
      await db.sql`DELETE FROM proposals WHERE id = ${proposalId}`;
    } catch (dbErr) {
      console.error("[api-proposal-item] Failed to delete from SQL:", dbErr);
    }

    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/proposals/:username/:id",
};
