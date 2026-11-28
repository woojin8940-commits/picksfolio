import React, { useCallback, useEffect, useState } from 'react';
import { brandPlanService, type BrandPlanOverview } from '../services/brandPlanService';
import {
  ADDON_CAMPAIGN_PRICE,
  ADDON_SELECTED_PRICE,
  ADDON_SELECTED_UNIT,
  BRAND_CAMPAIGN_PRICE,
  BRAND_GROWTH_PRICE,
  BRAND_PLAN_LIMITS,
  BRAND_SEAT_PRICE,
  type BrandPlanTier,
} from '../utils/membershipTiers';

interface BrandPlanSectionProps {
  /** 구독 시작(결제창 열기). MembershipPlan 의 카드 결제 흐름을 그대로 쓴다. */
  onSubscribe: (tier: BrandPlanTier) => void;
  /** 이용 중일 때의 해지 · 해지 취소 버튼(MembershipPlan 이 그린다). */
  subscribedActions: (label: string) => React.ReactNode;
  isTeamMember: boolean;
  saving: boolean;
  onOpenTeam?: () => void;
  /** 등급 변경 · 추가 구매 뒤 구독 정보를 다시 읽는다. */
  onChanged?: () => void;
  /** 구독 정보가 바뀌면 다시 읽는 신호. */
  refreshKey?: unknown;
}

const won = (n: number) => `${Math.max(0, Math.round(n)).toLocaleString()}원`;
const TIER_NAME: Record<BrandPlanTier, string> = { brand_campaign: '라이트', brand_growth: '그로스' };

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

