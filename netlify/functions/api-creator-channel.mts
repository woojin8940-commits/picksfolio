import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { requireManager } from "./_shared/manager-auth.mts";
import { norm } from "./_shared/collab-workflow.mts";
import { shapeChannel } from "./_shared/campaign-listup.mts";
import {
  SHOW_SIZE,
  REAUTH_MESSAGE,
  intOf,
  linkIsUsable,
  linkNeedsReauth,
  loadMetaLink,
  syncChannelFromMeta,
} from "./_shared/instagram-metrics.mts";

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
 *
 * 그래프 API 호출과 저장 규칙 자체는 _shared/instagram-metrics.mts 에 있다.
 * 계정 연동 직후(instagram-oauth-callback)에도 같은 규칙으로 지표를 채우기 때문이다.
 */

const handleFromUrl = (raw: string) => {
  const m = String(raw || "").match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  return m ? m[1] : "";
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
      // 메타 계정이 이미 연동돼 있으면(브랜드 매칭 등록·디엠 자동화에서 연결한 계정)
      // sync 버튼을 켤 수 있다는 뜻이다. 토큰 자체는 절대 내려보내지 않는다.
      const link = await loadMetaLink(username);
      const metaLinked = linkIsUsable(link);
      // 토큰이 죽은 연동은 "연동 안 됨"이 아니라 "다시 동의해야 함"이다. 둘을 같은
      // 값으로 내리면 화면은 이미 받아 둔 팔로워 수를 지운 빈 카드를 보여 주게 된다.
      const needsReauth = linkNeedsReauth(link);

      return Response.json({
        registered: !!row,
        channel: shapeChannel(row),
        metaLinked,
        needsReauth,
        // 연동한 인스타 계정을 화면에서 확인할 수 있게 아이디만 함께 내린다.
        // 재연동이 필요한 상태에서도 어느 계정이었는지는 알려 준다.
        igUsername: metaLinked || needsReauth ? String(link?.igUsername || "") : "",
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

      const link = await loadMetaLink(username);
      if (!linkIsUsable(link)) {
        // 한 번도 연동한 적 없는 경우와, 연동했는데 토큰이 죽은 경우는 할 말이 다르다.
        // 전자는 "연동해 주세요", 후자는 "다시 연동해 주세요"다. 화면이 그 둘을
        // 구분해 안내할 수 있도록 코드를 나눠 내린다.
        return Response.json(
          linkNeedsReauth(link)
            ? { error: REAUTH_MESSAGE, code: "META_TOKEN_INVALID" }
            : {
                error:
                  "인스타그램 계정이 연동되어 있지 않습니다. 계정을 연동하면 최근 릴스와 조회수를 자동으로 불러옵니다.",
                code: "META_NOT_LINKED",
              },
          { status: 409 },
        );
      }

      const synced = await syncChannelFromMeta(db, username, link!);
      if (!synced.ok) {
        return Response.json({ error: synced.error, code: synced.code }, { status: synced.status });
      }

      return Response.json({
        success: true,
        channel: shapeChannel(synced.row),
        // 조회수를 못 받았으면 화면이 "연동은 됐지만 조회수는 비공개"를 말할 수 있어야 한다.
        viewsAvailable: synced.viewsAvailable,
        sampled: synced.sampled,
      });
    } catch (err: any) {
      // 여기까지 온 오류는 데이터베이스·본문 파싱 쪽이다. 원문은 영문이라 화면에
      // 그대로 올리면 읽는 사람이 할 수 있는 일이 없다. 로그로만 남긴다.
      console.error("[creator-channel] sync 실패:", err?.message || err);
      return Response.json(
        { error: "정보를 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "SYNC_FAILED" },
        { status: 500 },
      );
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/creator-channel",
};
