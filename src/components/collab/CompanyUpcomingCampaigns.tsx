import React, { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';

/**
 * 캠페인 메뉴의 "회사 전체 진행 예정" 탭 — 직원이 맡은 캠페인까지 포함한 진행 예정 요약.
 *
 * "내 캠페인" 탭과 같은 카드(썸네일 · 상태 · 브랜드 · 카테고리 · 제목)로 보여 준다. 글자만 있는
 * 목록은 내 캠페인과 나란히 볼 때 같은 캠페인인지 알아보기 어려웠다.
 *
 * 상세 진행과 인플루언서 연락은 각 캠페인 담당자의 일이라, 카드 아래에는 담당자 · 업로드 기간과
 * 진행이 확정된 인플루언서(업로드 예정일 · 단가)만 적는다. 연락처는 없다. 내가 맡은 캠페인은
 * 카드를 누르면 상세가 열리고, 다른 직원의 캠페인은 열리지 않는다.
 */

type Influencer = {
  username: string;
  instagramHandle: string;
  profileImage?: string;
  uploadDue: string;
  feeKrw?: number;
  uploaded: boolean;
};
type UpcomingCampaign = {
  id: string;
  title: string;
  status: string;
  ownerMember: string;
  ownerName: string;
  thumbnailUrl?: string;
  brandName?: string;
  category?: string;
  budgetKrw?: number;
  uploadFrom: string;
  uploadTo: string;
  influencers: Influencer[];
};

interface Props {
  businessUsername: string;
  categoryLabel?: (value: string) => string;
  renderStatus?: (status: string) => React.ReactNode;
  /** 내가 맡은 캠페인이면 상세를 열고 true. 열 수 없으면 false. */
  onOpen?: (campaignId: string) => boolean;
}

const dateText = (v: string) => (v ? v.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2.$3') : '');
const periodText = (from: string, to: string) => {
  if (from && to) return `${dateText(from)} ~ ${dateText(to)}`;
  if (from || to) return dateText(from || to);
  return '미정';
};

const CompanyUpcomingCampaigns: React.FC<Props> = ({ businessUsername, categoryLabel, renderStatus, onOpen }) => {
  const [campaigns, setCampaigns] = useState<UpcomingCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns?business=${encodeURIComponent(businessUsername)}&view=company_upcoming`, {
        headers: await authHeaders({}, { account: businessUsername }),
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '');
      setCampaigns(Array.isArray(json.campaigns) ? json.campaigns : []);
      setError('');
    } catch (e) {
      setError((e as Error)?.message || '회사 전체 캠페인을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [businessUsername]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 2500);
    return () => window.clearTimeout(t);
  }, [notice]);

  const owners = Array.from(new Map(campaigns.map((c) => [c.ownerMember, c.ownerName])).entries());
  const visible = ownerFilter === 'all' ? campaigns : campaigns.filter((c) => c.ownerMember === ownerFilter);

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-10 h-10 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-400 font-bold">회사 전체 캠페인을 불러오는 중...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="py-12 text-center text-sm text-red-600">
        <p>{error}</p>
        <button type="button" onClick={() => void load()} className="mt-3 font-bold">다시 시도</button>
      </div>
    );
  }

  const open = (c: UpcomingCampaign) => {
    if (onOpen && onOpen(c.id)) return;
    setNotice(`${c.ownerName} 담당 캠페인이에요. 상세 진행은 담당자만 볼 수 있어요.`);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        <button
          type="button"
          onClick={() => setOwnerFilter('all')}
          className={`px-3.5 py-1.5 rounded-full text-sm font-black whitespace-nowrap border ${ownerFilter === 'all' ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
        >
          {`전체 ${campaigns.length}`}
        </button>
        {owners.map(([key, name]) => (
          <button
            key={key || 'owner'}
            type="button"
            onClick={() => setOwnerFilter(key)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-black whitespace-nowrap border ${ownerFilter === key ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
          >
            {`${name} ${campaigns.filter((c) => c.ownerMember === key).length}`}
          </button>
        ))}
      </div>

      {notice && (
        <p className="text-xs font-bold text-slate-600 bg-slate-100 rounded-lg px-3 py-2">{notice}</p>
      )}

      {visible.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
          <p className="text-sm font-black text-slate-700">진행 예정인 캠페인이 없어요</p>
          <p className="text-xs text-slate-400 font-medium mt-1">직원이 등록한 캠페인도 진행이 잡히면 여기에 모여요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 md:gap-3">
          {visible.map((c) => {
            const pending = c.influencers.filter((i) => !i.uploaded).length;
            const totalFee = c.influencers.reduce((sum, i) => sum + (i.feeKrw || 0), 0);
            const sorted = [...c.influencers].sort(
              (a, b) => Number(a.uploaded) - Number(b.uploaded) || (a.uploadDue || '9999').localeCompare(b.uploadDue || '9999'),
            );
            const shown = sorted.slice(0, 3);
            const category = c.category ? (categoryLabel ? categoryLabel(c.category) : c.category) : '';
            return (
              <div
                key={c.id}
                onClick={() => open(c)}
                className="bg-white rounded-xl border border-slate-100 hover:border-blue-200 hover:shadow-lg transition-all cursor-pointer group overflow-hidden flex flex-col"
              >
                <div className="w-full aspect-square bg-slate-50 overflow-hidden relative">
                  {c.thumbnailUrl ? (
                    <img src={c.thumbnailUrl} alt={c.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-50">
                      <svg className="w-10 h-10 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    {renderStatus ? renderStatus(c.status) : null}
                  </div>
                  <span className="absolute bottom-2.5 left-2.5 max-w-[calc(100%-20px)] truncate px-2 py-0.5 rounded-lg bg-white/90 backdrop-blur-sm text-violet-600 text-[11px] font-black shadow-sm">
                    {`담당자: ${c.ownerName}`}
                  </span>
                </div>

                <div className="p-2.5 md:p-3 flex-1 flex flex-col">
                  <div className="flex items-center gap-1.5 mb-1 min-w-0">
                    {c.brandName && <span className="text-xs text-slate-400 font-bold truncate">{c.brandName}</span>}
                    {category && (
                      <>
                        {c.brandName && <span className="text-slate-200">·</span>}
                        <span className="text-xs text-slate-400 font-medium truncate">{category}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-black text-sm md:text-base text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors mb-1">
                    {c.title || '제목 없는 캠페인'}
                  </h3>
                  <div className="flex items-center justify-between gap-2">
                    {totalFee > 0 ? (
                      <span className="text-sm font-black text-slate-900 truncate">
                        <span className="text-[10px] text-slate-400 font-black mr-1">진행 합계</span>
                        {formatKoreanWon(totalFee)}
                      </span>
                    ) : (c.budgetKrw || 0) > 0 ? (
                      <span className="text-sm font-black text-blue-600 truncate">
                        <span className="text-[10px] text-slate-400 font-black mr-1">총 예산</span>
                        {formatKoreanWon(c.budgetKrw || 0)}
                      </span>
                    ) : <span />}
                    <span className="text-xs text-slate-400 font-bold whitespace-nowrap">{`진행 예정 ${pending}명`}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-bold mt-1">{`업로드 기간 ${periodText(c.uploadFrom, c.uploadTo)}`}</p>

                  {shown.length > 0 && (
                    <ul className="mt-2 pt-2 border-t border-slate-100 space-y-1.5">
                      {shown.map((i) => (
                        <li key={i.username} className="flex items-center gap-1.5 min-w-0">
                          {i.profileImage ? (
                            <img src={i.profileImage} alt="" className="w-5 h-5 rounded-full object-cover shrink-0 bg-slate-100" />
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-slate-100 shrink-0" />
                          )}
                          <span className="text-[12px] font-bold text-slate-800 truncate flex-1 min-w-0">
                            {i.instagramHandle ? `@${i.instagramHandle.replace(/^@/, '')}` : i.username}
                          </span>
                          <span className="text-[11px] font-black text-slate-900 whitespace-nowrap">
                            {i.feeKrw && i.feeKrw > 0 ? formatKoreanWon(i.feeKrw) : '단가 미정'}
                          </span>
                          <span className={`text-[10px] font-black whitespace-nowrap ${i.uploaded ? 'text-emerald-600' : 'text-slate-500'}`}>
                            {i.uploaded ? '업로드 완료' : i.uploadDue ? dateText(i.uploadDue) : '일정 미정'}
                          </span>
                        </li>
                      ))}
                      {sorted.length > shown.length && (
                        <li className="text-[11px] text-slate-400 font-bold">{`외 ${sorted.length - shown.length}명`}</li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CompanyUpcomingCampaigns;
