import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { sendPushToUser } from "./_shared/push.mts";
import { sendKakaoAlimtalk } from "./_shared/kakao-message.mts";
import {
  type AlimtalkTemplate,
  planApprovedAlimtalk,
  planFeedbackAlimtalk,
  productShippedAlimtalk,
  videoApprovedAlimtalk,
  videoFeedbackAlimtalk,
} from "./_shared/alimtalk-templates.mts";

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
  /** 캠페인에 적힌 제품명. 제품 발송 완료 알림톡의 "상품명" 줄이 이 값을 쓴다. */
  product_name: string;
};

type Audience = "influencer" | "brand";

/** JSONB payload 는 드라이버에 따라 문자열로 올 수 있다. */
const payloadOf = (event: EventRow): Record<string, any> => {
  const raw = event.payload;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? raw : {};
};

/**
 * 이 이벤트가 다섯 단계 묶음의 어느 칸에서 왔는지.
 *
 * 기획안과 영상 초안은 알림톡 템플릿이 서로 다르다(피드백 두 개, 검토 완료 두 개).
 * 이벤트를 남길 때 payload.step 에 칸 이름을 적어 두므로 그것을 먼저 보고, 없는
 * 예전 이벤트는 stage_key 로 떨어진다.
 */
const stepOf = (event: EventRow): string => {
  const fromPayload = String(payloadOf(event).step || "").trim();
  if (fromPayload) return fromPayload;
  return String(event.stage_key || "").trim();
};

const collabNames = (event: EventRow) => ({
  influencer: event.creator_username,
  brand: event.company_name,
  campaignTitle: event.campaign_title,
});

/**
 * 이벤트별로 누구에게, 어떤 문구로 알릴지. 목록에 없는 이벤트는 알리지 않는다.
 *
 * `alimtalk` 은 승인된 카카오 템플릿이 있는 알림만 채운다. 비워 두면 그 이벤트는
 * 앱 푸시와 화면 안 알림으로만 나간다 — 템플릿 없이 발송을 시도하면 알림톡이
 * 아니라 같은 문구의 문자가 나가고(대체 발송), 협업 이벤트는 종류가 많아서 그
 * 문자가 모든 이벤트마다 양쪽에게 쌓인다.
 */
type NotifyRule = {
  to: Audience[];
  title: (e: EventRow) => string;
  body: (e: EventRow) => string;
  alimtalk?: (e: EventRow, audience: Audience) => AlimtalkTemplate | null;
};

const NOTIFY_MAP: Record<string, NotifyRule> = {
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
    // 브랜드가 기획안 · 영상 초안 칸 아래에 남긴 피드백. 그 두 칸에만 템플릿이 있다
    // (예전 아홉 단계 묶음의 구성안·콘텐츠 검수 피드백은 푸시로만 나간다).
    alimtalk: (e, audience) => {
      if (audience !== "influencer") return null;
      const step = stepOf(e);
      if (step === "plan") return planFeedbackAlimtalk(collabNames(e));
      if (step === "video") return videoFeedbackAlimtalk(collabNames(e));
      return null;
    },
  },
  /**
   * 제품 발송 완료. 브랜드가 발송 처리를 누른 뒤 인플루언서에게 나간다.
   *
   * 예전에는 이 이벤트가 목록에 없어서 아무 알림도 나가지 않았다 — 인플루언서는
   * 협업 화면을 다시 열어 보기 전까지 제품이 떠났는지 알 수 없었고, 그 사이의
   * "보냈나요?" 대화가 협업방에 그대로 쌓였다.
   */
  product_shipped: {
    to: ["influencer"],
    title: (e) => `${e.campaign_title} 제품 발송`,
    body: (e) => e.summary || "브랜드가 협업 제품을 발송했습니다.",
    alimtalk: (e, audience) => {
      if (audience !== "influencer") return null;
      const payload = payloadOf(e);
      return productShippedAlimtalk({
        influencer: e.creator_username,
        brand: e.company_name,
        productName: e.product_name || e.campaign_title,
        courier: payload.courier,
        trackingNumber: payload.trackingNumber,
        shippedAt: payload.shippedAt,
      });
    },
  },
  stage_completed: {
    to: ["influencer", "brand"],
    title: (e) => `${e.campaign_title} 단계 완료`,
    body: (e) => e.summary || "다음 단계가 시작되었습니다.",
    // 브랜드가 기획안 · 영상 초안 검토를 끝냈다는 뜻이므로 알림톡은 인플루언서에게만
    // 간다(브랜드는 자기가 누른 버튼의 결과를 통보받을 이유가 없다). 다음 칸으로
    // 넘어가도 된다는 신호라서 검토 완료 시점에 반드시 닿아야 한다.
    alimtalk: (e, audience) => {
      if (audience !== "influencer") return null;
      const step = stepOf(e);
      if (step === "plan") return planApprovedAlimtalk(collabNames(e));
      if (step === "video") return videoApprovedAlimtalk(collabNames(e));
      return null;
    },
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

  let rows: EventRow[] = [];
  try {
    rows = (await db.sql`
      SELECT e.id, e.collab_id, e.type, e.stage_key, e.summary, e.payload,
             c.creator_username, c.business_username, c.campaign_title, c.company_name,
             COALESCE(cp.product_name, '') AS product_name
      FROM collab_events e
      JOIN campaign_collabs c ON c.id = e.collab_id
      LEFT JOIN campaigns cp ON cp.id = c.campaign_id
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

      try {
        await sendPushToUser(username, {
          title,
          body,
          data: { type: "collab", collabId: event.collab_id, path: `/admin?tab=collab&collab=${event.collab_id}` },
        });
      } catch (pushErr) {
        console.error(`[collab-events] 푸시 실패 (${username}):`, pushErr);
      }

      const template = rule.alimtalk?.(event, audience) || null;
      if (!template) continue;

      try {
        await sendKakaoAlimtalk({ username, ...template });
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
