import React, { useEffect, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKRW } from '../../utils/formatters';

// Monthly membership prices (KRW). Mirrors MembershipPlan.tsx copy.
const PLAN_PRICE: Record<string, number> = {
  standard: 4900,
  standard_ai: 6900,
  commerce: 13900,
};

// Live sales commission (PG fee included). Mirrors live-pricing.mts.
const LIVE_COMMISSION_RATE = 0.085;

interface SettlementSummary {
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  scheduled: number;
  pending: number;
}

interface Props {
  token: string;
  settlementSummary: SettlementSummary | null;
}

const won = (n: number) => formatKRW(n);

const AdminRevenueCards: React.FC<Props> = ({ token, settlementSummary }) => {
  const [membershipRevenue, setMembershipRevenue] = useState<number | null>(null);
  const [membershipBreakdown, setMembershipBreakdown] = useState<{ standard: number; standard_ai: number; commerce: number }>({ standard: 0, standard_ai: 0, commerce: 0 });
  const [liveOverage, setLiveOverage] = useState(0);
  const [liveCommission, setLiveCommission] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [influencers, usage, live] = await Promise.all([
        apiService.getAdminInfluencers(token).catch(() => ({ influencers: [] as any[] })),
        apiService.getAdminLiveUsage(token).catch(() => null),
        apiService.getAdminLiveOverview(token).catch(() => ({ history: [] as any[] })),
      ]);
      if (cancelled) return;

      const rows = (influencers.influencers || []) as any[];
      const counts = { standard: 0, standard_ai: 0, commerce: 0 };
      for (const r of rows) {
        if (!r.membership_active || !r.membership_plan) continue;
        if (r.membership_plan in counts) counts[r.membership_plan as keyof typeof counts]++;
      }
      setMembershipBreakdown(counts);
      setMembershipRevenue(
        counts.standard * PLAN_PRICE.standard +
        counts.standard_ai * PLAN_PRICE.standard_ai +
        counts.commerce * PLAN_PRICE.commerce
      );

      const overage = (usage?.users || []).reduce((s, u) => s + (u.overageAmountKrw || 0), 0);
      setLiveOverage(overage);

      const salesRevenue = ((live?.history || []) as any[]).reduce((s, h) => s + (Number(h.revenue) || 0), 0);
      setLiveCommission(Math.round(salesRevenue * LIVE_COMMISSION_RATE));

      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const liveFeeTotal = liveOverage + liveCommission;
  const pendingCount = settlementSummary ? settlementSummary.scheduled + settlementSummary.pending : 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-black text-slate-900">매출 요약</h3>
        <span className="text-[10px] font-bold text-slate-400">정산·매출 탭과 동일 소스</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-50 p-3 rounded-xl">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">총 거래액</p>
            <span className="px-1 py-0.5 rounded bg-white text-slate-400 text-[8px] font-black">정산 기준</span>
          </div>
          <p className="text-lg font-black text-slate-900">{won(settlementSummary?.totalAmount || 0)}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">정산 완료</p>
          <p className="text-lg font-black text-blue-600">{won(settlementSummary?.paidAmount || 0)}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">미지급 잔액</p>
          <p className="text-lg font-black text-amber-600">{won(settlementSummary?.pendingAmount || 0)}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">미지급 건수</p>
          <p className="text-lg font-black text-slate-900">{pendingCount}건</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">멤버십 이번달 수익</p>
          <p className="text-lg font-black text-pink-500">{loaded && membershipRevenue != null ? won(membershipRevenue) : '—'}</p>
          {loaded && (
            <p className="text-[9px] font-bold text-slate-400 mt-0.5">
              S {membershipBreakdown.standard} · AI {membershipBreakdown.standard_ai} · C {membershipBreakdown.commerce}
            </p>
          )}
        </div>
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">라이브 수수료 수익</p>
          <p className="text-lg font-black text-indigo-600">{loaded ? won(liveFeeTotal) : '—'}</p>
          {loaded && (
            <p className="text-[9px] font-bold text-slate-400 mt-0.5">
              판매 8.5% {won(liveCommission)} · 송출 초과 {won(liveOverage)}
            </p>
          )}
        </div>
      </div>
      <p className="text-[10px] font-bold text-slate-400 mt-3">
        멤버십 수익은 활성 구독자 × 월 구독료 기준이며, 라이브 수수료는 라이브 판매액의 8.5%와 송출 초과 후불 합계 추정치입니다.
      </p>
    </div>
  );
};

export default AdminRevenueCards;
