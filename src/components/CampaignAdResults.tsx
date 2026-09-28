import React, { useCallback, useEffect, useState } from 'react';
import { useVisiblePolling } from '../hooks/useVisiblePolling';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { formatNumberWithCommas } from '../utils/formatters';
import {
  MetaAdDisplayStatus,
  MetaAdWithLive,
  adsManagerUrl,
  fetchMetaAds,
  subscribeMetaAds,
} from '../utils/metaAdsApi';

/**
 * 캠페인 이력의 '부스팅한 광고 성과' — 이력에서 고른 게시물로 만든 광고가 메타에서
 * 지금 어떤 상태이고 얼마나 노출됐는지.
 *
 * 광고 현황과 같은 서버 기록(api-meta-ads-ads)을 읽고, 부스팅(source = partnership)만
 * 추린다. 상태·지표는 메타에서 방금 읽은 값이다. 이력 화면에서 부스팅한 브랜드가
 * 화면을 옮기지 않고도 "메타가 검토 중인지, 게재가 시작됐는지"를 볼 수 있게 한다.
 */

const STATUS: Record<MetaAdDisplayStatus, { label: string; cls: string }> = {
  draft: { label: '만드는 중 멈춤', cls: 'bg-rose-50 text-rose-600' },
  review: { label: 'Meta 검토 중', cls: 'bg-amber-50 text-amber-600' },
  active: { label: '게재 중', cls: 'bg-emerald-50 text-emerald-600' },
  paused: { label: '일시중지', cls: 'bg-slate-100 text-slate-500' },
  rejected: { label: '반려됨', cls: 'bg-rose-50 text-rose-600' },
  issue: { label: '게재 문제', cls: 'bg-orange-50 text-orange-600' },
  ended: { label: '종료', cls: 'bg-slate-100 text-slate-500' },
};

interface CampaignAdResultsProps {
  username: string;
  /** 연동한 광고 계정(act_… ). 없으면 그리지 않는다. */
  accountId: string;
  onViewAdStatus?: () => void;
}

const CampaignAdResults: React.FC<CampaignAdResultsProps> = ({ username, accountId, onViewAdStatus }) => {
  const [ads, setAds] = useState<MetaAdWithLive[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState('');

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const res = await fetchMetaAds(username, accountId);
    if (res.ok) {
      setAds(res.ads.filter((ad) => ad.source === 'partnership'));
      setFetchedAt(res.fetchedAt);
      setError('');
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, [username, accountId]);

  useEffect(() => {
    void load();
    return subscribeMetaAds(() => void load());
  }, [load]);

  // 광고 관리자에서 지운 광고가 여기서도 빠지도록, 창으로 돌아오면(그리고 1분마다) 다시 읽는다.
  // 첫 조회는 위에서 하므로 폴링은 한 주기 뒤에 시작한다.
  useVisiblePolling(() => load(), 60_000, !!accountId, accountId, 60_000);

  if (!accountId) return null;

  return (
    <div className="bg-white rounded-3xl border border-slate-100 p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900">부스팅한 광고 성과</p>
          <p className="text-[11px] text-slate-400 font-bold mt-0.5">
            Meta Marketing API에서 실시간으로 읽은 상태·지표입니다
            {fetchedAt ? ` · ${new Date(fetchedAt).toLocaleString()} 조회` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="새로고침"
          className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && ads.length === 0 ? (
        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400 py-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Meta에서 광고 상태를 불러오는 중
        </div>
      ) : error ? (
        <p className="text-[11px] text-rose-600 font-bold py-2 break-words">{error}</p>
      ) : ads.length === 0 ? (
        <p className="text-[11px] text-slate-400 font-bold py-3">
          아직 부스팅한 광고가 없습니다. 게시물에서 '메타 광고로 부스팅'을 누르면 Meta에 광고가 만들어지고 여기에
          상태가 올라옵니다.
        </p>
      ) : (
        <div className="mt-2 divide-y divide-slate-100">
          {ads.map((ad) => {
            const status = STATUS[ad.step !== 'done' ? 'draft' : ad.meta.displayStatus];
            return (
              <div key={ad.id} className="flex items-center gap-3 py-2.5">
                {ad.thumbnailUrl ? (
                  <img src={ad.thumbnailUrl} alt="" className="w-11 h-11 rounded-xl object-cover bg-slate-100 flex-shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-xl bg-slate-100 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${status.cls}`}>{status.label}</span>
                    <p className="text-[12px] font-bold text-slate-700 truncate">
                      {ad.campaignTitle || ad.name}
                      {ad.creatorHandle ? ` · @${ad.creatorHandle}` : ''}
                    </p>
                  </div>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5 break-all">
                    노출 {formatNumberWithCommas(ad.meta.impressions || 0)} · 클릭{' '}
                    {formatNumberWithCommas(ad.meta.clicks || 0)} · 지출{' '}
                    {formatNumberWithCommas(Math.round(ad.meta.spend || 0))} {ad.currency}
                    {ad.campaignId ? ` · 캠페인 ID ${ad.campaignId}` : ''}
                  </p>
                </div>
                {ad.campaignId && (
                  <a
                    href={adsManagerUrl(ad)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="광고 관리자에서 보기"
                    className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {onViewAdStatus && ads.length > 0 && (
        <button
          type="button"
          onClick={onViewAdStatus}
          className="mt-2 text-[11px] font-black text-blue-600 hover:underline"
        >
          광고 현황에서 일시중지 · 재개하기
        </button>
      )}
    </div>
  );
};

export default CampaignAdResults;
