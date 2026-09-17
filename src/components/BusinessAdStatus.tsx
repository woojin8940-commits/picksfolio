import React, { useMemo, useState } from 'react';
import { formatKoreanWon, formatNumberWithCommas } from '../utils/formatters';

/**
 * 광고 현황 — 픽스폴리오 안에서 돌리고 있는 콘텐츠 광고.
 *
 * 캠페인 이력에서 "이 콘텐츠가 잘 됐다"를 찾은 다음 브랜드가 하는 일은 하나다.
 * 그 콘텐츠에 돈을 더 붙이는 것. 지금은 그 동작을 하려면 인플루언서가 올린 게시물의
 * 파트너십 코드를 들고 메타 광고 관리자로 넘어가서, 게시물을 다시 찾아 광고를 만들고,
 * 성과를 보러 또 그쪽으로 들어가야 한다. 이력은 픽스폴리오에 있고 광고는 메타에 있어서
 * 둘을 사람이 손으로 잇는다.
 *
 * 이 화면은 그 광고 쪽을 이력 바로 아래로 가져오는 자리다. 메타 광고 API
 * (ads_management · ads_read · business_management) 심사가 끝나면 여기 숫자가
 * 실제 인사이트로 채워지고, 이력에서 고른 콘텐츠를 이 화면에서 바로 집행하게 된다.
 *
 * 연동 전이라 아직 계정에 붙일 데이터가 없다. 그래서 지금은 예시 데이터로 레이아웃만
 * 세워 두고, 화면 어디에서도 이 숫자를 실제 성과처럼 보이지 않게 한다 — 상단에
 * 연동 준비 중임을 적고, 카드마다 '예시' 표시를 남긴다. 절반만 진짜인 화면이
 * 제일 위험하기 때문이다.
 */

interface BusinessAdStatusProps {
  businessUsername: string;
  companyName: string;
}

type AdStatus = 'active' | 'review' | 'paused' | 'ended';

type AdItem = {
  id: string;
  campaignTitle: string;
  creatorHandle: string;
  /** 인플루언서가 게시물에 올려 둔 파트너십 코드. 광고로 돌릴 수 있는 근거다. */
  partnershipCode: string;
  status: AdStatus;
  startDate: string;
  endDate: string;
  impressions: number;
  clicks: number;
  budgetKrw: number;
  spendKrw: number;
};

const STATUS_LABEL: Record<AdStatus, { label: string; cls: string }> = {
  active: { label: '진행 중', cls: 'bg-emerald-50 text-emerald-600' },
  review: { label: '검수 중', cls: 'bg-amber-50 text-amber-600' },
  paused: { label: '일시중지', cls: 'bg-slate-100 text-slate-500' },
  ended: { label: '종료', cls: 'bg-slate-100 text-slate-500' },
};

/** 연동 전 레이아웃 확인용 예시 데이터. 실제 지표는 메타 광고 API 심사 후 붙는다. */
const MOCK_ADS: AdItem[] = [
  {
    id: 'mock-1',
    campaignTitle: '여름 신상 원피스 릴스',
    creatorHandle: 'soyeon.daily',
    partnershipCode: 'PF-2K9D4A',
    status: 'active',
    startDate: '2026-09-02',
    endDate: '2026-09-21',
    impressions: 184320,
    clicks: 3128,
    budgetKrw: 1500000,
    spendKrw: 1043000,
  },
  {
    id: 'mock-2',
    campaignTitle: '수분 크림 사용 후기',
    creatorHandle: 'minji_beauty',
    partnershipCode: 'PF-7Q1XB2',
    status: 'active',
    startDate: '2026-09-08',
    endDate: '2026-09-30',
    impressions: 96540,
    clicks: 2211,
    budgetKrw: 800000,
    spendKrw: 312000,
  },
  {
    id: 'mock-3',
    campaignTitle: '홈카페 머신 언박싱',
    creatorHandle: 'jun.home',
    partnershipCode: 'PF-5MB8ZZ',
    status: 'review',
    startDate: '2026-09-16',
    endDate: '2026-10-05',
    impressions: 0,
    clicks: 0,
    budgetKrw: 600000,
    spendKrw: 0,
  },
  {
    id: 'mock-4',
    campaignTitle: '러닝화 첫 착용 리뷰',
    creatorHandle: 'run_with_hyun',
    partnershipCode: 'PF-3TC6VK',
    status: 'ended',
    startDate: '2026-08-05',
    endDate: '2026-08-26',
    impressions: 241870,
    clicks: 5402,
    budgetKrw: 1200000,
    spendKrw: 1200000,
  },
];

