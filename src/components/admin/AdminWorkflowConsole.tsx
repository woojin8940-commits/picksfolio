import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKRW } from '../../utils/formatters';
import type { BusinessProposal } from '../../types';

interface CategoryStat {
  total: number; accepted: number; rejected: number; completed: number; totalFee: number;
}
interface FeeBucket { bucket: string; total: number; accepted: number; rejected: number; acceptanceRate: number; }
interface RejectionGroup { label: string; count: number; samples: string[]; }

interface Analytics {
  categoryStats: Record<string, CategoryStat>;
  feeBucketStats: FeeBucket[];
  rejectionStats: RejectionGroup[];
  recentRejectionRate: number;
  recentTotal: number;
}

interface TimelineEvent {
  kind: 'proposal' | 'collab' | 'settlement';
  status: string;
  date: string;
  title: string;
  amount?: number;
  meta?: Record<string, any>;
}

interface Props {
  token: string;
  proposals: (BusinessProposal & { _username: string })[];
}

type CategoryFilter = 'all' | '광고' | '커머스';
type FeeBucketFilter = 'all' | '0-100k' | '100k-500k' | '500k-1M' | '1M-5M' | '5M+';

const won = (n: number) => formatKRW(n);

const AdminWorkflowConsole: React.FC<Props> = ({ token, proposals }) => {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [feeFilter, setFeeFilter] = useState<FeeBucketFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected' | 'completed'>('all');
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[] | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await apiService.getAdminProposalsAnalytics(token);
    setAnalytics(data);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const inFeeBucket = (fee: number, b: FeeBucketFilter): boolean => {
    if (b === 'all') return true;
    if (b === '0-100k') return fee < 100000;
    if (b === '100k-500k') return fee >= 100000 && fee < 500000;
    if (b === '500k-1M') return fee >= 500000 && fee < 1000000;
    if (b === '1M-5M') return fee >= 1000000 && fee < 5000000;
    if (b === '5M+') return fee >= 5000000;
    return true;
  };

  const filtered = useMemo(() => {
    return proposals.filter(p => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!inFeeBucket(p.fee || 0, feeFilter)) return false;
      return true;
    });
  }, [proposals, categoryFilter, feeFilter, statusFilter]);

  const openTimeline = async (id: string) => {
    setSelectedProposalId(id);
    setTimelineEvents(null);
    setTimelineLoading(true);
    const data = await apiService.getAdminProposalTimeline(token, id);
    setTimelineEvents(data?.events || []);
    setTimelineLoading(false);
  };

  const closeTimeline = () => {
    setSelectedProposalId(null);
    setTimelineEvents(null);
  };

  if (loading || !analytics) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
        <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 font-bold text-sm">워크플로 분석 로딩 중...</p>
      </div>
    );
  }

  const totalRejection = analytics.rejectionStats.reduce((s, r) => s + r.count, 0);
  const categoryEntries = Object.entries(analytics.categoryStats);

  return (
    <div className="space-y-4">
      {/* Aggregate cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h3 className="font-black text-slate-900 mb-3">카테고리별 현황</h3>
          {categoryEntries.length === 0 ? (
            <p className="text-slate-400 text-sm font-bold py-4 text-center">아직 데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {categoryEntries.map(([cat, s]) => {
                const acceptanceRate = s.total > 0 ? Math.round(((s.accepted + s.completed) / s.total) * 100) : 0;
                return (
                  <div key={cat} className="flex items-center gap-3 text-xs">
                    <span className="font-black text-slate-900 w-16">{cat}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div className="bg-green-500 h-full" style={{ width: `${acceptanceRate}%` }} />
                    </div>
                    <span className="font-black text-green-600 w-10 text-right">{acceptanceRate}%</span>
                    <span className="font-bold text-slate-400 w-20 text-right">{won(s.totalFee)}</span>
                    <span className="font-bold text-slate-400 w-12 text-right">{s.total}건</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h3 className="font-black text-slate-900 mb-3">금액 구간별 수락률</h3>
          {analytics.feeBucketStats.length === 0 ? (
            <p className="text-slate-400 text-sm font-bold py-4 text-center">아직 데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {analytics.feeBucketStats.map(b => (
                <div key={b.bucket} className="flex items-center gap-3 text-xs">
                  <span className="font-black text-slate-900 w-20">{b.bucket}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div className="bg-blue-500 h-full" style={{ width: `${b.acceptanceRate}%` }} />
                  </div>
                  <span className="font-black text-blue-600 w-10 text-right">{b.acceptanceRate}%</span>
                  <span className="font-bold text-slate-400 w-12 text-right">{b.total}건</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="font-black text-slate-900">거절 사유 통계</h3>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">광고주 피드백·매칭 개선용. 최근 30일 거절률 {analytics.recentRejectionRate}% (총 {analytics.recentTotal}건)</p>
          </div>
          <span className="text-[10px] font-bold text-slate-400">분류된 거절: {totalRejection}건</span>
        </div>
        {analytics.rejectionStats.length === 0 ? (
          <p className="text-slate-400 text-sm font-bold py-4 text-center">거절 사유 데이터가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {analytics.rejectionStats.map(r => {
              const pct = totalRejection > 0 ? Math.round((r.count / totalRejection) * 100) : 0;
              return (
                <div key={r.label}>
                  <div className="flex items-center gap-3 text-xs mb-1">
                    <span className="font-black text-slate-900 w-32 shrink-0">{r.label}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div className="bg-red-400 h-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-black text-red-500 w-10 text-right">{pct}%</span>
                    <span className="font-bold text-slate-400 w-12 text-right">{r.count}건</span>
                  </div>
                  {r.samples.length > 0 && (
                    <div className="ml-32 text-[10px] text-slate-400 italic truncate">"{r.samples[0]}"</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <h3 className="font-black text-slate-900">제안 다중 필터 + 타임라인 추적</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value as CategoryFilter)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
            >
              <option value="all">카테고리 전체</option>
              <option value="광고">광고</option>
              <option value="커머스">커머스</option>
            </select>
            <select
              value={feeFilter}
              onChange={e => setFeeFilter(e.target.value as FeeBucketFilter)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
            >
              <option value="all">금액 전체</option>
              <option value="0-100k">10만원 미만</option>
              <option value="100k-500k">10~50만</option>
              <option value="500k-1M">50~100만</option>
              <option value="1M-5M">100~500만</option>
              <option value="5M+">500만 이상</option>
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold"
            >
              <option value="all">상태 전체</option>
              <option value="pending">대기중</option>
              <option value="accepted">수락됨</option>
              <option value="rejected">거절됨</option>
              <option value="completed">완료</option>
            </select>
          </div>
        </div>
        <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm font-bold">조건에 맞는 제안이 없습니다.</div>
          ) : filtered.map(p => (
            <div key={p.id} className="px-5 py-3 flex items-center gap-3 flex-wrap hover:bg-slate-50/50 cursor-pointer" onClick={() => openTimeline(p.id)}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                    p.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                    p.status === 'accepted' ? 'bg-green-100 text-green-700' :
                    p.status === 'rejected' ? 'bg-red-100 text-red-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>{p.status}</span>
                  <span className="text-[10px] font-bold text-slate-400">{p.category}</span>
                  <span className="text-[10px] font-bold text-blue-600">@{p._username}</span>
                </div>
                <p className="font-black text-slate-900 text-sm truncate">{p.title}</p>
                <p className="text-[10px] font-bold text-slate-400 truncate">{p.company_name}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-black text-blue-600 text-sm">{won(p.fee)}</p>
                <p className="text-[10px] font-bold text-slate-300">타임라인 보기 →</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline Drawer */}
      {selectedProposalId && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/50 p-4" onClick={closeTimeline}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-black text-slate-900">제안 타임라인</h3>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5">제안 → 협업 → 정산</p>
              </div>
              <button onClick={closeTimeline} className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-black hover:bg-slate-200">닫기</button>
            </div>
            <div className="p-5">
              {timelineLoading ? (
                <div className="text-center py-8">
                  <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-slate-400 text-xs font-bold">로딩...</p>
                </div>
              ) : timelineEvents && timelineEvents.length > 0 ? (
                <div className="relative pl-6">
                  <div className="absolute left-2 top-2 bottom-2 w-px bg-slate-200" />
                  {timelineEvents.map((e, i) => (
                    <div key={i} className="relative mb-4 last:mb-0">
                      <div className={`absolute -left-[18px] top-1 w-3 h-3 rounded-full border-2 border-white ${
                        e.kind === 'proposal' ? 'bg-blue-500' :
                        e.kind === 'collab' ? 'bg-amber-500' :
                        'bg-blue-500'
                      }`} />
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`px-1.5 py-0.5 text-[9px] font-black rounded uppercase ${
                          e.kind === 'proposal' ? 'bg-blue-100 text-blue-700' :
                          e.kind === 'collab' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{e.kind}</span>
                        <span className="text-[10px] font-bold text-slate-400">{new Date(e.date).toLocaleString('ko-KR')}</span>
                      </div>
                      <p className="font-black text-slate-900 text-sm">{e.title}</p>
                      {e.amount != null && e.amount > 0 && (
                        <p className="text-xs font-black text-indigo-600">{won(e.amount)}</p>
                      )}
                      {e.meta?.reason && (
                        <p className="text-[10px] font-bold text-red-500">사유: {e.meta.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-slate-400 text-sm font-bold py-8">이벤트가 없습니다.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminWorkflowConsole;
