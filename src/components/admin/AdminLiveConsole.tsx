import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKRW } from '../../utils/formatters';

interface Ongoing {
  username: string;
  isLive: boolean;
  viewerCount: number;
  currentProduct: any;
  activeMaterial: any;
  updatedAt: string | null;
  revenue?: number;
}

interface History {
  id: string;
  username: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  peak_viewers: number;
  total_messages: number;
  products: any[];
  cart_stats: any;
  highlight: boolean;
  highlight_note?: string | null;
  force_ended_by?: string | null;
  force_end_reason?: string | null;
  revenue?: number;
}

interface FlaggedMessage {
  id: string;
  broadcast_username: string;
  viewer_user?: string | null;
  message: string;
  matched_word?: string | null;
  reason?: string | null;
  status: 'flagged' | 'allowed' | 'blocked' | 'hidden';
  created_at: string;
}

interface Rule {
  id: string;
  word: string;
  severity: 'flag' | 'block';
  created_at: string;
}

interface UsageRow {
  username: string;
  totalMinutes: number;
  todayMinutes: number;
  sessions: number;
  lastStartedAt: string | null;
  includedMinutes: number;
  includedMinutesRemaining: number;
  overageMinutes: number;
  overageAmountKrw: number;
  monthlyHardCapReached: boolean;
  dailyHardCapReached: boolean;
  isLive: boolean;
}

interface UsagePricing {
  includedMinutesPerMonth: number;
  monthlyHardCapMinutes: number;
  dailyHardCapMinutes: number;
  overageRateKrwPerMinute: number;
}

interface Props { token: string; }

const won = (n: number) => formatKRW(n);

