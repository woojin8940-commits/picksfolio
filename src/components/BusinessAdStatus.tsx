import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, Settings2 } from 'lucide-react';
import { formatKoreanWon, formatNumberWithCommas } from '../utils/formatters';
import {
  AdBoost,
  addAdBoost,
  ctaLabel,
  findAdPage,
  findObjective,
  placementSummary,
  readAdBoosts,
  subscribeAdBoosts,
  targetSummary,
} from '../utils/adBoosts';
import { useMetaAdConnection } from '../hooks/useMetaAdConnection';
import MetaAdConnectCard from './MetaAdConnectCard';
import AdCreateModal from './AdCreateModal';
import { MOCK_AD_ACCOUNTS } from '../utils/adAccounts';

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
 * 지표는 메타 광고 관리자가 쓰는 것과 같은 이름·같은 계산식으로 둔다. 브랜드가 이미
 * 광고 관리자에서 보던 숫자와 이름이 다르면 같은 값을 두 번 확인하게 되고, 그러면
 * 이 화면을 거칠 이유가 없어진다. 그래서 저장하는 값은 API가 그대로 주는 원본
 * (노출·클릭·도달·전환·전환 가치·지출)만 두고, CTR·CPC·CPM·빈도·ROAS 는 화면에서
 * 계산한다 — 연동 후에도 계산식이 한 군데 남는다.
 *
 * 다만 한 카드에 지표를 다 펼치면 무슨 광고인지가 숫자에 묻힌다. 광고를 훑을 때 실제로
 * 보는 노출·클릭·CTR·CPC 만 기본으로 두고, 나머지는 '지표 더보기'로 접어 둔다.
 *
 * 연동 전이라 아직 계정에 붙일 데이터가 없다. 그래서 지금은 예시 데이터로 레이아웃만
 * 세워 두고, 화면 어디에서도 이 숫자를 실제 성과처럼 보이지 않게 한다 — 상단에
 * 연동 준비 중임을 적고, 카드마다 '예시' 표시를 남긴다. 절반만 진짜인 화면이
 * 제일 위험하기 때문이다.
 *
 * 그 위에 연동이라는 관문을 하나 둔다. 광고 지표는 메타 광고 계정 단위로만 존재하므로,
 * 계정이 정해지지 않은 상태에서 요약과 목록을 그리면 "누구의 광고인지 모르는 숫자"가
 * 된다. 그래서 연동 전에는 화면 전체를 연동 안내로 바꾸고, 연동 후에도 광고 계정을
 * 고르기 전까지는 목록을 열지 않는다. 연동·계정 선택 상태는 utils/adAccounts 에 있고,
 * 부스팅 창도 같은 값을 읽어 '연동 광고 계정' 을 채운다.
 *
 * 광고가 이력에서만 출발하지는 않는다. 자체 촬영물이나 인플루언서 콘텐츠가 아직 없는
 * 신제품처럼, 돌릴 소재가 캠페인 밖에 있는 경우가 있다. 그래서 상단에 '새 광고 만들기'
 * 를 두고 직접 소재 업로드 창(AdCreateModal)을 연다. 그 요청도 부스팅과 같은 자리에
 * 저장되어 이 목록에 '집행 요청' 으로 올라오고, 카드에서 '자체 소재' 배지와 광고 목적으로
 * 구분된다 — 목록을 둘로 나누면 브랜드는 돌고 있는 광고를 두 화면에서 세야 한다.
 */

interface BusinessAdStatusProps {
  businessUsername: string;
  companyName: string;
}

/**
 * 'requested' 는 픽스폴리오 안에서 집행을 요청한 광고다(이력에서의 부스팅,
 * 광고 현황에서의 직접 소재 업로드).
 *
 * 검수 중('review')과 구분해서 둔다. 검수는 메타가 소재를 보고 있는 상태이고,
 * 요청은 아직 메타로 넘어가지도 않은 상태다 — 집행 권한 심사가 끝나야 넘어간다.
 * 둘을 같은 배지로 묶으면 브랜드는 요청한 광고가 이미 메타에 들어갔다고 읽는다.
 */
type AdStatus = 'requested' | 'active' | 'review' | 'paused' | 'ended';

