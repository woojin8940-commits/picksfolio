import { cleanReelUrl, handleFromInput, type SalesReel } from "./sales-link-profile.mts";

/**
 * 영업 링크의 매칭 등록자 줄에 지금 값(최근 릴스·등록서 단가)을 입힌다.
 *
 * 명단 줄은 담는 순간의 사본이라, 그 뒤로 등록자가 새 릴스를 올리거나 조회수가 쌓여도
 * '새로고침'을 누르기 전까지 그대로 멈춰 있었다. 매칭 등록자는 메타 연동으로 릴스별
 * 조회수를 이미 받아 두므로(creator_channels.recent_reels), 화면에 낼 때마다 그 값을
 * 읽어 최근 릴스 3편과 조회수를 자동으로 보여 준다. 채널 지표에 릴스가 없으면(연동 전)
 * 저장해 둔 사본을 그대로 쓰고, 채널이 조회수를 못 받은 릴스는 같은 릴스에 손으로 넣어
 * 둔 조회수를 이어 쓴다.
 *
 * 단가는 칸마다(피드 / 릴스) 두 상태다.
 *  - 운영자가 저장한 칸(price_locked / reels_price_locked): 저장한 원가·제안가를 그대로 낸다.
 *    예전에는 등록서 단가가 바뀌면 원가를 바꿔 끼우고 마진만 얹어서, 운영자가 정한 제안가와
 *    다른 금액이 브랜드에게 보였다.
 *  - 손대지 않은 칸: 등록서의 지금 단가를 그대로 원가·제안가로 낸다.
 *
 * 등록서는 id 가 아니라 사람으로 찾는다. 접수를 취소하고 다시 내면 id 가 바뀌고, 예전에는
 * 같은 사람의 등록서가 여러 장 쌓이기도 했다. 담을 때 고른 등록서가 사라졌거나 단가가
 * 비어 있어도, 같은 계정(없으면 같은 인스타 계정)의 최신 등록서에서 단가를 읽는다.
 */

const INT_MAX = 2_147_483_647;
const toInt = (n: unknown) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(INT_MAX, Math.max(0, v)) : 0;
};

const UNIT: Record<string, number> = { 천억: 100_000_000_000, 억: 100_000_000, 천만: 10_000_000, 만: 10_000, 천: 1_000 };

/**
 * 단가 문구 하나("300,000원", "30만원", "1억 2천만원", "30만 5천원", "50~70만원")를 원 단위로 읽는다.
 * 첫 금액만 읽는다 — 숫자만 남기면 두 금액이 이어 붙어("300000500000") 정수 칸을 넘긴다.
 * 범위("50~70만원")는 앞 금액에 뒤 단위를 붙여 읽는다(예전에는 50원이 됐다).
 */
export function priceFromText(raw: unknown): number {
  let s = String(raw ?? "").replace(/[,\s]/g, "");
  s = s.replace(/(\d+(?:\.\d+)?)[~\-](\d+(?:\.\d+)?)(억|만|천)/, "$1$3");
  const start = s.search(/\d/);
  if (start < 0) return 0;
  const re = /(\d+(?:\.\d+)?)(천억|억|천만|만|천)?/y;
  re.lastIndex = start;
  let total = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (!m[2]) {
      total += Number(m[1]);
      break;
    }
    total += Number(m[1]) * UNIT[m[2]];
  }
  return toInt(total);
}

const REELS_LABEL = /숏폼|릴스|쇼츠|short|reel/i;
const FEED_LABEL = /게시물|피드|포스트|post|feed/i;

/**
 * 등록서 한 장의 피드 / 릴스 원가.
 * 게시물 단가 = 피드, 숏폼 단가 = 릴스. 둘 다 비어 있으면 예전 단일 단가 문구(ad_price)를
 * 읽는다 — "게시물 30만원 / 숏폼 50만원" 처럼 이름이 붙어 있으면 칸을 나눠 읽고, 이름이
 * 없으면 피드로 읽는다.
 */
export function ratesFromApplication(app: any): { feed: number; reels: number } {
  const feed = priceFromText(app?.post_price);
  const reels = priceFromText(app?.short_price);
  if (feed || reels) return { feed, reels };

  const legacy = String(app?.ad_price ?? "");
  if (!legacy.trim()) return { feed: 0, reels: 0 };
  let legacyFeed = 0;
  let legacyReels = 0;
  let labeled = false;
  for (const part of legacy.split(/[\/|\n]/)) {
    if (REELS_LABEL.test(part)) {
      labeled = true;
      legacyReels = legacyReels || priceFromText(part);
    } else if (FEED_LABEL.test(part)) {
      labeled = true;
      legacyFeed = legacyFeed || priceFromText(part);
    }
  }
  return labeled ? { feed: legacyFeed, reels: legacyReels } : { feed: priceFromText(legacy), reels: 0 };
}

/** 계정명 비교용. 비즈니스 계정 접두어(biz/)는 같은 사람으로 본다. */
export const normUsername = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

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

type LiveApp = {
  id: string;
  username: string;
  handle: string;
  channelHandle: string;
  createdAt: number;
  rates: { feed: number; reels: number };
  reels: SalesReel[];
};

