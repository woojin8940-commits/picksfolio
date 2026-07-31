import { getDatabase } from "@picks/netlify-database";
import { requireAdmin } from "./_shared/admin-auth.mts";
import { callerIsAnyOf, requireSignedInUser } from "./_shared/user-auth.mts";
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

/**
 * 지원자가 이미 메타 계정을 연동해 뒀는지 확인한다.
 *
 * 연동을 마친 계정은 creator_channels 에 metrics_source='meta_api' 로 기록돼 있다.
 * 등록서에 손으로 적은 팔로워 수보다 이 값이 우선이다. 연동만 해 두고 아직 지표를
 * 못 받은 경우(권한 거부 등)도 있으므로 행이 있으면 그대로 돌려주고, 판단은 호출부에서 한다.
 *
 * 이 등록서 접수는 로그인 없이도 열려 있다. 그래서 `applicant_username` 을 그대로
 * 믿고 조회하면 아무나 남의 아이디를 적어 넣어 그 사람의 검증된 팔로워 수를 응답으로
 * 받아낼 수 있다(연동 여부까지 함께 새어 나간다). 그러므로 **본인 확인을 통과한
 * 요청에서만** 연동 지표를 붙인다. 확인이 안 되면 조회 자체를 하지 않고 수기 입력값을
 * 쓴다 — 접수를 막지는 않는다.
 */
async function loadLinkedChannel(db: any, req: Request, applicantUsername: string) {
  const username = applicantUsername.trim().toLowerCase();
  if (!username) return null;

  const caller = await requireSignedInUser(req);
  if (!caller.ok) return null;
  if (!callerIsAnyOf(caller, [username])) return null;

  try {
    const rows = await db.sql`
      SELECT instagram_handle, instagram_url, followers, following, avg_views, metrics_source
      FROM creator_channels
      WHERE LOWER(username) = ${username} AND connected = TRUE
    `;
    return (rows as any[])?.[0] || null;
  } catch {
    return null;
  }
}

