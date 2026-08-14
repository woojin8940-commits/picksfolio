import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../services/apiService';
import { formatKoreanWon } from '../utils/formatters';
import { rewardModeOf } from '../utils/campaignBrief';
import CampaignProcessBoard from './collab/CampaignProcessBoard';
import CampaignInsightPanel from './collab/CampaignInsightPanel';
import CampaignSettlementPanel from './collab/CampaignSettlementPanel';
import Toast from './Toast';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * 캠페인 협업 — 인플루언서가 자기 캠페인을 진행하는 곳.
 *
 * 브랜드 화면(CampaignCollabManagement)과 같은 모양으로 짠다. 캠페인이 카드로
 * 깔리고, 하나를 누르면 그 캠페인의 상세가 열리고, 상세는 진행사항 · 인사이트 ·
 * 정산 탭으로 나뉜다. 예전에는 인플루언서만 다른 모양이었다 — 캠페인 찾기 목록
 * 위에 '캠페인 현황'이라는 상자가 얹혀 있고, 그 안에서 줄을 펼쳐 단계를 굴렸다.
 * 같은 협업을 브랜드는 캠페인 단위로, 인플루언서는 목록 위 상자로 보다 보니
 * "브랜드가 보는 화면"과 "내가 보는 화면"을 말로 맞춰야 했다.
 *
 * 진행사항 탭은 브랜드가 인플루언서 한 명을 열었을 때와 같은 컴포넌트
 * (CampaignProcessBoard)를 role='influencer' 로 그린다. 같은 단계를 서로 다른
 * 이름으로 볼 일이 없다.
 *
 * 지원해 두고 결과를 기다리는 캠페인도 같은 카드로 깔되 누를 수 없게 둔다. 협업이
 * 아직 없어서 열 진행사항이 없기 때문인데, 목록에서 아예 빼면 "지원한 게 어디
 * 갔는지"를 다른 메뉴에서 다시 찾아야 한다.
 */

interface CreatorCampaignCollabsProps {
  userName: string;
}

type DetailTab = 'progress' | 'insight' | 'settlement';

const CATEGORY_LABELS: Record<string, string> = {
  beauty: '뷰티', fashion: '패션', food: '식품', lifestyle: '라이프스타일',
  travel: '여행', health: '건강', tech: 'IT/테크', parenting: '육아',
  pet: '반려동물', interior: '인테리어', sports: '스포츠',
  entertainment: '엔터테인먼트', education: '교육', other: '기타',
};

/** 지원했지만 아직 협업이 열리지 않은 캠페인의 상태 한 마디. */
const APPLY_STATUS: Record<string, { label: string; cls: string; note: string }> = {
  pending: {
    label: '검토 중',
    cls: 'bg-amber-500 text-white',
    note: '브랜드와 담당자가 지원 내용을 확인하고 있습니다.',
  },
  accepted: {
    label: '선정 · 진행 준비',
    cls: 'bg-blue-600 text-white',
    note: '담당자가 조건을 정리하면 진행 단계가 열립니다.',
  },
  rejected: {
    label: '미선정',
    cls: 'bg-slate-400 text-white',
    note: '다른 캠페인에서 다시 만나요.',
  },
};

const dueText = (dueDate: string, daysLeft: number | null, isEn: boolean) => {
  if (!dueDate) return isEn ? 'No deadline' : '마감일 미정';
  if (daysLeft === null || daysLeft === undefined) return dueDate;
  if (daysLeft < 0) return isEn ? `${-daysLeft} days overdue` : `${-daysLeft}일 지났어요`;
  if (daysLeft === 0) return isEn ? 'Due today' : '오늘까지';
  return isEn ? `${daysLeft} days left` : `${daysLeft}일 남음`;
};

/** 카드 왼쪽 위 배지. 브랜드 카드의 모집 상태 자리와 같은 자리다. */
const collabBadge = (c: any): { label: string; cls: string } => {
  if (c.status === 'completed') return { label: '완료', cls: 'bg-emerald-500 text-white' };
  if (c.status === 'cancelled') return { label: '취소', cls: 'bg-slate-400 text-white' };
  return { label: '진행중', cls: 'bg-blue-600 text-white' };
};

