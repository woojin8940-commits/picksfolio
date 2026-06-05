import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKRW } from '../../utils/formatters';

interface Settlement {
  id: string;
  proposal_id: string;
  influencer_username: string;
  business_username: string;
  company_name?: string;
  title: string;
  amount: number;
  scheduled_date: string;
  status: 'scheduled' | 'pending' | 'completed';
  completed_at?: string | null;
  memo?: string | null;
}

interface Summary {
  total: number;
  scheduled: number;
  pending: number;
  completed: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
}

interface Ranking {
  username?: string;
  key?: string;
  companyName?: string;
  totalAmount: number;
  paidAmount: number;
  settlementCount?: number;
  count?: number;
  proposalAmount?: number;
  settlementAmount?: number;
  pendingAmount?: number;
}

interface Props {
  token: string;
}

const won = (n: number) => formatKRW(n);

const AdminSettlementConsole: React.FC<Props> = ({ token }) => {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [influencerRanking, setInfluencerRanking] = useState<Ranking[]>([]);
  const [businessRanking, setBusinessRanking] = useState<Ranking[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'pending' | 'completed'>('all');

  const load = async () => {
    setLoading(true);
    const data = await apiService.getAdminSettlementsOverview(token);
    setSettlements(data.settlements || []);
    setSummary(data.summary || null);
    setInfluencerRanking(data.influencerRanking || []);
    setBusinessRanking(data.businessRanking || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return settlements;
    return settlements.filter(s => s.status === statusFilter);
  }, [settlements, statusFilter]);

  // Cumulative GMV including accepted-but-not-yet-settled proposals. This is the
  // basis the TOP rankings use, so we surface it as its own labeled card to
  // reconcile it against the settlement-only "총 거래액".
  const acceptedInclusiveTotal = useMemo(
    () => influencerRanking.reduce((sum, r) => sum + (r.totalAmount || 0), 0),
    [influencerRanking]
  );

  // With only a handful of advertisers/influencers a "TOP 랭킹" framing is
  // overkill — fall back to a plain list until enough rows accumulate.
  const RANKING_MIN_FOR_TOP = 3;

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
        <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 font-bold text-sm">정산 데이터 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary && (
        <>
          <div className="bg-blue-50/60 border border-blue-100 rounded-2xl px-4 py-3">
            <p className="text-[11px] font-bold text-slate-600 leading-relaxed">
              <span className="font-black text-slate-800">집계 기준 안내</span> · 상단
              <span className="font-black text-slate-700"> 총 거래액</span>은 생성된 정산 내역만 더한
              <span className="font-black"> 정산 기준</span>이고, 아래 TOP 랭킹과
              <span className="font-black text-slate-700"> 누적 거래액(수락 제안 포함)</span> 카드는 아직 정산이 생성되지
              않은 <span className="font-black">수락된 제안 금액까지 포함</span>합니다. 두 수치가 다를 수 있습니다.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">총 거래액</p>
                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[8px] font-black">정산 기준</span>
              </div>
              <p className="text-xl font-black text-slate-900">{won(summary.totalAmount)}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">누적 거래액</p>
                <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 text-[8px] font-black">수락 제안 포함</span>
              </div>
              <p className="text-xl font-black text-indigo-600">{won(acceptedInclusiveTotal)}</p>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">랭킹 합계 기준</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">정산 완료</p>
              <p className="text-xl font-black text-blue-600">{won(summary.paidAmount)}</p>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">{summary.completed}건</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">미지급 잔액</p>
              <p className="text-xl font-black text-amber-600">{won(summary.pendingAmount)}</p>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">{summary.scheduled + summary.pending}건</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">총 건수</p>
              <p className="text-xl font-black text-slate-900">{summary.total}</p>
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-900">
                {influencerRanking.length >= RANKING_MIN_FOR_TOP ? '인플루언서별 누적 거래액 TOP' : '인플루언서별 누적 거래액'}
              </h3>
              <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 text-[8px] font-black shrink-0">수락 제안 포함</span>
            </div>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">정산 + 수락된 제안 합계 기준</p>
          </div>
          <div className="divide-y divide-slate-50 max-h-[400px] overflow-y-auto">
            {influencerRanking.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm font-bold">데이터 없음</div>
            ) : influencerRanking.slice(0, 30).map((r, i) => {
              const showRank = influencerRanking.length >= RANKING_MIN_FOR_TOP;
              return (
                <div key={r.username || i} className="px-4 py-3 flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black ${
                    showRank && i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                  }`}>{showRank ? i + 1 : '·'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 text-sm truncate">@{r.username}</p>
                    <p className="text-[10px] font-bold text-slate-400">정산 {r.settlementCount || 0}건 · 완료 {won(r.paidAmount)}</p>
                  </div>
                  <p className="font-black text-blue-600 text-sm shrink-0">{won(r.totalAmount)}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-slate-900">
                {businessRanking.length >= RANKING_MIN_FOR_TOP ? '광고주별 누적 거래액 TOP' : '광고주별 누적 거래액'}
              </h3>
              <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 text-[8px] font-black shrink-0">수락 제안 포함</span>
            </div>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">광고주별 정산/제안 금액 합계</p>
          </div>
          <div className="divide-y divide-slate-50 max-h-[400px] overflow-y-auto">
            {businessRanking.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm font-bold">데이터 없음</div>
            ) : businessRanking.slice(0, 30).map((r, i) => {
              const showRank = businessRanking.length >= RANKING_MIN_FOR_TOP;
              return (
                <div key={r.key || i} className="px-4 py-3 flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black ${
                    showRank && i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                  }`}>{showRank ? i + 1 : '·'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 text-sm truncate">{r.companyName}</p>
                    <p className="text-[10px] font-bold text-slate-400">건수 {r.count || 0}건 · 미지급 {won(r.pendingAmount || 0)}</p>
                  </div>
                  <p className="font-black text-indigo-600 text-sm shrink-0">{won(r.totalAmount)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-black text-slate-900">정산 현황</h3>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">예정 → 진행 → 완료 워크플로</p>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {(['all', 'scheduled', 'pending', 'completed'] as const).map(k => (
              <button
                key={k}
                onClick={() => setStatusFilter(k)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                  statusFilter === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {k === 'all' ? '전체' : k === 'scheduled' ? '예정' : k === 'pending' ? '진행' : '완료'}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
          <div className="col-span-3">광고주 / 제안</div>
          <div className="col-span-2">인플루언서</div>
          <div className="col-span-2">금액</div>
          <div className="col-span-2">예정일</div>
          <div className="col-span-1">상태</div>
          <div className="col-span-2">완료일</div>
        </div>
        <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm font-bold">표시할 정산 내역이 없습니다.</div>
          ) : filtered.map(s => (
            <div key={s.id} className="md:grid md:grid-cols-12 gap-2 px-5 py-3 items-center hover:bg-slate-50/50">
              <div className="md:col-span-3 min-w-0">
                <p className="font-black text-slate-900 text-sm truncate">{s.company_name || s.business_username}</p>
                <p className="text-[10px] font-bold text-slate-400 truncate">{s.title}</p>
              </div>
              <div className="md:col-span-2"><p className="font-bold text-blue-600 text-xs">@{s.influencer_username}</p></div>
              <div className="md:col-span-2"><p className="font-black text-slate-900 text-sm">{won(s.amount)}</p></div>
              <div className="md:col-span-2"><p className="text-xs font-bold text-slate-500">{s.scheduled_date}</p></div>
              <div className="md:col-span-1">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                  s.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                  s.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                  'bg-slate-100 text-slate-600'
                }`}>{s.status === 'completed' ? '완료' : s.status === 'pending' ? '진행' : '예정'}</span>
              </div>
              <div className="md:col-span-2"><p className="text-[10px] font-bold text-slate-400">{s.completed_at ? new Date(s.completed_at).toLocaleDateString('ko-KR') : '-'}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminSettlementConsole;
