import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { ensureTimelineRoom } from "./_shared/timeline-room.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { isProposalAlive, loadDeletedProposalIds } from "./_shared/proposal-tombstones.mts";

const STORE = "proposals";
const BIZ_STORE = "business-proposals";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore(STORE);

  // 받은 제안함이다(업체 담당자 이름 · 이메일 · 연락처 · 제안 금액이 들어 있다).
  // 읽기·상태 변경은 본인만. 단 POST(제안 접수)는 로그인 없이 제안서 폼을 채운
  // 업체도 보내야 하므로 열어 둔다.
  if (req.method === "GET" || req.method === "PUT") {
    const auth = await requireAccountOwner(req, username);
    if (!auth.ok) return auth.response;
  }

  if (req.method === "GET") {
    const allProposals: any[] = [];
    const seenIds = new Set<string>();

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
        if (bp.id && !seenIds.has(bp.id) && isProposalAlive(deletedIds, bp.id)) {
          seenIds.add(bp.id);
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
            const latestIds = new Set(latest.map((p: any) => p?.id));
            const merged = [
              ...latest,
              ...allProposals.filter((p: any) => !latestIds.has(p?.id) && isProposalAlive(fresh, p?.id)),
            ];
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
    const body = await req.json();
    const proposal = {
      ...body,
      // id·소유자·상태는 서버가 정한다(body 로 덮어쓰지 못하게 뒤에 둔다).
      id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      influencer_username: username,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    // 여러 업체가 같은 인플루언서에게 동시에 제안하면 통째로 덮어쓰기가 앞선
    // 제안을 지운다. 두 목록 모두 조건부 쓰기로 덧붙인다.
    await mutateBlobJSON<any[]>(STORE, `proposals_${username}`, (current) => [
      ...(Array.isArray(current) ? current : []),
      proposal,
    ]);

    const bizUsername = (body.business_username || "").toLowerCase().replace(/^biz\//, "");
    if (bizUsername) {
      await mutateBlobJSON<any[]>(BIZ_STORE, `biz_proposals_${bizUsername}`, (current) => [
        ...(Array.isArray(current) ? current : []),
        { ...proposal },
      ]);
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
          ${body.title || ""},
          ${body.company_name || ""},
          ${body.content || ""},
          ${body.content || ""},
          ${body.category || "광고"},
          ${parseInt(body.fee) || 0},
          ${body.start_date || null},
          ${body.end_date || null},
          ${"pending"},
          ${body.contact_email || ""},
          ${body.contact_person || ""},
          ${body.contact_phone || ""},
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
          companyName: body.company_name || "",
          proposalTitle: body.title || "",
          systemMessage: `"${body.title || "협업 제안"}" 협업 제안이 도착했습니다. 수락 전에도 여기에서 금액·일정·산출물 범위를 상의할 수 있어요.`,
        });
      } catch (roomErr) {
        // 방을 못 만들어도 제안 접수는 성공해야 한다. 수락 시점에 다시 시도된다.
        console.error("[api-proposals] Failed to open timeline room on receipt:", roomErr);
      }
    }

    // 비즈니스 수신 알림 - 카카오 알림톡
    try {
      const siteOrigin = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";
      const companyName = body.company_name || body.business_username || "기업";
      const proposalTitle = body.title || "협업 제안";
      const magicLink = `${siteOrigin}/admin?tab=proposals`;

      await fetch(`${siteOrigin}/api/send-kakao-alimtalk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          message: `[픽스폴리오] 새로운 협업 제안\n\n${companyName}에서 "${proposalTitle}" 협업을 제안했습니다.\n\n자세한 내용은 아래 링크에서 확인하세요.\n${magicLink}`,
          templateId: "KA01TP260409050013707MDcnfpN4ApK",
          variables: {
            "#{고객명}": username,
            "#{업체명}": companyName,
            "#{프로젝트명}": proposalTitle,
            "#{링크연결}": magicLink,
          },
        }),
      });
    } catch (notifErr) {
      console.error("[api-proposals] Failed to send proposal alimtalk:", notifErr);
    }

    return Response.json({ success: true, proposal });
  }

  // PUT - 상태 업데이트 (원래 5월 초 버전과 동일)
  if (req.method === "PUT") {
    const body = await req.json();
    if (!body.id) {
      return Response.json({ error: "id is required" }, { status: 400 });
    }

    // Update in SQL
    try {
      const { getDatabase } = await import("@picks/netlify-database");
      const db = getDatabase();
      await db.sql`
        UPDATE proposals SET status = ${body.status}, updated_at = now()
        WHERE id = ${body.id} AND (LOWER(username) = ${username} OR LOWER(influencer_username) = ${username})
      `;
    } catch (dbErr) {
      console.error("[api-proposals] SQL update failed:", dbErr);
    }

    // Update in blob store
    try {
      await mutateBlobJSON<any[]>(STORE, `proposals_${username}`, (current) => {
        const existing = Array.isArray(current) ? current : [];
        const idx = existing.findIndex((p: any) => p.id === body.id);
        if (idx === -1) return null;
        const next = [...existing];
        next[idx] = { ...next[idx], status: body.status, updatedAt: new Date().toISOString() };
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
};
