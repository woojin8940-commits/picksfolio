import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

/**
 * 연동된 인스타그램 계정의 피드 게시물 목록 조회.
 * - 사용자별 DM 자동화 설정(dm-automation 블롭)에서 액세스 토큰을 읽어
 *   Instagram Graph API 로 최근 게시물(media)을 가져온다.
 * - 자동 DM 을 걸 게시물을 고르기 위한 용도이므로 이미지/캡션/링크만 내려준다.
 * - "Instagram API with Instagram Login" 방식이라 graph.instagram.com 을 사용한다.
 */

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

export default async (_req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("dm-automation");
  const settings = (await store.get(`dm_${username}`, { type: "json" })) as DmSettings | null;
  const igId = settings?.igUserId || settings?.igAccountId;

  if (!settings || !igId || !settings.accessToken) {
    return Response.json({ connected: false, media: [] }, { status: 200 });
  }

  const graphHost =
    settings.tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com";

  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";
  const url =
    `https://${graphHost}/me/media?fields=${encodeURIComponent(fields)}` +
    `&limit=30&access_token=${encodeURIComponent(settings.accessToken)}`;

  try {
    const res = await fetch(url);
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const errMsg = data?.error?.message || `Graph API 오류 (HTTP ${res.status})`;
      console.error("[ig-media] fetch failed:", errMsg);
      return Response.json({ connected: true, media: [], error: errMsg }, { status: 200 });
    }

    const media: MediaItem[] = (Array.isArray(data?.data) ? data.data : []).map((m: any) => ({
      id: String(m?.id || ""),
      caption: String(m?.caption || ""),
      mediaType: String(m?.media_type || ""),
      // 동영상은 media_url 이 재생용이므로 썸네일을 우선 노출한다.
      mediaUrl: String(m?.thumbnail_url || m?.media_url || ""),
      thumbnailUrl: String(m?.thumbnail_url || ""),
      permalink: String(m?.permalink || ""),
      timestamp: String(m?.timestamp || ""),
    }));

    return Response.json({ connected: true, media }, { status: 200 });
  } catch (e: any) {
    console.error("[ig-media] error:", e);
    return Response.json({ connected: true, media: [], error: e?.message || "unknown" }, { status: 200 });
  }
};

export const config: Config = {
  path: "/api/instagram/media/:username",
};
