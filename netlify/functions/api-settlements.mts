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
      const records = await readRecords(SETTLEMENTS_STORE, role === "business" ? bizKey : infKey);
      return Response.json({ settlements: records });
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
        if (idx === -1) {
          notFound = true;
          return null;
        }
        notFound = false;
        updated = { ...records[idx], ...patch, updated_at: now };
        if (patch.status === "completed" && !updated.completed_at) {
          updated.completed_at = now;
        }
        const next = [...records];
        next[idx] = updated;
        return next;
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
