import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { isProposalAlive, loadDeletedProposalIds } from "./_shared/proposal-tombstones.mts";
import { loadHiddenInboxIds } from "./_shared/business-inbox-hidden.mts";

const STORE = "business-proposals";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 업체가 보낸/받은 제안 목록이다(인플루언서 이름 · 제안 금액 · 담당자 연락처).
  // 해당 업체 계정 본인(또는 관리자)만.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const store = getStore(STORE);
  const key = `biz_proposals_${username}`;

  if (req.method === "GET") {
    const seenIds = new Set<string>();
    const allProposals: any[] = [];

    let dbInstance: any = null;
    try {
      const { getDatabase } = await import("@picks/netlify-database");
      dbInstance = getDatabase();
    } catch {}

    const [cachedData, sqlProposals, campaignRows, deletedIds, hiddenIds] = await Promise.all([
      store.get(key, { type: "json" }).catch(() => null),
      dbInstance ? (async () => {
        try {
          return await dbInstance.sql`
            SELECT * FROM proposals
            WHERE LOWER(COALESCE(business_username, '')) = ${username}
            ORDER BY created_at DESC
          ` as any[];
        } catch { return []; }
      })() : Promise.resolve([]),
      dbInstance ? (async () => {
        try {
          return await dbInstance.sql`
            SELECT ca.*, c.title as campaign_title, c.business_username as biz_user, c.brand_name, c.type as campaign_type,
                   c.description, c.start_date, c.end_date, c.reward_amount
            FROM campaign_applications ca
            JOIN campaigns c ON c.id = ca.campaign_id
            WHERE ca.status = 'accepted'
            AND LOWER(REPLACE(c.business_username, 'biz/', '')) = ${username}
          ` as any[];
        } catch { return []; }
      })() : Promise.resolve([]),
      loadDeletedProposalIds(),
      loadHiddenInboxIds(username),
    ]);

    // 지운 줄(묘비)과 업체가 목록에서 내린 줄은 올리지 않는다. SQL·Blobs·캠페인
    // 파생 행 어느 쪽에서 되살아나도 같은 자리에서 걸러진다.
    const visible = (id: unknown) => isProposalAlive(deletedIds, id) && !hiddenIds.has(String(id ?? ""));

    if (Array.isArray(sqlProposals)) {
      for (const row of sqlProposals) {
        if (seenIds.has(row.id) || !visible(row.id)) continue;
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
        if (seenIds.has(proposalId) || !visible(proposalId)) continue;
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
      if (item.id && !seenIds.has(item.id) && visible(item.id)) {
        seenIds.add(item.id);
        allProposals.push(item);
      }
    }

    allProposals.sort((a: any, b: any) => new Date(b.createdAt || b.created_at || 0).getTime() - new Date(a.createdAt || a.created_at || 0).getTime());

    // 조회 중에 새 제안이 들어올 수 있으므로, 통째로 덮어쓰지 않고 최신 목록에
    // 없는 것만 합친다(덮어쓰면 방금 접수된 제안이 사라진다).
    context.waitUntil(
      (async () => {
        // 이 쓰기는 응답을 보낸 뒤에 실행된다. 그 사이에 삭제가 들어왔을 수 있으니
        // 묘비를 다시 읽는다 — 요청 시작 때 읽은 집합으로 걸렀다면, 조회와 삭제가
        // 겹친 바로 그 경우에 지운 제안이 캐시에 되살아난다.
        const fresh = await loadDeletedProposalIds();
        return mutateBlobJSON<any[]>(STORE, key, (current) => {
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
              new Date(b.createdAt || b.created_at || 0).getTime() -
              new Date(a.createdAt || a.created_at || 0).getTime()
          );
          return merged;
        });
      })().catch(() => null)
    );

    // hiddenIds 는 캠페인 협업 줄에도 필요하다. 그 줄은 이 응답이 아니라 협업
    // 목록 API 에서 오므로, 화면이 직접 걸러야 한다.
    return Response.json({ proposals: allProposals, hiddenIds: [...hiddenIds] });
  }

  if (req.method === "POST") {
    const body = await req.json();
    await mutateBlobJSON<any[]>(STORE, key, (current) => [
      ...(Array.isArray(current) ? current : []),
      {
        ...body,
        id: `biz_${Date.now()}`,
        createdAt: new Date().toISOString(),
      },
    ]);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/business-proposals/:username",
};
