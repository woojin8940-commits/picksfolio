import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { todayInSeoul } from "./_shared/campaign-recruit.mts";
import { collectCampaignMetrics } from "./_shared/post-metrics.mts";

/**
 * 매일 한 번, 올라간 캠페인 게시물의 성과를 받아 그날의 값을 기록한다.
 *
 * 화면을 열 때도 오래된 값은 갱신되지만, 그것만으로는 추이 그래프가 생기지 않는다.
 * 인스타그램은 "지금 조회수 몇"만 알려 주고 어제 몇이었는지는 알려 주지 않으므로,
 * 어제의 숫자는 어제 우리가 받아 둔 것뿐이다. 아무도 화면을 열지 않은 날은 그 날짜가
 * 통째로 비고, 그 구멍은 나중에 어떤 방법으로도 메울 수 없다.
 *
 * 그래서 매일 아침 한 번 훑는다. 하루 한 점씩 쌓이면 "업로드 후 며칠에 조회수가
 * 붙는지"를 브랜드도 인플루언서도 볼 수 있다.
 *
 * ── 무엇을 훑는가 ──
 * 최근 90일 안에 게시물이 올라간 캠페인만 본다. 그보다 오래된 게시물은 숫자가 거의
 * 움직이지 않고, 메타의 최근 미디어 목록에서도 밀려나 어차피 맞춰지지 않는다. 한
 * 번의 실행에서 다룰 캠페인 수도 제한한다 — 함수 실행 시간을 다 태우면 그날 기록이
 * 절반만 남고, 절반만 남은 하루는 그래프에서 성과가 꺾인 날처럼 보인다.
 */

/** 한 번의 실행에서 훑을 캠페인 수. 나머지는 다음 날(과 화면 열기)에 갱신된다. */
const MAX_CAMPAIGNS = 30;
/** 이보다 오래된 게시물만 남은 캠페인은 더 이상 훑지 않는다. */
const WINDOW_DAYS = 90;

export default async () => {
  const db = getDatabase();
  const today = todayInSeoul();

  try {
    /**
     * 대상 캠페인 — 게시물이 올라간 협업이 하나라도 있고, 그중 가장 최근 업로드가
     * 최근 90일 안인 캠페인. 최근 업로드 순으로 본다(방금 올라간 게시물이 숫자가
     * 가장 빠르게 움직인다).
     */
    const rows = (await db.sql`
      SELECT cc.campaign_id,
             MAX(COALESCE(cc.upload_confirmed_at, cc.updated_at)) AS last_upload,
             COUNT(*) AS posts
      FROM campaign_collabs cc
      WHERE COALESCE(cc.upload_url, '') <> ''
        AND cc.cancelled_at IS NULL
        AND cc.status <> 'cancelled'
        AND COALESCE(cc.upload_confirmed_at, cc.updated_at) > NOW() - (${WINDOW_DAYS} * INTERVAL '1 day')
      GROUP BY cc.campaign_id
      ORDER BY last_upload DESC
      LIMIT ${MAX_CAMPAIGNS}
    `) as any[];

    if (!rows || rows.length === 0) {
      console.log(`[post-metrics] ${today} 기준 갱신할 캠페인 없음`);
      return;
    }

    let collected = 0;
    let attempted = 0;
    for (const row of rows) {
      try {
        // force 로 부른다. 오늘 아직 기록이 없는 날이라면 최근에 받아 둔 값이 있어도
        // 그 값은 어제의 것이다 — 오늘의 점을 찍으려면 오늘 받아야 한다.
        const res = await collectCampaignMetrics(db, String(row.campaign_id), { force: true });
        attempted += res.attempted;
        collected += res.collected;
      } catch (e) {
        console.warn(
          `[post-metrics] ${row.campaign_id} 갱신 실패:`,
          (e as Error)?.message,
        );
      }
    }

    console.log(
      `[post-metrics] ${today} 캠페인 ${rows.length}건 · 게시물 ${attempted}건 시도 · ${collected}건 수집`,
    );
  } catch (err) {
    console.error("[post-metrics] 일일 성과 수집 실패:", err);
  }
};

export const config: Config = {
  // 한국 시간 오전 6시 35분(21:35 UTC). 사람이 아침에 열어 볼 때는 이미 그날 값이 있다.
  schedule: "35 21 * * *",
};
