import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { getSupabaseServer } from "./_shared/supabase.mts";
import { ensureTimelineRoom } from "./_shared/timeline-room.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import {
  addSettlementForProposal,
  parseAmount,
  removeCollabScheduleRecord,
  removeSettlementsForProposal,
  upsertCollabScheduleRecord,
} from "./_shared/collab-records.mts";

/** YYYY-MM-DD 만 통과시킨다. 빈 값·타임스탬프·잘못된 문자열은 빈 문자열. */
const ymd = (value: unknown): string => {
  const s = String(value ?? "").trim().split("T")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};

/** 협업 내역 상태 판정 기준일. 서버 시각이 UTC 라서 한국 날짜로 맞춘다. */
const todayInSeoul = (): string =>
  new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  const proposalId = context.params.id;
  if (!username || !proposalId) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  // 수락/거절은 정산 항목을 만들고 업체에 알림톡까지 보낸다. 삭제도 되돌릴 수
  // 없다. 제안을 받은 본인(또는 관리자)만 상태를 바꿀 수 있어야 한다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

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
      const { getDatabase } = await import("@picks/netlify-database");
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
      // 방은 제안이 도착할 때 이미 열려 있다(api-proposals POST). 여기서는 수락
      // 안내만 덧붙이고, 예전 제안이나 방 생성이 실패했던 건은 이 시점에 만든다.
      try {
        await ensureTimelineRoom({
          proposalId,
          influencerUsername: username,
          businessUsername: bizUsername,
          companyName: updatedProposal.company_name || "",
          proposalTitle: updatedProposal.title || "",
          systemMessage: `"${updatedProposal.title || "협업 제안"}" 협업 제안이 수락되었습니다. 메시지를 보내 소통을 시작해보세요!`,
          appendIfExists: true,
        });
      } catch (e) {
        console.error("Failed to create timeline on accept:", e);
      }

      // 협업일정 등록 — 비즈니스 제안으로 성사된 협업도 협업 내역(캘린더)에 올린다.
      //
      // 담당자 리스트업으로 진행되는 캠페인 협업은 담당자가 일정을 체크하면
      // (api-collab-workflow 의 confirm_schedule) 그 즉시 협업 내역에 한 줄이
      // 생긴다. 반면 비즈니스 제안으로 성사된 협업은 campaign_collabs 행이 없어
      // 체크할 화면 자체가 없었고, 업로드 확인 뒤 정산 항목이 생기기 전까지
      // 인플루언서 캘린더에 그 협업이 존재하지 않았다. 두 경로 전부 일정이
      // 잡히도록, 제안은 수락 시점에 제안서에 적힌 기간으로 자동 등록한다.
      //
      // collab_id 를 `proposal_<제안ID>` 로 두면 캠페인 협업 id 와 섞이지 않고,
      // 나중에 업체가 기간·금액을 고쳐도 같은 줄이 갱신된다(줄이 늘지 않는다).
      try {
        const startDate = ymd(updatedProposal.start_date) || todayInSeoul();
        const endDate = ymd(updatedProposal.end_date);
        const today = todayInSeoul();
        await upsertCollabScheduleRecord({
          collabId: `proposal_${proposalId}`,
          influencerUsername: username,
          title: updatedProposal.title || "협업 프로젝트",
          companyName: updatedProposal.company_name || "",
          // 제안 분류(광고 / 커머스)는 협업 내역 분류와 같은 값을 쓴다.
          category: updatedProposal.category === "커머스" ? "커머스" : "광고",
          date: startDate,
          endDate,
          fee: parseAmount(updatedProposal.fee),
          status: endDate && endDate < today ? "completed" : startDate <= today ? "in_progress" : "scheduled",
          memo: "비즈니스 제안 수락 시 자동 등록",
          source: "business_proposal",
          // 제안은 담당자가 아니라 인플루언서 본인의 수락으로 확정된다.
          confirmedBy: username,
        });
      } catch (schErr) {
        // 일정 등록에 실패해도 수락 자체는 되돌리지 않는다. 협업 내역에 한 줄이
        // 늦게 생기는 것보다, 수락이 실패한 것처럼 보이는 쪽이 더 나쁘다.
        console.error("[api-proposal-item] Failed to register collab schedule:", schErr);
      }

      // Auto-create settlement record for accepted proposal
      try {
        const stlId = `stl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const nowISO = new Date().toISOString();
        const scheduledDate = (() => {
          const d = new Date();
          d.setDate(d.getDate() + 30);
          return d.toISOString().split("T")[0];
        })();

        await addSettlementForProposal({
          id: stlId,
          proposal_id: proposalId,
          influencer_username: username,
          business_username: bizUsername,
          company_name: updatedProposal.company_name || "",
          title: updatedProposal.title || "협업 프로젝트",
          amount: parseAmount(updatedProposal.fee),
          scheduled_date: scheduledDate,
          status: "scheduled",
          memo: "제안 수락 시 자동 생성",
          created_at: nowISO,
          updated_at: nowISO,
        });
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

      // 제안에서 자동 생성된 정산 항목이 남아 있으면, 협업 내역에는 사라진
      // 협업이 정산금 화면에만 계속 떠 있게 된다. 같이 지운다.
      try {
        await removeSettlementsForProposal(proposalId, bizUsername, username);
      } catch (stlErr) {
        console.error("[api-proposal-item] Failed to remove linked settlements:", stlErr);
      }

      // 수락 시 자동 등록된 협업일정도 같이 지운다(사람이 직접 적은 줄은 남는다).
      try {
        await removeCollabScheduleRecord(`proposal_${proposalId}`, username);
      } catch (schErr) {
        console.error("[api-proposal-item] Failed to remove linked collab schedule:", schErr);
      }
    }

    // Delete from SQL
    try {
      const { getDatabase } = await import("@picks/netlify-database");
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
