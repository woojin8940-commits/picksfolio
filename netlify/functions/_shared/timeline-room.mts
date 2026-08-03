import { mutateBlobJSON } from "./blob-write.mts";

/**
 * 브랜드 ↔ 인플루언서 대화방(타임라인) 생성.
 *
 * 원래 이 코드는 api-proposal-item 의 "수락" 분기 안에만 있었다. 그래서 제안을
 * 받은 인플루언서는 수락을 누르기 전까지 브랜드에게 한 마디도 물어볼 수 없었다 —
 * 금액·일정·산출물 범위를 확인하려면 수락이 먼저여야 하는 순서였고, 그 때문에
 * 확인 없이 수락하거나 확인할 방법이 없어 거절하는 일이 생겼다.
 *
 * 방을 만드는 일과 제안을 수락하는 일을 분리해, 제안이 도착한 시점에 방을 열어
 * 둔다. 대화방 목록(api-timeline-list)과 상세(api-timeline-detail), 댓글
 * (api-timeline-comment) 은 제안 상태를 보지 않으므로 게이트를 따로 풀 필요는
 * 없다.
 *
 * 저장은 Blobs(방 본문 + 양쪽 색인)와 SQL 미러 두 곳에 한다. 기존 방식을 그대로
 * 옮긴 것이며, 통째로 덮어쓰던 `get` → `setJSON` 만 조건부 쓰기로 바꿨다. 같은
 * 인플루언서에게 제안이 동시에 들어와도 색인에서 한 건이 사라지지 않는다.
 */

const TIMELINE_STORE = "timelines";

const norm = (raw: unknown) => String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

export type TimelineSystemMessage = {
  id: string;
  proposalId: string;
  authorType: string;
  authorName: string;
  authorUsername: string;
  content: string;
  createdAt: string;
  readBy: string[];
};

export type EnsureTimelineRoomInput = {
  proposalId: string;
  influencerUsername: string;
  businessUsername: string;
  companyName?: string;
  proposalTitle?: string;
  /** 방을 새로 만들 때 첫 안내로 남길 시스템 메시지. */
  systemMessage?: string;
  /** 이미 방이 있으면 시스템 메시지만 덧붙인다(제안 수락 안내 등). */
  appendIfExists?: boolean;
};

export type EnsureTimelineRoomResult = {
  /** 방을 이번 호출에서 새로 만들었는지. */
  created: boolean;
  /** 시스템 메시지를 실제로 남겼는지. */
  messageAdded: boolean;
};

/**
 * 방이 없으면 만들고, 있으면(그리고 `appendIfExists`) 시스템 메시지만 덧붙인다.
 *
 * 실패는 호출한 쪽으로 던진다 — 제안 접수 자체는 막지 않아야 하므로 호출부에서
 * try/catch 로 감싸 로그만 남긴다.
 */
export async function ensureTimelineRoom(
  input: EnsureTimelineRoomInput,
): Promise<EnsureTimelineRoomResult> {
  const proposalId = input.proposalId;
  const influencerUsername = norm(input.influencerUsername);
  const businessUsername = norm(input.businessUsername);
  const companyName = input.companyName || "";
  const proposalTitle = input.proposalTitle || "";
  const nowISO = new Date().toISOString();

  const systemComment: TimelineSystemMessage | null = input.systemMessage
    ? {
        id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_system`,
        proposalId,
        authorType: "business",
        authorName: companyName || businessUsername,
        authorUsername: businessUsername,
        content: input.systemMessage,
        createdAt: nowISO,
        // 안내는 보낸 쪽(브랜드)이 이미 읽은 것으로 둔다. 그래야 받는 쪽에만
        // 안 읽은 표시가 남는다.
        readBy: businessUsername ? [businessUsername] : [],
      }
    : null;

  let created = false;
  let messageAdded = false;

  await mutateBlobJSON<any>(TIMELINE_STORE, `detail_${proposalId}`, (current) => {
    if (current) {
      if (!systemComment || !input.appendIfExists) return null;
      const comments = Array.isArray(current.comments) ? current.comments : [];
      messageAdded = true;
      return { ...current, comments: [...comments, systemComment] };
    }
    created = true;
    messageAdded = !!systemComment;
    return {
      proposalId,
      kind: "brand_influencer",
      influencerUsername,
      businessUsername,
      companyName,
      proposalTitle,
      comments: systemComment ? [systemComment] : [],
      createdAt: nowISO,
    };
  });

  if (created) {
    const indexEntry = {
      proposalId,
      kind: "brand_influencer",
      influencerUsername,
      businessUsername,
      companyName,
      proposalTitle,
      createdAt: nowISO,
    };

    const ensureIndex = async (type: string, username: string) => {
      if (!username) return;
      await mutateBlobJSON<any[]>(TIMELINE_STORE, `index_${type}_${username}`, (current) => {
        const list = Array.isArray(current) ? current : [];
        if (list.some((t: any) => t?.proposalId === proposalId)) return null;
        return [indexEntry, ...list];
      });
    };

    await ensureIndex("influencer", influencerUsername);
    await ensureIndex("business", businessUsername);
  }

  // SQL 미러. 여기서 실패해도 Blobs 방은 이미 살아 있으므로 대화는 가능하다.
  try {
    const { getDatabase } = await import("@picks/netlify-database");
    const db = getDatabase();
    await db.sql`
      INSERT INTO timelines (proposal_id, influencer_username, business_username, company_name, proposal_title, created_at, kind)
      VALUES (${proposalId}, ${influencerUsername}, ${businessUsername}, ${companyName}, ${proposalTitle}, NOW(), ${"brand_influencer"})
      ON CONFLICT (proposal_id) DO NOTHING
    `;
    if (systemComment && messageAdded) {
      await db.sql`
        INSERT INTO timeline_messages (id, proposal_id, author_type, author_name, author_username, content, read_by, created_at)
        VALUES (${systemComment.id}, ${proposalId}, ${systemComment.authorType}, ${systemComment.authorName}, ${systemComment.authorUsername}, ${systemComment.content}, ${systemComment.readBy}, NOW())
        ON CONFLICT (id) DO NOTHING
      `;
    }
  } catch (dbErr) {
    console.error("[timeline-room] SQL 미러 저장 실패:", dbErr);
  }

  return { created, messageAdded };
}
