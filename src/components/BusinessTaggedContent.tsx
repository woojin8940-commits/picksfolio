import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
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
 * 목록이 어디까지 덮는지는 화면 아래에 그대로 적는다. 메타의 tags 엣지(태그된 미디어
 * 목록)는 페이스북 로그인 방식 전용이어서 우리 토큰으로는 거부된다. 그래서 실제
 * 목록은 우리 서비스에 연동된 인플루언서들의 최근 콘텐츠에서 우리 계정 언급을 찾아
 * 만든다. 함께 일한 인플루언서의 콘텐츠는 대부분 여기 들어오지만, 연동하지 않은
 * 사람이 태그한 게시물은 잡히지 않는다 — 이걸 숨기면 목록에 없는 것이 "없다"로
 * 읽힌다.
 */

type SortKey = 'recent' | 'views';
type ChartMetric = 'count' | 'views';

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
  const [metric, setMetric] = useState<ChartMetric>('count');
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
  const summary = data?.summary;

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
   * 월별 묶음. 개수는 그 달에 실제로 잡힌 콘텐츠 수이므로 0 도 사실이지만,
   * 조회수 합계는 값이 있는 항목만 더한 값이다 — 몇 개를 근거로 냈는지 함께 들고
   * 다녀서 그래프 옆에 밝힌다.
   */
  const monthly = useMemo(() => {
    const keys = recentMonthKeys();
    const base = new Map(keys.map((k) => [k, { month: k, count: 0, views: 0, valued: 0 }]));
    for (const m of items) {
      const row = base.get(monthKey(m.timestamp));
      if (!row) continue;
      row.count += 1;
      if (typeof m.views === 'number') {
        row.views += m.views;
        row.valued += 1;
      }
    }
    return [...base.values()];
  }, [items]);

  const chartHasValue = monthly.some((r) => (metric === 'count' ? r.count > 0 : r.views > 0));
  const viewsMissing = items.length > 0 && items.every((m) => m.views === null);

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
        <StatTile label="이번 달 태그된 콘텐츠" value={`${(summary?.monthCount ?? 0).toLocaleString()}개`} />
        <StatTile
          label="총 조회수"
          value={summary && summary.views.counted > 0 ? compact(summary.views.total) : '—'}
          note={
            summary && summary.views.counted > 0 && summary.views.counted < summary.views.of
              ? `조회수가 있는 ${summary.views.counted}개 기준`
              : summary && summary.views.counted === 0
                ? '릴스가 아니면 조회수가 없습니다'
                : ''
          }
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
        <StatTile label="태그한 계정" value={`${(summary?.authors ?? 0).toLocaleString()}곳`} />
      </div>

      {/* 월별 추이 ------------------------------------------------------- */}
      <section className="bg-white border border-slate-100 rounded-2xl md:rounded-[1.5rem] p-4 md:p-6 shadow-sm mb-5 md:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm md:text-lg font-black text-slate-900">월별 태그된 콘텐츠</h3>
            <p className="text-[10px] md:text-xs font-bold text-slate-400 mt-0.5">
              최근 {CHART_MONTHS}개월
            </p>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 self-start">
            <Chip active={metric === 'count'} onClick={() => setMetric('count')}>콘텐츠 수</Chip>
            <Chip
              active={metric === 'views'}
              disabled={viewsMissing}
              onClick={() => setMetric('views')}
            >
              조회수
            </Chip>
          </div>
        </div>

        {chartHasValue ? (
          <MonthlyChart rows={monthly} metric={metric} />
        ) : (
          <div className="h-[180px] md:h-[220px] rounded-2xl bg-slate-50 flex flex-col items-center justify-center text-center px-6">
            <p className="text-sm font-black text-slate-900 mb-1">데이터 수집 중</p>
            <p className="text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed max-w-sm">
              {metric === 'views'
                ? '아직 조회수를 받은 릴스가 없습니다. 릴스가 아닌 게시물에는 조회수가 없습니다.'
                : `최근 ${CHART_MONTHS}개월 안에 우리 계정을 태그한 콘텐츠가 아직 없습니다.`}
            </p>
          </div>
        )}

        {metric === 'views' && (
          <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2">
            조회수는 릴스에만 있습니다. 값이 있는 콘텐츠만 더한 합계입니다.
          </p>
        )}
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

/**
 * 월별 막대 그래프.
 *
 * 한 계열만 그린다 — 콘텐츠 수와 조회수는 자릿수가 아예 달라서 한 축에 함께 두면
 * 콘텐츠 수 막대가 보이지 않는다. 축을 두 개 두는 대신 위에서 하나를 고르게 했다.
 * 축과 격자는 뒤로 물러나고, 값은 막대를 짚었을 때 나온다.
 */
const MonthlyChart: React.FC<{
  rows: { month: string; count: number; views: number; valued: number }[];
  metric: ChartMetric;
}> = ({ rows, metric }) => {
  const label = (key: string) => {
    const m = key.match(/^(\d{4})-(\d{2})$/);
    return m ? `${Number(m[2])}월` : key;
  };

  return (
    <div className="h-[200px] md:h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis
            dataKey="month"
            tickFormatter={label}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
            dy={8}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
            tickFormatter={(v: number) => compact(v)}
            width={44}
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
            labelFormatter={(raw) => label(String(raw ?? ''))}
            formatter={(value) => [
              metric === 'count'
                ? `${Number(value ?? 0).toLocaleString()}개`
                : `${Number(value ?? 0).toLocaleString()}회`,
              metric === 'count' ? '태그된 콘텐츠' : '조회수',
            ]}
          />
          <Bar
            dataKey={metric === 'count' ? 'count' : 'views'}
            fill="#2563eb"
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
          />
        </BarChart>
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
