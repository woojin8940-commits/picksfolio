import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/apiService';
import { formatKoreanWon } from '../utils/formatters';
import { normalizeScenes, parseAnchor } from '../utils/collabScenes';
import CollabReviewRoom from './collab/CollabReviewRoom';

/**
 * 브랜드가 보는 협업 진행 현황 (읽기 전용).
 *
 * 브랜드는 캠페인을 올리고 지원자에게 의견을 남기는 데까지 관여한다. 그 뒤의 진행 —
 * 조건 확정, 대본 검수, 마감 관리, 업로드 확인 — 은 담당자가 맡는다. 그래서 이 화면에
 * 승인 버튼이 없다. 대신 "지금 어느 단계인지"와 "무엇이 제출되었는지"를 그대로 보여주고,
 * 하고 싶은 말은 담당자에게 전달한다.
 *
 * 의견을 인플루언서에게 직접 보내지 않는 것이 이 구조의 핵심이다. 브랜드 원문은 담당자만
 * 보고(visible_to_influencer=false), 담당자가 정리해 전달한다 — 그러지 않으면 중간에
 * 사람을 두는 의미가 없고, 예전처럼 브랜드가 곧 검수자가 된다.
 */

interface BrandCollabProgressProps {
  /** 특정 캠페인의 협업만 볼 때. 비우면 이 브랜드의 전체 협업. */
  campaignId?: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

type CollabRow = {
  id: string;
  campaignId: string;
  campaignTitle: string;
  creatorUsername: string;
  managerUsername: string;
  status: string;
  currentStageKey: string;
  currentStageTitle: string;
  currentStageOwner: string;
  currentStageStatus: string;
  dueDate: string;
  daysLeft: number | null;
  progress: number;
  stageCount: number;
  openFeedbackCount: number;
  uploadUrl: string;
  confirmedAt: string | null;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  in_progress: { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: '완료', cls: 'bg-emerald-50 text-emerald-600' },
  cancelled: { label: '취소', cls: 'bg-red-50 text-red-600' },
};

const STAGE_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: '대기', cls: 'bg-slate-100 text-slate-400' },
  active: { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  submitted: { label: '검수 대기', cls: 'bg-amber-50 text-amber-600' },
  revision: { label: '수정중', cls: 'bg-orange-50 text-orange-600' },
  done: { label: '완료', cls: 'bg-emerald-50 text-emerald-600' },
  skipped: { label: '생략', cls: 'bg-slate-100 text-slate-400' },
};

const OWNER_LABEL: Record<string, string> = {
  influencer: '인플루언서',
  manager: '담당자',
  brand: '브랜드',
};

/**
 * 지금 브랜드가 볼 검수 화면. 검수 단계에 와 있을 때만 값이 있다.
 *
 * 단계 이름 대신 무엇을 보는지로 이름을 붙인다 — 브랜드에게 'script_review'는 아무
 * 의미가 없고, "대본 피드백하기"는 누를지 말지 바로 판단할 수 있다.
 */
const REVIEW_TARGET: Record<string, { target: 'script' | 'content'; cta: string }> = {
  script: { target: 'script', cta: '대본 보기' },
  script_review: { target: 'script', cta: '대본 피드백하기' },
  content: { target: 'content', cta: '영상 보기' },
  content_review: { target: 'content', cta: '영상 피드백하기' },
};

/** 세로 진행 스텝의 색. 계산식으로 만들면 Tailwind가 클래스를 찾지 못한다. */
const STEP_TONE = {
  done: { dot: 'bg-emerald-500 text-white', line: 'bg-emerald-200', title: 'text-slate-400' },
  current: { dot: 'bg-orange-500 text-white', line: 'bg-slate-200', title: 'text-slate-900' },
  pending: { dot: 'bg-slate-200 text-slate-400', line: 'bg-slate-200', title: 'text-slate-400' },
} as const;

const dueText = (dueDate: string, daysLeft: number | null) => {
  if (!dueDate) return '마감일 미정';
  if (daysLeft === null || daysLeft === undefined) return dueDate;
  if (daysLeft < 0) return `${dueDate} · ${-daysLeft}일 경과`;
  if (daysLeft === 0) return `${dueDate} · 오늘`;
  return `${dueDate} · D-${daysLeft}`;
};

