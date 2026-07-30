import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/apiService';
import { formatKoreanWon } from '../utils/formatters';
import { StoryboardScene, parseAnchor } from '../utils/collabScenes';
import StoryboardEditor from './collab/StoryboardEditor';
import CollabReviewRoom from './collab/CollabReviewRoom';

/**
 * 인플루언서의 협업 작업 화면.
 *
 * 인플루언서가 하는 일은 지원 · 제출 · 피드백 처리로 정리된다. 금액을 협상하거나
 * 마감일을 스스로 바꾸지 않는다 — 그 요청은 담당자 채널로 간다. 대신 "지금 내가 할
 * 일이 무엇이고 언제까지인지"가 화면에 항상 하나만 남도록 만든다.
 *
 * 이렇게 나눈 이유는 예전 방식이 실패했기 때문이다. 브랜드와 직접 채팅으로 진행하면
 * 대본 수정 요청이 대화 스크롤 어딘가에 흩어지고, 무엇을 제출했고 무엇이 승인됐는지
 * 아무도 확정하지 못했다. 이제 제출물에는 버전이 붙고, 피드백에는 반영 여부가 남는다.
 */

interface CreatorCollabWorkspaceProps {
  userName: string;
  /** 협업이 하나도 없을 때 아무것도 그리지 않을지. 목록 화면 상단에 끼울 때 사용. */
  hideWhenEmpty?: boolean;
}

const STAGE_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: '대기', cls: 'bg-slate-100 text-slate-400' },
  active: { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  submitted: { label: '검수 대기', cls: 'bg-amber-50 text-amber-600' },
  revision: { label: '수정 요청', cls: 'bg-orange-50 text-orange-600' },
  done: { label: '완료', cls: 'bg-emerald-50 text-emerald-600' },
  skipped: { label: '생략', cls: 'bg-slate-100 text-slate-400' },
};

const dueText = (dueDate: string, daysLeft: number | null) => {
  if (!dueDate) return '마감일 미정';
  if (daysLeft === null || daysLeft === undefined) return dueDate;
  if (daysLeft < 0) return `${dueDate} · ${-daysLeft}일 지났어요`;
  if (daysLeft === 0) return `${dueDate} · 오늘까지`;
  return `${dueDate} · ${daysLeft}일 남음`;
};

