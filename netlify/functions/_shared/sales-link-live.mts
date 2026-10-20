import { cleanReelUrl, type SalesReel } from "./sales-link-profile.mts";

/**
 * 영업 링크의 매칭 등록자 줄에 지금 채널 지표의 최근 릴스를 입힌다.
 *
 * 명단 줄은 담는 순간의 사본이라, 그 뒤로 등록자가 새 릴스를 올리거나 조회수가 쌓여도
 * '새로고침'을 누르기 전까지 그대로 멈춰 있었다. 매칭 등록자는 메타 연동으로 릴스별
 * 조회수를 이미 받아 두므로(creator_channels.recent_reels), 화면에 낼 때마다 그 값을
 * 읽어 최근 릴스 3편과 조회수를 자동으로 보여 준다. 채널 지표에 릴스가 없으면(연동 전)
 * 저장해 둔 사본을 그대로 쓰고, 채널이 조회수를 못 받은 릴스는 같은 릴스에 손으로 넣어
 * 둔 조회수를 이어 쓴다.
 */

const INT_MAX = 2_147_483_647;
const toInt = (n: unknown) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(INT_MAX, Math.max(0, v)) : 0;
};

function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** application_id → 채널 지표의 최근 릴스(최대 3편). 릴스가 없는 등록자는 빠진다. */
async function loadChannelReels(db: any, applicationIds: string[]): Promise<Map<string, SalesReel[]>> {
  const out = new Map<string, SalesReel[]>();
  const ids = [...new Set(applicationIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await db.sql`
    SELECT a.id, c.recent_reels
    FROM collab_directory_applications a
    JOIN creator_channels c ON LOWER(c.username) = LOWER(a.applicant_username)
    WHERE a.id = ANY(${ids}::text[])
  `;
  for (const row of rows) {
    const reels = parseJsonArray(row.recent_reels)
      .filter((r: any) => cleanReelUrl(r?.permalink))
      .slice(0, 3)
      .map((r: any) => ({
        id: String(r?.id || ""),
        permalink: cleanReelUrl(r.permalink),
        thumbnailUrl: String(r?.thumbnailUrl || ""),
        views: toInt(r?.views),
      }));
    if (reels.length) out.set(String(row.id), reels);
  }
  return out;
}

/**
 * rows 중 source='registered' 인 줄의 recent_reels 를 채널 지표 기준으로 바꾼 사본을 돌려준다.
 * 바뀐 줄에는 reels_live=true 가 붙는다. 조회에 실패하면 저장된 값을 그대로 돌려준다.
 */
export async function withLiveRegisteredReels<T extends Record<string, any>>(
  db: any,
  rows: T[],
): Promise<(T & { reels_live?: boolean })[]> {
  const appIds = rows
    .filter((r) => r.source === "registered" && r.application_id)
    .map((r) => String(r.application_id));
  if (!appIds.length) return rows;

  let live: Map<string, SalesReel[]>;
  try {
    live = await loadChannelReels(db, appIds);
  } catch (err: any) {
    console.error("[sales-links] 채널 릴스 조회 실패:", err?.message);
    return rows;
  }

  return rows.map((r) => {
    const fresh = r.source === "registered" ? live.get(String(r.application_id)) : undefined;
    if (!fresh) return r;
    const priorViews = new Map(
      parseJsonArray(r.recent_reels).map((x: any) => [cleanReelUrl(x?.permalink), toInt(x?.views)]),
    );
    const reels = fresh.map((x) => (x.views ? x : { ...x, views: priorViews.get(x.permalink) || 0 }));
    return { ...r, recent_reels: reels, reels_live: true };
  });
}
