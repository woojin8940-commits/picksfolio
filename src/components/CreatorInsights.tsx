import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  apiService,
  type CreatorInsightsResponse,
  type FollowerSeriesResponse,
  type InsightReel,
} from '../services/apiService';
import { useLanguage } from '../contexts/LanguageContext';
import { buildReelCoaching, MIN_REELS } from '../utils/reelCoaching';

/**
 * 인사이트 — 인플루언서 본인이 자기 계정 성과를 보는 화면.
 *
 * 이 화면은 새 연동을 만들지 않는다. 캠페인 등록에서 붙여 둔 계정(없으면 디엠
 * 자동화에 붙여 둔 계정)의 토큰으로 조회만 한다. 그래서 화면 어디에도 "연동
 * 설정"은 없고, 아직 연동이 없을 때만 기존 연동 흐름으로 내보내는 버튼이 하나 있다.
 *
 * 릴스 데이터는 서버가 계정별로 굳혀 둔다(기본 30분). 새로고침할 때마다 메타를
 * 다시 부르면 사람 한 명이 시간당 호출 한도를 혼자 태우기 때문이다. 그래서 화면은
 * "언제 기준 숫자인지"를 항상 함께 적고, 지금 값을 받고 싶은 사람에게만 버튼을 준다.
 *
 * 기본 정렬은 저장수순이다. 조회수는 인스타그램이 밀어 준 결과에 가깝고, 저장은
 * 본 사람이 "다시 보겠다"고 누른 것이라 다음 편을 만들 때 참고할 값에 더 가깝다.
 * 다만 저장수는 인사이트 권한이 통했을 때만 내려온다 — 못 받은 계정에서는 조회수를
 * 기준으로 내려앉고, 화면은 그 사실을 숨기지 않는다.
 */

type SortKey = 'saved' | 'views' | 'recent';
type RangeDays = 7 | 30 | 90;

const RANGES: RangeDays[] = [7, 30, 90];

/** 큰 숫자는 만·억 단위로 접는다. 카드 안에서 자리를 다투지 않게. */
const compact = (n: number | null | undefined): string => {
  if (n === null || typeof n === 'undefined' || !Number.isFinite(n)) return '—';
  if (n < 0) return '—';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}만`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}천`;
  return n.toLocaleString();
};

/** 지표 한 칸. 못 받은 값은 0 이 아니라 '—' 다. */
const metricText = (value: number | null): string =>
  value === null ? '—' : compact(value);

