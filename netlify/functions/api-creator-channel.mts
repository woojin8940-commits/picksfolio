import { getDatabase } from "@picks/netlify-database";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { requireManager } from "./_shared/manager-auth.mts";
import { norm } from "./_shared/collab-workflow.mts";
import { shapeChannel } from "./_shared/campaign-listup.mts";

/**
 * 인플루언서 채널 등록 — 리스트업에서 브랜드가 보는 숫자의 출처.
 *
 * 브랜드가 명단에서 사람을 고를 때 보는 것은 팔로워 수가 아니라 최근 릴스와 평균
 * 조회수다. 그 숫자를 어디서 가져오는지가 이 파일의 전부다.
 *
 *   PUT                       본인 입력 (metrics_source='self')
 *   POST {action:'sync'}      메타 API 로 갱신 (metrics_source='meta_api')
 *
 * 두 경로를 한 컬럼에 섞지 않는다. 자기 입력 숫자와 검증된 숫자가 구분되지 않으면
 * 브랜드는 명단의 어느 숫자도 믿지 않게 되고, 결국 다시 사람에게 물어본다.
 *
 * 메타 연동은 아직 앱 심사 범위에 따라 조회수(insights)를 못 받는 경우가 있다.
 * 그래서 sync 는 "받을 수 있는 것만 받고, 못 받은 항목은 자기 입력값을 남긴다".
 * 심사가 끝나 권한이 늘어나면 이 함수만 고치면 되고 화면과 리스트업은 그대로다.
 */

/** 평균을 낼 때 볼 최근 릴스 개수. 오래된 영상까지 섞으면 지금 실력이 흐려진다. */
const SAMPLE_SIZE = 12;
/** 화면에 보여줄 최근 릴스 개수. */
const SHOW_SIZE = 6;

const handleFromUrl = (raw: string) => {
  const m = String(raw || "").match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return m ? m[1] : "";
};

