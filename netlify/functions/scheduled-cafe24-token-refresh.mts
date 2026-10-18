import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { refreshConnection } from "./_shared/cafe24-api.mts";

/**
 * 카페24 토큰 미리 갱신 — 하루 한 번(03:40 KST).
 *
 * 리프레시 토큰은 2주 뒤 만료된다. API 를 부르는 몰은 호출할 때마다 갱신되지만, 판매
 * 캠페인이 잠시 쉬는 몰은 그대로 만료돼 재연동이 필요해진다. 리프레시 만료가 3일 안으로
 * 다가온 연결을 미리 갱신한다. 갱신은 _shared/cafe24-api.mts 의 refreshConnection 한 곳에서만
 * 한다 — 행 잠금 안에서 만료 시각을 다시 보므로, 그 사이 다른 요청이 갱신했으면 건너뛴다.
 *
 * 다 쓴 OAuth state(만료 하루 경과)도 여기서 지운다.
 */
const AHEAD_MS = 3 * 24 * 60 * 60 * 1000;

export default async () => {
  const db = getDatabase();
  let rows: any[] = [];
  try {
    rows = (await db.sql`
      SELECT mall_id FROM cafe24_connections
      WHERE status = 'active' AND refresh_token_expires_at < NOW() + INTERVAL '3 days'
      ORDER BY refresh_token_expires_at
      LIMIT 200
    `) as any[];
  } catch {
    // 표가 아직 없는 환경(마이그레이션 전).
    return;
  }

  const counts = { refreshed: 0, skipped: 0, reconnect: 0, failed: 0 };
  for (const r of rows) {
    const out = await refreshConnection(
      String(r.mall_id),
      (c) => !c.refreshExpiresAt || c.refreshExpiresAt - Date.now() <= AHEAD_MS,
      db,
    );
    if (out.ok) counts[out.refreshed ? "refreshed" : "skipped"]++;
    else if (out.reason === "reconnect") counts.reconnect++;
    else counts.failed++;
  }

  try {
    await db.sql`DELETE FROM cafe24_oauth_states WHERE expires_at < NOW() - INTERVAL '1 day'`;
  } catch {
    // 정리는 다음 날 다시 한다.
  }
  console.log(
    `[cafe24-token-refresh] due ${rows.length}: refreshed ${counts.refreshed}, skipped ${counts.skipped}, reconnect ${counts.reconnect}, failed ${counts.failed}`,
  );
};

export const config: Config = {
  schedule: "40 18 * * *",
};
