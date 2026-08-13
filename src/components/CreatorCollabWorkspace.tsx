import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/apiService';
import { formatKoreanWon } from '../utils/formatters';
import { parseAnchor } from '../utils/collabScenes';
import StoryboardEditor from './collab/StoryboardEditor';
import CollabReviewRoom from './collab/CollabReviewRoom';
import CollabSharedWorkspace from './collab/CollabSharedWorkspace';
import { useLanguage } from '../contexts/LanguageContext';

interface CreatorCollabWorkspaceProps {
  userName: string;
  hideWhenEmpty?: boolean;
}

const getStageStatusLabel = (status: string, isEn: boolean) => {
  const labels: Record<string, { label: string; cls: string }> = {
    pending: { label: isEn ? 'Pending' : '대기', cls: 'bg-slate-100 text-slate-400' },
    active: { label: isEn ? 'In Progress' : '진행중', cls: 'bg-blue-50 text-blue-600' },
    submitted: { label: isEn ? 'Review Pending' : '검수 대기', cls: 'bg-amber-50 text-amber-600' },
    revision: { label: isEn ? 'Revision Requested' : '수정 요청', cls: 'bg-indigo-50 text-indigo-600' },
    done: { label: isEn ? 'Completed' : '완료', cls: 'bg-emerald-50 text-emerald-600' },
    skipped: { label: isEn ? 'Skipped' : '생략', cls: 'bg-slate-100 text-slate-400' },
  };
  return labels[status] || { label: status, cls: 'bg-slate-100 text-slate-500' };
};

const dueText = (dueDate: string, daysLeft: number | null, isEn: boolean) => {
  if (!dueDate) return isEn ? 'No deadline' : '마감일 미정';
  if (daysLeft === null || daysLeft === undefined) return dueDate;
  if (daysLeft < 0) return isEn ? `${dueDate} · ${-daysLeft} days overdue` : `${dueDate} · ${-daysLeft}일 지났어요`;
  if (daysLeft === 0) return isEn ? `${dueDate} · Due today` : `${dueDate} · 오늘까지`;
  return isEn ? `${dueDate} · ${daysLeft} days left` : `${dueDate} · ${daysLeft}일 남음`;
};

