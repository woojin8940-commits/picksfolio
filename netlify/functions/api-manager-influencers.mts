import { getDatabase } from "@picks/netlify-database";
import type { Config, Context } from "@netlify/functions";
import { requireManager } from "./_shared/manager-auth.mts";
import { shapeChannel } from "./_shared/campaign-listup.mts";
import { refreshStaleChannelImages, resyncStaleChannels } from "./_shared/instagram-metrics.mts";

/**
 * 담당자 인플루언서 명부 — 픽스폴리오에 등록된 인플루언서 전체를 카테고리로 묶어 준다.
 *
 * 리스트업 후보 풀(api-campaign-listup?pool=1)과 무엇이 다른가. 저쪽은 "이 캠페인에
 * 누구를 넣을까"를 고르는 화면이라 이미 명단에 오른 사람을 빼고, 그 캠페인 지원자를
 * 위로 올린다. 여기는 캠페인과 무관하게 "우리에게 누가 있는가"를 보는 화면이다.
 * 담당자가 캠페인을 받기 전에 먼저 보는 것이 이쪽이고, 두 목적을 한 API 로 묶으면
 * 캠페인을 고르기 전에는 아무도 볼 수 없게 된다.
 *
 * 사람 한 명이 두 표에 걸쳐 있다. 본인이 등록한 채널 지표(creator_channels)와
 * 협업 매칭 등록서(collab_directory_applications)다. 둘을 계정 이름으로 겹치되
 * 지표는 본인 등록을 우선한다 — 등록서의 숫자는 접수 시점에 손으로 적은 값이라
 * 시간이 지나면 틀린다.
 *
 * 숫자는 읽는 김에 뒤에서 조금씩 최신으로 맞춘다. creator_channels 의 값은 연동하는
 * 순간과 인플루언서가 '갱신'을 누르는 순간에만 채워져 왔고, 둘 다 인플루언서의 손이
 * 필요한 일이라 이 화면은 몇 달 전 숫자와 그때의 릴스 목록을 지금 것처럼 보여 줬다 —
 * 인플루언서가 지운 게시물이 카드에 남고, 팔로워가 두 배가 된 사람도 옛 숫자로
 * 남았다. 매일 도는 배치(scheduled-follower-snapshot)가 순환으로 같은 일을 하고,
 * 이 길에서는 담당자가 지금 보고 있는 사람 중 가장 오래된 몇 계정만 앞으로 당겨
 * 온다. 응답을 보낸 뒤에 돌리므로 화면이 그 값을 로딩으로 내지 않는다.
 */

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

/**
 * 카테고리 문자열을 개별 태그로 쪼갠다. 등록 경로마다 구분자가 달라서
 * ("뷰티·패션", "뷰티, 패션", "뷰티/패션") 한 곳에서 통일한다. 통일하지 않으면
 * 같은 카테고리가 화면에 세 번 나온다.
 */
const splitCategories = (raw: unknown): string[] =>
  String(raw || "")
    .split(/[·,/|]|\s{2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.length <= 20);

const average = (values: number[]): number => {
  const valid = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, v) => sum + v, 0) / valid.length);
};

/**
 * 최근 릴스 동향. 최근 3개의 평균 조회수를 그 이전 3개와 비교한다.
 *
 * 팔로워 수만 보면 지금 이 계정이 뜨고 있는지 식고 있는지 알 수 없다. 팔로워는
 * 한번 쌓이면 잘 줄지 않지만 조회수는 즉시 반응하기 때문이다. 비교할 이전 구간이
 * 없으면(릴스가 3개 이하) 0% 가 아니라 null 을 준다 — 0% 는 "변화 없음"이라는
 * 뜻이고, 여기서 필요한 말은 "아직 알 수 없음"이다.
 */
const reelTrend = (reels: any[]) => {
  const views = (Array.isArray(reels) ? reels : []).slice(0, 6).map((r) => Number(r?.views || 0));
  const recent = average(views.slice(0, 3));
  const previous = average(views.slice(3, 6));
  return {
    recentAvgViews: recent,
    previousAvgViews: previous,
    trendPercent: previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null,
  };
};

