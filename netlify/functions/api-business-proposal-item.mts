import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { getSupabaseServer } from "./_shared/supabase.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { markProposalDeleted } from "./_shared/proposal-tombstones.mts";
import { hideInboxItem } from "./_shared/business-inbox-hidden.mts";
import {
  removeCollabScheduleRecord,
  removeSettlementsForProposal,
} from "./_shared/collab-records.mts";

/**
 * 비즈니스 제안 현황에서 한 줄 지우기.
 *
 * 인플루언서 수신함에는 삭제가 있었는데 업체 쪽에는 없었다. 그래서 거절된 제안과 끝난
 * 협업이 계속 쌓여, 지금 돌아가는 건을 찾으려면 스크롤을 내려야 했다.
 *
 * 두 갈래를 다르게 처리한다(자세한 이유는 _shared/business-inbox-hidden.mts).
 *
 *   · `?scope=hide`  캠페인 협업 줄. 업체 목록에서만 내린다. 협업 자체와 인플루언서의
 *                    진행사항 · 담당자 큐는 그대로다. 브랜드 협업현황에서 계속 보인다.
 *   · 그 밖         업체가 보낸 비즈니스 제안. 인플루언서 수신함의 삭제와 같은 경로로
 *                   실제로 지운다 — SQL 행, 양쪽 Blobs 캐시, 딸려 생긴 정산 항목과
 *                   협업 일정, 예전 Supabase 미러까지. 지운 id 는 묘비에 적어 두어
 *                   조회의 지연 캐시 쓰기로 되살아나지 않게 한다.
 */
export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  const itemId = context.params.id;
  if (!username || !itemId) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  if (req.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // 남의 제안 현황을 지울 수 있으면 안 된다. 해당 업체 계정 본인(또는 관리자)만.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const scope = new URL(req.url).searchParams.get("scope");

  if (scope === "hide") {
    try {
      await hideInboxItem(username, itemId);
    } catch (err) {
      console.error("[api-business-proposal-item] Failed to hide item:", err);
      return Response.json({ error: "목록에서 내리지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 409 });
    }
    return Response.json({ success: true, hidden: true });
  }

  // 묘비를 먼저 적는다. 뒤따르는 단계 중 하나가 실패해도 화면에는 다시 올라오지 않는다.
  try {
    await markProposalDeleted(itemId);
  } catch (tombErr) {
    console.error("[api-business-proposal-item] Failed to record delete tombstone:", tombErr);
  }

  // 업체 쪽 캐시.
  const bizStore = getStore("business-proposals");
  const bizKey = `biz_proposals_${username}`;
  let influencerUsername = "";
  try {
    const existing = ((await bizStore.get(bizKey, { type: "json" })) as any[]) || [];
    const found = existing.find((p: any) => p?.id === itemId);
    influencerUsername = String(found?.influencer_username || found?.username || "").toLowerCase();
    await bizStore.setJSON(bizKey, existing.filter((p: any) => p?.id !== itemId));
  } catch (err) {
    console.error("[api-business-proposal-item] Failed to update business cache:", err);
  }

  // 인플루언서 쪽 캐시. 캐시에 인플루언서 아이디가 없으면 SQL 에서 찾는다 —
  // 여기서 못 찾으면 수신함 캐시에 남아 조회 때 되살아난다(묘비가 막지만, 캐시를
  // 비우는 것이 정상 경로다).
  let dbInstance: any = null;
  try {
    const { getDatabase } = await import("@picks/netlify-database");
    dbInstance = getDatabase();
  } catch {}

  if (!influencerUsername && dbInstance) {
    try {
      const rows = await dbInstance.sql`
        SELECT influencer_username, username FROM proposals WHERE id = ${itemId} LIMIT 1
      ` as any[];
      influencerUsername = String(rows?.[0]?.influencer_username || rows?.[0]?.username || "").toLowerCase();
    } catch (err) {
      console.error("[api-business-proposal-item] Failed to look up influencer:", err);
    }
  }

  if (influencerUsername) {
    try {
      const infStore = getStore("proposals");
      const infKey = `proposals_${influencerUsername}`;
      const existing = ((await infStore.get(infKey, { type: "json" })) as any[]) || [];
      await infStore.setJSON(infKey, existing.filter((p: any) => p?.id !== itemId));
    } catch (err) {
      console.error("[api-business-proposal-item] Failed to update influencer cache:", err);
    }
  }

  // 제안에서 자동 생성된 정산 항목과 협업 일정. 남겨 두면 지운 제안이 정산금 ·
  // 협업 현황 캘린더에만 계속 떠 있게 된다.
  try {
    await removeSettlementsForProposal(itemId, username, influencerUsername);
  } catch (stlErr) {
    console.error("[api-business-proposal-item] Failed to remove linked settlements:", stlErr);
  }

  if (influencerUsername) {
    try {
      await removeCollabScheduleRecord(`proposal_${itemId}`, influencerUsername);
    } catch (schErr) {
      console.error("[api-business-proposal-item] Failed to remove linked collab schedule:", schErr);
    }
  }

  if (dbInstance) {
    try {
      await dbInstance.sql`DELETE FROM proposals WHERE id = ${itemId}`;
    } catch (dbErr) {
      console.error("[api-business-proposal-item] Failed to delete from SQL:", dbErr);
    }
  }

  try {
    const supabase = getSupabaseServer();
    if (supabase) await supabase.from("business_proposals").delete().eq("id", itemId);
  } catch (mirrorErr) {
    console.error("[api-business-proposal-item] Failed to delete Supabase mirror row:", mirrorErr);
  }

  return Response.json({ success: true, deleted: true });
};

export const config: Config = {
  path: "/api/business-proposals/:username/:id",
};
