import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Cell, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiService, type TaggedMediaItem, type TaggedMediaResponse } from '../services/apiService';

/**
 * 인사이트 — 브랜드가 "누가 우리를 태그했는지" 보는 화면.
 *
 * 이 화면은 새 연동을 만들지 않는다. 디엠 자동화에서 붙여 둔 브랜드 계정의 토큰으로
 * 조회만 하고, 목록은 서버가 몇 시간 단위로 굳혀 둔다 — 새로고침마다 메타를 다시
 * 부르면 브랜드 한 곳이 시간당 호출 한도를 혼자 태운다. 그래서 화면은 "언제 기준
 * 숫자인지"를 항상 함께 적고, 지금 값을 받고 싶은 사람에게만 버튼을 준다.
 *
 * 도달·저장수는 이 화면에 없다. 남의 계정 게시물에는 인사이트를 조회할 권한이
 * 원래 없다 — 자리를 만들어 '—' 로 비워 두면 "언젠가 채워질 값"으로 읽히므로 아예
 * 넣지 않는다.
 *
 * 조회수는 서버가 목록을 만드는 그 자리에서 콘텐츠를 올린 계정의 인사이트에서 받아
 * 채운다. 그래서 화면을 처음 열었을 때 이미 값이 있고, 사람이 새로 불러오기를 눌러야
 * 채워지는 값이 아니다. 그래도 비는 자리는 있다 — 릴스가 아닌 게시물, 올린 직후라
 * 집계 전인 릴스, 연동이 끊긴 계정의 게시물이다. 그건 0 이 아니라 '—' 로 둔다.
 *
 * 월별 그래프는 태그된 콘텐츠와 브랜드 계정이 직접 올린 게시물을 함께 센다. 목록은
 * 태그된 콘텐츠만 담는다 — 브랜드가 "그 달에 우리 브랜드로 오간 콘텐츠"를 보려는
 * 그래프와, "누가 우리를 태그했나"를 보려는 목록은 서로 다른 질문에 답한다.
 *
 * ── 화면의 네 블록 ──
 *
 *   1. 브랜드 계정 추이  — 우리 계정 자체의 팔로워·팔로잉·최근 증감
 *   2. 태그 콘텐츠 요약  — 이번 달 몇 개, 조회수·좋아요 합계, 태그한 계정 수
 *   3. 월별 콘텐츠 성과  — 최근 6개월의 조회수·좋아요·댓글·콘텐츠 수
 *   4. TOP 10           — 성과가 가장 좋았던 태그된 콘텐츠
 *
 * 블록1 은 값을 못 받으면 아예 그리지 않는다. 팔로워 자리에 0 을 적으면 그건 "팔로워가
 * 없다"는 사실 주장이 되고, '—' 로 비워 두면 "언젠가 채워질 값"으로 읽힌다.
 *
 * ── 블록3 은 왜 그래프가 여러 개인가 ──
 *
 * 조회수(수만 회)와 콘텐츠 수(수십 개)는 자릿수가 아예 다르다. 예전에는 한 그래프에
 * 축을 둘로 나눠(왼쪽 조회수, 오른쪽 콘텐츠 수) 그렸는데, 축이 둘인 그래프는 두 계열의
 * 교차점이 축 눈금을 어떻게 잡았는지에 따라 달라진다 — "이번 달은 편 수가 줄었는데
 * 조회수가 늘었다"를 보여 주려던 자리에서, 눈금 선택이 그 판단을 만들어 낼 수 있다.
 * 여기에 좋아요·댓글까지 같은 그래프에 넣으면 그 문제가 계열 수만큼 늘어난다.
 * 그래서 축은 하나씩 두고 그래프를 나눈다: 조회수 한 장, 좋아요·댓글 한 장(둘 다
 * '반응 수'라 같은 축에 둘 수 있다), 콘텐츠 수 한 장. x축(월)은 세 장이 같다.
 *
 * 이번 달 막대는 색을 달리 칠하고 지난달 조회수에 점선을 하나 긋는다. 브랜드가 이
 * 화면에서 실제로 확인하려는 것은 6개월의 모양이 아니라 "지난달보다 나아졌는가"
 * 하나다.
 *
 * 참여율(engagement rate)은 어디에도 적지 않는다. 태그된 콘텐츠는 남의 계정 것이라
 * 분모(팔로워·도달)를 우리가 확실히 알 수 없고, 아는 척한 비율은 브랜드가 인플루언서를
 * 고르는 근거로 곧장 쓰인다.
 *
 * 목록이 어디까지 덮는지는 화면 아래에 그대로 적는다. 메타의 tags 엣지(태그된 미디어
 * 목록)는 페이스북 로그인 방식 전용이어서 우리 토큰으로는 거부된다. 그래서 실제
 * 목록은 우리 서비스에 연동된 인플루언서들의 최근 콘텐츠에서 우리 계정 언급을 찾아
 * 만든다. 함께 일한 인플루언서의 콘텐츠는 대부분 여기 들어오지만, 연동하지 않은
 * 사람이 태그한 게시물은 잡히지 않는다 — 이걸 숨기면 목록에 없는 것이 "없다"로
 * 읽힌다.
 */

/** 목록 정렬 기준. */
type SortKey = 'recent' | 'views' | 'likes';
/** TOP 10 을 무엇으로 줄 세우나. */
type RankKey = 'views' | 'likes';

/**
 * 그래프 색.
 *
 * 계열이 아니라 대상을 따라간다 — 같은 파랑은 세 그래프에서 모두 "태그된 콘텐츠"고,
 * 옅은 파랑은 모두 "브랜드 계정이 올린 것"이다. 그래프마다 색이 뜻을 바꾸면 세 장을
 * 나란히 볼 수 없다.
 *
 * 옅은 쪽은 예전에 #93c5fd 였다. 진한 파랑과 나란히 두면 색약 조건에서 두 층이
 * 붙어 보이는 값이라(검증에서 떨어졌다) 한 단 진한 #60a5fa 로 올렸다.
 * 좋아요·댓글은 같은 그래프에 나란히 서므로 서로 다른 계열색을 쓴다.
 */
const C_TAGGED = '#2563eb';
const C_OWN = '#60a5fa';
const C_NOW = '#7c3aed';
const C_LIKES = '#e11d48';
const C_COMMENTS = '#0d9488';

/** 큰 숫자는 만·억 단위로 접는다. 카드 안에서 자리를 다투지 않게. */
const compact = (n: number | null | undefined): string => {
  if (n === null || typeof n === 'undefined' || !Number.isFinite(n) || n < 0) return '—';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}만`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}천`;
  return n.toLocaleString();
};

/** 게시일. 한국 시간 기준 'YYYY.MM.DD'. */
const postedOn = (iso: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replace(/-/g, '.');
};

/** '3시간 전' 같은 상대 시각. 캐시된 값이 언제 기준인지 밝히는 데 쓴다. */
const agoText = (iso: string | undefined): string => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
};

/** 'YYYY-MM' (한국 달력). 월별 묶음의 기준. */
const monthKey = (iso: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
  }).format(new Date(t));
};

/** 그래프에 그릴 최근 개월 수. 한 화면에서 흐름이 읽히는 길이. */
const CHART_MONTHS = 6;

