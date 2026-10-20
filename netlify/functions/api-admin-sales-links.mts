import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { randomBytes } from "node:crypto";
import { requireAdmin } from "./_shared/admin-auth.mts";
import {
  cleanReelUrl,
  fetchPublicProfile,
  fetchReelThumbnail,
  handleFromInput,
  type SalesReel,
} from "./_shared/sales-link-profile.mts";
import { withLiveRegisteredReels } from "./_shared/sales-link-live.mts";

/**
 * 브랜드 영업용 링크 — 운영자 관리 API.
 *
 * 링크 하나에 인플루언서 명단 하나. 명단의 각 줄은 담는 순간의 프로필을 굳혀 두는
 * 사본이라, 브랜드 매칭 등록서나 채널 지표를 고치지 않는다(이 화면에서 숫자를 바꿔도
 * 다른 명단에는 영향이 없다).
 */

const genId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const genToken = () => randomBytes(9).toString("base64url");

/** Postgres INTEGER 상한. 넘기면 INSERT 가 통째로 실패한다. */
const INT_MAX = 2_147_483_647;
const clampInt = (n: number) => Math.min(INT_MAX, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
const int = (raw: unknown) => clampInt(Number(String(raw ?? "").replace(/[^\d.]/g, "")) || 0);

/**
 * 등록서의 단가 문구("게시물 30만원 / 숏폼 50만원", "300,000원")에서 첫 금액을 원 단위로 읽는다.
 * 숫자만 남기면 두 금액이 이어 붙어("300000500000") 정수 칸을 넘기고, 만원 단위도 틀린다.
 */
function priceFromText(raw: unknown): number {
  const m = String(raw ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(만|천)?/);
  if (!m) return 0;
  const unit = m[2] === "만" ? 10000 : m[2] === "천" ? 1000 : 1;
  return clampInt(Number(m[1]) * unit);
}
const text = (raw: unknown, max = 500) => String(raw ?? "").trim().slice(0, max);

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

function shapeItem(row: any) {
  return {
    ...row,
    followers: Number(row.followers || 0),
    following: Number(row.following || 0),
    base_price: Number(row.base_price || 0),
    price: Number(row.price || 0),
    reels_base_price: Number(row.reels_base_price || 0),
    reels_price: Number(row.reels_price || 0),
    sort_order: Number(row.sort_order || 0),
    recent_reels: parseJsonArray(row.recent_reels).slice(0, 3),
  };
}

/** 브랜드 매칭 등록자 한 명의 지금 프로필. 연동 지표가 없으면 공개 프로필로 채운다. */
async function snapshotRegistered(db: any, applicationId: string, opts: { skipPublic?: boolean } = {}) {
  const rows = await db.sql`
    SELECT a.id, a.name, a.instagram_url, a.category, a.ad_price, a.post_price, a.short_price, a.follower_count,
      c.connected, c.instagram_handle, c.followers, c.following, c.recent_reels, c.profile_image
    FROM collab_directory_applications a
    LEFT JOIN creator_channels c ON LOWER(c.username) = LOWER(a.applicant_username)
    WHERE a.id = ${applicationId} AND a.role = 'influencer'
    LIMIT 1
  `;
  const row = rows?.[0];
  if (!row) return null;

  const handle =
    (row.connected ? handleFromInput(row.instagram_handle) : "") || handleFromInput(row.instagram_url);
  const reels: SalesReel[] = parseJsonArray(row.recent_reels)
    .slice(0, 3)
    .map((r: any) => ({
      id: String(r?.id || ""),
      permalink: String(r?.permalink || ""),
      thumbnailUrl: String(r?.thumbnailUrl || ""),
      views: clampInt(Number(r?.views || 0)),
    }));
  let snap = {
    handle,
    displayName: String(row.name || ""),
    category: String(row.category || ""),
    followers: clampInt(Number(row.followers || row.follower_count || 0)),
    following: clampInt(Number(row.following || 0)),
    profileImageUrl: String(row.profile_image || ""),
    reels,
    // 게시물 단가 = 피드, 숏폼 단가 = 릴스. 둘 다 비어 있으면 예전 단일 단가 문구를 피드로 읽는다.
    basePrice: row.post_price
      ? priceFromText(row.post_price)
      : row.short_price ? 0 : priceFromText(row.ad_price),
    reelsBasePrice: priceFromText(row.short_price),
    error: "",
  };

  // 연동 지표가 비어 있으면 공개 프로필에서 채운다.
  if (handle && !opts.skipPublic && (!snap.reels.length || !snap.following || !snap.followers)) {
    const pub = await fetchPublicProfile(handle);
    if ("profile" in pub) {
      snap = {
        ...snap,
        handle: pub.profile.handle,
        followers: snap.followers || pub.profile.followers,
        following: snap.following || pub.profile.following,
        profileImageUrl: snap.profileImageUrl || pub.profile.profileImageUrl,
        reels: snap.reels.length ? snap.reels : pub.profile.reels,
      };
    } else if (!snap.reels.length) {
      snap.error = pub.error;
    }
  }
  return snap;
}

async function nextSortOrder(db: any, linkId: string) {
  const r = await db.sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM sales_link_influencers WHERE link_id = ${linkId}`;
  return Number(r?.[0]?.n || 1);
}

/**
 * 손으로 고친 릴스 목록. 새로 들어온 주소만 표지를 받아 온다.
 * 항목은 주소 문자열이나 { permalink, views }. views 를 안 보내면 기존 조회수를 지킨다.
 */
async function normalizeReels(raw: unknown, prior: any[], handle: string): Promise<SalesReel[]> {
  const priorByLink = new Map(prior.map((r: any) => [cleanReelUrl(r?.permalink), r]));
  const list = (Array.isArray(raw) ? raw : []).slice(0, 3);
  const out: SalesReel[] = [];
  for (const entry of list) {
    const permalink = cleanReelUrl(typeof entry === "string" ? entry : entry?.permalink);
    if (!permalink) continue;
    const old = priorByLink.get(permalink);
    const sentViews = typeof entry === "object" && entry?.views !== undefined && entry?.views !== "";
    const views = sentViews ? int(entry.views) : clampInt(Number(old?.views || 0));
    if (old?.thumbnailUrl) {
      out.push({ id: String(old.id || permalink), permalink, thumbnailUrl: String(old.thumbnailUrl), views });
      continue;
    }
    out.push({ id: permalink, permalink, thumbnailUrl: await fetchReelThumbnail(permalink, handle), views });
  }
  return out;
}

/** 새로 불러온 릴스에 조회수가 없으면, 같은 릴스에 손으로 넣어 둔 조회수를 이어 쓴다. */
function keepManualViews(fresh: SalesReel[], prior: any[]): SalesReel[] {
  const priorViews = new Map(prior.map((r: any) => [cleanReelUrl(r?.permalink), clampInt(Number(r?.views || 0))]));
  return fresh.map((r) => (r.views ? r : { ...r, views: priorViews.get(cleanReelUrl(r.permalink)) || 0 }));
}

async function listLinks(db: any) {
  const links = await db.sql`SELECT * FROM sales_links ORDER BY created_at DESC`;
  const rows = await db.sql`SELECT * FROM sales_link_influencers ORDER BY sort_order ASC, created_at ASC`;
  const items = await withLiveRegisteredReels(db, rows);
  const byLink = new Map<string, any[]>();
  for (const it of items) {
    const list = byLink.get(it.link_id) || [];
    list.push(shapeItem(it));
    byLink.set(it.link_id, list);
  }
  return links.map((l: any) => ({ ...l, items: byLink.get(l.id) || [] }));
}

export default async (req: Request) => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const db = getDatabase();

  if (req.method === "GET") {
    try {
      return Response.json({ links: await listLinks(db) });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  let b: any;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  try {
    switch (b?.action) {
      case "create_link": {
        const id = genId("sl");
        const [link] = await db.sql`
          INSERT INTO sales_links (id, token, title, brand_name, intro)
          VALUES (${id}, ${genToken()}, ${text(b.title, 120) || "인플루언서 제안"}, ${text(b.brand_name, 120)}, ${text(b.intro, 2000)})
          RETURNING *
        `;
        return Response.json({ link: { ...link, items: [] } });
      }

      case "update_link": {
        if (!b.id) return Response.json({ error: "id가 필요합니다." }, { status: 400 });
        await db.sql`
          UPDATE sales_links SET
            title = ${text(b.title, 120) || "인플루언서 제안"},
            brand_name = ${text(b.brand_name, 120)},
            intro = ${text(b.intro, 2000)},
            is_active = ${b.is_active !== false},
            updated_at = NOW()
          WHERE id = ${b.id}
        `;
        return Response.json({ success: true });
      }

      case "delete_link": {
        if (!b.id) return Response.json({ error: "id가 필요합니다." }, { status: 400 });
        await db.sql`DELETE FROM sales_links WHERE id = ${b.id}`;
        return Response.json({ success: true });
      }

      case "add_external": {
        const handle = handleFromInput(b.profile_url);
        if (!b.link_id) return Response.json({ error: "링크를 먼저 선택해 주세요." }, { status: 400 });
        if (!handle) return Response.json({ error: "인스타그램 프로필 링크를 확인해 주세요." }, { status: 400 });
        const dup = await db.sql`
          SELECT id FROM sales_link_influencers
          WHERE link_id = ${b.link_id} AND LOWER(instagram_handle) = ${handle.toLowerCase()} LIMIT 1
        `;
        if (dup.length) return Response.json({ error: `@${handle} 은(는) 이미 이 링크에 있습니다.` }, { status: 409 });

        const pub = await fetchPublicProfile(handle);
        const p = "profile" in pub ? pub.profile : null;
        const realHandle = p?.handle || handle;
        const basePrice = int(b.base_price);
        const reelsBase = int(b.reels_base_price);
        const [row] = await db.sql`
          INSERT INTO sales_link_influencers (
            id, link_id, sort_order, source, instagram_handle, profile_url, display_name, profile_image_url,
            category, followers, following, recent_reels, base_price, price, reels_base_price, reels_price, price_note, fetch_error, synced_at
          ) VALUES (
            ${genId("sli")}, ${b.link_id}, ${await nextSortOrder(db, b.link_id)}, 'external', ${realHandle},
            ${`https://www.instagram.com/${realHandle}/`}, ${p?.fullName || ""}, ${p?.profileImageUrl || ""},
            ${text(b.category, 120)}, ${p?.followers || 0}, ${p?.following || 0}, ${JSON.stringify(p?.reels || [])}::jsonb,
            ${basePrice}, ${b.price !== undefined && b.price !== "" ? int(b.price) : basePrice},
            ${reelsBase}, ${b.reels_price !== undefined && b.reels_price !== "" ? int(b.reels_price) : reelsBase},
            ${text(b.price_note, 200)},
            ${"error" in pub ? pub.error : ""}, ${p ? new Date().toISOString() : null}
          )
          RETURNING *
        `;
        return Response.json({ item: shapeItem(row), warning: "error" in pub ? pub.error : "" });
      }

      case "add_registered": {
        if (!b.link_id) return Response.json({ error: "링크를 먼저 선택해 주세요." }, { status: 400 });
        const ids: string[] = (Array.isArray(b.application_ids) ? b.application_ids : []).map(String).slice(0, 50);
        const existing = await db.sql`SELECT application_id, LOWER(instagram_handle) AS h FROM sales_link_influencers WHERE link_id = ${b.link_id}`;
        const haveApp = new Set(existing.map((r: any) => r.application_id).filter(Boolean));
        const haveHandle = new Set(existing.map((r: any) => r.h).filter(Boolean));
        let added = 0;
        const skipped: string[] = [];
        const failed: string[] = [];
        // 인스타가 한 번 막으면 같은 묶음의 나머지도 막힌다. 그 뒤로는 묻지 않고 연동 지표만 담는다.
        let throttled = false;
        for (const appId of ids) {
          if (haveApp.has(appId)) continue;
          try {
            const snap = await snapshotRegistered(db, appId, { skipPublic: throttled });
            if (!snap) continue;
            if (snap.error.includes("HTTP 429")) throttled = true;
            if (snap.handle && haveHandle.has(snap.handle.toLowerCase())) {
              skipped.push(snap.handle);
              continue;
            }
            await db.sql`
              INSERT INTO sales_link_influencers (
                id, link_id, sort_order, source, application_id, instagram_handle, profile_url, display_name,
                profile_image_url, category, followers, following, recent_reels, base_price, price,
                reels_base_price, reels_price, fetch_error, synced_at
              ) VALUES (
                ${genId("sli")}, ${b.link_id}, ${await nextSortOrder(db, b.link_id)}, 'registered', ${appId}, ${snap.handle},
                ${snap.handle ? `https://www.instagram.com/${snap.handle}/` : ""}, ${snap.displayName}, ${snap.profileImageUrl},
                ${snap.category}, ${snap.followers}, ${snap.following}, ${JSON.stringify(snap.reels)}::jsonb,
                ${snap.basePrice}, ${snap.basePrice},
                ${snap.reelsBasePrice}, ${snap.reelsBasePrice}, ${snap.error}, ${new Date().toISOString()}
              )
            `;
            haveApp.add(appId);
            if (snap.handle) haveHandle.add(snap.handle.toLowerCase());
            added += 1;
          } catch (err: any) {
            // 한 명이 실패해도 나머지는 담는다.
            console.error("[sales-links] add_registered 실패:", appId, err?.message);
            failed.push(appId);
          }
        }
        return Response.json({ added, skipped, failed: failed.length });
      }

      case "update_item": {
        if (!b.id) return Response.json({ error: "id가 필요합니다." }, { status: 400 });
        const [cur] = await db.sql`SELECT * FROM sales_link_influencers WHERE id = ${b.id}`;
        if (!cur) return Response.json({ error: "항목을 찾을 수 없습니다." }, { status: 404 });
        const reels = b.recent_reels !== undefined
          ? await normalizeReels(b.recent_reels, parseJsonArray(cur.recent_reels), cur.instagram_handle)
          : parseJsonArray(cur.recent_reels);
        const [row] = await db.sql`
          UPDATE sales_link_influencers SET
            display_name = ${b.display_name !== undefined ? text(b.display_name, 120) : cur.display_name},
            category = ${b.category !== undefined ? text(b.category, 120) : cur.category},
            followers = ${b.followers !== undefined ? int(b.followers) : cur.followers},
            following = ${b.following !== undefined ? int(b.following) : cur.following},
            recent_reels = ${JSON.stringify(reels)}::jsonb,
            base_price = ${b.base_price !== undefined ? int(b.base_price) : cur.base_price},
            price = ${b.price !== undefined ? int(b.price) : cur.price},
            reels_base_price = ${b.reels_base_price !== undefined ? int(b.reels_base_price) : cur.reels_base_price},
            reels_price = ${b.reels_price !== undefined ? int(b.reels_price) : cur.reels_price},
            price_note = ${b.price_note !== undefined ? text(b.price_note, 200) : cur.price_note},
            memo = ${b.memo !== undefined ? text(b.memo, 2000) : cur.memo},
            updated_at = NOW()
          WHERE id = ${b.id}
          RETURNING *
        `;
        return Response.json({ item: shapeItem(row) });
      }

      case "refresh_item": {
        if (!b.id) return Response.json({ error: "id가 필요합니다." }, { status: 400 });
        const [cur] = await db.sql`SELECT * FROM sales_link_influencers WHERE id = ${b.id}`;
        if (!cur) return Response.json({ error: "항목을 찾을 수 없습니다." }, { status: 404 });

        let followers = 0, following = 0, reels: SalesReel[] = [], image = "", name = "", handle = cur.instagram_handle;
        let error = "";
        if (cur.source === "registered" && cur.application_id) {
          const snap = await snapshotRegistered(db, cur.application_id);
          if (snap) {
            ({ followers, following, reels, profileImageUrl: image, displayName: name } = snap);
            handle = snap.handle || handle;
            error = snap.error;
          }
        } else if (handle) {
          const pub = await fetchPublicProfile(handle);
          if ("profile" in pub) {
            ({ followers, following, reels, profileImageUrl: image, fullName: name } = pub.profile);
            handle = pub.profile.handle;
          } else {
            error = pub.error;
          }
        }
        if (error && !followers) {
          await db.sql`UPDATE sales_link_influencers SET fetch_error = ${error}, updated_at = NOW() WHERE id = ${b.id}`;
          return Response.json({ error }, { status: 502 });
        }
        // 새로 받은 값이 비어 있는 칸은 기존 값(손으로 넣은 값 포함)을 지킨다.
        const [row] = await db.sql`
          UPDATE sales_link_influencers SET
            instagram_handle = ${handle},
            profile_url = ${handle ? `https://www.instagram.com/${handle}/` : cur.profile_url},
            display_name = ${cur.display_name || name},
            profile_image_url = ${image || cur.profile_image_url},
            followers = ${followers || cur.followers},
            following = ${following || cur.following},
            recent_reels = ${JSON.stringify(
              reels.length ? keepManualViews(reels, parseJsonArray(cur.recent_reels)) : parseJsonArray(cur.recent_reels),
            )}::jsonb,
            fetch_error = '',
            synced_at = NOW(),
            updated_at = NOW()
          WHERE id = ${b.id}
          RETURNING *
        `;
        return Response.json({ item: shapeItem(row) });
      }

      case "move_item": {
        if (!b.id) return Response.json({ error: "id가 필요합니다." }, { status: 400 });
        const [cur] = await db.sql`SELECT id, link_id, sort_order FROM sales_link_influencers WHERE id = ${b.id}`;
        if (!cur) return Response.json({ error: "항목을 찾을 수 없습니다." }, { status: 404 });
        const list = await db.sql`SELECT id FROM sales_link_influencers WHERE link_id = ${cur.link_id} ORDER BY sort_order ASC, created_at ASC`;
        const ids = list.map((r: any) => r.id);
        const at = ids.indexOf(cur.id);
        const to = b.direction === "up" ? at - 1 : at + 1;
        if (at < 0 || to < 0 || to >= ids.length) return Response.json({ success: true });
        [ids[at], ids[to]] = [ids[to], ids[at]];
        for (let i = 0; i < ids.length; i++) {
          await db.sql`UPDATE sales_link_influencers SET sort_order = ${i + 1} WHERE id = ${ids[i]}`;
        }
        return Response.json({ success: true });
      }

      case "delete_item": {
        if (!b.id) return Response.json({ error: "id가 필요합니다." }, { status: 400 });
        await db.sql`DELETE FROM sales_link_influencers WHERE id = ${b.id}`;
        return Response.json({ success: true });
      }

      default:
        return Response.json({ error: "알 수 없는 요청입니다." }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[sales-links]", b?.action, err?.message);
    return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/admin/sales-links",
};