type AdItem = {
  id: string;
  campaignTitle: string;
  /**
   * 소재를 올린 인플루언서. 브랜드가 직접 올린 소재로 만든 광고에는 없다 —
   * 그 자리에는 광고가 나가는 페이지 이름을 대신 적는다.
   */
  creatorHandle?: string;
  /** 인플루언서가 게시물에 올려 둔 파트너십 코드. 광고로 돌릴 수 있는 근거다. */
  partnershipCode?: string;
  /**
   * 브랜드가 직접 올린 소재로 만든 광고. 파트너십 광고와 한 목록에 섞이므로,
   * 카드에서 '자체 소재' 배지와 광고 목적으로 구분해 준다.
   */
  own?: boolean;
  /** 자체 소재 광고에서 고른 광고 목적(브랜드 인지도 · 트래픽 · 전환). */
  objectiveLabel?: string;
  /** 광고가 나가는 페이지 이름. 자체 소재 광고에만 있다. */
  pageName?: string;
  /** CTA 문구와 연결 URL 을 한 줄로. 자체 소재 광고에만 있다. */
  ctaLine?: string;
  status: AdStatus;
  startDate: string;
  endDate: string;
  impressions: number;
  clicks: number;
  /** 광고를 한 번 이상 본 사람 수. 노출과 달리 사람 단위라 중복이 없다. */
  reach: number;
  /** 메타 기준 '결과' 수. 이 화면에서는 구매 전환으로 둔다. */
  conversions: number;
  /** 전환으로 생긴 매출. ROAS 의 분자다. */
  conversionValueKrw: number;
  budgetKrw: number;
  spendKrw: number;
  /** 광고 소재 썸네일. 부스팅으로 만든 광고는 이력에서 고른 게시물 썸네일이 들어온다. */
  thumbnailUrl?: string;
  /** 집행할 때 고른 타겟·노출 위치. 부스팅으로 만든 광고에만 있다. */
  targetLine?: string;
  placementLine?: string;
  /**
   * 이 광고가 들어 있는 메타 광고 계정(act_… ).
   *
   * 실제 연동에서도 광고는 계정 하나에만 속하므로, 계정을 바꾸면 목록이 바뀌어야 한다.
   * 비어 있는 광고(연동 전에 만들어 둔 집행 요청)는 어느 계정에서든 보이게 한다.
   */
  adAccountId?: string;
};

const STATUS_LABEL: Record<AdStatus, { label: string; cls: string }> = {
  requested: { label: '집행 요청', cls: 'bg-blue-50 text-blue-600' },
  active: { label: '진행 중', cls: 'bg-emerald-50 text-emerald-600' },
  review: { label: '검수 중', cls: 'bg-amber-50 text-amber-600' },
  paused: { label: '일시중지', cls: 'bg-slate-100 text-slate-500' },
  ended: { label: '종료', cls: 'bg-slate-100 text-slate-500' },
};

/**
 * 연동 전 레이아웃 확인용 예시 데이터. 실제 지표는 메타 광고 API 심사 후 붙는다.
 *
 * 계정을 나눠 둔다 — 연동한 계정이 여러 개일 때 계정을 바꾸면 목록이 실제로 바뀌는지가
 * 이 화면에서 확인해야 하는 동작이다. '신규 테스트 계정' 에는 일부러 광고를 두지 않았다.
 */
const MOCK_ADS: AdItem[] = [
  {
    id: 'mock-1',
    adAccountId: MOCK_AD_ACCOUNTS[0].id,
    campaignTitle: '여름 신상 원피스 릴스',
    creatorHandle: 'soyeon.daily',
    partnershipCode: 'PF-2K9D4A',
    status: 'active',
    startDate: '2026-09-02',
    endDate: '2026-09-21',
    impressions: 184320,
    clicks: 3128,
    reach: 71240,
    conversions: 121,
    conversionValueKrw: 3963000,
    budgetKrw: 1500000,
    spendKrw: 1043000,
  },
  {
    id: 'mock-2',
    adAccountId: MOCK_AD_ACCOUNTS[0].id,
    campaignTitle: '수분 크림 사용 후기',
    creatorHandle: 'minji_beauty',
    partnershipCode: 'PF-7Q1XB2',
    status: 'active',
    startDate: '2026-09-08',
    endDate: '2026-09-30',
    impressions: 96540,
    clicks: 2211,
    reach: 48760,
    conversions: 74,
    conversionValueKrw: 1088000,
    budgetKrw: 800000,
    spendKrw: 312000,
  },
  {
    id: 'mock-3',
    adAccountId: MOCK_AD_ACCOUNTS[1].id,
    campaignTitle: '홈카페 머신 언박싱',
    creatorHandle: 'jun.home',
    partnershipCode: 'PF-5MB8ZZ',
    status: 'review',
    startDate: '2026-09-16',
    endDate: '2026-10-05',
    impressions: 0,
    clicks: 0,
    reach: 0,
    conversions: 0,
    conversionValueKrw: 0,
    budgetKrw: 600000,
    spendKrw: 0,
  },
  {
    id: 'mock-4',
    adAccountId: MOCK_AD_ACCOUNTS[1].id,
    campaignTitle: '러닝화 첫 착용 리뷰',
    creatorHandle: 'run_with_hyun',
    partnershipCode: 'PF-3TC6VK',
    status: 'ended',
    startDate: '2026-08-05',
    endDate: '2026-08-26',
    impressions: 241870,
    clicks: 5402,
    reach: 88930,
    conversions: 61,
    conversionValueKrw: 5429000,
    budgetKrw: 1200000,
    spendKrw: 1200000,
  },
];

