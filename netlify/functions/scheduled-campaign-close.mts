import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { todayInSeoul } from "./_shared/campaign-recruit.mts";

/**
 * 모집 종료일이 지난 캠페인을 자동으로 마감(status='inactive') 처리한다.
 *
 * 지금까지 마감 여부는 조회할 때마다 종료일을 비교해서 계산했다. 화면에는 제대로
 * 나오지만 DB의 status 는 'active' 그대로라, 통계·관리자 화면·나중에 추가될 다른
 * 조회에서는 여전히 모집중으로 보인다. 매일 한 번 실제 상태를 정리해 두면 그 어긋남이
 * 사라진다. (조회 시점 계산은 이 함수가 돌기 전 몇 시간을 메우는 안전망으로 남겨 둔다.)
 *
 * 모집 인원(max_applicants)이 다 찬 캠페인은 대상이 아니다 — 정원을 넘겨도 종료일까지는
 * 계속 지원을 받는다. 지원자가 많을수록 브랜드가 더 나은 크리에이터를 고를 수 있다.
 *
 * 승인 대기(pending_approval)·승인 거절(admin_rejected) 상태는 건드리지 않는다.
 */

export default async () => {
  const db = getDatabase();
  const today = todayInSeoul();

  try {
    // 종료일이 'YYYY-MM-DD…' 형식인 행만 대상으로 한다(형식이 다른 과거 데이터는 제외).
    // TEXT 컬럼이므로 앞 10자리 사전순 비교 = 날짜순 비교.
    const closed = await db.sql`
      UPDATE campaigns
      SET status = 'inactive', updated_at = NOW()
      WHERE status = 'active'
        AND end_date IS NOT NULL
        AND end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND substring(end_date from 1 for 10) < ${today}
      RETURNING id, title, end_date
    `;

    const rows = closed as any[];
    if (rows.length === 0) {
      console.log(`[campaign-close] ${today} 기준 마감할 캠페인 없음`);
      return;
    }

    console.log(
      `[campaign-close] ${today} 기준 ${rows.length}건 마감: ` +
        rows.map((r) => `${r.id}(~${r.end_date})`).join(", "),
    );
  } catch (err) {
    console.error("[campaign-close] 자동 마감 실패:", err);
  }
};

export const config: Config = {
  // 한국 시간 자정 직후(00:07 KST = 15:07 UTC). 종료일 당일까지는 모집중이므로
  // 날짜가 바뀐 직후에 정리한다.
  schedule: "7 15 * * *",
};
