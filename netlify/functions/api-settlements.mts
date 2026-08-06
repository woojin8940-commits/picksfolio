import type { Config } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import {
  RecordWriteConflictError,
  SETTLEMENTS_STORE,
  mutateRecords,
  parseAmount,
  readRecords,
  settlementBizKey,
  settlementInfKey,
} from "./_shared/collab-records.mts";
import { normalizeRewardMode } from "./_shared/reward-mode.mts";

/**
 * 캠페인 협업의 정산 금액은 담당자가 확정한 조건(collab_terms.fee)에서 온다.
 *
 * 공동구매는 등록 때 금액이 정해지지 않는다 — 브랜드가 적는 것은 희망 수수료율이고,
 * 실제로 지급할 금액은 담당자가 인플루언서와 판매 조건을 조율한 뒤에야 정해진다.
 * 그래서 담당자가 금액을 넣기 전까지는 0원이 아니라 "협의중"으로 보여야 한다.
 * 광고비 지급형은 캠페인에 적힌 금액(reward_amount)을 그대로 쓰되, 담당자가 조건을
 * 다시 확정했다면 그 값이 우선한다.
 */
function derivedAmount(row: any): { amount: number; pending: boolean } {
  const managerFee = parseAmount(row?.manager_fee || 0);
  if (managerFee > 0) return { amount: managerFee, pending: false };

  const mode = normalizeRewardMode(row?.reward_mode);
  if (mode === "groupbuy") return { amount: 0, pending: true };

  const rewardAmount = parseAmount(row?.reward_amount || 0);
  return { amount: rewardAmount, pending: rewardAmount <= 0 };
}