const BrandCollabProgress: React.FC<BrandCollabProgressProps> = ({ campaignId, onNotify }) => {
  const [collabs, setCollabs] = useState<CollabRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackStage, setFeedbackStage] = useState('');
  const [sending, setSending] = useState(false);
  /** 열어 둔 검수 화면. 협업 카드마다 따로 열리므로 협업 ID까지 같이 들고 있는다. */
  const [reviewFor, setReviewFor] = useState<{ collabId: string; target: 'script' | 'content' } | null>(null);

  const notify = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      if (onNotify) onNotify(message, type);
    },
    [onNotify],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getCollabs('brand');
    const rows: CollabRow[] = res.collabs || [];
    setCollabs(campaignId ? rows.filter(c => c.campaignId === campaignId) : rows);
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshDetail = useCallback(
    async (collabId: string) => {
      const res = await apiService.getCollabDetail(collabId);
      if (res.error) {
        notify(res.error, 'error');
        return null;
      }
      setDetail(res);
      return res;
    },
    [notify],
  );

  const openDetail = async (collabId: string) => {
    if (openId === collabId) {
      setOpenId('');
      setDetail(null);
      return;
    }
    setOpenId(collabId);
    setDetail(null);
    setDetailLoading(true);
    const res = await refreshDetail(collabId);
    setDetailLoading(false);
    if (res) setFeedbackStage(res.collab?.currentStageKey || '');
  };

  const openManagerThread = (collabId: string) => {
    window.dispatchEvent(
      new CustomEvent('navigate-timeline', { detail: { proposalId: `support_biz_${collabId}` } }),
    );
  };

  const sendFeedback = async () => {
    const text = feedbackText.trim();
    if (!text || !openId) return;
    setSending(true);
    const res = await apiService.collabAction(openId, 'add_feedback', {
      stageKey: feedbackStage,
      body: text,
    });
    setSending(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setFeedbackText('');
    notify('담당자에게 의견을 전달했습니다. 담당자가 정리해 인플루언서에게 전달합니다.');
    const refreshed = await apiService.getCollabDetail(openId);
    if (!refreshed.error) setDetail(refreshed);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-sm text-slate-400 font-bold">협업 진행 현황을 불러오는 중...</p>
      </div>
    );
  }

  if (collabs.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 mb-2">협업 진행 현황</h3>
        <p className="text-xs text-slate-400 font-medium">
          담당자가 지원자를 선정하면 이곳에 협업이 생기고 단계별 진행 상황이 표시됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm">
      <h3 className="text-lg font-black text-slate-900 mb-1">협업 진행 현황 ({collabs.length}건)</h3>
      <p className="text-[11px] text-slate-400 font-medium mb-5">
        인플루언서별로 한 줄씩 표시됩니다. 이름을 누르면 그 인플루언서에게 공유된 가이드라인과
        단계별 진행을 확인할 수 있습니다. 단계 승인과 마감 관리는 담당자가 진행하고, 의견은
        담당자에게 전달됩니다.
      </p>

      <div className="space-y-3">
        {collabs.map(c => {
          const badge = STATUS_LABEL[c.status] || { label: c.status, cls: 'bg-slate-100 text-slate-500' };
          const isOpen = openId === c.id;
          // 검수 단계에 와 있으면 볼 것이 있다는 뜻이다. 그 외 단계에서는 누구를
          // 기다리는 중인지만 보여 주고 버튼을 만들지 않는다.
          const review = REVIEW_TARGET[c.currentStageKey || ''];
          const reviewOpen = reviewFor?.collabId === c.id;
          return (
            <div key={c.id} className="border border-slate-100 rounded-xl overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* 인플루언서 이름 자체가 들어가는 문이다. '자세히' 버튼만 두면 이름을
                      눌러 보고 아무 일도 없는 것을 먼저 겪는다. */}
                  <button
                    type="button"
                    onClick={() => openDetail(c.id)}
                    aria-expanded={isOpen}
                    className="min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-black text-sm text-slate-900 hover:text-blue-600 transition-colors">
                        @{c.creatorUsername}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${badge.cls}`}>{badge.label}</span>
                      {c.openFeedbackCount > 0 && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-50 text-amber-600">
                          확인 중 의견 {c.openFeedbackCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-bold truncate">{c.campaignTitle}</p>
                  </button>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => openManagerThread(c.id)}
                      className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 transition-colors"
                    >
                      담당자와 대화
                    </button>
                    <button
                      onClick={() => openDetail(c.id)}
                      className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 transition-colors"
                    >
                      {isOpen ? '접기' : '가이드라인 · 진행'}
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] text-slate-600 font-bold">
                      {c.currentStageTitle || (c.status === 'completed' ? '모든 단계 완료' : '단계 준비 중')}
                      {c.currentStageOwner && (
                        <span className="text-slate-400 font-medium"> · {OWNER_LABEL[c.currentStageOwner] || c.currentStageOwner} 차례</span>
                      )}
                    </p>
                    <p className={`text-[11px] font-bold ${(c.daysLeft ?? 1) < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {dueText(c.dueDate, c.daysLeft)}
                    </p>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${c.status === 'cancelled' ? 'bg-red-400' : 'bg-blue-600'}`}
                      style={{ width: `${Math.min(100, Math.max(0, c.progress))}%` }}
                    />
                  </div>
                </div>

                {c.uploadUrl && (
                  <a
                    href={c.uploadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-3 text-[11px] text-blue-600 font-bold hover:underline truncate max-w-full"
                  >
                    게시물 링크 보기
                  </a>
                )}

                {/* 지금 할 일. 검수 차례면 검은 버튼 하나, 아니면 기다리는 이유 한 줄. */}
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                  {review ? (
                    <>
                      <p className="text-[11px] text-slate-500 font-bold min-w-0 truncate">
                        {c.currentStageTitle} · {c.dueDate ? `${c.dueDate} 까지` : '마감일 미정'}
                      </p>
                      <button
                        onClick={() =>
                          setReviewFor(reviewOpen ? null : { collabId: c.id, target: review.target })
                        }
                        className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-[11px] font-black hover:bg-slate-700 transition-colors flex-shrink-0"
                      >
                        {reviewOpen ? '검수 화면 닫기' : review.cta}
                      </button>
                    </>
                  ) : (
                    <p className="text-[11px] text-slate-400 font-bold">
                      {c.status === 'completed'
                        ? '모든 단계가 끝났습니다'
                        : `${OWNER_LABEL[c.currentStageOwner] || '담당자'} 진행 중${c.dueDate ? ` · ${c.dueDate} 까지` : ''}`}
                    </p>
                  )}
                </div>

                {reviewOpen && reviewFor && (
                  <div className="mt-3">
                    <CollabReviewRoom
                      collabId={c.id}
                      target={reviewFor.target}
                      onClose={() => setReviewFor(null)}
                      onChanged={() => {
                        load();
                        if (openId === c.id) refreshDetail(c.id);
                      }}
                    />
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                  {detailLoading ? (
                    <p className="text-xs text-slate-400 font-bold text-center py-6">불러오는 중...</p>
                  ) : !detail ? (
                    <p className="text-xs text-slate-400 font-bold text-center py-6">정보를 불러오지 못했습니다.</p>
                  ) : (
                    <div className="space-y-5">
                      {/* 조건 */}
                      {detail.terms && (
                        <div className="bg-white rounded-xl border border-slate-100 p-4">
                          <p className="text-[9px] text-slate-400 font-black uppercase mb-2">협업 조건</p>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                              <p className="text-[10px] text-slate-400 font-bold">보수</p>
                              <p className="text-xs text-slate-900 font-black">
                                {detail.terms.fee ? formatKoreanWon(detail.terms.fee) : '협의'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400 font-bold">대본 마감</p>
                              <p className="text-xs text-slate-900 font-black">{detail.terms.scriptDue || '-'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400 font-bold">콘텐츠 마감</p>
                              <p className="text-xs text-slate-900 font-black">{detail.terms.contentDue || '-'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400 font-bold">업로드 마감</p>
                              <p className="text-xs text-slate-900 font-black">{detail.terms.uploadDue || '-'}</p>
                            </div>
                          </div>
                          <p className="text-[10px] text-slate-400 font-medium mt-2">
                            {detail.terms.lockedAt ? '담당자가 확정한 조건입니다.' : '담당자가 조건을 정리하는 중입니다.'}
                          </p>
                        </div>
                      )}

                      {/* 공유한 가이드라인 — 이 인플루언서에게 실제로 전달된 내용.
                          캠페인에 적어 둔 원문이 아니라 협업 조건(collab_terms)에 복사된
                          값을 읽는다. 담당자가 이 인플루언서에게 맞춰 고쳐 보내는 경우가
                          있어서, 캠페인 브리프를 그대로 보여 주면 브랜드와 인플루언서가
                          서로 다른 가이드를 보고 이야기하게 된다.
                          '가이드 전달' 단계 상태를 함께 붙여 두면 이미 갔는지 아직인지가
                          한 줄에서 끝난다. */}
                      {(() => {
                        const guideStage = (detail.stages || []).find((s: any) => s.stageKey === 'guide');
                        const guideNote = String(detail.terms?.guideNote || '').trim();
                        const guideUrl = String(detail.terms?.guideUrl || '').trim();
                        const gb = guideStage
                          ? STAGE_STATUS_LABEL[guideStage.status] || { label: guideStage.status, cls: 'bg-slate-100 text-slate-500' }
                          : null;
                        return (
                          <div className="bg-white rounded-xl border border-slate-100 p-4">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <p className="text-[9px] text-slate-400 font-black uppercase">공유한 가이드라인</p>
                              {gb && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${gb.cls}`}>
                                  {guideStage.title} · {gb.label}
                                </span>
                              )}
                            </div>
                            {guideNote || guideUrl ? (
                              <>
                                {guideNote && (
                                  <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">
                                    {guideNote}
                                  </p>
                                )}
                                {guideUrl && (
                                  <a
                                    href={guideUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-block text-xs text-blue-600 font-bold hover:underline break-all ${
                                      guideNote ? 'mt-2' : ''
                                    }`}
                                  >
                                    가이드 문서 열기
                                  </a>
                                )}
                                <p className="text-[10px] text-slate-400 font-medium mt-2">
                                  담당자가 이 인플루언서에게 전달한 가이드입니다. 고칠 내용은 아래 의견으로
                                  남겨 주세요.
                                </p>
                              </>
                            ) : (
                              <p className="text-[11px] text-slate-400 font-medium">
                                아직 전달된 가이드라인이 없습니다. 캠페인에 적어 둔 가이드를 담당자가 이
                                인플루언서에게 맞춰 정리한 뒤 이 자리에 표시됩니다.
                              </p>
                            )}
                          </div>
                        );
                      })()}

                      {/* 전체 프로세스 — 어디까지 왔는지 한눈에.
                          단계 상태를 배지로만 보여 주면 여덟 줄을 다 읽어야 현재 위치를
                          알 수 있다. 지나온 단계·지금 단계·남은 단계를 색으로 나눈다. */}
                      <div>
                        <p className="text-[9px] text-slate-400 font-black uppercase mb-2">
                          전체 프로세스 {detail.stages?.length || 0}단계
                        </p>
                        <div className="bg-white rounded-xl border border-slate-100 p-4">
                          {(detail.stages || []).map((s: any, i: number) => {
                            const isCurrent = s.stageKey === detail.collab?.currentStageKey;
                            const state = s.status === 'done' || s.status === 'skipped'
                              ? 'done'
                              : isCurrent || ['active', 'submitted', 'revision'].includes(s.status)
                                ? 'current'
                                : 'pending';
                            const tone = STEP_TONE[state];
                            const sb = STAGE_STATUS_LABEL[s.status] || { label: s.status, cls: 'bg-slate-100 text-slate-500' };
                            const last = i === (detail.stages || []).length - 1;
                            return (
                              <div key={s.id} className="flex gap-3">
                                <div className="flex flex-col items-center flex-shrink-0">
                                  <span
                                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black ${tone.dot}`}
                                  >
                                    {state === 'done' ? '✓' : s.seq}
                                  </span>
                                  {!last && <span className={`w-px flex-1 my-1 ${tone.line}`} />}
                                </div>
                                <div className={`min-w-0 ${last ? '' : 'pb-3'}`}>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-xs font-black ${tone.title}`}>{s.title}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${sb.cls}`}>
                                      {sb.label}
                                    </span>
                                  </div>
                                  <p
                                    className={`text-[10px] font-bold mt-0.5 ${
                                      state === 'current' ? 'text-orange-500' : 'text-slate-300'
                                    }`}
                                  >
                                    {s.dueDate ? `${s.dueDate} 까지` : '마감일 미정'}
                                    {s.ownerRole ? ` · ${OWNER_LABEL[s.ownerRole] || s.ownerRole}` : ''}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
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
                                  <span className="text-[10px] text-slate-400 font-medium">
                                    {new Date(d.createdAt).toLocaleDateString('ko-KR')}
                                  </span>
                                  {(d.kind === 'script' || d.kind === 'content') && (
                                    <button
                                      onClick={() => setReviewFor({ collabId: c.id, target: d.kind })}
                                      className="ml-auto px-2.5 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700"
                                    >
                                      {d.kind === 'script' ? '대본 피드백하기' : '영상 피드백하기'}
                                    </button>
                                  )}
                                </div>
                                {scenes.length > 0 && (
                                  <div className="space-y-1.5">
                                    {scenes.map((scene, i) => (
                                      <div key={i} className="border-l-2 border-slate-100 pl-2.5">
                                        <p className="text-[10px] text-slate-400 font-black"># {i + 1}</p>
                                        <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">
                                          {scene.visual}
                                        </p>
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
                                {d.payload?.uploadUrl && (
                                  <a
                                    href={d.payload.uploadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 font-bold hover:underline break-all"
                                  >
                                    {d.payload.uploadUrl}
                                  </a>
                                )}
                                {d.payload?.contentUrl && (
                                  <a
                                    href={d.payload.contentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 font-bold hover:underline break-all"
                                  >
                                    {d.payload.contentUrl}
                                  </a>
                                )}
                              </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 의견 */}
                      <div>
                        <p className="text-[9px] text-slate-400 font-black uppercase mb-2">의견 · 피드백</p>
                        {(detail.feedbacks || []).length > 0 && (
                          <div className="space-y-2 mb-3">
                            {detail.feedbacks.map((f: any) => {
                              const anchor = parseAnchor(f.anchor);
                              const stageTitle = (detail.stages || []).find((s: any) => s.stageKey === f.stageKey)?.title;
                              return (
                              <div key={f.id} className="bg-white rounded-lg border border-slate-100 p-3">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className="text-[10px] font-black text-slate-500">
                                    {f.authorType === 'brand' ? '우리 의견' : f.authorType === 'manager' ? '담당자' : '인플루언서'}
                                  </span>
                                  {anchor.kind !== 'whole' && (
                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-600 font-black">
                                      {anchor.label}
                                    </span>
                                  )}
                                  {f.stageKey && (
                                    <span className="text-[10px] text-slate-300 font-bold">{stageTitle || f.stageKey}</span>
                                  )}
                                  <span className="text-[10px] text-slate-400 font-bold">
                                    {f.status === 'open'
                                      ? '담당자 확인 중'
                                      : f.status === 'relayed'
                                        ? '인플루언서에게 전달됨'
                                        : f.status === 'applied'
                                          ? '반영 완료'
                                          : f.status === 'wont_apply'
                                            ? '미반영'
                                            : f.status}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">{f.body}</p>
                                {f.resolutionNote && f.status === 'wont_apply' && (
                                  <p className="text-[11px] text-slate-500 font-medium mt-1">사유: {f.resolutionNote}</p>
                                )}
                              </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="bg-white rounded-lg border border-slate-100 p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <select
                              value={feedbackStage}
                              onChange={e => setFeedbackStage(e.target.value)}
                              className="text-[11px] font-bold text-slate-600 border border-slate-200 rounded-md px-2 py-1"
                            >
                              <option value="">단계 선택</option>
                              {(detail.stages || []).map((s: any) => (
                                <option key={s.id} value={s.stageKey}>
                                  {s.title}
                                </option>
                              ))}
                            </select>
                            <span className="text-[10px] text-slate-400 font-medium">
                              담당자에게 전달됩니다 (인플루언서에게 바로 가지 않습니다)
                            </span>
                          </div>
                          <textarea
                            value={feedbackText}
                            onChange={e => setFeedbackText(e.target.value)}
                            rows={3}
                            placeholder="수정이 필요한 부분이나 요청 사항을 적어 주세요."
                            className="w-full text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-blue-400"
                          />
                          <div className="flex justify-end mt-2">
                            <button
                              onClick={sendFeedback}
                              disabled={sending || !feedbackText.trim()}
                              className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-500 transition-colors disabled:opacity-40"
                            >
                              {sending ? '전달 중...' : '담당자에게 전달'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BrandCollabProgress;
