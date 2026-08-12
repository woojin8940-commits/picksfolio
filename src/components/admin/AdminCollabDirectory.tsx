import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';
import { INSIGHT_HINT, insightGrade, insightScoreOf, type InsightScore } from '../../utils/influencerInsight';

interface DirApplication {
  id: string;
  role: 'influencer' | 'brand';
  applicant_username: string;
  name: string;
  contact: string;
  // influencer
  instagram_url: string;
  youtube_url: string;
  tiktok_url: string;
  naver_blog_url: string;
  ad_price: string;
  category: string;
  /**
   * 브랜드 매칭 등록에서 본인이 고른 분야를 쪼갠 것. 서버가 등록서의 값과
   * 채널에 남은 값을 합쳐 보내므로 화면에서 다시 쪼개지 않는다.
   */
  category_tags: string[];
  follower_count: number;
  follower_source: string;
  instagram_followers: number;
  instagram_following: number;
  instagram_avg_views: number;
  instagram_avg_likes: number;
  instagram_avg_comments: number;
  instagram_connected: boolean;
  instagram_recent_reels: Array<{
    id: string;
    permalink: string;
    thumbnailUrl: string;
    caption: string;
    views: number;
    likes: number;
    comments: number;
    timestamp: string;
  }>;
  instagram_reel_trend_percent: number | null;
  instagram_recent_average_views: number;
  instagram_synced_at?: string;
  // brand
  brand_homepage: string;
  brand_instagram: string;
  desired_count: string;
  desired_followers: string;
  budget: number;
  budget_text: string;
  desired_schedule: string;
  desired_category: string;
  note: string;
  status: string;
  created_at: string;
}

interface Props {
  token: string;
}

// 팔로워 구간 분류 (인스타/틱톡 링크 크롤링 또는 수기 입력값 기준)
const TIERS = [
  { key: '0-1만', label: '0 – 1만', min: 0, max: 10000 },
  { key: '1-5만', label: '1만 – 5만', min: 10000, max: 50000 },
  { key: '5-10만', label: '5만 – 10만', min: 50000, max: 100000 },
  { key: '10-50만', label: '10만 – 50만', min: 100000, max: 500000 },
  { key: '50만+', label: '50만 이상', min: 500000, max: Infinity },
];

function tierOf(count: number) {
  return TIERS.find(t => count >= t.min && count < t.max) || TIERS[TIERS.length - 1];
}

/**
 * 인플루언서 명단 정렬. 두 가지만 둔다.
 *
 * 팔로워 순은 "얼마나 큰 계정인가", 인사이트 순은 "콘텐츠가 얼마나 잘 되는가"다.
 * 두 줄서기가 전혀 다르기 때문에 둘 다 필요하다 — 팔로워는 한번 쌓이면 잘 줄지
 * 않아서, 팔로워 순 맨 위에는 지금 아무도 보지 않는 계정이 올라올 수 있다.
 */
const INF_SORTS = [
  { key: 'followers', label: '팔로워 많은 순' },
  { key: 'insight', label: '인사이트 좋은 순' },
] as const;

type InfSort = typeof INF_SORTS[number]['key'];

/** 카드에 실린 Meta 지표로 인사이트 점수를 만든다. 지표가 없으면 null. */
function insightOf(item: DirApplication): InsightScore | null {
  return insightScoreOf({
    followers: item.instagram_followers || item.follower_count,
    avgViews: item.instagram_avg_views,
    avgLikes: item.instagram_avg_likes,
    avgComments: item.instagram_avg_comments,
    trendPercent: item.instagram_reel_trend_percent,
    metricsSource: item.follower_source === 'meta_api' ? 'meta_api' : 'self',
  });
}

function fmtFollowers(n: number) {
  if (!n) return '0';
  if (n >= 10000) return `${(n / 10000).toFixed(n % 10000 === 0 ? 0 : 1)}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}천`;
  return n.toLocaleString();
}

function fmtDate(d: string) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