const formatHm = (mins: number) => {
  const m = Math.max(0, Math.floor(mins || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}분`;
  return r === 0 ? `${h}시간` : `${h}시간 ${r}분`;
};

const AdminLiveConsole: React.FC<Props> = ({ token }) => {
  const [ongoing, setOngoing] = useState<Ongoing[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [flagged, setFlagged] = useState<FlaggedMessage[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [usagePricing, setUsagePricing] = useState<UsagePricing | null>(null);
  const [usageMonthLabel, setUsageMonthLabel] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<'live' | 'history' | 'usage' | 'moderation'>('live');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newWord, setNewWord] = useState('');
  const [newSeverity, setNewSeverity] = useState<'flag' | 'block'>('flag');
  const [historySearch, setHistorySearch] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async (opts?: { username?: string }) => {
    setLoading(true);
    const [overview, modr, usage] = await Promise.all([
      apiService.getAdminLiveOverview(token, opts?.username ? { username: opts.username } : undefined),
      apiService.getAdminChatModeration(token),
      apiService.getAdminLiveUsage(token),
    ]);
    setOngoing(overview.ongoing || []);
    setHistory(overview.history || []);
    setFlagged(modr.flagged || []);
    setRules(modr.rules || []);
    setUsageRows(usage?.users || []);
    setUsagePricing(usage?.pricing || null);
    setUsageMonthLabel(usage?.monthLabel || '');
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Debounce the history search box and re-fetch only the history slice.
  useEffect(() => {
    const t = setTimeout(() => setHistoryQuery(historySearch.trim()), 250);
    return () => clearTimeout(t);
  }, [historySearch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      const overview = await apiService.getAdminLiveOverview(
        token,
        historyQuery ? { username: historyQuery } : undefined,
      );
      if (cancelled) return;
      setHistory(overview.history || []);
      setHistoryLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQuery]);

  const totalViewers = useMemo(() => ongoing.reduce((s, r) => s + (r.viewerCount || 0), 0), [ongoing]);
  const totalRevenue = useMemo(() => ongoing.reduce((s, r) => s + (r.revenue || 0), 0), [ongoing]);

  const forceEnd = async (username: string) => {
    const reason = window.prompt(`@${username} 방송을 강제 종료하시겠습니까?\n사유를 입력하세요.`, '약관 위반');
    if (!reason) return;
    setBusyId(username);
    const ok = await apiService.forceEndBroadcast(token, username, reason);
    setBusyId(null);
    if (ok) load();
  };

  const toggleHighlight = async (h: History) => {
    setBusyId(h.id);
    let note = h.highlight_note || '';
    if (!h.highlight) {
      const next = window.prompt('하이라이트 메모(선택):', '');
      note = next || '';
    }
    const ok = await apiService.markBroadcastHighlight(token, h.username, h.id, !h.highlight, note);
    setBusyId(null);
    if (ok) {
      setHistory(prev => prev.map(x => x.id === h.id ? { ...x, highlight: !h.highlight, highlight_note: !h.highlight ? note : null } : x));
    }
  };

  const reviewFlagged = async (id: string, status: 'allowed' | 'blocked' | 'hidden') => {
    setBusyId(id);
    const ok = await apiService.chatModerationAction(token, { action: 'review', id, status });
    setBusyId(null);
    if (ok) setFlagged(prev => prev.map(f => f.id === id ? { ...f, status } : f));
  };

  const addRule = async () => {
    if (!newWord.trim()) return;
    setBusyId('add_rule');
    const ok = await apiService.chatModerationAction(token, { action: 'add_rule', word: newWord.trim(), severity: newSeverity });
    setBusyId(null);
    if (ok) {
      setNewWord('');
      load();
    }
  };

  const deleteRule = async (id: string) => {
    setBusyId(id);
    const ok = await apiService.chatModerationAction(token, { action: 'delete_rule', id });
    setBusyId(null);
    if (ok) setRules(prev => prev.filter(r => r.id !== id));
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
        <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 font-bold text-sm">라이브 데이터 로딩 중...</p>
      </div>
    );
  }

  const flaggedPending = flagged.filter(f => f.status === 'flagged');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">진행 중인 방송</p>
          <p className="text-2xl font-black text-rose-500">{ongoing.length}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">동시 시청자</p>
          <p className="text-2xl font-black text-blue-600">{totalViewers}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">실시간 매출 추정</p>
          <p className="text-xl font-black text-indigo-600">{won(totalRevenue)}</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">미처리 신고</p>
          <p className="text-2xl font-black text-amber-600">{flaggedPending.length}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {(['live', 'history', 'usage', 'moderation'] as const).map(k => (
          <button
            key={k}
            onClick={() => setSection(k)}
            className={`px-4 py-2 rounded-xl font-black text-xs ${
              section === k ? 'bg-slate-900 text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-200'
            }`}
          >
            {k === 'live' ? '진행 중' : k === 'history' ? '사후 리포트' : k === 'usage' ? '송출 시간 (월별)' : `채팅 모더레이션 ${flaggedPending.length > 0 ? `(${flaggedPending.length})` : ''}`}
          </button>
        ))}
        <button onClick={() => load()} className="ml-auto px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200">새로고침</button>
      </div>

      {section === 'live' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h3 className="font-black text-slate-900">진행 중 방송</h3>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">실시간 시청자, 매출, 강제 종료</p>
          </div>
          <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
            {ongoing.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm font-bold">현재 진행 중인 방송이 없습니다.</div>
            ) : ongoing.map(o => (
              <div key={o.username} className="px-5 py-4 flex items-center gap-3 flex-wrap">
                <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-900 text-sm">@{o.username}</p>
                  <p className="text-[10px] font-bold text-slate-400">{o.currentProduct?.name ? `현재 상품: ${o.currentProduct.name}` : '상품 정보 없음'}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400">시청자</p>
                  <p className="font-black text-blue-600">{o.viewerCount}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400">매출(추정)</p>
                  <p className="font-black text-indigo-600 text-sm">{won(o.revenue || 0)}</p>
                </div>
                <button
                  onClick={() => forceEnd(o.username)}
                  disabled={busyId === o.username}
                  className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-[11px] font-black hover:bg-red-100 disabled:opacity-50"
                >
                  {busyId === o.username ? '처리중...' : '강제 종료'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'history' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-black text-slate-900">방송 사후 리포트</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">피크 시청자, 메시지, 하이라이트 클립 보관</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  placeholder="유저명으로 검색 (예: john)"
                  className="pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold w-56 focus:outline-none focus:border-slate-400"
                />
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                {historySearch && (
                  <button
                    onClick={() => setHistorySearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs font-black"
                    aria-label="검색 지우기"
                  >×</button>
                )}
              </div>
              {historyLoading && (
                <span className="text-[10px] font-bold text-slate-400">검색 중...</span>
              )}
            </div>
          </div>
          <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
            {history.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm font-bold">
                {historyQuery ? `@${historyQuery} 으로 시작하는 유저의 방송 이력이 없습니다.` : '방송 이력이 없습니다.'}
              </div>
            ) : history.map(h => {
              const cs: any = h.cart_stats || {};
              return (
                <div key={h.id} className="px-5 py-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-black text-slate-900 text-sm">@{h.username}</p>
                    <span className="text-[10px] font-bold text-slate-400">
                      {new Date(h.started_at).toLocaleString('ko-KR')} · {h.duration_minutes}분
                    </span>
                    {h.highlight && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-black rounded">★ 하이라이트</span>}
                    {h.force_end_reason && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-black rounded">강제 종료</span>}
                    <button
                      onClick={() => toggleHighlight(h)}
                      disabled={busyId === h.id}
                      className={`ml-auto px-2.5 py-1 rounded-lg text-[10px] font-black ${
                        h.highlight ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      } disabled:opacity-50`}
                    >
                      {h.highlight ? '하이라이트 해제' : '하이라이트로 보관'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-[9px] font-black text-slate-400 uppercase">피크 시청자</p>
                      <p className="font-black text-slate-900 mt-0.5">{h.peak_viewers}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-[9px] font-black text-slate-400 uppercase">메시지</p>
                      <p className="font-black text-slate-900 mt-0.5">{h.total_messages}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-[9px] font-black text-slate-400 uppercase">상품 수</p>
                      <p className="font-black text-slate-900 mt-0.5">{Array.isArray(h.products) ? h.products.length : 0}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-[9px] font-black text-slate-400 uppercase">장바구니 담김</p>
                      <p className="font-black text-slate-900 mt-0.5">{cs.totalItems || 0}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-[9px] font-black text-slate-400 uppercase">매출</p>
                      <p className="font-black text-indigo-600 mt-0.5">{won(h.revenue || 0)}</p>
                    </div>
                  </div>
                  {h.force_end_reason && (
                    <p className="text-[10px] font-bold text-red-500">강제 종료 사유: {h.force_end_reason}</p>
                  )}
                  {h.highlight_note && (
                    <p className="text-[10px] font-bold text-amber-600">하이라이트 메모: {h.highlight_note}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {section === 'usage' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-black text-slate-900">유저별 라이브 송출 시간</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                {usageMonthLabel ? `${usageMonthLabel} 기준 (UTC) · ` : ''}
                포함 {usagePricing ? Math.floor(usagePricing.includedMinutesPerMonth / 60) : 5}시간 / 월 · 월 한도 {usagePricing ? Math.floor(usagePricing.monthlyHardCapMinutes / 60) : 50}시간 / 일 한도 {usagePricing ? Math.floor(usagePricing.dailyHardCapMinutes / 60) : 8}시간 도달 시 자동 차단
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
              <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md">정상</span>
              <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-md">초과 (후불)</span>
              <span className="px-2 py-1 bg-red-50 text-red-700 rounded-md">한도 도달</span>
            </div>
          </div>
          <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-2.5 border-b border-slate-100 bg-slate-50/50">
            <div className="col-span-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">유저</div>
            <div className="col-span-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">이번 달 송출</div>
            <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">오늘</div>
            <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">초과 후불</div>
            <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">상태</div>
          </div>
          <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
            {usageRows.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm font-bold">이번 달 송출 기록이 없습니다.</div>
            ) : usageRows.map(u => {
              const monthlyCap = usagePricing?.monthlyHardCapMinutes || 3000;
              const includedCap = usagePricing?.includedMinutesPerMonth || 300;
              const monthlyPct = Math.min(100, Math.round((u.totalMinutes / monthlyCap) * 100));
              const includedPct = Math.min(100, Math.round((Math.min(u.totalMinutes, includedCap) / includedCap) * 100));
              const overage = u.overageMinutes > 0;
              const barColor = u.monthlyHardCapReached
                ? 'bg-red-500'
                : overage
                  ? 'bg-amber-500'
                  : 'bg-emerald-500';
              return (
                <div key={u.username} className="px-5 py-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                  <div className="md:col-span-3 flex items-center gap-2 min-w-0">
                    {u.isLive && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />}
                    <span className="font-black text-slate-900 text-sm truncate">@{u.username}</span>
                    <span className="text-[10px] font-bold text-slate-400 shrink-0">{u.sessions}회</span>
                  </div>
                  <div className="md:col-span-3 min-w-0">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-xs font-black text-slate-700">{formatHm(u.totalMinutes)}</span>
                      <span className="text-[10px] font-bold text-slate-400">/ {Math.floor(monthlyCap / 60)}h</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${barColor} transition-all`} style={{ width: `${monthlyPct}%` }} />
                    </div>
                    <p className="text-[9px] font-bold text-slate-400 mt-0.5">
                      포함 {formatHm(u.includedMinutes)} / {formatHm(includedCap)} ({includedPct}%)
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs font-black text-slate-700">{formatHm(u.todayMinutes)}</p>
                    <p className="text-[9px] font-bold text-slate-400">/ {Math.floor((usagePricing?.dailyHardCapMinutes || 480) / 60)}h</p>
                  </div>
                  <div className="md:col-span-2">
                    {overage ? (
                      <>
                        <p className="text-xs font-black text-amber-600">{won(u.overageAmountKrw)}</p>
                        <p className="text-[9px] font-bold text-amber-500">+{formatHm(u.overageMinutes)}</p>
                      </>
                    ) : (
                      <p className="text-[10px] font-bold text-slate-300">—</p>
                    )}
                  </div>
                  <div className="md:col-span-2 flex flex-wrap gap-1">
                    {u.monthlyHardCapReached && (
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-black rounded">월 한도 도달</span>
                    )}
                    {u.dailyHardCapReached && (
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-black rounded">오늘 한도 도달</span>
                    )}
                    {!u.monthlyHardCapReached && !u.dailyHardCapReached && overage && (
                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-black rounded">초과 사용</span>
                    )}
                    {!u.monthlyHardCapReached && !u.dailyHardCapReached && !overage && (
                      <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-black rounded">정상</span>
                    )}
                    {u.isLive && (
                      <span className="px-1.5 py-0.5 bg-rose-100 text-rose-700 text-[9px] font-black rounded">방송 중</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40">
            <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
              월 {usagePricing ? Math.floor(usagePricing.monthlyHardCapMinutes / 60) : 50}시간 또는 일 {usagePricing ? Math.floor(usagePricing.dailyHardCapMinutes / 60) : 8}시간 한도에 도달한 유저는 다음 송출 시작 시 자동으로 차단됩니다(스트림 키 발급 거부). 별도 수동 차단 작업은 필요하지 않으며, 진행 중인 방송을 즉시 종료하려면 "진행 중" 탭에서 강제 종료를 사용하세요.
            </p>
          </div>
        </div>
      )}

      {section === 'moderation' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h3 className="font-black text-slate-900">감지된 욕설/스팸</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">운영자 승인 후 차단/숨김 처리</p>
            </div>
            <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
              {flagged.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm font-bold">감지된 메시지가 없습니다.</div>
              ) : flagged.map(f => (
                <div key={f.id} className="px-5 py-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-black text-slate-900 text-xs">@{f.broadcast_username}</span>
                    <span className="text-[10px] font-bold text-slate-400">{f.viewer_user || '익명'}</span>
                    <span className="text-[10px] font-bold text-slate-300">· {new Date(f.created_at).toLocaleString('ko-KR')}</span>
                    {f.matched_word && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-black rounded">{f.matched_word}</span>}
                    <span className={`ml-auto px-1.5 py-0.5 text-[9px] font-black rounded ${
                      f.status === 'flagged' ? 'bg-amber-100 text-amber-700' :
                      f.status === 'blocked' ? 'bg-red-100 text-red-700' :
                      f.status === 'hidden' ? 'bg-slate-100 text-slate-600' :
                      'bg-green-100 text-green-700'
                    }`}>
                      {f.status === 'flagged' ? '검토대기' : f.status === 'blocked' ? '차단' : f.status === 'hidden' ? '숨김' : '허용'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 font-medium mb-2">{f.message}</p>
                  {f.status === 'flagged' && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => reviewFlagged(f.id, 'blocked')}
                        disabled={busyId === f.id}
                        className="px-2.5 py-1 bg-red-50 text-red-600 rounded-lg text-[10px] font-black hover:bg-red-100 disabled:opacity-50"
                      >차단</button>
                      <button
                        onClick={() => reviewFlagged(f.id, 'hidden')}
                        disabled={busyId === f.id}
                        className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-50"
                      >숨김</button>
                      <button
                        onClick={() => reviewFlagged(f.id, 'allowed')}
                        disabled={busyId === f.id}
                        className="px-2.5 py-1 bg-green-50 text-green-600 rounded-lg text-[10px] font-black hover:bg-green-100 disabled:opacity-50"
                      >허용</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h3 className="font-black text-slate-900">금칙어 룰</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">flag(감지만) / block(자동 차단)</p>
            </div>
            <div className="p-4 border-b border-slate-100 space-y-2">
              <input
                type="text"
                value={newWord}
                onChange={e => setNewWord(e.target.value)}
                placeholder="금칙어 입력"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-slate-400"
              />
              <div className="flex items-center gap-2">
                <select
                  value={newSeverity}
                  onChange={e => setNewSeverity(e.target.value as 'flag' | 'block')}
                  className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
                >
                  <option value="flag">flag</option>
                  <option value="block">block</option>
                </select>
                <button
                  onClick={addRule}
                  disabled={!newWord.trim() || busyId === 'add_rule'}
                  className="ml-auto px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-black disabled:opacity-50"
                >추가</button>
              </div>
            </div>
            <div className="divide-y divide-slate-50 max-h-[400px] overflow-y-auto">
              {rules.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-xs font-bold">등록된 금칙어가 없습니다.</div>
              ) : rules.map(r => (
                <div key={r.id} className="px-4 py-2.5 flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 text-[9px] font-black rounded ${
                    r.severity === 'block' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>{r.severity}</span>
                  <span className="font-bold text-slate-700 text-sm flex-1 truncate">{r.word}</span>
                  <button
                    onClick={() => deleteRule(r.id)}
                    disabled={busyId === r.id}
                    className="text-[10px] font-black text-slate-400 hover:text-red-500 disabled:opacity-50"
                  >삭제</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminLiveConsole;
