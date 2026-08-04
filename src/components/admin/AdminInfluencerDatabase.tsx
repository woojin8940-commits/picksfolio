import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../../services/apiService';
import { formatNumberWithCommas } from '../../utils/formatters';

/**
 * 인플루언서 DB — 우리에게 누가 있는지 한 표로 정리해 둔다.
 *
 * 카드 그리드로 두면 한 화면에 여섯 명이 들어오고, 팔로워가 비슷한 계정을 나란히
 * 비교할 수 없다. 이 화면의 일은 "고르기"가 아니라 "정리해 두고 찾기"이므로 표가 맞다.
 * 대신 정렬을 열 제목에 붙여, 팔로워순·상승세순·참여율순으로 관점을 바꿀 수 있게 했다.
 *
 * 팔로잉과 릴스 동향을 팔로워 옆에 둔 이유. 팔로워만 보면 지금 뜨는 계정인지 알 수
 * 없다 — 팔로워는 한번 쌓이면 잘 줄지 않지만 조회수는 즉시 반응한다. 최근 릴스 3개
 * 평균 조회수를 그 이전 3개와 비교한 값(동향)이 그 신호다. 비교할 이전 구간이 없으면
 * 0%가 아니라 '—'로 둔다 — 0%는 "변화 없음"이고, 여기서 필요한 말은 "아직 모름"이다.
 */

interface Props {
  token: string;
}

type SortKey = 'followers' | 'following' | 'avgViews' | 'trend' | 'engagement' | 'running';

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  meta_api: { label: '메타 연동', cls: 'bg-emerald-50 text-emerald-600' },
  self: { label: '본인 입력', cls: 'bg-amber-50 text-amber-600' },
  none: { label: '지표 미등록', cls: 'bg-slate-100 text-slate-400' },
};

const compact = (n: unknown) => {
  const v = Number(n || 0);
  if (!v) return '—';
  if (v >= 100000000) return `${(v / 100000000).toFixed(1)}억`;
  if (v >= 10000) return `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}만`;
  return formatNumberWithCommas(v);
};

/** 동향 배지. 상승/하락/보합/알 수 없음을 색으로 구분한다. */
const TrendBadge: React.FC<{ percent: number | null | undefined }> = ({ percent }) => {
  if (percent === null || percent === undefined) {
    return <span className="text-[10px] font-bold text-slate-300">—</span>;
  }
  const p = Number(percent);
  const cls = p > 5 ? 'bg-green-50 text-green-600' : p < -5 ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-500';
  const arrow = p > 5 ? '▲' : p < -5 ? '▼' : '–';
  return (
    <span className={`${cls} px-1.5 py-0.5 rounded text-[10px] font-black whitespace-nowrap`}>
      {arrow} {p > 0 ? '+' : ''}{p}%
    </span>
  );
};