const CreatorCollabWorkspace: React.FC<CreatorCollabWorkspaceProps> = ({ userName, hideWhenEmpty }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

  const [collabs, setCollabs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [contentUrl, setContentUrl] = useState('');
  const [contentNote, setContentNote] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const [adCode, setAdCode] = useState('');
  const [resolveNote, setResolveNote] = useState<Record<string, string>>({});
  const [reviewTarget, setReviewTarget] = useState<'' | 'script' | 'content'>('');

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    window.setTimeout(() => setMessage(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getCollabs('influencer');
    setCollabs(res.collabs || []);
    setLoading(false);
  }, []);

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

  const openManagerThread = (collabId: string) => {
    window.dispatchEvent(
      new CustomEvent('navigate-timeline', {
        detail: { proposalId: `support_inf_${collabId}` },
      }),
    );
  };

  const submitStage = async (stage: any, scenesPayload?: any) => {
    setBusy(true);
    let payload: any = {};
    if (stage.deliverableKind === 'script') {
      if (!scenesPayload || scenesPayload.length === 0) {
        notify(isEn ? 'Please enter script scenes.' : '대본 내용을 입력해 주세요.', 'error');
        setBusy(false);
        return;
      }
      payload = { scenes: scenesPayload };
    } else if (stage.deliverableKind === 'content') {
      if (!contentUrl.trim()) {
        notify(isEn ? 'Please enter result link.' : '결과물 링크를 입력해 주세요.', 'error');
        setBusy(false);
        return;
      }
      payload = { url: contentUrl.trim(), note: contentNote.trim() };
    } else if (stage.deliverableKind === 'upload') {
      if (!uploadUrl.trim()) {
        notify(isEn ? 'Please enter post link.' : '게시물 링크를 입력해 주세요.', 'error');
        setBusy(false);
        return;
      }
      payload = { uploadUrl: uploadUrl.trim(), adCode: adCode.trim() };
    }

    const collabId = detail?.collab?.id;
    const res = await apiService.collabAction(collabId, 'submit_deliverable', {
      stageKey: stage.stageKey,
      kind: stage.deliverableKind,
      payload,
    });
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
    } else {
      notify(isEn ? 'Submission complete!' : '제출이 완료되었습니다.');
      setContentUrl('');
      setContentNote('');
      setUploadUrl('');
      setAdCode('');
      await refreshDetail(collabId);
      await load();
    }
  };

  const resolveFeedback = async (feedbackId: string, status: 'applied' | 'wont_apply') => {
    setBusy(true);
    const note = resolveNote[feedbackId] || '';
    const collabId = detail?.collab?.id;
    const res = await apiService.collabAction(collabId, 'resolve_feedback', { feedbackId, status, note });
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
    } else {
      notify(isEn ? 'Status updated.' : '처리 상태가 반영되었습니다.');
      await refreshDetail(collabId);
    }
  };

  if (hideWhenEmpty && !loading && collabs.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-[0_4px_16px_-4px_rgba(15,23,42,0.12)]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
          <span>🤝</span>
          <span>{isEn ? 'Active Collaborations' : '진행 중인 협업'}</span>
        </h3>
        <button onClick={load} className="text-[11px] text-slate-400 font-bold hover:text-slate-700">
          {isEn ? 'Refresh' : '새로고침'}
        </button>
      </div>
      <p className="text-[11px] text-slate-400 font-medium mb-4">
        {isEn ? 'Send questions on terms or schedule to your manager.' : '조건 · 일정 문의는 담당자 채널로 보내 주세요. 브랜드와 직접 조율하지 않아도 됩니다.'}
      </p>

      {/* 협업이 아직 없을 때. 캠페인 목록 안에 얹혀 있을 때(hideWhenEmpty)는 상자째
          숨기지만, 메뉴로 직접 들어온 화면이 아무것도 없이 비어 있으면 화면이 깨진
          것으로 읽힌다. 무엇을 기다리는 중인지 한 줄로 적어 둔다. */}
      {!loading && collabs.length === 0 && (
        <div className="border border-dashed border-slate-200 rounded-xl px-4 py-8 text-center">
          <p className="text-xs text-slate-400 font-bold">
            {isEn
              ? 'No collaborations yet. Once you accept an offer, it shows up here.'
              : '아직 진행 중인 협업이 없습니다. 받은 제안을 수락하면 이곳에 캠페인이 생기고, 기획안 · 영상 초안 · 광고코드를 브랜드와 주고받을 수 있습니다.'}
          </p>
        </div>
      )}

      {message && (
        <div
          className={`mb-3 rounded-lg px-3 py-2 text-[11px] font-bold ${
            message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-3">
        {collabs.map(c => {
          const isOpen = openId === c.id;
          const mineNow = c.currentStageOwner === 'influencer' && ['active', 'revision'].includes(c.currentStageStatus);
          return (
            <div key={c.id} className="border border-slate-100 rounded-xl overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-black text-sm text-slate-900 truncate">{c.campaignTitle}</span>
                      {mineNow && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-600 text-white">
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
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => openManagerThread(c.id)}
                      className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 transition-colors"
                    >
                      {isEn ? 'Chat with Manager' : '담당자와 대화'}
                    </button>
                    <button
                      onClick={() => openDetail(c.id)}
                      className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 transition-colors"
                    >
                      {isOpen ? (isEn ? 'Collapse' : '접기') : (isEn ? 'In Progress' : '진행하기')}
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] text-slate-600 font-bold">
                      {c.currentStageTitle || (c.status === 'completed' ? (isEn ? 'All Stages Complete' : '모든 단계 완료') : (isEn ? 'Preparing' : '준비 중'))}
                    </p>
                    <p className={`text-[11px] font-bold ${(c.daysLeft ?? 1) < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                      {dueText(c.dueDate, c.daysLeft, isEn)}
                    </p>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${c.status === 'cancelled' ? 'bg-red-400' : 'bg-blue-600'}`}
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
                    <p className="text-xs text-slate-400 font-bold text-center py-6">{isEn ? 'Failed to load info.' : '정보를 불러오지 못했습니다.'}</p>
                  ) : (
                    <div className="space-y-5">
                      {detail.terms && (
                        <div className="bg-white rounded-xl border border-slate-100 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[9px] text-slate-400 font-black uppercase">{isEn ? 'Collaboration Terms' : '협업 조건'}</p>
                            <span
                              className={`text-[10px] font-black ${detail.terms.lockedAt ? 'text-emerald-600' : 'text-amber-600'}`}
                            >
                              {detail.terms.lockedAt ? (isEn ? 'Confirmed' : '확정') : (isEn ? 'Awaiting Confirmation' : '담당자 확정 대기')}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-[10px] text-slate-400 font-bold">{isEn ? 'Payout' : '보수'}</p>
                              <p className="text-xs text-slate-900 font-black">
                                {detail.terms.fee ? formatKoreanWon(detail.terms.fee) : (isEn ? 'In negotiation' : '협의 중')}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400 font-bold">{isEn ? 'Estimated Net Payout' : '세후 예상 수령액'}</p>
                              <p className="text-xs text-slate-900 font-black">
                                {detail.terms.fee ? `${formatKoreanWon(detail.terms.netFee)} (${isEn ? '3.3% tax' : '3.3% 차감'})` : '-'}
                              </p>
                            </div>
                          </div>
                          {detail.terms.guideUrl && (
                            <a
                              href={detail.terms.guideUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block mt-2 text-[11px] text-blue-600 font-bold hover:underline"
                            >
                              {isEn ? 'View Guide Document' : '가이드 문서 보기'}
                            </a>
                          )}
                          {detail.terms.guideNote && (
                            <p className="text-xs text-slate-600 font-medium whitespace-pre-wrap mt-2">
                              {detail.terms.guideNote}
                            </p>
                          )}
                        </div>
                      )}

                      <div>
                        <p className="text-[9px] text-slate-400 font-black uppercase mb-2">{isEn ? 'Stages' : '진행 단계'}</p>
                        <div className="space-y-1.5">
                          {(detail.stages || []).map((s: any) => {
                            const sb = getStageStatusLabel(s.status, isEn);
                            const canSubmit = s.isMine && ['active', 'revision'].includes(s.status);
                            return (
                              <div key={s.id} className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-[10px] text-slate-300 font-black w-4">{s.seq}</span>
                                    <span className="text-xs text-slate-800 font-bold truncate">{s.title}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${sb.cls}`}>{sb.label}</span>
                                    {s.isMine && s.status !== 'done' && (
                                      <span className="text-[9px] text-blue-600 font-black">{isEn ? 'Assigned to Me' : '내 담당'}</span>
                                    )}
                                  </div>
                                  <span
                                    className={`text-[10px] font-bold flex-shrink-0 ml-2 ${
                                      (s.daysLeft ?? 1) < 0 && s.status !== 'done' ? 'text-red-500' : 'text-slate-400'
                                    }`}
                                  >
                                    {s.dueDate || '-'}
                                  </span>
                                </div>

                                {canSubmit && (
                                  <div className="mt-2 border-t border-slate-100 pt-2">
                                    {s.hint && <p className="text-[11px] text-slate-500 font-medium mb-2">{s.hint}</p>}

                                    {s.deliverableKind === 'script' ? (
                                      <StoryboardEditor
                                        key={`${s.id}-${(detail.deliverables || []).filter((d: any) => d.kind === 'script').length}`}
                                        initialScenes={
                                          (detail.deliverables || [])
                                            .filter((d: any) => d.kind === 'script')
                                            .slice(-1)[0]?.payload?.scenes
                                        }
                                        submitting={busy}
                                        onSubmit={scenes => submitStage(s, scenes)}
                                        onNotify={notify}
                                      />
                                    ) : (
                                      <>
                                        {s.deliverableKind === 'content' && (
                                          <div className="space-y-2">
                                            <input
                                              type="url"
                                              value={contentUrl}
                                              onChange={e => setContentUrl(e.target.value)}
                                              placeholder={isEn ? 'Content link (folder, video, image)' : '결과물 링크 (영상 · 이미지 폴더 등)'}
                                              className="w-full text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                                            />
                                            <textarea
                                              value={contentNote}
                                              onChange={e => setContentNote(e.target.value)}
                                              rows={3}
                                              placeholder={isEn ? 'Caption draft or notes (optional)' : '캡션 초안이나 전달 사항 (선택)'}
                                              className="w-full text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-blue-400"
                                            />
                                            <p className="text-[10px] text-slate-400 font-medium">
                                              {isEn ? 'Direct video links (mp4, mov) allow timestamped feedback on-screen.' : 'mp4 · mov 처럼 바로 재생되는 링크면 브랜드가 화면에서 시점을 짚어 의견을 남길 수 있습니다.'}
                                            </p>
                                          </div>
                                        )}

                                        {s.deliverableKind === 'upload' && (
                                          <div className="space-y-2">
                                            <input
                                              type="url"
                                              value={uploadUrl}
                                              onChange={e => setUploadUrl(e.target.value)}
                                              placeholder={isEn ? 'Post URL (required)' : '게시물 링크 (필수)'}
                                              className="w-full text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                                            />
                                            <input
                                              type="text"
                                              value={adCode}
                                              onChange={e => setAdCode(e.target.value)}
                                              placeholder={isEn ? 'Ad disclosure tag (e.g. Paid Partnership)' : '광고 표기 문구 (예: 유료 광고 포함)'}
                                              className="w-full text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                                            />
                                          </div>
                                        )}

                                        <div className="flex justify-end mt-2">
                                          <button
                                            onClick={() => submitStage(s)}
                                            disabled={busy}
                                            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-500 transition-colors disabled:opacity-40"
                                          >
                                            {busy
                                              ? (isEn ? 'Submitting...' : '제출 중...')
                                              : s.status === 'revision'
                                              ? (isEn ? 'Submit Revision' : '수정본 제출')
                                              : (isEn ? 'Submit' : '제출하기')}
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <CollabSharedWorkspace
                        collabId={detail.collab.id}
                        role="influencer"
                        detail={detail}
                        onRefresh={() => refreshDetail(detail.collab.id)}
                        onNotify={notify}
                        isEn={isEn}
                      />

                      {(() => {
                        const kinds: Array<{ key: 'script' | 'content'; label: string }> = [
                          { key: 'script', label: isEn ? 'Script' : '대본' },
                          { key: 'content', label: isEn ? 'Video' : '영상' },
                        ];
                        const available = kinds.filter(k =>
                          (detail.deliverables || []).some((d: any) => d.kind === k.key),
                        );
                        if (available.length === 0) return null;
                        return (
                          <div>
                            <p className="text-[9px] text-slate-400 font-black uppercase mb-2">{isEn ? 'Review Screen' : '검수 화면'}</p>
                            <div className="flex gap-1.5 flex-wrap">
                              {available.map(k => (
                                <button
                                  key={k.key}
                                  onClick={() => setReviewTarget(reviewTarget === k.key ? '' : k.key)}
                                  className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors ${
                                    reviewTarget === k.key
                                      ? 'bg-slate-900 text-white'
                                      : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400'
                                  }`}
                                >
                                  {k.label} {isEn ? 'Feedback' : '피드백'} {reviewTarget === k.key ? (isEn ? 'Close' : '닫기') : (isEn ? 'View' : '보기')}
                                </button>
                              ))}
                            </div>
                            {reviewTarget && (
                              <div className="mt-3">
                                <CollabReviewRoom
                                  collabId={c.id}
                                  target={reviewTarget}
                                  onClose={() => setReviewTarget('')}
                                  onChanged={() => {
                                    refreshDetail(c.id);
                                    load();
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {(detail.feedbacks || []).length > 0 && (
                        <div>
                          <p className="text-[9px] text-slate-400 font-black uppercase mb-2">{isEn ? 'Relayed Feedback' : '전달된 피드백'}</p>
                          <div className="space-y-2">
                            {detail.feedbacks.map((f: any) => {
                              const parsed = parseAnchor(f.anchor);
                              return (
                              <div key={f.id} className="bg-white rounded-lg border border-slate-100 p-3">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] font-black text-slate-500">{isEn ? 'Manager' : '담당자'}</span>
                                  {f.stageKey && <span className="text-[10px] text-slate-300 font-bold">{f.stageKey}</span>}
                                  {parsed.kind !== 'whole' && (
                                    <span className="text-[10px] text-blue-500 font-black">{parsed.label}</span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">{f.body}</p>

                                {['open', 'relayed'].includes(f.status) ? (
                                  <div className="mt-2 flex flex-col gap-1.5">
                                    <input
                                      type="text"
                                      value={resolveNote[f.id] || ''}
                                      onChange={e => setResolveNote(p => ({ ...p, [f.id]: e.target.value }))}
                                      placeholder={isEn ? 'Note (Required if not applied)' : '처리 메모 (미반영은 사유 필수)'}
                                      className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                                    />
                                    <div className="flex gap-1.5 justify-end">
                                      <button
                                        onClick={() => resolveFeedback(f.id, 'applied')}
                                        disabled={busy}
                                        className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-500 disabled:opacity-40"
                                      >
                                        {isEn ? 'Applied' : '반영했어요'}
                                      </button>
                                      <button
                                        onClick={() => resolveFeedback(f.id, 'wont_apply')}
                                        disabled={busy}
                                        className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
                                      >
                                        {isEn ? 'Declined' : '어려워요'}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-slate-400 font-bold mt-1.5">
                                    {f.status === 'applied' ? (isEn ? 'Applied' : '반영 완료') : f.status === 'wont_apply' ? (isEn ? 'Not Applied' : '미반영') : f.status}
                                    {f.resolutionNote ? ` · ${f.resolutionNote}` : ''}
                                  </p>
                                )}
                              </div>
                            );
                            })}
                          </div>
                        </div>
                      )}

                      {(detail.events || []).length > 0 && (
                        <div>
                          <p className="text-[9px] text-slate-400 font-black uppercase mb-2">{isEn ? 'Recent History' : '최근 기록'}</p>
                          <div className="space-y-1">
                            {detail.events.slice(0, 6).map((e: any) => (
                              <div key={e.id} className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-300 font-bold flex-shrink-0">
                                  {new Date(e.createdAt).toLocaleDateString(isEn ? 'en-US' : 'ko-KR')}
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
        })}
      </div>
    </div>
  );
};

export default CreatorCollabWorkspace;
