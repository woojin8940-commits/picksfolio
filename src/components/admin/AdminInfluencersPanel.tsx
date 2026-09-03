import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { isTestUsername } from '../../utils/testData';
import { TIER_LABEL, normalizeTier, type MembershipTier } from '../../utils/membershipTiers';
import { formatPhone } from '../../utils/formatters';

interface InfluencerRow {
  id: string;
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
  membership_plan?: 'standard' | 'standard_ai' | 'commerce' | 'pro' | null;
  membership_started_at?: string | null;
  membership_source?: 'operator' | 'complimentary' | 'paid' | null;
  paid_membership_plan?: 'standard' | 'standard_ai' | 'commerce' | 'pro' | null;
  operator_membership_plan?: 'standard' | 'standard_ai' | 'commerce' | 'pro' | null;
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

/** 운영자가 직접 부여한 멤버십 한 건(서버의 operator_membership_grants 원본). */
interface OperatorGrantRow {
  auth_user_id: string;
  username: string;
  plan: MembershipTier;
  granted_at: string;
  granted_by: string;
  /** 회원 목록에서 이 부여에 해당하는 계정을 찾았는지. false 면 계정을 못 찾은 부여다. */
  matched: boolean;
  /** 부여가 붙은 계정의 종류. 비즈니스 계정 부여는 유저 목록에 나타나지 않는다. */
  scope?: 'user' | 'business' | 'unknown';
}

type Segment = 'users' | 'businesses' | 'liveCustomers';
type SortKey = 'created_at' | 'last_login_at' | 'clicks' | 'views' | 'proposals_total' | 'acceptance_rate';
/** 부여 가능한 플랜. 커머스는 판매 종료라 부여·필터 대상이 아니다(과거 구독자의 표시만 남는다). */
type GrantablePlan = 'standard' | 'standard_ai' | 'pro';
type PlanFilter = 'all' | 'none' | MembershipTier;

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
  const [grants, setGrants] = useState<OperatorGrantRow[]>([]);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>('users');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  // Hide seed/QA accounts (testuser, biz_tester123, picksfolio12 …) by default.
  const [showTestData, setShowTestData] = useState(false);