const Meter: React.FC<{ label: string; used: number; total: number; unit: string }> = ({ label, used, total, unit }) => {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const full = total > 0 && used >= total;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-black text-slate-600">{label}</span>
        <span className={`text-sm font-black ${full ? 'text-red-600' : 'text-slate-900'}`}>
          {`${used} / ${total}${unit}`}
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${full ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

/**
 * 브랜드 멤버십 — 라이트 · 그로스 · 엔터프라이즈 카드와, 이용 중이면 이번 달 사용량 · 등급 변경 ·
 * 추가 구매. 가격 · 한도는 서버(/api/brand-plan)가 기준이고 화면 상수는 구독 전 안내용이다.
 */
const BrandPlanSection: React.FC<BrandPlanSectionProps> = ({
  onSubscribe, subscribedActions, isTeamMember, saving, onOpenTeam, onChanged, refreshKey,
}) => {
  const [data, setData] = useState<BrandPlanOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await brandPlanService.overview();
    if (res.success) setData(res);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const run = async (fn: () => Promise<{ success: boolean; error?: string; chargedKrw?: number }>, done: (charged?: number) => string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fn();
    if (res.success) {
      setNotice(done(res.chargedKrw));
      onChanged?.();
    } else {
      setError(res.error || '처리하지 못했습니다.');
    }
    await load();
    setBusy(false);
  };

  const plan = data?.plan;
  const quota = data?.quota;
  const current = plan?.planActive ? plan.tier : null;
  const isOwner = !isTeamMember;

  const prorated = (full: number) => {
    const next = plan?.nextBillingDate ? Date.parse(plan.nextBillingDate) : NaN;
    if (!Number.isFinite(next) || next <= Date.now()) return full;
    const start = new Date(next);
    start.setMonth(start.getMonth() - 1);
    const ratio = Math.min(1, (next - Date.now()) / (next - start.getTime()));
    return Math.max(100, Math.round((full * ratio) / 10) * 10);
  };

  const upgrade = () => {
    const diff = BRAND_GROWTH_PRICE - BRAND_CAMPAIGN_PRICE;
    const amount = prorated(diff);
    if (!window.confirm(
      `그로스로 올립니다.\n\n지금 결제: 약 ${won(amount)} (다음 결제일까지 남은 기간만큼 차액)\n다음 달부터: 월 ${won(BRAND_GROWTH_PRICE + (plan?.scheduledSeats ?? plan?.extraSeats ?? 0) * BRAND_SEAT_PRICE)}\n\n결제가 끝나면 이번 달 한도가 바로 그로스 기준으로 늘어나요. 진행할까요?`,
    )) return;
    run(() => brandPlanService.upgrade('brand_growth'), () => '그로스로 올렸어요. 이번 달 한도가 바로 늘어났습니다.');
  };

  const scheduleDown = () => {
    if (!window.confirm('다음 결제일부터 라이트로 내립니다. 그때까지는 그로스 한도를 그대로 쓸 수 있어요. 진행할까요?')) return;
    run(() => brandPlanService.schedule('brand_campaign'), () => '다음 결제일부터 라이트로 바뀌어요.');
  };

  const cancelSchedule = () =>
    run(() => brandPlanService.schedule(current || 'brand_growth'), () => '등급 변경 예약을 취소했어요.');

  const buyAddon = (kind: 'campaign' | 'selected') => {
    const price = kind === 'campaign' ? ADDON_CAMPAIGN_PRICE : ADDON_SELECTED_PRICE;
    const label = kind === 'campaign' ? '캠페인 1건' : `선정 인플루언서 ${ADDON_SELECTED_UNIT}명`;
    if (!window.confirm(`${label}을 추가합니다. 지금 ${won(price)}이 결제되고, 이번 결제 주기(${formatDate(plan?.nextBillingDate)}까지) 안에서만 쓸 수 있어요. 진행할까요?`)) return;
    run(() => brandPlanService.addon(kind, 1), () => `${label}을 추가했어요.`);
  };

  const card = (tier: BrandPlanTier, price: number, highlight: boolean) => {
    const limits = BRAND_PLAN_LIMITS[tier];
    const isCurrent = current === tier;
    return (
      <div
        key={tier}
        className={`relative rounded-2xl border-2 bg-white p-6 shadow-sm flex flex-col ${
          isCurrent ? 'border-blue-500' : highlight ? 'border-indigo-200' : 'border-slate-200'
        }`}
      >
        {isCurrent && (
          <span className="absolute -top-3 left-5 bg-blue-600 text-white text-[11px] font-black px-2.5 py-1 rounded-full">이용 중</span>
        )}
        <p className="text-lg font-black text-slate-900">{TIER_NAME[tier]}</p>
        <div className="flex items-end gap-1 mt-2">
          <span className="text-3xl font-black text-slate-900">{price.toLocaleString()}</span>
          <span className="text-slate-500 text-sm mb-1">원 / 월</span>
        </div>
        <p className="text-[11px] text-slate-400 font-bold">부가세 포함</p>
        <ul className="mt-4 space-y-2 text-sm text-slate-600 flex-1">
          <li className="flex justify-between"><span>월 캠페인</span><strong className="text-slate-900">{`${limits.campaigns}건`}</strong></li>
          <li className="flex justify-between"><span>월 선정 인플루언서</span><strong className="text-slate-900">{`${limits.selected}명`}</strong></li>
          <li className="flex justify-between"><span>계정</span><strong className="text-slate-900">관리자 1개</strong></li>
          <li className="flex justify-between"><span>직원 좌석</span><strong className="text-slate-900">{`1석당 월 ${won(BRAND_SEAT_PRICE)}`}</strong></li>
          <li className="flex items-start gap-2"><span className="text-green-500 font-bold">✓</span>인플루언서 리스트업</li>
          <li className="flex items-start gap-2"><span className="text-green-500 font-bold">✓</span>캠페인 이력 · 성과 데이터</li>
          <li className="flex items-start gap-2"><span className="text-green-500 font-bold">✓</span>자동 디엠</li>
        </ul>
        <div className="mt-5">
          {isCurrent ? (
            isTeamMember ? (
              <div className="py-3 rounded-xl text-center text-sm font-bold bg-green-50 text-green-700 border border-green-200">✓ 회사가 이용 중</div>
            ) : (
              subscribedActions(`${TIER_NAME[tier]} 이용 중`)
            )
          ) : isTeamMember ? (
            <div className="py-3 rounded-xl text-center text-xs font-bold bg-slate-50 text-slate-500 border border-slate-200">구독은 회사 관리자 계정에서 할 수 있어요</div>
          ) : current ? (
            tier === 'brand_growth' ? (
              <button type="button" disabled={busy || plan?.cancelAtPeriodEnd || plan?.chargePending} onClick={upgrade}
                className="w-full py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                그로스로 올리기
              </button>
            ) : plan?.scheduledTier === 'brand_campaign' ? (
              <button type="button" disabled={busy} onClick={cancelSchedule}
                className="w-full py-3 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
                {`${formatDate(plan?.nextBillingDate)}부터 라이트 · 예약 취소`}
              </button>
            ) : (
              <button type="button" disabled={busy || plan?.cancelAtPeriodEnd} onClick={scheduleDown}
                className="w-full py-3 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
                다음 결제일부터 라이트로 내리기
              </button>
            )
          ) : (
            <button type="button" disabled={saving} onClick={() => onSubscribe(tier)}
              className={`w-full py-3 rounded-xl font-bold text-white transition-all disabled:opacity-50 ${
                highlight ? 'bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600' : 'bg-slate-900 hover:bg-slate-700'
              }`}>
              {`${TIER_NAME[tier]} 구독하기`}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {notice && <div className="bg-green-50 border border-green-200 text-green-700 text-sm font-bold rounded-xl px-4 py-3">✓ {notice}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-bold rounded-xl px-4 py-3">{error}</div>}

      {/* 이용 중이면 이번 달 사용량 */}
      {current && quota && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <p className="text-base font-black text-slate-900">{`이번 달 사용량 · ${TIER_NAME[current]}`}</p>
            <p className="text-[11px] font-bold text-slate-400">
              {`${formatDate(quota.cycle.start)} ~ ${formatDate(quota.cycle.end)} · 다음 결제 ${won(plan?.nextMonthlyKrw || 0)}`}
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <Meter label="캠페인" used={quota.used.campaigns} total={quota.limits.campaigns + quota.addons.campaigns} unit="건" />
            <Meter label="선정 인플루언서" used={quota.used.selected} total={quota.limits.selected + quota.addons.selected} unit="명" />
          </div>
          <p className="text-[11px] text-slate-400 font-medium mt-3 leading-relaxed">
            캠페인은 담당자가 리스트업을 처음 보낼 때, 선정 인플루언서는 진행이 확정되어 연락처가 공개될 때 차감돼요. 남은 건수는 다음 달로 넘어가지 않아요.
          </p>
          {quota.pastDue && (
            <p className="text-xs font-bold text-red-600 mt-2">정기결제가 실패했어요. 결제 수단을 확인해 주세요. 결제가 다시 될 때까지 새 리스트업과 진행 확정이 멈춥니다.</p>
          )}
          {plan?.scheduledTier && plan.scheduledTier !== current && (
            <p className="text-xs font-bold text-amber-600 mt-2">{`${formatDate(plan.nextBillingDate)}부터 ${TIER_NAME[plan.scheduledTier]}로 바뀌어요.`}</p>
          )}
          {isOwner && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col md:flex-row gap-2">
              <button type="button" disabled={busy || plan?.chargePending} onClick={() => buyAddon('campaign')}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-blue-600 border border-blue-200 hover:bg-blue-50 disabled:opacity-50">
                {`캠페인 1건 추가 · ${won(ADDON_CAMPAIGN_PRICE)}`}
              </button>
              <button type="button" disabled={busy || plan?.chargePending} onClick={() => buyAddon('selected')}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-blue-600 border border-blue-200 hover:bg-blue-50 disabled:opacity-50">
                {`선정 인플루언서 ${ADDON_SELECTED_UNIT}명 추가 · ${won(ADDON_SELECTED_PRICE)}`}
              </button>
              {onOpenTeam && (
                <button type="button" onClick={onOpenTeam}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-slate-600 border border-slate-200 hover:bg-slate-50">
                  {`팀원 · 좌석 관리 (직원 ${plan?.extraSeats || 0}석)`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {card('brand_campaign', BRAND_CAMPAIGN_PRICE, false)}
        {card('brand_growth', BRAND_GROWTH_PRICE, true)}
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm flex flex-col">
          <p className="text-lg font-black text-slate-900">엔터프라이즈</p>
          <p className="text-3xl font-black text-slate-900 mt-2">별도 문의</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600 flex-1">
            <li className="flex justify-between"><span>월 캠페인</span><strong className="text-slate-900">협의</strong></li>
            <li className="flex justify-between"><span>월 선정 인플루언서</span><strong className="text-slate-900">협의</strong></li>
            <li className="flex justify-between"><span>직원 좌석</span><strong className="text-slate-900">협의</strong></li>
            <li className="flex items-start gap-2"><span className="text-green-500 font-bold">✓</span>리스트업 · 이력/성과 · 자동 디엠</li>
          </ul>
          <a href="mailto:woojin8940@inplace-ad.com?subject=%5B%ED%94%BD%EC%8A%A4%ED%8F%B4%EB%A6%AC%EC%98%A4%5D%20%EC%97%94%ED%84%B0%ED%94%84%EB%9D%BC%EC%9D%B4%EC%A6%88%20%EB%AC%B8%EC%9D%98"
            className="mt-5 w-full py-3 rounded-xl font-bold text-center text-sm text-slate-700 border border-slate-300 hover:bg-slate-50">
            문의하기
          </a>
        </div>
      </div>
    </div>
  );
};

export default BrandPlanSection;
