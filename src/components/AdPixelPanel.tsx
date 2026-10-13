import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { formatKoreanWon, formatNumberWithCommas } from '../utils/formatters';
import { EVENT_LABEL, PIXEL_EVENT_LABEL, WEBSITE_FUNNEL } from '../utils/adResults';
import { MetaPixelStats, eventsManagerUrl, fetchMetaPixelStats } from '../utils/metaAdsApi';
import MetaPixelField from './MetaPixelField';
import type { OverviewAd } from './AdOverview';

/**
 * 광고 현황의 '데이터 세트(픽셀) 성과'.
 *
 * 픽셀 숫자는 두 가지이고, 광고 관리자와 이벤트 관리자가 따로 보여 준다.
 *   1. 광고가 만든 전환 — 광고를 보거나 누른 사람이 사이트에서 일으킨 이벤트(광고 인사이트의
 *      actions). 광고 관리자의 '웹사이트 구매' · '장바구니에 담기' 열이다.
 *   2. 픽셀이 받은 전체 이벤트 — 광고와 상관없이 사이트에서 일어난 모든 이벤트(이벤트 관리자 개요).
 * 한 화면에 나란히 두면 픽셀이 제대로 설치됐는지(2가 0이면 설치 문제), 광고가 사이트 매출에서
 * 얼마를 차지하는지(1 ÷ 2)를 메타 화면 두 개를 오가지 않고 본다.
 *
 * 1은 지금 표에 보이는 광고(필터 · 기간 적용)를 더한 값이다. 2는 고른 일수의 픽셀 전체 값이다.
 */

interface AdPixelPanelProps {
  username: string;
  adAccountId: string;
  ads: OverviewAd[];
  rangeLabel: string;
}

const PIXEL_DAYS = [
  [1, '24시간'],
  [7, '7일'],
  [28, '28일'],
] as const;

