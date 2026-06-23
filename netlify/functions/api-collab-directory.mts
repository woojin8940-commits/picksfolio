import { getDatabase } from "@netlify/database";
import { requireAdmin } from "./_shared/admin-auth.mts";
import type { Config } from "@netlify/functions";

// "1.2M", "12.3K", "1,234", "1234 followers" 같은 표기를 정수로 변환.
function parseFollowerText(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  const m = cleaned.match(/([\d.]+)\s*([KkMm만천억]?)/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  if (unit === "k" || unit === "천") n *= 1_000;
  else if (unit === "m") n *= 1_000_000;
  else if (unit === "만") n *= 10_000;
  else if (unit === "억") n *= 100_000_000;
  return Math.round(n);
}

// 인스타/틱톡 공개 페이지에서 팔로워 수를 best-effort 로 추출한다.
// 플랫폼이 차단하거나 형식이 바뀌면 null 을 반환하고, 호출측은 수기 입력값으로 대체한다.
async function crawlFollowers(url: string): Promise<number | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // og:description / meta description: "1.2M Followers, 300 Following, ..."
    const metaMatch =
      html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/"description"\s*:\s*"([^"]+)"/i);
    if (metaMatch) {
      const desc = metaMatch[1];
      const f = desc.match(/([\d.,]+\s*[KkMm]?)\s*Followers/i);
      if (f) {
        const n = parseFollowerText(f[1]);
        if (n && n > 0) return n;
      }
    }

    // TikTok: JSON 안의 followerCount
    const tk = html.match(/"followerCount"\s*:\s*(\d+)/);
    if (tk) {
      const n = parseInt(tk[1], 10);
      if (n > 0) return n;
    }
    // Instagram: edge_followed_by count
    const ig = html.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
    if (ig) {
      const n = parseInt(ig[1], 10);
      if (n > 0) return n;
    }
    return null;
  } catch {
    return null;
  }
}

