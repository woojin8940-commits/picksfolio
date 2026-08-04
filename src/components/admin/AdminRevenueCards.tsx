import React, { useEffect, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKRW, formatSignedKRW } from '../../utils/formatters';
import { TIER_PRICE, normalizeTier, type MembershipTier } from '../../utils/membershipTiers';

/**
 * 순수익 집계 — 멤버십 / 캠페인 / AI 세 줄기로 나눠 본다.
 *
 * 매출을 한 덩어리로 보면 "얼마 벌었나"는 알아도 "무엇으로 벌었나"를 모른다.
 * 세 줄기는 원가 구조가 완전히 다르다.
 *
 *   멤버십 — 활성 구독자 × 월 구독료. 추가 원가가 없어 매출이 곧 순수익이다.
 *   캠페인 — 브랜드에게 제시한 금액에서 인플루언서에게 줄 금액을 뺀 차액만 우리 몫이다.
 *            (단가 100만원 인플루언서를 110만원에 넘기면 순수익은 10만원)
 *   AI     — 충전액에서 환불을 빼고, 실제 추론 원가를 다시 뺀 나머지가 순수익이다.
 *
 * 멤버십만 브라우저에서 계산한다. 구독 상태는 이미 회원 목록 응답에 들어 있어
 * 추가 왕복이 필요 없고, 캠페인 마진과 AI 원가는 후보·지갑 전체를 훑어야 하므로
 * 서버(/api/admin/operator-overview)에서 계산해 부모가 내려준다.
 */

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
  /** /api/admin/operator-overview 응답 (campaignProfit, ai). */
  overview?: any | null;
}

// 마진은 지급액이 제시가를 넘으면 음수가 된다. formatKRW 는 부호를 버리므로
// 음수일 때만 부호가 살아 있는 쪽을 쓴다 — 손해가 이익으로 보이면 안 된다.
const won = (n: number) => (Number(n || 0) < 0 ? formatSignedKRW(n) : formatKRW(n || 0));