/**
 * 메타 광고 관리자와 같은 계산식으로 파생 지표를 만든다.
 *
 * 분모가 0인 구간(검수 중이라 노출이 아직 없는 광고)에서는 0을 돌려주고,
 * 그리는 쪽에서 '—' 로 비워 둔다. 0.00% 로 찍으면 "성과가 나빴다"로 읽힌다.
 */
const deriveMetrics = (ad: AdItem) => ({
  /** 클릭 ÷ 노출 */
  ctr: ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0,
  /** 지출 ÷ 클릭 */
  cpc: ad.clicks > 0 ? Math.round(ad.spendKrw / ad.clicks) : 0,
  /** 노출 1,000회당 비용 */
  cpm: ad.impressions > 0 ? Math.round((ad.spendKrw / ad.impressions) * 1000) : 0,
  /** 노출 ÷ 도달 = 한 사람이 평균 몇 번 봤나 */
  frequency: ad.reach > 0 ? ad.impressions / ad.reach : 0,
  /** 지출 ÷ 전환 = 전환 한 건에 든 비용 */
  cpa: ad.conversions > 0 ? Math.round(ad.spendKrw / ad.conversions) : 0,
  /** 전환 가치 ÷ 지출 */
  roas: ad.spendKrw > 0 ? ad.conversionValueKrw / ad.spendKrw : 0,
});

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

const Metric: React.FC<{ label: string; value: string; unit?: string; hint?: string; pending?: boolean }> = ({
  label, value, unit, hint, pending,
}) => (
  <div className="bg-slate-50 rounded-xl px-3 py-2">
    <p className="text-[10px] font-black text-slate-400">{label}</p>
    <p className={`text-[13px] font-black mt-0.5 ${pending ? 'text-slate-300' : 'text-slate-900'}`}>
      {value}
      {unit && <span className="text-[10px] font-bold ml-0.5">{unit}</span>}
    </p>
    {hint && <p className="text-[9px] text-slate-400 font-medium mt-0.5 leading-tight">{hint}</p>}
  </div>
);

