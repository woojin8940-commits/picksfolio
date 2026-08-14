import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/apiService';
import { formatKoreanWon } from '../utils/formatters';
import CampaignProcessBoard from './collab/CampaignProcessBoard';
import { useLanguage } from '../contexts/LanguageContext';

interface CreatorCollabWorkspaceProps {
  userName: string;
  hideWhenEmpty?: boolean;
}

/** 지원했지만 아직 협업이 열리지 않은 캠페인의 상태 한 마디. */
const APPLY_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '검토 중', cls: 'bg-amber-50 text-amber-600' },
  accepted: { label: '선정 · 진행 준비 중', cls: 'bg-blue-50 text-blue-600' },
  rejected: { label: '이번엔 미선정', cls: 'bg-slate-100 text-slate-400' },
};

const dueText = (dueDate: string, daysLeft: number | null, isEn: boolean) => {
  if (!dueDate) return isEn ? 'No deadline' : '마감일 미정';
  if (daysLeft === null || daysLeft === undefined) return dueDate;
  if (daysLeft < 0) return isEn ? `${-daysLeft} days overdue` : `${-daysLeft}일 지났어요`;
  if (daysLeft === 0) return isEn ? 'Due today' : '오늘까지';
  return isEn ? `${daysLeft} days left` : `${daysLeft}일 남음`;
};

/**
 * 캠페인 현황 — 인플루언서가 자기 캠페인을 한 화면에서 보는 곳.
 *
 * 예전에는 "진행 중인 협업" 이라는 이름으로, 협업 행이 만들어진 건만 보여 줬다.
 * 지원해 둔 캠페인과 선정된 캠페인은 다른 메뉴에 있어서, 인플루언서 입장에서는
 * "내가 지금 무엇에 걸려 있는지"를 두세 곳을 오가며 맞춰 봐야 했다. 여기서는
 * 지원 → 선정 → 진행을 한 목록으로 잇는다.
 *
 * 진행 중인 캠페인을 펼치면 다섯 단계 보드(CampaignProcessBoard)가 그대로 열린다.
 * 브랜드가 보는 화면과 같은 컴포넌트라, 같은 단계를 서로 다르게 볼 일이 없다.
 */
