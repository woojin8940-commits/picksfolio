import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { formatKoreanWon, formatNumberWithCommas } from '../utils/formatters';
import { AD_STATUS_LABEL, AdResult, AdStatus, resultValue } from '../utils/adResults';
import type { MetaAdWithLive } from '../utils/metaAdsApi';

/**
 * 광고 현황의 한눈에 보기 — 여러 인플루언서 · 여러 목적의 광고를 한 표로.
 *
 * 브랜드는 한 캠페인에서 인플루언서 여럿의 게시물을 부스팅하고, 같은 게시물도 판매 · 트래픽 ·
 * 인지도처럼 목적을 바꿔 돌린다. 카드를 세로로 쌓으면 다섯 개만 넘어도 어느 광고가 돈값을
 * 하는지 비교하려고 위아래로 스크롤해야 한다. 그래서 광고 관리자처럼 한 줄에 한 광고를 두고
 * 같은 열을 나란히 비교한다.
 *
 * 묶어 보기는 두 가지다.
 *   · 인플루언서별 — "누구 콘텐츠에 돈을 더 붙일까"를 정할 때. 지출 · 링크 클릭 · 구매 · ROAS 를
 *     합쳐 본다.
 *   · 목적별 — "판매 광고와 인지도 광고에 예산을 어떻게 나눌까"를 정할 때.
 *
 * 묶음 합계에서 '결과' 는 묶음 안의 광고가 같은 결과(예: 모두 구매)를 노릴 때만 더한다.
 * 구매 3건과 도달 1만 명을 더한 숫자는 아무것도 말하지 않는다.
 *
 * 줄을 누르면 그 광고의 자세한 카드(지표 전체 · 일시중지 · 삭제)를 그 자리에서 편다.
 */

export type OverviewAd = {
  id: string;
  campaignTitle: string;
  creatorHandle?: string;
  own?: boolean;
  pageName?: string;
  status: AdStatus;
  objectiveLabel: string;
  thumbnailUrl?: string;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  spendKrw: number;
  budgetKrw: number;
  conversions: number;
  conversionValueKrw: number;
  events: Record<string, number>;
  result: AdResult;
  /** 결과 종류(PURCHASE · LINK_CLICK · REACH …). 묶음 합계에서 같은 종류끼리만 더한다. */
  resultKey: string;
  source: MetaAdWithLive;
};

export type OverviewView = 'ads' | 'creator' | 'objective';

type SortKey = 'recent' | 'spend' | 'result' | 'costPer' | 'impressions' | 'linkClicks' | 'ctr' | 'cpc' | 'purchases' | 'roas';

const ctrOf = (a: { linkClicks: number; impressions: number }) => (a.impressions > 0 ? (a.linkClicks / a.impressions) * 100 : 0);
const cpcOf = (a: { linkClicks: number; spendKrw: number }) => (a.linkClicks > 0 ? Math.round(a.spendKrw / a.linkClicks) : 0);
const roasOf = (a: { conversionValueKrw: number; spendKrw: number }) => (a.spendKrw > 0 ? a.conversionValueKrw / a.spendKrw : 0);

const sortValue = (ad: OverviewAd, key: SortKey): number => {
  switch (key) {
    case 'spend':
      return ad.spendKrw;
    case 'result':
      return ad.result.value;
    // 결과가 없는 광고는 '비용이 0원'이 아니라 비교할 수 없는 광고다. 오름차순에서도 맨 뒤로.
    case 'costPer':
      return ad.result.costPer || Number.POSITIVE_INFINITY;
    case 'impressions':
      return ad.impressions;
    case 'linkClicks':
      return ad.linkClicks;
    case 'ctr':
      return ctrOf(ad);
    case 'cpc':
      return cpcOf(ad) || Number.POSITIVE_INFINITY;
    case 'purchases':
      return ad.conversions;
    case 'roas':
      return roasOf(ad);
    default:
      return Date.parse(ad.source.createdAt) || 0;
  }
};

/** 비용 열은 낮을수록 좋으므로 처음 누르면 오름차순, 나머지는 내림차순이다. */
const ASCENDING_FIRST: SortKey[] = ['costPer', 'cpc'];

const dash = (v: number, render: (n: number) => string) => (v > 0 && Number.isFinite(v) ? render(v) : '—');
const won = (n: number) => `${formatNumberWithCommas(Math.round(n))}원`;
const count = (n: number) => formatNumberWithCommas(Math.round(n));