function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function shapeInfluencerApplication(row: any) {
  const recentReels = parseJsonArray(row.instagram_recent_reels).slice(0, 6);
  const recentAverage = average(recentReels.slice(0, 3).map((reel) => Number(reel?.views || 0)));
  const previousAverage = average(recentReels.slice(3, 6).map((reel) => Number(reel?.views || 0)));
  const trendPercent = previousAverage > 0
    ? Math.round(((recentAverage - previousAverage) / previousAverage) * 100)
    : null;

  return {
    ...row,
    follower_count: Number(row.instagram_meta_followers || row.follower_count || 0),
    follower_source: row.instagram_metrics_source === "meta_api" ? "meta_api" : row.follower_source,
    instagram_followers: Number(row.instagram_meta_followers || row.instagram_followers || 0),
    instagram_following: Number(row.instagram_following || 0),
    instagram_avg_views: Number(row.instagram_avg_views || 0),
    instagram_avg_likes: Number(row.instagram_avg_likes || 0),
    instagram_avg_comments: Number(row.instagram_avg_comments || 0),
    instagram_connected: !!row.instagram_connected,
    instagram_recent_reels: recentReels.slice(0, 3),
    instagram_reel_trend_percent: trendPercent,
    instagram_recent_average_views: recentAverage,
    instagram_previous_average_views: previousAverage,
  };
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
      // 연락처가 없으면 접수는 되지만 매칭을 진행할 방법이 없다. 운영자가 나중에
      // 사람을 찾아다니는 일을 만들지 않으려면 접수 시점에 받아 두는 편이 낫다.
      if (!contact) {
        return Response.json(
          { error: "연락처를 입력해 주세요. 매칭 결과를 안내할 방법이 필요합니다." },
          { status: 400 },
        );
      }

      const id = genId();

      if (role === "influencer") {
        const applicantUsername = (b.applicant_username || "").toString();
        // 메타 연동을 마친 계정이면 인스타 정보는 검증된 값(creator_channels)을 쓴다.
        // 자기 입력값과 섞으면 브랜드가 명단의 어느 숫자도 믿지 않게 된다.
        const linked = applicantUsername
          ? await loadLinkedChannel(db, req, applicantUsername)
          : null;

        const instagram_url =
          (b.instagram_url || "").toString().trim() ||
          (linked?.instagram_url ? String(linked.instagram_url) : "") ||
          (linked?.instagram_handle ? `https://www.instagram.com/${linked.instagram_handle}/` : "");
        const tiktok_url = (b.tiktok_url || "").toString().trim();
        const youtube_url = (b.youtube_url || "").toString().trim();
        const naver_blog_url = (b.naver_blog_url || "").toString().trim();

        // 연동한 사람은 인스타 링크를 손으로 적을 필요가 없다(위에서 채워진다).
        if (!instagram_url) {
          return Response.json(
            { error: "인스타그램 계정을 연동하거나 프로필 링크를 입력해 주세요." },
            { status: 400 },
          );
        }

        // 채널별 수기 입력 팔로워 수. 인스타는 연동값이 있으면 그것을 우선한다.
        const metaFollowers = linked ? Math.max(0, Number(linked.followers || 0)) : 0;
        const instagram_followers =
          metaFollowers || Math.max(0, parseInt(b.instagram_followers, 10) || 0);
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

        // 인스타그램 지표는 공개 HTML 크롤링 값이 아니라 Meta 연동 데이터만 검증값으로
        // 사용한다. 연동을 마쳤으면 그 숫자를 대표값으로 굳히고, 연동 전에는 수기값을
        // 저장한 뒤 운영자 명단에서 Meta 동기화한다.
        // 틱톡은 기존 분류 호환을 위해 공개 페이지 확인을 best-effort 로 유지한다.
        const crawled = tiktok_url ? await crawlFollowers(tiktok_url) : null;

        let follower_count = manualFollowers;
        let follower_source = "manual";
        if (metaFollowers > 0) {
          // 연동 계정의 팔로워가 다른 채널보다 적어도 검증된 값이라는 사실이 더 중요하다.
          follower_count = Math.max(metaFollowers, youtube_followers, tiktok_followers);
          follower_source = "meta_api";
        } else if (crawled != null) {
          follower_count = crawled;
          follower_source = "crawled";
        }

        await db.sql`
          INSERT INTO collab_directory_applications
            (id, role, applicant_username, name, contact,
             instagram_url, youtube_url, tiktok_url, naver_blog_url,
             instagram_followers, youtube_followers, tiktok_followers,
             ad_price, post_price, short_price, category,
             follower_count, follower_source, note)
          VALUES
            (${id}, 'influencer', ${applicantUsername}, ${name}, ${contact},
             ${instagram_url}, ${youtube_url}, ${tiktok_url}, ${naver_blog_url},
             ${instagram_followers}, ${youtube_followers}, ${tiktok_followers},
             ${ad_price}, ${post_price}, ${short_price}, ${(b.category || "").toString()},
             ${follower_count}, ${follower_source}, ${(b.note || "").toString()})
        `;
        return Response.json({
          success: true,
          id,
          follower_count,
          follower_source,
          // 화면이 "검증된 숫자로 접수됐다"를 말할 수 있게 연동 여부를 함께 알려준다.
          instagram_connected: !!linked,
        });
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
          rows = await db.sql`
            SELECT a.*,
              c.connected AS instagram_connected,
              c.followers AS instagram_meta_followers,
              c.following AS instagram_following,
              c.avg_views AS instagram_avg_views,
              c.avg_likes AS instagram_avg_likes,
              c.avg_comments AS instagram_avg_comments,
              c.metrics_source AS instagram_metrics_source,
              c.recent_reels AS instagram_recent_reels,
              c.synced_at AS instagram_synced_at
            FROM collab_directory_applications a
            LEFT JOIN creator_channels c ON LOWER(c.username) = LOWER(a.applicant_username)
            WHERE a.role='influencer'
            ORDER BY COALESCE(c.followers, a.follower_count) DESC, a.created_at DESC
          `;
        } else {
          rows = await db.sql`
            SELECT a.*,
              c.connected AS instagram_connected,
              c.followers AS instagram_meta_followers,
              c.following AS instagram_following,
              c.avg_views AS instagram_avg_views,
              c.avg_likes AS instagram_avg_likes,
              c.avg_comments AS instagram_avg_comments,
              c.metrics_source AS instagram_metrics_source,
              c.recent_reels AS instagram_recent_reels,
              c.synced_at AS instagram_synced_at
            FROM collab_directory_applications a
            LEFT JOIN creator_channels c ON LOWER(c.username) = LOWER(a.applicant_username)
            WHERE a.role='influencer'
            ORDER BY a.created_at DESC
          `;
        }
      } else {
        rows = await db.sql`SELECT * FROM collab_directory_applications ORDER BY created_at DESC`;
      }
      return Response.json({
        applications: role === "influencer" ? rows.map(shapeInfluencerApplication) : rows,
      });
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