/** 최근 6개월 키를 과거→현재 순으로. 콘텐츠가 없던 달도 자리를 남긴다. */
const recentMonthKeys = (): string[] => {
  const now = new Date();
  const nowKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
  }).format(now);
  const [y, m] = nowKey.split('-').map(Number);
  const keys: string[] = [];
  for (let i = CHART_MONTHS - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
};

const byRecent = (a: TaggedMediaItem, b: TaggedMediaItem) =>
  Date.parse(b.timestamp || '') - Date.parse(a.timestamp || '');

const sortItems = (items: TaggedMediaItem[], key: SortKey): TaggedMediaItem[] => {
  const copy = [...items];
  if (key === 'recent') return copy.sort(byRecent);
  // 값이 없는 항목(공개되지 않은 좋아요, 아직 집계 전인 조회수)은 0 으로 세지 않고
  // 뒤로 보낸다. 0 으로 섞으면 "조회수 0인 콘텐츠"처럼 보인다.
  return copy.sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === null && y === null) return byRecent(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return (y as number) - (x as number) || byRecent(a, b);
  });
};

/** TOP 10. 그 지표를 실제로 받아온 콘텐츠만 줄 세운다 — 빈 값은 순위가 아니다. */
const RANK_LIMIT = 10;
const rankItems = (items: TaggedMediaItem[], key: RankKey): TaggedMediaItem[] =>
  sortItems(items.filter((m) => typeof m[key] === 'number'), key).slice(0, RANK_LIMIT);

