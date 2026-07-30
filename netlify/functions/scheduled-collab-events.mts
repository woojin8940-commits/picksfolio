import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { sendPushToUser } from "./_shared/push.mts";

/**
 * 협업 이벤트 → 알림 발송.
 *
 * 상태를 바꾼 곳마다 알림 코드를 붙이면, 어떤 화면은 보내고 어떤 화면은 잊는 일이
 * 반드시 생긴다. 그래서 상태를 바꾼 함수는 `collab_events` 에 한 줄 남기는 일만 하고,
 * 실제 발송은 여기서 한 곳에서 처리한다. 보낸 이벤트는 notified_at 으로 표시하므로
 * 같은 이벤트가 두 번 나가지 않는다.
 *
 * 브랜드와 인플루언서에게는 앱 푸시와 알림톡을 보낸다. 담당자에게는 보내지 않는다 —
 * 담당자는 운영 콘솔의 대기 큐(응답 없는 채널 · 제출 대기 · 마감 임박)를 보고 일하며,
 * 협업 수가 늘면 담당자 한 명이 받는 알림이 하루 수백 건이 되어 오히려 아무것도
 * 읽지 않게 된다.
 */

type EventRow = {
  id: string;
  collab_id: string;
  type: string;
  stage_key: string;
  summary: string;
  payload: any;
  creator_username: string;
  business_username: string;
  campaign_title: string;
  company_name: string;
};

type Audience = "influencer" | "brand";

/** 이벤트별로 누구에게, 어떤 문구로 알릴지. 목록에 없는 이벤트는 알리지 않는다. */
const NOTIFY_MAP: Record<string, { to: Audience[]; title: (e: EventRow) => string; body: (e: EventRow) => string }> = {
  applicant_selected: {
    to: ["influencer"],
    title: (e) => `${e.campaign_title} 캠페인 선정`,
    body: () => "축하합니다! 캠페인에 선정되셨어요. 담당자가 진행을 안내드립니다.",
  },
  terms_locked: {
    to: ["influencer", "brand"],
    title: (e) => `${e.campaign_title} 조건 확정`,
    body: () => "협업 조건과 마감일이 확정되었습니다. 협업 화면에서 확인해 주세요.",
  },
  revision_requested: {
    to: ["influencer"],
    title: (e) => `${e.campaign_title} 수정 요청`,
    body: () => "담당자가 수정 요청을 보냈습니다. 항목을 확인하고 다시 제출해 주세요.",
  },
  feedback_sent: {
    to: ["influencer"],
    title: (e) => `${e.campaign_title} 피드백 도착`,
    body: () => "확인이 필요한 피드백이 도착했습니다.",
  },
  stage_completed: {
    to: ["influencer", "brand"],
    title: (e) => `${e.campaign_title} 단계 완료`,
    body: (e) => e.summary || "다음 단계가 시작되었습니다.",
  },
  collab_completed: {
    to: ["influencer", "brand"],
    title: (e) => `${e.campaign_title} 협업 완료`,
    body: () => "모든 단계가 끝났습니다. 정산 일정은 정산 화면에서 확인하실 수 있습니다.",
  },
  schedule_changed: {
    to: ["influencer", "brand"],
    title: (e) => `${e.campaign_title} 일정 변경`,
    body: (e) => e.summary || "마감일이 변경되었습니다.",
  },
  collab_cancelled: {
    to: ["influencer", "brand"],
    title: (e) => `${e.campaign_title} 협업 취소`,
    body: (e) => `협업이 취소되었습니다. 사유: ${e.payload?.reason || "담당자 확인"}`,
  },
  stage_due_soon: {
    to: ["influencer"],
    title: (e) => `${e.campaign_title} 마감 임박`,
    body: (e) => e.summary || "마감일이 다가왔습니다.",
  },
  stage_overdue: {
    to: ["influencer"],
    title: (e) => `${e.campaign_title} 마감 경과`,
    body: (e) => e.summary || "마감일이 지났습니다. 담당자에게 상황을 알려 주세요.",
  },
};

export default async () => {
  const db = getDatabase();
  const siteOrigin = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";

  let rows: EventRow[] = [];
  try {
    rows = (await db.sql`
      SELECT e.id, e.collab_id, e.type, e.stage_key, e.summary, e.payload,
             c.creator_username, c.business_username, c.campaign_title, c.company_name
      FROM collab_events e
      JOIN campaign_collabs c ON c.id = e.collab_id
      WHERE e.notified_at IS NULL
      ORDER BY e.created_at ASC
      LIMIT 50
    `) as any[];
  } catch (err) {
    console.error("[collab-events] 이벤트 조회 실패:", err);
    return;
  }

  if (rows.length === 0) return;

  for (const event of rows) {
    const rule = NOTIFY_MAP[event.type];

    // 알림 대상이 아닌 이벤트도 처리 완료로 표시한다. 그러지 않으면 매 분 같은
    // 행을 다시 읽어 큐가 영구히 막힌다.
    if (!rule) {
      await markNotified(db, event.id);
      continue;
    }

    for (const audience of rule.to) {
      const username = audience === "influencer" ? event.creator_username : event.business_username;
      if (!username) continue;

      const title = rule.title(event);
      const body = rule.body(event);
      const link = `${siteOrigin}/admin?tab=collab&collab=${event.collab_id}`;

      try {
        await sendPushToUser(username, {
          title,
          body,
          data: { type: "collab", collabId: event.collab_id, path: `/admin?tab=collab&collab=${event.collab_id}` },
        });
      } catch (pushErr) {
        console.error(`[collab-events] 푸시 실패 (${username}):`, pushErr);
      }

      if (!siteOrigin) continue;
      try {
        await fetch(`${siteOrigin}/api/send-kakao-alimtalk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            message: `[픽스폴리오] ${title}\n\n${body}\n\n${link}`,
            templateId: Netlify.env.get("SOLAPI_KAKAO_COLLAB_TEMPLATE_ID") || "",
            variables: {
              "#{고객명}": username,
              "#{업체명}": event.company_name || "",
              "#{프로젝트명}": event.campaign_title || "",
              "#{메시지내용}": body,
              "#{링크연결}": link,
            },
          }),
        });
      } catch (smsErr) {
        console.error(`[collab-events] 알림톡 실패 (${username}):`, smsErr);
      }
    }

    await markNotified(db, event.id);
  }

  console.log(`[collab-events] ${rows.length}건 처리`);
};

async function markNotified(db: any, id: string) {
  try {
    await db.sql`UPDATE collab_events SET notified_at = NOW() WHERE id = ${id}`;
  } catch (err) {
    console.error("[collab-events] notified_at 갱신 실패:", err);
  }
}

export const config: Config = {
  schedule: "*/5 * * * *",
};