/** 줄들이 가리키는 등록서와, 같은 계정·같은 인스타 계정의 다른 등록서를 모두 읽는다(최신순). */
async function loadApps(db: any, rows: Record<string, any>[]): Promise<LiveApp[]> {
  const ids = [...new Set(rows.map((r) => String(r.application_id || "")).filter(Boolean))];
  const usernames = [...new Set(rows.map((r) => normUsername(r.applicant_username)).filter(Boolean))];
  const handles = [...new Set(rows.map((r) => String(r.instagram_handle || "").toLowerCase()).filter(Boolean))];
  const result = await db.sql`
    WITH picked AS (
      SELECT LOWER(REGEXP_REPLACE(COALESCE(applicant_username, ''), '^biz/', '')) AS u
      FROM collab_directory_applications WHERE id = ANY(${ids}::text[])
    )
    SELECT a.id, a.applicant_username, a.instagram_url, a.ad_price, a.post_price, a.short_price, a.created_at,
      c.instagram_handle AS channel_handle, c.recent_reels
    FROM collab_directory_applications a
    LEFT JOIN creator_channels c ON LOWER(c.username) = LOWER(a.applicant_username)
    WHERE a.role = 'influencer' AND (
      a.id = ANY(${ids}::text[])
      OR LOWER(REGEXP_REPLACE(COALESCE(a.applicant_username, ''), '^biz/', '')) IN (
        SELECT u FROM picked WHERE u <> '' UNION SELECT UNNEST(${usernames}::text[])
      )
      OR LOWER(SUBSTRING(COALESCE(a.instagram_url, '') FROM 'instagram[.]com/([A-Za-z0-9._]+)')) = ANY(${handles}::text[])
      OR LOWER(COALESCE(c.instagram_handle, '')) = ANY(${handles}::text[])
    )
    ORDER BY a.created_at DESC
  `;
  return (result || []).map((row: any) => ({
    id: String(row.id),
    username: normUsername(row.applicant_username),
    handle: handleFromInput(row.instagram_url).toLowerCase(),
    channelHandle: String(row.channel_handle || "").toLowerCase(),
    createdAt: new Date(row.created_at || 0).getTime() || 0,
    rates: ratesFromApplication(row),
    reels: parseJsonArray(row.recent_reels)
      .filter((r: any) => cleanReelUrl(r?.permalink))
      .slice(0, 3)
      .map((r: any) => ({
        id: String(r?.id || ""),
        permalink: cleanReelUrl(r.permalink),
        thumbnailUrl: String(r?.thumbnailUrl || ""),
        views: toInt(r?.views),
      })),
  }));
}

/**
 * 줄 하나에 맞는 등록서. 같은 계정의 등록서 중 최신(단가가 적힌 것 우선)을 고르고,
 * 계정으로 못 찾으면 같은 인스타 계정의 등록서를 고른다. apps 는 최신순이다.
 */
function pickApp(row: Record<string, any>, apps: LiveApp[]): LiveApp | undefined {
  const own = apps.find((a) => a.id === String(row.application_id || ""));
  const username = normUsername(row.applicant_username) || own?.username || "";
  const handle = String(row.instagram_handle || "").toLowerCase();
  let candidates = username ? apps.filter((a) => a.username === username) : [];
  if (!candidates.length && own) candidates = [own];
  if (!candidates.length && handle) candidates = apps.filter((a) => a.handle === handle || a.channelHandle === handle);
  return candidates.find((a) => a.rates.feed || a.rates.reels) || candidates[0];
}

export type LiveFlags = {
  /** 최근 릴스를 채널 지표에서 가져왔다 */
  reels_live?: boolean;
  /** 피드 / 릴스 단가를 등록서에서 가져왔다(운영자가 손대지 않은 칸) */
  price_live?: boolean;
  reels_price_live?: boolean;
  /** 지금 등록서에 적힌 원가. 운영자 화면에서 고정된 금액과 비교해 보여 준다 */
  registered_price?: number;
  registered_reels_price?: number;
  /** 지금 연동된 등록서 id */
  live_application_id?: string;
};

/** 칸 하나의 원가·제안가. 운영자가 정한 칸은 그대로, 아니면 등록서 단가를 따른다. */
function livePrice(base: unknown, price: unknown, locked: unknown, registered: number) {
  if (locked || registered <= 0) return { base: toInt(base), price: toInt(price), live: false };
  const margin = Math.max(0, toInt(price) - toInt(base));
  return { base: registered, price: toInt(registered + margin), live: true };
}

/**
 * rows 중 source='registered' 인 줄의 recent_reels·단가를 지금 값으로 바꾼 사본을 돌려준다.
 * 조회에 실패하면 저장된 값을 그대로 돌려준다.
 */
export async function withLiveRegistered<T extends Record<string, any>>(
  db: any,
  rows: T[],
): Promise<(T & LiveFlags)[]> {
  const registered = rows.filter((r) => r.source === "registered");
  if (!registered.length) return rows;

  let apps: LiveApp[];
  try {
    apps = await loadApps(db, registered);
  } catch (err: any) {
    console.error("[sales-links] 매칭 등록자 지표 조회 실패:", err?.message);
    return rows;
  }

  return rows.map((r) => {
    if (r.source !== "registered") return r;
    const app = pickApp(r, apps);
    if (!app) return r;
    let out: any = { ...r, live_application_id: app.id };
    if (app.reels.length) {
      const priorViews = new Map(
        parseJsonArray(r.recent_reels).map((x: any) => [cleanReelUrl(x?.permalink), toInt(x?.views)]),
      );
      const reels = app.reels.map((x) => (x.views ? x : { ...x, views: priorViews.get(x.permalink) || 0 }));
      out = { ...out, recent_reels: reels, reels_live: true };
    }
    const feed = livePrice(r.base_price, r.price, r.price_locked, app.rates.feed);
    const reels = livePrice(r.reels_base_price, r.reels_price, r.reels_price_locked, app.rates.reels);
    return {
      ...out,
      base_price: feed.base,
      price: feed.price,
      price_live: feed.live,
      reels_base_price: reels.base,
      reels_price: reels.price,
      reels_price_live: reels.live,
      registered_price: app.rates.feed,
      registered_reels_price: app.rates.reels,
    };
  });
}