/** '2026-08-30' → '08.30' */
const shortDate = (iso: string): string => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}.${m[3]}` : String(iso || '');
};

/** 게시일. 한국 시간 기준으로 'YYYY.MM.DD' 까지만. */
const postedOn = (iso: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    .replace(/-/g, '.');
};

/** '3분 전' 같은 상대 시각. 캐시된 값이 언제 기준인지 밝히는 데 쓴다. */
const agoText = (iso: string | undefined, isEn: boolean): string => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return isEn ? 'just now' : '방금';
  if (mins < 60) return isEn ? `${mins} min ago` : `${mins}분 전`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return isEn ? `${hours}h ago` : `${hours}시간 전`;
  return isEn ? `${Math.round(hours / 24)}d ago` : `${Math.round(hours / 24)}일 전`;
};

const sortReels = (reels: InsightReel[], key: SortKey): InsightReel[] => {
  const copy = [...reels];
  if (key === 'recent') {
    return copy.sort((a, b) => Date.parse(b.timestamp || '') - Date.parse(a.timestamp || ''));
  }
  if (key === 'views') return copy.sort((a, b) => b.views - a.views);
  return copy.sort((a, b) => (b.saved ?? 0) - (a.saved ?? 0));
};

const CreatorInsights: React.FC<{ userName: string }> = ({ userName }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

  const [data, setData] = useState<CreatorInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [series, setSeries] = useState<FollowerSeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [range, setRange] = useState<RangeDays>(7);
  const [sort, setSort] = useState<SortKey>('saved');
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<string>('');

  /**
   * 인사이트 응답이 도착한 시각.
   *
   * 추이 그래프는 이 값이 바뀐 뒤에 읽는다. 두 요청을 동시에 보내면 그래프 쪽이 먼저
   * 도착하는데, 오늘자 팔로워 점을 남기는 것은 인사이트 쪽 요청이다 — 순서가 뒤집히면
   * 처음 화면을 연 사람은 점이 하나도 없는 "수집 중" 화면을 보게 된다.
   */
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(
    async (opts: { refresh?: boolean } = {}) => {
      if (!userName) return;
      if (opts.refresh) setRefreshing(true);
      else setLoading(true);
      const res = await apiService.getCreatorInsights(userName, { refresh: opts.refresh });
      setData(res);
      setLoading(false);
      setRefreshing(false);
      setLoadedAt(Date.now());
    },
    [userName],
  );

  const loadSeries = useCallback(
    async (days: RangeDays) => {
      if (!userName) return;
      setSeriesLoading(true);
      const res = await apiService.getCreatorFollowerSeries(userName, days);
      setSeries(res);
      setSeriesLoading(false);
    },
    [userName],
  );

  useEffect(() => { load(); }, [load]);
  // 오늘자 점이 남은 뒤에 읽는다(loadedAt 주석 참고). 기간을 바꾸면 그때 다시 읽는다.
  useEffect(() => {
    if (!loadedAt) return;
    loadSeries(range);
  }, [loadSeries, range, loadedAt]);

  // 연동 콜백에서 돌아온 경우. 결과를 한 줄로 알리고 주소창의 표식은 지운다 —
  // 남겨 두면 다음 새로고침 때도 이 화면으로 끌려온다. 디엠 자동화 화면이 쓰는
  // 파라미터와 이름이 같아도, 그 화면의 처리 로직은 건드리지 않고 여기서 우리
  // 흐름으로 돌아온 경우(ig_insights)만 정리한다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('ig_insights')) return;
    const failed = params.get('ig_error');
    setNotice(
      failed
        ? (isEn ? 'Instagram connection failed. Please try again.' : '인스타그램 연동에 실패했습니다. 다시 시도해 주세요.')
        : '',
    );
    ['ig_insights', 'ig_connected', 'ig_error'].forEach(k => params.delete(k));
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
    );
  }, [isEn]);

  const reels = data?.reels || [];
  // 저장수를 못 받는 계정에서 저장수순으로 정렬하면 순서가 사실 아무 의미가 없다.
  // 그런 계정의 기본값은 조회수순으로 내려앉는다.
  const savedUsable = Boolean(data?.insightsAvailable);
  const effectiveSort: SortKey = sort === 'saved' && !savedUsable ? 'views' : sort;

  const sorted = useMemo(() => sortReels(reels, effectiveSort), [reels, effectiveSort]);
  // 하이라이트 기준도 같다 — 저장수를 못 받으면 조회수로 고른다.
  const top5 = useMemo(
    () => sortReels(reels, savedUsable ? 'saved' : 'views').slice(0, 5),
    [reels, savedUsable],
  );
  const coaching = useMemo(() => buildReelCoaching(reels, isEn), [reels, isEn]);

  const startConnect = async () => {
    setConnecting(true);
    setNotice('');
    // 기존 연동 흐름을 그대로 쓴다(purpose:'collab'). 돌아올 곳만 이 화면으로 표시해 둔다.
    const returnTo = `${window.location.pathname}?ig_insights=1`;
    const res = await apiService.instagramConnectUrl(userName, returnTo, 'collab');
    if (!res.url) {
      setConnecting(false);
      setNotice(res.error || (isEn ? 'Could not start the connection.' : '연동을 시작하지 못했습니다.'));
      return;
    }
    window.location.href = res.url;
  };

  // ---------------------------------------------------------------- 로딩
  if (loading) {
    return (
      <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
        <Header isEn={isEn} />
        <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-20 md:h-28 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
        <div className="h-56 rounded-[1.5rem] bg-slate-100 animate-pulse mb-6" />
        <div className="h-72 rounded-[1.5rem] bg-slate-100 animate-pulse" />
      </div>
    );
  }

  // ------------------------------------------------------- 연동이 없는 경우
  if (data && data.connected === false) {
    return (
      <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
        <Header isEn={isEn} />
        <div className="bg-white border border-slate-100 rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-10 shadow-sm max-w-2xl">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-2xl mb-4">📊</div>
          <h3 className="text-base md:text-xl font-black text-slate-900 mb-2">
            {data.needsReauth
              ? (isEn ? 'Reconnect your Instagram account' : '인스타그램 계정을 다시 연동해 주세요')
              : (isEn ? 'Connect your Instagram account' : '인스타그램 계정을 연동해 주세요')}
          </h3>
          <p className="text-xs md:text-sm text-slate-500 font-medium leading-relaxed mb-6">
            {data.error ||
              (isEn
                ? 'Once connected, your follower count and reel performance appear here.'
                : '연동하면 팔로워 수와 릴스별 조회수·도달·저장수를 이 화면에서 볼 수 있어요.')}
          </p>
          <button
            type="button"
            onClick={startConnect}
            disabled={connecting}
            className="rounded-xl bg-slate-900 text-white font-black text-xs md:text-sm px-5 py-3 hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {connecting
              ? (isEn ? 'Opening…' : '연동 창을 여는 중')
              : data.needsReauth
                ? (isEn ? 'Reconnect' : '다시 연동하기')
                : (isEn ? 'Connect Instagram' : '인스타그램 연동하기')}
          </button>
          {notice && <p className="text-[11px] font-bold text-rose-600 mt-3">{notice}</p>}
        </div>
      </div>
    );
  }

  const delta = data?.followerDelta7d;
  const deltaDays = data?.followerDeltaDays || 0;

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <Header
        isEn={isEn}
        igUsername={data?.igUsername}
        fetchedAt={data?.fetchedAt}
        refreshing={refreshing}
        // 강제 조회는 오늘자 스냅샷도 함께 남긴다. 그래프는 응답이 도착한 뒤에
        // (loadedAt 이 바뀌면서) 다시 읽히므로 여기서 따로 부르지 않는다.
        onRefresh={() => load({ refresh: true })}
      />

      {(notice || data?.error) && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[11px] md:text-xs font-bold text-amber-800 leading-relaxed">{notice || data?.error}</p>
        </div>
      )}

      {/* --------------------------------------------------- 계정 요약 카드 */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-5 md:mb-6">
        <StatTile
          label={isEn ? 'Followers' : '팔로워'}
          value={compact(data?.followers ?? null)}
        />
        <StatTile
          label={isEn ? 'Following' : '팔로잉'}
          value={compact(data?.following ?? null)}
        />
        {/* 스냅샷이 이틀치 미만이면 증감은 아직 말할 수 없는 값이다. 0 으로 적으면
            "일주일째 그대로"로 읽히므로 수집 중이라고 적는다. */}
        {typeof delta === 'number' ? (
          <StatTile
            label={
              deltaDays >= 7
                ? (isEn ? 'Last 7 days' : '최근 7일 증감')
                : (isEn ? `Last ${deltaDays} days` : `최근 ${deltaDays}일 증감`)
            }
            value={`${delta > 0 ? '+' : delta < 0 ? '−' : ''}${compact(Math.abs(delta))}`}
            tone={delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}
          />
        ) : (
          <StatTile
            label={isEn ? 'Last 7 days' : '최근 7일 증감'}
            value={isEn ? 'Collecting' : '수집 중'}
            muted
          />
        )}
      </div>

      {/* ----------------------------------------------- 팔로워 증감 추이 */}
      <section className="bg-white border border-slate-100 rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-8 shadow-sm mb-5 md:mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 md:mb-6">
          <div>
            <h3 className="text-sm md:text-lg font-black text-slate-900">
              {isEn ? 'Follower trend' : '팔로워 증감 추이'}
            </h3>
            <p className="text-[10px] md:text-xs text-slate-400 font-bold mt-0.5">
              {isEn ? 'One snapshot per day (KST)' : '하루 한 번 기록한 값 (한국 시간 기준)'}
            </p>
          </div>
          <div className="flex gap-1 bg-slate-50 rounded-xl p-1">
            {RANGES.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setRange(d)}
                className={`px-3 py-1.5 rounded-lg text-[11px] md:text-xs font-black transition-all ${
                  range === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {isEn ? `${d}d` : `${d}일`}
              </button>
            ))}
          </div>
        </div>

        <FollowerChart series={series} loading={seriesLoading} range={range} isEn={isEn} />
      </section>

      {/* ------------------------------------------------- 콘텐츠 코칭 */}
      {coaching.visible && (
        <section className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-8 shadow-lg mb-5 md:mb-6">
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-2">
            {isEn ? 'Content coaching' : '콘텐츠 코칭'}
          </p>
          <ul className="space-y-1.5">
            {coaching.lines.map((line, i) => (
              <li key={i} className="text-sm md:text-lg font-black leading-relaxed">{line}</li>
            ))}
          </ul>
          <p className="text-[10px] md:text-[11px] font-bold opacity-60 mt-3">
            {isEn
              ? `Based on your top ${coaching.sampled} reels by ${coaching.metric}.`
              : `${coaching.metric === 'saved' ? '저장수' : coaching.metric === 'reach' ? '도달' : '조회수'} 상위 릴스 ${coaching.sampled}편의 공통점입니다.`}
          </p>
        </section>
      )}

      {/* --------------------------------------------- 가장 반응 좋은 릴스 */}
      {top5.length > 0 && (
        <section className="mb-5 md:mb-6">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h3 className="text-sm md:text-lg font-black text-slate-900">
              {isEn ? 'Top 5 reels' : '가장 반응 좋은 릴스 TOP 5'}
            </h3>
            <span className="text-[10px] md:text-xs font-bold text-slate-400 shrink-0">
              {savedUsable
                ? (isEn ? 'by saves' : '저장수 기준')
                : (isEn ? 'by views' : '조회수 기준')}
            </span>
          </div>
          {/* 다섯 편은 순위가 보여야 의미가 있다. 좁은 화면에서는 옆으로 흐르게 둔다.
              넓은 화면에서 5칸이 본문 폭을 다 쓰면 카드(9:16)가 지나치게 커지므로
              max-w 로 살짝 줄여 다른 섹션과 크기 균형을 맞춘다. */}
          <div className="flex gap-2.5 md:gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-5 md:max-w-[52rem]">
            {top5.map((reel, i) => (
              <TopReelCard key={reel.id || i} reel={reel} rank={i + 1} isEn={isEn} savedUsable={savedUsable} />
            ))}
          </div>
        </section>
      )}

      {/* ----------------------------------------------------- 릴스 목록 */}
      <section className="bg-white border border-slate-100 rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 md:mb-6">
          <div>
            <h3 className="text-sm md:text-lg font-black text-slate-900">
              {isEn ? 'Recent reels' : '최근 릴스'}
            </h3>
            <p className="text-[10px] md:text-xs text-slate-400 font-bold mt-0.5">
              {isEn ? `${reels.length} reels` : `총 ${reels.length}편`}
            </p>
          </div>
          <div className="flex gap-1 bg-slate-50 rounded-xl p-1">
            <SortChip active={effectiveSort === 'saved'} onClick={() => setSort('saved')} disabled={!savedUsable}>
              {isEn ? 'Saves' : '저장수순'}
            </SortChip>
            <SortChip active={effectiveSort === 'views'} onClick={() => setSort('views')}>
              {isEn ? 'Views' : '조회수순'}
            </SortChip>
            <SortChip active={effectiveSort === 'recent'} onClick={() => setSort('recent')}>
              {isEn ? 'Newest' : '최신순'}
            </SortChip>
          </div>
        </div>

        {/* 도달·저장수가 비어 있을 때. 숫자가 안 보이는 이유를 화면이 말한다.
            권한 승인 전에 연동한 계정이면 재연동 버튼까지 함께 준다 — 토큰 갱신으로는
            권한 범위가 늘지 않아서, 사람이 동의 화면을 한 번 더 지나야 값이 온다. */}
        {reels.length > 0 && !savedUsable && (
          <div className="mb-4 rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-[11px] md:text-xs font-bold text-slate-500 leading-relaxed">
              {data?.reconnectForInsights
                ? (isEn
                    ? 'This account was connected before insights access was approved, so reach and saves are missing. Reconnect once and they will load from then on.'
                    : '인사이트 권한이 승인되기 전에 연동한 계정이라 도달·저장수가 비어 있습니다. 한 번만 다시 연동하면 이후로는 함께 불러옵니다.')
                : (isEn
                    ? 'Reach and saves are not available for this account yet — reconnect and allow insights access to see them.'
                    : '도달·저장수를 아직 받지 못했습니다. 계정을 다시 연동해 인사이트 접근을 허용하면 함께 보입니다.')}
            </p>
            <button
              type="button"
              onClick={startConnect}
              disabled={connecting}
              className="mt-2 rounded-xl bg-slate-900 text-white font-black text-[11px] md:text-xs px-4 py-2 hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {connecting
                ? (isEn ? 'Opening…' : '연동 창을 여는 중')
                : (isEn ? 'Reconnect' : '다시 연동하기')}
            </button>
          </div>
        )}

        {reels.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-black text-slate-900 mb-1">
              {isEn ? 'No reels yet' : '아직 릴스가 없습니다'}
            </p>
            <p className="text-xs font-medium text-slate-400">
              {isEn
                ? 'Post a reel on Instagram and it will show up here.'
                : '인스타그램에 릴스를 올리면 이 목록에 나타납니다.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
            {sorted.map((reel, i) => (
              <ReelCard key={reel.id || i} reel={reel} isEn={isEn} />
            ))}
          </div>
        )}

        {reels.length > 0 && reels.length < MIN_REELS && (
          <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-4">
            {isEn
              ? `Content coaching appears once you have ${MIN_REELS} reels.`
              : `릴스가 ${MIN_REELS}편 이상 쌓이면 콘텐츠 코칭이 함께 표시됩니다.`}
          </p>
        )}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 조각들
