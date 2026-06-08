import React, { useState, useEffect, useMemo } from 'react';
import type { Settlement } from '../types';
import { formatKRW } from '../utils/formatters';

interface UserSettlementProps {
  userName: string;
  // When rendered inside the 협업 현황 정산금 tab, drop the standalone page padding
  // and the big page title so it sits cleanly within the tab.
  embedded?: boolean;
}

const UserSettlement: React.FC<UserSettlementProps> = ({ userName, embedded = false }) => {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSettlements = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settlements/${encodeURIComponent(userName)}?role=influencer`);
      if (res.ok) {
        const data = await res.json();
        setSettlements(data.settlements || []);
      }
    } catch (e) {
      console.error('Failed to fetch settlements:', e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchSettlements(); }, [userName]);

  const scheduledSettlements = useMemo(() =>
    settlements.filter(s => s.status === 'scheduled' || s.status === 'pending')
      .sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()),
    [settlements]
  );
  const completedSettlements = useMemo(() =>
    settlements.filter(s => s.status === 'completed')
      .sort((a, b) => new Date(b.completed_at || b.updated_at || '').getTime() - new Date(a.completed_at || a.updated_at || '').getTime()),
    [settlements]
  );

  const totalAmount = settlements.reduce((sum, s) => sum + s.amount, 0);
  const completedAmount = completedSettlements.reduce((sum, s) => sum + s.amount, 0);
  const pendingAmount = totalAmount - completedAmount;

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => formatKRW(fee);

  const getDaysUntil = (dateStr: string) => {
    const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return <span className="text-red-500 font-black text-[10px]">기한 지남</span>;
    if (diff === 0) return <span className="text-amber-500 font-black text-[10px]">오늘</span>;
    if (diff <= 7) return <span className="text-amber-500 font-black text-[10px]">D-{diff}</span>;
    return <span className="text-slate-400 font-bold text-[10px]">D-{diff}</span>;
  };

  return (
    <div className={embedded ? 'w-full animate-in fade-in duration-500' : 'p-3 md:p-14 w-full animate-in fade-in duration-500'}>
      {!embedded && (
        <div className="mb-6 md:mb-10">
          <h2 className="text-xl md:text-3xl font-black text-slate-900">정산 현황</h2>
          <p className="text-slate-400 text-xs md:text-sm font-bold mt-1">협업 제안이 수락되면 정산 일정이 자동으로 추가됩니다</p>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-8">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100 p-4 md:p-5">
          <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">총 정산 금액</p>
          <p className="text-base md:text-2xl font-black text-blue-700">{formatFee(totalAmount)}</p>
          <p className="text-[10px] font-bold text-blue-400 mt-1">{settlements.length}건</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">정산 완료</p>
          <p className="text-base md:text-2xl font-black text-green-600">{formatFee(completedAmount)}</p>
          <p className="text-[10px] font-bold text-slate-400 mt-1">{completedSettlements.length}건</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">미정산</p>
          <p className="text-base md:text-2xl font-black text-amber-600">{formatFee(pendingAmount)}</p>
          <p className="text-[10px] font-bold text-slate-400 mt-1">{scheduledSettlements.length}건</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">로딩 중...</p>
        </div>
      ) : settlements.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-12 text-center">
          <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">💰</div>
          <h3 className="font-black text-slate-900 text-lg mb-2">정산 내역이 없습니다</h3>
          <p className="text-slate-400 text-sm font-medium">비즈니스 제안을 수락하면 정산이 자동으로 등록됩니다.</p>
        </div>
      ) : (
        <>
          {/* Upcoming / Pending Settlements */}
          <div className="mb-8">
            <h3 className="text-base font-black text-slate-900 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
              예정된 정산 ({scheduledSettlements.length}건)
            </h3>
            {scheduledSettlements.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
                <p className="text-slate-400 text-sm font-medium">예정된 정산이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {scheduledSettlements.map(s => (
                  <div key={s.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                          <span className="text-lg">💰</span>
                        </div>
                        <div>
                          <p className="font-black text-slate-900 text-sm">{s.title}</p>
                          <p className="text-slate-400 text-[10px] font-bold">{s.company_name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-black text-blue-600 text-base">{formatFee(s.amount)}</p>
                        {getDaysUntil(s.scheduled_date)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3 mt-2">
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase">정산 예정일</p>
                        <p className="text-xs font-bold text-slate-700">{formatDate(s.scheduled_date)}</p>
                      </div>
                      <span className={`px-2.5 py-1 text-[10px] font-black rounded-lg ${
                        s.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {s.status === 'pending' ? '대기중' : '예정'}
                      </span>
                    </div>
                    {s.memo && (
                      <p className="text-[11px] text-slate-500 font-medium mt-2 pl-1">{s.memo}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Completed Settlements */}
          <div>
            <h3 className="text-base font-black text-slate-900 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              정산 완료 ({completedSettlements.length}건)
            </h3>
            {completedSettlements.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
                <p className="text-slate-400 text-sm font-medium">완료된 정산이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {completedSettlements.map(s => (
                  <div key={s.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-bold text-slate-800 text-sm">{s.title}</p>
                        <p className="text-slate-400 text-[10px] font-bold">
                          {s.company_name} · 완료일: {formatDate(s.completed_at || s.updated_at || '')}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-green-600 text-sm">{formatFee(s.amount)}</p>
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[9px] font-black rounded-md">완료</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default UserSettlement;
