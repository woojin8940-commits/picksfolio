import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { getSupabaseServer } from "./_shared/supabase.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { ensureTimelineRoom } from "./_shared/timeline-room.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { sendKakaoAlimtalk } from "./_shared/kakao-message.mts";
import {
  isProposalAlive,
  loadDeletedProposalIds,
  markProposalDeleted,
} from "./_shared/proposal-tombstones.mts";
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

const canChangeStatus = (current: string, next: string): boolean => {
  if (current === next) return true;
  if (current === "pending") return next === "accepted" || next === "rejected";
  return current === "accepted" && next === "completed";
};

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

  const STORE = "proposals";
  const store = getStore(STORE);
  const key = `proposals_${username}`;

  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const status = String(body.status || "").trim();
    if (!["accepted", "rejected", "completed"].includes(status)) {
      return Response.json({ error: "잘못된 상태값입니다." }, { status: 400 });
    }
    const rejectionReason = status === "rejected"
      ? String(body.rejection_reason || "").trim().slice(0, 1000)
      : "";
    if (status === "rejected" && !rejectionReason) {
      return Response.json({ error: "거절 사유를 입력해 주세요." }, { status: 400 });
    }
    const changes = { status, rejection_reason: rejectionReason };
    const updatedAt = new Date().toISOString();

    /**
     * 고칠 제안을 찾는다 — Blobs 캐시 먼저, 없으면 SQL.
     *
     * 수신함 목록(api-proposals GET)은 SQL 과 Blobs 를 합쳐 보여 주고, SQL 에만 있던
     * 제안은 응답을 보낸 뒤에(waitUntil) Blobs 캐시로 옮겨 적는다. 그래서 캐시에
     * 아직 없는 제안이 화면에는 이미 떠 있는 순간이 존재한다 — 그 사이에 수락을
     * 누르면 예전 코드는 404 를 돌려주고 화면에는 "상태 업데이트에 실패했습니다"가
     * 떴다. 제안은 분명히 보이는데 수락이 안 되는 상태이고, 다시 눌러도 캐시 쓰기가
     * 실패했다면 계속 실패한다.
     *
     * 조건부 쓰기(mutateBlobJSON)를 쓰는 이유: 통째로 덮어쓰면 수락을 처리하는 동안
     * 도착한 새 제안이 캐시에서 지워진다.
     */
    let updatedProposal: any = null;
    let proposalFoundInCache = false;
    let invalidTransition = false;
    let statusChanged = false;
    await mutateBlobJSON<any[]>(STORE, key, (current) => {
      const list = Array.isArray(current) ? [...current] : [];
      const idx = list.findIndex((p: any) => p?.id === proposalId);
      if (idx === -1) return null;
      proposalFoundInCache = true;
      const currentStatus = String(list[idx]?.status || "pending").trim().toLowerCase();
      invalidTransition = !canChangeStatus(currentStatus, status);
      if (invalidTransition) return null;
      statusChanged = currentStatus !== status;
      updatedProposal = { ...list[idx], ...changes, updatedAt };
      const reasonChanged = String(list[idx]?.rejection_reason || "") !== rejectionReason;
      if (!statusChanged && !reasonChanged) return null;
      list[idx] = updatedProposal;
      return list;
    });

    if (proposalFoundInCache && invalidTransition) {
      return Response.json({ error: "현재 상태에서는 해당 변경을 할 수 없습니다." }, { status: 409 });
    }

    if (!updatedProposal) {
      const [rows, deletedIds] = await Promise.all([
        (async () => {
          try {
            const { getDatabase } = await import("@picks/netlify-database");
            const db = getDatabase();
            // 소유자 조건을 SQL 에도 건다. 목록과 달리 여기는 id 하나로 들어오므로,
            // 남의 제안 id 를 넣어 상태를 바꾸는 길이 열려 있으면 안 된다.
            return (await db.sql`
              SELECT * FROM proposals
              WHERE id = ${proposalId}
                AND (LOWER(username) = ${username} OR LOWER(influencer_username) = ${username})
              LIMIT 1
            `) as any[];
          } catch (dbErr) {
            console.error("[api-proposal-item] Failed to look up proposal in SQL:", dbErr);
            return null;
          }
        })(),
        loadDeletedProposalIds().catch(() => new Set<string>()) as Promise<Set<string>>,
      ]);

      const row = Array.isArray(rows) ? rows[0] : null;
      // 지운 제안은 되살리지 않는다. 캐시에 없는 이유가 "삭제됨"일 수도 있다.
      if (!row || !isProposalAlive(deletedIds, proposalId)) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }

      const currentStatus = String(row.status || "pending").trim().toLowerCase();
      if (!canChangeStatus(currentStatus, status)) {
        return Response.json({ error: "현재 상태에서는 해당 변경을 할 수 없습니다." }, { status: 409 });
      }
      statusChanged = currentStatus !== status;

      updatedProposal = {
        id: row.id,
        influencer_username: row.influencer_username || row.username || username,
        category: row.category || "광고",
        company_name: row.company_name || "",
        contact_person: row.contact_person || "",
        contact_email: row.contact_email || "",
        contact_phone: row.contact_phone || "",
        title: row.title || "",
        content: row.content || row.description || "",
        start_date: row.start_date || "",
        end_date: row.end_date || "",
        fee: row.fee || 0,
        business_username: row.business_username || "",
        created_at: row.created_at || updatedAt,
        createdAt: row.created_at || updatedAt,
        ...changes,
        updatedAt,
      };

      // 캐시에도 넣어 둔다. 다음 PATCH·DELETE 가 같은 자리에서 찾을 수 있어야 한다.
      await mutateBlobJSON<any[]>(STORE, key, (current) => {
        const list = Array.isArray(current) ? [...current] : [];
        const idx = list.findIndex((p: any) => p?.id === proposalId);
        if (idx === -1) list.push(updatedProposal);
        else {
          const latestStatus = String(list[idx]?.status || "pending").trim().toLowerCase();
          if (!canChangeStatus(latestStatus, status)) {
            invalidTransition = true;
            return null;
          }
          statusChanged = latestStatus !== status;
          updatedProposal = { ...list[idx], ...changes, updatedAt };
          list[idx] = updatedProposal;
        }
        return list;
      }).catch((cacheErr) => {
        // 캐시 쓰기가 실패해도 상태 변경은 계속한다. SQL 이 원본이고, 목록 조회가
        // 다음 번에 다시 옮겨 적는다.
        console.error("[api-proposal-item] Failed to cache proposal for PATCH:", cacheErr);
        return null;
      });
      if (invalidTransition) {
        return Response.json({ error: "현재 상태에서는 해당 변경을 할 수 없습니다." }, { status: 409 });
      }
    }

    const bizUsername = (updatedProposal.business_username || "").toLowerCase().replace(/^biz\//, "");
    if (bizUsername) {
      const bizKey = `biz_proposals_${bizUsername}`;
      await mutateBlobJSON<any[]>("business-proposals", bizKey, (current) => {
        const list = Array.isArray(current) ? [...current] : [];
        const index = list.findIndex((p: any) => p?.id === proposalId);
        if (index === -1) list.push({ ...updatedProposal });
        else list[index] = { ...list[index], ...changes, updatedAt: updatedProposal.updatedAt };
        return list;
      });
    }

    // Update SQL database
    try {
      const { getDatabase } = await import("@picks/netlify-database");
      const db = getDatabase();
      // Persist the rejection reason too — it feeds the admin "거절 사유 통계".
      await db.sql`
        UPDATE proposals SET
          status = ${status},
          rejection_reason = ${rejectionReason || null},
          updated_at = NOW()
        WHERE id = ${proposalId}
          AND (LOWER(username) = ${username} OR LOWER(influencer_username) = ${username})
      `;
    } catch (dbErr) {
      console.error("[api-proposal-item] Failed to update SQL:", dbErr);
    }

    // Mirror the status + rejection reason into Supabase `business_proposals`,
    // which is the table the operator dashboard / 거절 사유 통계 read from. This
    // is best-effort: a different id space simply updates 0 rows and is ignored.
    if (status) {
      try {
        const supabase = getSupabaseServer();
        const patch: Record<string, any> = {
          status,
          updated_at: new Date().toISOString(),
        };
        if (status === "rejected") {
          patch.rejection_reason = rejectionReason || null;
        } else {
          patch.rejection_reason = null;
        }
        const writes: PromiseLike<any>[] = [
          supabase.from("business_proposals").update(patch).eq("id", proposalId),
        ];
        if (statusChanged && (status === "accepted" || status === "rejected")) {
          writes.push(
            supabase.from("admin_notifications").upsert({
              id: `proposal_${proposalId}_${status}`,
              type: `proposal_${status}`,
              influencer_username: username,
              proposal_id: proposalId,
              proposal_title: updatedProposal.title || "협업 제안",
              company_name: updatedProposal.company_name || "",
              category: updatedProposal.category || "",
              fee: parseAmount(updatedProposal.fee),
              rejection_reason: status === "rejected"
                ? rejectionReason || null
                : null,
              created_at: updatedAt,
              read: false,
            }, { onConflict: "id" }),
          );
        }
        const results = await Promise.all(writes);
        const failed = results.find((result: any) => result?.error);
        if (failed?.error) throw failed.error;
      } catch (sbErr) {
        console.error("[api-proposal-item] Failed to mirror status to Supabase:", sbErr);
      }
    }

    if (status === "accepted") {
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
          appendIfExists: statusChanged,
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
          /**
           * 수락한 제안은 "예정" 또는 "진행중"까지만 된다.
           *
           * 예전에는 종료일이 지났으면 완료로 적었다. 그런데 제안서 폼은 end_date 에
           * 마감일이 아니라 "시작 희망일"을 넣는다(시작일과 같은 값이다). 그래서 지난
           * 날짜로 제안된 건을 수락하면 방금 시작한 협업이 캘린더에 곧바로 완료로
           * 찍혔고, 정산이 남아 있는데도 끝난 일처럼 보였다. 완료는 업로드 확인과
           * 정산으로 닫힌다.
           */
          status: startDate <= today ? "in_progress" : "scheduled",
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
    if (statusChanged && bizUsername && (status === "accepted" || status === "rejected")) {
      try {
        const siteOrigin = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";
        const templateId = Netlify.env.get("SOLAPI_KAKAO_TIMELINE_TEMPLATE_ID") || "";
        const proposalTitle = updatedProposal.title || "협업 제안";
        const statusText = status === "accepted" ? "수락" : "거절";
        const encodedProposalId = encodeURIComponent(proposalId);
        const magicLink = status === "accepted"
          ? `${siteOrigin}/business-admin?tab=timeline&proposal=${encodedProposalId}`
          : `${siteOrigin}/business-admin?tab=inbox`;

        await sendKakaoAlimtalk({
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
        });
      } catch (notifErr) {
        console.error("[api-proposal-item] Failed to send status alimtalk to business:", notifErr);
      }
    }

    return Response.json({ success: true });
  }

  if (req.method === "DELETE") {
    let proposal: any = null;
    try {
      const cached = await store.get(key, { type: "json" });
      proposal = Array.isArray(cached)
        ? cached.find((p: any) => p?.id === proposalId) || null
        : null;
    } catch {}

    if (!proposal) {
      try {
        const { getDatabase } = await import("@picks/netlify-database");
        const db = getDatabase();
        const rows = await db.sql`
          SELECT * FROM proposals
          WHERE id = ${proposalId}
            AND (LOWER(username) = ${username} OR LOWER(influencer_username) = ${username})
          LIMIT 1
        `;
        proposal = rows[0] || null;
      } catch (dbErr) {
        console.error("[api-proposal-item] Failed to look up proposal for delete:", dbErr);
      }
    }

    if (!proposal) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    try {
      await markProposalDeleted(proposalId);
    } catch (tombErr) {
      console.error("[api-proposal-item] Failed to record delete tombstone:", tombErr);
    }

    await mutateBlobJSON<any[]>(STORE, key, (current) => {
      const list = Array.isArray(current) ? current : [];
      if (!list.some((p: any) => p?.id === proposalId)) return null;
      return list.filter((p: any) => p?.id !== proposalId);
    });

    const bizUsername = (proposal.business_username || "").toLowerCase().replace(/^biz\//, "");
    if (bizUsername) {
      const bizKey = `biz_proposals_${bizUsername}`;
      await mutateBlobJSON<any[]>("business-proposals", bizKey, (current) => {
        const list = Array.isArray(current) ? current : [];
        if (!list.some((p: any) => p?.id === proposalId)) return null;
        return list.filter((p: any) => p?.id !== proposalId);
      });
    }

    try {
      await removeSettlementsForProposal(proposalId, bizUsername, username);
    } catch (stlErr) {
      console.error("[api-proposal-item] Failed to remove linked settlements:", stlErr);
    }

    try {
      await removeCollabScheduleRecord(`proposal_${proposalId}`, username);
    } catch (schErr) {
      console.error("[api-proposal-item] Failed to remove linked collab schedule:", schErr);
    }

    // Delete from SQL
    try {
      const { getDatabase } = await import("@picks/netlify-database");
      const db = getDatabase();
      await db.sql`
        DELETE FROM proposals
        WHERE id = ${proposalId}
          AND (LOWER(username) = ${username} OR LOWER(influencer_username) = ${username})
      `;
    } catch (dbErr) {
      console.error("[api-proposal-item] Failed to delete from SQL:", dbErr);
    }

    // 예전 Supabase 미러도 비운다. 남겨 두면 SQL 이 비어 있는 동안 이 미러를 읽는
    // 경로에서 지운 제안이 다시 살아난다.
    try {
      const supabase = getSupabaseServer();
      if (supabase) await supabase.from("business_proposals").delete().eq("id", proposalId);
    } catch (mirrorErr) {
      console.error("[api-proposal-item] Failed to delete Supabase mirror row:", mirrorErr);
    }

    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/proposals/:username/:id",
};
