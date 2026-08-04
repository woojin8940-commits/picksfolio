import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../../services/apiService';
import { formatKRW, formatSignedKRW } from '../../utils/formatters';
import { REWARD_MODES, rewardModeOf, type RewardMode } from '../../utils/campaignBrief';

/**
 * 캠페인 관리 — 모든 캠페인이 어디까지 갔고 누가 맡았는지 한 표로 본다.
 *
 * 예전에는 "선정 인플루언서 관리"가 협업(campaign_collabs) 목록만 보여 줬다. 그래서
 * 협업까지 내려온 캠페인은 보이지만, 승인만 되고 명단이 비어 멈춰 있는 캠페인은
 * 아무 화면에도 나타나지 않았다 — 방치된 캠페인을 발견할 방법이 없었던 것이다.
 *
 * 그래서 캠페인을 기준으로 세우고 단계별 숫자(지원 → 명단 → 브랜드 픽 → 제안 →
 * 수락 → 협업)를 나열한다. 어느 칸에서 0이 이어지는지가 곧 병목이다. 담당자도 이
 * 표에서 바로 바꾼다. 담당자 없는 캠페인은 지원이 들어와도 아무도 선정하지 않으므로,
 * 미배정을 눈에 띄게 표시한다.
 *
 * 화면 구성 원칙 — 한 줄에 모든 숫자를 늘어놓지 않는다.
 *
 * 요약 카드 6장에 6칸 단계 숫자와 마진 계산까지 항상 펼쳐 두면, 정작 자주 보는
 * "지금 손대야 할 캠페인이 어느 것인가"가 숫자 더미에 묻힌다. 그래서 접힌 줄에는
 * 판단에 필요한 것만 둔다: 무슨 캠페인인지, 상태, 크게 어디까지 갔는지, 누가 맡았는지,
 * 언제까지인지. 브랜드 픽·제안 같은 중간 단계와 마진 계산 근거는 줄을 눌러서 펼쳤을
 * 때 보여 준다 — 특정 캠페인을 파고들 때만 필요한 값이다.
 *
 * 정렬과 분류를 따로 둔 이유도 같다. 상태 필터만 있으면 "예산 큰 캠페인부터" 같은
 * 순서로 볼 방법이 없어, 운영자가 목록 전체를 눈으로 훑어야 했다.
 */

interface Props {
  token: string;
}

type Filter = 'all' | 'active' | 'pending_approval' | 'inactive' | 'unassigned' | 'stalled';

type SortKey = 'recent' | 'budget' | 'deadline' | 'applications' | 'attention';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: '최신 등록순' },
  { key: 'budget', label: '예산 높은 순' },
  { key: 'deadline', label: '마감 임박순' },
  { key: 'applications', label: '지원자 많은 순' },
  { key: 'attention', label: '손봐야 하는 순' },
];

const STATUS: Record<string, { cls: string; label: string }> = {
  active: { cls: 'bg-green-100 text-green-700', label: '모집중' },
  inactive: { cls: 'bg-slate-100 text-slate-500', label: '마감' },
  pending_approval: { cls: 'bg-orange-100 text-orange-700', label: '승인 대기' },
  admin_rejected: { cls: 'bg-red-100 text-red-700', label: '거절' },
};

const num = (v: unknown) => Number(v || 0);

// 지급액이 제시가를 넘으면 마진은 음수가 된다. formatKRW 는 부호를 버려서 손해가
// 이익처럼 찍히므로, 음수일 때만 부호가 남는 쪽을 쓴다.
const money = (n: number) => (n < 0 ? formatSignedKRW(n) : formatKRW(n));

const formatDate = (d: string) => {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
};

/** 정렬용 시각. 값이 없거나 깨진 날짜는 fallback 으로 밀어 둔다. */
const time = (d: unknown, fallback: number) => {
  const t = new Date(String(d || '')).getTime();
  return Number.isNaN(t) ? fallback : t;
};

/** 마감까지 남은 일수. 지난 날짜는 음수. */
const daysLeft = (d: unknown) => {
  const t = new Date(String(d || '')).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
};

/**
 * 지금 운영자가 손대야 하는 정도. 클수록 급하다.
 *
 * "손봐야 하는 순"은 이 점수로 정렬한다. 승인 대기는 브랜드가 기다리는 상태라 가장
 * 위, 그다음이 담당자 없는 캠페인(지원이 들어와도 아무도 선정하지 않는다), 그다음이
 * 승인은 났는데 명단이 빈 캠페인이다. 마감된 캠페인은 손댈 것이 없으니 0점.
 */
