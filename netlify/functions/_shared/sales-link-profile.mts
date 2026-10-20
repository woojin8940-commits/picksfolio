import { getStore } from "@netlify/blobs";
import { fetchAllowed } from "./allowed-fetch.mts";
import { safeKeyPrefix } from "./upload-media.mts";

/**
 * 영업용 링크에 넣을 인스타 계정의 공개 프로필.
 *
 * 브랜드 매칭 받기에 등록하지 않은 계정은 메타 연동 토큰이 없다. 그래서 인스타
 * 웹이 프로필 화면을 그릴 때 쓰는 공개 정보(팔로워·팔로잉·최근 게시물)를 읽는다.
 * 공식 API 가 아니라 막히거나 형식이 바뀔 수 있으므로, 실패하면 이유를 돌려주고
 * 운영자가 숫자·릴스 링크를 손으로 채울 수 있게 한다(호출부 몫).
 *
 * 인스타 이미지 주소에는 만료 시각이 박혀 있어 며칠 뒤 깨진다. 프로필 사진과 릴스
 * 표지는 우리 저장소에 복사해 두고 그 주소를 쓴다.
 */

export interface SalesReel {
  id: string;
  permalink: string;
  thumbnailUrl: string;
  /** 조회수. 0 = 모름(공개 프로필이 안 주거나 운영자가 아직 안 넣음). */
  views: number;
}

export interface PublicProfile {
  handle: string;
  fullName: string;
  followers: number;
  following: number;
  profileImageUrl: string;
  reels: SalesReel[];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";
/** 인스타 웹 앱이 쓰는 공개 앱 아이디. 비밀 값이 아니다. */
const IG_WEB_APP_ID = "936619743392459";

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MEDIA_PREFIX = "sales-link-media";

const hostIn = (url: URL, domains: string[]) => {
  const name = url.hostname.toLowerCase();
  return url.protocol === "https:" && domains.some((d) => name === d || name.endsWith(`.${d}`));
};

/** 프로필 주소·@아이디·아이디 무엇을 넣어도 아이디만 뽑는다. */
export function handleFromInput(raw: unknown): string {
  const text = String(raw || "").trim();
  const fromUrl = text.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const handle = (fromUrl ? fromUrl[1] : text).replace(/^@+/, "").trim();
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return "";
  // 프로필이 아닌 주소(/p/…, /reel/…)를 넣은 경우
  if (["p", "reel", "reels", "stories", "explore", "tv"].includes(handle.toLowerCase())) return "";
  return handle;
}

/** 릴스·게시물 주소만 받는다. 브랜드가 누르는 링크라 다른 사이트로 보내지 않는다. */
export function cleanReelUrl(raw: unknown): string {
  const text = String(raw || "").trim();
  const m = text.match(/instagram\.com\/(?:[A-Za-z0-9._]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  if (!m) return "";
  const kind = m[1].toLowerCase() === "p" ? "p" : "reel";
  return `https://www.instagram.com/${kind}/${m[2]}/`;
}

async function mirrorImage(source: string, key: string): Promise<string> {
  if (!source) return "";
  try {
    const res = await fetchAllowed(
      source,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) },
      (u) => hostIn(u, ["cdninstagram.com", "fbcdn.net"]),
    );
    if (!res.ok) return "";
    const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = IMAGE_TYPES[type];
    if (!ext) return "";
    const buffer = await res.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > IMAGE_MAX_BYTES) return "";
    const fullKey = `${MEDIA_PREFIX}/${key}.${ext}`;
    await getStore("images").set(fullKey, buffer, { metadata: { contentType: type } });
    return `/api/images/${fullKey}`;
  } catch (e) {
    console.warn("[sales-link] 이미지 저장 실패:", (e as Error)?.message);
    return "";
  }
}