const AdPixelPanel: React.FC<AdPixelPanelProps> = ({ username, adAccountId, ads, rangeLabel }) => {
  const [pixelId, setPixelId] = useState('');
  const [days, setDays] = useState<1 | 7 | 28>(7);
  const [stats, setStats] = useState<MetaPixelStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!pixelId || !adAccountId) {
      setStats(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    fetchMetaPixelStats(username, adAccountId, pixelId, days).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (res.ok) setStats(res);
      else {
        setStats(null);
        setError(res.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [username, adAccountId, pixelId, days, reload]);

  /** 광고가 만든 이벤트 합계. 표의 필터와 기간을 그대로 따른다. */
  const adEvents = useMemo(() => {
    const events: Record<string, number> = {};
    let spend = 0;
    let purchaseValue = 0;
    for (const ad of ads) {
      spend += ad.spendKrw;
      purchaseValue += ad.conversionValueKrw;
      for (const [k, v] of Object.entries(ad.events)) events[k] = (events[k] || 0) + v;
    }
    return { events, spend, purchaseValue };
  }, [ads]);

  /** 픽셀 추적이 붙지 않은 광고. 판매 광고는 세트에 픽셀이 들어가므로 따로 붙이지 않아도 잡힌다. */
  const untracked = ads.filter((a) => a.source.step === 'done' && !a.source.pixelId);
  const otherPixel = ads.filter((a) => a.source.pixelId && pixelId && a.source.pixelId !== pixelId);

  const totalPixelEvents = stats?.events.reduce((sum, e) => sum + e.count, 0) || 0;
  const pixelPurchases = stats?.events.find((e) => e.event === 'Purchase')?.count || 0;
  const adPurchases = adEvents.events.PURCHASE || 0;
  const roas = adEvents.spend > 0 ? adEvents.purchaseValue / adEvents.spend : 0;

  return (
    <div className="mt-6 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-black text-slate-900">데이터 세트(픽셀) 성과</p>
          <p className="text-[11px] text-slate-400 font-bold mt-0.5">
            광고를 보고 웹사이트에 들어온 사람의 행동과, 픽셀이 사이트 전체에서 받은 이벤트를 함께 봅니다
          </p>
        </div>
        {pixelId && (
          <a
            href={eventsManagerUrl(pixelId)}
            target="_blank"
            rel="noreferrer"
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black text-blue-600 hover:bg-blue-50"
          >
            이벤트 관리자
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <div className="mt-3 max-w-md">
        <MetaPixelField
          businessUsername={username}
          adAccountId={adAccountId}
          pixelId={pixelId}
          onChange={setPixelId}
          mode="view"
          inputId="status-pixel"
        />
      </div>

      {pixelId && (
        <>
          {/* 1. 광고가 만든 웹사이트 전환 — 구매 흐름 순서대로. */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-black text-slate-700">광고로 발생한 웹사이트 전환 · {rangeLabel}</p>
              {roas > 0 && (
                <p className="text-[11px] font-black text-emerald-600">
                  구매 ROAS {roas.toFixed(2)}배 · 전환 가치 {formatKoreanWon(adEvents.purchaseValue)}
                </p>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-2">
              {WEBSITE_FUNNEL.map((key, i) => {
                const value = adEvents.events[key] || 0;
                const prev = i > 0 ? adEvents.events[WEBSITE_FUNNEL[i - 1]] || 0 : 0;
                return (
                  <div key={key} className="bg-slate-50 rounded-xl px-3 py-2.5">
                    <p className="text-[10px] font-black text-slate-400">{EVENT_LABEL[key]}</p>
                    <p className={`text-[15px] font-black mt-0.5 ${value > 0 ? 'text-slate-900' : 'text-slate-300'}`}>
                      {value > 0 ? formatNumberWithCommas(value) : '—'}
                    </p>
                    <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                      {value > 0 && adEvents.spend > 0 ? `건당 ${formatNumberWithCommas(Math.round(adEvents.spend / value))}원` : ' '}
                      {i > 0 && prev > 0 && value > 0 ? ` · 전 단계의 ${((value / prev) * 100).toFixed(1)}%` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
            {/* 흐름 밖의 전환 이벤트 — 잠재 고객 · 등록 같은 것. 있을 때만. */}
            {(['LEAD', 'COMPLETE_REGISTRATION', 'ADD_PAYMENT_INFO', 'SEARCH'] as const).some((k) => adEvents.events[k]) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(['LEAD', 'COMPLETE_REGISTRATION', 'ADD_PAYMENT_INFO', 'SEARCH'] as const)
                  .filter((k) => adEvents.events[k])
                  .map((k) => (
                    <span key={k} className="px-2 py-1 rounded-lg bg-slate-50 text-[10px] font-black text-slate-600">
                      {EVENT_LABEL[k]} {formatNumberWithCommas(adEvents.events[k])}건
                    </span>
                  ))}
              </div>
            )}
            {untracked.length > 0 && (
              <p className="mt-2 text-[10px] font-bold text-amber-600 leading-relaxed">
                픽셀 추적을 붙이지 않은 광고 {untracked.length}개가 있습니다(예전에 만든 광고 등). 판매 목적이 아니면 이 광고들의
                웹사이트 전환은 위 숫자에 빠질 수 있습니다. 새로 만드는 광고는 고른 픽셀이 자동으로 추적에 붙습니다.
              </p>
            )}
            {otherPixel.length > 0 && (
              <p className="mt-1 text-[10px] font-bold text-slate-400 leading-relaxed">
                다른 픽셀로 추적하는 광고 {otherPixel.length}개도 위 합계에 들어 있습니다.
              </p>
            )}
          </div>

          {/* 2. 픽셀이 사이트 전체에서 받은 이벤트 — 이벤트 관리자 개요. */}
          <div className="mt-5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[12px] font-black text-slate-700">픽셀이 받은 전체 이벤트</p>
              <div className="flex items-center gap-1">
                {PIXEL_DAYS.map(([d, label]) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDays(d)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-black ${
                      days === d ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setReload((n) => n + 1)}
                  aria-label="픽셀 이벤트 새로고침"
                  className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {loading && !stats ? (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> 픽셀 이벤트를 불러오는 중…
              </p>
            ) : error ? (
              <p className="mt-2 text-[11px] font-bold text-rose-500 break-words">{error}</p>
            ) : stats && stats.events.length === 0 ? (
              <div className="mt-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                <p className="text-[11px] font-black text-amber-700">최근 {days === 1 ? '24시간' : `${days}일`} 동안 받은 이벤트가 없습니다</p>
                <p className="text-[10px] font-bold text-amber-600 mt-0.5 leading-relaxed">
                  웹사이트에 픽셀 기본 코드가 설치됐는지 확인해 주세요. 위 '설치 코드 보기'에서 코드를 복사할 수 있습니다. 설치 전에는
                  광고의 웹사이트 전환도 측정되지 않습니다.
                </p>
              </div>
            ) : stats ? (
              <>
                {stats.pixel.unavailable && (
                  <p className="mt-2 text-[10px] font-bold text-rose-500">메타가 이 픽셀을 사용할 수 없는 상태로 표시했습니다. 이벤트 관리자에서 확인해 주세요.</p>
                )}
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                  {stats.events.slice(0, 12).map((e) => (
                    <div key={e.event} className="bg-slate-50 rounded-xl px-3 py-2">
                      <p className="text-[10px] font-black text-slate-400 truncate">
                        {PIXEL_EVENT_LABEL[e.event] || e.event}
                        {PIXEL_EVENT_LABEL[e.event] && <span className="font-medium"> · {e.event}</span>}
                      </p>
                      <p className="text-[14px] font-black text-slate-900 mt-0.5">{formatNumberWithCommas(e.count)}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] font-bold text-slate-400 leading-relaxed">
                  총 {formatNumberWithCommas(totalPixelEvents)}건
                  {pixelPurchases > 0 && adPurchases > 0
                    ? ` · 사이트 전체 구매 ${formatNumberWithCommas(pixelPurchases)}건 중 광고 기여 구매 ${formatNumberWithCommas(adPurchases)}건(기간이 다를 수 있어 참고용)`
                    : ''}
                </p>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};

export default AdPixelPanel;