const Kpi: React.FC<{ label: string; value: string; unit?: string; hint?: string; pending?: boolean }> = ({
  label, value, unit, hint, pending,
}) => (
  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
    <p className="text-[10px] font-black text-slate-400">{label}</p>
    <p className={`text-lg font-black mt-1.5 ${pending ? 'text-slate-300' : 'text-slate-900'}`}>
      {value}
      {unit && <span className="text-[11px] font-bold ml-0.5">{unit}</span>}
    </p>
    {hint && <p className="text-[10px] text-slate-400 font-medium mt-2 leading-tight">{hint}</p>}
  </div>
);

/** 예산 대비 지출. 남은 예산이 얼마인지가 이 화면에서 제일 자주 보는 숫자다. */
const SpendBar: React.FC<{ budget: number; spend: number }> = ({ budget, spend }) => {
  const pct = budget > 0 ? Math.min(100, Math.round((spend / budget) * 100)) : 0;
  const nearlyDone = pct >= 90;
  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-slate-500">
          예산 {formatKoreanWon(budget)} 중 {formatKoreanWon(spend)} 지출
        </span>
        <span className={`text-[10px] font-black ${nearlyDone ? 'text-rose-500' : 'text-slate-400'}`}>{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${nearlyDone ? 'bg-rose-500' : 'bg-blue-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {budget > spend && (
        <p className="text-[10px] text-slate-400 font-medium mt-1">
          남은 예산 {formatKoreanWon(budget - spend)}
        </p>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; unit?: string; pending?: boolean }> = ({
  label, value, unit, pending,
}) => (
  <div className="bg-slate-50 rounded-xl px-3 py-2">
    <p className="text-[10px] font-black text-slate-400">{label}</p>
    <p className={`text-[13px] font-black mt-0.5 ${pending ? 'text-slate-300' : 'text-slate-900'}`}>
      {value}
      {unit && <span className="text-[10px] font-bold ml-0.5">{unit}</span>}
    </p>
  </div>
);

const BusinessAdStatus: React.FC<BusinessAdStatusProps> = () => {
  // 필터는 이력 화면과 같은 방식으로 둔다 — 건수가 적어 화면에서 추리는 편이 빠르다.
  const [filter, setFilter] = useState<'' | 'running' | 'ended'>('');

  const visible = useMemo(
    () =>
      MOCK_ADS.filter((ad) => {
        if (filter === 'running') return ad.status === 'active' || ad.status === 'review';
        if (filter === 'ended') return ad.status === 'ended' || ad.status === 'paused';
        return true;
      }),
    [filter],
  );

  const totals = useMemo(() => {
    const base = { ads: 0, impressions: 0, clicks: 0, budget: 0, spend: 0 };
    for (const ad of visible) {
      base.ads++;
      base.impressions += ad.impressions;
      base.clicks += ad.clicks;
      base.budget += ad.budgetKrw;
      base.spend += ad.spendKrw;
    }
    return base;
  }, [visible]);

  const avgCpc = totals.clicks > 0 ? Math.round(totals.spend / totals.clicks) : 0;
  const spendPct = totals.budget > 0 ? Math.round((totals.spend / totals.budget) * 100) : 0;

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <div className="mb-6 md:mb-10">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xl md:text-3xl font-black text-slate-900">광고 현황</h2>
          <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-black">
            예시 데이터
          </span>
        </div>
        <p className="text-slate-400 text-xs md:text-sm font-bold mt-1">
          캠페인 이력에서 성과가 좋았던 콘텐츠를 광고로 돌린 현황을 확인합니다
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="집행 중인 광고"
          value={formatNumberWithCommas(totals.ads)}
          unit="건"
          hint="캠페인 이력에서 고른 콘텐츠를 그대로 광고 소재로 씁니다"
        />
        <Kpi
          label="총 노출수"
          value={totals.impressions > 0 ? formatNumberWithCommas(totals.impressions) : '—'}
          unit={totals.impressions > 0 ? '회' : undefined}
          pending={totals.impressions === 0}
          hint={`클릭 ${formatNumberWithCommas(totals.clicks)}회`}
        />
        <Kpi
          label="평균 CPC"
          value={avgCpc > 0 ? formatNumberWithCommas(avgCpc) : '—'}
          unit={avgCpc > 0 ? '원' : undefined}
          pending={avgCpc === 0}
          hint="지출 합계 ÷ 클릭 합계"
        />
        <Kpi
          label="예산 대비 지출"
          value={`${spendPct}`}
          unit="%"
          hint={`예산 ${formatKoreanWon(totals.budget)} 중 ${formatKoreanWon(totals.spend)}`}
        />
      </div>

      {/* 이 화면의 숫자가 실제 성과가 아니라는 사실을 숫자 바로 아래에 적는다. */}
      <div className="mt-5 bg-blue-50 border border-blue-100 rounded-2xl p-4">
        <p className="text-[12px] font-black text-blue-800">메타 광고 연동 준비 중입니다</p>
        <p className="text-[11px] text-blue-600 font-medium mt-1 leading-relaxed">
          인플루언서가 게시물에 파트너십 코드를 올려 두면, 브랜드는 캠페인 이력에서 그 콘텐츠의 인사이트를
          자세히 보고 성과가 좋은 소재를 골라 픽스폴리오 안에서 바로 광고를 집행할 수 있게 됩니다.
          광고 지표 조회·집행 권한(ads_read · ads_management · business_management) 심사가 끝나면
          아래 숫자는 실제 광고 인사이트로 바뀝니다. 지금 보이는 값은 화면 확인용 예시입니다.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-1.5">
        {([['', '전체'], ['running', '진행 중'], ['ended', '종료·중지']] as ['' | 'running' | 'ended', string][]).map(
          ([key, label]) => (
            <button
              key={key || 'all'}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors ${
                filter === key
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {visible.length === 0 ? (
        <div className="mt-6 bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-400 font-bold">이 조건에 맞는 광고가 없습니다.</p>
          <p className="text-[11px] text-slate-400 font-medium mt-1">필터를 풀고 다시 확인해 보세요.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((ad) => {
            const badge = STATUS_LABEL[ad.status];
            const cpc = ad.clicks > 0 ? Math.round(ad.spendKrw / ad.clicks) : 0;
            const ctr = ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0;
            const waiting = ad.status === 'review';
            return (
              <div key={ad.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
                <div className="flex items-start gap-3">
                  {/* 광고 소재 썸네일 자리. 연동되면 게시물 썸네일이 들어온다. */}
                  <div className="w-14 h-14 rounded-xl bg-slate-100 flex-shrink-0 flex items-center justify-center">
                    <span className="text-[9px] text-slate-400 font-black">소재</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-black text-slate-900 truncate">{ad.campaignTitle}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${badge.cls}`}>{badge.label}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                      @{ad.creatorHandle}
                      {` · ${ad.startDate} ~ ${ad.endDate}`}
                    </p>
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                      파트너십 코드 {ad.partnershipCode}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                  <Metric
                    label="노출수"
                    value={ad.impressions > 0 ? formatNumberWithCommas(ad.impressions) : '—'}
                    unit={ad.impressions > 0 ? '회' : undefined}
                    pending={ad.impressions === 0}
                  />
                  <Metric
                    label="클릭수"
                    value={ad.clicks > 0 ? formatNumberWithCommas(ad.clicks) : '—'}
                    unit={ad.clicks > 0 ? '회' : undefined}
                    pending={ad.clicks === 0}
                  />
                  <Metric
                    label="CTR"
                    value={ctr > 0 ? ctr.toFixed(2) : '—'}
                    unit={ctr > 0 ? '%' : undefined}
                    pending={ctr === 0}
                  />
                  <Metric
                    label="CPC"
                    value={cpc > 0 ? formatNumberWithCommas(cpc) : '—'}
                    unit={cpc > 0 ? '원' : undefined}
                    pending={cpc === 0}
                  />
                </div>

                <SpendBar budget={ad.budgetKrw} spend={ad.spendKrw} />

                {waiting && (
                  <p className="text-[10px] text-amber-600 font-black mt-2">
                    검수가 끝나면 노출이 시작되고 지표가 쌓입니다.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BusinessAdStatus;