const attentionScore = (c: any) => {
  if (c.status === 'inactive' || c.status === 'admin_rejected') return 0;
  let score = 0;
  if (c.status === 'pending_approval') score += 100;
  if (!c.manager_username) score += 50;
  if (c.status === 'active' && num(c.listed_count) === 0) score += 30;
  // 수락은 됐는데 단가가 비어 있으면 정산이 막힌다.
  score += Math.max(0, num(c.accepted_count) - num(c.priced_count)) * 5;
  const left = daysLeft(c.end_date);
  if (c.status === 'active' && left !== null && left >= 0 && left <= 7) score += 10;
  return score;
};

/** 단계 숫자 한 칸. 0이면 흐리게 둬서 막힌 지점이 눈에 들어오게 한다. */
const Step: React.FC<{ label: string; value: number; tone?: string }> = ({ label, value, tone = 'text-slate-900' }) => (
  <div className="text-center min-w-[38px]">
    <p className={`text-[12px] font-black ${value > 0 ? tone : 'text-slate-200'}`}>{value}</p>
    <p className="text-[8px] font-bold text-slate-300 whitespace-nowrap">{label}</p>
  </div>
);

const AdminCampaignBoard: React.FC<Props> = ({ token }) => {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [mode, setMode] = useState<'' | RewardMode>('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  // 펼쳐 둔 줄. 여러 줄을 나란히 펼쳐 비교하는 일이 있어 한 줄로 제한하지 않는다.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [list, mgr] = await Promise.all([
      apiService.getAdminCampaigns(token),
      apiService.getManagers(token),
    ]);
    setCampaigns(list.campaigns || []);
    setManagers((mgr.managers || []).filter((m: any) => m.active));
    setLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const assign = async (id: string, username: string) => {
    setBusyId(id);
    const res = await apiService.adminCampaignAction(token, id, 'assign_manager', undefined, username || undefined);
    setBusyId('');
    if (!res.success) {
      setNotice(res.error || '담당자 배정에 실패했습니다.');
      return;
    }
    setNotice(`담당자를 @${username} 로 변경했습니다. 진행 중인 협업 담당자도 함께 바뀝니다.`);
    window.setTimeout(() => setNotice(''), 4000);
    load();
  };

  const summary = useMemo(() => {
    const s = {
      total: campaigns.length,
      active: 0,
      pending: 0,
      unassigned: 0,
      listed: 0,
      accepted: 0,
      running: 0,
      margin: 0,
      unpriced: 0,
      // 승인은 났는데 명단이 비어 아무것도 진행되지 않은 캠페인.
      stalled: 0,
    };
    for (const c of campaigns) {
      if (c.status === 'active') s.active++;
      if (c.status === 'pending_approval') s.pending++;
      if (!c.manager_username) s.unassigned++;
      s.listed += num(c.listed_count);
      s.accepted += num(c.accepted_count);
      s.running += num(c.collab_running);
      s.margin += num(c.margin_amount);
      s.unpriced += Math.max(0, num(c.accepted_count) - num(c.priced_count));
      if (c.status === 'active' && num(c.listed_count) === 0) s.stalled++;
    }
    return s;
  }, [campaigns]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = campaigns.filter(c => {
      if (filter === 'unassigned' && c.manager_username) return false;
      if (filter === 'stalled' && !(c.status === 'active' && num(c.listed_count) === 0)) return false;
      if (filter === 'active' && c.status !== 'active') return false;
      if (filter === 'pending_approval' && c.status !== 'pending_approval') return false;
      if (filter === 'inactive' && c.status !== 'inactive') return false;
      if (mode && rewardModeOf(c.reward_mode).value !== mode) return false;
      if (!q) return true;
      return [c.title, c.brand_name, c.business_username, c.manager_username, c.category]
        .some(v => String(v || '').toLowerCase().includes(q));
    });

    // 정렬은 필터를 통과한 목록에만 적용한다. sort() 는 원본을 바꾸므로 복사본에서 한다.
    const sorted = [...rows];
    switch (sort) {
      case 'budget':
        // 예산이 없는 캠페인(제품 협찬형 등)은 아래로. 예산이 같으면 최신 등록이 위.
        sorted.sort((a, b) => num(b.budget_krw) - num(a.budget_krw) || time(b.created_at, 0) - time(a.created_at, 0));
        break;
      case 'deadline':
        // 아직 안 지난 마감이 가까운 순으로 먼저. 이미 지났거나 마감일이 없는 건은 뒤로.
        sorted.sort((a, b) => {
          const ax = time(a.end_date, Number.POSITIVE_INFINITY);
          const bx = time(b.end_date, Number.POSITIVE_INFINITY);
          const now = Date.now();
          const ap = ax < now ? 1 : 0;
          const bp = bx < now ? 1 : 0;
          return ap - bp || ax - bx;
        });
        break;
      case 'applications':
        sorted.sort((a, b) => num(b.application_count) - num(a.application_count) || time(b.created_at, 0) - time(a.created_at, 0));
        break;
      case 'attention':
        sorted.sort((a, b) => attentionScore(b) - attentionScore(a) || time(b.created_at, 0) - time(a.created_at, 0));
        break;
      default:
        sorted.sort((a, b) => time(b.created_at, 0) - time(a.created_at, 0));
    }
    return sorted;
  }, [campaigns, filter, mode, sort, query]);

  const filters: { key: Filter; label: string; count?: number }[] = [
    { key: 'all', label: '전체', count: summary.total },
    { key: 'active', label: '모집중', count: summary.active },
    { key: 'pending_approval', label: '승인 대기', count: summary.pending },
    { key: 'unassigned', label: '담당 미배정', count: summary.unassigned },
    { key: 'stalled', label: '명단 비어있음', count: summary.stalled },
    { key: 'inactive', label: '마감', count: undefined },
  ];

  const needsAttention = summary.pending + summary.unassigned + summary.stalled;

  return (
    <div className="space-y-3">
      {/* 요약 — 네 장으로 줄였다. 자세한 단계별 숫자는 각 줄을 펼쳐서 본다. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-slate-900 to-slate-700 rounded-2xl p-3.5 text-white">
          <p className="text-[9px] font-black text-white/60 uppercase tracking-widest mb-1">전체 캠페인</p>
          <p className="text-xl font-black">{summary.total}건</p>
          <p className="text-[9px] font-bold text-white/50 mt-1">모집중 {summary.active} · 승인대기 {summary.pending}</p>
        </div>

        <button
          type="button"
          onClick={() => { setFilter('all'); setSort('attention'); }}
          className={`text-left rounded-2xl p-3.5 border transition-colors ${
            needsAttention > 0 ? 'bg-amber-50 border-amber-100 hover:bg-amber-100/70' : 'bg-white border-slate-100 hover:bg-slate-50'
          }`}
        >
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">확인 필요</p>
          <p className={`text-xl font-black ${needsAttention > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{needsAttention}건</p>
          <p className="text-[9px] font-bold text-slate-400 mt-1">
            승인대기 {summary.pending} · 미배정 {summary.unassigned} · 명단0 {summary.stalled}
          </p>
        </button>

        <div className="bg-white rounded-2xl border border-slate-100 p-3.5">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">협업 진행</p>
          <p className="text-xl font-black text-amber-600">{summary.running}건</p>
          <p className="text-[9px] font-bold text-slate-400 mt-1">명단 {summary.listed} · 수락 {summary.accepted}</p>
        </div>

        <div className="bg-pink-50 rounded-2xl border border-pink-100 p-3.5">
          <p className="text-[9px] font-black text-pink-500 uppercase tracking-widest mb-1">확정 마진</p>
          <p className="text-xl font-black text-pink-600">{money(summary.margin)}</p>
          <p className="text-[9px] font-bold text-pink-400 mt-1">
            {summary.unpriced > 0 ? `단가 미입력 ${summary.unpriced}건 제외` : '단가 입력 완료'}
          </p>
        </div>
      </div>

      {notice && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
          <p className="text-[11px] font-bold text-blue-700">{notice}</p>
        </div>
      )}

      {/* 분류 · 정렬 · 검색 */}
      <div className="bg-white rounded-2xl border border-slate-100 p-2.5 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg font-black text-[11px] flex items-center gap-1.5 ${
                filter === f.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {f.label}
              {f.count !== undefined && f.count > 0 && (
                <span className={`px-1.5 py-0.5 rounded text-[9px] ${filter === f.key ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-slate-400">진행 방식</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as '' | RewardMode)}
              className="text-[11px] font-black text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400"
            >
              <option value="">전체</option>
              {REWARD_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-slate-400">정렬</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="text-[11px] font-black text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400"
            >
              {SORTS.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </label>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="캠페인 · 브랜드 · 담당자 검색"
            className="text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 w-52 focus:outline-none focus:border-blue-400"
          />
          <span className="text-[11px] font-bold text-slate-400">{visible.length}건</span>
          <button onClick={load} className="ml-auto px-2.5 py-1.5 bg-slate-100 rounded-lg text-[10px] font-black text-slate-500 hover:bg-slate-200">
            새로고침
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-7 h-7 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs font-bold text-slate-400">캠페인 진행 현황을 불러오는 중...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm font-bold text-slate-400">해당 조건의 캠페인이 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="hidden xl:grid grid-cols-[minmax(0,2.6fr)_92px_minmax(0,1.5fr)_140px_104px] gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">캠페인 / 브랜드</div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">상태</div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">진행</div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">담당자</div>
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">기간 · 마진</div>
          </div>

          <div className="divide-y divide-slate-50">
            {visible.map(c => {
              const status = STATUS[c.status] || { cls: 'bg-slate-100 text-slate-500', label: c.status };
              const margin = num(c.margin_amount);
              const brandAmount = num(c.brand_amount);
              const unpriced = Math.max(0, num(c.accepted_count) - num(c.priced_count));
              const stalled = c.status === 'active' && num(c.listed_count) === 0;
              const rm = rewardModeOf(c.reward_mode);
              const left = daysLeft(c.end_date);
              const isOpen = !!expanded[c.id];
              return (
                <div key={c.id} className={isOpen ? 'bg-slate-50/40' : ''}>
                  <div className="xl:grid xl:grid-cols-[minmax(0,2.6fr)_92px_minmax(0,1.5fr)_140px_104px] gap-2 px-3 py-2.5 items-center hover:bg-slate-50/60">
                    {/* 캠페인 — 줄 전체를 열기 버튼으로 두지 않는다. 담당자 select 와
                        클릭이 겹쳐 배정하려다 줄이 펼쳐지는 일이 생긴다. */}
                    <div className="min-w-0 flex items-start gap-1.5">
                      <button
                        type="button"
                        onClick={() => setExpanded(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                        aria-expanded={isOpen}
                        className="mt-0.5 w-4 h-4 shrink-0 flex items-center justify-center rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100"
                        title={isOpen ? '접기' : '단계 · 마진 자세히'}
                      >
                        <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      <div className="min-w-0">
                        <p className="text-[12px] font-black text-slate-900 truncate" title={c.title}>{c.title}</p>
                        <p className="text-[10px] font-bold text-slate-400 truncate">
                          {c.brand_name ? `${c.brand_name} · ` : ''}@{c.business_username}
                          {` · ${rm.label}`}
                          {c.budget_krw ? ` · 예산 ${formatKRW(c.budget_krw)}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="mt-1 xl:mt-0 flex items-center gap-1 flex-wrap">
                      <span className={`${status.cls} px-1.5 py-0.5 rounded text-[9px] font-black whitespace-nowrap`}>{status.label}</span>
                      {stalled && (
                        <span className="bg-red-50 text-red-500 px-1.5 py-0.5 rounded text-[9px] font-black whitespace-nowrap" title="승인됐지만 후보 명단이 비어 있습니다.">
                          명단 0
                        </span>
                      )}
                    </div>

                    {/* 접힌 줄에는 큰 흐름 네 칸만. 브랜드픽·제안은 펼쳤을 때 나온다. */}
                    <div className="mt-1.5 xl:mt-0 flex items-center justify-between xl:justify-center gap-1 bg-slate-50 xl:bg-transparent rounded-lg px-2 py-1 xl:p-0">
                      <Step label="지원" value={num(c.application_count)} />
                      <span className="text-slate-200 text-[10px]">›</span>
                      <Step label="명단" value={num(c.listed_count)} />
                      <span className="text-slate-200 text-[10px]">›</span>
                      <Step label="수락" value={num(c.accepted_count)} tone="text-green-600" />
                      <span className="text-slate-200 text-[10px]">›</span>
                      <Step label="협업" value={num(c.collab_running)} tone="text-amber-600" />
                    </div>

                    <div className="mt-1.5 xl:mt-0">
                      <select
                        value={c.manager_username || ''}
                        disabled={busyId === c.id}
                        onChange={(e) => { if (e.target.value) assign(c.id, e.target.value); }}
                        className={`w-full text-[10px] font-black rounded-lg px-2 py-1.5 border focus:outline-none ${
                          c.manager_username
                            ? 'bg-white border-slate-200 text-slate-700'
                            : 'bg-amber-50 border-amber-200 text-amber-700'
                        } disabled:opacity-50`}
                      >
                        <option value="">담당 미배정</option>
                        {managers.map(m => (
                          <option key={m.username} value={m.username}>
                            {m.displayName ? `${m.displayName} (@${m.username})` : `@${m.username}`}
                          </option>
                        ))}
                        {/* 담당자 목록에 없는(권한이 해제된) 계정이 배정돼 있으면 그대로 보여 준다. */}
                        {c.manager_username && !managers.some(m => m.username === c.manager_username) && (
                          <option value={c.manager_username}>@{c.manager_username} (권한 해제)</option>
                        )}
                      </select>
                    </div>

                    <div className="mt-1.5 xl:mt-0 xl:text-right">
                      <p className="text-[10px] font-bold text-slate-600 whitespace-nowrap">
                        {formatDate(c.start_date)}~{formatDate(c.end_date)}
                        {c.status === 'active' && left !== null && left >= 0 && left <= 7 && (
                          <span className="ml-1 text-red-500">D-{left}</span>
                        )}
                      </p>
                      <p className={`text-[10px] font-black ${margin > 0 ? 'text-pink-600' : margin < 0 ? 'text-red-500' : 'text-slate-300'}`}>
                        {margin !== 0 ? money(margin) : '마진 미확정'}
                      </p>
                    </div>
                  </div>

                  {/* 펼친 내용 — 중간 단계와 마진 근거. 특정 캠페인을 들여다볼 때만 필요하다. */}
                  {isOpen && (
                    <div className="px-3 pb-3 pt-1 grid grid-cols-1 lg:grid-cols-3 gap-2">
                      <div className="rounded-xl border border-slate-100 bg-white p-2.5">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">진행 단계 전체</p>
                        <div className="flex items-center justify-between gap-1">
                          <Step label="지원" value={num(c.application_count)} />
                          <span className="text-slate-200 text-[10px]">›</span>
                          <Step label="명단" value={num(c.listed_count)} />
                          <span className="text-slate-200 text-[10px]">›</span>
                          <Step label="브랜드픽" value={num(c.picked_count)} tone="text-blue-600" />
                          <span className="text-slate-200 text-[10px]">›</span>
                          <Step label="제안" value={num(c.sent_count)} tone="text-indigo-600" />
                          <span className="text-slate-200 text-[10px]">›</span>
                          <Step label="수락" value={num(c.accepted_count)} tone="text-green-600" />
                          <span className="text-slate-200 text-[10px]">›</span>
                          <Step label="협업" value={num(c.collab_running)} tone="text-amber-600" />
                        </div>
                        {num(c.collab_count) > 0 && (
                          <p className="text-[9px] font-bold text-slate-400 mt-1.5">협업 {c.collab_count}건 · 완료 {num(c.collab_done)}</p>
                        )}
                      </div>

                      <div className="rounded-xl border border-slate-100 bg-white p-2.5">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">마진 (제시가 − 지급가)</p>
                        <p className={`text-[13px] font-black ${margin > 0 ? 'text-pink-600' : margin < 0 ? 'text-red-500' : 'text-slate-300'}`}>
                          {margin !== 0 ? money(margin) : '마진 미확정'}
                        </p>
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">
                          {brandAmount > 0
                            ? `제시가 ${formatKRW(brandAmount)} · 지급 ${formatKRW(num(c.influencer_cost))}`
                            : '브랜드 제시가 미입력'}
                          {unpriced > 0 ? ` · 단가 미입력 ${unpriced}건` : ''}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-100 bg-white p-2.5">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">캠페인 정보</p>
                        <p className="text-[10px] font-bold text-slate-600">진행 방식 {rm.label}</p>
                        <p className="text-[10px] font-bold text-slate-600">카테고리 {c.category || '-'}</p>
                        <p className="text-[10px] font-bold text-slate-600">
                          모집 {formatDate(c.start_date)} ~ {formatDate(c.end_date)}
                        </p>
                        <p className="text-[9px] font-bold text-slate-300 mt-0.5">등록 {formatDate(c.created_at)}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[10px] font-bold text-slate-400">
        줄 왼쪽 화살표를 누르면 브랜드 픽 · 제안 단계와 마진 계산 근거를 볼 수 있습니다.
        진행 단계는 지원자 수 → 리스트업 후보 → 브랜드가 진행 요청한 후보 → 담당자가 조건을 보낸 후보 → 수락한 후보 → 진행 중 협업 순입니다.
        마진은 브랜드 제시가와 인플루언서 단가가 모두 입력된 수락 후보만 집계합니다.
      </p>
    </div>
  );
};

export default AdminCampaignBoard;
