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
 *
 * 릴스 단가도 같은 이유로 담던 날 값에 멈춰 있었다. 등록자가 매칭받기 등록서의 숏폼 단가를
 * 고치면 그 금액을 릴스 원가로 바로 쓰고, 운영자가 붙인 마진(저장된 릴스 단가 − 원가)은
 * 그대로 얹는다. 등록서에 숏폼 단가가 비어 있으면 저장된 값을 쓴다.
 */

const INT_MAX = 2_147_483_647;
const toInt = (n: unknown) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(INT_MAX, Math.max(0, v)) : 0;
};

/**
 * 등록서의 단가 문구("게시물 30만원 / 숏폼 50만원", "300,000원")에서 첫 금액을 원 단위로 읽는다.
 * 숫자만 남기면 두 금액이 이어 붙어("300000500000") 정수 칸을 넘기고, 만원 단위도 틀린다.
 */
export function priceFromText(raw: unknown): number {
  const m = String(raw ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(만|천)?/);
  if (!m) return 0;
  const unit = m[2] === "만" ? 10000 : m[2] === "천" ? 1000 : 1;
  return toInt(Number(m[1]) * unit);
}

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

type LiveRegistered = { reels: SalesReel[]; reelsBasePrice: number };

/** application_id → 채널 지표의 최근 릴스(최대 3편)와 등록서의 숏폼 단가. */
async function loadLiveRegistered(db: any, applicationIds: string[]): Promise<Map<string, LiveRegistered>> {
  const out = new Map<string, LiveRegistered>();
  const ids = [...new Set(applicationIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await db.sql`
    SELECT a.id, a.short_price, c.recent_reels
    FROM collab_directory_applications a
    LEFT JOIN creator_channels c ON LOWER(c.username) = LOWER(a.applicant_username)
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
    out.set(String(row.id), { reels, reelsBasePrice: priceFromText(row.short_price) });
  }
  return out;
}

/**
 * rows 중 source='registered' 인 줄의 recent_reels·릴스 단가를 지금 값으로 바꾼 사본을 돌려준다.
 * 릴스가 바뀐 줄에는 reels_live=true, 릴스 단가가 바뀐 줄에는 reels_price_live=true 가 붙는다.
 * 조회에 실패하면 저장된 값을 그대로 돌려준다.
 */
export async function withLiveRegisteredReels<T extends Record<string, any>>(
  db: any,
  rows: T[],
): Promise<(T & { reels_live?: boolean; reels_price_live?: boolean })[]> {
  const appIds = rows
    .filter((r) => r.source === "registered" && r.application_id)
    .map((r) => String(r.application_id));
  if (!appIds.length) return rows;

  let live: Map<string, LiveRegistered>;
  try {
    live = await loadLiveRegistered(db, appIds);
  } catch (err: any) {
    console.error("[sales-links] 매칭 등록자 지표 조회 실패:", err?.message);
    return rows;
  }

  return rows.map((r) => {
    const fresh = r.source === "registered" ? live.get(String(r.application_id)) : undefined;
    if (!fresh) return r;
    let out: any = r;
    if (fresh.reels.length) {
      const priorViews = new Map(
        parseJsonArray(r.recent_reels).map((x: any) => [cleanReelUrl(x?.permalink), toInt(x?.views)]),
      );
      const reels = fresh.reels.map((x) => (x.views ? x : { ...x, views: priorViews.get(x.permalink) || 0 }));
      out = { ...out, recent_reels: reels, reels_live: true };
    }
    if (fresh.reelsBasePrice > 0) {
      const margin = Math.max(0, toInt(r.reels_price) - toInt(r.reels_base_price));
      out = {
        ...out,
        reels_base_price: fresh.reelsBasePrice,
        reels_price: toInt(fresh.reelsBasePrice + margin),
        reels_price_live: true,
      };
    }
    return out;
  });
}