const CreatorCollabWorkspace: React.FC<CreatorCollabWorkspaceProps> = ({ userName, hideWhenEmpty }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

  const [collabs, setCollabs] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    window.setTimeout(() => setMessage(null), 4000);
  };

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

  const openDetail = async (collabId: string) => {
    if (openId === collabId) {
      setOpenId('');
      setDetail(null);
      return;
    }
    setOpenId(collabId);
    setDetail(null);
    setDetailLoading(true);
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
  // "3단계 진행 중"으로 두 줄 나오면 어느 쪽이 지금인지 알 수 없다.
  const startedCampaignIds = new Set(collabs.map(c => String(c.campaignId || '')).filter(Boolean));
  const waiting = applications.filter(a => !startedCampaignIds.has(String(a.campaign_id)));

  if (hideWhenEmpty && !loading && collabs.length === 0 && waiting.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-[0_4px_16px_-4px_rgba(15,23,42,0.12)]">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-black text-slate-900 text-base">{isEn ? 'Campaign Status' : '캠페인 현황'}</h3>
        <button onClick={load} className="text-[11px] text-slate-400 font-bold hover:text-slate-700">
          {isEn ? 'Refresh' : '새로고침'}
        </button>
      </div>
      <p className="text-[11px] text-slate-400 font-medium mb-4">
        {isEn
          ? 'Applied and in-progress campaigns in one place.'
          : '지원한 캠페인과 진행 중인 캠페인을 한 곳에서 봅니다.'}
      </p>

      {message && (
        <div
          className={`mb-3 rounded-lg px-3 py-2 text-[11px] font-bold ${
            message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 아무것도 없을 때. 메뉴로 직접 들어온 화면이 통째로 비어 있으면 화면이 깨진
          것으로 읽히므로, 무엇을 기다리는 중인지 한 줄로 적어 둔다. */}
      {!loading && collabs.length === 0 && waiting.length === 0 && (
        <div className="border border-dashed border-slate-200 rounded-xl px-4 py-8 text-center">
          <p className="text-xs text-slate-400 font-bold">
            {isEn
              ? 'Nothing yet. Campaigns you apply to show up here.'
              : '아직 캠페인이 없습니다. 캠페인에 지원하면 이곳에서 진행 상황을 확인할 수 있습니다.'}
          </p>
        </div>
      )}

      <div className="space-y-2.5">
        {collabs.map(c => {
          const isOpen = openId === c.id;
          const mineNow = c.currentStageOwner === 'influencer' && ['active', 'revision'].includes(c.currentStageStatus);
          return (
            <div
              key={c.id}
              className={`border rounded-xl overflow-hidden transition-colors ${
                isOpen ? 'border-slate-900' : 'border-slate-100'
              }`}
            >
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-black text-sm text-slate-900 truncate">{c.campaignTitle}</span>
                      {mineNow && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-slate-900 text-white">
                          {isEn ? 'Your Turn' : '내 차례'}
                        </span>
                      )}
                      {c.status === 'completed' && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-50 text-emerald-600">
                          {isEn ? 'Completed' : '완료'}
                        </span>
                      )}
                      {c.status === 'cancelled' && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-red-50 text-red-600">
                          {isEn ? 'Cancelled' : '취소'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-bold truncate">{c.companyName}</p>
                  </div>
                  <button
                    onClick={() => openDetail(c.id)}
                    className={`px-3.5 py-2 rounded-lg text-[11px] font-black flex-shrink-0 transition-colors ${
                      isOpen ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-slate-900 text-white hover:bg-slate-700'
                    }`}
                  >
                    {isOpen ? (isEn ? 'Collapse' : '접기') : (isEn ? 'Open' : '진행하기')}
                  </button>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] text-slate-600 font-bold truncate">
                      {c.currentStageTitle ||
                        (c.status === 'completed' ? (isEn ? 'All done' : '모든 단계 완료') : isEn ? 'Preparing' : '준비 중')}
                    </p>
                    <p className={`text-[11px] font-bold flex-shrink-0 ml-2 ${(c.daysLeft ?? 1) < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {dueText(c.dueDate, c.daysLeft, isEn)}
                    </p>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${c.status === 'cancelled' ? 'bg-red-400' : 'bg-slate-900'}`}
                      style={{ width: `${Math.min(100, Math.max(0, c.progress))}%` }}
                    />
                  </div>
                </div>
              </div>

              {isOpen && (
                <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                  {detailLoading ? (
                    <p className="text-xs text-slate-400 font-bold text-center py-6">{isEn ? 'Loading...' : '불러오는 중...'}</p>
                  ) : !detail ? (
                    <p className="text-xs text-slate-400 font-bold text-center py-6">{isEn ? 'Failed to load.' : '정보를 불러오지 못했습니다.'}</p>
                  ) : (
                    <div className="space-y-3">
                      {/* 조건은 한 줄로. 보수는 진행 중에 계속 확인하는 값이지만,
                          카드로 크게 잡으면 정작 할 일(단계 보드)이 밀려난다. */}
                      {detail.terms && (
                        <div className="flex items-center justify-between gap-3 rounded-xl bg-white border border-slate-200 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-[10px] text-slate-400 font-black">{isEn ? 'Payout' : '보수'}</p>
                            <p className="text-sm text-slate-900 font-black truncate">
                              {detail.terms.fee ? formatKoreanWon(detail.terms.fee) : isEn ? 'In negotiation' : '협의 중'}
                              {detail.terms.fee ? (
                                <span className="text-[11px] text-slate-400 font-bold ml-1.5">
                                  {isEn ? 'net' : '세후'} {formatKoreanWon(detail.terms.netFee)}
                                </span>
                              ) : null}
                            </p>
                          </div>
                          <span className={`text-[10px] font-black flex-shrink-0 ${detail.terms.lockedAt ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {detail.terms.lockedAt ? (isEn ? 'Confirmed' : '조건 확정') : isEn ? 'Awaiting' : '확정 대기'}
                          </span>
                        </div>
                      )}

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
                        <p className="text-[10px] text-slate-400 font-bold">
                          {isEn ? 'Questions on terms or schedule?' : '조건 · 일정 문의는 담당자에게 보내 주세요.'}
                        </p>
                        <button
                          onClick={() => openManagerThread(c.id)}
                          className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[10px] font-black hover:border-slate-900 hover:text-slate-900 transition-colors flex-shrink-0"
                        >
                          {isEn ? 'Chat with Manager' : '담당자와 대화'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* 지원해 두고 결과를 기다리는 캠페인. 진행 중인 것 아래에 붙여 두면
            "무엇이 굴러가고 무엇이 대기인지"가 한눈에 갈린다. */}
        {waiting.map(a => {
          const badge = APPLY_STATUS[String(a.status)] || APPLY_STATUS.pending;
          return (
            <div key={a.id} className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-sm text-slate-900 truncate">{a.campaign_title}</p>
                  <p className="text-xs text-slate-500 font-bold truncate mt-0.5">{a.brand_name}</p>
                </div>
                <span className={`px-2 py-1 rounded-md text-[10px] font-black flex-shrink-0 ${badge.cls}`}>{badge.label}</span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium mt-2">
                {a.status === 'accepted'
                  ? '담당자가 조건을 정리하면 진행 단계가 이곳에 열립니다.'
                  : a.status === 'rejected'
                    ? '다른 캠페인에서 다시 만나요.'
                    : '브랜드와 담당자가 지원 내용을 확인하고 있습니다.'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CreatorCollabWorkspace;
