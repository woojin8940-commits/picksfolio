import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { todayInSeoul } from "./_shared/campaign-recruit.mts";
import { addDays } from "./_shared/collab-workflow.mts";

/**
 * 협업 단계 마감 점검 (하루 1회).
 *
 * 마감일을 데이터로 갖고 있어도 아무도 들여다보지 않으면 없는 것과 같다. 하루 한 번
 * 마감 임박(D-1)과 마감 경과 단계를 찾아 이벤트 원장에 남긴다. 실제 발송은
 * `scheduled-collab-events` 가 원장을 읽어서 처리한다 — 알림을 보내는 곳을 한 군데로
 * 모아 두면 "이 경로로는 알림이 안 갔다"는 사고가 줄어든다.
 *
 * 같은 단계에 대해 같은 종류의 알림을 하루에 두 번 만들지 않는다(20시간 창으로 판정).
 * 마감이 지난 단계는 매일 다시 알린다 — 방치된 협업이 조용히 잊히는 쪽이 더 나쁘다.
 */

export default async () => {
  const db = getDatabase();
  const today = todayInSeoul();
  const tomorrow = addDays(today, 1);

  try {
    const soon = await db.sql`
      INSERT INTO collab_events (id, collab_id, type, actor_role, actor_username, stage_key, summary, payload)
      SELECT
        'ce_due_' || s.id || '_' || ${today},
        s.collab_id,
        'stage_due_soon',
        'system',
        '',
        s.stage_key,
        s.title || ' 마감이 내일(' || s.due_date || ')입니다.',
        jsonb_build_object('dueDate', s.due_date, 'ownerRole', s.owner_role)
      FROM collab_stages s
      JOIN campaign_collabs c ON c.id = s.collab_id
      WHERE c.status = 'in_progress'
        AND s.owner_role = 'influencer'
        AND s.status IN ('active', 'revision')
        AND s.due_date = ${tomorrow}
        AND NOT EXISTS (
          SELECT 1 FROM collab_events e
          WHERE e.collab_id = s.collab_id
            AND e.stage_key = s.stage_key
            AND e.type = 'stage_due_soon'
            AND e.created_at > NOW() - INTERVAL '20 hours'
        )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;

    const overdue = await db.sql`
      INSERT INTO collab_events (id, collab_id, type, actor_role, actor_username, stage_key, summary, payload)
      SELECT
        'ce_over_' || s.id || '_' || ${today},
        s.collab_id,
        'stage_overdue',
        'system',
        '',
        s.stage_key,
        s.title || ' 마감(' || s.due_date || ')이 지났습니다.',
        jsonb_build_object('dueDate', s.due_date, 'ownerRole', s.owner_role)
      FROM collab_stages s
      JOIN campaign_collabs c ON c.id = s.collab_id
      WHERE c.status = 'in_progress'
        AND s.owner_role = 'influencer'
        AND s.status IN ('active', 'revision')
        AND s.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND s.due_date < ${today}
        AND NOT EXISTS (
          SELECT 1 FROM collab_events e
          WHERE e.collab_id = s.collab_id
            AND e.stage_key = s.stage_key
            AND e.type = 'stage_overdue'
            AND e.created_at > NOW() - INTERVAL '20 hours'
        )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;

    console.log(
      `[collab-deadlines] ${today} 기준 마감 임박 ${(soon as any[]).length}건, 마감 경과 ${(overdue as any[]).length}건 기록`,
    );
  } catch (err) {
    console.error("[collab-deadlines] 마감 점검 실패:", err);
  }
};

export const config: Config = {
  schedule: "10 0 * * *",
};
