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
import { seoulDayOf, todayInSeoul } from "./_shared/campaign-recruit.mts";
import { settlementDateFrom } from "./_shared/collab-workflow.mts";
import { isProposalAlive, loadDeletedProposalIds } from "./_shared/proposal-tombstones.mts";

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


/**
 * 정산 예정일 = 콘텐츠가 올라간 달의 익월 말일.
 *
 * 예전에는 파생 정산의 예정일이 캠페인 종료일(end_date)이었다. 종료일은 "이 날까지
 * 올려 주세요"라는 업로드 마감이지 입금일이 아니라서, 협업 현황 캘린더와 정산금
 * 화면에는 업로드하는 날에 돈이 들어오는 것처럼 찍혔다. 실제 지급은 그 달을 마감하고
 * 다음 달 말에 나간다.
 *
 * 기준일은 뒤로 갈수록 흐릿해지는 순서로 찾는다.
 *
 *   1. 게시물 링크가 등록된 날 — 실제 업로드일.
 *   2. 담당자가 업로드를 확인한 날 — 링크 기록이 없는 옛 협업.
 *   3. 확정 조건의 업로드 마감일(collab_terms.upload_due) — 아직 올리지 않은 협업.
 *   4. 캠페인 종료일 → 시작일 — 조건도 확정되지 않은 협업.
 *
 * 3·4번은 예정이므로 업로드가 밀리면 정산일도 함께 밀린다. 그래도 비워 두지는
 * 않는다 — 날짜가 없는 정산은 캘린더에서 아예 사라져서 "내 정산이 언제인지 모른다"가
 * 된다.
 *
 * 담당자가 회차를 직접 잡은 협업은 여기까지 오지 않는다. 그 경우는 명시 정산 항목이
 * 있고(schedule_settlement), 파생 행은 만들지 않는다.
 */
function derivedSettlementDate(row: any): { date: string; estimated: boolean } {
  const uploaded = seoulDayOf(row?.uploaded_at) || seoulDayOf(row?.upload_confirmed_at);
  if (uploaded) return { date: settlementDateFrom(uploaded), estimated: false };

  const planned =
    toDayKey(row?.upload_due) || toDayKey(row?.end_date) || toDayKey(row?.start_date);
  if (planned) return { date: settlementDateFrom(planned), estimated: true };

  const created = seoulDayOf(row?.created_at) || todayInSeoul();
  return { date: settlementDateFrom(created), estimated: true };
}

