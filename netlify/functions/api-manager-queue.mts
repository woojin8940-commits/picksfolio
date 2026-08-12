import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireManager } from "./_shared/manager-auth.mts";
import { todayInSeoul } from "./_shared/campaign-recruit.mts";
import { daysUntil } from "./_shared/collab-workflow.mts";
import { isOpenApplyMode, normalizeRewardMode } from "./_shared/reward-mode.mts";

/**
 * 담당자 대기 큐.
 *
 * 담당자 중개 구조의 가장 큰 위험은 "담당자가 답하지 않으면 협업이 멈춘다"는 점이다.
 * 그래서 담당자 화면의 첫 페이지는 협업 목록이 아니라 **내가 막고 있는 일 목록**이어야
 * 한다. 이 API 는 그 목록만 만든다.
 *
 *   1. 담당자 없는 캠페인      — 지원이 들어와도 아무도 선정하지 못하는 상태
 *   2. 선정 대기 지원자        — 브랜드 의견이 있으면 함께 보여준다
 *   3. 검수 대기 제출물        — 인플루언서가 이미 일을 끝내고 기다리는 중
 *   4. 마감 경과 단계          — 사람이 개입해야 풀리는 지연
 *   5. 응답 없는 담당자 채널   — 마지막 말이 담당자가 아닌 방
 */