export default async (req: Request, context: Context) => {
  const manager = await requireManager(req);
  if (!manager.ok) return manager.response;

  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const db = getDatabase();
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const like = `%${q}%`;
  const category = String(url.searchParams.get("category") || "").trim();
  const catLike = `%${category}%`;

  try {
    const [channelRows, dirRows, collabRows] = await Promise.all([
      db.sql`
        SELECT * FROM creator_channels
        WHERE (${q} = '' OR username ILIKE ${like} OR instagram_handle ILIKE ${like}
               OR categories ILIKE ${like} OR intro ILIKE ${like})
          AND (${category} = '' OR categories ILIKE ${catLike})
        ORDER BY followers DESC
        LIMIT 400
      `,

      db.sql`
        SELECT id, applicant_username, name, instagram_url, category, note,
               ad_price, post_price, short_price, contact,
               COALESCE(NULLIF(instagram_followers, 0), follower_count) AS followers,
               created_at
        FROM collab_directory_applications
        WHERE role = 'influencer'
          AND COALESCE(applicant_username, '') <> ''
          AND (${q} = '' OR applicant_username ILIKE ${like} OR name ILIKE ${like}
               OR category ILIKE ${like})
          AND (${category} = '' OR category ILIKE ${catLike})
        ORDER BY followers DESC NULLS LAST
        LIMIT 400
      `,

      // 지금 무엇을 진행 중인 사람인지. 새 캠페인에 넣기 전에 겹치는 일정이
      // 있는지부터 봐야 한다.
      db.sql`
        SELECT LOWER(creator_username) AS username,
               COUNT(*) FILTER (WHERE status = 'in_progress')::int AS running,
               COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
        FROM campaign_collabs
        GROUP BY LOWER(creator_username)
      `,
    ]);

    const collabMap = new Map<string, any>();
    for (const c of collabRows as any[]) collabMap.set(norm(c.username), c);

    const people = new Map<string, any>();
    const touch = (username: unknown) => {
      const key = norm(username);
      if (!key) return null;
      if (!people.has(key)) {
        people.set(key, {
          username: key,
          name: "",
          instagramHandle: "",
          instagramUrl: "",
          followers: 0,
          following: 0,
          avgViews: 0,
          avgLikes: 0,
          avgComments: 0,
          reelsCount: 0,
          engagementRate: 0,
          recentAvgViews: 0,
          previousAvgViews: 0,
          reelTrendPercent: null as number | null,
          metricsSource: "",
          connected: false,
          recentReels: [],
          syncedAt: "",
          intro: "",
          categories: "",
          /**
           * 카테고리는 두 곳에 적힌다 — 본인이 등록한 채널 지표와 협업 등록서.
           * 카드에 찍는 대표 문구(categories)는 새 값인 채널 쪽을 쓰지만, 칩을
           * 눌렀을 때의 필터는 두 곳 중 하나라도 맞으면 걸린다. 그래서 카드에 다는
           * 태그는 두 곳을 합집합으로 모은다 — 안 그러면 "뷰티" 칩으로 걸러 낸
           * 사람의 카드에 뷰티가 안 적혀 있는 화면이 된다.
           */
          channelCategories: "",
          directoryCategories: "",
          categoryTags: [] as string[],
          adPrice: "",
          postPrice: "",
          shortPrice: "",
          note: "",
          contact: "",
          directoryId: "",
          registered: false,
          runningCollabs: 0,
          completedCollabs: 0,
        });
      }
      return people.get(key);
    };

    for (const row of dirRows as any[]) {
      const item = touch(row.applicant_username);
      if (!item) continue;
      item.directoryId = row.id;
      item.name = row.name || item.name;
      item.instagramUrl = row.instagram_url || item.instagramUrl;
      item.categories = row.category || item.categories;
      item.directoryCategories = row.category || item.directoryCategories;
      item.adPrice = row.ad_price || "";
      item.postPrice = row.post_price || "";
      item.shortPrice = row.short_price || "";
      item.note = row.note || "";
      item.contact = row.contact || "";
      item.followers = Number(row.followers || 0) || item.followers;
    }

    for (const row of channelRows as any[]) {
      const item = touch(row.username);
      if (!item) continue;
      const shaped = shapeChannel(row);
      item.registered = true;
      item.instagramHandle = shaped.instagramHandle;
      item.instagramUrl = shaped.instagramUrl || item.instagramUrl;
      item.followers = shaped.followers || item.followers;
      item.following = shaped.following;
      item.avgViews = shaped.avgViews;
      item.avgLikes = shaped.avgLikes;
      item.avgComments = shaped.avgComments;
      item.reelsCount = shaped.reelsCount;
      item.metricsSource = shaped.metricsSource;
      item.connected = shaped.connected;
      // 동향은 6개까지 보고 계산한 뒤, 화면에 실을 썸네일만 3개로 줄인다.
      const trend = reelTrend(shaped.recentReels);
      item.recentAvgViews = trend.recentAvgViews;
      item.previousAvgViews = trend.previousAvgViews;
      item.reelTrendPercent = trend.trendPercent;
      // 참여율은 팔로워 대비 평균 반응(좋아요+댓글)이다. 팔로워가 많아도 반응이
      // 없는 계정을 팔로워 순 목록에서 걸러 내는 데 쓴다.
      item.engagementRate = shaped.followers > 0
        ? Math.round(((shaped.avgLikes + shaped.avgComments) / shaped.followers) * 1000) / 10
        : 0;
      item.recentReels = shaped.recentReels.slice(0, 3);
      item.syncedAt = shaped.syncedAt;
      item.intro = shaped.intro;
      item.categories = shaped.categories || item.categories;
      item.channelCategories = shaped.categories || item.channelCategories;
    }

    const list = Array.from(people.values()).map((p) => {
      const stat = collabMap.get(p.username);
      p.categoryTags = Array.from(
        new Set([
          ...splitCategories(p.channelCategories),
          ...splitCategories(p.directoryCategories),
        ]),
      );
      p.runningCollabs = Number(stat?.running || 0);
      p.completedCollabs = Number(stat?.completed || 0);
      return p;
    });

    list.sort((a, b) => (b.followers || 0) - (a.followers || 0));

    /*
     * 응답을 보낸 뒤에 지표를 조금씩 최신으로 맞춘다(위 머리글 참고).
     *
     * 두 가지를 나눠 부른다. 얼굴·썸네일만 바꿔 오는 가벼운 길(오래된 6계정까지)과,
     * 릴스 목록·팔로워 수를 통째로 다시 받는 무거운 길(오래된 2계정까지)이다. 지운
     * 게시물이 목록에서 사라지는 것은 뒤쪽만 할 수 있다 — 앞쪽은 굳어 있는 목록의
     * 그림 주소만 갈아 끼우고 사라진 항목은 일부러 그대로 둔다.
     *
     * 대상은 화면에 실제로 뜬 사람뿐이다. 실패는 삼킨다 — 명부는 지표 없이도
     * 그려져야 하고, 이 일은 이미 응답을 보낸 뒤라 화면에 알릴 자리도 없다.
     */
    const shown = list.filter((p) => p.connected).map((p) => p.username);
    if (shown.length > 0) {
      context.waitUntil(
        resyncStaleChannels(db, shown)
          .catch(() => 0)
          // 순서를 지킨다. 지표를 통째로 받아 온 계정에는 사진 도장도 함께 찍히므로
          // 뒤따르는 사진 갱신은 그 계정을 다시 고르지 않는다. 둘을 같이 돌리면 같은
          // 행의 릴스 목록을 두 곳에서 쓰게 되고, 나중에 끝난 쪽이 남는다.
          .then(() => refreshStaleChannelImages(db, shown).catch(() => 0)),
      );
    }

    /**
     * 카테고리 집계.
     *
     * 두 가지를 지킨다.
     *
     * ① 필터가 걸리지 않은 전체 기준으로 센다. 필터 결과로 세면 "뷰티"를 고른 순간
     *    다른 카테고리가 목록에서 사라져 되돌아갈 길이 없어진다.
     *
     * ② 사람을 센다. 칸을 세지 않는다. 예전에는 두 표를 UNION ALL 로 이어 붙인
     *    뒤 줄마다 태그를 세서, 채널 지표와 협업 등록서에 모두 있는 사람이 카테고리마다
     *    두 번 계산됐다 — 위 목록은 username 으로 한 명으로 겹쳐 놓았으니, 칩에는
     *    12명이라고 적혀 있는데 눌러 보면 7명이 나왔다. 사람별로 태그를 모아 집합으로
     *    만든 다음 세면 한 사람이 같은 카테고리에서 한 번만 세어진다(한 사람의 등록서와
     *    채널 지표에 "뷰티"가 둘 다 적혀 있어도 한 번).
     *
     * 계정 이름을 겹치는 방법도 목록과 같아야 한다. SQL 의 LOWER 만으로는 'biz/'
     * 접두어가 붙은 계정이 다른 사람으로 남으므로 JS 의 norm 을 한 번 더 통과시킨다.
     */
    const catRows = (await db.sql`
      SELECT username AS person, categories AS tags
      FROM creator_channels
      WHERE COALESCE(username, '') <> '' AND COALESCE(categories, '') <> ''
      UNION ALL
      SELECT applicant_username AS person, category AS tags
      FROM collab_directory_applications
      WHERE role = 'influencer'
        AND COALESCE(applicant_username, '') <> ''
        AND COALESCE(category, '') <> ''
    `) as any[];

    const tagsByPerson = new Map<string, Set<string>>();
    for (const row of catRows) {
      const key = norm(row.person);
      if (!key) continue;
      let set = tagsByPerson.get(key);
      if (!set) {
        set = new Set<string>();
        tagsByPerson.set(key, set);
      }
      for (const tag of splitCategories(row.tags)) set.add(tag);
    }

    const counts = new Map<string, number>();
    for (const set of tagsByPerson.values()) {
      for (const tag of set) counts.set(tag, (counts.get(tag) || 0) + 1);
    }

    return Response.json({
      influencers: list,
      total: list.length,
      categories: Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 40),
    });
  } catch (err: any) {
    return Response.json(
      { error: err?.message || "인플루언서 명부를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/manager-influencers",
};