type Totals = {
  ads: number;
  live: number;
  spendKrw: number;
  budgetKrw: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  conversions: number;
  conversionValueKrw: number;
  /** 묶음 안 광고가 모두 같은 결과를 노릴 때만 채운다. */
  result: AdResult | null;
};

function sumAds(ads: OverviewAd[]): Totals {
  const t: Totals = {
    ads: ads.length,
    live: 0,
    spendKrw: 0,
    budgetKrw: 0,
    impressions: 0,
    reach: 0,
    linkClicks: 0,
    conversions: 0,
    conversionValueKrw: 0,
    result: null,
  };
  const events: Record<string, number> = {};
  for (const ad of ads) {
    if (ad.status === 'active') t.live += 1;
    t.spendKrw += ad.spendKrw;
    t.budgetKrw += ad.budgetKrw;
    t.impressions += ad.impressions;
    t.reach += ad.reach;
    t.linkClicks += ad.linkClicks;
    t.conversions += ad.conversions;
    t.conversionValueKrw += ad.conversionValueKrw;
    for (const [k, v] of Object.entries(ad.events)) events[k] = (events[k] || 0) + v;
  }
  const keys = new Set(ads.map((a) => a.resultKey));
  if (ads.length > 0 && keys.size === 1) {
    const first = ads[0].result;
    const key = ads[0].resultKey;
    const value = resultValue(key, { impressions: t.impressions, reach: t.reach, linkClicks: t.linkClicks, events });
    t.result = {
      label: first.label,
      value,
      perThousand: first.perThousand,
      costPer: value > 0 ? Math.round((t.spendKrw / value) * (first.perThousand ? 1000 : 1)) : 0,
    };
  }
  return t;
}

const COLUMNS: { key: SortKey | null; label: string; hint?: string; align?: 'left' }[] = [
  { key: null, label: '광고', align: 'left' },
  { key: null, label: '상태 · 목적', align: 'left' },
  { key: 'result', label: '결과', hint: '광고 관리자의 결과 열 — 성과 목표에 맞춘 숫자' },
  { key: 'costPer', label: '결과당 비용', hint: '도달 · 노출은 1,000회당' },
  { key: 'spend', label: '지출' },
  { key: 'impressions', label: '노출' },
  { key: 'linkClicks', label: '링크 클릭' },
  { key: 'ctr', label: 'CTR(링크)', hint: '링크 클릭 ÷ 노출' },
  { key: 'cpc', label: 'CPC(링크)', hint: '지출 ÷ 링크 클릭' },
  { key: 'purchases', label: '구매', hint: '픽셀로 측정한 웹사이트 구매' },
  { key: 'roas', label: 'ROAS', hint: '구매 전환 가치 ÷ 지출' },
];

/** 숫자 열들. 광고 한 줄과 묶음 합계 줄이 같은 칸을 쓴다. */
const NumberCells: React.FC<{ v: Totals | OverviewAd; result: AdResult | null; strong?: boolean }> = ({ v, result, strong }) => {
  const cls = `px-3 py-2.5 text-right whitespace-nowrap text-[12px] ${strong ? 'font-black text-slate-900' : 'font-bold text-slate-700'}`;
  return (
    <>
      <td className={cls}>
        {result ? (
          <>
            {dash(result.value, count)}
            <span className="block text-[9px] font-bold text-slate-400">{result.label}</span>
          </>
        ) : (
          <span className="text-[10px] text-slate-400 font-bold">목적별 상이</span>
        )}
      </td>
      <td className={cls}>{result ? dash(result.costPer, won) : '—'}</td>
      <td className={cls}>{dash(v.spendKrw, won)}</td>
      <td className={cls}>{dash(v.impressions, count)}</td>
      <td className={cls}>{dash(v.linkClicks, count)}</td>
      <td className={cls}>{dash(ctrOf(v), (n) => `${n.toFixed(2)}%`)}</td>
      <td className={cls}>{dash(cpcOf(v), won)}</td>
      <td className={cls}>{dash(v.conversions, count)}</td>
      <td className={cls}>{dash(roasOf(v), (n) => `${n.toFixed(2)}배`)}</td>
    </>
  );
};