function genId(): string {
  return `cda_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  // ── 지원서 제출(공개) ──────────────────────────────────────────────
  if (req.method === "POST") {
    try {
      const b = await req.json();
      const role = b.role === "brand" ? "brand" : "influencer";
      const name = (b.name || "").toString().trim();
      const contact = (b.contact || "").toString().trim();

      if (!name) {
        return Response.json({ error: "이름을 입력해 주세요." }, { status: 400 });
      }

      const id = genId();

      if (role === "influencer") {
        const instagram_url = (b.instagram_url || "").toString().trim();
        const tiktok_url = (b.tiktok_url || "").toString().trim();
        const youtube_url = (b.youtube_url || "").toString().trim();
        const naver_blog_url = (b.naver_blog_url || "").toString().trim();

        // 채널별 수기 입력 팔로워 수
        const instagram_followers = Math.max(0, parseInt(b.instagram_followers, 10) || 0);
        const youtube_followers = Math.max(0, parseInt(b.youtube_followers, 10) || 0);
        const tiktok_followers = Math.max(0, parseInt(b.tiktok_followers, 10) || 0);
        // 구간 분류/정렬용 대표 팔로워 수는 채널별 입력값 중 최대값을 사용한다.
        const manualFollowers = Math.max(instagram_followers, youtube_followers, tiktok_followers);

        // 콘텐츠 유형별 단가
        const post_price = (b.post_price || "").toString().trim();
        const short_price = (b.short_price || "").toString().trim();
        // 관리자 화면 호환을 위해 단일 ad_price 텍스트를 파생 표기로 채운다.
        const ad_price = [
          post_price && `게시물 ${post_price}`,
          short_price && `숏폼 ${short_price}`,
        ].filter(Boolean).join(" / ") || (b.ad_price || "").toString().trim();

        // 인스타 → 틱톡 순으로 크롤링 시도, 실패하면 수기 입력값(채널 최대) 사용
        let crawled: number | null = null;
        if (instagram_url) crawled = await crawlFollowers(instagram_url);
        if (crawled == null && tiktok_url) crawled = await crawlFollowers(tiktok_url);

        const follower_count = crawled != null ? crawled : manualFollowers;
        const follower_source = crawled != null ? "crawled" : "manual";

        await db.sql`
          INSERT INTO collab_directory_applications
            (id, role, applicant_username, name, contact,
             instagram_url, youtube_url, tiktok_url, naver_blog_url,
             instagram_followers, youtube_followers, tiktok_followers,
             ad_price, post_price, short_price, category,
             follower_count, follower_source, note)
          VALUES
            (${id}, 'influencer', ${(b.applicant_username || "").toString()}, ${name}, ${contact},
             ${instagram_url}, ${youtube_url}, ${tiktok_url}, ${naver_blog_url},
             ${instagram_followers}, ${youtube_followers}, ${tiktok_followers},
             ${ad_price}, ${post_price}, ${short_price}, ${(b.category || "").toString()},
             ${follower_count}, ${follower_source}, ${(b.note || "").toString()})
        `;
        return Response.json({ success: true, id, follower_count, follower_source });
      }

      // brand
      const budget = Math.max(0, parseInt(String(b.budget).replace(/[^\d]/g, ""), 10) || 0);
      await db.sql`
        INSERT INTO collab_directory_applications
          (id, role, applicant_username, name, contact,
           brand_homepage, brand_instagram, desired_count, desired_followers,
           budget, budget_text, desired_schedule, desired_category, note)
        VALUES
          (${id}, 'brand', ${(b.applicant_username || "").toString()}, ${name}, ${contact},
           ${(b.brand_homepage || "").toString()}, ${(b.brand_instagram || "").toString()},
           ${(b.desired_count || "").toString()}, ${(b.desired_followers || "").toString()},
           ${budget}, ${(b.budget_text || "").toString()},
           ${(b.desired_schedule || "").toString()}, ${(b.desired_category || "").toString()},
           ${(b.note || "").toString()})
      `;
      return Response.json({ success: true, id });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  // ── 운영자 대시보드 조회/수정(관리자 전용) ─────────────────────────
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  if (req.method === "GET") {
    try {
      const role = url.searchParams.get("role"); // 'influencer' | 'brand' | null
      const sort = url.searchParams.get("sort") || "recent"; // recent|budget|schedule|followers

      let rows: any[];
      if (role === "brand") {
        if (sort === "budget") {
          rows = await db.sql`SELECT * FROM collab_directory_applications WHERE role='brand' ORDER BY budget DESC, created_at DESC`;
        } else if (sort === "schedule") {
          rows = await db.sql`SELECT * FROM collab_directory_applications WHERE role='brand' ORDER BY NULLIF(desired_schedule,'') ASC NULLS LAST, created_at DESC`;
        } else {
          rows = await db.sql`SELECT * FROM collab_directory_applications WHERE role='brand' ORDER BY created_at DESC`;
        }
      } else if (role === "influencer") {
        if (sort === "followers") {
          rows = await db.sql`SELECT * FROM collab_directory_applications WHERE role='influencer' ORDER BY follower_count DESC, created_at DESC`;
        } else {
          rows = await db.sql`SELECT * FROM collab_directory_applications WHERE role='influencer' ORDER BY created_at DESC`;
        }
      } else {
        rows = await db.sql`SELECT * FROM collab_directory_applications ORDER BY created_at DESC`;
      }
      return Response.json({ applications: rows });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  if (req.method === "PATCH") {
    try {
      const b = await req.json();
      const { id, status, follower_count } = b;
      if (!id) return Response.json({ error: "id가 필요합니다." }, { status: 400 });

      if (typeof follower_count !== "undefined") {
        const fc = Math.max(0, parseInt(follower_count, 10) || 0);
        await db.sql`UPDATE collab_directory_applications SET follower_count=${fc}, follower_source='manual', updated_at=now() WHERE id=${id}`;
      }
      if (typeof status === "string" && status) {
        await db.sql`UPDATE collab_directory_applications SET status=${status}, updated_at=now() WHERE id=${id}`;
      }
      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  if (req.method === "DELETE") {
    try {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "id가 필요합니다." }, { status: 400 });
      await db.sql`DELETE FROM collab_directory_applications WHERE id=${id}`;
      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/collab-directory",
};