const intOf = (raw: unknown) => {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  const n = digits ? Number(digits) : Number(raw ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

const avg = (nums: number[]) => {
  const valid = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
};

async function loadChannel(db: any, username: string) {
  const rows = await db.sql`SELECT * FROM creator_channels WHERE username = ${username}`;
  return (rows as any[])?.[0] || null;
}

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  // -------------------------------------------------------------------------
  // GET — 본인 또는 담당자
  // -------------------------------------------------------------------------
  if (req.method === "GET") {
    try {
      const username = norm(url.searchParams.get("username") || "");
      if (!username) {
        return Response.json({ error: "사용자명이 필요합니다." }, { status: 400 });
      }
      const manager = await requireManager(req);
      if (!manager.ok) {
        const auth = await requireAccountOwner(req, username);
        if (!auth.ok) return auth.response;
      }

      const row = await loadChannel(db, username);
      // 메타 계정이 이미 연동돼 있으면(디엠 자동화에서 연결한 계정) sync 버튼을
      // 켤 수 있다는 뜻이다. 토큰 자체는 절대 내려보내지 않는다.
      let metaLinked = false;
      try {
        const store = getStore("dm-automation");
        const settings = (await store.get(`dm_${username}`, { type: "json" })) as any;
        metaLinked = !!(settings?.accessToken && (settings?.igUserId || settings?.igAccountId));
      } catch {
        metaLinked = false;
      }

      return Response.json({
        registered: !!row,
        channel: shapeChannel(row),
        metaLinked,
      });
    } catch (err: any) {
      return Response.json({ error: err?.message || "채널 정보를 불러오지 못했습니다." }, { status: 500 });
    }
  }

  // -------------------------------------------------------------------------
  // PUT — 본인이 직접 등록
  // -------------------------------------------------------------------------
  if (req.method === "PUT") {
    try {
      const body = (await req.json()) as any;
      const username = norm(body.username || "");
      if (!username) {
        return Response.json({ error: "사용자명이 필요합니다." }, { status: 400 });
      }
      const auth = await requireAccountOwner(req, username);
      if (!auth.ok) return auth.response;

      const instagramUrl = String(body.instagramUrl || "").trim();
      const handle =
        String(body.instagramHandle || "").trim().replace(/^@/, "") || handleFromUrl(instagramUrl);
      if (!handle) {
        return Response.json(
          { error: "인스타그램 계정(@아이디 또는 프로필 링크)을 입력해 주세요." },
          { status: 400 },
        );
      }

      const normalizedUrl = instagramUrl || `https://www.instagram.com/${handle}/`;
      const reels = Array.isArray(body.recentReels)
        ? body.recentReels
            .slice(0, SHOW_SIZE)
            .map((r: any) => ({
              id: String(r?.id || r?.permalink || ""),
              permalink: String(r?.permalink || ""),
              thumbnailUrl: String(r?.thumbnailUrl || ""),
              caption: String(r?.caption || "").slice(0, 200),
              views: intOf(r?.views),
              likes: intOf(r?.likes),
              timestamp: String(r?.timestamp || ""),
              source: "self",
            }))
            .filter((r: any) => r.permalink || r.views)
        : [];

      const existing = await loadChannel(db, username);
      // 메타에서 받아 온 지표가 이미 있으면 자기 입력으로 덮어쓰지 않는다.
      // 자기 입력은 "아직 연동 전"을 메우는 값이고, 검증된 숫자를 밀어내면 안 된다.
      const keepMeta = existing?.metrics_source === "meta_api";
      const metricsSource = keepMeta ? "meta_api" : "self";
      const followers = keepMeta ? Number(existing.followers || 0) : intOf(body.followers);
      const avgViews = keepMeta ? Number(existing.avg_views || 0) : intOf(body.avgViews);
      const avgLikes = keepMeta ? Number(existing.avg_likes || 0) : intOf(body.avgLikes);
      const avgComments = keepMeta ? Number(existing.avg_comments || 0) : intOf(body.avgComments);
      const reelsCount = keepMeta ? Number(existing.reels_count || 0) : intOf(body.reelsCount);
      const recentReels = keepMeta ? existing.recent_reels || [] : reels;

      await db.sql`
        INSERT INTO creator_channels (
          username, instagram_handle, instagram_url, followers, avg_views, avg_likes,
          avg_comments, reels_count, metrics_source, recent_reels, intro, categories
        ) VALUES (
          ${username}, ${handle}, ${normalizedUrl}, ${followers}, ${avgViews}, ${avgLikes},
          ${avgComments}, ${reelsCount}, ${metricsSource}, ${JSON.stringify(recentReels)},
          ${String(body.intro || "")}, ${String(body.categories || "")}
        )
        ON CONFLICT (username) DO UPDATE SET
          instagram_handle = EXCLUDED.instagram_handle,
          instagram_url = EXCLUDED.instagram_url,
          followers = EXCLUDED.followers,
          avg_views = EXCLUDED.avg_views,
          avg_likes = EXCLUDED.avg_likes,
          avg_comments = EXCLUDED.avg_comments,
          reels_count = EXCLUDED.reels_count,
          metrics_source = EXCLUDED.metrics_source,
          recent_reels = EXCLUDED.recent_reels,
          intro = EXCLUDED.intro,
          categories = EXCLUDED.categories,
          updated_at = NOW()
      `;

      const row = await loadChannel(db, username);
      return Response.json({ success: true, channel: shapeChannel(row) });
    } catch (err: any) {
      return Response.json({ error: err?.message || "채널 정보를 저장하지 못했습니다." }, { status: 500 });
    }
  }

  // -------------------------------------------------------------------------
  // POST {action:'sync'} — 메타 API 로 갱신
  // -------------------------------------------------------------------------
  if (req.method === "POST") {
    try {
      const body = (await req.json()) as any;
      const username = norm(body.username || "");
      const action = String(body.action || "sync");
      if (!username) {
        return Response.json({ error: "사용자명이 필요합니다." }, { status: 400 });
      }
      if (action !== "sync") {
        return Response.json({ error: "알 수 없는 동작입니다." }, { status: 400 });
      }

      const manager = await requireManager(req);
      if (!manager.ok) {
        const auth = await requireAccountOwner(req, username);
        if (!auth.ok) return auth.response;
      }

      const store = getStore("dm-automation");
      const settings = (await store.get(`dm_${username}`, { type: "json" })) as any;
      const igId = settings?.igUserId || settings?.igAccountId;
      if (!settings?.accessToken || !igId) {
        return Response.json(
          {
            error:
              "인스타그램 계정이 연동되어 있지 않습니다. 계정을 연동하면 최근 릴스와 조회수를 자동으로 불러옵니다.",
            code: "META_NOT_LINKED",
          },
          { status: 409 },
        );
      }

      const graphHost =
        settings.tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com";

      // 조회수 필드는 앱 권한에 따라 거부될 수 있다. 거부되면 그 필드만 빼고 한 번
      // 더 부른다 — 조회수를 못 받는다고 릴스 목록까지 포기할 이유는 없다.
      const withViews =
        "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp," +
        "like_count,comments_count,view_count";
      const withoutViews =
        "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp," +
        "like_count,comments_count";

      const fetchMedia = async (fields: string) => {
        const endpoint =
          `https://${graphHost}/me/media?fields=${encodeURIComponent(fields)}` +
          `&limit=${SAMPLE_SIZE * 2}&access_token=${encodeURIComponent(settings.accessToken)}`;
        const res = await fetch(endpoint);
        const data = (await res.json().catch(() => ({}))) as any;
        return { ok: res.ok, status: res.status, data };
      };

      let viewsAvailable = true;
      let result = await fetchMedia(withViews);
      if (!result.ok) {
        viewsAvailable = false;
        result = await fetchMedia(withoutViews);
      }
      if (!result.ok) {
        const msg = result.data?.error?.message || `메타 API 오류 (HTTP ${result.status})`;
        return Response.json({ error: msg, code: "META_ERROR" }, { status: 502 });
      }

      const items: any[] = Array.isArray(result.data?.data) ? result.data.data : [];
      // 릴스만 본다. 사진 게시물의 조회수는 없고, 있다 해도 릴스 성과와 섞으면
      // 평균이 무슨 숫자인지 알 수 없어진다.
      const reels = items
        .filter(
          (m) =>
            String(m?.media_product_type || "").toUpperCase() === "REELS" ||
            String(m?.media_type || "").toUpperCase() === "VIDEO",
        )
        .slice(0, SAMPLE_SIZE);

      const views = reels.map((m) => intOf(m?.view_count));
      const likes = reels.map((m) => intOf(m?.like_count));
      const comments = reels.map((m) => intOf(m?.comments_count));

      const existing = await loadChannel(db, username);
      const avgViews = avg(views) || Number(existing?.avg_views || 0);
      const avgLikes = avg(likes) || Number(existing?.avg_likes || 0);
      const avgComments = avg(comments) || Number(existing?.avg_comments || 0);

      // 팔로워 수는 별도 필드(followers_count)를 요구한다. 실패하면 기존 값을 둔다.
      let followers = Number(existing?.followers || 0);
      try {
        const profileRes = await fetch(
          `https://${graphHost}/me?fields=username,followers_count&access_token=${encodeURIComponent(settings.accessToken)}`,
        );
        const profile = (await profileRes.json().catch(() => ({}))) as any;
        if (profileRes.ok && profile?.followers_count) {
          followers = intOf(profile.followers_count);
        }
      } catch (e) {
        console.warn("[creator-channel] 팔로워 수 조회 실패:", (e as Error)?.message);
      }

      const recentReels = reels.slice(0, SHOW_SIZE).map((m) => ({
        id: String(m?.id || ""),
        permalink: String(m?.permalink || ""),
        thumbnailUrl: String(m?.thumbnail_url || m?.media_url || ""),
        caption: String(m?.caption || "").slice(0, 200),
        views: intOf(m?.view_count),
        likes: intOf(m?.like_count),
        comments: intOf(m?.comments_count),
        timestamp: String(m?.timestamp || ""),
        source: "meta_api",
      }));

      const handle =
        String(existing?.instagram_handle || "") ||
        String(settings?.igUsername || settings?.username || "");
      const igUrl =
        String(existing?.instagram_url || "") ||
        (handle ? `https://www.instagram.com/${handle}/` : "");

      await db.sql`
        INSERT INTO creator_channels (
          username, instagram_handle, instagram_url, connected, followers, avg_views,
          avg_likes, avg_comments, reels_count, metrics_source, recent_reels, synced_at,
          intro, categories
        ) VALUES (
          ${username}, ${handle}, ${igUrl}, TRUE, ${followers}, ${avgViews},
          ${avgLikes}, ${avgComments}, ${reels.length}, 'meta_api',
          ${JSON.stringify(recentReels)}, NOW(),
          ${String(existing?.intro || "")}, ${String(existing?.categories || "")}
        )
        ON CONFLICT (username) DO UPDATE SET
          instagram_handle = COALESCE(NULLIF(EXCLUDED.instagram_handle, ''), creator_channels.instagram_handle),
          instagram_url = COALESCE(NULLIF(EXCLUDED.instagram_url, ''), creator_channels.instagram_url),
          connected = TRUE,
          followers = EXCLUDED.followers,
          avg_views = EXCLUDED.avg_views,
          avg_likes = EXCLUDED.avg_likes,
          avg_comments = EXCLUDED.avg_comments,
          reels_count = EXCLUDED.reels_count,
          metrics_source = 'meta_api',
          recent_reels = EXCLUDED.recent_reels,
          synced_at = NOW(),
          updated_at = NOW()
      `;

      const row = await loadChannel(db, username);
      return Response.json({
        success: true,
        channel: shapeChannel(row),
        // 조회수를 못 받았으면 화면이 "연동은 됐지만 조회수는 비공개"를 말할 수 있어야 한다.
        viewsAvailable,
        sampled: reels.length,
      });
    } catch (err: any) {
      return Response.json({ error: err?.message || "갱신에 실패했습니다." }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/creator-channel",
};