  // silent 새로고침은 멤버십을 부여·해제한 직후에 쓴다. 스피너로 화면을 비우지 않고
  // 부여 현황만 서버 값으로 다시 맞춘다.
  const load = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const data = await apiService.getAdminInfluencers(token);
    setRows(data.influencers || []);
    setBusinesses(data.businesses || []);
    setLiveCustomers(data.liveCustomers || []);
    setGrants((data.operatorGrants || []) as OperatorGrantRow[]);
    setGrantsError(data.operatorGrantsError || null);
    if (!opts?.silent) setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (!showTestData) list = list.filter(r => !isTestUsername(r.username));
    if (planFilter === 'none') list = list.filter(r => !r.membership_active);
    else if (planFilter !== 'all') {
      list = list.filter(r => r.membership_active && normalizeTier(r.membership_plan) === planFilter);
    }
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
  }, [rows, search, sortKey, sortDir, showTestData, planFilter]);

  const filteredBusinesses = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = businesses;
    if (!showTestData) list = list.filter(b => !isTestUsername(b.raw_username || b.username));
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
  }, [businesses, search, sortDir, showTestData]);

  const hiddenTestCount = useMemo(
    () => rows.filter(r => isTestUsername(r.username)).length
      + businesses.filter(b => isTestUsername(b.raw_username || b.username)).length,
    [rows, businesses]
  );

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

  const setMembership = async (r: InfluencerRow, plan: GrantablePlan | null) => {
    const currentPlan = r.membership_active ? r.membership_plan ?? null : null;
    if (currentPlan === plan) return;

    const verb = plan === null ? '운영자 부여 해제' : `${TIER_LABEL[plan]} 부여`;
    if (!window.confirm(`@${r.username} 계정에 ${verb}하시겠어요?`)) return;

    setBusy(r.username);
    const res = await apiService.updateAdminInfluencer(token, r.username, {
      membership_plan: plan,
      auth_user_id: r.id,
    });
    setBusy(null);
    if (res.ok && res.membership) {
      setRows(prev => prev.map(x => x.username === r.username
        ? {
            ...x,
            ...res.membership,
          }
        : x));
      // 부여 현황(운영자 부여 목록)은 서버가 만드는 값이라 화면에서 흉내낼 수 없다.
      // 조용히 다시 불러 목록과 현황이 어긋나지 않게 한다.
      void load({ silent: true });
    } else {
      window.alert(res.error || '멤버십 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  const revokeGrant = async (g: OperatorGrantRow) => {
    if (!window.confirm(`@${g.username || g.auth_user_id} 계정의 운영자 부여를 해제하시겠어요?`)) return;
    setBusy(`grant-${g.auth_user_id}`);
    const res = await apiService.updateAdminInfluencer(token, g.username || g.auth_user_id, {
      membership_plan: null,
      auth_user_id: g.auth_user_id,
    });
    setBusy(null);
    if (res.ok) await load({ silent: true });
    else window.alert(res.error || '부여 해제에 실패했습니다.');
  };

  // 이용 현황 집계는 검색·플랜 필터와 상관없이 전체를 세야 한다 — 카드 숫자가 필터에
  // 따라 흔들리면 "지금 멤버십 회원이 몇 명인지"를 알 수 없다. 표와 같은 기준을
  // 지키기 위해 테스트 계정 숨김만 함께 따른다.
  const countableRows = showTestData ? rows : rows.filter(r => !isTestUsername(r.username));
  const countableBusinesses = showTestData
    ? businesses
    : businesses.filter(b => !isTestUsername(b.raw_username || b.username));

  const featuredCount = countableRows.filter(r => r.featured).length;
  const planCount = (plan: MembershipTier) =>
    countableRows.filter(r => r.membership_active && normalizeTier(r.membership_plan) === plan).length;
  const commerceMemberCount = planCount('commerce');
  const standardMemberCount = planCount('standard');
  const standardAiMemberCount = planCount('standard_ai');
  const proMemberCount = planCount('pro');
  const totalMemberCount = countableRows.filter(r => r.membership_active).length;
  const sourceCount = (source: 'operator' | 'complimentary' | 'paid') =>
    countableRows.filter(r => r.membership_active && r.membership_source === source).length;
  const operatorMemberCount = sourceCount('operator');
  const complimentaryMemberCount = sourceCount('complimentary');
  const paidMemberCount = sourceCount('paid');
  const unmatchedGrants = grants.filter(g => !g.matched);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
        <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 font-bold text-sm">회원 데이터 로딩 중...</p>
      </div>
    );
  }

  // 탭 숫자는 표에 실제로 보이는 줄 수와 같아야 한다 — 테스트 계정을 숨긴 채로
  // 전체 개수를 띄우면 목록과 숫자가 어긋난다.
  const segmentTabs: { key: Segment; label: string; count: number }[] = [
    { key: 'users',         label: '유저',        count: countableRows.length },
    { key: 'businesses',    label: '비즈니스',    count: countableBusinesses.length },
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
        {hiddenTestCount > 0 && (
          <button
            onClick={() => setShowTestData(v => !v)}
            className={`ml-auto px-3 py-2 rounded-xl text-[11px] font-black transition-all ${
              showTestData ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
            title="testuser, biz_tester123, picksfolio12 등 QA/시드 계정을 숨기거나 표시합니다."
          >
            {showTestData ? `테스트 계정 표시중 (${hiddenTestCount})` : `테스트 계정 ${hiddenTestCount}개 숨김`}
          </button>
        )}
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
              <StatCard label="전체 유저" value={countableRows.length} valueClass="text-slate-900" sub={`주목 ${featuredCount}명`} />
              <StatCard
                label="멤버십 회원"
                value={totalMemberCount}
                valueClass="text-pink-500"
                sub={`운영 부여 ${operatorMemberCount}명 · 유료 구독 ${paidMemberCount}명 · 제휴 제공 ${complimentaryMemberCount}명`}
              />
              <StatCard label="누적 뷰" value={countableRows.reduce((s, r) => s + r.views, 0)} valueClass="text-blue-600" />
              <StatCard label="누적 클릭" value={countableRows.reduce((s, r) => s + r.clicks, 0)} valueClass="text-indigo-600" />
            </div>

            <MembershipStatusPanel
              totalMemberCount={totalMemberCount}
              planCounts={{
                standard: standardMemberCount,
                standard_ai: standardAiMemberCount,
                pro: proMemberCount,
                commerce: commerceMemberCount,
              }}
              grants={grants}
              grantsError={grantsError}
              unmatchedGrants={unmatchedGrants}
              busy={busy}
              onRevoke={revokeGrant}
              onReload={() => load({ silent: true })}
              onFilterPlan={setPlanFilter}
            />

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
                    onClick={() => load()}
                    className="px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200"
                  >새로고침</button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* 커머스는 판매 종료 플랜이라 필터에서 뺐다. 과거 커머스 구독자는
                      멤버십 이용 현황의 '커머스' 줄에서 확인한다. */}
                  {([
                    ['all', '전체'],
                    ['none', '미가입'],
                    ['standard', '스탠다드'],
                    ['standard_ai', 'AI 협업'],
                    ['pro', '프로'],
                  ] as [PlanFilter, string][]).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setPlanFilter(value)}
                      className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black transition-colors ${
                        planFilter === value
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
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
                  const activePlan: MembershipTier | null = r.membership_active ? normalizeTier(r.membership_plan) : null;
                  const sourceLabel = r.membership_source === 'operator'
                    ? '운영 부여'
                    : r.membership_source === 'paid'
                      ? '유료 구독'
                      : r.membership_source === 'complimentary'
                        ? '제휴 제공'
                        : '';
                  return (
                    <div key={r.id} className="md:grid md:grid-cols-12 gap-2 px-5 py-3 items-center hover:bg-slate-50/50 transition-all">
                      <div className="md:col-span-3 flex items-center gap-2 min-w-0">
                        <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                          <span className="text-xs font-black text-white">{r.username.slice(0, 2).toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-slate-900 text-sm truncate">@{r.username}</p>
                          <p className="text-[10px] font-bold text-slate-400 truncate">{r.full_name || '-'} · {r.email || '-'}</p>
                        </div>
                        {r.featured && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-black rounded">주목</span>
                        )}
                      </div>
                      <div className="md:col-span-2 mt-2 md:mt-0">
                        <p className="text-[11px] font-bold text-slate-600">{formatDate(r.created_at)}</p>
                        <p className="text-[10px] font-bold text-slate-400">{formatTimeAgo(r.last_login_at)}</p>
                      </div>
                      <div className="md:col-span-1 mt-1 md:mt-0">
                        <p className="text-[11px] font-bold text-blue-600">{r.views.toLocaleString()}</p>
                        <p className="text-[10px] font-bold text-indigo-600">{r.clicks.toLocaleString()}</p>
                      </div>
                      <div className="md:col-span-1 mt-1 md:mt-0">
                        <p className="text-[11px] font-bold text-slate-700">{r.proposals_total}건</p>
                        <p className="text-[10px] font-bold text-slate-400">{r.acceptance_rate}%</p>
                      </div>
                      <div className="md:col-span-2 mt-2 md:mt-0">
                        {activePlan === 'pro' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-[10px] font-black">
                            프로
                            <span className="text-[9px] font-bold text-emerald-500">{formatDate(r.membership_started_at)}~</span>
                          </span>
                        ) : activePlan === 'commerce' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-pink-100 text-pink-700 text-[10px] font-black">
                            커머스
                            <span className="text-[9px] font-bold text-pink-500">{formatDate(r.membership_started_at)}~</span>
                          </span>
                        ) : activePlan === 'standard_ai' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-100 text-violet-700 text-[10px] font-black">
                            AI 협업
                            <span className="text-[9px] font-bold text-violet-500">{formatDate(r.membership_started_at)}~</span>
                          </span>
                        ) : activePlan === 'standard' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-100 text-blue-700 text-[10px] font-black">
                            스탠다드
                            <span className="text-[9px] font-bold text-blue-500">{formatDate(r.membership_started_at)}~</span>
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-1 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black">미가입</span>
                        )}
                        {sourceLabel && (
                          <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold text-slate-400">
                            <span>{sourceLabel}</span>
                            {r.membership_source === 'operator' && r.paid_membership_plan && (
                              <span>· 기존 구독 {TIER_LABEL[r.paid_membership_plan]}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="md:col-span-3 mt-2 md:mt-0 flex justify-end gap-1.5 flex-wrap">
                        <button
                          onClick={() => toggleFeatured(r)}
                          disabled={busy === r.username || r.has_profile === false}
                          title={r.has_profile === false ? '프로필이 만들어진 뒤에 주목으로 올릴 수 있습니다. 멤버십 부여는 지금도 됩니다.' : undefined}
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
                          disabled={busy === r.username || r.operator_membership_plan === 'standard'}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all disabled:opacity-40 ${
                            activePlan === 'standard'
                              ? 'bg-blue-500 text-white'
                              : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                          }`}
                        >
                          스탠다드
                        </button>
                        <button
                          onClick={() => setMembership(r, 'standard_ai')}
                          disabled={busy === r.username || r.operator_membership_plan === 'standard_ai'}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all disabled:opacity-40 ${
                            activePlan === 'standard_ai'
                              ? 'bg-violet-500 text-white'
                              : 'bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200'
                          }`}
                        >
                          AI 협업
                        </button>
                        <button
                          onClick={() => setMembership(r, 'pro')}
                          disabled={busy === r.username || r.operator_membership_plan === 'pro'}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-all disabled:opacity-40 ${
                            activePlan === 'pro'
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-300'
                          }`}
                        >
                          프로
                        </button>
                        {r.operator_membership_plan && (
                          <button
                            onClick={() => setMembership(r, null)}
                            disabled={busy === r.username}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-black bg-white text-slate-500 hover:bg-slate-50 border border-slate-200 disabled:opacity-50"
                          >
                            부여 해제
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
              <StatCard label="전체 비즈니스" value={countableBusinesses.length} valueClass="text-slate-900" />
              <StatCard
                label="최근 30일 가입"
                value={countableBusinesses.filter(b => new Date(b.created_at || 0).getTime() > Date.now() - 30 * 86400000).length}
                valueClass="text-slate-700"
              />
              <StatCard
                label="최근 30일 접속"
                value={countableBusinesses.filter(b => new Date(b.last_login_at || 0).getTime() > Date.now() - 30 * 86400000).length}
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
                    onClick={() => load()}
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
                      <p className="text-[11px] font-bold text-slate-700">{formatPhone(b.phone) || '-'}</p>
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
                    onClick={() => load()}
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
                      <p className="text-[12px] font-bold text-slate-700">{formatPhone(c.phone)}</p>
                    </div>
                    <div className="md:col-span-3 mt-1 md:mt-0">
                      <p className="text-[12px] font-black text-blue-600 truncate">@{c.subscribed_to}</p>
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

const PLAN_STYLE: Record<MembershipTier, { label: string; chip: string; text: string }> = {
  standard: { label: '스탠다드', chip: 'bg-blue-100 text-blue-700', text: 'text-blue-600' },
  standard_ai: { label: 'AI 협업', chip: 'bg-violet-100 text-violet-700', text: 'text-violet-600' },
  commerce: { label: '커머스', chip: 'bg-pink-100 text-pink-700', text: 'text-pink-600' },
  pro: { label: '프로', chip: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-600' },
};

/**
 * 멤버십 이용 현황.
 *
 * 이전에는 카드 하나에 "커머스 멤버" 숫자만 크게 띄우고 나머지 플랜을 잔글씨로 붙여
 * 두었다. 커머스는 판매를 종료한 플랜이라 그 숫자는 늘 0이었고, 운영자가 스탠다드·
 * AI 협업·프로를 부여해도 현황은 0명으로 보였다. 그래서 플랜별 인원과 함께
 * "운영자가 부여한 목록"(operator_membership_grants 원본)을 그대로 나열한다.
 *
 * 부여 목록을 불러오지 못한 경우도 0명과 구분해 알린다 — 조회 실패를 "부여한 계정이
 * 없다"로 읽으면 이미 부여한 권한을 다시 부여하게 된다.
 */
const MembershipStatusPanel: React.FC<{
  totalMemberCount: number;
  planCounts: Record<'standard' | 'standard_ai' | 'pro' | 'commerce', number>;
  grants: OperatorGrantRow[];
  grantsError: string | null;
  unmatchedGrants: OperatorGrantRow[];
  busy: string | null;
  onRevoke: (g: OperatorGrantRow) => void;
  onReload: () => void;
  onFilterPlan: (plan: PlanFilter) => void;
}> = ({ totalMemberCount, planCounts, grants, grantsError, unmatchedGrants, busy, onRevoke, onReload, onFilterPlan }) => {
  // 커머스는 판매 종료 플랜이다. 과거 구독자가 남아 있을 때만 줄을 보여 준다 —
  // 인원이 있는데 감추면 플랜별 합계가 전체 회원 수와 어긋난다.
  const planKeys: MembershipTier[] = ['standard', 'standard_ai', 'pro'];
  if (planCounts.commerce > 0) planKeys.push('commerce');

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div>
          <h3 className="font-black text-slate-900 text-sm">멤버십 이용 현황</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">
            활성 멤버십 {totalMemberCount}명 · 운영자 부여 {grantsError ? '—' : grants.length}건
          </p>
        </div>
        <button
          onClick={onReload}
          className="px-3 py-1.5 bg-slate-100 rounded-lg text-[10px] font-black text-slate-600 hover:bg-slate-200"
        >현황 새로고침</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-slate-50 rounded-xl p-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">플랜별 인원</p>
          <div className="space-y-1.5">
            {planKeys.map(plan => (
              <button
                key={plan}
                onClick={() => onFilterPlan(plan)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white transition-colors text-left"
                title={`${PLAN_STYLE[plan].label} 회원만 목록에서 보기`}
              >
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${PLAN_STYLE[plan].chip}`}>
                  {PLAN_STYLE[plan].label}
                  {plan === 'commerce' && <span className="ml-1 font-bold opacity-70">판매 종료</span>}
                </span>
                <span className={`text-sm font-black ${PLAN_STYLE[plan].text}`}>{planCounts[plan as keyof typeof planCounts]}명</span>
              </button>
            ))}
          </div>
          <p className="text-[9px] font-bold text-slate-400 mt-2">
            플랜을 누르면 아래 목록이 해당 플랜 회원만 보여 줍니다.
          </p>
        </div>

        <div className="bg-slate-50 rounded-xl p-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">운영자가 부여한 멤버십</p>

          {grantsError ? (
            <div className="bg-rose-50 border border-rose-100 rounded-lg p-3">
              <p className="text-[11px] font-black text-rose-700">부여 목록을 불러오지 못했습니다.</p>
              <p className="text-[10px] font-bold text-rose-400 mt-0.5 break-all">{grantsError}</p>
              <p className="text-[10px] font-bold text-slate-400 mt-1">
                이미 부여한 권한은 그대로 유지됩니다. 새로고침 후에도 같으면 잠시 뒤 다시 확인해 주세요.
              </p>
            </div>
          ) : grants.length === 0 ? (
            <p className="text-[11px] font-bold text-slate-400 py-2">
              아직 운영자가 직접 부여한 멤버십이 없습니다. 아래 목록에서 플랜 버튼을 누르면 여기에 기록됩니다.
            </p>
          ) : (
            <>
              {unmatchedGrants.length > 0 && (
                <p className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 mb-2">
                  {unmatchedGrants.length}건은 회원 목록에서 계정을 찾지 못했습니다(탈퇴·아이디 변경 가능). 권한은 살아 있으니 필요 없으면 해제해 주세요.
                </p>
              )}
              <div className="divide-y divide-slate-200/70 max-h-48 overflow-y-auto">
                {grants.map(g => (
                  <div key={g.auth_user_id} className="flex items-center gap-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-black shrink-0 ${PLAN_STYLE[g.plan]?.chip || 'bg-slate-200 text-slate-600'}`}>
                      {PLAN_STYLE[g.plan]?.label || g.plan}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-black text-slate-800 truncate">
                        @{g.username || g.auth_user_id.slice(0, 8)}
                        {!g.matched && (
                          <span className="ml-1 px-1 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-black">계정 미확인</span>
                        )}
                        {g.scope === 'business' && (
                          <span className="ml-1 px-1 py-0.5 rounded bg-slate-200 text-slate-600 text-[9px] font-black">비즈니스</span>
                        )}
                      </p>
                      <p className="text-[9px] font-bold text-slate-400 truncate">
                        {formatDate(g.granted_at)} 부여{g.granted_by ? ` · ${g.granted_by}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => onRevoke(g)}
                      disabled={busy === `grant-${g.auth_user_id}`}
                      className="px-2 py-1 rounded-lg text-[10px] font-black bg-white text-slate-500 border border-slate-200 hover:bg-slate-100 disabled:opacity-50 shrink-0"
                    >{busy === `grant-${g.auth_user_id}` ? '처리중' : '해제'}</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
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
