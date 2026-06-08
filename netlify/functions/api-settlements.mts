import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

function bizKey(username: string) {
  return `settlements_biz_${username.toLowerCase()}`;
}

function infKey(username: string) {
  return `settlements_inf_${username.toLowerCase()}`;
}

async function getRecords(store: ReturnType<typeof getStore>, key: string) {
  const data = (await store.get(key, { type: "json" })) as any;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.records)) return data.records;
  if (data && Array.isArray(data.settlements)) return data.settlements;
  return [];
}

async function saveRecords(store: ReturnType<typeof getStore>, key: string, records: any[]) {
  await store.setJSON(key, records);
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const role = url.searchParams.get("role") || "influencer";
  const store = getStore("settlements");

  const pathParts = url.pathname.replace(/^\/api\/settlements\/?/, "").split("/").filter(Boolean);
  const username = pathParts[0] ? decodeURIComponent(pathParts[0]).toLowerCase() : "";
  const settlementId = pathParts[1] ? decodeURIComponent(pathParts[1]) : null;

  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  if (req.method === "GET") {
    if (role === "business") {
      const records = await getRecords(store, bizKey(username));
      return Response.json({ settlements: records });
    }
    const records = await getRecords(store, infKey(username));
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
      amount: parseInt(body.amount) || 0,
      scheduled_date: body.scheduled_date || "",
      status: body.status || "scheduled",
      memo: body.memo || "",
      created_at: now,
      updated_at: now,
    };

    const bizRecords = await getRecords(store, bizKey(username));
    bizRecords.push(settlement);
    await saveRecords(store, bizKey(username), bizRecords);

    if (settlement.influencer_username) {
      const infRecords = await getRecords(store, infKey(settlement.influencer_username));
      infRecords.push(settlement);
      await saveRecords(store, infKey(settlement.influencer_username), infRecords);
    }

    return Response.json({ success: true, settlement });
  }

  // Both the business AND the influencer can update a settlement. The business
  // may edit any field; the influencer may only change the status (e.g. mark a
  // settlement as completed once they've confirmed payment). Whichever side
  // makes the change is mirrored to the counterpart's record so both dashboards
  // stay in sync.
  if (req.method === "PATCH" && settlementId && (role === "business" || role === "influencer")) {
    const body = await req.json();
    const now = new Date().toISOString();

    // Influencers are limited to status changes only — they cannot rewrite the
    // amount, schedule, or other business-owned fields.
    const patch: any = role === "business"
      ? body
      : (body.status ? { status: body.status } : {});

    const primaryKey = role === "business" ? bizKey(username) : infKey(username);
    const primaryRecords = await getRecords(store, primaryKey);
    const idx = primaryRecords.findIndex((s: any) => s.id === settlementId);
    if (idx === -1) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const updated = { ...primaryRecords[idx], ...patch, updated_at: now };
    if (patch.status === "completed" && !updated.completed_at) {
      updated.completed_at = now;
    }
    primaryRecords[idx] = updated;
    await saveRecords(store, primaryKey, primaryRecords);

    // Mirror the change to the counterpart's record.
    const counterpartUsername = (
      role === "business" ? updated.influencer_username : updated.business_username
    ) ? String(role === "business" ? updated.influencer_username : updated.business_username).toLowerCase() : "";
    const counterpartKey = role === "business" ? infKey(counterpartUsername) : bizKey(counterpartUsername);
    if (counterpartUsername) {
      const counterpartRecords = await getRecords(store, counterpartKey);
      const cIdx = counterpartRecords.findIndex((s: any) => s.id === settlementId);
      if (cIdx !== -1) {
        counterpartRecords[cIdx] = updated;
      } else {
        counterpartRecords.push(updated);
      }
      await saveRecords(store, counterpartKey, counterpartRecords);
    }

    return Response.json({ success: true, settlement: updated });
  }

  if (req.method === "DELETE" && role === "business" && settlementId) {
    const bizRecords = await getRecords(store, bizKey(username));
    const target = bizRecords.find((s: any) => s.id === settlementId);
    const filtered = bizRecords.filter((s: any) => s.id !== settlementId);
    await saveRecords(store, bizKey(username), filtered);

    if (target) {
      const influencerUsername = (target.influencer_username || "").toLowerCase();
      if (influencerUsername) {
        const infRecords = await getRecords(store, infKey(influencerUsername));
        await saveRecords(store, infKey(influencerUsername), infRecords.filter((s: any) => s.id !== settlementId));
      }
    }

    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/settlements/*",
};