const AdminRevenueCards: React.FC<Props> = ({ token, settlementSummary, overview }) => {
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

  const profit = overview?.campaignProfit || {};
  const confirmed = profit.confirmed || {};
  const pipeline = profit.pipeline || {};
  const unknown = profit.marginUnknown || {};
  const ai = overview?.ai || {};

  const membership = membershipRevenue || 0;
  const campaignProfitKrw = Number(confirmed.margin || 0);
  const aiProfitKrw = Number(ai.netProfitKrw || 0);
  const totalProfit = membership + campaignProfitKrw + aiProfitKrw;
  const unpricedCount = (unknown.confirmed || 0) + (unknown.pipeline || 0);
  const pendingCount = settlementSummary ? settlementSummary.scheduled + settlementSummary.pending : 0;

  const share = (v: number) => (totalProfit > 0 ? Math.round((v / totalProfit) * 100) : 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div>
          <h3 className="font-black text-slate-900">순수익 집계</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">멤버십 · 캠페인 마진 · AI 사용 순수익</p>
        </div>
        <span className="text-[10px] font-bold text-slate-400">멤버십은 이번달 기준, 캠페인·AI는 누적</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <div className="bg-gradient-to-br from-slate-900 to-slate-700 p-4 rounded-2xl text-white">
          <p className="text-[9px] font-black text-white/60 uppercase tracking-widest mb-1">전체 순수익</p>
          <p className="text-2xl font-black">{loaded ? won(totalProfit) : '—'}</p>
          <p className="text-[9px] font-bold text-white/50 mt-1">세 수익원 합계</p>
        </div>

        <div className="bg-pink-50 p-4 rounded-2xl border border-pink-100">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] font-black text-pink-500 uppercase tracking-widest">멤버십 순수익</p>
            {loaded && <span className="text-[9px] font-black text-pink-400">{share(membership)}%</span>}
          </div>
          <p className="text-2xl font-black text-pink-600">{loaded ? won(membership) : '—'}</p>
          {loaded && (
            <p className="text-[9px] font-bold text-pink-400/80 mt-1">
              스탠다드 {membershipBreakdown.standard} · AI 협업 {membershipBreakdown.standard_ai} · 커머스 {membershipBreakdown.commerce} · 프로 {membershipBreakdown.pro}
            </p>
          )}
        </div>

        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest">캠페인 순수익</p>
            {overview && <span className="text-[9px] font-black text-blue-400">{share(campaignProfitKrw)}%</span>}
          </div>
          <p className="text-2xl font-black text-blue-600">{overview ? won(campaignProfitKrw) : '—'}</p>
          {overview && (
            <p className="text-[9px] font-bold text-blue-400/80 mt-1">
              제시가 {won(confirmed.brandAmount || 0)} − 지급액 {won(confirmed.influencerCost || 0)}
            </p>
          )}
        </div>

        <div className="bg-violet-50 p-4 rounded-2xl border border-violet-100">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] font-black text-violet-500 uppercase tracking-widest">AI 사용 순수익</p>
            {overview && <span className="text-[9px] font-black text-violet-400">{share(aiProfitKrw)}%</span>}
          </div>
          <p className="text-2xl font-black text-violet-600">{overview ? won(aiProfitKrw) : '—'}</p>
          {overview && (
            <p className="text-[9px] font-bold text-violet-400/80 mt-1">
              충전 {won(ai.netChargedKrw || 0)} − 추론 원가 {won(ai.rawCostKrw || 0)}
            </p>
          )}
        </div>
      </div>

      {/* 각 수익원의 구성. 합계만 보면 어디를 손봐야 할지 알 수 없다. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div className="bg-slate-50 rounded-xl p-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">멤버십</p>
          <div className="space-y-1">
            {(Object.keys(PLAN_PRICE) as MembershipTier[]).map(tier => (
              <div key={tier} className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500">
                  {tier === 'standard' ? '스탠다드' : tier === 'standard_ai' ? 'AI 협업' : tier === 'commerce' ? '커머스' : '프로'} × {membershipBreakdown[tier]}
                </span>
                <span className="text-[10px] font-black text-slate-700">{won(membershipBreakdown[tier] * PLAN_PRICE[tier])}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">캠페인 마진</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500">수락 확정 {confirmed.count || 0}건</span>
              <span className="text-[10px] font-black text-blue-600">{won(campaignProfitKrw)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500">응답 대기 {pipeline.count || 0}건</span>
              <span className="text-[10px] font-black text-slate-500">{won(pipeline.margin || 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500">평균 마진율</span>
              <span className="text-[10px] font-black text-slate-700">
                {confirmed.brandAmount > 0 ? `${Math.round((campaignProfitKrw / confirmed.brandAmount) * 100)}%` : '-'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-3">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">AI 사용</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500">충전(환불 제외)</span>
              <span className="text-[10px] font-black text-slate-700">{won(ai.netChargedKrw || 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500">추론 원가 {ai.requests || 0}회</span>
              <span className="text-[10px] font-black text-slate-500">-{won(ai.rawCostKrw || 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500">유료 지갑 / 정기권</span>
              <span className="text-[10px] font-black text-slate-700">{ai.paidWallets || 0} / {ai.activePlans || 0}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">정산·거래 현황</p>
        <span className="text-[10px] font-bold text-slate-400">정산 예약 기준</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-50 p-3 rounded-xl">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">총 거래액</p>
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
        멤버십은 활성 구독자 × 월 구독료입니다. 캠페인 순수익은 브랜드 제시가와 인플루언서 단가가 모두 입력된 후보만 집계합니다
        {unpricedCount > 0 ? ` (단가 미입력 ${unpricedCount}건 제외)` : ''}. AI 순수익은 충전액에서 환불과 실제 추론 원가를 뺀 값입니다.
      </p>
    </div>
  );
};

export default AdminRevenueCards;
