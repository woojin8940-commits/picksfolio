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

/** 계정 이름 비교용 정규화. 비즈니스 계정의 'biz/' 접두사를 떼고 소문자로 맞춘다. */
const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

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

/**
 * 카테고리 문자열을 개별 태그로 쪼갠다.
 *
 * 등록 경로마다 구분자가 다르다("뷰티·패션", "뷰티, 패션", "뷰티/패션"). 한 곳에서
 * 통일하지 않으면 운영자 화면의 카테고리 목록에 같은 분야가 여러 번 나온다.
 * 담당자 명부(api-manager-influencers)와 같은 규칙을 쓴다 — 두 화면이 같은
 * 카테고리를 다르게 쪼개면 어느 쪽 숫자가 맞는지 알 수 없다.
 */
function splitCategories(raw: unknown): string[] {
  const tags = String(raw || "")
    .split(/[·,/|]|\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.length <= 20);
  return Array.from(new Set(tags));
}

/**
 * 인플루언서 등록서의 파생 값(대표 팔로워 수·단가 표기)을 한 번에 계산한다.
 *
 * 접수(POST)와 본인 수정(PATCH)이 같은 규칙을 써야 한다. 두 곳에서 따로 계산하면
 * 단가를 고친 순간 표기 형식이 접수 때와 달라지고("게시물 30만원 / 숏폼 50만원" vs
 * "30만원"), 운영자 명단에서 같은 사람이 다른 규칙으로 보이게 된다.
 */
function deriveInfluencerFields(input: {
  postPrice: string;
  shortPrice: string;
  adPriceFallback?: string;
  instagramFollowers: number;
  youtubeFollowers: number;
  tiktokFollowers: number;
  metaFollowers: number;
  crawledFollowers: number | null;
}) {
  const ad_price =
    [
      input.postPrice && `게시물 ${input.postPrice}`,
      input.shortPrice && `숏폼 ${input.shortPrice}`,
    ]
      .filter(Boolean)
      .join(" / ") || (input.adPriceFallback || "").trim();

  const manualFollowers = Math.max(
    input.instagramFollowers,
    input.youtubeFollowers,
    input.tiktokFollowers,
  );

  let follower_count = manualFollowers;
  let follower_source = "manual";
  if (input.metaFollowers > 0) {
    // 연동 계정의 팔로워가 다른 채널보다 적어도 검증된 값이라는 사실이 더 중요하다.
    follower_count = Math.max(input.metaFollowers, input.youtubeFollowers, input.tiktokFollowers);
    follower_source = "meta_api";
  } else if (input.crawledFollowers != null) {
    follower_count = input.crawledFollowers;
    follower_source = "crawled";
  }

  return { ad_price, follower_count, follower_source };
}

/**
 * 고른 카테고리를 채널 정보(creator_channels)에도 옮긴다.
 *
 * 등록서는 접수된 서류라 담당자 명부에서만 읽는다. 반면 캠페인 리스트업 카드와
 * 카테고리 필터는 creator_channels 를 본다 — 옮겨 두지 않으면 본인이 고른 분야가
 * 정작 브랜드에게 추천될 때는 빈칸으로 남는다. 실패해도 접수/수정을 되돌리지 않는다.
 */
async function mirrorCategories(db: any, applicantUsername: string, categories: string) {
  const chosen = String(categories || "").trim();
  const channelKey = String(applicantUsername || "").trim().toLowerCase();
  if (!chosen || !channelKey) return;
  try {
    await db.sql`
      INSERT INTO creator_channels (username, categories)
      VALUES (${channelKey}, ${chosen})
      ON CONFLICT (username) DO UPDATE
        SET categories = EXCLUDED.categories, updated_at = NOW()
    `;
  } catch (chErr) {
    console.error("[collab-directory] 채널 카테고리 반영 실패:", chErr);
  }
}

/**
 * 본인에게 돌려줄 등록서 내용.
 *
 * 수정 화면이 값을 되살리려면 접수한 내용을 그대로 받아야 한다. 본인 확인을 통과한
 * 요청에만 실어 보내며, 운영자 메모나 다른 지원자 정보는 담지 않는다.
 */
