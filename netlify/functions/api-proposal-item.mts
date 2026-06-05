import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { getSupabaseServer } from "./_shared/supabase.mts";

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
      // Persist the rejection reason too — it feeds the admin "거절 사유 통계".
      const rejectionReason = body.rejection_reason ?? updatedProposal.rejection_reason ?? null;
      await db.sql`
        UPDATE proposals SET
          status = ${body.status || updatedProposal.status || 'pending'},
          rejection_reason = ${rejectionReason},
          updated_at = NOW()
        WHERE id = ${proposalId}
      `;
    } catch (dbErr) {
      console.error("[api-proposal-item] Failed to update SQL:", dbErr);
    }

    // Mirror the status + rejection reason into Supabase `business_proposals`,
    // which is the table the operator dashboard / 거절 사유 통계 read from. This
    // is best-effort: a different id space simply updates 0 rows and is ignored.
    if (body.status) {
      try {
        const supabase = getSupabaseServer();
        const patch: Record<string, any> = {
          status: body.status,
          updated_at: new Date().toISOString(),
        };
        if (body.status === "rejected") {
          patch.rejection_reason = body.rejection_reason ?? updatedProposal.rejection_reason ?? null;
        }
        await supabase.from("business_proposals").update(patch).eq("id", proposalId);
      } catch (sbErr) {
        console.error("[api-proposal-item] Failed to mirror status to Supabase:", sbErr);
      }
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

      // Auto-create settlement record for accepted proposal
      try {
        const settlementStore = getStore("settlements");
        const stlId = `stl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const nowISO = new Date().toISOString();
        const fee = parseInt(updatedProposal.fee) || 0;
        const scheduledDate = (() => {
          const d = new Date();
          d.setDate(d.getDate() + 30);
          return d.toISOString().split("T")[0];
        })();

        const settlement = {
          id: stlId,
          proposal_id: proposalId,
          influencer_username: username,
          business_username: bizUsername,
          company_name: updatedProposal.company_name || "",
          title: updatedProposal.title || "협업 프로젝트",
          amount: fee,
          scheduled_date: scheduledDate,
          status: "scheduled",
          memo: "제안 수락 시 자동 생성",
          created_at: nowISO,
          updated_at: nowISO,
        };

        const getBizRecords = async () => {
          const k = `settlements_biz_${bizUsername}`;
          const data = (await settlementStore.get(k, { type: "json" })) as any;
          if (Array.isArray(data)) return data;
          if (data && Array.isArray(data.records)) return data.records;
          if (data && Array.isArray(data.settlements)) return data.settlements;
          return [];
        };
        const getInfRecords = async () => {
          const k = `settlements_inf_${username}`;
          const data = (await settlementStore.get(k, { type: "json" })) as any;
          if (Array.isArray(data)) return data;
          if (data && Array.isArray(data.records)) return data.records;
          if (data && Array.isArray(data.settlements)) return data.settlements;
          return [];
        };

        const [bizSettlements, infSettlements] = await Promise.all([getBizRecords(), getInfRecords()]);

        if (!bizSettlements.some((s: any) => s.proposal_id === proposalId)) {
          bizSettlements.push(settlement);
          await settlementStore.setJSON(`settlements_biz_${bizUsername}`, bizSettlements);
        }
        if (!infSettlements.some((s: any) => s.proposal_id === proposalId)) {
          infSettlements.push(settlement);
          await settlementStore.setJSON(`settlements_inf_${username}`, infSettlements);
        }
      } catch (stlErr) {
        console.error("[api-proposal-item] Failed to auto-create settlement:", stlErr);
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