/** 접었다 펴는 줄. '지표 더보기'와 상단 요약에서 같은 모양을 쓴다. */
const MoreToggle: React.FC<{ open: boolean; onClick: () => void; openLabel: string; closeLabel: string }> = ({
  open, onClick, openLabel, closeLabel,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={open}
    className="mt-2.5 w-full flex items-center justify-center gap-1 py-1.5 rounded-xl border border-slate-100 text-[11px] font-black text-slate-500 hover:bg-slate-50 transition-colors"
  >
    {open ? closeLabel : openLabel}
    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
  </button>
);

const AdCard: React.FC<{ ad: AdItem }> = ({ ad }) => {
  // 카드마다 따로 접는다 — 한 광고를 자세히 보는 중에 다른 카드가 같이 펴질 이유가 없다.
  const [open, setOpen] = useState(false);
  const badge = STATUS_LABEL[ad.status];
  const m = deriveMetrics(ad);
  const waiting = ad.status === 'review';
  const requested = ad.status === 'requested';

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
      <div className="flex items-start gap-3">
        {/* 광고 소재 썸네일. 부스팅으로 만든 광고는 이력에서 고른 게시물이 그대로 소재다. */}
        {ad.thumbnailUrl ? (
          <img
            src={ad.thumbnailUrl}
            alt=""
            loading="lazy"
            className="w-14 h-14 rounded-xl object-cover bg-slate-100 flex-shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-slate-100 flex-shrink-0 flex items-center justify-center">
            <span className="text-[9px] text-slate-400 font-black">소재</span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-black text-slate-900 truncate">{ad.campaignTitle}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${badge.cls}`}>{badge.label}</span>
            {/* 소재가 어디서 왔는지. 한 목록에 섞여 있으니 카드에서 바로 구분되어야 한다. */}
            {ad.own && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-violet-50 text-violet-600">
                자체 소재
              </span>
            )}
            {ad.objectiveLabel && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-500">
                {ad.objectiveLabel}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 font-bold mt-0.5">
            {ad.creatorHandle ? `@${ad.creatorHandle}` : ad.pageName || '자체 소재'}
            {` · ${ad.startDate} ~ ${ad.endDate}`}
          </p>
          {ad.partnershipCode && (
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
              파트너십 코드 {ad.partnershipCode}
            </p>
          )}
          {ad.ctaLine && (
            <p className="text-[10px] text-slate-400 font-medium mt-0.5 break-all">{ad.ctaLine}</p>
          )}
          {(ad.targetLine || ad.placementLine) && (
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
              {[ad.targetLine, ad.placementLine].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* 광고를 훑을 때 실제로 보는 네 개. 나머지는 아래 토글 안에 둔다. */}
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
          value={m.ctr > 0 ? m.ctr.toFixed(2) : '—'}
          unit={m.ctr > 0 ? '%' : undefined}
          pending={m.ctr === 0}
        />
        <Metric
          label="CPC"
          value={m.cpc > 0 ? formatNumberWithCommas(m.cpc) : '—'}
          unit={m.cpc > 0 ? '원' : undefined}
          pending={m.cpc === 0}
        />
      </div>

      <MoreToggle
        open={open}
        onClick={() => setOpen((v) => !v)}
        openLabel="지표 더보기"
        closeLabel="지표 접기"
      />

      {open && (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 animate-in fade-in duration-200">
          <Metric
            label="CPM"
            value={m.cpm > 0 ? formatNumberWithCommas(m.cpm) : '—'}
            unit={m.cpm > 0 ? '원' : undefined}
            hint="노출 1,000회당 비용"
            pending={m.cpm === 0}
          />
          <Metric
            label="도달"
            value={ad.reach > 0 ? formatNumberWithCommas(ad.reach) : '—'}
            unit={ad.reach > 0 ? '명' : undefined}
            hint="광고를 한 번 이상 본 사람"
            pending={ad.reach === 0}
          />
          <Metric
            label="빈도"
            value={m.frequency > 0 ? m.frequency.toFixed(2) : '—'}
            unit={m.frequency > 0 ? '회' : undefined}
            hint="한 사람이 평균 본 횟수"
            pending={m.frequency === 0}
          />
          <Metric
            label="전환수"
            value={ad.conversions > 0 ? formatNumberWithCommas(ad.conversions) : '—'}
            unit={ad.conversions > 0 ? '건' : undefined}
            hint={ad.clicks > 0 ? `클릭 대비 ${((ad.conversions / ad.clicks) * 100).toFixed(1)}%` : undefined}
            pending={ad.conversions === 0}
          />
          <Metric
            label="전환당 비용"
            value={m.cpa > 0 ? formatNumberWithCommas(m.cpa) : '—'}
            unit={m.cpa > 0 ? '원' : undefined}
            hint="지출 ÷ 전환수"
            pending={m.cpa === 0}
          />
          <Metric
            label="ROAS"
            value={m.roas > 0 ? m.roas.toFixed(2) : '—'}
            unit={m.roas > 0 ? '배' : undefined}
            hint={
              ad.conversionValueKrw > 0
                ? `전환 가치 ${formatKoreanWon(ad.conversionValueKrw)}`
                : '전환 가치 ÷ 지출'
            }
            pending={m.roas === 0}
          />
        </div>
      )}

      <SpendBar budget={ad.budgetKrw} spend={ad.spendKrw} />

      {waiting && (
        <p className="text-[10px] text-amber-600 font-black mt-2">
          검수가 끝나면 노출이 시작되고 지표가 쌓입니다.
        </p>
      )}

      {requested && (
        <p className="text-[10px] text-blue-600 font-black mt-2 leading-relaxed">
          {ad.own
            ? '직접 올린 소재로 집행을 요청한 광고입니다. 메타 광고 집행 권한 심사가 끝나면 이 조건 그대로 집행되고, 그때부터 지표가 쌓입니다.'
            : '캠페인 이력에서 집행을 요청한 광고입니다. 메타 광고 집행 권한 심사가 끝나면 이 조건 그대로 집행되고, 그때부터 지표가 쌓입니다.'}
        </p>
      )}
    </div>
  );
};

/**
 * 집행 요청을 광고 카드가 그대로 읽을 수 있는 모양으로 바꾼다.
 *
 * 부스팅과 자체 소재 광고가 같은 목록에 들어온다. 다른 것은 위쪽 세 줄뿐이다 —
 * 제목이 캠페인 이름인지 광고 제목인지, 그 아래가 인플루언서인지 페이지인지,
 * 근거가 파트너십 코드인지 CTA·연결 URL 인지.
 */
const boostToAd = (boost: AdBoost): AdItem => {
  const own = boost.source === 'own';
  const page = findAdPage(boost.pageId);
  return {
    id: boost.id,
    campaignTitle: (own ? boost.headline : boost.campaignTitle) || '제목 없음',
    creatorHandle: own ? undefined : boost.creatorHandle,
    partnershipCode: own ? undefined : boost.partnershipCode,
    own,
    objectiveLabel: findObjective(boost.objective)?.label,
    pageName: page?.name,
    ctaLine: own
      ? [ctaLabel(boost.cta), boost.linkUrl].filter(Boolean).join(' · ') || undefined
      : undefined,
    status: 'requested',
    startDate: boost.startDate,
    endDate: boost.endDate,
    // 집행 전이라 지표가 없다. 0 으로 두면 카드가 전부 '—' 로 비워 그린다.
    impressions: 0,
    clicks: 0,
    reach: 0,
    conversions: 0,
    conversionValueKrw: 0,
    budgetKrw: boost.budgetKrw,
    spendKrw: 0,
    thumbnailUrl: boost.thumbnailUrl,
    targetLine: targetSummary(boost),
    placementLine: placementSummary(boost),
    adAccountId: boost.adAccountId,
  };
};

/**
 * 연동 여부와 상관없이 늘 같은 자리에 두는 안내.
 *
 * 연동을 붙였다고 심사가 끝난 것은 아니다. 연동 후에 이 문구가 사라지면 화면의 숫자가
 * 그 순간부터 실제 성과로 읽히는데, 광고 권한 심사 전까지는 여전히 예시다. 그래서
 * 연동 안내 화면에도, 연동 후 목록 화면에도 같은 문구를 남긴다.
 */
const ReviewNotice: React.FC = () => (
  <div className="mt-5 bg-blue-50 border border-blue-100 rounded-2xl p-4">
    <p className="text-[12px] font-black text-blue-800">메타 광고 연동 준비 중입니다</p>
    <p className="text-[11px] text-blue-600 font-medium mt-1 leading-relaxed">
      인플루언서가 게시물에 파트너십 코드를 올려 두면, 브랜드는 캠페인 이력에서 그 콘텐츠의 인사이트를
      자세히 보고 성과가 좋은 소재를 골라 픽스폴리오 안에서 바로 광고를 집행할 수 있게 됩니다.
      지표는 메타 광고 관리자와 같은 이름·같은 계산식(CTR · CPC · CPM · 도달 · 빈도 · 전환 · ROAS)으로
      맞춰 두었고, 광고 지표 조회·집행 권한(ads_read · ads_management · business_management) 심사가
      끝나면 아래 숫자는 실제 광고 인사이트로 바뀝니다. 지금 보이는 값은 화면 확인용 예시입니다.
    </p>
    <p className="text-[11px] text-blue-600 font-medium mt-2 leading-relaxed">
      캠페인 이력에서 '메타 광고로 부스팅'으로 요청한 광고와, 위쪽 '새 광고 만들기'로 직접 올린
      소재를 집행 요청한 광고는 모두 '집행 요청' 상태로 이 목록 맨 위에 올라옵니다. 심사가 끝나면
      요청한 예산 · 기간 · 타겟 그대로 집행됩니다.
    </p>
  </div>
);

/**
 * 연동 콜백이 돌려준 실패 이유를 브랜드가 읽을 수 있는 문장으로 바꾼다.
 *
 * 그대로 적으면 `token_exchange_failed` 같은 값이 화면에 서게 되고, 읽는 사람은
 * 다시 눌러 봐야 하는지 우리에게 물어봐야 하는지 알 수 없다. 원문은 URL 에서 이미
 * 지워지므로 여기서 문장으로 남긴다.
 */
const metaAdsErrorText = (code: string): string => {
  switch (code) {
    case 'user_denied':
    case 'access_denied':
      return '연동이 취소되었습니다. 광고 계정을 쓰려면 Facebook 동의 화면에서 권한을 허용해 주세요.';
    case 'missing_app_config':
      return 'Meta 앱 설정이 준비되지 않아 연동을 마치지 못했습니다. 잠시 후 다시 시도해 주세요.';
    case 'token_exchange_failed':
      return 'Meta 로그인 정보를 확인하지 못했습니다. 다시 연동해 주세요.';
    case 'state_expired':
    case 'state_used':
      return '연동 요청이 만료되었습니다. 연동하기를 다시 눌러 주세요.';
    case 'diagnosis_store_failed':
      return '연동 결과를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    case 'missing_code':
      return 'Meta에서 연동 정보를 받지 못했습니다. 다시 연동해 주세요.';
    default:
      return '연동을 마치지 못했습니다. 다시 연동해 주세요.';
  }
};

const BusinessAdStatus: React.FC<BusinessAdStatusProps> = ({ businessUsername }) => {
  const cleanUsername = (businessUsername || '').replace(/^biz\//, '').toLowerCase();

  // 필터는 이력 화면과 같은 방식으로 둔다 — 건수가 적어 화면에서 추리는 편이 빠르다.
  const [filter, setFilter] = useState<'' | 'running' | 'ended'>('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [boosts, setBoosts] = useState<AdBoost[]>(() => readAdBoosts(cleanUsername));
  // 직접 올린 소재로 광고를 만드는 창. 집행 요청은 부스팅과 같은 자리에 저장된다.
  const [createOpen, setCreateOpen] = useState(false);

  const {
    connection,
    accounts,
    account,
    connected,
    permissions,
    diagnosis,
    loading: connectionLoading,
    connecting,
    error: connectionError,
    connect,
    disconnect,
    selectAccount,
    refresh: refreshConnection,
  } = useMetaAdConnection(cleanUsername);

  /**
   * 메타 로그인에서 돌아온 결과(?meta_ads_connected / ?meta_ads_error).
   *
   * 콜백은 진단 결과를 저장한 뒤 이 화면으로 돌려보낸다. 파라미터를 읽어 배너를
   * 띄우고 URL 을 정리한다 — 남겨 두면 새로고침할 때마다 같은 안내가 다시 뜬다.
   * 연동 상태 자체는 서버에서 다시 읽는다(화면이 파라미터를 보고 '연동됨' 으로
   * 적으면, 실패한 연동도 성공으로 보일 수 있다).
   */
  const [callbackNotice, setCallbackNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get('meta_ads_connected');
    const failed = params.get('meta_ads_error');
    if (!ok && !failed) return;

    if (ok) {
      setCallbackNotice({ ok: true, text: 'Meta 계정 연동을 마쳤습니다. 아래에서 광고 계정을 선택해 주세요.' });
      // 방금 저장된 진단 결과를 읽어 온다(캐시가 아니라 서버에서).
      void refreshConnection(true);
    } else {
      setCallbackNotice({ ok: false, text: metaAdsErrorText(failed || '') });
    }

    params.delete('meta_ads_connected');
    params.delete('meta_ads_error');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
  }, [refreshConnection]);

  // '연동 설정' 으로 안내 화면을 다시 펼친 상태. 연동이 되어 있어도 계정을 바꾸거나
  // 다시 연동하러 들어올 수 있어야 하므로 연동 상태와는 따로 둔다.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 이력 화면에서 집행을 요청하면 이 목록이 바로 다시 읽는다. 브랜드는 집행 직후
  // 이 화면으로 넘어오므로, 새로고침해야 보이는 목록은 "집행이 안 됐다"로 읽힌다.
  useEffect(() => {
    setBoosts(readAdBoosts(cleanUsername));
    return subscribeAdBoosts(() => setBoosts(readAdBoosts(cleanUsername)));
  }, [cleanUsername]);

  /**
   * 요청한 광고가 예시 데이터 위로 온다 — 방금 만든 것이 목록 맨 위에 있어야 한다.
   *
   * 예시 광고는 가상 계정(MOCK_AD_ACCOUNTS)에 매달려 있다. 연동해서 실제 광고 계정이
   * 생기면 그 계정들에 순서대로 얹는다 — 그대로 두면 계정 필터에 아무것도 걸리지 않아
   * 목록이 빈 화면이 되고, 브랜드는 연동을 하자마자 광고가 사라졌다고 읽는다.
   */
  const allAds = useMemo(() => {
    const examples = MOCK_ADS.map((ad) => {
      const slot = MOCK_AD_ACCOUNTS.findIndex((a) => a.id === ad.adAccountId);
      if (slot < 0 || accounts.length === 0) return ad;
      return { ...ad, adAccountId: accounts[slot % accounts.length].id };
    });
    return [...boosts.map(boostToAd), ...examples];
  }, [boosts, accounts]);

  /**
   * 고른 광고 계정의 광고만 남긴다. 광고는 계정 하나에만 속하므로, 계정을 바꾸면
   * 목록과 요약이 같이 바뀌어야 한다 — 실제 연동에서도 같은 규칙이다.
   *
   * 계정이 적혀 있지 않은 항목(연동 전에 만들어 둔 집행 요청)은 어느 계정에서든
   * 보이게 둔다. 계정이 없다는 이유로 숨기면 브랜드는 요청이 사라졌다고 읽는다.
   */
  const accountAds = useMemo(
    () => allAds.filter((ad) => !ad.adAccountId || ad.adAccountId === account?.id),
    [allAds, account],
  );

  const visible = useMemo(
    () =>
      accountAds.filter((ad) => {
        if (filter === 'running') {
          return ad.status === 'active' || ad.status === 'review' || ad.status === 'requested';
        }
        if (filter === 'ended') return ad.status === 'ended' || ad.status === 'paused';
        return true;
      }),
    [accountAds, filter],
  );

  const totals = useMemo(() => {
    const base = {
      ads: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      conversions: 0,
      conversionValue: 0,
      budget: 0,
      spend: 0,
    };
    for (const ad of visible) {
      base.ads++;
      base.impressions += ad.impressions;
      base.clicks += ad.clicks;
      // 도달은 사람 단위라 광고끼리 겹친다. 여기서는 광고별 도달의 단순 합이고,
      // 중복 제거는 메타 쪽에서만 가능하다 — 그래서 화면에도 그렇게 적어 둔다.
      base.reach += ad.reach;
      base.conversions += ad.conversions;
      base.conversionValue += ad.conversionValueKrw;
      base.budget += ad.budgetKrw;
      base.spend += ad.spendKrw;
    }
    return base;
  }, [visible]);

  const avgCpc = totals.clicks > 0 ? Math.round(totals.spend / totals.clicks) : 0;
  const avgCpm = totals.impressions > 0 ? Math.round((totals.spend / totals.impressions) * 1000) : 0;
  const avgFrequency = totals.reach > 0 ? totals.impressions / totals.reach : 0;
  const avgRoas = totals.spend > 0 ? totals.conversionValue / totals.spend : 0;
  const spendPct = totals.budget > 0 ? Math.round((totals.spend / totals.budget) * 100) : 0;
  // 요청 상태는 아직 돌고 있는 광고가 아니다. 건수에 같이 들어가므로 몇 건인지 적는다.
  const requestedCount = visible.filter((ad) => ad.status === 'requested').length;

  /**
   * 연동 안내로 화면을 바꾸는 조건.
   *
   * 연동이 없을 때, 연동은 됐지만 광고 계정을 아직 고르지 않았을 때, 그리고 '연동 설정'
   * 으로 직접 열었을 때. 앞의 두 경우는 붙일 데이터가 정해지지 않은 상태라 요약·목록을
   * 그려도 전부 빈 값이 된다.
   */
  const showConnectGuide = !connected || !account || settingsOpen;

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <div className="mb-6 md:mb-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl md:text-3xl font-black text-slate-900">광고 현황</h2>
            {/* 연동 여부와 무관하게 남긴다 — 심사 전이라는 사실은 계속 보여야 한다. */}
            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-black">
              예시 데이터
            </span>
          </div>
          <p className="text-slate-400 text-xs md:text-sm font-bold mt-1">
            캠페인 이력에서 고른 콘텐츠와 직접 올린 소재로 돌린 광고 현황을 확인합니다
          </p>
        </div>

        <div className="flex-shrink-0 flex flex-wrap items-center justify-end gap-1.5">
          {/* 연동을 마친 뒤에도 계정을 바꾸러 돌아올 자리. 목록 화면에서는 작게 둔다. */}
          {connected && account && !settingsOpen && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-black text-slate-500 hover:bg-slate-50 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              연동 설정
            </button>
          )}

          {/*
            이력에 게시물이 없어도 광고를 시작할 수 있는 자리. 부스팅은 캠페인 이력에서
            출발하므로, 자체 소재로 돌리려는 브랜드에게는 이 화면에 들어올 문이 없었다.
          */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-black hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={3} />
            새 광고 만들기
          </button>
        </div>
      </div>

      {/*
        메타에서 돌아온 결과. 연동 카드보다 위에 둔다 — 방금 누른 버튼의 결과가
        카드 안쪽 상태 변화보다 먼저 읽혀야 한다.
      */}
      {callbackNotice && (
        <div
          className={`mb-3 rounded-2xl border px-4 py-3 ${
            callbackNotice.ok
              ? 'bg-emerald-50 border-emerald-100'
              : 'bg-rose-50 border-rose-100'
          }`}
        >
          <p
            className={`text-[12px] font-black ${
              callbackNotice.ok ? 'text-emerald-700' : 'text-rose-600'
            }`}
          >
            {callbackNotice.text}
          </p>
        </div>
      )}

      {showConnectGuide ? (
        <>
          <MetaAdConnectCard
            connected={connected}
            connectedAt={connection.connectedAt}
            metaUserName={connection.metaUserName}
            accounts={accounts}
            selectedAccountId={connection.selectedAccountId}
            permissions={permissions}
            diagnosis={diagnosis}
            loading={connectionLoading}
            connecting={connecting}
            error={connectionError}
            onConnect={connect}
            onDisconnect={() => {
              void disconnect();
              setSettingsOpen(false);
            }}
            onSelectAccount={selectAccount}
            onBack={settingsOpen ? () => setSettingsOpen(false) : undefined}
          />
          <ReviewNotice />
        </>
      ) : (
        <>
          {/* 어느 계정의 숫자를 보고 있는지를 요약 바로 위에 둔다. */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 mb-3">
            <label className="text-[11px] font-black text-slate-500" htmlFor="ad-account-select">
              연동된 광고 계정
            </label>
            <div className="relative mt-1.5">
              <select
                id="ad-account-select"
                value={account.id}
                onChange={(e) => selectAccount(e.target.value)}
                className="w-full appearance-none pl-3 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.id}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <p className="text-[10px] text-slate-400 font-medium mt-1.5 leading-relaxed">
              {account.businessName} · 이 계정의 광고만 아래에 표시되고, 부스팅 집행도 이 계정으로 들어갑니다.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi
              label="집행 중인 광고"
              value={formatNumberWithCommas(totals.ads)}
              unit="건"
              hint={
                requestedCount > 0
                  ? `집행 요청 ${requestedCount}건 포함 · 이력에서 고른 콘텐츠를 그대로 소재로 씁니다`
                  : '캠페인 이력에서 고른 콘텐츠를 그대로 광고 소재로 씁니다'
              }
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

          <MoreToggle
            open={summaryOpen}
            onClick={() => setSummaryOpen((v) => !v)}
            openLabel="전체 지표 더보기"
            closeLabel="전체 지표 접기"
          />

          {summaryOpen && (
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 animate-in fade-in duration-200">
              <Kpi
                label="평균 CPM"
                value={avgCpm > 0 ? formatNumberWithCommas(avgCpm) : '—'}
                unit={avgCpm > 0 ? '원' : undefined}
                pending={avgCpm === 0}
                hint="노출 1,000회당 비용"
              />
              <Kpi
                label="총 도달"
                value={totals.reach > 0 ? formatNumberWithCommas(totals.reach) : '—'}
                unit={totals.reach > 0 ? '명' : undefined}
                pending={totals.reach === 0}
                hint="광고별 도달의 합계입니다 (사람 단위 중복 제거 전)"
              />
              <Kpi
                label="평균 빈도"
                value={avgFrequency > 0 ? avgFrequency.toFixed(2) : '—'}
                unit={avgFrequency > 0 ? '회' : undefined}
                pending={avgFrequency === 0}
                hint="노출 합계 ÷ 도달 합계"
              />
              <Kpi
                label="평균 ROAS"
                value={avgRoas > 0 ? avgRoas.toFixed(2) : '—'}
                unit={avgRoas > 0 ? '배' : undefined}
                pending={avgRoas === 0}
                hint={`전환 ${formatNumberWithCommas(totals.conversions)}건 · 전환 가치 ${formatKoreanWon(totals.conversionValue)}`}
              />
            </div>
          )}

          {/* 이 화면의 숫자가 실제 성과가 아니라는 사실을 숫자 바로 아래에 적는다. */}
          <ReviewNotice />

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
              {accountAds.length === 0 ? (
                <>
                  <p className="text-sm text-slate-400 font-bold">이 광고 계정으로 집행한 광고가 아직 없습니다.</p>
                  <p className="text-[11px] text-slate-400 font-medium mt-1">
                    캠페인 이력에서 성과가 좋았던 콘텐츠를 골라 부스팅하거나, '새 광고 만들기'로 직접
                    올린 소재를 집행하면 여기에 올라옵니다.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-400 font-bold">이 조건에 맞는 광고가 없습니다.</p>
                  <p className="text-[11px] text-slate-400 font-medium mt-1">필터를 풀고 다시 확인해 보세요.</p>
                </>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {visible.map((ad) => (
                <AdCard key={ad.id} ad={ad} />
              ))}
            </div>
          )}
        </>
      )}

      {/*
        집행 요청은 부스팅과 똑같이 addAdBoost 로 남긴다 — 같은 목록, 같은 '집행 요청'
        상태로 올라가야 브랜드가 두 흐름의 결과를 한 화면에서 센다.
      */}
      {/* 닫을 때 지워 둔다 — 다시 열었을 때 지난번 입력이나 성공 화면이 남으면 안 된다. */}
      {createOpen && (
        <AdCreateModal
          open
          onClose={() => setCreateOpen(false)}
          account={account}
          onSubmitted={(boost: AdBoost) => addAdBoost(cleanUsername, boost)}
        />
      )}
    </div>
  );
};

export default BusinessAdStatus;
