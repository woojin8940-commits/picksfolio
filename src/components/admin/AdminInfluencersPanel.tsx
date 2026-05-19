import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';

interface InfluencerRow {
  username: string;
  has_profile?: boolean;
  full_name?: string;
  email?: string;
  phone?: string;
  featured: boolean;
  featured_at?: string | null;
  featured_note?: string | null;
  last_login_at?: string | null;
  login_count?: number;
  created_at?: string;
  views: number;
  clicks: number;
  proposals_total: number;
  proposals_accepted: number;
  proposals_rejected: number;
  acceptance_rate: number;
  membership_active?: boolean;
  membership_plan?: 'standard' | 'commerce' | null;
  membership_started_at?: string | null;
}

interface BusinessRow {
  username: string;
  raw_username?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  last_login_at?: string | null;
  login_count?: number;
  created_at?: string;
}

interface LiveCustomerRow {
  phone: string;
  nickname: string;
  subscribed_to: string;
  subscribed_at: string;
}

type Segment = 'users' | 'businesses' | 'liveCustomers';
type SortKey = 'created_at' | 'last_login_at' | 'clicks' | 'views' | 'proposals_total' | 'acceptance_rate';

interface Props {
  token: string;
}

const formatDate = (s?: string | null) => {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const formatTimeAgo = (s?: string | null) => {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '-';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return formatDate(s);
};

const AdminInfluencersPanel: React.FC<Props> = ({ token }) => {
  const [rows, setRows] = useState<InfluencerRow[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [liveCustomers, setLiveCustomers] = useState<LiveCustomerRow[]>([]);
  const [segment, setSegment] = useState<Segment>('users');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const data = await apiService.getAdminInfluencers(token);
    setRows(data.influencers || []);
    setBusinesses(data.businesses || []);
    setLiveCustomers(data.liveCustomers || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter(r =>
        r.username.toLowerCase().includes(q) ||
        (r.full_name || '').toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q)
      );
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [rows, search, sortKey, sortDir]);

  const filteredBusinesses = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = businesses;
    if (q) {
      list = list.filter(b =>
        b.username.toLowerCase().includes(q) ||
        (b.full_name || '').toLowerCase().includes(q) ||
        (b.email || '').toLowerCase().includes(q) ||
        (b.phone || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const av = new Date(a.created_at || 0).getTime();
      const bv = new Date(b.created_at || 0).getTime();
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [businesses, search, sortDir]);

  const filteredLiveCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = liveCustomers;
    if (q) {
      list = list.filter(c =>
        c.nickname.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.subscribed_to.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const av = new Date(a.subscribed_at || 0).getTime();
      const bv = new Date(b.subscribed_at || 0).getTime();
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [liveCustomers, search, sortDir]);

  const toggleFeatured = async (r: InfluencerRow) => {
    setBusy(r.username);
    const res = await apiService.updateAdminInfluencer(token, r.username, { featured: !r.featured });
    setBusy(null);
    if (res.ok) {
      setRows(prev => prev.map(x => x.username === r.username ? { ...x, featured: !r.featured, featured_at: !r.featured ? new Date().toISOString() : null } : x));
    }
  };

  const setMembership = async (r: InfluencerRow, plan: 'standard' | 'commerce' | null) => {
    const currentPlan = r.membership_active ? r.membership_plan ?? null : null;
    if (currentPlan === plan) return;

    if (plan !== null && r.has_profile === false) {
      window.alert('이 계정에는 프로필이 없어 멤버십을 부여할 수 없어요. 사용자가 먼저 프로필을 생성하면 부여 후 사용자 계정에 즉시 반영됩니다.');
      return;
    }

    const verb = plan === null ? '해지' : plan === 'commerce' ? '커머스 멤버십 부여' : '스탠다드 멤버십 부여';
    if (!window.confirm(`@${r.username} 계정에 ${verb}하시겠어요?`)) return;

    setBusy(r.username);
    const res = await apiService.updateAdminInfluencer(token, r.username, { membership_plan: plan });
    setBusy(null);
    if (res.ok) {
      const now = new Date().toISOString();
      setRows(prev => prev.map(x => x.username === r.username
        ? {
            ...x,
            membership_active: plan !== null,
            membership_plan: plan,
            membership_started_at: plan !== null ? (x.membership_started_at || now) : null,
          }
        : x));
    } else {
      window.alert(res.error || '멤버십 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  const featuredCount = rows.filter(r => r.featured).length;
  const commerceMemberCount = rows.filter(r => r.membership_active && (r.membership_plan === 'commerce')).length;
  const standardMemberCount = rows.filter(r => r.membership_active && r.membership_plan === 'standard').length;

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
        <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 font-bold text-sm">회원 데이터 로딩 중...</p>
      </div>
    );
  }

  const segmentTabs: { key: Segment; label: string; count: number }[] = [
    { key: 'users',         label: '유저',        count: rows.length },
    { key: 'businesses',    label: '비즈니스',    count: businesses.length },
    { key: 'liveCustomers', label: '라이브 고객', count: liveCustomers.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {segmentTabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setSegment(t.key); setSearch(''); }}
            className={`px-4 py-2.5 rounded-xl font-black text-sm transition-all flex items-center gap-2 ${
              segment === t.key
                ? 'bg-slate-900 text-white shadow-lg'
                : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'
            }`}
          >
            {t.label}
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${
              segment === t.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {segment === 'users' && (
        rows.length === 0 ? (
          <EmptyCard
            title="아직 등록된 유저가 없습니다."
            sub="신규 가입자가 생기면 이 곳에 표시됩니다."
            onReload={load}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="전체 유저" value={rows.length} valueClass="text-slate-900" />
              <StatCard
                label="커머스 멤버"
                value={commerceMemberCount}
                valueClass="text-pink-500"
                sub={`스탠다드 ${standardMemberCount}명 · 주목 ${featuredCount}명`}
              />
              <StatCard label="누적 뷰" value={rows.reduce((s, r) => s + r.views, 0)} valueClass="text-purple-600" />
              <StatCard label="누적 클릭" value={rows.reduce((s, r) => s + r.clicks, 0)} valueClass="text-indigo-600" />
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    placeholder="username, 이름, 이메일 검색"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full md:max-w-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-slate-400"
                  />
                  <button
                    onClick={load}
                    className="px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200"
                  >새로고침</button>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[10px] font-black text-slate-400 uppercase">
                  <span>정렬:</span>
                  {([
                    ['created_at', '가입일'],
                    ['last_login_at', '마지막 접속'],
                    ['clicks', '누적 클릭'],
                    ['views', '누적 뷰'],
                    ['proposals_total', '제안 수'],
                    ['acceptance_rate', '수락률'],
                  ] as [SortKey, string][]).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => toggleSort(k)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                        sortKey === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {label} {sortKey === k && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                <div className="col-span-3">유저</div>
                <div className="col-span-2">가입 / 마지막 접속</div>
                <div className="col-span-1">뷰 / 클릭</div>
                <div className="col-span-1">제안 (수락률)</div>
                <div className="col-span-2">멤버십</div>
                <div className="col-span-3 text-right">주목 · 멤버십 부여</div>
              </div>

              <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 font-bold text-sm">조건에 맞는 유저가 없습니다.</div>
                ) : filtered.map(r => {
                  const activePlan: 'standard' | 'commerce' | null = r.membership_active ? (r.membership_plan ?? null) : null;
                  return (
                    <div key={r.username} className="md:grid md:grid-cols-12 gap-2 px-5 py-3 items-center hover:bg-slate-50/50 transition-all">
                      <div className="md:col-span-3 flex items-center gap-2 min-w-0">
                        <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                          <span className="text-xs font-black text-white">{r.username.slice(0, 2).toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-slate-900 text-sm truncate">@{r.username}</p>
                          <p className="text-[10px] font-bold text-slate-400 truncate">{r.full_name || '-'} · {r.email || '-'}</p>
                        </div>
                        {r.featured && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-black rounded">주목</span>
                        )}
                        {r.has_profile === false && (
                          <span
                            className="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[9px] font-black rounded"
                            title="이 계정은 auth에는 있지만 프로필이 없습니다. 프로필 생성 전에는 멤버십 부여가 사용자 계정에 반영되지 않습니다."
                          >
                            프로필 없음
                          </span>
                        )}
                      </div>
                      <div className="md:col-span-2 mt-2 md:mt-0">
                        <p className="text-[11px] font-bold text-slate-600">{formatDate(r.created_at)}</p>
                        <p className="text-[10px] font-bold text-slate-400">{formatTimeAgo(r.last_login_at)}</p>
                      </div>
                      <div className="md:col-span-1 mt-1 md:mt-0">
                        <p className="text-[11px] font-bold text-purple-600">{r.views.toLocaleString()}</p>
                        <p className="text-[10px] font-bold text-indigo-600">{r.clicks.toLocaleString()}</p>
                      </div>
                      <div className="md:col-span-1 mt-1 md:mt-0">
                        <p className="text-[11px] font-bold text-slate-700">{r.proposals_total}건</p>
                        <p className="text-[10px] font-bold text-slate-400">{r.acceptance_rate}%</p>
                      </div>
                      <div className="md:col-span-2 mt-2 md:mt-0">
                        {activePlan === 'commerce' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-pink-100 text-pink-700 text-[10px] font-black">
                            🎥 커머스
                            <span className="text-[9px] font-bold text-pink-500">{formatDate(r.membership_started_at)}~</span>
                          </span>
                        ) : activePlan === 'standard' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-100 text-purple-700 text-[10px] font-black">
                            ★ 스탠다드
                            <span className="text-[9px] font-bold text-purple-500">{formatDate(r.membership_started_at)}~</span>
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-1 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black">미가입</span>
                        )}
                      </div>
                      <div className="md:col-span-3 mt-2 md:mt-0 flex justify-end gap-1.5 flex-wrap">
                        <button
                          onClick={() => toggleFeatured(r)}
                          disabled={busy === r.username}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all ${
                            r.featured
                              ? 'bg-amber-500 text-white hover:bg-amber-600'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          } disabled:opacity-50`}
                        >
                          {r.featured ? '★ 해제' : '☆ 주목'}
                        </button>
                        <button
                          onClick={() => setMembership(r, 'standard')}
                          disabled={busy === r.username || activePlan === 'standard'}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all disabled:opacity-40 ${
                            activePlan === 'standard'
                              ? 'bg-purple-500 text-white'
                              : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
                          }`}
                        >
                          스탠다드
                        </button>
                        <button
                          onClick={() => setMembership(r, 'commerce')}
                          disabled={busy === r.username || activePlan === 'commerce'}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all disabled:opacity-40 ${
                            activePlan === 'commerce'
                              ? 'bg-gradient-to-r from-purple-600 to-pink-500 text-white'
                              : 'bg-pink-50 text-pink-700 hover:bg-pink-100 border border-pink-200'
                          }`}
                        >
                          커머스
                        </button>
                        {activePlan && (
                          <button
                            onClick={() => setMembership(r, null)}
                            disabled={busy === r.username}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-white text-slate-500 hover:bg-slate-50 border border-slate-200 disabled:opacity-50"
                          >
                            해지
                          </button>
                        )}
                        {busy === r.username && (
                          <span className="px-2 py-1.5 text-[10px] font-bold text-slate-400">처리중...</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )
      )}

      {segment === 'businesses' && (
        businesses.length === 0 ? (
          <EmptyCard
            title="아직 등록된 비즈니스 계정이 없습니다."
            sub="광고주가 비즈니스 회원가입을 완료하면 이 곳에 표시됩니다."
            onReload={load}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="전체 비즈니스" value={businesses.length} valueClass="text-slate-900" />
              <StatCard
                label="최근 30일 가입"
                value={businesses.filter(b => new Date(b.created_at || 0).getTime() > Date.now() - 30 * 86400000).length}
                valueClass="text-slate-700"
              />
              <StatCard
                label="최근 30일 접속"
                value={businesses.filter(b => new Date(b.last_login_at || 0).getTime() > Date.now() - 30 * 86400000).length}
                valueClass="text-slate-700"
              />
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    placeholder="회사 ID, 담당자, 이메일, 연락처 검색"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full md:max-w-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-slate-400"
                  />
                  <button
                    onClick={load}
                    className="px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200"
                  >새로고침</button>
                </div>
                <button
                  onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                  className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white"
                >
                  가입일 {sortDir === 'asc' ? '↑' : '↓'}
                </button>
              </div>

              <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                <div className="col-span-3">비즈니스 ID</div>
                <div className="col-span-3">담당자 / 이메일</div>
                <div className="col-span-2">연락처</div>
                <div className="col-span-2">가입일</div>
                <div className="col-span-2">마지막 접속</div>
              </div>

              <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
                {filteredBusinesses.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 font-bold text-sm">조건에 맞는 비즈니스가 없습니다.</div>
                ) : filteredBusinesses.map(b => (
                  <div key={b.raw_username || b.username} className="md:grid md:grid-cols-12 gap-2 px-5 py-3 items-center hover:bg-slate-50/50 transition-all">
                    <div className="md:col-span-3 flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 bg-gradient-to-br from-slate-700 to-slate-900 rounded-xl flex items-center justify-center shrink-0">
                        <span className="text-xs font-black text-white">{(b.username || '').slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-black text-slate-900 text-sm truncate">biz/{b.username}</p>
                        <p className="text-[10px] font-bold text-slate-400 truncate">비즈니스 계정</p>
                      </div>
                    </div>
                    <div className="md:col-span-3 mt-2 md:mt-0 min-w-0">
                      <p className="text-[12px] font-black text-slate-700 truncate">{b.full_name || '-'}</p>
                      <p className="text-[10px] font-bold text-slate-400 truncate">{b.email || '-'}</p>
                    </div>
                    <div className="md:col-span-2 mt-1 md:mt-0">
                      <p className="text-[11px] font-bold text-slate-700">{b.phone || '-'}</p>
                    </div>
                    <div className="md:col-span-2 mt-1 md:mt-0">
                      <p className="text-[11px] font-bold text-slate-600">{formatDate(b.created_at)}</p>
                    </div>
                    <div className="md:col-span-2 mt-1 md:mt-0">
                      <p className="text-[11px] font-bold text-slate-400">{formatTimeAgo(b.last_login_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      )}

      {segment === 'liveCustomers' && (
        liveCustomers.length === 0 ? (
          <EmptyCard
            title="아직 라이브 알림을 신청한 고객이 없습니다."
            sub="라이브 커머스 방송 페이지에서 알림 신청한 고객이 여기에 표시됩니다."
            onReload={load}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="전체 알림 신청" value={liveCustomers.length} valueClass="text-slate-900" />
              <StatCard
                label="고유 고객 수"
                value={new Set(liveCustomers.map(r => r.phone)).size}
                valueClass="text-pink-500"
              />
              <StatCard
                label="구독된 인플루언서"
                value={new Set(liveCustomers.map(r => r.subscribed_to)).size}
                valueClass="text-rose-500"
              />
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    placeholder="닉네임, 전화번호, 인플루언서 검색"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full md:max-w-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-slate-400"
                  />
                  <button
                    onClick={load}
                    className="px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200"
                  >새로고침</button>
                  <button
                    onClick={async () => {
                      if (busy) return;
                      const ok = window.confirm(`알림 신청한 ${liveCustomers.length}건을 전부 초기화하시겠습니까? 되돌릴 수 없습니다.`);
                      if (!ok) return;
                      setBusy('reset-live-notify');
                      const res = await apiService.resetAdminLiveNotifySubscribers(token);
                      setBusy(null);
                      if (res.ok) {
                        setLiveCustomers([]);
                        window.alert(`초기화 완료: ${res.removedSubscribers ?? 0}명의 구독자가 삭제되었습니다.`);
                      } else {
                        window.alert(`초기화 실패: ${res.error || '알 수 없는 오류'}`);
                      }
                    }}
                    disabled={busy === 'reset-live-notify' || liveCustomers.length === 0}
                    className="px-3 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >{busy === 'reset-live-notify' ? '초기화 중…' : '전체 초기화'}</button>
                </div>
                <button
                  onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                  className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white"
                >
                  신청일 {sortDir === 'asc' ? '↑' : '↓'}
                </button>
              </div>

              <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                <div className="col-span-3">고객 닉네임</div>
                <div className="col-span-3">전화번호</div>
                <div className="col-span-3">구독한 인플루언서</div>
                <div className="col-span-3">신청일</div>
              </div>

              <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
                {filteredLiveCustomers.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 font-bold text-sm">조건에 맞는 라이브 고객이 없습니다.</div>
                ) : filteredLiveCustomers.map((c, idx) => (
                  <div key={`${c.phone}-${c.subscribed_to}-${idx}`} className="md:grid md:grid-cols-12 gap-2 px-5 py-3 items-center hover:bg-slate-50/50 transition-all">
                    <div className="md:col-span-3 flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 bg-gradient-to-br from-pink-500 to-rose-500 rounded-xl flex items-center justify-center shrink-0">
                        <span className="text-xs font-black text-white">{(c.nickname || '?').slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-black text-slate-900 text-sm truncate">{c.nickname || '익명'}</p>
                        <p className="text-[10px] font-bold text-pink-500 truncate">라이브 고객</p>
                      </div>
                    </div>
                    <div className="md:col-span-3 mt-1 md:mt-0">
                      <p className="text-[12px] font-bold text-slate-700">{c.phone}</p>
                    </div>
                    <div className="md:col-span-3 mt-1 md:mt-0">
                      <p className="text-[12px] font-black text-purple-600 truncate">@{c.subscribed_to}</p>
                    </div>
                    <div className="md:col-span-3 mt-1 md:mt-0">
                      <p className="text-[11px] font-bold text-slate-600">{formatDate(c.subscribed_at)}</p>
                      <p className="text-[10px] font-bold text-slate-400">{formatTimeAgo(c.subscribed_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number; valueClass: string; sub?: string }> = ({ label, value, valueClass, sub }) => (
  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
    <p className={`text-2xl font-black ${valueClass}`}>{value.toLocaleString()}</p>
    {sub && <p className="text-[10px] font-bold text-slate-400 mt-0.5">{sub}</p>}
  </div>
);

const EmptyCard: React.FC<{ title: string; sub: string; onReload: () => void }> = ({ title, sub, onReload }) => (
  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
    <p className="text-slate-400 font-bold text-sm">{title}</p>
    <p className="text-slate-300 font-bold text-xs mt-1">{sub}</p>
    <button
      onClick={onReload}
      className="mt-4 px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200"
    >새로고침</button>
  </div>
);

export default AdminInfluencersPanel;
