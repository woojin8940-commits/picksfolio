import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, Cell, ReferenceLine,
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
 * 그래프는 조회수와 콘텐츠 수를 한 화면에 함께 그린다. 브랜드가 먼저 보는 값은
 * 조회수(성과)이고 콘텐츠 수는 그 성과가 몇 편에서 나왔는지를 읽는 분모다 — 둘을
 * 번갈아 봐야 하면 "이번 달은 편 수가 줄었는데 조회수가 늘었다" 같은 판단을 한
 * 화면에서 할 수 없다. 자릿수가 아예 다르므로 조회수는 막대(왼쪽 축), 콘텐츠 수는
 * 선(오른쪽 축)으로 나눠 둔다.
 *
 * 이번 달 막대는 색을 달리 칠하고 지난달 값에 점선을 하나 긋는다. 브랜드가 이 화면에서
 * 실제로 확인하려는 것은 6개월의 모양이 아니라 "지난달보다 나아졌는가" 하나다.
 *
 * 목록이 어디까지 덮는지는 화면 아래에 그대로 적는다. 메타의 tags 엣지(태그된 미디어
 * 목록)는 페이스북 로그인 방식 전용이어서 우리 토큰으로는 거부된다. 그래서 실제
 * 목록은 우리 서비스에 연동된 인플루언서들의 최근 콘텐츠에서 우리 계정 언급을 찾아
 * 만든다. 함께 일한 인플루언서의 콘텐츠는 대부분 여기 들어오지만, 연동하지 않은
 * 사람이 태그한 게시물은 잡히지 않는다 — 이걸 숨기면 목록에 없는 것이 "없다"로
 * 읽힌다.
 */

type SortKey = 'recent' | 'views';

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

const sortItems = (items: TaggedMediaItem[], key: SortKey): TaggedMediaItem[] => {
  const copy = [...items];
  if (key === 'views') {
    // 조회수가 없는 항목(사진 게시물 등)은 0 으로 세지 않고 뒤로 보낸다. 0 으로
    // 섞으면 "조회수 0인 콘텐츠"처럼 보인다.
    return copy.sort((a, b) => {
      if (a.views === null && b.views === null) {
        return Date.parse(b.timestamp || '') - Date.parse(a.timestamp || '');
      }
      if (a.views === null) return 1;
      if (b.views === null) return -1;
      return b.views - a.views;
    });
  }
  return copy.sort((a, b) => Date.parse(b.timestamp || '') - Date.parse(a.timestamp || ''));
};

