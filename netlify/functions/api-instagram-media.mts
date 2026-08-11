import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";

/**
 * 연동된 인스타그램 계정의 피드 게시물 목록 조회.
 * - 사용자별 DM 자동화 설정(dm-automation 블롭)에서 액세스 토큰을 읽어
 *   Instagram Graph API 로 게시물(media)을 가져온다.
 * - 자동 DM 을 걸 게시물을 고르기 위한 용도이므로 이미지/캡션/링크만 내려준다.
 * - "Instagram API with Instagram Login" 방식이라 graph.instagram.com 을 사용한다.
 *
 * 예전에는 `limit=30` 한 번만 불러서, 게시물이 30개를 넘는 계정은 그보다 오래된
 * 글에 자동화를 걸 수가 없었다. 지금은 `paging.next` 커서를 따라가며 아래 상한까지
 * 모은다. 상한을 둔 이유는 게시물이 수천 개인 계정에서 함수 실행 시간이 터지는 걸
 * 막기 위해서다. 상한에 걸리면 `hasMore: true` 로 알려준다.
 */

/** 한 번에 요청할 게시물 수 (Graph API 권장 상한). */
const PAGE_SIZE = 50;
/** 최대 페이지 수 — 함수 타임아웃 방지용. */
const MAX_PAGES = 8;
/** 최대 게시물 수. */
const MAX_ITEMS = 400;

interface DmSettings {
  connected?: boolean;
  igUserId?: string;
  igAccountId?: string;
  accessToken?: string;
  tokenSource?: string;
}

interface MediaItem {
  id: string;
  caption: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl: string;
  permalink: string;
  timestamp: string;
}

const toMediaItem = (m: any): MediaItem => ({
  id: String(m?.id || ""),
  caption: String(m?.caption || ""),
  mediaType: String(m?.media_type || ""),
  // 동영상은 media_url 이 재생용이므로 썸네일을 우선 노출한다.
  mediaUrl: String(m?.thumbnail_url || m?.media_url || ""),
  thumbnailUrl: String(m?.thumbnail_url || ""),
  permalink: String(m?.permalink || ""),
  timestamp: String(m?.timestamp || ""),
});

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 남의 계정 피드를 들여다볼 수 없게 본인 확인을 먼저 한다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const store = getStore({ name: "dm-automation", consistency: "strong" });
  const settings = (await store.get(`dm_${username}`, { type: "json" })) as DmSettings | null;
  const igId = settings?.igUserId || settings?.igAccountId;

  if (!settings || !igId || !settings.accessToken) {
    return Response.json({ connected: false, media: [] }, { status: 200 });
  }

  const graphHost =
    settings.tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com";

  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
  let next: string | null =
    `https://${graphHost}/me/media?fields=${encodeURIComponent(fields)}` +
    `&limit=${PAGE_SIZE}&access_token=${encodeURIComponent(settings.accessToken)}`;

  const media: MediaItem[] = [];

  try {
    for (let page = 0; page < MAX_PAGES && next && media.length < MAX_ITEMS; page++) {
      const res: Response = await fetch(next);
      const data = (await res.json().catch(() => ({}))) as any;

      if (!res.ok) {
        const errMsg = data?.error?.message || `Graph API 오류 (HTTP ${res.status})`;
        console.error("[ig-media] fetch failed:", errMsg);
        // 첫 페이지부터 실패하면 오류, 도중에 실패하면 모은 만큼이라도 돌려준다.
        if (media.length === 0) {
          return Response.json({ connected: true, media: [], error: errMsg }, { status: 200 });
        }
        break;
      }

      const items = Array.isArray(data?.data) ? data.data : [];
      for (const m of items) {
        if (media.length >= MAX_ITEMS) break;
        media.push(toMediaItem(m));
      }

      // 커서에는 토큰이 이미 포함돼 있다.
      next = items.length > 0 ? (data?.paging?.next as string) || null : null;
    }

    return Response.json({ connected: true, media, hasMore: Boolean(next) }, { status: 200 });
  } catch (e: any) {
    console.error("[ig-media] error:", e);
    return Response.json(
      { connected: true, media, error: e?.message || "unknown" },
      { status: 200 },
    );
  }
};

export const config: Config = {
  path: "/api/instagram/media/:username",
};
