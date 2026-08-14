import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';
import { digitsOnly, formatKoreanWon, formatNumberWithCommas } from '../../utils/formatters';
import { normalizeScenes, parseAnchor } from '../../utils/collabScenes';
import CollabReviewRoom from '../collab/CollabReviewRoom';
import AdminCampaignListup from './AdminCampaignListup';

/**
 * 담당자 협업 콘솔.
 *
 * 이 화면은 협업 목록이 아니라 **지금 담당자가 막고 있는 일**에서 시작한다. 브랜드와
 * 인플루언서 사이에 사람을 두면 그 사람이 답을 미루는 순간 양쪽이 함께 멈추기 때문에,
 * 첫 화면에 "선정 대기 · 검수 대기 · 마감 경과 · 답 없는 채널"만 올려 둔다.
 *
 * 여기서 하는 일:
 *   * 지원자 선정 / 거절 (선정하면 협업 본체와 단계, 양쪽 채널이 만들어진다)
 *   * 조건 확정(금액·마감일) — 확정하면 단계 마감일로 내려간다
 *   * 제출물 검수: 승인 또는 수정 요청
 *   * 브랜드 의견을 다듬어 인플루언서에게 전달
 *   * 일정 변경(협업당 1회) · 취소
 */

interface AdminCollabManagerConsoleProps {
  token: string;
}

type QueueData = {
  manager?: string;
  today?: string;
  unassignedCampaigns?: any[];
  pendingApplications?: any[];
  awaitingReview?: any[];
  overdueStages?: any[];
  unansweredThreads?: any[];
  counts?: Record<string, number>;
  error?: string;
};

const STAGE_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: '대기', cls: 'bg-slate-100 text-slate-400' },
  active: { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  submitted: { label: '검수 대기', cls: 'bg-amber-50 text-amber-600' },
  revision: { label: '수정중', cls: 'bg-orange-50 text-orange-600' },
  done: { label: '완료', cls: 'bg-emerald-50 text-emerald-600' },
  skipped: { label: '생략', cls: 'bg-slate-100 text-slate-400' },
};

const OWNER_LABEL: Record<string, string> = { influencer: '인플루언서', manager: '담당자', brand: '브랜드' };

const FEEDBACK_STATUS_LABEL: Record<string, string> = {
  open: '미처리',
  relayed: '전달됨',
  applied: '반영 완료',
  wont_apply: '미반영',
  resolved: '종료',
};

const DELIVERABLE_STATUS_LABEL: Record<string, string> = {
  submitted: '검수 대기',
  revision: '수정 요청',
  approved: '승인',
};

// Tailwind 는 클래스 문자열을 빌드 시점에 훑기 때문에 `bg-${tone}-50` 같은 조립은 사라진다.
const TONE_BADGE: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-500',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
};