const CreatorCampaignCollabs: React.FC<CreatorCampaignCollabsProps> = ({ userName }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

  const [collabs, setCollabs] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('progress');

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const notify = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  const load = useCallback(async () => {
    setLoading(true);
    const [collabRes, applyRes] = await Promise.all([
      apiService.getCollabs('influencer'),
      fetch(`/.netlify/functions/api-campaign-applications?username=${encodeURIComponent(userName)}`)
        .then(r => r.json())
        .catch(() => ({ applications: [] })),
    ]);
    setCollabs(collabRes.collabs || []);
    setApplications(Array.isArray(applyRes?.applications) ? applyRes.applications : []);
    setLoading(false);
  }, [userName]);

  useEffect(() => {
    if (userName) load();
  }, [userName, load]);

  const refreshDetail = async (collabId: string) => {
    const res = await apiService.getCollabDetail(collabId);
    if (res.error) {
      notify(res.error, 'error');
      return null;
    }
    setDetail(res);
    return res;
  };

  const openCollab = async (collabId: string) => {
    setSelectedId(collabId);
    setDetail(null);
    setDetailTab('progress');
    setDetailLoading(true);
    window.scrollTo({ top: 0 });
    await refreshDetail(collabId);
    setDetailLoading(false);
  };

  const openManagerThread = (collabId: string) => {
    window.dispatchEvent(
      new CustomEvent('navigate-timeline', {
        detail: { proposalId: `support_inf_${collabId}` },
      }),
    );
  };

  // 협업이 열린 캠페인은 지원 목록에서 뺀다. 같은 캠페인이 "지원 검토 중"과
  // "3단계 진행 중"으로 두 장 나오면 어느 쪽이 지금인지 알 수 없다.
  const waiting = useMemo(() => {
    const started = new Set(collabs.map(c => String(c.campaignId || '')).filter(Boolean));
    return applications.filter(a => !started.has(String(a.campaign_id)));
  }, [collabs, applications]);

  const selected = collabs.find(c => c.id === selectedId) || null;

  const thumbOf = (url: string, title: string, cls: string) =>
    url ? (
      <img src={url} alt={title} className={`${cls} object-cover`} />
    ) : (
      <div className={`${cls} flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-50`}>
        <svg className="w-8 h-8 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    );

  const toastEl = (
    <Toast
      message={toast?.message || ''}
      type={toast?.type || 'success'}
      isVisible={!!toast}
      onClose={() => setToast(null)}
    />
  );

  // ------------------------------------------------------------------ 상세
  if (selected) {
    const terms = detail?.terms || null;
    const fee = Number(terms?.fee || 0);
    const netFee = Number(terms?.netFee || 0);
    const mode = rewardModeOf(selected.campaignRewardMode);
    const badge = collabBadge(selected);
    const mineNow =
      selected.currentStageOwner === 'influencer' && ['active', 'revision'].includes(selected.currentStageStatus);

    /**
     * 상세 탭. 정산은 지급할 돈이 있는 협업에만 붙인다 — 제품 협찬형은 광고비도
     * 판매 수수료도 없어 정산 자체가 만들어지지 않는다. 빈 정산 탭을 남겨 두면
     * 오지 않을 입금을 기다리게 된다. 조건에 보수가 잡혀 있으면 진행 방식과
     * 무관하게 열어 둔다(예전 방식으로 시작된 협업).
     */
    const TABS: { key: DetailTab; label: string }[] = [
      { key: 'progress', label: isEn ? 'Progress' : '진행사항' },
      { key: 'insight', label: isEn ? 'Insights' : '인사이트' },
      ...(mode.hasSettlement || fee > 0 ? [{ key: 'settlement' as const, label: isEn ? 'Settlement' : '정산' }] : []),
    ];
    const activeTab = TABS.some(t => t.key === detailTab) ? detailTab : 'progress';

    return (
      <main className="p-4 md:p-10 w-full animate-in fade-in duration-500 max-w-5xl mx-auto">
        <button
          onClick={() => { setSelectedId(''); setDetail(null); }}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-black text-sm mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          {isEn ? 'Campaign list' : '캠페인 목록'}
        </button>

        {/* 머리말. 지금 어느 단계이고 언제까지인지, 보수는 얼마인지 — 진행 중에 계속
            확인하는 값만 남긴다. */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8 mb-4">
          <div className="flex items-start gap-4">
            {thumbOf(selected.campaignThumbnail, selected.campaignTitle, 'w-20 h-20 md:w-24 md:h-24 rounded-2xl flex-shrink-0')}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-black ${badge.cls}`}>{badge.label}</span>
                {mineNow && (
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-black bg-slate-900 text-white">
                    {isEn ? 'Your turn' : '내 차례'}
                  </span>
                )}
                <span className="text-[11px] text-slate-400 font-bold">{mode.label}</span>
                {selected.campaignCategory && (
                  <span className="text-[11px] text-slate-400 font-bold">
                    · {CATEGORY_LABELS[selected.campaignCategory] || selected.campaignCategory}
                  </span>
                )}
              </div>
              <h2 className="text-xl md:text-2xl font-black text-slate-900 break-keep">{selected.campaignTitle}</h2>
              {selected.companyName && <p className="text-sm text-slate-500 font-bold mt-1">{selected.companyName}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
            <div className="bg-slate-50 rounded-xl px-4 py-3">
              <p className="text-[10px] font-black text-slate-400">{isEn ? 'Current step' : '현재 단계'}</p>
              <p className="text-sm font-black text-slate-900 mt-0.5 truncate">
                {selected.currentStageTitle ||
                  (selected.status === 'completed' ? (isEn ? 'All done' : '모든 단계 완료') : isEn ? 'Preparing' : '준비 중')}
              </p>
            </div>
            <div className="bg-slate-50 rounded-xl px-4 py-3">
              <p className="text-[10px] font-black text-slate-400">{isEn ? 'Due' : '마감'}</p>
              <p className={`text-sm font-black mt-0.5 ${(selected.daysLeft ?? 1) < 0 ? 'text-red-500' : 'text-slate-900'}`}>
                {dueText(selected.dueDate, selected.daysLeft, isEn)}
              </p>
            </div>
            <div className="bg-slate-50 rounded-xl px-4 py-3 col-span-2 md:col-span-1">
              <p className="text-[10px] font-black text-slate-400">{isEn ? 'Payout' : '보수'}</p>
              <p className="text-sm font-black text-slate-900 mt-0.5 truncate">
                {fee > 0 ? formatKoreanWon(fee) : isEn ? 'In negotiation' : '협의 중'}
                {fee > 0 && (
                  <span className="text-[11px] text-slate-400 font-bold ml-1.5">
                    {isEn ? 'net' : '세후'} {formatKoreanWon(netFee)}
                  </span>
                )}
              </p>
              {terms && (
                <p className={`text-[10px] font-black mt-0.5 ${terms.lockedAt ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {terms.lockedAt ? (isEn ? 'Confirmed' : '조건 확정') : isEn ? 'Awaiting' : '확정 대기'}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${selected.status === 'cancelled' ? 'bg-red-400' : 'bg-slate-900'}`}
                style={{ width: `${Math.min(100, Math.max(0, selected.progress || 0))}%` }}
              />
            </div>
          </div>
        </div>

        {/* 탭 */}
        <div className="flex items-center gap-1 border-b border-slate-100 mb-5 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setDetailTab(t.key)}
              className={`px-4 py-3 text-xs font-black whitespace-nowrap border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {detailLoading ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
            <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400 font-bold">{isEn ? 'Loading...' : '불러오는 중...'}</p>
          </div>
        ) : !detail ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
            <p className="text-sm text-slate-500 font-bold">{isEn ? 'Failed to load.' : '정보를 불러오지 못했습니다.'}</p>
            <button
              onClick={() => openCollab(selected.id)}
              className="mt-3 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-700 transition-colors"
            >
              {isEn ? 'Retry' : '다시 시도'}
            </button>
          </div>
        ) : (
          <>
            {/* -------------------------------------------------- 진행사항 */}
            {activeTab === 'progress' && (
              <div className="space-y-3">
                <CampaignProcessBoard
                  collabId={detail.collab.id}
                  role="influencer"
                  detail={detail}
                  onRefresh={async () => {
                    await refreshDetail(detail.collab.id);
                    await load();
                  }}
                  onNotify={notify}
                />
                <div className="flex items-center justify-between gap-3 pt-0.5">
                  <p className="text-[11px] text-slate-400 font-bold">
                    {isEn ? 'Questions on terms or schedule?' : '조건 · 일정 문의는 담당자에게 보내 주세요.'}
                  </p>
                  <button
                    onClick={() => openManagerThread(selected.id)}
                    className="px-3.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-black hover:border-slate-900 hover:text-slate-900 transition-colors flex-shrink-0"
                  >
                    {isEn ? 'Chat with manager' : '담당자와 대화'}
                  </button>
                </div>
              </div>
            )}

            {/* -------------------------------------------------- 인사이트 */}
            {activeTab === 'insight' && (
              <CampaignInsightPanel
                viewer="influencer"
                budgetKrw={0}
                uploadedCount={detail.collab?.uploadConfirmedAt ? 1 : 0}
                totalCollabs={1}
              />
            )}

            {/* -------------------------------------------------- 정산 */}
            {activeTab === 'settlement' && (
              <CampaignSettlementPanel
                viewer="influencer"
                influencerUsername={userName}
                campaignId={selected.campaignId}
                feeKrw={fee}
                netFeeKrw={netFee}
              />
            )}
          </>
        )}
        {toastEl}
      </main>
    );
  }

  // ------------------------------------------------------------------ 목록
  return (
    <main className="p-4 md:p-10 w-full animate-in fade-in duration-500 max-w-5xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-lg md:text-2xl font-black text-slate-900">{isEn ? 'Campaign Collabs' : '캠페인 협업'}</h2>
          <p className="text-xs md:text-sm text-slate-500 font-medium mt-1">
            {isEn
              ? 'Open a campaign to run its steps, insights and settlement.'
              : '진행 중인 캠페인을 눌러 단계 · 인사이트 · 정산을 확인하고 입력하세요'}
          </p>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-500 text-xs font-black hover:border-slate-900 hover:text-slate-900 transition-colors"
        >
          {isEn ? 'Refresh' : '새로고침'}
        </button>
      </header>

      {loading ? (
        <div className="text-center py-20">
          <div className="w-10 h-10 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-slate-400 font-bold">{isEn ? 'Loading campaigns...' : '캠페인 불러오는 중...'}</p>
        </div>
      ) : collabs.length === 0 && waiting.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
          </div>
          <h3 className="text-lg font-black text-slate-900 mb-2">
            {isEn ? 'No campaigns yet' : '진행 중인 캠페인이 없습니다'}
          </h3>
          <p className="text-sm text-slate-500 font-medium">
            {isEn
              ? 'Campaigns you apply to show up here once they start.'
              : '캠페인 메뉴에서 지원하면 선정된 캠페인이 이곳에 나타납니다'}
          </p>
        </div>
      ) : (
        <>
          {collabs.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3">
              {collabs.map(c => {
                const badge = collabBadge(c);
                const mineNow =
                  c.currentStageOwner === 'influencer' && ['active', 'revision'].includes(c.currentStageStatus);
                const overdue = (c.daysLeft ?? 1) < 0 && c.status !== 'completed';
                return (
                  <button
                    key={c.id}
                    onClick={() => openCollab(c.id)}
                    className="text-left bg-white rounded-xl border border-slate-100 hover:border-blue-200 hover:shadow-lg transition-all cursor-pointer group overflow-hidden"
                  >
                    <div className="w-full aspect-square bg-slate-50 overflow-hidden relative">
                      {thumbOf(c.campaignThumbnail, c.campaignTitle, 'w-full h-full group-hover:scale-105 transition-transform duration-300')}
                      <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {mineNow && (
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-slate-900 text-white shadow-sm">
                            {isEn ? 'Your turn' : '내 차례'}
                          </span>
                        )}
                      </div>
                      {c.status !== 'completed' && c.status !== 'cancelled' && c.dueDate && (
                        <span
                          className={`absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm text-white ${
                            overdue ? 'bg-rose-500' : 'bg-slate-900/85'
                          }`}
                        >
                          {dueText(c.dueDate, c.daysLeft, isEn)}
                        </span>
                      )}
                    </div>

                    <div className="p-2.5 md:p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        {c.companyName && (
                          <span className="text-[10px] text-slate-400 font-bold truncate">{c.companyName}</span>
                        )}
                        {c.campaignCategory && (
                          <>
                            <span className="text-slate-200">·</span>
                            <span className="text-[10px] text-slate-400 font-medium truncate">
                              {CATEGORY_LABELS[c.campaignCategory] || c.campaignCategory}
                            </span>
                          </>
                        )}
                      </div>
                      <h3 className="font-black text-xs md:text-sm text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors mb-1.5">
                        {c.campaignTitle}
                      </h3>
                      <p className="text-[10px] text-slate-500 font-bold truncate mb-1.5">
                        {c.currentStageTitle ||
                          (c.status === 'completed' ? (isEn ? 'All done' : '모든 단계 완료') : isEn ? 'Preparing' : '준비 중')}
                      </p>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${c.status === 'cancelled' ? 'bg-red-400' : 'bg-slate-900'}`}
                          style={{ width: `${Math.min(100, Math.max(0, c.progress || 0))}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* 지원해 두고 결과를 기다리는 캠페인. 협업이 아직 없어 열 진행사항이 없으므로
              누를 수 없게 두되, 무엇을 기다리는 중인지는 카드에 적어 둔다. */}
          {waiting.length > 0 && (
            <section className="mt-8">
              <h3 className="text-sm font-black text-slate-900 mb-1">
                {isEn ? 'Waiting for results' : '지원 결과 대기'}
              </h3>
              <p className="text-[11px] text-slate-400 font-medium mb-3">
                {isEn
                  ? 'Selected campaigns move up to the list above.'
                  : '선정되면 위 목록으로 옮겨지고 진행 단계가 열립니다.'}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3">
                {waiting.map(a => {
                  const status = APPLY_STATUS[String(a.status)] || APPLY_STATUS.pending;
                  return (
                    <div key={a.id} className="bg-white rounded-xl border border-slate-100 overflow-hidden opacity-90">
                      <div className="w-full aspect-square bg-slate-50 overflow-hidden relative">
                        {thumbOf(a.thumbnail_url, a.campaign_title, 'w-full h-full')}
                        <span className={`absolute top-2.5 left-2.5 px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm ${status.cls}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="p-2.5 md:p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          {a.brand_name && (
                            <span className="text-[10px] text-slate-400 font-bold truncate">{a.brand_name}</span>
                          )}
                          {a.category && (
                            <>
                              <span className="text-slate-200">·</span>
                              <span className="text-[10px] text-slate-400 font-medium truncate">
                                {CATEGORY_LABELS[a.category] || a.category}
                              </span>
                            </>
                          )}
                        </div>
                        <h3 className="font-black text-xs md:text-sm text-slate-900 line-clamp-1 mb-1">
                          {a.campaign_title}
                        </h3>
                        <p className="text-[10px] text-slate-400 font-medium line-clamp-2">{status.note}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
      {toastEl}
    </main>
  );
};

export default CreatorCampaignCollabs;