// ---------------------------------------------------------------------------

const Header: React.FC<{
  isEn: boolean;
  igUsername?: string;
  fetchedAt?: string;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
}> = ({ isEn, igUsername, fetchedAt, refreshing, onRefresh }) => (
  <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 md:mb-8">
    <div>
      <h2 className="text-base md:text-3xl font-black text-slate-900">
        {isEn ? 'Insights' : '인사이트'}
      </h2>
      <p className="text-slate-500 font-bold text-[10px] md:text-base mt-0.5">
        {igUsername
          ? (isEn ? `@${igUsername} · reel performance` : `@${igUsername} 계정의 릴스 성과`)
          : (isEn ? 'Your account and reel performance' : '내 계정과 릴스 성과를 확인하세요')}
      </p>
    </div>
    {onRefresh && (
      <div className="flex items-center gap-2 shrink-0">
        {fetchedAt && (
          <span className="text-[10px] md:text-[11px] font-bold text-slate-400 whitespace-nowrap">
            {isEn ? `Updated ${agoText(fetchedAt, true)}` : `${agoText(fetchedAt, false)} 기준`}
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-xl border border-slate-200 bg-white text-slate-600 font-black text-[11px] md:text-xs px-3 py-2 hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {refreshing ? (isEn ? 'Loading…' : '불러오는 중') : (isEn ? 'Refresh' : '새로 불러오기')}
        </button>
      </div>
    )}
  </header>
);

const StatTile: React.FC<{
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'flat';
  muted?: boolean;
}> = ({ label, value, tone, muted }) => (
  <div className="bg-white border border-slate-100 rounded-2xl md:rounded-[1.5rem] px-3 py-3 md:px-6 md:py-5 shadow-sm">
    <p className="text-[9px] md:text-[11px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
      {label}
    </p>
    <p
      className={`text-lg md:text-3xl font-black mt-1 ${
        muted
          ? 'text-slate-300 text-xs md:text-lg'
          : tone === 'up'
            ? 'text-emerald-600'
            : tone === 'down'
              ? 'text-rose-600'
              : 'text-slate-900'
      }`}
    >
      {value}
    </p>
  </div>
);

const SortChip: React.FC<{
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
 * 팔로워 추이 선 그래프.
 *
 * 한 계정의 팔로워 수 하나만 그린다. 계열이 하나라 범례를 두지 않고(제목이 그
 * 계열의 이름이다), 축은 뒤로 물러나고 값은 짚었을 때만 나온다. 점은 며칠치가
 * 쌓였는지에 따라 찍는다 — 90일을 고르면 점이 선을 덮지만, 며칠치뿐일 때는 점이
 * 없으면 값이 어느 날의 것인지 알 수 없다.
 *
 * 기록이 하루치뿐이어도 그린다. 선은 이어지지 않지만 그래프의 축·격자와 점 하나가
 * 보이면 사람은 "무엇이 언제부터 쌓이고 있는가"를 볼 수 있다. 빈 상자에 안내 문구만
 * 띄우면 값이 있는 계정에서도 화면이 고장 난 것처럼 읽힌다.
 *
 * y축은 0 에서 시작하지 않는다. 팔로워 3만 계정의 하루 증감 40명은 0 기준 축에서
 * 완전한 수평선이 되고, 그러면 이 그래프는 아무것도 말하지 않는다.
 */
const FollowerChart: React.FC<{
  series: FollowerSeriesResponse | null;
  loading: boolean;
  range: RangeDays;
  isEn: boolean;
}> = ({ series, loading, range, isEn }) => {
  if (loading) {
    return <div className="h-[200px] md:h-[260px] rounded-2xl bg-slate-50 animate-pulse" />;
  }

  const points = series?.points || [];

  // 기록이 아예 없으면 그릴 것이 없다. 가짜 0 을 채워 그리면 그 날 팔로워가 전부
  // 빠진 것으로 읽힌다.
  if (points.length === 0) {
    return (
      <div className="h-[200px] md:h-[260px] rounded-2xl bg-slate-50 flex flex-col items-center justify-center text-center px-6">
        <p className="text-sm font-black text-slate-900 mb-1">
          {isEn ? 'Collecting data' : '데이터 수집 중'}
        </p>
        <p className="text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed max-w-sm">
          {isEn
            ? 'Follower counts are recorded once a day. The first point appears as soon as your account is read.'
            : '팔로워 수는 하루에 한 번 기록됩니다. 계정을 한 번 불러오면 첫 점이 생기고, 이틀치가 쌓이는 날부터 선으로 이어집니다.'}
        </p>
      </div>
    );
  }

  /** 하루치뿐이면 증감을 말할 수 없다 — 점 하나만 찍고 그 사실을 옆에 적는다. */
  const single = points.length === 1;
  const values = points.map(p => p.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 위아래로 약간 띄운다. 완전히 붙으면 선이 축에 눌린다.
  const pad = Math.max(1, Math.round((max - min) * 0.2));
  const change = values[values.length - 1] - values[0];

  // 배치를 켠 날보다 앞선 구간은 물어볼 곳이 없다. 고른 기간을 다 채우지 못했다면
  // 그 사실을 그래프 옆에 적는다 — 선이 짧은 이유가 팔로워 변화가 아니라 수집
  // 시작일이라는 것을 알 수 있어야 한다.
  const partial = points.length < range;

  return (
    <>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-xl md:text-3xl font-black text-slate-900">
          {values[values.length - 1].toLocaleString()}
        </span>
        {!single && (
          <span
            className={`text-xs md:text-sm font-black ${
              change > 0 ? 'text-emerald-600' : change < 0 ? 'text-rose-600' : 'text-slate-400'
            }`}
          >
            {change > 0 ? '+' : change < 0 ? '−' : ''}{Math.abs(change).toLocaleString()}
          </span>
        )}
        <span className="text-[10px] md:text-xs font-bold text-slate-400">
          {single
            ? (isEn ? `first record ${shortDate(points[0].date)}` : `첫 기록 ${shortDate(points[0].date)}`)
            : (isEn ? `over ${points.length} days` : `${points.length}일 동안`)}
        </span>
      </div>

      <div className="h-[180px] md:h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
              // 점이 많으면 라벨이 겹친다. 리차트가 알아서 건너뛰게 둔다.
              interval="preserveStartEnd"
              minTickGap={24}
              dy={8}
            />
            <YAxis
              domain={[min - pad, max + pad]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
              tickFormatter={(v: number) => compact(v)}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
                fontSize: 12,
                fontWeight: 700,
              }}
              labelFormatter={(label) => shortDate(String(label ?? ''))}
              formatter={(value) => [
                `${Number(value ?? 0).toLocaleString()}${isEn ? '' : '명'}`,
                isEn ? 'Followers' : '팔로워',
              ]}
            />
            <Line
              type="monotone"
              dataKey="followers"
              stroke="#2563eb"
              strokeWidth={2}
              // 며칠치뿐일 때는 점을 찍는다. 하루치면 선이 아예 없으므로 점이 유일한
              // 표시이고, 90일치면 점이 선을 덮으므로 끈다.
              dot={points.length <= 14 ? { r: 3, strokeWidth: 2, stroke: '#ffffff' } : false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {partial && (
        <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2">
          {single
            ? (isEn
                ? 'Only one day has been recorded so far — the line is drawn from the second day onward.'
                : '아직 하루치만 기록돼 있습니다. 이틀치가 쌓이는 날부터 선으로 이어집니다.')
            : (isEn
                ? `Only ${points.length} of the last ${range} days have been recorded so far — the rest is still being collected.`
                : `최근 ${range}일 중 ${points.length}일치만 기록돼 있습니다. 나머지 기간은 데이터 수집 중입니다.`)}
        </p>
      )}
    </>
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

const TopReelCard: React.FC<{
  reel: InsightReel;
  rank: number;
  isEn: boolean;
  savedUsable: boolean;
}> = ({ reel, rank, isEn, savedUsable }) => {
  const body = (
    <>
      <div className="relative">
        <Thumb src={reel.thumbnailUrl} className="w-full aspect-[9/16] rounded-xl" />
        <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-slate-900/85 text-white text-[10px] font-black flex items-center justify-center">
          {rank}
        </span>
      </div>
      <p className="text-[10px] font-bold text-slate-400 mt-1.5">{postedOn(reel.timestamp)}</p>
      <p className="text-[11px] md:text-xs font-black text-slate-900 mt-0.5">
        {savedUsable
          ? `${isEn ? 'Saves' : '저장'} ${metricText(reel.saved)}`
          : `${isEn ? 'Views' : '조회'} ${compact(reel.views)}`}
      </p>
    </>
  );

  const className = 'block w-[112px] shrink-0 md:w-auto';
  return reel.permalink ? (
    <a href={reel.permalink} target="_blank" rel="noopener noreferrer" className={`${className} group`}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
};

const ReelCard: React.FC<{ reel: InsightReel; isEn: boolean }> = ({ reel, isEn }) => {
  const body = (
    <div className="flex gap-3 rounded-2xl border border-slate-100 p-3 hover:border-slate-200 hover:shadow-sm transition-all h-full">
      <Thumb src={reel.thumbnailUrl} className="w-16 md:w-20 shrink-0 aspect-[9/16] rounded-xl" />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex items-center gap-2">
          <p className="text-[10px] md:text-[11px] font-black text-slate-400">{postedOn(reel.timestamp)}</p>
          {reel.durationSeconds ? (
            <span className="text-[10px] font-bold text-slate-400">{reel.durationSeconds}s</span>
          ) : null}
        </div>
        {reel.caption ? (
          <p className="text-[11px] md:text-xs font-medium text-slate-500 mt-0.5 line-clamp-2 break-words">
            {reel.caption}
          </p>
        ) : null}
        <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 mt-auto pt-2">
          <MiniStat label={isEn ? 'Views' : '조회'} value={compact(reel.views)} />
          <MiniStat label={isEn ? 'Reach' : '도달'} value={metricText(reel.reach)} />
          <MiniStat label={isEn ? 'Saves' : '저장'} value={metricText(reel.saved)} />
          <MiniStat label={isEn ? 'Likes' : '좋아요'} value={compact(reel.likes)} />
          <MiniStat label={isEn ? 'Comments' : '댓글'} value={compact(reel.comments)} />
        </div>
      </div>
    </div>
  );

  return reel.permalink ? (
    <a href={reel.permalink} target="_blank" rel="noopener noreferrer" className="block">
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

export default CreatorInsights;