export default async (req: Request) => {
  const manager = await requireManager(req);
  if (!manager.ok) return manager.response;

  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const db = getDatabase();
  const url = new URL(req.url);
  const mineOnly = url.searchParams.get("mine") === "1";
  const me = manager.managerUsername;
  const today = todayInSeoul();

  try {
    const [unassigned, pendingApps, awaitingReview, overdueStages, unansweredThreads, counts] =
      await Promise.all([
        db.sql`
          SELECT id, title, brand_name, business_username, type, end_date, created_at,
                 (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = campaigns.id) AS application_count
          FROM campaigns
          WHERE status = 'active' AND COALESCE(manager_username, '') = ''
          ORDER BY created_at DESC
          LIMIT 50
        ` as Promise<any[]>,

        db.sql`
          SELECT ca.id, ca.campaign_id, ca.applicant_username, ca.message, ca.contact,
                 ca.portfolio_url, ca.brand_preference, ca.brand_preference_note,
                 ca.manager_note, ca.created_at,
                 c.title AS campaign_title, c.brand_name, c.manager_username, c.reward_amount,
                 c.type, c.reward_mode
          FROM campaign_applications ca
          JOIN campaigns c ON c.id = ca.campaign_id
          WHERE ca.status = 'pending'
            AND c.status = 'active'
            AND (${mineOnly} = false OR COALESCE(c.manager_username, '') = ${me})
          ORDER BY
            CASE ca.brand_preference WHEN 'shortlist' THEN 0 WHEN '' THEN 1 ELSE 2 END,
            ca.created_at ASC
          LIMIT 100
        ` as Promise<any[]>,

        db.sql`
          SELECT s.id, s.collab_id, s.stage_key, s.title, s.due_date, s.submitted_at,
                 c.campaign_title, c.company_name, c.creator_username, c.business_username, c.manager_username
          FROM collab_stages s
          JOIN campaign_collabs c ON c.id = s.collab_id
          WHERE s.status = 'submitted'
            AND c.status = 'in_progress'
            AND (${mineOnly} = false OR COALESCE(c.manager_username, '') = ${me})
          ORDER BY s.submitted_at ASC NULLS LAST
          LIMIT 100
        ` as Promise<any[]>,

        db.sql`
          SELECT s.id, s.collab_id, s.stage_key, s.title, s.owner_role, s.status, s.due_date,
                 c.campaign_title, c.company_name, c.creator_username, c.manager_username
          FROM collab_stages s
          JOIN campaign_collabs c ON c.id = s.collab_id
          WHERE s.status IN ('active', 'revision', 'submitted')
            AND c.status = 'in_progress'
            AND s.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            AND s.due_date < ${today}
            AND (${mineOnly} = false OR COALESCE(c.manager_username, '') = ${me})
          ORDER BY s.due_date ASC
          LIMIT 100
        ` as Promise<any[]>,

        // 마지막 메시지를 담당자가 쓰지 않은 방 = 우리가 답을 미루고 있는 방.
        db.sql`
          SELECT t.proposal_id, t.kind, t.collab_id, t.manager_username,
                 t.company_name, t.proposal_title,
                 t.influencer_username, t.business_username,
                 m.author_type, m.author_name, m.content, m.created_at AS last_message_at
          FROM timelines t
          JOIN LATERAL (
            SELECT author_type, author_name, content, created_at
            FROM timeline_messages tm
            WHERE tm.proposal_id = t.proposal_id
            ORDER BY tm.created_at DESC
            LIMIT 1
          ) m ON TRUE
          WHERE t.kind IN ('influencer_support', 'brand_support')
            AND m.author_type <> 'manager'
            AND (${mineOnly} = false OR COALESCE(t.manager_username, '') = ${me})
          ORDER BY m.created_at ASC
          LIMIT 100
        ` as Promise<any[]>,

        db.sql`
          SELECT
            (SELECT COUNT(*)::int FROM campaign_collabs WHERE status = 'in_progress') AS in_progress,
            (SELECT COUNT(*)::int FROM campaign_collabs WHERE status = 'in_progress' AND COALESCE(manager_username, '') = '') AS unmanaged,
            (SELECT COUNT(*)::int FROM campaign_collabs WHERE status = 'completed') AS completed,
            (SELECT COUNT(*)::int FROM campaign_collabs WHERE status = 'cancelled') AS cancelled,
            (SELECT COUNT(*)::int FROM collab_feedbacks WHERE status = 'open' AND visible_to_influencer = FALSE) AS brand_feedback_open
        ` as Promise<any[]>,
      ]);

    return Response.json({
      manager: me,
      today,
      unassignedCampaigns: (unassigned as any[]).map((c) => ({
        id: c.id,
        title: c.title,
        brandName: c.brand_name,
        businessUsername: c.business_username,
        type: c.type,
        endDate: c.end_date,
        applicationCount: c.application_count,
        createdAt: c.created_at,
      })),
      pendingApplications: (pendingApps as any[]).map((a) => ({
        id: a.id,
        campaignId: a.campaign_id,
        campaignTitle: a.campaign_title,
        brandName: a.brand_name,
        managerUsername: a.manager_username || "",
        applicantUsername: a.applicant_username,
        message: a.message || "",
        contact: a.contact || "",
        portfolioUrl: a.portfolio_url || "",
        brandPreference: a.brand_preference || "",
        brandPreferenceNote: a.brand_preference_note || "",
        // 담당자가 적어 둔 추천 이유. 브랜드의 지원자 카드에 그대로 보이는 줄이라
        // 큐에서도 지금 뭐라고 적혀 있는지 보여야 고쳐 쓸 수 있다.
        managerNote: a.manager_note || "",
        rewardAmount: a.reward_amount || "",
        campaignType: a.type || "",
        rewardMode: normalizeRewardMode(a.reward_mode),
        // 제품 협찬형·공동구매는 브랜드가 직접 수락한다. 담당자 화면이 이걸 모르면
        // 브랜드가 아직 고르는 중인 지원자를 담당자가 대신 선정해 버릴 수 있다.
        selectionBy: isOpenApplyMode(a.reward_mode) ? "brand" : "manager",
        createdAt: a.created_at,
      })),
      awaitingReview: (awaitingReview as any[]).map((s) => ({
        collabId: s.collab_id,
        stageKey: s.stage_key,
        stageTitle: s.title,
        campaignTitle: s.campaign_title,
        companyName: s.company_name,
        creatorUsername: s.creator_username,
        managerUsername: s.manager_username || "",
        dueDate: s.due_date || "",
        submittedAt: s.submitted_at,
      })),
      overdueStages: (overdueStages as any[]).map((s) => ({
        collabId: s.collab_id,
        stageKey: s.stage_key,
        stageTitle: s.title,
        ownerRole: s.owner_role,
        status: s.status,
        campaignTitle: s.campaign_title,
        creatorUsername: s.creator_username,
        managerUsername: s.manager_username || "",
        dueDate: s.due_date || "",
        daysLate: -(daysUntil(s.due_date, today) ?? 0),
      })),
      unansweredThreads: (unansweredThreads as any[]).map((t) => ({
        proposalId: t.proposal_id,
        kind: t.kind,
        collabId: t.collab_id || "",
        counterpart: t.kind === "influencer_support" ? t.influencer_username : t.business_username,
        companyName: t.company_name || "",
        proposalTitle: t.proposal_title || "",
        managerUsername: t.manager_username || "",
        lastAuthorType: t.author_type,
        lastAuthorName: t.author_name || "",
        preview: String(t.content || "").slice(0, 80),
        lastMessageAt: t.last_message_at,
      })),
      counts: (counts as any[])[0] || {},
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || "대기 큐를 불러오지 못했습니다." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/manager-queue",
};