/** 'YYYY-MM-DD' 부분만. 날짜 칸(date)은 시간대 변환 없이 그대로 쓴다. */
function toDayKey(value: any): string {
  const raw =
    value instanceof Date ? value.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : String(value || "");
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

/**
 * 비즈니스 제안 협업의 정산 예정일.
 *
 * 제안 협업에는 단계별 업로드 기록이 없다. 협업 종료일이 콘텐츠가 올라가는 날이므로
 * 그 날을 업로드일로 본다 — 아직 종료일이 오지 않았으면 예정으로 표시한다.
 */
function proposalSettlementDate(row: any, today: string): { date: string; estimated: boolean } {
  const endDay = toDayKey(row?.end_date);
  const uploaded = endDay && endDay <= today ? endDay : "";
  return derivedSettlementDate({
    uploaded_at: uploaded || null,
    upload_due: endDay,
    start_date: row?.start_date,
    created_at: row?.created_at,
  });
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
      const today = todayInSeoul();
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
                       ct.fee as manager_fee,
                       -- 정산 예정일의 기준이 되는 업로드일. 실제 등록일이 먼저고,
                       -- 없으면 확인 시각, 그다음이 확정 조건의 업로드 마감이다.
                       ct.upload_due, cc.upload_confirmed_at,
                       (SELECT MIN(cd.created_at) FROM collab_deliverables cd
                         WHERE cd.collab_id = cc.id AND cd.kind = 'upload') AS uploaded_at
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
          const payout = proposalSettlementDate(row, today);
          autoDerivedSettlements.push({
            id: `stl_derived_${propId}`,
            proposal_id: propId,
            influencer_username: username,
            business_username: (row.business_username || '').toLowerCase().replace(/^biz\//, ''),
            company_name: row.company_name || '비즈니스 제안',
            title: row.title || '비즈니스 제안 협업',
            amount: parseAmount(row.fee || 0),
            scheduled_date: payout.date,
            status: row.status === 'completed' ? 'completed' : 'scheduled',
            memo: `비즈니스 제안 협업${payout.estimated ? ' · 업로드 예정일 기준' : ''}`,
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
          const payout = derivedSettlementDate(row);
          autoDerivedSettlements.push({
            id: `stl_derived_${propId}`,
            proposal_id: propId,
            influencer_username: username,
            business_username: (row.biz_user || '').toLowerCase().replace(/^biz\//, ''),
            company_name: row.brand_name || '브랜드 협업',
            title: row.campaign_title || '캠페인 협업',
            amount,
            amount_pending: pending,
            scheduled_date: payout.date,
            status: 'scheduled',
            memo: `${isListup ? '담당자 리스트업' : '캠페인 협업'}${payout.estimated ? ' · 업로드 예정일 기준' : ' · 업로드한 달의 익월 말일 지급'}`,
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
                       ct.fee as manager_fee,
                       -- 정산 예정일의 기준이 되는 업로드일. 실제 등록일이 먼저고,
                       -- 없으면 확인 시각, 그다음이 확정 조건의 업로드 마감이다.
                       ct.upload_due, cc.upload_confirmed_at,
                       (SELECT MIN(cd.created_at) FROM collab_deliverables cd
                         WHERE cd.collab_id = cc.id AND cd.kind = 'upload') AS uploaded_at
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
            scheduled_date: proposalSettlementDate(row, today).date,
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
          const payout = derivedSettlementDate(row);
          autoDerivedSettlements.push({
            id: `stl_derived_${propId}`,
            proposal_id: propId,
            influencer_username: infUser,
            business_username: username,
            company_name: row.brand_name || '브랜드 협업',
            title: row.campaign_title || '캠페인 협업',
            amount,
            amount_pending: pending,
            scheduled_date: payout.date,
            status: 'scheduled',
            memo: `${isListup ? '담당자 리스트업' : '캠페인 협업'}${payout.estimated ? ' · 업로드 예정일 기준' : ' · 업로드한 달의 익월 말일 지급'}`,
            created_at: row.created_at || new Date().toISOString(),
            updated_at: row.created_at || new Date().toISOString(),
          });
        }
      }

      // 수신함·제안 현황에서 지운 제안에서 파생된 정산은 내보내지 않는다. 삭제 때
      // 명시 항목은 지우지만, 여기서 SQL 로 다시 만드는 파생 행은 SQL 삭제가
      // 실패했을 때 되살아난다 — 그러면 지운 협업이 정산금과 협업 현황 캘린더에만
      // 남아 "지웠는데 아직 있다"가 된다.
      const deletedIds = await loadDeletedProposalIds();
      const combinedSettlements = [...(explicitRecords || []), ...autoDerivedSettlements].filter((s: any) =>
        isProposalAlive(deletedIds, s?.proposal_id),
      );

      /**
       * 브랜드에게는 "내가 보낸 일괄 정산금이 접수됐는가"를 함께 내려보낸다.
       *
       * 브랜드는 인플루언서에게 개별 송금을 하지 않는다 — 픽스폴리오에 회차마다 한 번
       * 보내고 개별 지급과 원천징수는 픽스폴리오가 한다. 그런데 정산 화면의 상태는
       * 인플루언서 지급이 끝났는지(status)만 말하고 있어서, 브랜드가 확인하고 싶은
       * "내 입금이 접수됐나"는 담당자에게 물어봐야 알 수 있었다.
       *
       * 수납은 캠페인 단위로 기록된다(campaign_brand_settlements). 캠페인 협업의 정산
       * 항목은 proposal_id 가 `campaign_<캠페인>_<아이디>` 이므로 캠페인 아이디로 앞을
       * 맞춰 찾는다 — 캠페인 아이디 자체에 밑줄이 들어가므로 잘라 나누지 않는다.
       *
       * 비즈니스 제안에서 온 정산(`prop_...`)은 브랜드가 인플루언서에게 직접 지급하는
       * 건이라 일괄 정산 대상이 아니다. 그 줄에는 아무것도 붙이지 않는다.
       */
      let annotated = combinedSettlements;
      if (role === "business") {
        let receipts: any[] = [];
        if (dbInstance) {
          try {
            receipts = (await dbInstance.sql`
              SELECT campaign_id, invoice_amount, received_amount, received_date, received_at, memo
              FROM campaign_brand_settlements
              WHERE LOWER(REGEXP_REPLACE(COALESCE(business_username, ''), '^biz/', '')) = ${username}
            `) as any[];
          } catch {
            receipts = [];
          }
        }
        annotated = combinedSettlements.map((s: any) => {
          const proposalId = String(s?.proposal_id || "");
          if (!proposalId.startsWith("campaign_")) return s;
          const hit = receipts.find((r: any) => proposalId.startsWith(`campaign_${r.campaign_id}_`));
          return {
            ...s,
            brand_settlement: {
              campaign_id: hit ? String(hit.campaign_id) : "",
              /** 담당자가 입금을 확인했는가. 브랜드 화면의 '정산완료'가 이 값이다. */
              received: Boolean(hit?.received_at),
              received_date: hit?.received_date ? String(hit.received_date).split("T")[0] : "",
              received_amount: Number(hit?.received_amount || 0),
              invoice_amount: Number(hit?.invoice_amount || 0),
              memo: String(hit?.memo || ""),
            },
          };
        });
      }

      return Response.json({ settlements: annotated });
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