const BusinessTaggedContent: React.FC<{ businessUsername: string }> = ({ businessUsername }) => {
  const [data, setData] = useState<TaggedMediaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortKey>('recent');
  const [query, setQuery] = useState('');
  const [grouped, setGrouped] = useState(false);
  /** TOP 10 정렬 기준(블록4). 조회수가 기본이다 — 브랜드가 먼저 보는 성과 값. */
  const [rankBy, setRankBy] = useState<RankKey>('views');
  /**
   * 전체 목록을 펼쳤는가.
   *
   * 기본은 TOP 10 만 보여 준다. 그래도 전체 목록(계정 검색·계정별 묶어보기)을 없애지
   * 않는다 — 브랜드가 "그 사람이 올린 것만" 확인하려는 순간이 실제로 있고, 그때
   * 목록이 사라져 있으면 이 화면에서 할 수 있는 일이 줄어든다.
   */
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(
    async (opts: { refresh?: boolean } = {}) => {
      if (!businessUsername) return;
      if (opts.refresh) setRefreshing(true);
      else setLoading(true);
      const res = await apiService.getBusinessTaggedMedia(businessUsername, { refresh: opts.refresh });
      setData(res);
      setLoading(false);
      setRefreshing(false);
    },
    [businessUsername],
  );

  useEffect(() => { void load(); }, [load]);

  const items = data?.items || [];
  /** 브랜드 계정이 직접 올린 게시물. 목록에는 넣지 않고 월별 추이에서만 함께 센다. */
  const ownItems = data?.ownItems || [];
  const summary = data?.summary;
  /**
   * 조회수가 왜 비어 있는지에 대한 집계. 예전 판 응답에는 없다.
   *
   * 후보(candidates) / 물어본 수(attempted) / 채운 수(filled) / 토큰이 없어 물어보지도
   * 못한 수(noToken) 를 들고 있어, 화면이 "조회수가 없다" 와 "물어볼 수 없었다" 를
   * 구분해 적을 수 있다.
   */
  const fill = data?.viewsFill;

  /** 검색은 태그한 계정명으로만 한다(2단계). 아이디와 사용자명 양쪽을 본다. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    if (!q) return items;
    return items.filter(
      (m) =>
        m.authorHandle.toLowerCase().includes(q) ||
        m.authorUsername.toLowerCase().includes(q),
    );
  }, [items, query]);

  const sorted = useMemo(() => sortItems(filtered, sort), [filtered, sort]);

  /** 계정별 묶어보기. 콘텐츠가 많은 계정이 위로 온다. */
  const groups = useMemo(() => {
    const byAuthor = new Map<string, TaggedMediaItem[]>();
    for (const m of sorted) {
      const key = m.authorHandle || m.authorUsername || '(알 수 없는 계정)';
      const list = byAuthor.get(key);
      if (list) list.push(m);
      else byAuthor.set(key, [m]);
    }
    return [...byAuthor.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [sorted]);

  /**
   * 월별 묶음. 태그된 콘텐츠와 브랜드 계정이 직접 올린 게시물을 나란히 센다.
   *
   * 두 값을 합쳐 한 막대로 만들지 않고 쌓아 올린다 — 브랜드가 알아야 하는 것은 그 달의
   * 총량만이 아니라 "그중 얼마가 인플루언서에게서 온 것인가" 이고, 합계 하나로는 그
   * 구분이 사라진다.
   *
   * 개수는 그 달에 실제로 잡힌 콘텐츠 수이므로 0 도 사실이지만, 조회수 합계는 값이 있는
   * 항목만 더한 값이다 — 몇 개를 근거로 냈는지 함께 들고 다녀서 그래프 옆에 밝힌다.
   */
  const monthly = useMemo(() => {
    const keys = recentMonthKeys();
    const base = new Map(
      keys.map((k) => [
        k,
        {
          month: k,
          count: 0, views: 0, valued: 0,
          ownCount: 0, ownViews: 0, ownValued: 0,
          // 점선(지난달 조회수)과 지난달 대비 칸이 읽는 합계. 쌓은 막대의 총합이라
          // 그래프가 다시 더하지 않도록 여기서 한 번만 만든다.
          totalCount: 0, totalViews: 0, totalValued: 0,
          /**
           * 좋아요·댓글은 받은 것과 올린 것을 나누지 않고 합쳐 센다.
           *
           * 조회수는 "인플루언서에게서 온 성과"와 "우리가 만든 성과"를 가르는 것이
           * 판단에 쓰이지만, 좋아요·댓글까지 넷으로 쪼개면 작은 그래프 한 장에 계열이
           * 네 개가 되고 댓글 쪽은 바닥에 붙어 아무것도 읽히지 않는다.
           *
           * valued 는 그 값을 실제로 받아온 콘텐츠 수다. 좋아요는 계정 설정으로 숨길
           * 수 있어 비는 자리가 생기고, 그때 합계는 진짜보다 작다 — 몇 개를 근거로 낸
           * 값인지 함께 들고 다녀서 그래프 옆에 밝힌다.
           */
          totalLikes: 0, likesValued: 0,
          totalComments: 0, commentsValued: 0,
        },
      ]),
    );
    const add = (list: TaggedMediaItem[], own: boolean) => {
      for (const m of list) {
        const row = base.get(monthKey(m.timestamp));
        if (!row) continue;
        if (own) row.ownCount += 1;
        else row.count += 1;
        row.totalCount += 1;
        if (typeof m.views === 'number') {
          if (own) {
            row.ownViews += m.views;
            row.ownValued += 1;
          } else {
            row.views += m.views;
            row.valued += 1;
          }
          row.totalViews += m.views;
          row.totalValued += 1;
        }
        if (typeof m.likes === 'number') {
          row.totalLikes += m.likes;
          row.likesValued += 1;
        }
        if (typeof m.comments === 'number') {
          row.totalComments += m.comments;
          row.commentsValued += 1;
        }
      }
    };
    add(items, false);
    add(ownItems, true);
    return [...base.values()];
  }, [items, ownItems]);

  /**
   * 이번 달과 지난달. 그래프의 마지막 두 칸이다.
   *
   * 지난달에 값이 아예 없으면 증감률은 만들지 않는다 — 0 에서 늘어난 것을 "+100%" 로
   * 적으면 첫 달의 성과가 실제보다 대단해 보인다.
   */
  const thisMonthRow = monthly[monthly.length - 1];
  const lastMonthRow = monthly.length >= 2 ? monthly[monthly.length - 2] : undefined;

  const chartHasValue = monthly.some((r) => r.totalCount > 0 || r.totalViews > 0);
  /** 좋아요·댓글 그래프를 그릴 값이 있는가. 없으면 그 한 장만 생략한다. */
  const reactionHasValue = monthly.some((r) => r.likesValued > 0 || r.commentsValued > 0);
  /**
   * 조회수를 한 편도 못 받았는가.
   *
   * 브랜드 자기 게시물의 조회수는 브랜드 토큰으로 받을 수 있으므로, 태그된 콘텐츠가
   * 전부 비어 있어도 그래프의 조회수 계열은 값이 있을 수 있다. 그래서 두 배열을 함께
   * 보고, 정말 아무 값도 없을 때만 조회수 보기를 잠근다.
   */
  const viewsMissing =
    items.length + ownItems.length > 0 &&
    [...items, ...ownItems].every((m) => m.views === null);

  /**
   * 좋아요를 한 개도 못 받았는가.
   *
   * 좋아요 수는 계정 설정으로 숨길 수 있고, 숨긴 게시물에는 값이 오지 않는다. 전부
   * 비어 있으면 "좋아요순" 줄 세우기를 잠근다 — 눌러도 순서가 바뀌지 않는 버튼은
   * 고장으로 읽힌다.
   */
  const likesMissing = items.length > 0 && items.every((m) => m.likes === null);

  /**
   * 실제로 줄 세우는 기준.
   *
   * 기본은 조회수인데, 조회수를 한 개도 못 받은 브랜드에게는 그 기본값이 빈 순위표와
   * 잠긴 버튼만 남긴다 — 사람이 좋아요순을 직접 눌러야 무언가 보인다. 그 경우에는
   * 값이 있는 쪽으로 옮겨 둔다(사람이 고른 값을 덮어쓰지 않도록, 못 받은 경우에만).
   */
  const effectiveRank: RankKey =
    rankBy === 'views' && viewsMissing && !likesMissing ? 'likes' : rankBy;

  /** 블록4 가 그리는 TOP 10. 지표를 받아온 콘텐츠만 들어간다. */
  const ranked = useMemo(() => rankItems(items, effectiveRank), [items, effectiveRank]);

  /**
   * "총 조회수" 타일이 읽는 값.
   *
   * 태그된 콘텐츠만 세면, 브랜드가 자기 릴스로 조회수를 쌓고 있어도(그 값은 브랜드
   * 토큰으로 확실히 받아온다) 타일은 '—' 만 보여 준다. 그래서 받은 것과 올린 것을
   * 합친 `allViews` 를 쓰고, 예전 판 응답에는 없는 값이라 `views` 로 물러난다.
   */
  const allViews = summary?.allViews ?? summary?.views;

  /**
   * 조회수가 비어 있을 때 그 이유를 타일에 적는다.
   *
   * "릴스가 아니면 조회수가 없습니다" 라고만 적던 때에는 사실도 아니었다 — 2025년
   * 4월 지표 개편 이후 `views` 는 사진·캐러셀에도 온다. 실제로 비는 이유는 둘 중
   * 하나다: 올린 계정이 우리 서비스에 연동돼 있지 않아 물어볼 토큰이 없거나, 올린
   * 직후라 아직 집계되지 않았거나.
   */
  const viewsTileNote = (() => {
    if (!allViews) return '';
    if (allViews.counted === 0) {
      if (fill && fill.noToken > 0) return '올린 계정의 연동이 없어 조회할 수 없습니다';
      if (fill && fill.candidates > 0) return '인스타그램이 아직 조회수를 주지 않았습니다';
      return '아직 집계된 조회수가 없습니다';
    }
    if (allViews.counted < allViews.of) return `조회수가 있는 ${allViews.counted}개 기준`;
    return '태그된 콘텐츠 + 브랜드 계정 게시물';
  })();

  /**
   * 지난달 대비 증감.
   *
   * 지난달이 0 이면 비율을 만들지 않는다 — 0 에서 늘어난 것을 "+100%" 로 적으면 첫
   * 달의 성과가 실제보다 대단해 보인다. 이때는 값만 보여 준다.
   */
  const delta = (now: number, before: number) => {
    if (before <= 0) return { diff: now, pct: null as number | null };
    return { diff: now - before, pct: Math.round(((now - before) / before) * 100) };
  };
  const viewsDelta = thisMonthRow && lastMonthRow
    ? delta(thisMonthRow.totalViews, lastMonthRow.totalViews)
    : null;
  const countDelta = thisMonthRow && lastMonthRow
    ? delta(thisMonthRow.totalCount, lastMonthRow.totalCount)
    : null;
  /**
   * 좋아요는 양쪽 달에 값이 하나라도 있을 때만 비교한다. 지난달 좋아요를 한 개도
   * 못 받은 달과 "좋아요가 0이던 달"은 다른 말이고, 후자로 읽히면 증감이 거짓이 된다.
   */
  const likesDelta =
    thisMonthRow && lastMonthRow && thisMonthRow.likesValued > 0 && lastMonthRow.likesValued > 0
      ? delta(thisMonthRow.totalLikes, lastMonthRow.totalLikes)
      : null;

  if (loading) {
    return (
      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        <div className="h-8 w-40 bg-slate-100 rounded-xl animate-pulse mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 md:h-28 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
        <div className="h-[260px] bg-slate-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  // 연동이 없거나 토큰이 죽은 경우. 여기서 연동을 새로 붙이지 않는다 — 브랜드 계정의
  // 연동 창구는 디엠 자동화 화면 하나뿐이어야 양쪽이 어긋나지 않는다.
  if (data?.connected === false) {
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <PageHeader igUsername={data?.igUsername} />
        <div className="bg-white border border-slate-100 rounded-2xl md:rounded-[1.5rem] px-6 py-10 text-center shadow-sm">
          <p className="text-3xl mb-3">🔗</p>
          <p className="text-sm md:text-base font-black text-slate-900 mb-1">
            {data?.needsReauth ? '인스타그램 연동을 다시 해주세요' : '인스타그램 계정을 연동해주세요'}
          </p>
          <p className="text-xs md:text-sm font-medium text-slate-500 leading-relaxed max-w-md mx-auto">
            {data?.error || 'DM 자동화 화면에서 계정을 연동하면 태그된 콘텐츠를 불러옵니다.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        igUsername={data?.igUsername}
        fetchedAt={data?.fetchedAt}
        refreshing={refreshing}
        onRefresh={() => load({ refresh: true })}
      />

      {data?.error && (
        <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3">
          <p className="text-[11px] md:text-xs font-bold text-rose-600">{data.error}</p>
        </div>
      )}

      {/* 블록1 · 브랜드 계정 추이 --------------------------------------- */}
      <AccountTrendBlock account={data?.account ?? null} igUsername={data?.igUsername} />

      {/* 블록2 · 태그 콘텐츠 요약 --------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4 mb-5 md:mb-8">
        <StatTile
          label="이번 달 태그된 콘텐츠"
          value={`${(summary?.monthCount ?? 0).toLocaleString()}개`}
          // 개수만 있으면 "이번 달이 어땠나"에 절반만 답한다. 같은 구간의 조회수를
          // 아래에 붙여 둔다 — 그래프의 지난달 대비 칸과 같은 값이다.
          note={
            summary?.monthAllViews && summary.monthAllViews.counted > 0
              ? `이번 달 조회수 ${compact(summary.monthAllViews.total)}`
              : ''
          }
        />
        <StatTile
          label="총 조회수"
          value={allViews && allViews.counted > 0 ? compact(allViews.total) : '—'}
          note={viewsTileNote}
        />
        <StatTile
          label="총 좋아요"
          value={summary && summary.likes.counted > 0 ? compact(summary.likes.total) : '—'}
          note={
            summary && summary.likes.counted > 0 && summary.likes.counted < summary.likes.of
              ? `좋아요 수가 공개된 ${summary.likes.counted}개 기준`
              : ''
          }
        />
        {/* 단위를 붙이지 않는다. "곳" 은 업체를 세는 말이라 인플루언서 계정 수에는
            맞지 않고, 옆 칸들과 자릿수만 어긋나 보인다. */}
        <StatTile label="태그한 계정" value={(summary?.authors ?? 0).toLocaleString()} />
      </div>

      {/* 블록3 · 월별 콘텐츠 성과 --------------------------------------- */}
      <section className="bg-white border border-slate-100 rounded-2xl md:rounded-[1.5rem] p-4 md:p-6 shadow-sm mb-5 md:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm md:text-lg font-black text-slate-900">월별 콘텐츠 성과</h3>
            <p className="text-[10px] md:text-xs font-bold text-slate-400 mt-0.5">
              최근 {CHART_MONTHS}개월 · 조회수 · 좋아요 · 댓글 · 콘텐츠 수
            </p>
            {/* 색이 무엇을 뜻하는지 그 자리에서 밝힌다. 세 그래프에서 같은 색은 같은
                대상이므로 범례도 한 번만 둔다. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
              <LegendDot color={C_TAGGED} label="태그된 콘텐츠" />
              <LegendDot color={C_OWN} label={`브랜드 계정(@${data?.igUsername || '우리 계정'})`} />
              <LegendDot color={C_NOW} label="이번 달" />
            </div>
          </div>

          {/* 지난달과의 차이. 그래프에서 눈으로 재는 대신 숫자로 한 번 더 적는다. */}
          {viewsDelta && countDelta && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 self-start shrink-0">
              <DeltaTile label="조회수" unit="회" now={thisMonthRow.totalViews} delta={viewsDelta} />
              {likesDelta && (
                <DeltaTile label="좋아요" unit="개" now={thisMonthRow.totalLikes} delta={likesDelta} />
              )}
              <DeltaTile label="콘텐츠 수" unit="개" now={thisMonthRow.totalCount} delta={countDelta} />
            </div>
          )}
        </div>

        {chartHasValue ? (
          <div className="space-y-4 md:space-y-5">
            {/* 조회수. 이 화면의 주된 값이라 가장 크게, 혼자 한 장을 쓴다. */}
            <ChartFrame title="조회수" note="태그된 콘텐츠 + 브랜드 계정 게시물">
              <ViewsChart
                rows={monthly}
                thisMonth={thisMonthRow?.month}
                lastViews={lastMonthRow?.totalViews}
              />
            </ChartFrame>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
              {/* 좋아요·댓글. 둘 다 '반응 수'라 같은 축에 둘 수 있다. */}
              {reactionHasValue && (
                <ChartFrame
                  title="좋아요 · 댓글"
                  note="값을 받아온 콘텐츠만"
                  legend={
                    <>
                      <LegendDot color={C_LIKES} label="좋아요" />
                      <LegendDot color={C_COMMENTS} label="댓글" />
                    </>
                  }
                >
                  <ReactionChart rows={monthly} thisMonth={thisMonthRow?.month} />
                </ChartFrame>
              )}
              {/* 콘텐츠 수. 조회수와 같은 색 규칙으로 쌓아 두 장을 나란히 읽게 한다. */}
              <ChartFrame title="콘텐츠 수" note="그 달에 잡힌 게시물 수">
                <CountChart rows={monthly} thisMonth={thisMonthRow?.month} />
              </ChartFrame>
            </div>
          </div>
        ) : (
          <div className="h-[180px] md:h-[220px] rounded-2xl bg-slate-50 flex flex-col items-center justify-center text-center px-6">
            <p className="text-sm font-black text-slate-900 mb-1">데이터 수집 중</p>
            <p className="text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed max-w-sm">
              최근 {CHART_MONTHS}개월 안에 우리 계정을 태그한 콘텐츠도, 브랜드 계정이 올린
              게시물도 아직 없습니다.
            </p>
          </div>
        )}

        <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-3">
          조회수 · 좋아요 · 댓글은 값을 받아온 콘텐츠만 더한 합계입니다.
          {viewsMissing
            ? ' 아직 조회수를 받은 콘텐츠가 없어 막대가 비어 있습니다.'
            : ''}
          {!reactionHasValue && chartHasValue
            ? ' 좋아요·댓글을 받아온 콘텐츠가 아직 없어 그 그래프는 표시하지 않습니다.'
            : ''}
          {lastMonthRow && lastMonthRow.totalViews > 0
            ? ` 점선은 지난달 조회수(${compact(lastMonthRow.totalViews)})입니다.`
            : ''}
        </p>
      </section>

      {/* 블록4 · TOP 10 태그된 콘텐츠 ----------------------------------- */}
      <section className="bg-white border border-slate-100 rounded-2xl md:rounded-[1.5rem] p-4 md:p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-sm md:text-lg font-black text-slate-900">TOP 10 태그된 콘텐츠</h3>
            <p className="text-[10px] md:text-xs font-bold text-slate-400 mt-0.5">
              {ranked.length > 0
                ? `${effectiveRank === 'views' ? '조회수' : '좋아요'}를 받아온 콘텐츠 ${
                    items.filter((m) => typeof m[effectiveRank] === 'number').length.toLocaleString()
                  }개 중 상위 ${ranked.length}개`
                : '성과가 가장 좋았던 콘텐츠'}
            </p>
          </div>
          {/* 무엇으로 줄 세울지. 값을 한 개도 못 받은 지표는 눌러도 순서가 바뀌지
              않으므로 잠근다. */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 shrink-0">
            <Chip active={effectiveRank === 'views'} disabled={viewsMissing} onClick={() => setRankBy('views')}>
              조회수순
            </Chip>
            <Chip active={effectiveRank === 'likes'} disabled={likesMissing} onClick={() => setRankBy('likes')}>
              좋아요순
            </Chip>
          </div>
        </div>

        {ranked.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-black text-slate-900 mb-1">
              {items.length === 0 ? '아직 태그된 콘텐츠가 없습니다' : '아직 순위를 만들 값이 없습니다'}
            </p>
            <p className="text-xs font-medium text-slate-400 leading-relaxed max-w-sm mx-auto">
              {items.length === 0
                ? `인플루언서가 게시물에 @${data?.igUsername || '우리 계정'} 을 언급하면 이 목록에 나타납니다.`
                : `${effectiveRank === 'views' ? '조회수' : '좋아요 수'}를 받아온 콘텐츠가 없어 순위를 매기지 않았습니다. 올린 계정의 연동이 없거나, 올린 직후라 아직 집계되지 않은 콘텐츠입니다.`}
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {ranked.map((m, i) => (
              <RankRow key={m.id || i} rank={i + 1} item={m} highlight={effectiveRank} />
            ))}
          </ol>
        )}

        {/* 전체 목록. TOP 10 만으로는 "그 사람이 올린 것만" 확인할 수 없으므로 접어서
            남겨 둔다. */}
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[11px] md:text-xs font-black text-slate-600 hover:bg-slate-50 active:scale-[0.99] transition-all"
          >
            {expanded ? '전체 목록 접기' : `전체 ${items.length.toLocaleString()}개 보기`}
          </button>
        )}

        {expanded && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs md:text-sm font-black text-slate-900">
                  태그된 콘텐츠 전체
                  <span className="ml-2 text-[11px] md:text-xs font-bold text-slate-400">
                    {filtered.length.toLocaleString()}개
                  </span>
                </h4>
                <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 shrink-0">
                  <Chip active={sort === 'recent'} onClick={() => setSort('recent')}>최신순</Chip>
                  <Chip active={sort === 'views'} disabled={viewsMissing} onClick={() => setSort('views')}>
                    조회수순
                  </Chip>
                  <Chip active={sort === 'likes'} disabled={likesMissing} onClick={() => setSort('likes')}>
                    좋아요순
                  </Chip>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="인플루언서 계정명으로 검색"
                    className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-2 text-xs md:text-sm font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-medium focus:outline-none focus:border-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setGrouped((v) => !v)}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] md:text-xs font-black transition-all ${
                    grouped
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  계정별로 묶어보기
                </button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm font-black text-slate-900 mb-1">
                  {query.trim() ? '검색 결과가 없습니다' : '표시할 콘텐츠가 없습니다'}
                </p>
                <p className="text-xs font-medium text-slate-400">
                  {query.trim()
                    ? `'${query.trim()}' 계정이 올린 콘텐츠는 목록에 없습니다.`
                    : `인플루언서가 게시물에 @${data?.igUsername || '우리 계정'} 을 언급하면 이 목록에 나타납니다.`}
                </p>
              </div>
            ) : grouped ? (
              <div className="space-y-6">
                {groups.map(([author, list]) => (
                  <div key={author}>
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-xs md:text-sm font-black text-slate-900">@{author}</p>
                      <span className="text-[10px] md:text-[11px] font-bold text-slate-400">
                        {list.length}개
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {list.map((m, i) => <TaggedCard key={m.id || `${author}-${i}`} item={m} />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                {sorted.map((m, i) => <TaggedCard key={m.id || i} item={m} />)}
              </div>
            )}
          </div>
        )}

        <CoverageNote data={data} />
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 조각들
// ---------------------------------------------------------------------------

const PageHeader: React.FC<{
  igUsername?: string;
  fetchedAt?: string;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
}> = ({ igUsername, fetchedAt, refreshing, onRefresh }) => (
  <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 md:mb-8">
    <div>
      <h2 className="text-base md:text-3xl font-black text-slate-900">인사이트</h2>
      <p className="text-slate-500 font-bold text-[10px] md:text-base mt-0.5">
        {igUsername
          ? `@${igUsername} 을 태그한 인플루언서 콘텐츠`
          : '우리 브랜드를 태그한 인플루언서 콘텐츠'}
      </p>
    </div>
    {onRefresh && (
      <div className="flex items-center gap-2 shrink-0">
        {fetchedAt && (
          <span className="text-[10px] md:text-[11px] font-bold text-slate-400 whitespace-nowrap">
            {agoText(fetchedAt)} 기준
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-xl border border-slate-200 bg-white text-slate-600 font-black text-[11px] md:text-xs px-3 py-2 hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {refreshing ? '불러오는 중' : '새로 불러오기'}
        </button>
      </div>
    )}
  </header>
);

const StatTile: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <div className="bg-white border border-slate-100 rounded-2xl md:rounded-[1.5rem] px-3 py-3 md:px-6 md:py-5 shadow-sm">
    <p className="text-[9px] md:text-[11px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
      {label}
    </p>
    <p className="text-lg md:text-3xl font-black mt-1 text-slate-900">{value}</p>
    {note ? (
      <p className="text-[9px] md:text-[10px] font-bold text-slate-400 mt-1 leading-snug">{note}</p>
    ) : null}
  </div>
);

/**
 * 블록1 · 브랜드 계정 추이.
 *
 * ── 왜 값이 없으면 블록을 지우는가 ──
 *
 * 인스타그램은 "지금 팔로워 몇 명"만 알려준다. 어제 몇 명이었는지는 우리가 매일
 * 남겨 둔 줄에서만 나오고, 그 줄이 하나뿐인 계정에는 증감이 존재하지 않는다. 그때
 * 0 을 적으면 "한 달째 그대로"라는 사실 주장이 되므로, 증감 칸만 "수집 중"으로 바꾼다.
 * 팔로워 수 자체를 못 받은 경우(연동 권한·토큰)에는 블록 전체를 그리지 않는다 —
 * '—' 세 개가 놓인 카드는 고장으로 읽힌다.
 *
 * 팔로잉을 함께 두는 이유 — 팔로워만 늘고 팔로잉도 같이 늘어난 계정은 맞팔로 부풀린
 * 것일 수 있다. 브랜드가 자기 계정을 볼 때는 그 둘을 나란히 보는 것이 정상이다.
 */
const AccountTrendBlock: React.FC<{
  account: NonNullable<TaggedMediaResponse['account']> | null;
  igUsername?: string;
}> = ({ account, igUsername }) => {
  if (!account || account.followers === null) return null;

  const delta = account.followerDelta;
  const days = account.followerDeltaDays;
  const up = typeof delta === 'number' && delta > 0;
  const flat = delta === 0;
  const deltaTone =
    delta === null ? 'text-slate-400' : flat ? 'text-slate-500' : up ? 'text-emerald-600' : 'text-rose-500';

  return (
    <section className="mb-5 md:mb-8">
      <div className="flex items-center gap-2 mb-2.5">
        <h3 className="text-sm md:text-lg font-black text-slate-900">브랜드 계정 추이</h3>
        <span className="text-[10px] md:text-xs font-bold text-slate-400 truncate">
          @{igUsername || '우리 계정'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5 md:gap-4">
        <StatTile label="팔로워" value={compact(account.followers)} note="오늘 기준" />
        <div className="bg-white border border-slate-100 rounded-2xl md:rounded-[1.5rem] px-3 py-3 md:px-6 md:py-5 shadow-sm">
          <p className="text-[9px] md:text-[11px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
            팔로워 증감
          </p>
          <p className={`text-lg md:text-3xl font-black mt-1 ${delta === null ? 'text-slate-300' : 'text-slate-900'}`}>
            {delta === null
              ? '수집 중'
              : flat
                ? '변동 없음'
                : `${up ? '+' : '−'}${compact(Math.abs(delta))}`}
          </p>
          <p className={`text-[9px] md:text-[10px] font-bold mt-1 leading-snug ${deltaTone}`}>
            {delta === null
              ? '하루에 한 번 팔로워 수를 기록합니다. 이틀치가 모이면 증감을 보여줍니다.'
              : `최근 ${days}일 동안`}
          </p>
        </div>
        <StatTile
          label="팔로잉"
          value={account.following === null ? '—' : compact(account.following)}
          note={account.following === null ? '값을 받지 못했습니다' : ''}
        />
      </div>
    </section>
  );
};

const Chip: React.FC<{
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, disabled, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`px-2.5 md:px-3 py-1.5 rounded-lg text-[11px] md:text-xs font-black transition-all ${
      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
    } ${disabled ? 'opacity-40 cursor-not-allowed hover:text-slate-400' : ''}`}
  >
    {children}
  </button>
);

/** 범례 점 하나. 쌓은 막대가 무엇으로 나뉘는지 그래프 위에서 밝힌다. */
const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="flex items-center gap-1.5 min-w-0">
    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
    <span className="text-[10px] md:text-[11px] font-bold text-slate-500 truncate">{label}</span>
  </span>
);

/**
 * 지난달 대비 한 칸.
 *
 * 값과 증감을 함께 적는다 — 증감만 적으면 "+120%" 가 2회에서 4회로 늘어난 것인지
 * 5만에서 11만으로 늘어난 것인지 알 수 없다. 지난달이 0 이라 비율을 만들 수 없을
 * 때는 비율 자리를 비워 둔다.
 */
const DeltaTile: React.FC<{
  label: string;
  unit: string;
  now: number;
  delta: { diff: number; pct: number | null };
}> = ({ label, unit, now, delta }) => {
  const up = delta.diff > 0;
  const flat = delta.diff === 0;
  const tone = flat ? 'text-slate-400' : up ? 'text-emerald-600' : 'text-rose-500';
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2 min-w-[104px]">
      <p className="text-[10px] font-black text-slate-400">이번 달 {label}</p>
      <p className="text-sm md:text-base font-black text-slate-900 leading-tight">
        {compact(now)}
        <span className="text-[10px] font-bold text-slate-400 ml-0.5">{unit}</span>
      </p>
      <p className={`text-[10px] font-black ${tone} mt-0.5`}>
        {flat ? '지난달과 같음' : `지난달 대비 ${up ? '+' : '−'}${compact(Math.abs(delta.diff))}${unit}`}
        {delta.pct !== null && !flat ? ` (${up ? '+' : ''}${delta.pct}%)` : ''}
      </p>
    </div>
  );
};

/**
 * 월별 그래프 세 장이 공유하는 것들.
 *
 * ── 왜 한 장이 아닌가 ──
 *
 * 조회수(수만 회)·좋아요(수천 개)·콘텐츠 수(수십 개)는 자릿수가 아예 다르다. 예전에는
 * 한 그래프에 축을 둘로 나눠 그렸는데(왼쪽 조회수, 오른쪽 콘텐츠 수), 축이 둘이면
 * 두 계열이 어디서 교차하는지가 축 눈금을 어떻게 잡았는지에 따라 달라진다 — 눈금
 * 선택이 "편 수는 줄었는데 조회수는 늘었다" 같은 판단을 만들어 낼 수 있다. 그래서
 * 축은 한 그래프에 하나만 두고, 자릿수가 다른 값은 그래프를 나눈다.
 *
 * 좋아요와 댓글은 예외다. 둘 다 '반응 수'라 단위가 같고, 같은 축에 두는 것이 오히려
 * 둘의 크기 차이를 그대로 보여 준다. 댓글이 낮게 깔리는 것은 눈금 문제가 아니라
 * 사실이다.
 *
 * ── 공통 규칙 ──
 *
 * x축(월)은 세 장이 같다. 색은 대상을 따라간다(진한 파랑 = 태그된 콘텐츠, 옅은 파랑 =
 * 브랜드 계정). 이번 달 막대만 색을 달리 칠한다 — 브랜드가 이 화면에서 확인하려는
 * 것은 6개월의 모양이 아니라 "지난달보다 나아졌는가" 하나다.
 */
type MonthlyRow = {
  month: string;
  count: number; views: number; valued: number;
  ownCount: number; ownViews: number; ownValued: number;
  totalCount: number; totalViews: number; totalValued: number;
  totalLikes: number; likesValued: number;
  totalComments: number; commentsValued: number;
};

/** 'YYYY-MM' → '9월'. 6개월 안에서는 연도를 적지 않아도 헷갈리지 않는다. */
const monthLabel = (key: string): string => {
  const m = key.match(/^(\d{4})-(\d{2})$/);
  return m ? `${Number(m[2])}월` : key;
};

/** 세 그래프가 같은 모양으로 쓰는 x축. */
const monthAxis = (
  <XAxis
    dataKey="month"
    tickFormatter={monthLabel}
    axisLine={false}
    tickLine={false}
    tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
    dy={8}
  />
);

/** 값 축. 눈금은 회색이다 — 축은 배경이고 읽어야 하는 것은 막대다. */
const valueAxis = (width: number) => (
  <YAxis
    axisLine={false}
    tickLine={false}
    tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
    tickFormatter={(v: number) => compact(v)}
    width={width}
    allowDecimals={false}
  />
);

const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
  fontSize: 12,
  fontWeight: 700,
} as const;

/**
 * 그래프 한 장을 감싸는 틀.
 *
 * 제목을 그래프 위에 두는 이유 — 축이 하나뿐인 그래프는 그 축이 무엇인지 제목으로만
 * 알 수 있다. 세 장이 나란히 있으므로 제목이 없으면 어느 그래프가 조회수인지 매번
 * 눈금 자릿수로 추측해야 한다.
 */
const ChartFrame: React.FC<{
  title: string;
  note?: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, note, legend, children }) => (
  <div className="rounded-2xl bg-slate-50/60 p-3 md:p-4">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-2">
      <p className="text-[11px] md:text-xs font-black text-slate-900">
        {title}
        {note ? <span className="ml-2 font-bold text-slate-400">{note}</span> : null}
      </p>
      {legend ? <div className="flex items-center gap-x-3">{legend}</div> : null}
    </div>
    {children}
  </div>
);

/**
 * 조회수 그래프. 태그된 콘텐츠와 브랜드 계정 게시물을 쌓는다.
 *
 * 미리 더해 하나로 그리면 그 달의 총량은 보이지만 "그중 얼마가 인플루언서에게서 온
 * 것인가" 가 사라진다. 태그된 쪽을 아래에 두는 이유는 이 화면의 주된 값이라 축에
 * 붙어 있어야 달마다 높이를 비교할 수 있기 때문이다.
 *
 * 지난달 조회수에는 점선을 하나 긋는다. 두 막대의 높이를 눈으로 재는 것보다 선
 * 위/아래로 보는 것이 빠르다.
 */
const ViewsChart: React.FC<{
  rows: MonthlyRow[];
  /** 이번 달 키(`YYYY-MM`). 이 칸만 다른 색으로 칠한다. */
  thisMonth?: string;
  /** 지난달 조회수. 점선 자리다. 없으면 선을 긋지 않는다. */
  lastViews?: number;
}> = ({ rows, thisMonth, lastViews }) => {
  const isNow = (key: string) => Boolean(thisMonth) && key === thisMonth;
  const seriesName: Record<string, string> = {
    views: '태그된 콘텐츠',
    ownViews: '브랜드 계정',
  };

  return (
    <div className="h-[200px] md:h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          {monthAxis}
          {valueAxis(44)}
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.10)' }}
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(raw) => `${monthLabel(String(raw ?? ''))}${isNow(String(raw ?? '')) ? ' (이번 달)' : ''}`}
            formatter={(value, _name, entry) => {
              const key = String(entry?.dataKey || '');
              return [`${Number(value ?? 0).toLocaleString()}회`, seriesName[key] || key];
            }}
          />

          {/* 지난달 조회수. 이번 달 막대가 이 선을 넘었는지가 이 화면의 질문이다. */}
          {typeof lastViews === 'number' && lastViews > 0 && (
            <ReferenceLine
              y={lastViews}
              stroke={C_NOW}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: '지난달',
                position: 'insideTopLeft',
                fontSize: 10,
                fontWeight: 800,
                fill: C_NOW,
              }}
            />
          )}

          <Bar dataKey="views" stackId="month" maxBarSize={44}>
            {rows.map((r) => (
              <Cell key={r.month} fill={isNow(r.month) ? C_NOW : C_TAGGED} />
            ))}
          </Bar>
          <Bar dataKey="ownViews" stackId="month" radius={[4, 4, 0, 0]} maxBarSize={44}>
            {rows.map((r) => (
              // 쌓인 두 층 사이에 흰 실선을 한 줄 둔다. 색만으로 나누면 값이 작은 층이
              // 아래 층에 붙어 한 막대처럼 읽힌다.
              <Cell key={r.month} fill={isNow(r.month) ? '#c4b5fd' : C_OWN} stroke="#ffffff" strokeWidth={2} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

/**
 * 좋아요·댓글 그래프.
 *
 * 두 계열을 나란히(쌓지 않고) 세운다 — 쌓으면 "좋아요 + 댓글" 이라는 합계가 생기는데
 * 그건 아무 뜻도 없는 숫자다.
 *
 * 태그된 것과 브랜드 계정 것을 나누지 않는다. 넷으로 쪼개면 작은 그래프 한 장에 계열이
 * 네 개가 되고, 댓글 쪽은 눈금 바닥에 붙어 아무것도 읽히지 않는다.
 */
const ReactionChart: React.FC<{ rows: MonthlyRow[]; thisMonth?: string }> = ({ rows, thisMonth }) => {
  const isNow = (key: string) => Boolean(thisMonth) && key === thisMonth;
  const seriesName: Record<string, string> = {
    totalLikes: '좋아요',
    totalComments: '댓글',
  };
  return (
    <div className="h-[170px] md:h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          {monthAxis}
          {valueAxis(40)}
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.10)' }}
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(raw) => `${monthLabel(String(raw ?? ''))}${isNow(String(raw ?? '')) ? ' (이번 달)' : ''}`}
            formatter={(value, _name, entry) => {
              const key = String(entry?.dataKey || '');
              return [`${Number(value ?? 0).toLocaleString()}개`, seriesName[key] || key];
            }}
          />
          <Bar dataKey="totalLikes" fill={C_LIKES} radius={[4, 4, 0, 0]} maxBarSize={18} />
          <Bar dataKey="totalComments" fill={C_COMMENTS} radius={[4, 4, 0, 0]} maxBarSize={18} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

/**
 * 콘텐츠 수 그래프.
 *
 * 조회수 그래프와 같은 색 규칙으로 쌓는다 — 같은 색이 같은 대상을 뜻하므로 두 장을
 * 나란히 두고 "편 수는 줄었는데 조회수는 늘었다" 를 그 자리에서 읽을 수 있다.
 */
const CountChart: React.FC<{ rows: MonthlyRow[]; thisMonth?: string }> = ({ rows, thisMonth }) => {
  const isNow = (key: string) => Boolean(thisMonth) && key === thisMonth;
  const seriesName: Record<string, string> = {
    count: '태그된 콘텐츠',
    ownCount: '브랜드 계정',
  };
  return (
    <div className="h-[170px] md:h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          {monthAxis}
          {valueAxis(28)}
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.10)' }}
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(raw) => `${monthLabel(String(raw ?? ''))}${isNow(String(raw ?? '')) ? ' (이번 달)' : ''}`}
            formatter={(value, _name, entry) => {
              const key = String(entry?.dataKey || '');
              return [`${Number(value ?? 0).toLocaleString()}개`, seriesName[key] || key];
            }}
          />
          <Bar dataKey="count" stackId="month" maxBarSize={28}>
            {rows.map((r) => (
              <Cell key={r.month} fill={isNow(r.month) ? C_NOW : C_TAGGED} />
            ))}
          </Bar>
          <Bar dataKey="ownCount" stackId="month" radius={[4, 4, 0, 0]} maxBarSize={28}>
            {rows.map((r) => (
              <Cell key={r.month} fill={isNow(r.month) ? '#c4b5fd' : C_OWN} stroke="#ffffff" strokeWidth={2} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

/** 썸네일 한 장. 인스타 CDN 주소는 만료되므로 실패하면 자리만 채운다. */
const Thumb: React.FC<{ src: string; className: string }> = ({ src, className }) => {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className={`${className} bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center`}>
        <span className="text-lg opacity-40">🎬</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className={`${className} object-cover bg-slate-100`}
    />
  );
};

/**
 * TOP 10 의 한 줄.
 *
 * 카드(격자)가 아니라 줄로 세우는 이유 — 순위는 위에서 아래로 읽는 것이고, 격자로
 * 놓으면 2위가 1위 오른쪽에 오는지 아래에 오는지가 화면 폭에 따라 달라진다.
 *
 * 줄 세운 기준 지표만 색을 진하게 둔다. 세 숫자가 같은 굵기로 놓이면 "무엇으로 1위인가"
 * 가 사라진다.
 */
const RankRow: React.FC<{ rank: number; item: TaggedMediaItem; highlight: RankKey }> = ({
  rank,
  item,
  highlight,
}) => {
  const body = (
    <div className="flex items-center gap-2.5 md:gap-3 rounded-2xl border border-slate-100 p-2.5 md:p-3 hover:border-slate-200 hover:shadow-sm transition-all">
      {/* 1~3위만 색을 준다. 10위까지 모두 강조하면 강조가 아니다. */}
      <span
        className={`shrink-0 w-6 h-6 md:w-7 md:h-7 rounded-lg flex items-center justify-center text-[11px] md:text-xs font-black ${
          rank <= 3 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {rank}
      </span>
      <Thumb src={item.thumbnailUrl} className="w-10 md:w-12 shrink-0 aspect-square rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-[11px] md:text-xs font-black text-slate-900 truncate">
            @{item.authorHandle || item.authorUsername || '알 수 없는 계정'}
          </p>
          {item.mediaType === 'REELS' && (
            <span className="shrink-0 text-[9px] font-black text-slate-400">릴스</span>
          )}
        </div>
        <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-0.5">
          {postedOn(item.timestamp)}
        </p>
      </div>
      <div className="shrink-0 grid grid-cols-3 gap-x-2.5 md:gap-x-4 text-right">
        <RankStat label="조회" value={compact(item.views)} strong={highlight === 'views'} />
        <RankStat label="좋아요" value={compact(item.likes)} strong={highlight === 'likes'} />
        <RankStat label="댓글" value={compact(item.comments)} strong={false} />
      </div>
    </div>
  );

  return (
    <li>
      {item.permalink ? (
        <a href={item.permalink} target="_blank" rel="noopener noreferrer" className="block">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
};

const RankStat: React.FC<{ label: string; value: string; strong: boolean }> = ({ label, value, strong }) => (
  <div>
    <p className="text-[9px] font-bold text-slate-400 whitespace-nowrap">{label}</p>
    <p className={`text-[11px] md:text-xs font-black ${strong ? 'text-slate-900' : 'text-slate-400'}`}>
      {value}
    </p>
  </div>
);

const TaggedCard: React.FC<{ item: TaggedMediaItem }> = ({ item }) => {
  const body = (
    <div className="flex gap-3 rounded-2xl border border-slate-100 p-3 hover:border-slate-200 hover:shadow-sm transition-all h-full">
      <Thumb src={item.thumbnailUrl} className="w-16 md:w-20 shrink-0 aspect-[9/16] rounded-xl" />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-[11px] md:text-xs font-black text-slate-900 truncate">
            @{item.authorHandle || item.authorUsername || '알 수 없는 계정'}
          </p>
          {item.mediaType === 'REELS' && (
            <span className="shrink-0 text-[9px] font-black text-slate-400">릴스</span>
          )}
        </div>
        <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-0.5">
          {postedOn(item.timestamp)}
        </p>
        {item.caption ? (
          <p className="text-[11px] md:text-xs font-medium text-slate-500 mt-1 line-clamp-2 break-words">
            {item.caption}
          </p>
        ) : null}
        <div className="grid grid-cols-3 gap-x-2 mt-auto pt-2">
          <MiniStat label="조회" value={compact(item.views)} />
          <MiniStat label="좋아요" value={compact(item.likes)} />
          <MiniStat label="댓글" value={compact(item.comments)} />
        </div>
      </div>
    </div>
  );

  return item.permalink ? (
    <a href={item.permalink} target="_blank" rel="noopener noreferrer" className="block">
      {body}
    </a>
  ) : (
    body
  );
};

const MiniStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[9px] font-bold text-slate-400 whitespace-nowrap">{label}</p>
    <p className="text-[11px] md:text-xs font-black text-slate-900">{value}</p>
  </div>
);

/**
 * 이 목록이 어디까지 덮는지.
 *
 * 목록에 없다는 것이 "그런 콘텐츠가 없다"로 읽히면 브랜드는 실제보다 적은 성과를
 * 근거로 판단하게 된다. 그래서 무엇을 기준으로 찾았는지 화면 아래에 그대로 적는다.
 */
const CoverageNote: React.FC<{ data: TaggedMediaResponse | null }> = ({ data }) => {
  if (!data) return null;
  const viaTags = data.tagsApi?.ok;
  const fill = data.viewsFill;
  return (
    <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3">
      <p className="text-[10px] md:text-[11px] font-bold text-slate-500 leading-relaxed">
        {viaTags
          ? '인스타그램에서 받은 태그된 미디어 목록과, 우리 서비스에 연동된 인플루언서의 최근 콘텐츠를 합쳐 보여줍니다.'
          : `우리 서비스에 연동된 인플루언서의 최근 콘텐츠에서 @${data.igUsername || ''} 언급을 찾아 보여줍니다. 연동하지 않은 계정이 태그한 게시물은 목록에 잡히지 않습니다.`}
        {typeof data.scannedCreators === 'number' && data.scannedCreators > 0
          ? ` (인플루언서 ${data.scannedCreators}명)`
          : ''}
      </p>
      <p className="text-[10px] md:text-[11px] font-bold text-slate-500 leading-relaxed mt-1">
        조회수는 목록을 불러올 때 콘텐츠를 올린 계정의 인스타그램 인사이트에서 함께
        받아옵니다. 그래서 올린 계정이 우리 서비스에 연동돼 있어야 값을 물어볼 수 있고,
        올린 직후라 아직 집계되지 않은 콘텐츠는 값이 비어 있습니다.
        {typeof data.ownItems?.length === 'number'
          ? ` 월별 콘텐츠 성과 그래프와 총 조회수에는 브랜드 계정이 올린 게시물 ${data.ownItems.length.toLocaleString()}개가 함께 반영됩니다. TOP 10 은 태그된 콘텐츠만 줄 세웁니다.`
          : ''}
      </p>
      {/* '—' 을 보고 기능이 고장 났다고 읽지 않도록, 이번 조회에서 무엇을 물어봤고
          무엇을 못 물어봤는지 그대로 적는다. */}
      {fill && fill.candidates > 0 && (
        <p className="text-[10px] md:text-[11px] font-bold text-slate-500 leading-relaxed mt-1">
          이번 조회에서 조회수가 비어 있던 {fill.candidates.toLocaleString()}개 중{' '}
          {((fill.fromCache || 0) + fill.filled).toLocaleString()}개를 채웠습니다.
          {(fill.fromCache || 0) > 0
            ? ` (${(fill.fromCache || 0).toLocaleString()}개는 인플루언서 성과 화면에서 이미 받아 둔 값)`
            : ''}
          {fill.noToken > 0
            ? ` ${fill.noToken.toLocaleString()}개는 올린 계정의 연동을 찾을 수 없어 조회할 수 없었습니다.`
            : ''}
          {fill.attempted > fill.filled
            ? ' 나머지는 인스타그램이 아직 조회수를 집계하지 않았거나, 연동 계정에 인사이트 권한이 없는 콘텐츠입니다.'
            : ''}
        </p>
      )}
      <p className="text-[10px] md:text-[11px] font-bold text-slate-400 leading-relaxed mt-1">
        도달·저장수는 다른 계정이 올린 게시물이라 조회할 수 없어 표시하지 않습니다.
        {typeof data.cacheTtlHours === 'number'
          ? ` 목록은 최대 ${data.cacheTtlHours}시간 동안 보관한 값을 보여주며, 새로 불러오기를 누르면 다시 조회합니다.`
          : ''}
      </p>
    </div>
  );
};

export default BusinessTaggedContent;