const Card: React.FC<{ title: string; count?: number; children: React.ReactNode; tone?: string }> = ({
  title,
  count,
  children,
  tone = 'slate',
}) => (
  <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
    <div className="flex items-center gap-2 mb-3">
      <h3 className="text-sm font-black text-slate-900">{title}</h3>
      {count !== undefined && (
        <span
          className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
            count > 0 ? TONE_BADGE[tone] || TONE_BADGE.slate : 'bg-slate-100 text-slate-400'
          }`}
        >
          {count}
        </span>
      )}
    </div>
    {children}
  </div>
);

const AdminCollabManagerConsole: React.FC<AdminCollabManagerConsoleProps> = ({ token }) => {
  const [view, setView] = useState<'queue' | 'collabs' | 'listup'>('queue');
  const [mineOnly, setMineOnly] = useState(false);
  const [queue, setQueue] = useState<QueueData>({});
  const [queueLoading, setQueueLoading] = useState(true);
  const [collabs, setCollabs] = useState<any[]>([]);
  const [collabsLoading, setCollabsLoading] = useState(false);
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // 담당자 채널 — 운영 콘솔 안에서 바로 답장한다
  const [threadId, setThreadId] = useState('');
  const [thread, setThread] = useState<any>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadDraft, setThreadDraft] = useState('');

  /**
   * 지원자마다 적는 추천 이유 초안.
   *
   * 저장 전까지는 화면 안에만 둔다. 큐를 새로고침해도 적던 글이 날아가지 않게
   * 초안이 있는 항목만 이 표에 담고, 없는 항목은 서버 값(managerNote)을 그대로 쓴다.
   */
  const [applicantNoteDraft, setApplicantNoteDraft] = useState<Record<string, string>>({});
  const [applicantNoteSaving, setApplicantNoteSaving] = useState('');

  // 조건 편집 폼
  const [terms, setTerms] = useState({ fee: '', scriptDue: '', contentDue: '', uploadDue: '', guideUrl: '', guideNote: '' });
  const [reviewNote, setReviewNote] = useState('');
  const [relayText, setRelayText] = useState<Record<string, string>>({});
  const [scheduleForm, setScheduleForm] = useState({ stageKey: '', nextDue: '', reason: '' });
  // 협업 내역 일정 체크 — 담당자가 확인한 협업 기간. 확정된 업로드 마감일을 기본값
  // 으로 채워 두고, 실제 촬영·게시 기간으로 담당자가 손보게 한다.
  const [collabSchedule, setCollabSchedule] = useState({ startDate: '', endDate: '', memo: '' });
  // 장면·시점에 붙여 검수하는 화면. 목록에서 훑는 것과 한 장면씩 짚는 것은 다른 일이라 따로 띄운다.
  const [reviewTarget, setReviewTarget] = useState<'' | 'script' | 'content'>('');

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    window.setTimeout(() => setMessage(null), 4500);
  };

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    const res = await apiService.getManagerQueue(token, mineOnly);
    setQueue(res || {});
    setQueueLoading(false);
  }, [token, mineOnly]);

  const loadCollabs = useCallback(async () => {
    setCollabsLoading(true);
    const res = await apiService.getCollabs('manager', { token, mine: mineOnly });
    setCollabs(res.collabs || []);
    setCollabsLoading(false);
  }, [token, mineOnly]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (view === 'collabs') loadCollabs();
  }, [view, loadCollabs]);

  const refreshDetail = async (collabId: string) => {
    const res = await apiService.getCollabDetail(collabId, token);
    if (res.error) {
      notify(res.error, 'error');
      return null;
    }
    setDetail(res);
    setTerms({
      fee: res.terms?.fee ? formatNumberWithCommas(res.terms.fee) : '',
      scriptDue: res.terms?.scriptDue || '',
      contentDue: res.terms?.contentDue || '',
      uploadDue: res.terms?.uploadDue || '',
      guideUrl: res.terms?.guideUrl || '',
      guideNote: res.terms?.guideNote || '',
    });
    setCollabSchedule({
      startDate: res.collab?.scheduleStart || '',
      endDate: res.collab?.scheduleEnd || res.terms?.uploadDue || res.terms?.contentDue || '',
      memo: '',
    });
    return res;
  };

  const openCollab = async (collabId: string) => {
    setView('collabs');
    if (openId === collabId) {
      setOpenId('');
      setDetail(null);
      setReviewTarget('');
      return;
    }
    setOpenId(collabId);
    setDetail(null);
    setReviewTarget('');
    setDetailLoading(true);
    await refreshDetail(collabId);
    setDetailLoading(false);
  };

  const openThread = async (proposalId: string) => {
    setThreadId(proposalId);
    setThread(null);
    setThreadDraft('');
    setThreadLoading(true);
    const res = await apiService.getTimelineThread(proposalId, token);
    setThreadLoading(false);
    if (res.error) {
      notify(res.error, 'error');
      setThreadId('');
      return;
    }
    setThread(res.timeline || null);
  };

  const sendThreadMessage = async () => {
    const text = threadDraft.trim();
    if (!text || !threadId) return;
    setBusy(true);
    const res = await apiService.postTimelineComment(threadId, text, token);
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setThreadDraft('');
    setThread((prev: any) =>
      prev ? { ...prev, comments: [...(prev.comments || []), res.comment] } : prev,
    );
    await loadQueue();
  };

  const act = async (collabId: string, action: string, payload: Record<string, any> = {}) => {
    setBusy(true);
    const res = await apiService.collabAction(collabId, action, payload, token);
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return null;
    }
    await refreshDetail(collabId);
    await loadQueue();
    if (view === 'collabs') loadCollabs();
    return res;
  };

  // ---------------------------------------------------------------- 선정
  const decide = async (applicationId: string, status: 'accepted' | 'rejected') => {
    setBusy(true);
    const res = await apiService.decideApplicant(applicationId, status, { token });
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    if (status === 'accepted') {
      notify('선정했습니다. 협업 단계와 양쪽 담당자 채널이 만들어졌습니다.');
      if (res.collabId) openCollab(res.collabId);
    } else {
      notify('거절 처리했습니다.');
    }
    await loadQueue();
  };

  /**
   * 추천 이유 저장.
   *
   * 선정과 분리된 저장이다. 브랜드가 직접 수락하는 캠페인(제품 협찬형·공동구매)에서
   * 담당자는 '선정'을 누르지 않으므로, 선정할 때만 적을 수 있게 두면 정작 브랜드가
   * 고르는 화면에 이유가 비어 있게 된다.
   */
  const saveApplicantNote = async (applicationId: string, note: string) => {
    setApplicantNoteSaving(applicationId);
    const res = await apiService.setApplicantManagerNote(applicationId, note, token);
    setApplicantNoteSaving('');
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    // 저장한 값이 곧 서버 값이므로 초안은 지운다. 남겨 두면 다른 담당자가 고친
    // 내용이 내려와도 화면에는 내 초안이 계속 덮여 보인다.
    setApplicantNoteDraft(prev => {
      const next = { ...prev };
      delete next[applicationId];
      return next;
    });
    notify('추천 이유를 저장했습니다. 브랜드 지원자 카드에 바로 보입니다.');
    await loadQueue();
  };

  const assignCampaignManager = async (campaignId: string) => {
    setBusy(true);
    const res = await apiService.adminCampaignAction(token, campaignId, 'assign_manager');
    setBusy(false);
    if (!res.success) {
      notify(res.error || '배정에 실패했습니다.', 'error');
      return;
    }
    notify('내 담당으로 배정했습니다.');
    await loadQueue();
  };

  const counts = queue.counts || {};

  return (
    <div className="space-y-4">
      {/* 상단 요약 + 보기 전환 */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={() => setView('queue')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-colors ${
              view === 'queue' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            대기 큐
          </button>
          <button
            onClick={() => setView('collabs')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-colors ${
              view === 'collabs' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            협업 목록
          </button>
          {/* 리스트업은 협업이 생기기 전 단계다. 대기 큐/협업 목록과 같은 줄에 두어야
              담당자가 "아직 아무것도 없는 캠페인"을 여기서 시작한다는 걸 안다. */}
          <button
            onClick={() => setView('listup')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-colors ${
              view === 'listup' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            리스트업
          </button>
          <label className="flex items-center gap-1.5 ml-2 cursor-pointer">
            <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} className="accent-slate-900" />
            <span className="text-[11px] font-bold text-slate-500">내 담당만</span>
          </label>
          {/* 리스트업 화면은 자체 새로고침을 갖고 있어서 여기 버튼을 걸지 않는다. */}
          {view !== 'listup' && (
            <button
              onClick={() => (view === 'queue' ? loadQueue() : loadCollabs())}
              className="ml-auto text-[11px] text-slate-400 font-bold hover:text-slate-700"
            >
              새로고침
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { label: '진행중 협업', value: counts.in_progress ?? 0 },
            { label: '담당자 없음', value: counts.unmanaged ?? 0, warn: true },
            { label: '검수 대기', value: (queue.awaitingReview || []).length, warn: true },
            { label: '마감 경과', value: (queue.overdueStages || []).length, warn: true },
            { label: '미전달 의견', value: counts.brand_feedback_open ?? 0, warn: true },
          ].map(s => (
            <div key={s.label} className="bg-slate-50 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-slate-400 font-bold">{s.label}</p>
              <p className={`text-lg font-black ${s.warn && s.value > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {queue.manager && (
          <p className="text-[10px] text-slate-400 font-bold mt-3">담당자 계정: @{queue.manager}</p>
        )}
      </div>

      {message && (
        <div
          className={`rounded-xl px-4 py-2.5 text-xs font-bold ${
            message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 담당자 채널 대화 — 운영 콘솔은 서비스 화면의 대화 UI 로 넘어갈 수 없어서
          같은 대화 API 를 여기서 직접 읽고 쓴다. */}
      {threadId && (
        <div className="bg-white rounded-2xl border border-blue-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 bg-blue-50/60 border-b border-blue-100">
            <div className="min-w-0">
              <p className="text-xs font-black text-slate-900 truncate">
                {threadId.startsWith('support_inf_') ? '인플루언서 채널' : threadId.startsWith('support_biz_') ? '브랜드 채널' : '대화'}
                {thread?.influencerUsername && threadId.startsWith('support_inf_') && ` · @${thread.influencerUsername}`}
                {thread?.companyName && threadId.startsWith('support_biz_') && ` · ${thread.companyName}`}
              </p>
              <p className="text-[10px] text-slate-400 font-bold truncate">{threadId}</p>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <button
                onClick={() => openThread(threadId)}
                className="text-[10px] text-slate-400 font-bold hover:text-slate-700"
              >
                새로고침
              </button>
              <button
                onClick={() => {
                  setThreadId('');
                  setThread(null);
                }}
                className="text-[10px] text-slate-400 font-bold hover:text-slate-700"
              >
                닫기
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-4 space-y-2 bg-slate-50/40">
            {threadLoading ? (
              <p className="text-xs text-slate-400 font-bold text-center py-6">대화를 불러오는 중...</p>
            ) : (thread?.comments || []).length === 0 ? (
              <p className="text-xs text-slate-400 font-bold text-center py-6">아직 대화가 없습니다. 먼저 말을 걸어 보세요.</p>
            ) : (
              thread.comments.map((c: any) => {
                const mine = c.authorType === 'manager';
                return (
                  <div key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 ${mine ? 'bg-blue-600 text-white' : 'bg-white border border-slate-100 text-slate-700'}`}>
                      <p className={`text-[10px] font-black mb-0.5 ${mine ? 'text-blue-100' : 'text-slate-400'}`}>
                        {c.authorName || (c.authorType === 'business' ? '브랜드' : c.authorType === 'influencer' ? '인플루언서' : '담당자')}
                        {c.createdAt && ` · ${new Date(c.createdAt).toLocaleString('ko-KR')}`}
                      </p>
                      <p className="text-xs font-medium whitespace-pre-wrap break-words">{c.content}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-3 border-t border-slate-100 flex gap-2">
            <textarea
              value={threadDraft}
              onChange={e => setThreadDraft(e.target.value)}
              rows={2}
              placeholder="담당자 이름으로 전송됩니다"
              className="flex-1 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
            />
            <button
              onClick={sendThreadMessage}
              disabled={busy || !threadDraft.trim()}
              className="px-4 bg-slate-900 text-white rounded-lg text-[11px] font-black hover:bg-slate-700 disabled:opacity-40 flex-shrink-0"
            >
              보내기
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ 리스트업 */}
      {view === 'listup' && <AdminCampaignListup token={token} />}

      {/* ------------------------------------------------------ 대기 큐 */}
      {view === 'queue' && (
        queueLoading ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center shadow-sm">
            <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400 font-bold">대기 큐를 불러오는 중...</p>
          </div>
        ) : queue.error ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center shadow-sm">
            <p className="text-sm text-red-500 font-bold">{queue.error}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 담당자 없는 캠페인 */}
            <Card title="담당자 없는 캠페인" count={(queue.unassignedCampaigns || []).length} tone="amber">
              {(queue.unassignedCampaigns || []).length === 0 ? (
                <p className="text-xs text-slate-400 font-medium">모든 캠페인에 담당자가 있습니다.</p>
              ) : (
                <div className="space-y-2">
                  {queue.unassignedCampaigns!.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-900 truncate">{c.title}</p>
                        <p className="text-[10px] text-slate-400 font-bold">
                          {c.brandName} · 지원 {c.applicationCount}명 · 마감 {c.endDate || '-'}
                        </p>
                      </div>
                      <button
                        onClick={() => assignCampaignManager(c.id)}
                        disabled={busy}
                        className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 disabled:opacity-40 flex-shrink-0"
                      >
                        내 담당으로
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 선정 대기 지원자 */}
            <Card title="선정 대기 지원자" count={(queue.pendingApplications || []).length} tone="blue">
              {(queue.pendingApplications || []).length === 0 ? (
                <p className="text-xs text-slate-400 font-medium">선정을 기다리는 지원자가 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {queue.pendingApplications!.map(a => (
                    <div key={a.id} className="border border-slate-100 rounded-xl px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black text-slate-900">@{a.applicantUsername}</span>
                            {a.brandPreference === 'shortlist' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-blue-600 text-white">브랜드 추천</span>
                            )}
                            {a.brandPreference === 'pass' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-200 text-slate-500">브랜드 보류</span>
                            )}
                            {!a.managerUsername && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-50 text-amber-600">담당자 미배정</span>
                            )}
                            {/* 제품 협찬형·공동구매는 브랜드가 직접 수락한다. 담당자가
                                대신 눌러 버리면 브랜드가 고르는 중인 사람을 앞질러
                                결정하게 되므로, 누구를 기다리는 줄인지 표시해 둔다. */}
                            {a.selectionBy === 'brand' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-violet-50 text-violet-600">브랜드 수락 대기</span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 font-bold truncate mt-0.5">
                            {a.campaignTitle} · {a.brandName}
                          </p>
                          {a.message && (
                            <p className="text-[11px] text-slate-500 font-medium mt-1 whitespace-pre-wrap line-clamp-3">{a.message}</p>
                          )}
                          {a.brandPreferenceNote && (
                            <p className="text-[11px] text-blue-600 font-medium mt-1">브랜드 메모: {a.brandPreferenceNote}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {a.contact && <span className="text-[10px] text-slate-400 font-bold">{a.contact}</span>}
                            {a.portfolioUrl && (
                              <a
                                href={a.portfolioUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-blue-500 font-bold hover:underline"
                              >
                                포트폴리오
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                          {/* 브랜드가 고르는 캠페인에서는 '선정'을 흐리게 둔다 — 대신
                              눌러야 하는 경우(브랜드 요청·연락 두절)가 있으니 막지는 않는다. */}
                          <button
                            onClick={() => decide(a.id, 'accepted')}
                            disabled={busy}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-40 ${
                              a.selectionBy === 'brand'
                                ? 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                : 'bg-blue-600 text-white hover:bg-blue-500'
                            }`}
                          >
                            {a.selectionBy === 'brand' ? '대신 선정' : '선정'}
                          </button>
                          <button
                            onClick={() => decide(a.id, 'rejected')}
                            disabled={busy}
                            className="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
                          >
                            거절
                          </button>
                        </div>
                      </div>

                      {/* 추천 이유. 브랜드의 지원자 카드에 그대로 보이는 줄이라
                          '메모'가 아니라고 적어 둔다 — 담당자만 보는 줄로 착각하면
                          브랜드에게 그대로 나가면 곤란한 말이 실린다. */}
                      {(() => {
                        const draft = applicantNoteDraft[a.id];
                        const value = draft !== undefined ? draft : a.managerNote || '';
                        const dirty = draft !== undefined && draft !== (a.managerNote || '');
                        return (
                          <div className="mt-2 pt-2 border-t border-slate-100">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className="text-[10px] text-slate-400 font-black">
                                추천 이유 <span className="text-slate-300 font-bold">· 브랜드에게 그대로 보입니다</span>
                              </p>
                              <button
                                onClick={() => saveApplicantNote(a.id, value)}
                                disabled={applicantNoteSaving === a.id || !dirty}
                                className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-30 flex-shrink-0"
                              >
                                {applicantNoteSaving === a.id
                                  ? '저장 중...'
                                  : !dirty && a.managerNote
                                    ? '저장됨'
                                    : '저장'}
                              </button>
                            </div>
                            <textarea
                              value={value}
                              onChange={e =>
                                setApplicantNoteDraft(prev => ({ ...prev, [a.id]: e.target.value }))
                              }
                              rows={2}
                              placeholder="예: 클렌징 이후 마무리된 피부 표현이 가능한 순한 성분 제품 소구에 어울리는 인플루언서입니다."
                              className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-700 focus:outline-none focus:border-slate-400 resize-none"
                            />
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 검수 대기 */}
            <Card title="검수 대기 제출물" count={(queue.awaitingReview || []).length} tone="amber">
              {(queue.awaitingReview || []).length === 0 ? (
                <p className="text-xs text-slate-400 font-medium">검수를 기다리는 제출물이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {queue.awaitingReview!.map(s => (
                    <div
                      key={`${s.collabId}_${s.stageKey}`}
                      className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-900 truncate">
                          {s.stageTitle} · @{s.creatorUsername}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold truncate">
                          {s.campaignTitle} · 제출 {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString('ko-KR') : '-'}
                        </p>
                      </div>
                      <button
                        onClick={() => openCollab(s.collabId)}
                        className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 flex-shrink-0"
                      >
                        검수하기
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 마감 경과 */}
            <Card title="마감 경과 단계" count={(queue.overdueStages || []).length} tone="red">
              {(queue.overdueStages || []).length === 0 ? (
                <p className="text-xs text-slate-400 font-medium">마감이 지난 단계가 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {queue.overdueStages!.map(s => (
                    <div
                      key={`${s.collabId}_${s.stageKey}`}
                      className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-900 truncate">
                          {s.stageTitle} · @{s.creatorUsername}
                        </p>
                        <p className="text-[10px] text-red-500 font-bold">
                          마감 {s.dueDate} · {s.daysLate}일 경과 · {OWNER_LABEL[s.ownerRole] || s.ownerRole} 차례
                        </p>
                      </div>
                      <button
                        onClick={() => openCollab(s.collabId)}
                        className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 flex-shrink-0"
                      >
                        열기
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 답 없는 채널 */}
            <Card title="내 답을 기다리는 채널" count={(queue.unansweredThreads || []).length} tone="amber">
              {(queue.unansweredThreads || []).length === 0 ? (
                <p className="text-xs text-slate-400 font-medium">모든 채널에 담당자 답변이 마지막입니다.</p>
              ) : (
                <div className="space-y-2">
                  {queue.unansweredThreads!.map(t => (
                    <div key={t.proposalId} className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-900 truncate">
                          {t.kind === 'influencer_support' ? '인플루언서' : '브랜드'} @{t.counterpart}
                        </p>
                        <p className="text-[10px] text-slate-400 font-medium truncate">{t.preview}</p>
                        <p className="text-[10px] text-slate-300 font-bold">
                          {t.lastMessageAt ? new Date(t.lastMessageAt).toLocaleString('ko-KR') : ''}
                        </p>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => openThread(t.proposalId)}
                          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700"
                        >
                          답장
                        </button>
                        {t.collabId && (
                          <button
                            onClick={() => openCollab(t.collabId)}
                            className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200"
                          >
                            협업
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )
      )}

      {/* ------------------------------------------------------ 협업 목록 */}
      {view === 'collabs' && (
        <div className="space-y-3">
          {collabsLoading && collabs.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center shadow-sm">
              <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-slate-400 font-bold">협업을 불러오는 중...</p>
            </div>
          ) : collabs.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center shadow-sm">
              <p className="text-sm text-slate-400 font-bold">협업이 없습니다.</p>
            </div>
          ) : (
            collabs.map(c => {
              const isOpen = openId === c.id;
              return (
                <div key={c.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-sm font-black text-slate-900 truncate">{c.campaignTitle}</span>
                          <span className="text-[10px] text-slate-400 font-bold">
                            @{c.creatorUsername} ↔ {c.companyName || c.businessUsername}
                          </span>
                          {!c.managerUsername && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-50 text-amber-600">담당자 미배정</span>
                          )}
                          {c.status === 'completed' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-50 text-emerald-600">완료</span>
                          )}
                          {c.status === 'cancelled' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-red-50 text-red-600">취소</span>
                          )}
                          {/* 일정 체크가 끝나지 않은 협업은 당사자 캘린더에 아직
                              안 보인다 — 목록에서 바로 눈에 띄어야 한다. */}
                          {c.status !== 'cancelled' && !c.scheduleConfirmedAt && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-50 text-amber-600">일정 미체크</span>
                          )}
                          {c.scheduleConfirmedAt && c.scheduleStart && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-teal-50 text-teal-600">
                              일정 {c.scheduleStart}
                              {c.scheduleEnd ? `~${c.scheduleEnd}` : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 font-bold">
                          {c.currentStageTitle || '-'}
                          {c.currentStageOwner && ` · ${OWNER_LABEL[c.currentStageOwner] || c.currentStageOwner} 차례`}
                          {c.dueDate && ` · 마감 ${c.dueDate}`}
                          {typeof c.daysLeft === 'number' && c.daysLeft < 0 && (
                            <span className="text-red-500"> ({-c.daysLeft}일 경과)</span>
                          )}
                        </p>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => openThread(`support_inf_${c.id}`)}
                          className="px-2.5 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200"
                        >
                          인플루언서 채널
                        </button>
                        {/* 브랜드 채널 버튼은 없앴다. 브랜드↔담당자 방을 더 이상 만들지
                            않기 때문이다 — 브랜드의 요청은 진행사항의 단계별 피드백으로
                            들어오고, 담당자는 '관리'에서 그것을 본다. 예전에 만들어진
                            방은 담당자 대화 목록에 그대로 남아 있다. */}
                        <button
                          onClick={() => openCollab(c.id)}
                          className="px-2.5 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700"
                        >
                          {isOpen ? '접기' : '관리'}
                        </button>
                      </div>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-3">
                      <div
                        className={`h-full rounded-full ${c.status === 'cancelled' ? 'bg-red-400' : 'bg-blue-600'}`}
                        style={{ width: `${Math.min(100, Math.max(0, c.progress))}%` }}
                      />
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                      {detailLoading ? (
                        <p className="text-xs text-slate-400 font-bold text-center py-6">불러오는 중...</p>
                      ) : !detail ? (
                        <p className="text-xs text-slate-400 font-bold text-center py-6">정보를 불러오지 못했습니다.</p>
                      ) : (
                        <div className="space-y-5">
                          {/* 조건 확정 */}
                          <div className="bg-white rounded-xl border border-slate-100 p-4">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-[9px] text-slate-400 font-black uppercase">협업 조건</p>
                              <span className={`text-[10px] font-black ${detail.terms?.lockedAt ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {detail.terms?.lockedAt ? '확정됨' : '미확정'}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              <label className="block">
                                <span className="text-[10px] text-slate-400 font-bold">
                                  {detail.collab?.campaignType === 'group_buy' ? '판매 수수료 정산액 (원)' : '보수 (원)'}
                                </span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={terms.fee}
                                  onChange={e => setTerms(p => ({ ...p, fee: formatNumberWithCommas(e.target.value) }))}
                                  className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] text-slate-400 font-bold">구성안 마감</span>
                                <input
                                  type="date"
                                  value={terms.scriptDue}
                                  onChange={e => setTerms(p => ({ ...p, scriptDue: e.target.value }))}
                                  className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] text-slate-400 font-bold">콘텐츠 마감</span>
                                <input
                                  type="date"
                                  value={terms.contentDue}
                                  onChange={e => setTerms(p => ({ ...p, contentDue: e.target.value }))}
                                  className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] text-slate-400 font-bold">업로드 마감</span>
                                <input
                                  type="date"
                                  value={terms.uploadDue}
                                  onChange={e => setTerms(p => ({ ...p, uploadDue: e.target.value }))}
                                  className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                                />
                              </label>
                              <label className="block md:col-span-2">
                                <span className="text-[10px] text-slate-400 font-bold">가이드 링크</span>
                                <input
                                  type="url"
                                  value={terms.guideUrl}
                                  onChange={e => setTerms(p => ({ ...p, guideUrl: e.target.value }))}
                                  className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                                />
                              </label>
                            </div>
                            <textarea
                              value={terms.guideNote}
                              onChange={e => setTerms(p => ({ ...p, guideNote: e.target.value }))}
                              rows={2}
                              placeholder="가이드 요약 · 필수 표기 사항"
                              className="w-full mt-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:border-blue-400"
                            />
                            {/* 브랜드가 캠페인에 올려 둔 가이드라인 파일. 담당자가 요약을
                                쓰기 전에 원본을 열어 봐야 하는데, 예전에는 캠페인 화면으로
                                따로 나가야 보였다. 여기서는 읽기만 한다 — 브랜드가 올린
                                파일을 담당자가 바꾸면 브랜드가 무엇이 전달됐는지 모른다. */}
                            {Array.isArray(detail.guideline?.files) && detail.guideline.files.length > 0 && (
                              <div className="mt-2 space-y-1">
                                <p className="text-[10px] text-slate-400 font-bold">브랜드가 올린 가이드라인</p>
                                {detail.guideline.files.map((f: any) => (
                                  <a
                                    key={f.url}
                                    href={f.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 hover:border-blue-200 hover:bg-blue-50/40 transition-colors"
                                  >
                                    <span className="min-w-0 flex-1 text-[11px] font-bold text-slate-700 truncate">{f.name}</span>
                                    <span className="text-[10px] font-black text-blue-600 flex-shrink-0">열기</span>
                                  </a>
                                ))}
                              </div>
                            )}
                            {detail.terms?.fee > 0 ? (
                              <p className="text-[10px] text-slate-400 font-bold mt-2">
                                세후 지급 예상 {formatKoreanWon(detail.terms.netFee)} (원천징수 3.3%)
                              </p>
                            ) : (
                              /* 금액을 넣기 전까지 인플루언서·브랜드 정산 화면에는
                                 "협의중"으로만 표시된다. 특히 공동구매는 등록 때 금액이
                                 정해지지 않아, 이 칸이 곧 정산 예정 금액이다. */
                              <p className="text-[10px] text-amber-600 font-bold mt-2">
                                금액을 저장하면 인플루언서 정산 예정 금액에 바로 표시됩니다. 저장 전에는 양쪽 모두 "협의중"으로 보입니다.
                              </p>
                            )}
                            <div className="flex justify-end gap-1.5 mt-2">
                              <button
                                onClick={() =>
                                  act(c.id, 'update_terms', {
                                    terms: {
                                      fee: Number(digitsOnly(terms.fee) || 0),
                                      scriptDue: terms.scriptDue,
                                      contentDue: terms.contentDue,
                                      uploadDue: terms.uploadDue,
                                      guideUrl: terms.guideUrl,
                                      guideNote: terms.guideNote,
                                    },
                                    force: !!detail.terms?.lockedAt,
                                  }).then(r => r && notify('조건을 저장했습니다.'))
                                }
                                disabled={busy}
                                className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
                              >
                                저장
                              </button>
                              <button
                                onClick={() =>
                                  act(c.id, 'update_terms', {
                                    terms: {
                                      fee: Number(digitsOnly(terms.fee) || 0),
                                      scriptDue: terms.scriptDue,
                                      contentDue: terms.contentDue,
                                      uploadDue: terms.uploadDue,
                                      guideUrl: terms.guideUrl,
                                      guideNote: terms.guideNote,
                                    },
                                    lock: true,
                                    force: !!detail.terms?.lockedAt,
                                  }).then(r => r && notify('조건을 확정했습니다. 양쪽에 알림이 발송됩니다.'))
                                }
                                disabled={busy}
                                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 disabled:opacity-40"
                              >
                                확정하고 알리기
                              </button>
                            </div>
                          </div>

                          {/* 협업 내역 일정 체크 — 성사된 협업을 당사자 캘린더에 올린다.
                              업로드 확인 뒤 생기는 정산 항목을 기다리면, 확정부터
                              업로드까지 몇 주 동안 인플루언서 캘린더가 비어 있다. */}
                          <div className="bg-white rounded-xl border border-slate-100 p-4">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-[9px] text-slate-400 font-black uppercase">협업 내역 일정</p>
                              <span className={`text-[10px] font-black ${detail.collab?.scheduleConfirmedAt ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {detail.collab?.scheduleConfirmedAt ? '체크됨' : '미체크'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold mb-3">
                              {detail.collab?.scheduleConfirmedAt
                                ? `${detail.collab.scheduleStart || '미정'}${detail.collab.scheduleEnd ? ` ~ ${detail.collab.scheduleEnd}` : ''} · ${detail.collab.scheduleConfirmedBy || '담당자'} 확인`
                                : '체크하면 인플루언서의 협업 현황(협업 내역 · 캘린더)에 일정으로 올라갑니다.'}
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="block">
                                <span className="text-[10px] text-slate-400 font-bold">협업 시작일</span>
                                <input
                                  type="date"
                                  value={collabSchedule.startDate}
                                  onChange={e => setCollabSchedule(p => ({ ...p, startDate: e.target.value }))}
                                  className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] text-slate-400 font-bold">협업 종료일</span>
                                <input
                                  type="date"
                                  value={collabSchedule.endDate}
                                  onChange={e => setCollabSchedule(p => ({ ...p, endDate: e.target.value }))}
                                  className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                                />
                              </label>
                            </div>
                            <input
                              type="text"
                              value={collabSchedule.memo}
                              onChange={e => setCollabSchedule(p => ({ ...p, memo: e.target.value }))}
                              placeholder="협업 내역에 남길 메모 (선택)"
                              className="w-full mt-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                            />
                            <div className="flex justify-end mt-2">
                              <button
                                onClick={() =>
                                  act(c.id, 'confirm_schedule', {
                                    startDate: collabSchedule.startDate,
                                    endDate: collabSchedule.endDate,
                                    ...(collabSchedule.memo.trim() ? { memo: collabSchedule.memo.trim() } : {}),
                                  }).then(r =>
                                    r &&
                                    notify(
                                      detail.collab?.scheduleConfirmedAt
                                        ? '협업 내역 일정을 갱신했습니다.'
                                        : '협업 내역에 일정을 올렸습니다.',
                                    ),
                                  )
                                }
                                disabled={busy || !collabSchedule.startDate}
                                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-500 disabled:opacity-40"
                              >
                                {detail.collab?.scheduleConfirmedAt ? '일정 다시 체크' : '일정 체크하고 협업 내역에 올리기'}
                              </button>
                            </div>
                          </div>

                          {/* 단계 · 검수 */}
                          <div>
                            <p className="text-[9px] text-slate-400 font-black uppercase mb-2">단계 검수</p>
                            <div className="space-y-1.5">
                              {(detail.stages || []).map((s: any) => {
                                const sb = STAGE_STATUS_LABEL[s.status] || { label: s.status, cls: 'bg-slate-100 text-slate-500' };
                                const canApprove = ['active', 'submitted', 'revision'].includes(s.status);
                                return (
                                  <div key={s.id} className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-[10px] text-slate-300 font-black w-4">{s.seq}</span>
                                        <span className="text-xs text-slate-800 font-bold truncate">{s.title}</span>
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${sb.cls}`}>{sb.label}</span>
                                        <span className="text-[9px] text-slate-400 font-bold">
                                          {OWNER_LABEL[s.ownerRole] || s.ownerRole}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <span
                                          className={`text-[10px] font-bold ${
                                            (s.daysLeft ?? 1) < 0 && s.status !== 'done' ? 'text-red-500' : 'text-slate-400'
                                          }`}
                                        >
                                          {s.dueDate || '-'}
                                        </span>
                                        {canApprove && (
                                          <>
                                            <button
                                              onClick={() =>
                                                act(c.id, 'approve_stage', { stageKey: s.stageKey, note: reviewNote }).then(r => {
                                                  if (!r) return;
                                                  setReviewNote('');
                                                  notify(
                                                    r.settlement
                                                      ? `승인 완료. 정산 ${r.settlement.scheduledDate} 예약 (세후 ${formatKoreanWon(r.settlement.net)})`
                                                      : '단계를 완료했습니다.',
                                                  );
                                                })
                                              }
                                              disabled={busy}
                                              className="px-2 py-1 bg-emerald-600 text-white rounded text-[9px] font-black hover:bg-emerald-500 disabled:opacity-40"
                                            >
                                              승인
                                            </button>
                                            {s.status === 'submitted' && (
                                              <button
                                                onClick={() =>
                                                  act(c.id, 'request_revision', { stageKey: s.stageKey, note: reviewNote }).then(
                                                    r => r && notify('수정 요청을 보냈습니다.'),
                                                  )
                                                }
                                                disabled={busy}
                                                className="px-2 py-1 bg-orange-500 text-white rounded text-[9px] font-black hover:bg-orange-400 disabled:opacity-40"
                                              >
                                                수정요청
                                              </button>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <input
                              type="text"
                              value={reviewNote}
                              onChange={e => setReviewNote(e.target.value)}
                              placeholder="검수 메모 (승인 · 수정요청에 함께 기록됩니다)"
                              className="w-full mt-2 text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                            />
                          </div>

                          {/* 제출물 */}
                          {(detail.deliverables || []).length > 0 && (
                            <div>
                              <p className="text-[9px] text-slate-400 font-black uppercase mb-2">제출물</p>
                              <div className="space-y-2">
                                {detail.deliverables.map((d: any) => {
                                  const scenes = normalizeScenes(d.payload?.scenes);
                                  return (
                                  <div key={d.id} className="bg-white rounded-lg border border-slate-100 p-3">
                                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                      <span className="text-xs text-slate-800 font-black">
                                        {(detail.stages || []).find((s: any) => s.stageKey === d.stageKey)?.title || d.stageKey}
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-bold">v{d.version}</span>
                                      <span className="text-[10px] text-slate-400 font-bold">
                                        {DELIVERABLE_STATUS_LABEL[d.status] || d.status}
                                      </span>
                                      {(d.kind === 'script' || d.kind === 'content') && (
                                        <button
                                          onClick={() => setReviewTarget(d.kind)}
                                          className="ml-auto px-2.5 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700"
                                        >
                                          {d.kind === 'script' ? '대본 검수' : '영상 검수'}
                                        </button>
                                      )}
                                    </div>
                                    {scenes.length > 0 && (
                                      <div className="space-y-1.5">
                                        {scenes.map((scene, i) => (
                                          <div key={i} className="border-l-2 border-slate-100 pl-2.5">
                                            <p className="text-[10px] text-slate-400 font-black"># {i + 1}</p>
                                            <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">{scene.visual}</p>
                                            {scene.subtitle && (
                                              <p className="text-[11px] text-slate-500 font-medium">자막 · {scene.subtitle}</p>
                                            )}
                                            {scene.narration && (
                                              <p className="text-[11px] text-slate-500 font-medium">나레이션 · {scene.narration}</p>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {d.payload?.note && (
                                      <p className="text-xs text-slate-600 font-medium whitespace-pre-wrap">{d.payload.note}</p>
                                    )}
                                    {[d.payload?.contentUrl, d.payload?.uploadUrl].filter(Boolean).map((link: string) => (
                                      <a
                                        key={link}
                                        href={link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block text-xs text-blue-600 font-bold hover:underline break-all"
                                      >
                                        {link}
                                      </a>
                                    ))}
                                    {d.payload?.adCode && (
                                      <p className="text-[11px] text-slate-500 font-bold mt-1">표기: {d.payload.adCode}</p>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>

                              {/* 장면·시점을 짚어 브랜드 의견을 다듬어 전달하고 승인·수정요청까지 한 화면에서 */}
                              {reviewTarget && (
                                <div className="mt-3">
                                  <CollabReviewRoom
                                    collabId={c.id}
                                    target={reviewTarget}
                                    token={token}
                                    onClose={() => setReviewTarget('')}
                                    onChanged={() => {
                                      refreshDetail(c.id);
                                      loadCollabs();
                                      loadQueue();
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {/* 피드백 · 전달 */}
                          {(detail.feedbacks || []).length > 0 && (
                            <div>
                              <p className="text-[9px] text-slate-400 font-black uppercase mb-2">피드백</p>
                              <div className="space-y-2">
                                {detail.feedbacks.map((f: any) => {
                                  const anchor = parseAnchor(f.anchor);
                                  return (
                                  <div key={f.id} className="bg-white rounded-lg border border-slate-100 p-3">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                      <span className="text-[10px] font-black text-slate-500">
                                        {f.authorType === 'brand' ? '브랜드' : f.authorType === 'manager' ? '담당자' : '인플루언서'}
                                      </span>
                                      {anchor.kind !== 'whole' && (
                                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-600 font-black">
                                          {anchor.label}
                                        </span>
                                      )}
                                      {f.stageKey && (
                                        <span className="text-[10px] text-slate-300 font-bold">
                                          {(detail.stages || []).find((s: any) => s.stageKey === f.stageKey)?.title || f.stageKey}
                                        </span>
                                      )}
                                      <span className="text-[10px] text-slate-400 font-bold">
                                        {FEEDBACK_STATUS_LABEL[f.status] || f.status}
                                      </span>
                                      {!f.visibleToInfluencer && (
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-50 text-amber-600">
                                          미전달 (담당자만 봄)
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">{f.body}</p>
                                    {/* relayed 의 처리 메모는 전달 기록용 내부 문자열이라 굳이 보이지 않는다 */}
                                    {f.resolutionNote && f.status !== 'relayed' && (
                                      <p className="text-[11px] text-slate-500 font-medium mt-1">처리: {f.resolutionNote}</p>
                                    )}

                                    {/* 브랜드 원문은 담당자가 다듬어 전달한다 */}
                                    {f.authorType === 'brand' && f.status === 'open' && (
                                      <div className="mt-2 flex flex-col gap-1.5">
                                        <textarea
                                          value={relayText[f.id] ?? f.body}
                                          onChange={e => setRelayText(p => ({ ...p, [f.id]: e.target.value }))}
                                          rows={2}
                                          className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:border-blue-400"
                                        />
                                        <div className="flex justify-end">
                                          <button
                                            onClick={() =>
                                              act(c.id, 'relay_feedback', {
                                                feedbackId: f.id,
                                                body: relayText[f.id] ?? f.body,
                                              }).then(r => r && notify('인플루언서에게 전달했습니다.'))
                                            }
                                            disabled={busy}
                                            className="px-3 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 disabled:opacity-40"
                                          >
                                            다듬어 전달
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* 일정 변경 · 취소 */}
                          <div className="bg-white rounded-xl border border-slate-100 p-4">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[9px] text-slate-400 font-black uppercase">일정 변경</p>
                              <span className="text-[10px] text-slate-400 font-bold">
                                남은 횟수 {detail.scheduleChangeRemaining ?? 0}회
                              </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              <select
                                value={scheduleForm.stageKey}
                                onChange={e => setScheduleForm(p => ({ ...p, stageKey: e.target.value }))}
                                className="text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5"
                              >
                                <option value="">단계 선택</option>
                                {(detail.stages || []).map((s: any) => (
                                  <option key={s.id} value={s.stageKey}>
                                    {s.title}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="date"
                                value={scheduleForm.nextDue}
                                onChange={e => setScheduleForm(p => ({ ...p, nextDue: e.target.value }))}
                                className="text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5"
                              />
                              <input
                                type="text"
                                value={scheduleForm.reason}
                                onChange={e => setScheduleForm(p => ({ ...p, reason: e.target.value }))}
                                placeholder="변경 사유"
                                className="text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5"
                              />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                              <button
                                onClick={() => {
                                  const reason = window.prompt('취소 사유를 입력해 주세요. 양쪽에 알림이 발송됩니다.');
                                  if (!reason) return;
                                  act(c.id, 'cancel', { reason }).then(r => r && notify('협업을 취소했습니다.'));
                                }}
                                disabled={busy || c.status !== 'in_progress'}
                                className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-[10px] font-black hover:bg-red-100 disabled:opacity-40"
                              >
                                협업 취소
                              </button>
                              <div className="flex gap-1.5">
                                {!c.managerUsername && (
                                  <button
                                    onClick={() => act(c.id, 'assign_manager').then(r => r && notify('내 담당으로 배정했습니다.'))}
                                    disabled={busy}
                                    className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
                                  >
                                    내 담당으로
                                  </button>
                                )}
                                <button
                                  onClick={() =>
                                    act(c.id, 'change_schedule', {
                                      stageKey: scheduleForm.stageKey,
                                      nextDue: scheduleForm.nextDue,
                                      reason: scheduleForm.reason,
                                    }).then(r => {
                                      if (!r) return;
                                      setScheduleForm({ stageKey: '', nextDue: '', reason: '' });
                                      notify('마감일을 변경했습니다.');
                                    })
                                  }
                                  disabled={busy || !scheduleForm.stageKey || !scheduleForm.nextDue}
                                  className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 disabled:opacity-40"
                                >
                                  마감일 변경
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* 진행 기록 */}
                          {(detail.events || []).length > 0 && (
                            <div>
                              <p className="text-[9px] text-slate-400 font-black uppercase mb-2">진행 기록</p>
                              <div className="space-y-1">
                                {detail.events.slice(0, 12).map((e: any) => (
                                  <div key={e.id} className="flex items-center gap-2">
                                    <span className="text-[10px] text-slate-300 font-bold flex-shrink-0">
                                      {new Date(e.createdAt).toLocaleString('ko-KR')}
                                    </span>
                                    <span className="text-[11px] text-slate-600 font-medium truncate">{e.summary}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default AdminCollabManagerConsole;
