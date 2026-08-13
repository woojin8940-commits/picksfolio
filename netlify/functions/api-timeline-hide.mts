import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { resolveTimelineAccess } from "./_shared/timeline-access.mts";
import { requireSignedInUser } from "./_shared/user-auth.mts";

/**
 * 협업 대화를 내 목록에서 내리기 / 되돌리기.
 *
 *   DELETE /api/timeline/hide/:proposalId  → 내 목록에서 내린다
 *   POST   /api/timeline/hide/:proposalId  → 되돌린다(삭제 직후 "되돌리기")
 *
 * 대화방과 메시지는 지우지 않는다. 방은 인플루언서·브랜드(·담당자)가 함께 쓰는
 * 기록이라 한쪽이 지우면 상대의 내역까지 사라지고, 정산·분쟁 때 근거가 없어진다.
 * 그래서 "이 사람의 목록에서 안 보이게" 한다는 뜻으로만 기록한다(timeline_hidden).
 *
 * 목록에서 내린 뒤 상대가 새 메시지를 보내면 목록 조회 쪽에서 다시 살려 준다 —
 * 한 번 지운 업체의 연락을 영구히 놓치면 삭제 기능이 오히려 손해가 된다.
 */

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

/** 이 방의 참여자. Blobs 상세 → SQL 순으로 찾는다(상세가 없는 예전 방도 있다). */
async function findParticipants(
  proposalId: string,
): Promise<{ influencer?: string; business?: string; manager?: string } | null> {
  const store = getStore("timelines");
  const detail = (await store
    .get(`detail_${proposalId}`, { type: "json" })
    .catch(() => null)) as any;
  if (detail) {
    return {
      influencer: detail.influencerUsername || "",
      business: detail.businessUsername || "",
      manager: detail.managerUsername || "",
    };
  }

  try {
    const { getDatabase } = await import("@picks/netlify-database");
    const db = getDatabase();
    const rows = (await db.sql`
      SELECT influencer_username, business_username, manager_username
      FROM timelines WHERE proposal_id = ${proposalId}
    `) as any[];
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row) {
      return {
        influencer: row.influencer_username || "",
        business: row.business_username || "",
        manager: row.manager_username || "",
      };
    }
  } catch (e) {
    console.error("[timeline-hide] 참여자 조회 실패:", e);
  }

  return null;
}

/**
 * 방 기록이 어디에도 없는 경우의 대비책. 방이 없어도 목록에는 남아 있을 수 있어서
 * (Blobs 색인에만 있는 예전 건) 그 줄을 못 내리면 영구히 지울 수 없는 줄이 된다.
 * 호출자 본인의 색인에 그 방이 들어 있으면 당사자로 본다.
 */
async function isInOwnIndex(username: string, proposalId: string): Promise<boolean> {
  const store = getStore("timelines");
  for (const userType of ["influencer", "business"]) {
    const idx = (await store
      .get(`index_${userType}_${username}`, { type: "json" })
      .catch(() => null)) as any[] | null;
    if (Array.isArray(idx) && idx.some((t) => t?.proposalId === proposalId)) return true;
  }
  return false;
}

export default async (req: Request, context: Context) => {
  const proposalId = context.params.proposalId;
  if (!proposalId) {
    return Response.json({ error: "Missing proposalId" }, { status: 400 });
  }
  if (req.method !== "DELETE" && req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // 누가 내리는지 확인한다. 참여자를 알려면 방을 먼저 읽어야 하므로 방을 찾은 뒤
  // 대조하고, 방 기록이 없으면 본인 목록에 있는지로 판단한다.
  const participants = await findParticipants(proposalId);

  let username = "";
  if (participants) {
    const access = await resolveTimelineAccess(req, participants);
    if (!access.ok) return access.response;
    username = access.username;
  } else {
    const caller = await requireSignedInUser(req);
    if (!caller.ok) return caller.response;
    username = caller.username;
    if (!username || !(await isInOwnIndex(username, proposalId))) {
      return Response.json(
        { error: "이 대화방에 접근할 수 없습니다.", code: "AUTH_FORBIDDEN" },
        { status: 403 },
      );
    }
  }

  username = norm(username);
  if (!username) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let db: any;
  try {
    const { getDatabase } = await import("@picks/netlify-database");
    db = getDatabase();
  } catch (e) {
    console.error("[timeline-hide] DB 연결 실패:", e);
    return Response.json(
      { error: "대화 목록을 정리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  try {
    if (req.method === "DELETE") {
      // 이미 내려둔 방을 다시 내리면 시각만 갱신한다 — 새 메시지로 되살아난 뒤
      // 다시 삭제한 경우가 그렇다. 시각이 그대로면 그 메시지가 또 방을 살려 낸다.
      await db.sql`
        INSERT INTO timeline_hidden (proposal_id, username, hidden_at)
        VALUES (${proposalId}, ${username}, now())
        ON CONFLICT (proposal_id, username) DO UPDATE SET hidden_at = now()
      `;
      return Response.json({ success: true, hidden: true });
    }

    await db.sql`
      DELETE FROM timeline_hidden
      WHERE proposal_id = ${proposalId} AND username = ${username}
    `;
    return Response.json({ success: true, hidden: false });
  } catch (e) {
    console.error("[timeline-hide] 저장 실패:", e);
    return Response.json(
      { error: "대화 목록을 정리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/timeline/hide/:proposalId",
};
