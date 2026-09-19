import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { ensureTimelineRoom } from "./_shared/timeline-room.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { isProposalAlive, loadDeletedProposalIds } from "./_shared/proposal-tombstones.mts";
import { sendKakaoAlimtalk } from "./_shared/kakao-message.mts";
import { businessProposalAlimtalk } from "./_shared/alimtalk-templates.mts";
import { isUploadedFileUrl } from "./_shared/upload-media.mts";

const STORE = "proposals";
const BIZ_STORE = "business-proposals";

const cleanText = (value: unknown, max: number): string =>
  String(value ?? "").trim().slice(0, max);

const cleanDate = (value: unknown): string => {
  const date = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? "" : date;
};

const recordTime = (value: any): number => {
  const raw = value?.updated_at || value?.updatedAt || value?.created_at || value?.createdAt || 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const mergeNewest = (primary: any, secondary: any): any =>
  recordTime(secondary) > recordTime(primary)
    ? { ...primary, ...secondary }
    : { ...secondary, ...primary };

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore(STORE);

  if (req.method === "GET" || req.method === "PUT") {
    const auth = await requireAccountOwner(req, username);
    if (!auth.ok) return auth.response;
  }

  if (req.method === "GET") {
    const allProposals: any[] = [];
    const seenIds = new Set<string>();
    const proposalIndex = new Map<string, number>();

    const [sqlResult, blobData, deletedIds] = await Promise.all([
      (async () => {
        try {
          const { getDatabase } = await import("@picks/netlify-database");
          const db = getDatabase();
          return await db.sql`
            SELECT * FROM proposals
            WHERE LOWER(username) = ${username}
               OR LOWER(influencer_username) = ${username}
            ORDER BY created_at DESC
          `;
        } catch (dbErr) {
          console.error("[api-proposals] SQL query failed:", dbErr);
          return null;
        }
      })(),
      store.get(`proposals_${username}`, { type: "json" }).catch(() => null),
      loadDeletedProposalIds(),
    ]);

    if (Array.isArray(sqlResult)) {
      for (const row of sqlResult) {
        // 수신함에서 지운 제안. SQL 삭제가 실패해 행이 남아 있어도 화면에는 올리지 않는다.
        if (!isProposalAlive(deletedIds, row.id)) continue;
        seenIds.add(row.id);
        proposalIndex.set(row.id, allProposals.length);
        allProposals.push({
          id: row.id,
          influencer_username: row.influencer_username || row.username || username,
          category: row.category || "광고",
          company_name: row.company_name || "",
          contact_person: row.contact_person || "",
          contact_email: row.contact_email || "",
          contact_phone: row.contact_phone || "",
          title: row.title || "",
          content: row.content || row.description || "",
          description: row.description || row.content || "",
          start_date: row.start_date || "",
          end_date: row.end_date || "",
          fee: parseInt(row.fee) || 0,
          business_username: row.business_username || "",
          status: row.status || "pending",
          rejection_reason: row.rejection_reason || "",
          created_at: row.created_at || new Date().toISOString(),
          createdAt: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || "",
        });
      }
    }

    if (Array.isArray(blobData)) {
      for (const bp of blobData as any[]) {
        if (!bp.id || !isProposalAlive(deletedIds, bp.id)) continue;
        const existingIndex = proposalIndex.get(bp.id);
        if (existingIndex !== undefined) {
          allProposals[existingIndex] = mergeNewest(allProposals[existingIndex], bp);
        } else if (!seenIds.has(bp.id)) {
          seenIds.add(bp.id);
          proposalIndex.set(bp.id, allProposals.length);
          allProposals.push(bp);
        }
      }
    }

    allProposals.sort(
      (a: any, b: any) =>
        new Date(b.created_at || b.createdAt || 0).getTime() -
        new Date(a.created_at || a.createdAt || 0).getTime()
    );

    // Blob 스토어에 동기화 (PATCH/DELETE 엔드포인트 호환) — deferred.
    // 조회 중에 새 제안이 들어올 수 있으므로 통째로 덮어쓰지 않고, 최신 목록에
    // 없는 것만 합친다.
    if (allProposals.length > 0) {
      context.waitUntil(
        (async () => {
          // 이 쓰기는 응답을 보낸 뒤에 실행된다. 그 사이에 삭제가 들어왔을 수 있으므로
          // 묘비를 다시 읽는다 — 요청 시작 때 읽은 집합으로 걸렀다면, 조회와 삭제가
          // 겹친 바로 그 경우에 지운 제안이 캐시에 되살아난다.
          const fresh = await loadDeletedProposalIds();
          return mutateBlobJSON<any[]>(STORE, `proposals_${username}`, (current) => {
          const latest = (Array.isArray(current) ? current : []).filter((p: any) =>
            isProposalAlive(fresh, p?.id),
          );
          const mergedById = new Map(latest.map((p: any) => [p?.id, p]));
          for (const proposal of allProposals) {
            if (!proposal?.id || !isProposalAlive(fresh, proposal.id)) continue;
            const currentProposal = mergedById.get(proposal.id);
            mergedById.set(
              proposal.id,
              currentProposal ? mergeNewest(currentProposal, proposal) : proposal,
            );
          }
          const merged = [...mergedById.values()];
            merged.sort(
              (a: any, b: any) =>
                new Date(b.created_at || b.createdAt || 0).getTime() -
                new Date(a.created_at || a.createdAt || 0).getTime()
            );
            return merged;
          });
        })().catch(() => null)
      );
    }

    return Response.json({ proposals: allProposals });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const bizUsername = cleanText(body.business_username, 128)
      .toLowerCase()
      .replace(/^biz\//, "");
    if (!bizUsername || /[\\/?#\s]/.test(bizUsername)) {
      return Response.json({ error: "Business account required" }, { status: 400 });
    }
    const auth = await requireAccountOwner(req, bizUsername);
    if (!auth.ok) return auth.response;

    const category = body.category === "커머스" ? "커머스" : body.category === "광고" ? "광고" : "";
    const companyName = cleanText(body.company_name, 200);
    const contactPerson = cleanText(body.contact_person, 100);
    const contactEmail = cleanText(body.contact_email, 254);
    const contactPhone = cleanText(body.contact_phone, 50);
    const title = cleanText(body.title, 300);
    const content = cleanText(body.content, 20_000);
    const startDate = cleanDate(body.start_date);
    const endDate = cleanDate(body.end_date) || startDate;
    const fee = Number(body.fee);
    const revenueShare = body.revenue_share === undefined || body.revenue_share === ""
      ? undefined
      : Number(body.revenue_share);
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.slice(0, 10).map((item) => cleanText(item, 2_000))
      : [];
    const referenceLinks = Array.isArray(body.reference_links)
      ? body.reference_links.slice(0, 10).map((item) => cleanText(item, 2_000))
      : [];
    const linksValid = referenceLinks.every((link) => {
      try {
        const url = new URL(link);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    });

    if (!category || !companyName || !contactPerson || !contactEmail || !title || !content || !startDate) {
      return Response.json({ error: "필수 입력값을 확인해 주세요." }, { status: 400 });
    }
    if (!/^\S+@\S+\.\S+$/.test(contactEmail)) {
      return Response.json({ error: "이메일 형식을 확인해 주세요." }, { status: 400 });
    }
    if (!Number.isFinite(fee) || fee < 0 || fee > 1_000_000_000_000) {
      return Response.json({ error: "제안 금액을 확인해 주세요." }, { status: 400 });
    }
    if (revenueShare !== undefined && (!Number.isFinite(revenueShare) || revenueShare < 0 || revenueShare > 100)) {
      return Response.json({ error: "수익 배분율을 확인해 주세요." }, { status: 400 });
    }
    if (attachments.some((url) => !isUploadedFileUrl(url)) || !linksValid) {
      return Response.json({ error: "첨부 파일 또는 링크를 확인해 주세요." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const proposal = {
      id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      influencer_username: username,
      business_username: bizUsername,
      category,
      company_name: companyName,
      contact_person: contactPerson,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      title,
      content,
      description: content,
      start_date: startDate,
      end_date: endDate,
      fee,
      ...(revenueShare === undefined ? {} : { revenue_share: revenueShare }),
      reference_links: referenceLinks,
      attachments,
      status: "pending",
      rejection_reason: "",
      created_at: now,
      createdAt: now,
      updated_at: now,
      updatedAt: now,
    };

    // 여러 업체가 같은 인플루언서에게 동시에 제안하면 통째로 덮어쓰기가 앞선
    // 제안을 지운다. 두 목록 모두 조건부 쓰기로 덧붙인다.
    let recipientSaved = false;
    try {
      await mutateBlobJSON<any[]>(STORE, `proposals_${username}`, (current) => [
        ...(Array.isArray(current) ? current : []),
        proposal,
      ]);
      recipientSaved = true;
      await mutateBlobJSON<any[]>(BIZ_STORE, `biz_proposals_${bizUsername}`, (current) => [
        ...(Array.isArray(current) ? current : []),
        { ...proposal },
      ]);
    } catch (writeErr) {
      if (recipientSaved) {
        await mutateBlobJSON<any[]>(STORE, `proposals_${username}`, (current) => {
          const list = Array.isArray(current) ? current : [];
          return list.filter((item: any) => item?.id !== proposal.id);
        }).catch(() => null);
      }
      await mutateBlobJSON<any[]>(BIZ_STORE, `biz_proposals_${bizUsername}`, (current) => {
        const list = Array.isArray(current) ? current : [];
        return list.filter((item: any) => item?.id !== proposal.id);
      }).catch(() => null);
      console.error("[api-proposals] Failed to store proposal:", writeErr);
      return Response.json({ error: "제안서를 저장하지 못했습니다. 다시 시도해 주세요." }, { status: 503 });
    }

    // Persist to SQL database
    try {
      const { getDatabase } = await import("@picks/netlify-database");
      const db = getDatabase();
      await db.sql`
        INSERT INTO proposals (id, username, influencer_username, business_username, title, company_name, description, content, category, fee, start_date, end_date, status, contact_email, contact_person, contact_phone, created_at, updated_at)
        VALUES (
          ${proposal.id},
          ${username},
          ${username},
          ${bizUsername},
          ${proposal.title},
          ${proposal.company_name},
          ${proposal.content},
          ${proposal.content},
          ${proposal.category},
          ${proposal.fee},
          ${proposal.start_date || null},
          ${proposal.end_date || null},
          ${"pending"},
          ${proposal.contact_email},
          ${proposal.contact_person},
          ${proposal.contact_phone},
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `;
    } catch (dbErr) {
      console.error("[api-proposals] Failed to persist proposal to SQL:", dbErr);
    }

    // 제안이 도착한 시점에 협업 타임라인을 열어 둔다.
    //
    // 예전에는 수락한 뒤에야 방이 생겼다. 그러면 인플루언서는 금액·일정·산출물
    // 범위를 물어보려면 먼저 수락해야 했고, 브랜드도 조건을 조율할 창구가 없었다.
    // 받은 즉시 같은 방에서 상의할 수 있게 한다 — 수락/거절은 그대로 제안함에서 한다.
    if (bizUsername) {
      try {
        await ensureTimelineRoom({
          proposalId: proposal.id,
          influencerUsername: username,
          businessUsername: bizUsername,
          companyName: proposal.company_name,
          proposalTitle: proposal.title,
          systemMessage: `"${proposal.title || "협업 제안"}" 협업 제안이 도착했습니다. 수락 전에도 여기에서 금액·일정·산출물 범위를 상의할 수 있어요.`,
        });
      } catch (roomErr) {
        // 방을 못 만들어도 제안 접수는 성공해야 한다. 수락 시점에 다시 시도된다.
        console.error("[api-proposals] Failed to open timeline room on receipt:", roomErr);
      }
    }

    /**
     * 앱 푸시 — 제안이 도착한 그 순간 닿는 유일한 경로.
     *
     * 아래 알림톡은 지금 일시 중지 상태다(템플릿 재심사). 그 상태에서 새 제안 알림이
     * 알림톡 하나뿐이면, 제안은 수신함에 올라와 있는데 인플루언서는 다음에 앱을 열
     * 때까지 그 사실을 모른다 — 답변 기한이 있는 제안에서 그 며칠이 곧 기회 손실이다.
     * 푸시는 솔라피를 거치지 않으므로 중지와 무관하게 나간다.
     */
    try {
      const { sendPushToUser } = await import("./_shared/push.mts");
      await sendPushToUser(username, {
        title: `새 협업 제안 · ${proposal.company_name || "브랜드"}`,
        body: `"${proposal.title || "협업 제안"}" 제안이 도착했습니다. 조건을 확인해 주세요.`,
        // 알림톡이 쓰는 링크와 같은 자리로 보낸다(아래 magicLink). 두 채널이 서로
        // 다른 화면으로 데려가면 같은 알림이 두 번 온 것처럼 읽힌다.
        data: { type: "proposal", proposalId: proposal.id, path: "/admin?tab=proposals" },
      });
    } catch (pushErr) {
      console.error("[api-proposals] Failed to send proposal push:", pushErr);
    }

    // 비즈니스 제안 도착 알림 - 카카오 알림톡
    //
    // 템플릿은 승인된 "비즈니스 제안 도착" 하나만 쓴다. 문구와 변수 이름은
    // _shared/alimtalk-templates.mts 가 들고 있다 — 예전에는 여기에 템플릿 ID 를
    // 직접 적어 두었는데, 템플릿을 새로 올린 뒤에도 그 ID 가 남아 발송이 전부
    // 대체 문자로 떨어졌다.
    try {
      await sendKakaoAlimtalk({
        username,
        ...businessProposalAlimtalk({
          influencer: username,
          companyName: proposal.company_name || proposal.business_username,
          proposalTitle: proposal.title,
        }),
      });
    } catch (notifErr) {
      console.error("[api-proposals] Failed to send proposal alimtalk:", notifErr);
    }

    return Response.json({ success: true, proposal });
  }

  // PUT - 상태 업데이트 (원래 5월 초 버전과 동일)
  if (req.method === "PUT") {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const id = cleanText(body?.id, 200);
    const status = cleanText(body?.status, 20);
    if (!id) {
      return Response.json({ error: "id is required" }, { status: 400 });
    }
    if (!['accepted', 'rejected', 'completed'].includes(status)) {
      return Response.json({ error: "잘못된 상태값입니다." }, { status: 400 });
    }

    // Update in SQL
    try {
      const { getDatabase } = await import("@picks/netlify-database");
      const db = getDatabase();
      await db.sql`
        UPDATE proposals SET status = ${status}, updated_at = now()
        WHERE id = ${id} AND (LOWER(username) = ${username} OR LOWER(influencer_username) = ${username})
      `;
    } catch (dbErr) {
      console.error("[api-proposals] SQL update failed:", dbErr);
    }

    // Update in blob store
    try {
      await mutateBlobJSON<any[]>(STORE, `proposals_${username}`, (current) => {
        const existing = Array.isArray(current) ? current : [];
        const idx = existing.findIndex((p: any) => p.id === id);
        if (idx === -1) return null;
        const next = [...existing];
        next[idx] = { ...next[idx], status, updatedAt: new Date().toISOString() };
        return next;
      });
    } catch (blobErr) {
      console.error("[api-proposals] Blob update failed:", blobErr);
    }

    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/proposals/:username",
  method: ["GET", "POST", "PUT", "OPTIONS"],
  rateLimit: { windowSize: 60, windowLimit: 20, aggregateBy: "ip" },
};