const LinkChip: React.FC<{ label: string; url: string }> = ({ label, url }) => {
  if (!url) return null;
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-bold hover:bg-blue-50 hover:text-blue-600 transition-colors">
      {label}
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
    </a>
  );
};

const AdminCollabDirectory: React.FC<Props> = ({ token }) => {
  const [view, setView] = useState<'influencer' | 'brand'>('influencer');
  const [brandSort, setBrandSort] = useState<'recent' | 'schedule' | 'budget'>('recent');
  const [items, setItems] = useState<DirApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTier, setActiveTier] = useState<string>('all');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [infSort, setInfSort] = useState<InfSort>('followers');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const authHeaders = useCallback(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const sort = view === 'brand' ? brandSort : 'followers';
      const res = await fetch(`/api/collab-directory?role=${view}&sort=${sort}`, {
        credentials: 'same-origin',
        headers: authHeaders(),
      });
      const data = await res.json();
      setItems(data.applications || []);
    } catch {
      console.error('Failed to fetch directory applications');
    } finally {
      setLoading(false);
    }
  }, [view, brandSort, authHeaders]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const saveFollowers = async (id: string) => {
    const fc = Math.max(0, parseInt(editValue, 10) || 0);
    try {
      await fetch('/api/collab-directory', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: authHeaders(),
        body: JSON.stringify({ id, follower_count: fc }),
      });
      setEditingId(null);
      fetchItems();
    } catch {
      alert('저장에 실패했습니다.');
    }
  };

  const syncInstagram = async (item: DirApplication) => {
    if (!item.applicant_username) {
      alert('로그인 계정 정보가 없어 Meta 계정을 연결할 수 없습니다.');
      return;
    }
    setSyncingId(item.id);
    const result = await apiService.syncCreatorChannel(item.applicant_username, token);
    setSyncingId(null);
    if (result.error) {
      alert(result.code === 'META_NOT_LINKED'
        ? '지원자가 아직 Instagram Meta 계정을 연동하지 않았습니다.'
        : result.error);
      return;
    }
    await fetchItems();
  };

  const influencers = items.filter(i => i.role === 'influencer');
  const tierCounts = TIERS.reduce<Record<string, number>>((acc, t) => {
    acc[t.key] = influencers.filter(i => tierOf(i.follower_count).key === t.key).length;
    return acc;
  }, {});

  /**
   * 카테고리 목록과 개수. 지원자가 고른 분야를 그대로 세고, 많이 등록된 순서로
   * 놓는다(같은 개수면 이름 순 — 순서가 매번 바뀌면 늘 보던 자리에 없다).
   *
   * 개수는 팔로워 구간 필터와 무관하게 전체 지원자 기준으로 센다. 필터 결과로
   * 세면 구간을 좁힌 순간 나머지 카테고리가 목록에서 사라져 되돌아갈 길이 없어진다.
   */
  const categoryFacets = (() => {
    const counts = new Map<string, number>();
    let untagged = 0;
    for (const i of influencers) {
      const tags = i.category_tags || [];
      if (tags.length === 0) { untagged++; continue; }
      for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const list = Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return { list, untagged };
  })();

  const visibleInfluencers = influencers.filter(i => {
    if (activeTier !== 'all' && tierOf(i.follower_count).key !== activeTier) return false;
    if (activeCategory === 'all') return true;
    // 분야를 적지 않은 지원자도 따로 모아 볼 수 있어야 한다 — 카테고리를 물어보러
    // 연락할 대상이 바로 이 사람들이다.
    if (activeCategory === '__none__') return (i.category_tags || []).length === 0;
    return (i.category_tags || []).includes(activeCategory);
  });

  /**
   * 정렬은 화면에서 한다. 필요한 지표가 이미 응답에 실려 있어 다시 불러올 이유가
   * 없고, 버튼을 누를 때마다 목록이 비었다 다시 그려지면 방금 보던 자리를 잃는다.
   *
   * 점수는 여기서 한 번만 계산해 행에 붙인다 — 정렬 순서와 카드에 찍히는 배지가
   * 같은 값을 보게 하려면 계산이 한 곳이어야 한다.
   */
  const shownInfluencers = visibleInfluencers
    .map(item => ({ item, insight: insightOf(item) }))
    .sort((a, b) => {
      const byFollowers = (b.item.follower_count || 0) - (a.item.follower_count || 0);
      if (infSort !== 'insight') return byFollowers;
      // 점수가 없는 계정(지표 미연동)은 맨 아래로 보내고, 동점이면 팔로워 순으로 둔다.
      return ((b.insight?.score ?? -1) - (a.insight?.score ?? -1)) || byFollowers;
    });

  return (
    <div className="space-y-4">
      {/* 역할 전환 */}
      <div className="flex gap-2">
        {([
          { key: 'influencer', label: '인플루언서', count: view === 'influencer' ? items.length : undefined },
          { key: 'brand', label: '브랜드', count: view === 'brand' ? items.length : undefined },
        ] as const).map(b => (
          <button
            key={b.key}
            onClick={() => { setView(b.key); setActiveTier('all'); setActiveCategory('all'); }}
            className={`px-5 py-2.5 rounded-xl font-black text-sm transition-all ${
              view === b.key ? 'bg-slate-900 text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
            }`}
          >
            {b.label}{typeof b.count === 'number' ? ` ${b.count}` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
          <div className="w-7 h-7 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">불러오는 중...</p>
        </div>
      ) : view === 'influencer' ? (
        <>
          {/* 정렬 — 팔로워 순과 인사이트 순을 나란히 둔다. 어느 쪽으로 보고
              있는지 늘 화면에 남아 있어야 한다(정렬을 기억으로 두면 며칠 뒤
              같은 명단을 다르게 읽는다). */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {INF_SORTS.map(s => (
              <button
                key={s.key}
                onClick={() => setInfSort(s.key)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-all ${infSort === s.key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                {s.label}
              </button>
            ))}
            {infSort === 'insight' && (
              <span className="text-[10px] font-bold text-slate-400">{INSIGHT_HINT}</span>
            )}
          </div>

          {/* 팔로워 구간 필터 */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveTier('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-all ${activeTier === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              전체 {influencers.length}
            </button>
            {TIERS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTier(t.key)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-all ${activeTier === t.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                {t.label} {tierCounts[t.key] || 0}
              </button>
            ))}
          </div>

          {/* 카테고리별 보기 — 지원자가 브랜드 매칭 등록에서 직접 고른 분야다.
              캠페인이 "뷰티 인플루언서 5명" 으로 들어오는데 명단이 접수순으로만
              쌓이면 운영자가 전체를 훑어 손으로 골라야 한다. */}
          {(categoryFacets.list.length > 0 || categoryFacets.untagged > 0) && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setActiveCategory('all')}
                className={`px-3 py-1.5 rounded-full text-[11px] font-black transition-all ${activeCategory === 'all' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                전체 분야
              </button>
              {categoryFacets.list.map(c => (
                <button
                  key={c.name}
                  onClick={() => setActiveCategory(activeCategory === c.name ? 'all' : c.name)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-black transition-all ${activeCategory === c.name ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  {c.name} {c.count}
                </button>
              ))}
              {categoryFacets.untagged > 0 && (
                <button
                  onClick={() => setActiveCategory(activeCategory === '__none__' ? 'all' : '__none__')}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-black transition-all ${activeCategory === '__none__' ? 'bg-amber-500 text-white' : 'bg-amber-50 border border-amber-100 text-amber-600 hover:bg-amber-100'}`}
                >
                  분야 미입력 {categoryFacets.untagged}
                </button>
              )}
            </div>
          )}

          {visibleInfluencers.length === 0 ? (
            <EmptyBox message={activeCategory === 'all' ? '해당 구간의 인플루언서 지원자가 없습니다.' : '이 조건에 맞는 인플루언서 지원자가 없습니다.'} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {shownInfluencers.map(({ item: it, insight }) => (
                <div key={it.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="font-black text-slate-900 text-sm">{it.name || '(이름 미입력)'}</p>
                      <p className="text-xs text-slate-400 font-medium">{it.contact || '연락처 없음'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 text-[11px] font-black whitespace-nowrap">
                        {tierOf(it.follower_count).label}
                      </span>
                      {/* 인사이트 점수. 지표가 없으면 0 점이 아니라 '집계 전'이다 —
                          성과가 나쁜 계정과 아직 연동하지 않은 계정은 운영자가 해야
                          할 일이 전혀 다르다. */}
                      {insight ? (
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black whitespace-nowrap ${insightGrade(insight.score).cls}`}>
                          인사이트 {insight.score} · {insightGrade(insight.score).label}
                          {!insight.verified && ' (자기입력)'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-400 text-[10px] font-black whitespace-nowrap">
                          인사이트 집계 전
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-2.5">
                    {editingId === it.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          className="w-28 border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold"
                          autoFocus
                        />
                        <button onClick={() => saveFollowers(it.id)} className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-black">저장</button>
                        <button onClick={() => setEditingId(null)} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold">취소</button>
                      </div>
                    ) : (
                      <>
                        <span className="text-lg font-black text-slate-900">{fmtFollowers(it.follower_count)}</span>
                        <span className="text-[11px] text-slate-400 font-bold">팔로워</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${it.follower_source === 'meta_api' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                          {it.follower_source === 'meta_api' ? 'Meta 확인' : '수기입력'}
                        </span>
                        <button
                          onClick={() => { setEditingId(it.id); setEditValue(String(it.follower_count || '')); }}
                          className="text-[11px] text-blue-500 font-bold hover:underline ml-1"
                        >
                          수정
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-2.5">
                    <LinkChip label="인스타" url={it.instagram_url} />
                    <LinkChip label="유튜브" url={it.youtube_url} />
                    <LinkChip label="틱톡" url={it.tiktok_url} />
                    <LinkChip label="블로그" url={it.naver_blog_url} />
                  </div>

                  {/* 본인이 고른 분야. 눌러서 그 분야만 볼 수 있게 해 둔다 — 명단을
                      보다 "이런 사람이 몇 명 더 있나" 를 확인하는 흐름이 자연스럽다. */}
                  {(it.category_tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2.5">
                      {it.category_tags.map(tag => (
                        <button
                          key={tag}
                          onClick={() => setActiveCategory(activeCategory === tag ? 'all' : tag)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-black transition-colors ${activeCategory === tag ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Instagram Meta 데이터</p>
                        <p className="mt-0.5 text-[10px] font-bold text-slate-500">
                          {it.instagram_connected
                            ? `최근 동기화 ${fmtDate(it.instagram_synced_at || '') || '완료'}`
                            : '지원자의 Meta 계정 연동이 필요합니다.'}
                        </p>
                      </div>
                      <button
                        onClick={() => syncInstagram(it)}
                        disabled={syncingId === it.id}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-[10px] font-black text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                      >
                        {syncingId === it.id ? '동기화 중...' : 'Meta 새로고침'}
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Metric label="팔로워" value={it.instagram_followers || it.follower_count} />
                      <Metric label="팔로잉" value={it.instagram_following} />
                      <Metric label="릴스 평균 조회" value={it.instagram_avg_views} />
                      <TrendMetric value={it.instagram_reel_trend_percent} />
                    </div>

                    {/* 점수를 그대로 믿으라고 하지 않는다. 무엇으로 계산했는지
                        같은 카드에 남겨 두면 운영자가 직접 판단할 수 있다. */}
                    {insight && (
                      <p className="mt-2 text-[10px] font-bold text-slate-400">
                        조회율 {insight.viewRate}% · 반응률 {insight.engagementRate}%
                        {insight.trendPercent !== null && ` · 동향 ${insight.trendPercent > 0 ? '+' : ''}${insight.trendPercent}%`}
                      </p>
                    )}

                    {it.instagram_recent_reels?.length > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {it.instagram_recent_reels.map((reel, index) => (
                          <a
                            key={reel.id || reel.permalink || index}
                            href={reel.permalink || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group overflow-hidden rounded-lg border border-slate-200 bg-white"
                          >
                            <div className="aspect-[4/5] bg-slate-200">
                              {reel.thumbnailUrl ? (
                                <img src={reel.thumbnailUrl} alt={`최근 릴스 ${index + 1}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-[10px] font-black text-slate-400">REELS</div>
                              )}
                            </div>
                            <div className="p-2">
                              <p className="text-[10px] font-black text-slate-700">
                                {reel.views ? `조회 ${reel.views.toLocaleString()}` : '조회수 집계 전'}
                              </p>
                            </div>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-bold">
                      {it.category && <span className="text-slate-400">{it.category} · </span>}
                      단가 {it.ad_price || '미입력'}
                    </span>
                    <span className="text-slate-300 font-medium">{fmtDate(it.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* 브랜드 정렬 */}
          <div className="flex gap-1.5 flex-wrap">
            {([
              { key: 'recent', label: '최신순' },
              { key: 'schedule', label: '일정 순' },
              { key: 'budget', label: '예산 순' },
            ] as const).map(s => (
              <button
                key={s.key}
                onClick={() => setBrandSort(s.key)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-all ${brandSort === s.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <EmptyBox message="브랜드(광고주) 지원이 없습니다." />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {items.map(it => (
                <div key={it.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="font-black text-slate-900 text-sm">{it.name || '(브랜드명 미입력)'}</p>
                      <p className="text-xs text-slate-400 font-medium">{it.contact || '연락처 없음'}</p>
                    </div>
                    {it.budget > 0 && (
                      <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-600 text-[11px] font-black whitespace-nowrap">
                        예산 {it.budget_text || it.budget.toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-2.5">
                    <LinkChip label="홈페이지" url={it.brand_homepage} />
                    <LinkChip label="인스타" url={it.brand_instagram} />
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs mb-2">
                    <Info label="희망 인원" value={it.desired_count} />
                    <Info label="원하는 팔로워" value={it.desired_followers} />
                    <Info label="원하는 일정" value={fmtDate(it.desired_schedule) || it.desired_schedule} />
                    <Info label="카테고리" value={it.desired_category} />
                  </div>

                  {it.note && <p className="text-xs text-slate-500 font-medium bg-slate-50 rounded-lg p-2.5 mb-2 whitespace-pre-wrap">{it.note}</p>}

                  <div className="text-right">
                    <span className="text-slate-300 font-medium text-xs">{fmtDate(it.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center gap-1.5">
    <span className="text-slate-400 font-bold">{label}</span>
    <span className="text-slate-700 font-bold truncate">{value || '-'}</span>
  </div>
);

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg bg-white px-2.5 py-2">
    <p className="text-[9px] font-black text-slate-400">{label}</p>
    <p className="mt-0.5 text-sm font-black text-slate-800">{Number(value || 0).toLocaleString()}</p>
  </div>
);

const TrendMetric: React.FC<{ value: number | null }> = ({ value }) => {
  const available = typeof value === 'number';
  const positive = available && value > 0;
  const negative = available && value < 0;
  return (
    <div className="rounded-lg bg-white px-2.5 py-2">
      <p className="text-[9px] font-black text-slate-400">최근 릴스 동향</p>
      <p className={`mt-0.5 text-sm font-black ${positive ? 'text-emerald-600' : negative ? 'text-rose-500' : 'text-slate-500'}`}>
        {available ? `${positive ? '+' : ''}${value}%` : '데이터 부족'}
      </p>
    </div>
  );
};

const EmptyBox: React.FC<{ message: string }> = ({ message }) => (
  <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
    <p className="text-sm text-slate-400 font-bold">{message}</p>
  </div>
);

export default AdminCollabDirectory;