export default async (req: Request) => {
  const url = new URL(req.url);
  const role = url.searchParams.get("role") || "influencer";

  const pathParts = url.pathname.replace(/^\/api\/settlements\/?/, "").split("/").filter(Boolean);
  const username = pathParts[0] ? decodeURIComponent(pathParts[0]).toLowerCase() : "";
  const settlementId = pathParts[1] ? decodeURIComponent(pathParts[1]) : null;

  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 정산 금액은 계약 금액이 그대로 드러나는 정보이고, PATCH/DELETE는 남의
  // 정산을 바꿀 수 있다. 로그인한 본인(또는 관리자)만 접근한다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const bizKey = settlementBizKey(username);
  const infKey = settlementInfKey(username);

  try {
    if (req.method === "GET") {
      const explicitRecords = await readRecords(SETTLEMENTS_STORE, role === "business" ? bizKey : infKey);
      const seenProposalIds = new Set<string>();
      for (const s of explicitRecords || []) {
        if (s.proposal_id) seenProposalIds.add(s.proposal_id);
        if (s.id) seenProposalIds.add(s.id);
      }

      const autoDerivedSettlements: any[] = [];
      let dbInstance: any = null;
      try {
        const { getDatabase } = await import("@picks/netlify-database");
        dbInstance = getDatabase();
      } catch {}

      if (role === "influencer") {
        const [sqlProposals, campaignRows] = await Promise.all([
          dbInstance ? (async () => {
            try {
              return await dbInstance.sql`
                SELECT id, business_username, company_name, title, fee, start_date, end_date, status, created_at
                FROM proposals
                WHERE LOWER(influencer_username) = ${username}
                  AND status IN ('accepted', 'completed')
              ` as any[];
            } catch { return []; }
          })() : Promise.resolve([]),
          dbInstance ? (async () => {
            try {
              return await dbInstance.sql`
                SELECT ca.id as app_id, ca.campaign_id, ca.applicant_username, ca.source,
                       c.business_username as biz_user, c.brand_name, c.title as campaign_title,
                       c.reward_amount, c.reward_mode, c.start_date, c.end_date, ca.created_at,
                       ct.fee as manager_fee
                FROM campaign_applications ca
                JOIN campaigns c ON c.id = ca.campaign_id
                LEFT JOIN campaign_collabs cc
                  ON cc.campaign_id = ca.campaign_id
                 AND LOWER(cc.creator_username) = LOWER(ca.applicant_username)
                LEFT JOIN collab_terms ct ON ct.collab_id = cc.id
                WHERE ca.status = 'accepted'
                  AND COALESCE(c.reward_mode, 'paid') <> 'barter'
                  AND LOWER(ca.applicant_username) = ${username}
              ` as any[];
            } catch { return []; }
          })() : Promise.resolve([]),
        ]);

        for (const row of sqlProposals || []) {
          const propId = row.id || `prop_${Date.now()}`;
          if (seenProposalIds.has(propId)) continue;
          seenProposalIds.add(propId);
          autoDerivedSettlements.push({
            id: `stl_derived_${propId}`,
            proposal_id: propId,
            influencer_username: username,
            business_username: (row.business_username || '').toLowerCase().replace(/^biz\//, ''),
            company_name: row.company_name || '비즈니스 제안',
            title: row.title || '비즈니스 제안 협업',
            amount: parseAmount(row.fee || 0),
            scheduled_date: row.end_date || row.start_date || (row.created_at ? String(row.created_at).split('T')[0] : new Date().toISOString().split('T')[0]),
            status: row.status === 'completed' ? 'completed' : 'scheduled',
            memo: '비즈니스 제안 협업',
            created_at: row.created_at || new Date().toISOString(),
            updated_at: row.created_at || new Date().toISOString(),
          });
        }

        for (const row of campaignRows || []) {
          const propId = `campaign_${row.campaign_id}_${username}`;
          if (seenProposalIds.has(propId)) continue;
          seenProposalIds.add(propId);
          const isListup = row.source === 'listup';
          const { amount, pending } = derivedAmount(row);
          autoDerivedSettlements.push({
            id: `stl_derived_${propId}`,
            proposal_id: propId,
            influencer_username: username,
            business_username: (row.biz_user || '').toLowerCase().replace(/^biz\//, ''),
            company_name: row.brand_name || '브랜드 협업',
            title: row.campaign_title || '캠페인 협업',
            amount,
            amount_pending: pending,
            scheduled_date: row.end_date || row.start_date || (row.created_at ? String(row.created_at).split('T')[0] : new Date().toISOString().split('T')[0]),
            status: 'scheduled',
            memo: isListup ? '담당자 리스트업' : '캠페인 협업',
            created_at: row.created_at || new Date().toISOString(),
            updated_at: row.created_at || new Date().toISOString(),
          });
        }
      } else {
        // role === "business"
        const [sqlProposals, campaignRows] = await Promise.all([
          dbInstance ? (async () => {
            try {
              return await dbInstance.sql`
                SELECT id, influencer_username, company_name, title, fee, start_date, end_date, status, created_at
                FROM proposals
                WHERE LOWER(REGEXP_REPLACE(COALESCE(business_username, ''), '^biz/', '')) = ${username}
                  AND status IN ('accepted', 'completed')
              ` as any[];
            } catch { return []; }
          })() : Promise.resolve([]),
          dbInstance ? (async () => {
            try {
              return await dbInstance.sql`
                SELECT ca.id as app_id, ca.campaign_id, ca.applicant_username, ca.source,
                       c.business_username as biz_user, c.brand_name, c.title as campaign_title,
                       c.reward_amount, c.reward_mode, c.start_date, c.end_date, ca.created_at,
                       ct.fee as manager_fee
                FROM campaign_applications ca
                JOIN campaigns c ON c.id = ca.campaign_id
                LEFT JOIN campaign_collabs cc
                  ON cc.campaign_id = ca.campaign_id
                 AND LOWER(cc.creator_username) = LOWER(ca.applicant_username)
                LEFT JOIN collab_terms ct ON ct.collab_id = cc.id
                WHERE ca.status = 'accepted'
                  AND COALESCE(c.reward_mode, 'paid') <> 'barter'
                  AND LOWER(REGEXP_REPLACE(COALESCE(c.business_username, ''), '^biz/', '')) = ${username}
              ` as any[];
            } catch { return []; }
          })() : Promise.resolve([]),
        ]);

        for (const row of sqlProposals || []) {
          const propId = row.id || `prop_${Date.now()}`;
          if (seenProposalIds.has(propId)) continue;
          seenProposalIds.add(propId);
          autoDerivedSettlements.push({
            id: `stl_derived_${propId}`,
            proposal_id: propId,
            influencer_username: (row.influencer_username || '').toLowerCase(),
            business_username: username,
            company_name: row.company_name || '비즈니스 제안',
            title: row.title || '비즈니스 제안 협업',
            amount: parseAmount(row.fee || 0),
            scheduled_date: row.end_date || row.start_date || (row.created_at ? String(row.created_at).split('T')[0] : new Date().toISOString().split('T')[0]),
            status: row.status === 'completed' ? 'completed' : 'scheduled',
            memo: '비즈니스 제안 협업',
            created_at: row.created_at || new Date().toISOString(),
            updated_at: row.created_at || new Date().toISOString(),
          });
        }

        for (const row of campaignRows || []) {
          const infUser = (row.applicant_username || '').toLowerCase();
          const propId = `campaign_${row.campaign_id}_${infUser}`;
          if (seenProposalIds.has(propId)) continue;
          seenProposalIds.add(propId);
          const isListup = row.source === 'listup';
          const { amount, pending } = derivedAmount(row);
          autoDerivedSettlements.push({
            id: `stl_derived_${propId}`,
            proposal_id: propId,
            influencer_username: infUser,
            business_username: username,
            company_name: row.brand_name || '브랜드 협업',
            title: row.campaign_title || '캠페인 협업',
            amount,
            amount_pending: pending,
            scheduled_date: row.end_date || row.start_date || (row.created_at ? String(row.created_at).split('T')[0] : new Date().toISOString().split('T')[0]),
            status: 'scheduled',
            memo: isListup ? '담당자 리스트업' : '캠페인 협업',
            created_at: row.created_at || new Date().toISOString(),
            updated_at: row.created_at || new Date().toISOString(),
          });
        }
      }

      const combinedSettlements = [...(explicitRecords || []), ...autoDerivedSettlements];
      return Response.json({ settlements: combinedSettlements });
    }

    if (req.method === "POST" && role === "business") {
      const body = await req.json();
      const id = `stl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();

      const settlement = {
        id,
        proposal_id: body.proposal_id || "",
        influencer_username: (body.influencer_username || "").toLowerCase(),
        business_username: username,
        company_name: body.company_name || "",
        title: body.title || "",
        amount: parseAmount(body.amount),
        scheduled_date: body.scheduled_date || "",
        status: body.status || "scheduled",
        memo: body.memo || "",
        created_at: now,
        updated_at: now,
      };

      await mutateRecords(SETTLEMENTS_STORE, bizKey, (records) => [...records, settlement]);

      if (settlement.influencer_username) {
        await mutateRecords(SETTLEMENTS_STORE, settlementInfKey(settlement.influencer_username), (records) => [
          ...records,
          settlement,
        ]);
      }

      return Response.json({ success: true, settlement });
    }

    // Both the business AND the influencer can update a settlement. The business
    // may edit any field; the influencer may change the status (e.g. mark a
    // settlement as completed once they've confirmed payment) and the settlement
    // amount (so they can correct the figure proposed by the business when the
    // agreed payout differs). Whichever side makes the change is mirrored to the
    // counterpart's record so both dashboards stay in sync.
    if (req.method === "PATCH" && settlementId && (role === "business" || role === "influencer")) {
      const body = await req.json();
      const now = new Date().toISOString();

      // Influencers are limited to the status and amount fields — they cannot
      // rewrite the schedule or other business-owned fields.
      let patch: any;
      if (role === "business") {
        patch = { ...body };
        if (patch.amount !== undefined) patch.amount = parseAmount(patch.amount);
      } else {
        patch = {};
        if (body.status) patch.status = body.status;
        if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
          patch.amount = parseAmount(body.amount);
        }
      }

      const primaryKey = role === "business" ? bizKey : infKey;
      let updated: any = null;
      let notFound = false;

      await mutateRecords(SETTLEMENTS_STORE, primaryKey, (records) => {
        const idx = records.findIndex((s: any) => s.id === settlementId);
        if (idx !== -1) {
          notFound = false;
          updated = { ...records[idx], ...patch, updated_at: now };
          if (patch.status === "completed" && !updated.completed_at) {
            updated.completed_at = now;
          }
          const next = [...records];
          next[idx] = updated;
          return next;
        } else {
          // Derived settlement being patched for the first time
          notFound = false;
          updated = {
            id: settlementId,
            proposal_id: body.proposal_id || (settlementId.startsWith("stl_derived_") ? settlementId.replace("stl_derived_", "") : ""),
            influencer_username: (body.influencer_username || (role === "influencer" ? username : "")).toLowerCase(),
            business_username: (body.business_username || (role === "business" ? username : "")).toLowerCase(),
            company_name: body.company_name || "",
            title: body.title || "협업 정산",
            amount: parseAmount(body.amount),
            scheduled_date: body.scheduled_date || now.split("T")[0],
            status: body.status || "scheduled",
            memo: body.memo || "",
            created_at: now,
            updated_at: now,
            ...patch,
          };
          if (patch.status === "completed" && !updated.completed_at) {
            updated.completed_at = now;
          }
          return [...records, updated];
        }
      });

      if (notFound || !updated) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }

      // Mirror the change to the counterpart's record.
      const rawCounterpart = role === "business" ? updated.influencer_username : updated.business_username;
      const counterpartUsername = rawCounterpart ? String(rawCounterpart).toLowerCase() : "";
      if (counterpartUsername) {
        const counterpartKey =
          role === "business" ? settlementInfKey(counterpartUsername) : settlementBizKey(counterpartUsername);
        await mutateRecords(SETTLEMENTS_STORE, counterpartKey, (records) => {
          const cIdx = records.findIndex((s: any) => s.id === settlementId);
          const next = [...records];
          if (cIdx !== -1) next[cIdx] = updated;
          else next.push(updated);
          return next;
        });
      }

      return Response.json({ success: true, settlement: updated });
    }

    if (req.method === "DELETE" && role === "business" && settlementId) {
      let target: any = null;

      await mutateRecords(SETTLEMENTS_STORE, bizKey, (records) => {
        target = records.find((s: any) => s.id === settlementId) || null;
        if (!target) return null;
        return records.filter((s: any) => s.id !== settlementId);
      });

      const influencerUsername = (target?.influencer_username || "").toLowerCase();
      if (influencerUsername) {
        await mutateRecords(SETTLEMENTS_STORE, settlementInfKey(influencerUsername), (records) => {
          const next = records.filter((s: any) => s.id !== settlementId);
          return next.length === records.length ? null : next;
        });
      }

      return Response.json({ success: true });
    }
  } catch (err) {
    if (err instanceof RecordWriteConflictError) {
      // 다른 요청과 동시에 같은 정산 목록을 고치다 실패한 경우. 클라이언트가
      // 다시 시도하면 된다.
      return Response.json({ error: "정산 정보가 방금 변경되었습니다. 다시 시도해 주세요." }, { status: 409 });
    }
    console.error("[api-settlements] Unexpected error:", err);
    return Response.json({ error: "서버 오류" }, { status: 500 });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/settlements/*",
};