const AdCell: React.FC<{ ad: OverviewAd; open: boolean }> = ({ ad, open }) => (
  <div className="flex items-center gap-2.5 min-w-0">
    <ChevronRight className={`w-3.5 h-3.5 text-slate-300 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
    {ad.thumbnailUrl ? (
      <img src={ad.thumbnailUrl} alt="" loading="lazy" className="w-9 h-9 rounded-lg object-cover bg-slate-100 flex-shrink-0" />
    ) : (
      <div className="w-9 h-9 rounded-lg bg-slate-100 flex-shrink-0" />
    )}
    <div className="min-w-0">
      <p className="text-[12px] font-black text-slate-900 truncate max-w-[220px]">{ad.campaignTitle}</p>
      <p className="text-[10px] font-bold text-slate-400 truncate max-w-[220px]">
        {ad.creatorHandle ? `@${ad.creatorHandle}` : `자체 소재${ad.pageName ? ` · ${ad.pageName}` : ''}`}
      </p>
    </div>
  </div>
);

const StatusCell: React.FC<{ ad: OverviewAd }> = ({ ad }) => {
  const badge = AD_STATUS_LABEL[ad.status];
  return (
    <div className="flex flex-col items-start gap-1">
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-black whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
      <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-500 whitespace-nowrap">
        {ad.objectiveLabel}
      </span>
    </div>
  );
};

interface AdOverviewProps {
  ads: OverviewAd[];
  view: OverviewView;
  renderDetail: (ad: OverviewAd) => React.ReactNode;
}

const AdOverview: React.FC<AdOverviewProps> = ({ ads, view, renderDetail }) => {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'recent', dir: -1 });
  const [openId, setOpenId] = useState('');
  /** 접어 둔 묶음. 기본은 다 펴 둔다 — 묶음 합계만 보려는 사람이 접는다. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...ads].sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * sort.dir || a.id.localeCompare(b.id)),
    [ads, sort],
  );

  const groups = useMemo(() => {
    if (view === 'ads') return [{ key: 'all', label: '', ads: sorted, totals: sumAds(sorted) }];
    const map = new Map<string, OverviewAd[]>();
    for (const ad of sorted) {
      const key =
        view === 'creator'
          ? ad.creatorHandle
            ? `@${ad.creatorHandle}`
            : '자체 소재'
          : ad.objectiveLabel;
      map.set(key, [...(map.get(key) || []), ad]);
    }
    // 묶음은 돈을 많이 쓴 순서로 — 먼저 봐야 할 묶음이 위에 온다.
    return [...map.entries()]
      .map(([key, list]) => ({ key, label: key, ads: list, totals: sumAds(list) }))
      .sort((a, b) => b.totals.spendKrw - a.totals.spendKrw);
  }, [sorted, view]);

  const allTotals = useMemo(() => sumAds(ads), [ads]);

  const clickSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: ASCENDING_FIRST.includes(key) ? 1 : -1 },
    );

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const sortIcon = (key: SortKey | null) =>
    key && sort.key === key ? (
      sort.dir === 1 ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />
    ) : null;

  const rows = (list: OverviewAd[]) =>
    list.map((ad) => {
      const open = openId === ad.id;
      return (
        <React.Fragment key={ad.id}>
          <tr
            onClick={() => setOpenId(open ? '' : ad.id)}
            className={`border-t border-slate-100 cursor-pointer transition-colors ${open ? 'bg-blue-50/40' : 'hover:bg-slate-50'}`}
          >
            <td className="px-3 py-2.5">
              <AdCell ad={ad} open={open} />
            </td>
            <td className="px-3 py-2.5">
              <StatusCell ad={ad} />
            </td>
            <NumberCells v={ad} result={ad.result} />
          </tr>
          {open && (
            <tr className="bg-slate-50/60">
              <td colSpan={COLUMNS.length} className="px-3 py-3">
                {renderDetail(ad)}
              </td>
            </tr>
          )}
        </React.Fragment>
      );
    });

  return (
    <>
      {/* 넓은 화면: 광고 관리자처럼 한 줄에 한 광고. */}
      <div className="hidden md:block mt-4 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        <table className="w-full min-w-[1040px]">
          <thead>
            <tr className="bg-slate-50">
              {COLUMNS.map((c) => (
                <th
                  key={c.label}
                  title={c.hint}
                  onClick={c.key ? () => clickSort(c.key!) : undefined}
                  className={`px-3 py-2 text-[10px] font-black text-slate-500 whitespace-nowrap ${
                    c.align === 'left' ? 'text-left' : 'text-right'
                  } ${c.key ? 'cursor-pointer select-none hover:text-slate-900' : ''}`}
                >
                  {c.label} {sortIcon(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) =>
              view === 'ads' ? (
                <React.Fragment key={g.key}>{rows(g.ads)}</React.Fragment>
              ) : (
                <React.Fragment key={g.key}>
                  <tr
                    onClick={() => toggleGroup(g.key)}
                    className="border-t-2 border-slate-200 bg-slate-50/80 cursor-pointer hover:bg-slate-100"
                  >
                    <td className="px-3 py-2.5" colSpan={2}>
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          className={`w-4 h-4 text-slate-400 transition-transform ${collapsed.has(g.key) ? '' : 'rotate-90'}`}
                        />
                        <span className="text-[13px] font-black text-slate-900">{g.label}</span>
                        <span className="text-[10px] font-bold text-slate-400">
                          광고 {g.totals.ads}개 · 게재 중 {g.totals.live}개
                        </span>
                      </div>
                    </td>
                    <NumberCells v={g.totals} result={g.totals.result} strong />
                  </tr>
                  {!collapsed.has(g.key) && rows(g.ads)}
                </React.Fragment>
              ),
            )}
          </tbody>
          {ads.length > 1 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-3 py-2.5 text-[12px] font-black text-slate-900" colSpan={2}>
                  합계 · 광고 {allTotals.ads}개
                </td>
                <NumberCells v={allTotals} result={allTotals.result} strong />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* 좁은 화면: 표 대신 한 줄 요약. 누르면 같은 자세한 카드를 편다. */}
      <div className="md:hidden mt-4 space-y-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {(
            [
              ['recent', '최신순'],
              ['spend', '지출'],
              ['result', '결과'],
              ['costPer', '결과당 비용'],
              ['roas', 'ROAS'],
            ] as [SortKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => clickSort(key)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${
                sort.key === key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'
              }`}
            >
              {label} {sort.key === key ? (sort.dir === 1 ? '↑' : '↓') : ''}
            </button>
          ))}
        </div>
        {groups.map((g) => (
          <div key={g.key} className="space-y-2">
            {view !== 'ads' && (
              <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                className="w-full flex items-center justify-between bg-slate-100 rounded-xl px-3 py-2"
              >
                <span className="text-[12px] font-black text-slate-900">
                  {g.label} <span className="text-[10px] text-slate-400">· {g.totals.ads}개</span>
                </span>
                <span className="text-[11px] font-black text-slate-700">
                  {dash(g.totals.spendKrw, won)}
                  {roasOf(g.totals) > 0 ? ` · ROAS ${roasOf(g.totals).toFixed(2)}` : ''}
                </span>
              </button>
            )}
            {!collapsed.has(g.key) &&
              g.ads.map((ad) => {
                const open = openId === ad.id;
                return (
                  <div key={ad.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm">
                    <button type="button" onClick={() => setOpenId(open ? '' : ad.id)} className="w-full text-left p-3">
                      <div className="flex items-start justify-between gap-2">
                        <AdCell ad={ad} open={open} />
                        <StatusCell ad={ad} />
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 mt-2">
                        <div className="bg-slate-50 rounded-lg px-2 py-1.5">
                          <p className="text-[9px] font-black text-slate-400">{ad.result.label}</p>
                          <p className="text-[12px] font-black text-slate-900">{dash(ad.result.value, count)}</p>
                        </div>
                        <div className="bg-slate-50 rounded-lg px-2 py-1.5">
                          <p className="text-[9px] font-black text-slate-400">결과당 비용</p>
                          <p className="text-[12px] font-black text-slate-900">{dash(ad.result.costPer, won)}</p>
                        </div>
                        <div className="bg-slate-50 rounded-lg px-2 py-1.5">
                          <p className="text-[9px] font-black text-slate-400">지출</p>
                          <p className="text-[12px] font-black text-slate-900">{dash(ad.spendKrw, won)}</p>
                        </div>
                      </div>
                    </button>
                    {open && <div className="px-2 pb-2">{renderDetail(ad)}</div>}
                  </div>
                );
              })}
          </div>
        ))}
        {ads.length > 1 && (
          <p className="text-[11px] font-black text-slate-500 text-right">
            합계 {formatKoreanWon(allTotals.spendKrw)} 지출 · 링크 클릭 {count(allTotals.linkClicks)}
          </p>
        )}
      </div>
    </>
  );
};

export default AdOverview;