const BusinessTaggedContent: React.FC<{ businessUsername: string }> = ({ businessUsername }) => {
  const [data, setData] = useState<TaggedMediaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<SortKey>('recent');
  const [query, setQuery] = useState('');
  const [grouped, setGrouped] = useState(false);

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
          // 선(콘텐츠 수)과 점선(지난달 조회수)이 읽는 합계. 쌓은 막대의 총합이라
          // 그래프가 다시 더하지 않도록 여기서 한 번만 만든다.
          totalCount: 0, totalViews: 0, totalValued: 0,
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

      {/* 요약 숫자 ------------------------------------------------------- */}
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

      {/* 월별 추이 ------------------------------------------------------- */}
      <section className="bg-white border border-slate-100 rounded-2xl md:rounded-[1.5rem] p-4 md:p-6 shadow-sm mb-5 md:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm md:text-lg font-black text-slate-900">월별 콘텐츠</h3>
            <p className="text-[10px] md:text-xs font-bold text-slate-400 mt-0.5">
              최근 {CHART_MONTHS}개월 · 조회수(막대)와 콘텐츠 수(선)를 함께 봅니다
            </p>
            {/* 막대는 두 색으로 쌓이고 선이 하나 더 지나가므로, 어느 것이 무엇인지
                그 자리에서 밝힌다. 이번 달은 색이 달라 따로 적어 준다. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
              <LegendDot color="#2563eb" label="태그된 콘텐츠 조회수" />
              <LegendDot color="#93c5fd" label={`브랜드 계정 조회수(@${data?.igUsername || '우리 계정'})`} />
              <LegendDot color="#f59e0b" label="콘텐츠 수" />
              <LegendDot color="#7c3aed" label="이번 달" />
            </div>
          </div>

          {/* 지난달과의 차이. 그래프에서 눈으로 재는 대신 숫자로 한 번 더 적는다. */}
          {viewsDelta && countDelta && (
            <div className="grid grid-cols-2 gap-2 sm:gap-3 self-start shrink-0">
              <DeltaTile label="조회수" unit="회" now={thisMonthRow.totalViews} delta={viewsDelta} />
              <DeltaTile label="콘텐츠 수" unit="개" now={thisMonthRow.totalCount} delta={countDelta} />
            </div>
          )}
        </div>

        {chartHasValue ? (
          <MonthlyChart rows={monthly} thisMonth={thisMonthRow?.month} lastViews={lastMonthRow?.totalViews} />
        ) : (
          <div className="h-[180px] md:h-[220px] rounded-2xl bg-slate-50 flex flex-col items-center justify-center text-center px-6">
            <p className="text-sm font-black text-slate-900 mb-1">데이터 수집 중</p>
            <p className="text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed max-w-sm">
              최근 {CHART_MONTHS}개월 안에 우리 계정을 태그한 콘텐츠도, 브랜드 계정이 올린
              게시물도 아직 없습니다.
            </p>
          </div>
        )}

        <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2">
          조회수는 값을 받아온 콘텐츠만 더한 합계입니다.
          {viewsMissing
            ? ' 아직 조회수를 받은 콘텐츠가 없어 막대가 비어 있습니다.'
            : ''}
          {lastMonthRow && lastMonthRow.totalViews > 0
            ? ` 점선은 지난달 조회수(${compact(lastMonthRow.totalViews)})입니다.`
            : ''}
        </p>
      </section>

      {/* 목록 ------------------------------------------------------------ */}
      <section className="bg-white border border-slate-100 rounded-2xl md:rounded-[1.5rem] p-4 md:p-6 shadow-sm">
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm md:text-lg font-black text-slate-900">
              태그된 콘텐츠
              <span className="ml-2 text-[11px] md:text-xs font-bold text-slate-400">
                {filtered.length.toLocaleString()}개
              </span>
            </h3>
            <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 shrink-0">
              <Chip active={sort === 'recent'} onClick={() => setSort('recent')}>최신순</Chip>
              <Chip active={sort === 'views'} disabled={viewsMissing} onClick={() => setSort('views')}>
                조회수순
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
          <div className="py-12 text-center">
            <p className="text-sm font-black text-slate-900 mb-1">
              {query.trim()
                ? '검색 결과가 없습니다'
                : items.length === 0
                  ? '아직 태그된 콘텐츠가 없습니다'
                  : '표시할 콘텐츠가 없습니다'}
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
 * 월별 그래프. 조회수와 콘텐츠 수를 한 화면에 함께 그린다.
 *
 * 두 값은 자릿수가 아예 다르다(조회수 수만 회 vs 콘텐츠 수 수십 개). 그래서 한 축에
 * 같이 두면 콘텐츠 수 막대는 바닥에 붙어 보이지 않는다. 축을 둘로 나눠 조회수는
 * 막대(왼쪽 축), 콘텐츠 수는 선(오른쪽 축)으로 그린다 — 위에서 하나만 고르게 하던
 * 때에는 브랜드가 두 값을 번갈아 눌러 가며 머릿속에서 맞춰 봐야 했다.
 *
 * 조회수 막대 안에서는 태그된 콘텐츠와 브랜드 계정 게시물을 쌓는다. 미리 더해 하나로
 * 그리면 그 달의 총량은 보이지만 "그중 얼마가 인플루언서에게서 온 것인가" 가 사라진다.
 *
 * 이번 달 막대는 색을 달리 칠하고, 지난달 조회수에 점선을 하나 긋는다. 두 막대의
 * 높이를 눈으로 재는 것보다 선 위/아래로 보는 것이 빠르다.
 */
type MonthlyRow = {
  month: string;
  count: number; views: number; valued: number;
  ownCount: number; ownViews: number; ownValued: number;
  totalCount: number; totalViews: number; totalValued: number;
};

const MonthlyChart: React.FC<{
  rows: MonthlyRow[];
  /** 이번 달 키(`YYYY-MM`). 이 칸만 다른 색으로 칠한다. */
  thisMonth?: string;
  /** 지난달 조회수. 점선 자리다. 없으면 선을 긋지 않는다. */
  lastViews?: number;
}> = ({ rows, thisMonth, lastViews }) => {
  const label = (key: string) => {
    const m = key.match(/^(\d{4})-(\d{2})$/);
    return m ? `${Number(m[2])}월` : key;
  };
  const isNow = (key: string) => Boolean(thisMonth) && key === thisMonth;

  /** 계열 이름. 툴팁이 dataKey 를 그대로 보여 주면 영문 필드명이 노출된다. */
  const seriesName: Record<string, string> = {
    views: '태그된 콘텐츠 조회수',
    ownViews: '브랜드 계정 조회수',
    totalCount: '콘텐츠 수',
  };

  return (
    <div className="h-[220px] md:h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis
            dataKey="month"
            tickFormatter={label}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
            dy={8}
          />
          {/* 왼쪽 = 조회수. */}
          <YAxis
            yAxisId="views"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
            tickFormatter={(v: number) => compact(v)}
            width={44}
            allowDecimals={false}
          />
          {/* 오른쪽 = 콘텐츠 수. 눈금 색을 선 색에 맞춰 어느 축이 선의 축인지 보이게 한다. */}
          <YAxis
            yAxisId="count"
            orientation="right"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fontWeight: 700, fill: '#f59e0b' }}
            width={32}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.10)' }}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
              fontSize: 12,
              fontWeight: 700,
            }}
            labelFormatter={(raw) => `${label(String(raw ?? ''))}${isNow(String(raw ?? '')) ? ' (이번 달)' : ''}`}
            formatter={(value, _name, entry) => {
              const key = String(entry?.dataKey || '');
              return [
                key === 'totalCount'
                  ? `${Number(value ?? 0).toLocaleString()}개`
                  : `${Number(value ?? 0).toLocaleString()}회`,
                seriesName[key] || key,
              ];
            }}
          />

          {/* 지난달 조회수. 이번 달 막대가 이 선을 넘었는지가 이 화면의 질문이다. */}
          {typeof lastViews === 'number' && lastViews > 0 && (
            <ReferenceLine
              yAxisId="views"
              y={lastViews}
              stroke="#7c3aed"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: '지난달',
                position: 'insideTopLeft',
                fontSize: 10,
                fontWeight: 800,
                fill: '#7c3aed',
              }}
            />
          )}

          {/* 태그된 콘텐츠를 아래에 둔다 — 이 화면의 주된 값이라 축에 붙어 있어야
              달마다 높이를 비교할 수 있다. */}
          <Bar yAxisId="views" dataKey="views" stackId="month" maxBarSize={44}>
            {rows.map((r) => (
              <Cell key={r.month} fill={isNow(r.month) ? '#7c3aed' : '#2563eb'} />
            ))}
          </Bar>
          <Bar
            yAxisId="views"
            dataKey="ownViews"
            stackId="month"
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
          >
            {rows.map((r) => (
              <Cell key={r.month} fill={isNow(r.month) ? '#c4b5fd' : '#93c5fd'} />
            ))}
          </Bar>

          {/* 콘텐츠 수. 막대 위를 지나가므로 점을 남겨 어느 달의 값인지 짚을 수 있게 한다. */}
          <Line
            yAxisId="count"
            type="monotone"
            dataKey="totalCount"
            stroke="#f59e0b"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#f59e0b', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
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
          ? ` 월별 콘텐츠 그래프와 총 조회수에는 브랜드 계정이 올린 게시물 ${data.ownItems.length.toLocaleString()}개가 함께 반영됩니다.`
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