function shapeOwnApplication(row: any) {
  if (!row) return null;
  const base = {
    id: row.id,
    role: row.role,
    status: row.status || "pending",
    name: row.name || "",
    contact: row.contact || "",
    note: row.note || "",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
  if (row.role === "brand") {
    return {
      ...base,
      brand_homepage: row.brand_homepage || "",
      brand_instagram: row.brand_instagram || "",
      desired_count: row.desired_count || "",
      desired_followers: row.desired_followers || "",
      budget_text: row.budget_text || "",
      desired_schedule: row.desired_schedule || "",
      desired_category: row.desired_category || "",
    };
  }
  return {
    ...base,
    instagram_url: row.instagram_url || "",
    youtube_url: row.youtube_url || "",
    tiktok_url: row.tiktok_url || "",
    naver_blog_url: row.naver_blog_url || "",
    instagram_followers: Number(row.instagram_followers || 0),
    youtube_followers: Number(row.youtube_followers || 0),
    tiktok_followers: Number(row.tiktok_followers || 0),
    post_price: row.post_price || "",
    short_price: row.short_price || "",
    ad_price: row.ad_price || "",
    category: row.category || "",
    follower_count: Number(row.follower_count || 0),
    follower_source: row.follower_source || "manual",
  };
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
    // 브랜드 매칭 등록에서 본인이 고른 분야. 등록서의 값을 먼저 쓰고, 없으면
    // 채널에 남아 있는 값으로 채운다 — 카테고리 선택이 생기기 전에 접수된
    // 지원자는 등록서 칸이 비어 있어서, 그것만 보면 전부 미분류로 뭉개진다.
    category_tags: splitCategories(row.category || row.channel_categories),
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
        // 분야는 최소 1개를 받는다. 캠페인은 "뷰티 인플루언서 5명" 형태로 들어오고
        // 후보 추리기는 이 값으로 한다 — 비어 있으면 등록은 됐는데 어느 캠페인
        // 후보에도 걸리지 않는 사람이 되고, 운영자가 나중에 한 명씩 물어봐야 한다.
        // 화면에서도 막고 있지만, 접수 경로는 로그인 없이도 열려 있어 여기서도 본다.
        if (splitCategories(b.category).length === 0) {
          return Response.json(
            { error: "카테고리를 최소 1개 골라 주세요. 캠페인은 분야로 인플루언서를 찾습니다." },
            { status: 400 },
          );
        }

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

        // 채널별 수기 입력 팔로워 수. 인스타는 연동값이 있으면 그것을 우선한다.
        const metaFollowers = linked ? Math.max(0, Number(linked.followers || 0)) : 0;
        const instagram_followers =
          metaFollowers || Math.max(0, parseInt(b.instagram_followers, 10) || 0);
        const youtube_followers = Math.max(0, parseInt(b.youtube_followers, 10) || 0);
        const tiktok_followers = Math.max(0, parseInt(b.tiktok_followers, 10) || 0);

        // 콘텐츠 유형별 단가
        const post_price = (b.post_price || "").toString().trim();
        const short_price = (b.short_price || "").toString().trim();

        // 인스타그램 지표는 공개 HTML 크롤링 값이 아니라 Meta 연동 데이터만 검증값으로
        // 사용한다. 연동을 마쳤으면 그 숫자를 대표값으로 굳히고, 연동 전에는 수기값을
        // 저장한 뒤 운영자 명단에서 Meta 동기화한다.
        // 틱톡은 기존 분류 호환을 위해 공개 페이지 확인을 best-effort 로 유지한다.
        const crawled = tiktok_url ? await crawlFollowers(tiktok_url) : null;

        // 관리자 화면 호환을 위해 단일 ad_price 텍스트를 파생 표기로 채운다.
        // 구간 분류/정렬용 대표 팔로워 수도 여기서 정해진다.
        const { ad_price, follower_count, follower_source } = deriveInfluencerFields({
          postPrice: post_price,
          shortPrice: short_price,
          adPriceFallback: (b.ad_price || "").toString(),
          instagramFollowers: instagram_followers,
          youtubeFollowers: youtube_followers,
          tiktokFollowers: tiktok_followers,
          metaFollowers,
          crawledFollowers: crawled,
        });

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

        // 고른 카테고리는 채널 정보(creator_channels)에도 남긴다. 빈 값일 때는 쓰지
        // 않는다 — 예전에 채워 둔 카테고리를 이번 등록서가 비었다는 이유로 지울 이유가 없다.
        await mirrorCategories(db, applicantUsername, (b.category || "").toString());

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

  // ── 본인 접수 확인/조회(로그인 사용자) ─────────────────────────────
  //
  // 화면은 두 가지를 해야 한다. 이미 등록했으면 등록 버튼을 감추고, 등록한 사람이
  // "수정하기"를 눌렀을 때 접수한 내용을 그대로 되살려야 한다. 그래서 본인 확인을
  // 통과한 요청에는 접수 상태와 함께 **본인이 적어 낸 등록서 내용**을 돌려준다.
  // 운영자 메모나 다른 지원자 정보는 담지 않는다(shapeOwnApplication).
  //
  // 관리자 확인(requireAdmin)보다 앞에 둔다. 인플루언서는 관리자가 아니고, 뒤에 두면
  // 여기 닿기 전에 403 이 나간다. 본인 확인은 callerIsAnyOf 로 한다 — 쿼리로 넘어온
  // 계정 이름을 그대로 믿으면 남의 접수 여부를 조회할 수 있다.
  if (req.method === "GET" && url.searchParams.get("mine") === "1") {
    try {
      const caller = await requireSignedInUser(req);
      if (!caller.ok) return caller.response;
      const role = url.searchParams.get("role") === "brand" ? "brand" : "influencer";
      const requested = norm(url.searchParams.get("username") || "");
      const username = requested || norm(caller.username);
      if (!username) {
        return Response.json({ error: "계정을 확인할 수 없습니다." }, { status: 400 });
      }
      if (!callerIsAnyOf(caller, [username])) {
        return Response.json({ error: "본인 계정만 확인할 수 있습니다." }, { status: 403 });
      }

      const rows = (await db.sql`
        SELECT *
        FROM collab_directory_applications
        WHERE role = ${role}
          AND LOWER(REGEXP_REPLACE(COALESCE(applicant_username, ''), '^biz/', '')) = ${username}
        ORDER BY created_at DESC
        LIMIT 1
      `) as any[];
      const row = rows?.[0];

      return Response.json({
        submitted: !!row,
        role,
        status: row?.status || "",
        createdAt: row?.created_at || null,
        application: shapeOwnApplication(row),
      });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  // ── 본인 등록서 수정(로그인 사용자) ─────────────────────────────
  //
  // 광고 단가는 접수한 뒤에도 바뀐다(성수기·채널 성장·재계약). 고칠 방법이 취소 후
  // 재등록뿐이면, 고친 사람은 접수 순서를 잃고 운영자 명단에서는 같은 사람이 두 번
  // 지나간 것처럼 보인다. 그래서 접수한 등록서를 제자리에서 고친다.
  //
  // 보내지 않은 칸은 건드리지 않는다 — 단가만 고치러 온 요청이 이름·연락처를 빈
  // 값으로 덮어쓰면 안 된다.
  if (req.method === "PATCH" && url.searchParams.get("mine") === "1") {
    try {
      const caller = await requireSignedInUser(req);
      if (!caller.ok) return caller.response;
      const role = url.searchParams.get("role") === "brand" ? "brand" : "influencer";
      const requested = norm(url.searchParams.get("username") || "");
      const username = requested || norm(caller.username);
      if (!username) {
        return Response.json({ error: "계정을 확인할 수 없습니다." }, { status: 400 });
      }
      if (!callerIsAnyOf(caller, [username])) {
        return Response.json({ error: "본인 등록서만 수정할 수 있습니다." }, { status: 403 });
      }

      const rows = (await db.sql`
        SELECT *
        FROM collab_directory_applications
        WHERE role = ${role}
          AND LOWER(REGEXP_REPLACE(COALESCE(applicant_username, ''), '^biz/', '')) = ${username}
        ORDER BY created_at DESC
        LIMIT 1
      `) as any[];
      const row = rows?.[0];
      if (!row) {
        return Response.json({ error: "수정할 등록서가 없습니다." }, { status: 404 });
      }

      const b = await req.json();
      /** 보내지 않은 칸은 기존 값을 그대로 둔다. */
      const text = (key: string, fallback: unknown) =>
        typeof b[key] === "undefined" ? String(fallback || "") : String(b[key] ?? "").trim();
      const count = (key: string, fallback: unknown) =>
        typeof b[key] === "undefined"
          ? Math.max(0, Number(fallback || 0))
          : Math.max(0, parseInt(String(b[key]).replace(/[^\d]/g, ""), 10) || 0);

      const name = text("name", row.name);
      const contact = text("contact", row.contact);
      if (!name) return Response.json({ error: "이름을 입력해 주세요." }, { status: 400 });
      if (!contact) return Response.json({ error: "연락처를 입력해 주세요." }, { status: 400 });

      if (role === "brand") {
        const budgetText = text("budget_text", row.budget_text);
        const budget = Math.max(0, parseInt(budgetText.replace(/[^\d]/g, ""), 10) || 0);
        await db.sql`
          UPDATE collab_directory_applications SET
            name = ${name},
            contact = ${contact},
            brand_homepage = ${text("brand_homepage", row.brand_homepage)},
            brand_instagram = ${text("brand_instagram", row.brand_instagram)},
            desired_count = ${text("desired_count", row.desired_count)},
            desired_followers = ${text("desired_followers", row.desired_followers)},
            budget = ${budget},
            budget_text = ${budgetText},
            desired_schedule = ${text("desired_schedule", row.desired_schedule)},
            desired_category = ${text("desired_category", row.desired_category)},
            note = ${text("note", row.note)},
            updated_at = now()
          WHERE id = ${row.id}
        `;
      } else {
        const category = text("category", row.category);
        // 분야가 비면 이 사람은 어느 캠페인 후보에도 걸리지 않는다. 접수 때 막는
        // 조건이므로 수정에서도 같게 본다.
        if (splitCategories(category).length === 0) {
          return Response.json(
            { error: "카테고리를 최소 1개 골라 주세요. 캠페인은 분야로 인플루언서를 찾습니다." },
            { status: 400 },
          );
        }

        // 연동을 마친 계정이면 인스타 팔로워는 검증된 값이 대표값이다(접수 때와 같은 규칙).
        const linked = await loadLinkedChannel(db, req, String(row.applicant_username || username));
        const metaFollowers = linked ? Math.max(0, Number(linked.followers || 0)) : 0;

        const tiktok_url = text("tiktok_url", row.tiktok_url);
        const instagram_url =
          text("instagram_url", row.instagram_url) ||
          (linked?.instagram_url ? String(linked.instagram_url) : "") ||
          (linked?.instagram_handle ? `https://www.instagram.com/${linked.instagram_handle}/` : "");
        const instagram_followers = metaFollowers || count("instagram_followers", row.instagram_followers);
        const youtube_followers = count("youtube_followers", row.youtube_followers);
        const tiktok_followers = count("tiktok_followers", row.tiktok_followers);
        const post_price = text("post_price", row.post_price);
        const short_price = text("short_price", row.short_price);

        // 틱톡 주소가 바뀐 경우에만 공개 페이지를 다시 본다. 단가만 고치러 온 요청이
        // 외부 사이트 응답을 기다릴 이유가 없다.
        const crawled =
          tiktok_url && tiktok_url !== String(row.tiktok_url || "")
            ? await crawlFollowers(tiktok_url)
            : null;

        const { ad_price, follower_count, follower_source } = deriveInfluencerFields({
          postPrice: post_price,
          shortPrice: short_price,
          adPriceFallback: text("ad_price", row.ad_price),
          instagramFollowers: instagram_followers,
          youtubeFollowers: youtube_followers,
          tiktokFollowers: tiktok_followers,
          metaFollowers,
          crawledFollowers: crawled,
        });

        await db.sql`
          UPDATE collab_directory_applications SET
            name = ${name},
            contact = ${contact},
            instagram_url = ${instagram_url},
            youtube_url = ${text("youtube_url", row.youtube_url)},
            tiktok_url = ${tiktok_url},
            naver_blog_url = ${text("naver_blog_url", row.naver_blog_url)},
            instagram_followers = ${instagram_followers},
            youtube_followers = ${youtube_followers},
            tiktok_followers = ${tiktok_followers},
            ad_price = ${ad_price},
            post_price = ${post_price},
            short_price = ${short_price},
            category = ${category},
            follower_count = ${follower_count},
            follower_source = ${follower_source},
            note = ${text("note", row.note)},
            updated_at = now()
          WHERE id = ${row.id}
        `;

        await mirrorCategories(db, String(row.applicant_username || username), category);
      }

      const updated = (await db.sql`
        SELECT * FROM collab_directory_applications WHERE id = ${row.id}
      `) as any[];

      return Response.json({
        success: true,
        application: shapeOwnApplication(updated?.[0] || row),
      });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  // ── 본인 접수 취소(로그인 사용자) ─────────────────────────────
  if (req.method === "DELETE" && url.searchParams.get("mine") === "1") {
    try {
      const caller = await requireSignedInUser(req);
      if (!caller.ok) return caller.response;
      const role = url.searchParams.get("role") === "brand" ? "brand" : "influencer";
      const requested = norm(url.searchParams.get("username") || "");
      const username = requested || norm(caller.username);
      if (!username) {
        return Response.json({ error: "계정을 확인할 수 없습니다." }, { status: 400 });
      }
      if (!callerIsAnyOf(caller, [username])) {
        return Response.json({ error: "본인 계정만 취소할 수 있습니다." }, { status: 403 });
      }

      await db.sql`
        DELETE FROM collab_directory_applications
        WHERE role = ${role}
          AND LOWER(REGEXP_REPLACE(COALESCE(applicant_username, ''), '^biz/', '')) = ${username}
      `;

      return Response.json({ success: true, cancelled: true });
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
              c.categories AS channel_categories,
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
              c.categories AS channel_categories,
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
