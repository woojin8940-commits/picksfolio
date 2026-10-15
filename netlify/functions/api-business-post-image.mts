import { getDatabase } from "@picks/netlify-database";
import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { linkIsUsable, resolveSharedLink } from "./_shared/instagram-metrics.mts";
import { fetchMediaById, findMediaByPermalink, shortcodeOf, thumbOf } from "./_shared/post-metrics.mts";

/**
 * 협업 게시물의 실제 이미지 — 인플루언서가 업로드 단계에 적은 주소(upload_url)의 그 게시물.
 *
 * 부스팅 창의 미리보기는 이력 화면이 넘겨준 썸네일을 그렸다. 그런데 그 썸네일은
 * 채널에 받아 둔 최근 미디어에서 맞춘 것이라, 맞춰지지 않은 게시물은 캠페인 대표
 * 이미지로 대신 그려졌다 — 브랜드는 광고로 나갈 게시물과 다른 사진을 보고 집행했다.
 * 여기서는 업로드 주소 하나만 기준으로 그 게시물의 이미지를 찾는다.
 *
 *   1) 인플루언서 연동 토큰으로 그 게시물을 직접 조회한다(가장 정확하고 주소가 새것이다).
 *      한 번 찾은 media_id 가 collab_post_metrics 에 있으면 목록을 훑지 않는다.
 *   2) 연동이 없거나 못 찾으면 공개 게시물 페이지의 대표 이미지(og:image)를 읽는다.
 *
 * 인스타그램 이미지 주소는 시간이 지나면 만료되므로 저장하지 않고 열 때마다 받는다.
 *
 *   GET /api/business/post-image/:username?collabId=...
 */

const norm = (raw: unknown) => String(raw ?? "").trim().toLowerCase().replace(/^biz\//, "");

const decodeEntities = (raw: string) =>
  raw.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

/** 4초 안에 받은 HTML. 실패하면 빈 문자열 — 다음 방법으로 넘어간다. */
async function fetchHtml(url: string, userAgent: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent, "Accept-Language": "ko-KR,ko;q=0.9" },
      redirect: "follow",
      signal: controller.signal,
    });
    return res.ok ? await res.text() : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

const httpsOnly = (raw: string | undefined) => {
  const url = raw ? decodeEntities(raw) : "";
  return /^https:\/\//.test(url) ? url : "";
};

/**
 * 연동 없이 공개 게시물에서 이미지를 읽는다.
 *   1) 게시물 페이지의 og:image — 미리보기 크롤러로 요청해야 로그인 화면 대신 본문이 온다.
 *   2) 퍼가기(embed) 페이지의 본문 이미지 — 로그인 없이 열리는 화면이다.
 */
async function publicPostImage(code: string): Promise<string> {
  const page = await fetchHtml(
    `https://www.instagram.com/p/${encodeURIComponent(code)}/`,
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  );
  const og =
    page.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    page.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const fromPage = httpsOnly(og?.[1]);
  if (fromPage) return fromPage;

  const embed = await fetchHtml(
    `https://www.instagram.com/p/${encodeURIComponent(code)}/embed/captioned/`,
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  );
  const img =
    embed.match(/class=["'][^"']*EmbeddedMediaImage[^"']*["'][^>]*\ssrc=["']([^"']+)["']/i) ||
    embed.match(/<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*EmbeddedMediaImage/i);
  return httpsOnly(img?.[1]);
}

export default async (req: Request, context: Context) => {
  if (req.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const username = norm(context.params.username);
  if (!username) return Response.json({ error: "Missing username" }, { status: 400 });

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const collabId = String(new URL(req.url).searchParams.get("collabId") || "").trim();
  if (!collabId) return Response.json({ error: "collabId는 필수입니다." }, { status: 400 });

  const db = getDatabase();
  // 이 브랜드가 연 캠페인의 협업만 본다 — 다른 브랜드의 협업 게시물을 열 수 없게.
  const rows = (await db.sql`
    SELECT cc.upload_url, cc.creator_username, m.media_id
    FROM campaign_collabs cc
    JOIN campaigns c ON c.id = cc.campaign_id
    LEFT JOIN collab_post_metrics m ON m.collab_id = cc.id
    WHERE cc.id = ${collabId}
      AND LOWER(REPLACE(c.business_username, 'biz/', '')) = ${username}
    LIMIT 1
  `) as any[];

  const row = rows?.[0];
  if (!row) return Response.json({ error: "협업을 찾을 수 없습니다." }, { status: 404 });

  const uploadUrl = String(row.upload_url || "").trim();
  const code = shortcodeOf(uploadUrl);
  if (!code) return Response.json({ imageUrl: "", uploadUrl, source: "no_upload" });

  const headers = { "Cache-Control": "private, max-age=600" };

  const creator = norm(row.creator_username);
  if (creator) {
    const { link } = await resolveSharedLink(creator).catch(() => ({ link: null }));
    if (link && linkIsUsable(link)) {
      let found = row.media_id ? await fetchMediaById(link, String(row.media_id)) : null;
      // 굳혀 둔 media_id 가 다른 게시물이면 쓰지 않는다 — 주소가 기준이다.
      if (!found?.media || shortcodeOf(found.media.permalink) !== code) {
        found = await findMediaByPermalink(link, uploadUrl);
      }
      const image = found?.media ? thumbOf(found.media) : "";
      if (image) return Response.json({ imageUrl: image, uploadUrl, source: "meta_api" }, { headers });
    }
  }

  const image = await publicPostImage(code);
  if (image) return Response.json({ imageUrl: image, uploadUrl, source: "public_page" }, { headers });

  return Response.json({ imageUrl: "", uploadUrl, source: "not_found" });
};

export const config: Config = {
  path: "/api/business/post-image/:username",
};