const CreatorCollabWorkspace: React.FC<CreatorCollabWorkspaceProps> = ({ userName, hideWhenEmpty }) => {
  const [collabs, setCollabs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // 제출 폼 상태 — 단계 종류에 따라 쓰는 필드가 다르다.
  // 대본은 장면 단위로 받으므로 별도 화면(StoryboardEditor)이 자기 상태를 들고 있다.
  const [contentUrl, setContentUrl] = useState('');
  const [contentNote, setContentNote] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const [adCode, setAdCode] = useState('');
  const [resolveNote, setResolveNote] = useState<Record<string, string>>({});
  /** 검수 화면을 열어 둔 대상. 브랜드·담당자 의견을 장면·시점에 붙은 그대로 본다. */
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
      new CustomEvent('navigate-timeline', { detail: { proposalId: `support_inf_${collabId}` } }),
    );
  };

  const submitStage = async (stage: any, scenes?: StoryboardScene[]) => {
    if (!openId) return;
    const kind = stage.deliverableKind || '';
    let payload: Record<string, any> = {};

    if (kind === 'script') {
      // 장면은 스토리보드 화면이 이미 검사해 넘긴다. 여기서는 빈 배열만 막는다.
      if (!scenes || scenes.length === 0) {
        notify('장면 내용을 입력해 주세요.', 'error');
        return;
      }
      payload = { scenes };
    } else if (kind === 'upload') {
      if (!uploadUrl.trim()) {
        notify('게시물 링크를 입력해 주세요.', 'error');
        return;
      }
      payload = { uploadUrl: uploadUrl.trim(), adCode: adCode.trim() };
    } else {
      if (!contentUrl.trim()) {
        notify('결과물 링크를 입력해 주세요.', 'error');
        return;
      }
      payload = { contentUrl: contentUrl.trim(), note: contentNote.trim() };
    }

    setBusy(true);
    const res = await apiService.collabAction(openId, 'submit_deliverable', {
      stageKey: stage.stageKey,
      kind: kind || 'content',
      payload,
    });
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setContentUrl('');
    setContentNote('');
    setUploadUrl('');
    setAdCode('');
    notify(`제출했습니다 (v${res.version}). 담당자가 검수 후 알려드립니다.`);
    await refreshDetail(openId);
    await load();
  };

  const resolveFeedback = async (feedbackId: string, status: 'applied' | 'wont_apply') => {
    if (!openId) return;
    const note = resolveNote[feedbackId] || '';
    if (status === 'wont_apply' && !note.trim()) {
      notify('미반영 사유를 적어 주세요. 담당자가 브랜드에 설명해야 합니다.', 'error');
      return;
    }
    setBusy(true);
    const res = await apiService.collabAction(openId, 'resolve_feedback', { feedbackId, status, note });
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setResolveNote(p => ({ ...p, [feedbackId]: '' }));
    notify(status === 'applied' ? '반영 완료로 표시했습니다.' : '미반영으로 표시했습니다.');
    await refreshDetail(openId);
  };

  if (loading) {
    if (hideWhenEmpty) return null;
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-bold">협업을 불러오는 중...</p>
      </div>
    );
  }

  if (collabs.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <h3 className="text-base font-black text-slate-900 mb-1">진행 중인 협업</h3>
        <p className="text-xs text-slate-400 font-medium">
          캠페인에 지원하면 담당자가 검토 후 연락드립니다. 선정되면 이곳에서 단계별로 진행하실 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-black text-slate-900">진행 중인 협업 ({collabs.length}건)</h3>
        <button onClick={load} className="text-[11px] text-slate-400 font-bold hover:text-slate-700">
          새로고침
        </button>
      </div>
      <p className="text-[11px] text-slate-400 font-medium mb-4">
        조건 · 일정 문의는 담당자 채널로 보내 주세요. 브랜드와 직접 조율하지 않아도 됩니다.
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
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-600 text-white">내 차례</span>
                      )}
                      {c.status === 'completed' && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-50 text-emerald-600">완료</span>
                      )}
                      {c.status === 'cancelled' && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-red-50 text-red-600">취소</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-bold truncate">{c.companyName}</p>
                  </div>
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
                      {isOpen ? '접기' : '진행하기'}
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] text-slate-600 font-bold">
                      {c.currentStageTitle || (c.status === 'completed' ? '모든 단계 완료' : '준비 중')}
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
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[9px] text-slate-400 font-black uppercase">협업 조건</p>
                            <span
                              className={`text-[10px] font-black ${detail.terms.lockedAt ? 'text-emerald-600' : 'text-amber-600'}`}
                            >
                              {detail.terms.lockedAt ? '확정' : '담당자 확정 대기'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-[10px] text-slate-400 font-bold">보수</p>
                              <p className="text-xs text-slate-900 font-black">
                                {detail.terms.fee ? formatKoreanWon(detail.terms.fee) : '협의 중'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-400 font-bold">세후 예상 수령액</p>
                              <p className="text-xs text-slate-900 font-black">
                                {detail.terms.fee ? `${formatKoreanWon(detail.terms.netFee)} (3.3% 차감)` : '-'}
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
                              가이드 문서 보기
                            </a>
                          )}
                          {detail.terms.guideNote && (
                            <p className="text-xs text-slate-600 font-medium whitespace-pre-wrap mt-2">
                              {detail.terms.guideNote}
                            </p>
                          )}
                        </div>
                      )}

                      {/* 단계 목록과 제출 */}
                      <div>
                        <p className="text-[9px] text-slate-400 font-black uppercase mb-2">진행 단계</p>
                        <div className="space-y-1.5">
                          {(detail.stages || []).map((s: any) => {
                            const sb = STAGE_STATUS_LABEL[s.status] || { label: s.status, cls: 'bg-slate-100 text-slate-500' };
                            const canSubmit = s.isMine && ['active', 'revision'].includes(s.status);
                            return (
                              <div key={s.id} className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-[10px] text-slate-300 font-black w-4">{s.seq}</span>
                                    <span className="text-xs text-slate-800 font-bold truncate">{s.title}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${sb.cls}`}>{sb.label}</span>
                                    {s.isMine && s.status !== 'done' && (
                                      <span className="text-[9px] text-blue-600 font-black">내 담당</span>
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
                                      /* 대본은 장면 단위로 받는다. 수정 요청이면 마지막 제출본을
                                         이어받아 열어 준다 — 처음부터 다시 쓰게 하면 이미 통과한
                                         장면까지 바뀌고, 붙어 있던 피드백이 어디를 가리키는지
                                         알 수 없게 된다. */
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
                                              placeholder="결과물 링크 (영상 · 이미지 폴더 등)"
                                              className="w-full text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                                            />
                                            <textarea
                                              value={contentNote}
                                              onChange={e => setContentNote(e.target.value)}
                                              rows={3}
                                              placeholder="캡션 초안이나 전달 사항 (선택)"
                                              className="w-full text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-blue-400"
                                            />
                                            <p className="text-[10px] text-slate-400 font-medium">
                                              mp4 · mov 처럼 바로 재생되는 링크면 브랜드가 화면에서 시점을 짚어 의견을 남길 수 있습니다.
                                            </p>
                                          </div>
                                        )}

                                        {s.deliverableKind === 'upload' && (
                                          <div className="space-y-2">
                                            <input
                                              type="url"
                                              value={uploadUrl}
                                              onChange={e => setUploadUrl(e.target.value)}
                                              placeholder="게시물 링크 (필수)"
                                              className="w-full text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                                            />
                                            <input
                                              type="text"
                                              value={adCode}
                                              onChange={e => setAdCode(e.target.value)}
                                              placeholder="광고 표기 문구 (예: 유료 광고 포함)"
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
                                            {busy ? '제출 중...' : s.status === 'revision' ? '수정본 제출' : '제출하기'}
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

                      {/* 검수 화면 — 내가 낸 대본·영상 옆에 붙은 의견을 그 위치에서 본다.
                          목록으로만 보면 "3번 장면" 같은 말이 어디를 가리키는지 다시 찾아야 한다. */}
                      {(() => {
                        const kinds: Array<{ key: 'script' | 'content'; label: string }> = [
                          { key: 'script', label: '대본' },
                          { key: 'content', label: '영상' },
                        ];
                        const available = kinds.filter(k =>
                          (detail.deliverables || []).some((d: any) => d.kind === k.key),
                        );
                        if (available.length === 0) return null;
                        return (
                          <div>
                            <p className="text-[9px] text-slate-400 font-black uppercase mb-2">검수 화면</p>
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
                                  {k.label} 피드백 {reviewTarget === k.key ? '닫기' : '보기'}
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

                      {/* 담당자가 전달한 피드백 */}
                      {(detail.feedbacks || []).length > 0 && (
                        <div>
                          <p className="text-[9px] text-slate-400 font-black uppercase mb-2">전달된 피드백</p>
                          <div className="space-y-2">
                            {detail.feedbacks.map((f: any) => {
                              const parsed = parseAnchor(f.anchor);
                              return (
                              <div key={f.id} className="bg-white rounded-lg border border-slate-100 p-3">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] font-black text-slate-500">담당자</span>
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
                                      placeholder="처리 메모 (미반영은 사유 필수)"
                                      className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                                    />
                                    <div className="flex gap-1.5 justify-end">
                                      <button
                                        onClick={() => resolveFeedback(f.id, 'applied')}
                                        disabled={busy}
                                        className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-500 disabled:opacity-40"
                                      >
                                        반영했어요
                                      </button>
                                      <button
                                        onClick={() => resolveFeedback(f.id, 'wont_apply')}
                                        disabled={busy}
                                        className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
                                      >
                                        어려워요
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-slate-400 font-bold mt-1.5">
                                    {f.status === 'applied' ? '반영 완료' : f.status === 'wont_apply' ? '미반영' : f.status}
                                    {f.resolutionNote ? ` · ${f.resolutionNote}` : ''}
                                  </p>
                                )}
                              </div>
                            );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 최근 진행 기록 */}
                      {(detail.events || []).length > 0 && (
                        <div>
                          <p className="text-[9px] text-slate-400 font-black uppercase mb-2">최근 기록</p>
                          <div className="space-y-1">
                            {detail.events.slice(0, 6).map((e: any) => (
                              <div key={e.id} className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-300 font-bold flex-shrink-0">
                                  {new Date(e.createdAt).toLocaleDateString('ko-KR')}
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