/** 공개 프로필을 읽는다. 실패하면 { error } 로 이유를 돌려준다. */
export async function fetchPublicProfile(
  handle: string,
): Promise<{ profile: PublicProfile } | { error: string }> {
  // 같은 공개 정보를 두 주소가 준다. 인스타는 요청 주소별로 따로 막기(429) 때문에,
  // 한쪽이 막히면 다른 쪽을 물어본다.
  const q = `users/web_profile_info/?username=${encodeURIComponent(handle)}`;
  const attempts: Array<{ url: string; headers: Record<string, string> }> = [
    {
      url: `https://i.instagram.com/api/v1/${q}`,
      headers: { "User-Agent": UA, "x-ig-app-id": IG_WEB_APP_ID, Accept: "application/json" },
    },
    {
      url: `https://www.instagram.com/api/v1/${q}`,
      headers: {
        "User-Agent": UA,
        "x-ig-app-id": IG_WEB_APP_ID,
        "X-Requested-With": "XMLHttpRequest",
        Referer: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
        Accept: "application/json",
      },
    },
  ];
  let user: any;
  let lastStatus = 0;
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, { headers: attempt.headers, signal: AbortSignal.timeout(7000) });
      if (res.status === 404) return { error: "존재하지 않는 계정입니다." };
      if (!res.ok) {
        lastStatus = res.status;
        continue;
      }
      const data = (await res.json().catch(() => null)) as any;
      user = data?.data?.user;
      // 200 인데 user 가 없으면 비공개·없는 계정이다. 다른 주소도 같은 답을 준다.
      lastStatus = 200;
      break;
    } catch {
      // 시간 초과·연결 실패 — 다음 주소로
    }
  }
  if (lastStatus && lastStatus !== 200) {
    return { error: `인스타그램이 응답하지 않았습니다(HTTP ${lastStatus}). 잠시 뒤 '인스타에서 새로고침'을 누르거나 숫자를 직접 입력해 주세요.` };
  }
  if (!lastStatus) return { error: "인스타그램에서 정보를 불러오지 못했습니다. 숫자를 직접 입력해 주세요." };
  if (!user) return { error: "존재하지 않거나 비공개 계정입니다." };

  const realHandle = String(user.username || handle);
  const keyBase = safeKeyPrefix(realHandle);
  const edges: any[] = [
    ...(user.edge_felix_video_timeline?.edges || []),
    ...(user.edge_owner_to_timeline_media?.edges || []),
  ];
  // 최근 릴스 3편. 고정 게시물이 맨 앞에 오므로 올린 시각으로 다시 줄 세운다.
  const seen = new Set<string>();
  const reelNodes = edges
    .map((e) => e?.node)
    .filter((n) => n && n.shortcode && (n.product_type === "clips" || n.is_video))
    .filter((n) => (seen.has(n.shortcode) ? false : (seen.add(n.shortcode), true)))
    .sort((a, b) => Number(b.taken_at_timestamp || 0) - Number(a.taken_at_timestamp || 0))
    .slice(0, 3);

  const [profileImageUrl, ...thumbs] = await Promise.all([
    mirrorImage(String(user.profile_pic_url_hd || user.profile_pic_url || ""), `${keyBase}/profile-${Date.now().toString(36)}`),
    ...reelNodes.map((n) =>
      mirrorImage(String(n.thumbnail_src || n.display_url || ""), `${keyBase}/${safeKeyPrefix(n.shortcode)}`),
    ),
  ]);

  return {
    profile: {
      handle: realHandle,
      fullName: String(user.full_name || ""),
      followers: Math.min(2_147_483_647, Number(user.edge_followed_by?.count || 0)),
      following: Math.min(2_147_483_647, Number(user.edge_follow?.count || 0)),
      profileImageUrl,
      reels: reelNodes.map((n, i) => ({
        id: String(n.shortcode),
        permalink: `https://www.instagram.com/reel/${n.shortcode}/`,
        thumbnailUrl: thumbs[i] || "",
        views: Math.min(2_147_483_647, Number(n.video_view_count || n.video_play_count || n.play_count || 0)),
      })),
    },
  };
}

/**
 * 손으로 넣은 릴스 주소의 표지. 게시물 공개 페이지의 og:image 를 읽어 복사한다.
 * 못 읽으면 빈 값 — 화면은 표지 없이 링크만 보여 준다.
 */
export async function fetchReelThumbnail(permalink: string, handle: string): Promise<string> {
  const code = permalink.match(/\/(?:reel|p)\/([A-Za-z0-9_-]+)/)?.[1];
  if (!code) return "";
  try {
    const res = await fetchAllowed(
      permalink,
      { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(6000) },
      (u) => hostIn(u, ["instagram.com"]),
    );
    if (!res.ok) return "";
    const html = await res.text();
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (!m) return "";
    const src = m[1].replace(/&amp;/g, "&");
    return await mirrorImage(src, `${safeKeyPrefix(handle || "manual")}/${safeKeyPrefix(code)}`);
  } catch {
    return "";
  }
}
