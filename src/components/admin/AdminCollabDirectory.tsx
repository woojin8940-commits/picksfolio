import React, { useState, useEffect, useCallback } from 'react';

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
  follower_count: number;
  follower_source: string;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

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

  const influencers = items.filter(i => i.role === 'influencer');
  const tierCounts = TIERS.reduce<Record<string, number>>((acc, t) => {
    acc[t.key] = influencers.filter(i => tierOf(i.follower_count).key === t.key).length;
    return acc;
  }, {});
  const visibleInfluencers = activeTier === 'all'
    ? influencers
    : influencers.filter(i => tierOf(i.follower_count).key === activeTier);

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
            onClick={() => { setView(b.key); setActiveTier('all'); }}
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

          {visibleInfluencers.length === 0 ? (
            <EmptyBox message="해당 구간의 인플루언서 지원자가 없습니다." />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {visibleInfluencers.map(it => (
                <div key={it.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="font-black text-slate-900 text-sm">{it.name || '(이름 미입력)'}</p>
                      <p className="text-xs text-slate-400 font-medium">{it.contact || '연락처 없음'}</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 text-[11px] font-black whitespace-nowrap">
                      {tierOf(it.follower_count).label}
                    </span>
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
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${it.follower_source === 'crawled' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                          {it.follower_source === 'crawled' ? '자동확인' : '수기입력'}
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

const EmptyBox: React.FC<{ message: string }> = ({ message }) => (
  <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
    <p className="text-sm text-slate-400 font-bold">{message}</p>
  </div>
);

export default AdminCollabDirectory;
