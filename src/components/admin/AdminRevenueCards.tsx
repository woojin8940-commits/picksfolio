import React, { useEffect, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKRW } from '../../utils/formatters';
import { TIER_PRICE, normalizeTier, type MembershipTier } from '../../utils/membershipTiers';

// 멤버십 월 구독료는 utils/membershipTiers 한 곳에서만 정의한다(서버와 동일한 값).
const PLAN_PRICE = TIER_PRICE;

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
  const [membershipBreakdown, setMembershipBreakdown] = useState<Record<MembershipTier, number>>({ standard: 0, standard_ai: 0, commerce: 0, pro: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const influencers = await apiService
        .getAdminInfluencers(token)
        .catch(() => ({ influencers: [] as any[] }));
      if (cancelled) return;

      const rows = (influencers.influencers || []) as any[];
      const counts: Record<MembershipTier, number> = { standard: 0, standard_ai: 0, commerce: 0, pro: 0 };
      for (const r of rows) {
        if (!r.membership_active) continue;
        const tier = normalizeTier(r.membership_plan);
        if (tier) counts[tier]++;
      }
      setMembershipBreakdown(counts);
      setMembershipRevenue(
        (Object.keys(counts) as MembershipTier[]).reduce((sum, tier) => sum + counts[tier] * PLAN_PRICE[tier], 0),
      );

      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const pendingCount = settlementSummary ? settlementSummary.scheduled + settlementSummary.pending : 0;
  // 라이브커머스를 내린 뒤로 플랫폼 수익은 멤버십 구독료뿐이다.
  const platformRevenue = membershipRevenue || 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-black text-slate-900">픽스폴리오 수익 집계</h3>
        <span className="text-[10px] font-bold text-slate-400">이번달 기준</span>
      </div>

      {/* 픽스폴리오 플랫폼 수익 — 이번달 멤버십 수익 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="bg-gradient-to-br from-slate-900 to-slate-700 p-4 rounded-2xl text-white">
          <p className="text-[9px] font-black text-white/60 uppercase tracking-widest mb-1">픽스폴리오 이번달 수익</p>
          <p className="text-2xl font-black">{loaded ? won(platformRevenue) : '—'}</p>
          <p className="text-[9px] font-bold text-white/50 mt-1">활성 멤버십 구독료</p>
        </div>
        <div className="bg-pink-50 p-4 rounded-2xl border border-pink-100">
          <p className="text-[9px] font-black text-pink-500 uppercase tracking-widest mb-1">이번달 멤버십 수익</p>
          <p className="text-2xl font-black text-pink-600">{loaded && membershipRevenue != null ? won(membershipRevenue) : '—'}</p>
          {loaded && (
            <p className="text-[9px] font-bold text-pink-400/80 mt-1">
              스탠다드 {membershipBreakdown.standard} · AI 협업 {membershipBreakdown.standard_ai} · 커머스 {membershipBreakdown.commerce} · 프로 {membershipBreakdown.pro}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">정산·거래 현황</p>
        <span className="text-[10px] font-bold text-slate-400">정산·매출 탭과 동일 소스</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
      </div>
      <p className="text-[10px] font-bold text-slate-400 mt-3">
        멤버십 수익은 활성 구독자 × 월 구독료 기준의 추정치입니다.
      </p>
    </div>
  );
};

export default AdminRevenueCards;