const AdminInfluencerDatabase: React.FC<Props> = ({ token }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('followers');
  const [openUser, setOpenUser] = useState('');
  const [onlyConnected, setOnlyConnected] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiService.getManagerInfluencers({ q: submitted, category, token });
    setLoading(false);
    if (res.error) {
      setError(res.error);
      setRows([]);
      return;
    }
    setRows(res.influencers || []);
    // 카테고리 집계는 필터와 무관하게 전체 기준으로 온다.
    setCategories(res.categories || []);
  }, [submitted, category, token]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const connected = rows.filter(r => r.followers > 0);
    const followerSum = connected.reduce((s, r) => s + Number(r.followers || 0), 0);
    return {
      total: rows.length,
      connected: connected.length,
      avgFollowers: connected.length ? Math.round(followerSum / connected.length) : 0,
      rising: rows.filter(r => typeof r.reelTrendPercent === 'number' && r.reelTrendPercent > 5).length,
      running: rows.reduce((s, r) => s + Number(r.runningCollabs || 0), 0),
    };
  }, [rows]);

  const visible = useMemo(() => {
    const list = onlyConnected ? rows.filter(r => r.registered || r.followers > 0) : rows.slice();
    const value = (r: any) => {
      switch (sortKey) {
        case 'following': return Number(r.following || 0);
        case 'avgViews': return Number(r.avgViews || 0);
        // 동향이 없는 계정은 정렬 맨 아래로 보낸다.
        case 'trend': return typeof r.reelTrendPercent === 'number' ? r.reelTrendPercent : -Infinity;
        case 'engagement': return Number(r.engagementRate || 0);
        case 'running': return Number(r.runningCollabs || 0);
        default: return Number(r.followers || 0);
      }
    };
    return list.sort((a, b) => value(b) - value(a));
  }, [rows, sortKey, onlyConnected]);

  const open = visible.find(r => r.username === openUser) || null;

  const columns: { key: SortKey; label: string }[] = [
    { key: 'followers', label: '팔로워' },
    { key: 'following', label: '팔로잉' },
    { key: 'avgViews', label: '평균 조회수' },
    { key: 'trend', label: '릴스 동향' },
    { key: 'engagement', label: '참여율' },
    { key: 'running', label: '진행' },
  ];

  return (
    <div className="space-y-3">
      {/* 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-gradient-to-br from-slate-900 to-slate-700 rounded-2xl p-3.5 text-white">
          <p className="text-[9px] font-black text-white/60 uppercase tracking-widest mb-1">등록 인플루언서</p>
          <p className="text-xl font-black">{summary.total.toLocaleString()}명</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-3.5">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">지표 연동</p>
          <p className="text-xl font-black text-slate-900">{summary.connected}명</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-3.5">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">평균 팔로워</p>
          <p className="text-xl font-black text-slate-900">{compact(summary.avgFollowers)}</p>
        </div>
        <div className="bg-green-50 rounded-2xl border border-green-100 p-3.5">
          <p className="text-[9px] font-black text-green-500 uppercase tracking-widest mb-1">조회수 상승세</p>
          <p className="text-xl font-black text-green-600">{summary.rising}명</p>
        </div>
        <div className="bg-amber-50 rounded-2xl border border-amber-100 p-3.5">
          <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">진행 중 협업</p>
          <p className="text-xl font-black text-amber-600">{summary.running}건</p>
        </div>
      </div>

      {/* 검색 · 카테고리 · 정렬 */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setSubmitted(query.trim()); }}
              placeholder="계정 · 이름 · 카테고리 · 소개 검색"
              className="text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 w-60 focus:outline-none focus:border-blue-400"
            />
            <button
              onClick={() => setSubmitted(query.trim())}
              className="px-3 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700"
            >
              검색
            </button>
            <button
              onClick={() => setOnlyConnected(v => !v)}
              className={`px-2.5 py-2 rounded-lg text-[10px] font-black ${
                onlyConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
              title="채널 지표가 등록된 계정만 봅니다."
            >
              지표 있는 계정만
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">정렬</span>
            {columns.map(c => (
              <button
                key={c.key}
                onClick={() => setSortKey(c.key)}
                className={`px-2 py-1.5 rounded-lg text-[10px] font-black ${
                  sortKey === c.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategory('')}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
              category === '' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            전체
          </button>
          {categories.map(c => (
            <button
              key={c.name}
              onClick={() => setCategory(category === c.name ? '' : c.name)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
                category === c.name ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {c.name} {c.count}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <p className="text-[11px] font-bold text-red-600">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-7 h-7 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-400">명부를 불러오는 중...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm font-black text-slate-500">해당하는 인플루언서가 없습니다.</p>
          <p className="text-[11px] font-bold text-slate-400 mt-1">검색어를 바꾸거나 카테고리를 풀어 보세요.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="hidden lg:grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.3fr)_72px_72px_88px_92px_66px_60px_64px] gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">인플루언서</div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">카테고리</div>
            {columns.map(c => (
              <button
                key={c.key}
                onClick={() => setSortKey(c.key)}
                className={`text-[9px] font-black uppercase tracking-widest text-right ${
                  sortKey === c.key ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {c.label}{sortKey === c.key ? ' ↓' : ''}
              </button>
            ))}
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">릴스</div>
          </div>

          <div className="divide-y divide-slate-50">
            {visible.map(p => {
              const source = SOURCE_BADGE[p.metricsSource || 'none'] || SOURCE_BADGE.none;
              return (
                <div
                  key={p.username}
                  className="lg:grid lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.3fr)_72px_72px_88px_92px_66px_60px_64px] gap-2 px-3 py-2 items-center hover:bg-slate-50/60 cursor-pointer"
                  onClick={() => setOpenUser(p.username)}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
                      <span className="text-[11px] font-black text-white">{(p.name || p.username || '?').slice(0, 1).toUpperCase()}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-black text-slate-900 truncate">{p.name || `@${p.username}`}</p>
                      <p className="text-[10px] font-bold text-slate-400 truncate">
                        @{p.username}
                        {p.instagramHandle && p.instagramHandle !== p.username ? ` · 인스타 @${p.instagramHandle}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="hidden lg:flex flex-wrap gap-1 min-w-0">
                    {(p.categoryTags || []).slice(0, 3).map((tag: string) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-black">{tag}</span>
                    ))}
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${source.cls}`}>{source.label}</span>
                  </div>

                  <div className="hidden lg:block text-right text-[11px] font-black text-slate-900">{compact(p.followers)}</div>
                  <div className="hidden lg:block text-right text-[11px] font-bold text-slate-500">{compact(p.following)}</div>
                  <div className="hidden lg:block text-right">
                    <p className="text-[11px] font-black text-slate-900">{compact(p.avgViews)}</p>
                    <p className="text-[9px] font-bold text-slate-300">릴스 {p.reelsCount || 0}</p>
                  </div>
                  <div className="hidden lg:flex justify-end">
                    <div className="text-right">
                      <TrendBadge percent={p.reelTrendPercent} />
                      {p.recentAvgViews > 0 && (
                        <p className="text-[9px] font-bold text-slate-300 mt-0.5">
                          최근 {compact(p.recentAvgViews)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="hidden lg:block text-right text-[11px] font-black text-slate-700">
                    {p.engagementRate ? `${p.engagementRate}%` : '—'}
                  </div>
                  <div className="hidden lg:block text-right">
                    <p className="text-[11px] font-black text-amber-600">{p.runningCollabs || 0}</p>
                    {p.completedCollabs > 0 && <p className="text-[9px] font-bold text-slate-300">완료 {p.completedCollabs}</p>}
                  </div>
                  <div className="hidden lg:flex gap-0.5 justify-end">
                    {(p.recentReels || []).slice(0, 2).map((r: any, i: number) => (
                      r?.thumbnailUrl ? (
                        <img key={r.id || i} src={r.thumbnailUrl} alt="" loading="lazy" className="w-6 h-9 object-cover rounded bg-slate-100" />
                      ) : (
                        <div key={i} className="w-6 h-9 rounded bg-slate-100" />
                      )
                    ))}
                  </div>

                  {/* 모바일: 열이 접히므로 핵심 지표만 한 줄로 */}
                  <div className="lg:hidden mt-1 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-black text-slate-700">팔로워 {compact(p.followers)}</span>
                    <span className="text-[10px] font-bold text-slate-400">팔로잉 {compact(p.following)}</span>
                    <span className="text-[10px] font-bold text-slate-400">조회수 {compact(p.avgViews)}</span>
                    <TrendBadge percent={p.reelTrendPercent} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 상세 — 표의 줄을 밀지 않도록 오버레이로 띄운다. */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto" onClick={() => setOpenUser('')}>
          <div className="bg-white rounded-2xl w-full max-w-xl my-8 overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">{open.name || `@${open.username}`}</p>
                <p className="text-[11px] font-bold text-slate-400 truncate">
                  @{open.username}
                  {open.instagramHandle && open.instagramHandle !== open.username ? ` · 인스타 @${open.instagramHandle}` : ''}
                </p>
              </div>
              <button onClick={() => setOpenUser('')} className="shrink-0 px-2.5 py-1.5 bg-slate-100 rounded-lg text-[10px] font-black text-slate-500 hover:bg-slate-200">
                닫기
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { k: '팔로워', v: compact(open.followers) },
                  { k: '팔로잉', v: compact(open.following) },
                  { k: '평균 조회수', v: compact(open.avgViews) },
                  { k: '평균 좋아요', v: compact(open.avgLikes) },
                  { k: '평균 댓글', v: compact(open.avgComments) },
                  { k: '참여율', v: open.engagementRate ? `${open.engagementRate}%` : '—' },
                ].map(item => (
                  <div key={item.k} className="bg-slate-50 rounded-lg p-2.5">
                    <p className="text-[9px] font-black text-slate-400 uppercase">{item.k}</p>
                    <p className="text-[12px] font-black text-slate-900">{item.v}</p>
                  </div>
                ))}
              </div>

              <div className="bg-slate-50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">최근 릴스 동향</p>
                  <TrendBadge percent={open.reelTrendPercent} />
                </div>
                <p className="text-[11px] font-bold text-slate-600">
                  최근 3개 평균 {compact(open.recentAvgViews)} · 이전 3개 평균 {compact(open.previousAvgViews)}
                </p>
                {open.reelTrendPercent === null && (
                  <p className="text-[10px] font-bold text-slate-400 mt-1">
                    비교할 이전 릴스가 부족해 동향을 계산하지 못했습니다.
                  </p>
                )}
              </div>

              {(open.recentReels || []).length > 0 && (
                <div className="grid grid-cols-3 gap-1.5">
                  {(open.recentReels || []).slice(0, 3).map((r: any, i: number) => {
                    const inner = r?.thumbnailUrl ? (
                      <img src={r.thumbnailUrl} alt="" loading="lazy" className="w-full aspect-[9/16] object-cover rounded-lg bg-slate-100" />
                    ) : (
                      <div className="w-full aspect-[9/16] rounded-lg bg-slate-100 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-slate-300">영상</span>
                      </div>
                    );
                    return (
                      <div key={r?.id || i}>
                        {r?.permalink ? (
                          <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="block hover:opacity-80">{inner}</a>
                        ) : inner}
                        <p className="text-[9px] font-bold text-slate-400 mt-1">{compact(r?.views)} 조회</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {open.categoryTags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {open.categoryTags.map((tag: string) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-black">{tag}</span>
                  ))}
                </div>
              )}

              {open.intro && <p className="text-[11px] font-medium text-slate-600 whitespace-pre-wrap">{open.intro}</p>}

              {(open.adPrice || open.shortPrice || open.postPrice) && (
                <p className="text-[11px] font-bold text-slate-500">
                  {[
                    open.adPrice ? `광고 ${open.adPrice}` : '',
                    open.shortPrice ? `숏폼 ${open.shortPrice}` : '',
                    open.postPrice ? `게시물 ${open.postPrice}` : '',
                  ].filter(Boolean).join(' · ')}
                </p>
              )}

              <p className="text-[11px] font-bold text-slate-500">
                협업 진행 {open.runningCollabs || 0}건 · 완료 {open.completedCollabs || 0}건
                {open.contact ? ` · 연락처 ${open.contact}` : ''}
              </p>

              {open.note && (
                <p className="text-[11px] font-medium text-slate-500 whitespace-pre-wrap">등록서 메모: {open.note}</p>
              )}

              {open.instagramUrl && (
                <a href={open.instagramUrl} target="_blank" rel="noopener noreferrer" className="block text-[11px] font-bold text-blue-600 hover:underline break-all">
                  {open.instagramUrl}
                </a>
              )}

              {!open.registered && (
                <p className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                  채널 지표를 직접 등록하지 않은 계정입니다. 숫자는 등록서에 적힌 값이라 시간이 지나면 실제와 다를 수 있습니다.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminInfluencerDatabase;
