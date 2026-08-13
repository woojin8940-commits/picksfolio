import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiService } from '../../services/apiService';
import {
  normalizeScenes,
  parseAnchor,
  compareByAnchor,
  sceneAnchor,
  timeAnchor,
  isValidTimecode,
  secondsToTimecode,
  timecodeToSeconds,
  isPlayableVideo,
} from '../../utils/collabScenes';

/**
 * 대본 · 영상 검수 화면.
 *
 * 인플루언서가 낸 것에 대고 이야기하는 자리다. 세 역할이 같은 화면을 보지만 할 수
 * 있는 일이 다르다.
 *
 *   * 브랜드     : 장면·시점을 짚어 의견을 남긴다. 인플루언서에게 바로 가지 않는다.
 *   * 담당자     : 브랜드 의견을 다듬어 전달하고, 이 버전을 승인하거나 수정 요청한다.
 *   * 인플루언서 : 전달된 항목마다 반영 여부를 남긴다.
 *
 * 의견을 제출물 옆에 붙이는 것이 이 화면의 전부다. 예전에는 대화창에 "두 번째 장면
 * 자막이 좀…"이라고 적었고, 며칠 뒤에는 그게 어느 버전의 몇 번 장면이었는지 아무도
 * 확정하지 못했다. 이제 의견은 `scene:2` / `t:00:12` 이라는 위치를 갖고, 그 위치
 * 바로 아래에 놓인다.
 */

interface CollabReviewRoomProps {
  collabId: string;
  /** 무엇을 검수하는지. 대본이면 장면에, 영상이면 시점에 의견이 붙는다. */
  target: 'script' | 'content';
  /** 담당자 콘솔에서 열 때의 관리자 토큰. 서비스 화면에서는 비운다. */
  token?: string;
  onClose?: () => void;
  /** 상태가 바뀌었을 때 상위 목록도 다시 읽도록. */
  onChanged?: () => void;
}

const TARGET_LABEL: Record<'script' | 'content', { title: string; empty: string }> = {
  script: { title: '대본 피드백', empty: '아직 제출된 대본이 없습니다.' },
  content: { title: '영상 피드백', empty: '아직 제출된 영상이 없습니다.' },
};

const DELIVERABLE_STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: '검수 대기', cls: 'bg-amber-50 text-amber-600' },
  revision_requested: { label: '수정 요청됨', cls: 'bg-indigo-50 text-indigo-600' },
  approved: { label: '승인', cls: 'bg-emerald-50 text-emerald-600' },
};

const FEEDBACK_STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: '담당자 확인 중', cls: 'bg-slate-100 text-slate-500' },
  relayed: { label: '전달됨', cls: 'bg-blue-50 text-blue-600' },
  applied: { label: '반영 완료', cls: 'bg-emerald-50 text-emerald-600' },
  wont_apply: { label: '미반영', cls: 'bg-red-50 text-red-600' },
  resolved: { label: '종료', cls: 'bg-slate-100 text-slate-500' },
};

const CollabReviewRoom: React.FC<CollabReviewRoomProps> = ({ collabId, target, token, onClose, onChanged }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [versionId, setVersionId] = useState('');

  // 새 의견 — 위치별로 따로 쓴다. 한 칸을 공유하면 장면 3을 적다가 장면 5를 열면
  // 적던 내용이 그쪽으로 옮겨간 것처럼 보인다.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [openComposer, setOpenComposer] = useState('');
  const [timecode, setTimecode] = useState('');
  const [relayDraft, setRelayDraft] = useState<Record<string, string>>({});
  const [resolveNote, setResolveNote] = useState<Record<string, string>>({});
  const [reviewNote, setReviewNote] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    window.setTimeout(() => setMessage(null), 4000);
  };

  const load = useCallback(async () => {
    const res = await apiService.getCollabDetail(collabId, token);
    setLoading(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setData(res);
  }, [collabId, token]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const role: 'brand' | 'manager' | 'influencer' = data?.role || 'brand';
  const versions: any[] = useMemo(
    () =>
      (data?.deliverables || [])
        .filter((d: any) => d.kind === target)
        .sort((a: any, b: any) => a.version - b.version),
    [data, target],
  );

  // 기본은 최신 버전. 사람이 고른 버전이 있으면 그것을 유지한다.
  const current = useMemo(
    () => versions.find((v: any) => v.id === versionId) || versions[versions.length - 1] || null,
    [versions, versionId],
  );

  const stageKey = current?.stageKey || '';
  const stage = (data?.stages || []).find((s: any) => s.stageKey === stageKey) || null;
  // 검수 단계는 제출 단계 다음이다(구성안 제출 → 구성안 검수). 승인·수정 요청은
  // 제출 단계에 대고 하므로 여기서는 제출 단계를 그대로 쓴다.
  const canDecide = role === 'manager' && !!stage && ['submitted', 'revision'].includes(stage.status);
  const canComment = role === 'brand' || role === 'manager';

  const feedbacks: any[] = useMemo(() => {
    const all = (data?.feedbacks || []) as any[];
    // 이 버전에 붙은 것과, 버전을 특정하지 않고 이 단계에 붙은 것 모두.
    return all
      .filter(f => (f.deliverableId ? f.deliverableId === current?.id : f.stageKey === stageKey))
      .sort(compareByAnchor);
  }, [data, current, stageKey]);

  const scenes = useMemo(() => normalizeScenes(current?.payload?.scenes), [current]);
  const videoUrl = String(current?.payload?.contentUrl || current?.payload?.uploadUrl || '');

  const feedbackFor = (predicate: (parsed: ReturnType<typeof parseAnchor>) => boolean) =>
    feedbacks.filter(f => predicate(parseAnchor(f.anchor)));

  // ------------------------------------------------------------------ 동작
  const act = async (action: string, payload: Record<string, any>) => {
    setBusy(true);
    const res = await apiService.collabAction(collabId, action, payload, token);
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return null;
    }
    await load();
    if (onChanged) onChanged();
    return res;
  };

  const addFeedback = async (anchor: string, key: string) => {
    const body = (draft[key] || '').trim();
    if (!body) return;
    const res = await act('add_feedback', {
      stageKey,
      deliverableId: current?.id || '',
      anchor,
      body,
    });
    if (!res) return;
    setDraft(p => ({ ...p, [key]: '' }));
    setOpenComposer('');
    notify(
      role === 'brand'
        ? '담당자에게 전달했습니다. 담당자가 정리해 인플루언서에게 전달합니다.'
        : '인플루언서에게 전달했습니다.',
    );
  };

  const addTimeFeedback = async () => {
    if (!isValidTimecode(timecode)) {
      notify('시점은 00:12 처럼 적어 주세요.', 'error');
      return;
    }
    const tc = timecode.trim();
    await addFeedback(tc ? timeAnchor(tc) : '', 'video');
    setTimecode('');
  };

  const relay = async (feedbackId: string, fallback: string) => {
    const body = (relayDraft[feedbackId] ?? fallback).trim();
    if (!body) {
      notify('전달할 내용을 적어 주세요.', 'error');
      return;
    }
    const res = await act('relay_feedback', { feedbackId, body });
    if (!res) return;
    setRelayDraft(p => ({ ...p, [feedbackId]: '' }));
    notify('인플루언서에게 전달했습니다.');
  };

  const resolve = async (feedbackId: string, status: 'applied' | 'wont_apply') => {
    const note = resolveNote[feedbackId] || '';
    if (status === 'wont_apply' && !note.trim()) {
      notify('미반영 사유를 적어 주세요. 담당자가 브랜드에 설명해야 합니다.', 'error');
      return;
    }
    const res = await act('resolve_feedback', { feedbackId, status, note });
    if (!res) return;
    setResolveNote(p => ({ ...p, [feedbackId]: '' }));
    notify(status === 'applied' ? '반영 완료로 표시했습니다.' : '미반영으로 표시했습니다.');
  };

  const approve = async () => {
    const res = await act('approve_stage', { stageKey, note: reviewNote });
    if (!res) return;
    setReviewNote('');
    notify(res.nextStageKey ? '승인했습니다. 다음 단계가 열렸습니다.' : '승인했습니다.');
  };

  const requestRevision = async () => {
    if (!reviewNote.trim()) {
      notify('수정 요청 사유를 적어 주세요.', 'error');
      return;
    }
    const res = await act('request_revision', {
      stageKey,
      deliverableId: current?.id || '',
      note: reviewNote,
    });
    if (!res) return;
    setReviewNote('');
    notify('수정 요청을 보냈습니다.');
  };

  const seekTo = (seconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = seconds;
    el.play().catch(() => {});
  };

  const captureCurrentTime = () => {
    const el = videoRef.current;
    if (!el) return;
    setTimecode(secondsToTimecode(el.currentTime));
  };

  // ------------------------------------------------------------------ 조각
  const FeedbackCard: React.FC<{ f: any }> = ({ f }) => {
    const st = FEEDBACK_STATUS[f.status] || { label: f.status, cls: 'bg-slate-100 text-slate-500' };
    const parsed = parseAnchor(f.anchor);
    const authorLabel =
      f.authorType === 'manager'
        ? '픽스폴리오 담당자'
        : f.authorType === 'brand'
          ? role === 'brand'
            ? '우리 의견'
            : '브랜드'
          : '인플루언서';
    // 담당자가 아직 다듬지 않은 브랜드 원문. 담당자 화면에서만 보인다.
    const needsRelay = role === 'manager' && f.authorType === 'brand' && f.status === 'open';
    const canResolve = role === 'influencer' && f.visibleToInfluencer && ['open', 'relayed'].includes(f.status);

    return (
      <div className="bg-white rounded-lg border border-slate-100 p-3">
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span className="text-[10px] font-black text-slate-600">{authorLabel}</span>
          {parsed.kind !== 'whole' && (
            <button
              type="button"
              onClick={() => parsed.kind === 'time' && seekTo(parsed.seconds)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                parsed.kind === 'time'
                  ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {parsed.label}
            </button>
          )}
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${st.cls}`}>{st.label}</span>
          <span className="text-[10px] text-slate-300 font-bold ml-auto">
            {f.createdAt ? new Date(f.createdAt).toLocaleDateString('ko-KR') : ''}
          </span>
        </div>
        <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">{f.body}</p>

        {f.resolutionNote && ['applied', 'wont_apply'].includes(f.status) && (
          <p className="text-[11px] text-slate-500 font-medium mt-1.5">
            {f.status === 'wont_apply' ? '사유' : '메모'}: {f.resolutionNote}
          </p>
        )}

        {needsRelay && (
          <div className="mt-2 border-t border-slate-100 pt-2">
            <p className="text-[10px] text-slate-400 font-bold mb-1.5">
              다듬어 전달하기 — 이대로 보내면 인플루언서가 그대로 읽습니다.
            </p>
            <textarea
              value={relayDraft[f.id] ?? f.body}
              onChange={e => setRelayDraft(p => ({ ...p, [f.id]: e.target.value }))}
              rows={3}
              className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
            />
            <div className="flex justify-end mt-1.5">
              <button
                onClick={() => relay(f.id, f.body)}
                disabled={busy}
                className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 disabled:opacity-40"
              >
                다듬어 전달
              </button>
            </div>
          </div>
        )}

        {canResolve && (
          <div className="mt-2 border-t border-slate-100 pt-2 flex flex-col gap-1.5">
            <input
              type="text"
              value={resolveNote[f.id] || ''}
              onChange={e => setResolveNote(p => ({ ...p, [f.id]: e.target.value }))}
              placeholder="처리 메모 (미반영은 사유 필수)"
              className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
            />
            <div className="flex gap-1.5 justify-end">
              <button
                onClick={() => resolve(f.id, 'applied')}
                disabled={busy}
                className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-500 disabled:opacity-40"
              >
                반영했어요
              </button>
              <button
                onClick={() => resolve(f.id, 'wont_apply')}
                disabled={busy}
                className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
              >
                어려워요
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const Composer: React.FC<{ anchorKey: string; anchor: string; placeholder: string }> = ({
    anchorKey,
    anchor,
    placeholder,
  }) => (
    <div className="mt-2 border-t border-slate-100 pt-2">
      <textarea
        value={draft[anchorKey] || ''}
        onChange={e => setDraft(p => ({ ...p, [anchorKey]: e.target.value }))}
        rows={3}
        placeholder={placeholder}
        className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-slate-400 font-medium">
          {role === 'brand' ? '담당자에게 전달됩니다' : '인플루언서에게 바로 전달됩니다'}
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={() => setOpenComposer('')}
            className="px-3 py-1 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-black hover:bg-slate-200"
          >
            취소
          </button>
          <button
            onClick={() => addFeedback(anchor, anchorKey)}
            disabled={busy || !(draft[anchorKey] || '').trim()}
            className="px-3 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 disabled:opacity-40"
          >
            의견 남기기
          </button>
        </div>
      </div>
    </div>
  );

  // ------------------------------------------------------------------ 렌더
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-bold">검수 화면을 불러오는 중...</p>
      </div>
    );
  }

  const label = TARGET_LABEL[target];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* 머리말 */}
      <div className="px-4 md:px-5 py-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-base font-black text-slate-900">{label.title}</h3>
              {current && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                    (DELIVERABLE_STATUS[current.status] || { cls: 'bg-slate-100 text-slate-500' }).cls
                  }`}
                >
                  {(DELIVERABLE_STATUS[current.status] || { label: current.status }).label}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-bold truncate">
              {data?.collab?.campaignTitle} · @{data?.collab?.creatorUsername}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-black hover:bg-slate-200 flex-shrink-0"
            >
              닫기
            </button>
          )}
        </div>

        {versions.length > 1 && (
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            <span className="text-[10px] text-slate-400 font-black">버전</span>
            {versions.map(v => (
              <button
                key={v.id}
                onClick={() => setVersionId(v.id)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-colors ${
                  current?.id === v.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                v{v.version}
              </button>
            ))}
            <span className="text-[10px] text-slate-300 font-medium ml-1">
              지난 버전도 그대로 남습니다
            </span>
          </div>
        )}
      </div>

      {message && (
        <div
          className={`mx-4 md:mx-5 mt-3 rounded-lg px-3 py-2 text-[11px] font-bold ${
            message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          {message.text}
        </div>
      )}

      {!current ? (
        <div className="p-8 text-center">
          <p className="text-sm text-slate-400 font-bold">{label.empty}</p>
          <p className="text-[11px] text-slate-400 font-medium mt-1">
            인플루언서가 제출하면 이 화면에서 장면·시점별로 의견을 남길 수 있습니다.
          </p>
        </div>
      ) : (
        <div className="p-4 md:p-5 space-y-5 bg-slate-50/60">
          {role === 'brand' && (
            <div className="bg-blue-50/70 border border-blue-100 rounded-xl px-4 py-3">
              <p className="text-[11px] text-blue-700 font-bold">
                남긴 의견은 픽스폴리오 담당자가 먼저 확인합니다.
              </p>
              <p className="text-[11px] text-blue-500 font-medium mt-0.5">
                담당자가 정리해 인플루언서에게 전달하고, 반영 여부를 다시 알려드립니다.
              </p>
            </div>
          )}

          {/* 대본 — 장면별 */}
          {target === 'script' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] text-slate-400 font-black uppercase">장면 {scenes.length}개</p>
                <p className="text-[10px] text-slate-400 font-medium">
                  {new Date(current.createdAt).toLocaleDateString('ko-KR')} 제출 · v{current.version}
                </p>
              </div>
              <div className="space-y-2.5">
                {scenes.map((scene, i) => {
                  const key = `scene-${i}`;
                  const mine = feedbackFor(p => p.kind === 'scene' && p.sceneIndex === i);
                  return (
                    <div key={key} className="bg-white rounded-xl border border-slate-100 p-3.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black text-slate-900"># {i + 1}</span>
                        <div className="flex items-center gap-2">
                          {mine.length > 0 && (
                            <span className="text-[10px] text-blue-600 font-black">의견 {mine.length}</span>
                          )}
                          {canComment && (
                            <button
                              onClick={() => setOpenComposer(openComposer === key ? '' : key)}
                              className="px-2.5 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700"
                            >
                              {openComposer === key ? '접기' : '이 장면에 의견'}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <span className="text-[10px] font-black text-slate-400 w-11 flex-shrink-0 pt-0.5">[장면]</span>
                          <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap flex-1">
                            {scene.visual || <span className="text-slate-300">비어 있음</span>}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-[10px] font-black text-slate-400 w-11 flex-shrink-0 pt-0.5">[자막]</span>
                          <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap flex-1">
                            {scene.subtitle || <span className="text-slate-300">없음</span>}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-[10px] font-black text-slate-400 w-11 flex-shrink-0 pt-0.5">[나레이션]</span>
                          <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap flex-1">
                            {scene.narration || <span className="text-slate-300">없음</span>}
                          </p>
                        </div>
                      </div>

                      {openComposer === key && canComment && (
                        <Composer
                          anchorKey={key}
                          anchor={sceneAnchor(i)}
                          placeholder={`${i + 1}번 장면에서 바꾸고 싶은 점을 적어 주세요.`}
                        />
                      )}

                      {mine.length > 0 && (
                        <div className="mt-2.5 space-y-2">
                          {mine.map(f => (
                            <FeedbackCard key={f.id} f={f} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {scenes.length === 0 && (
                  <p className="text-xs text-slate-400 font-bold text-center py-6">
                    장면 정보가 없는 제출물입니다. 아래 전체 의견으로 남겨 주세요.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 영상 — 시점별 */}
          {target === 'content' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] text-slate-400 font-black uppercase">제출된 영상</p>
                <p className="text-[10px] text-slate-400 font-medium">
                  {new Date(current.createdAt).toLocaleDateString('ko-KR')} 제출 · v{current.version}
                </p>
              </div>

              <div className="bg-white rounded-xl border border-slate-100 p-3.5">
                {isPlayableVideo(videoUrl) ? (
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    className="w-full rounded-lg bg-black max-h-[420px]"
                  />
                ) : (
                  <div className="rounded-lg bg-slate-50 border border-dashed border-slate-200 px-4 py-6 text-center">
                    <p className="text-xs text-slate-500 font-bold mb-1">
                      이 링크는 화면에서 바로 재생할 수 없습니다
                    </p>
                    <p className="text-[11px] text-slate-400 font-medium">
                      새 창에서 영상을 열어 두고, 아래에 시점을 직접 적어 의견을 남겨 주세요.
                    </p>
                  </div>
                )}

                {videoUrl && (
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-[11px] text-blue-600 font-bold hover:underline break-all"
                  >
                    {videoUrl}
                  </a>
                )}

                {current.payload?.note && (
                  <p className="text-xs text-slate-600 font-medium whitespace-pre-wrap mt-2 border-t border-slate-100 pt-2">
                    {current.payload.note}
                  </p>
                )}

                {canComment && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="text"
                        value={timecode}
                        onChange={e => setTimecode(e.target.value)}
                        placeholder="00:12"
                        className="w-24 text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 text-center focus:outline-none focus:border-blue-400"
                      />
                      {isPlayableVideo(videoUrl) && (
                        <button
                          onClick={captureCurrentTime}
                          className="px-2.5 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200"
                        >
                          현재 재생 시점
                        </button>
                      )}
                      <span className="text-[10px] text-slate-400 font-medium">
                        비워 두면 영상 전체에 대한 의견이 됩니다
                      </span>
                    </div>
                    <textarea
                      value={draft.video || ''}
                      onChange={e => setDraft(p => ({ ...p, video: e.target.value }))}
                      rows={3}
                      placeholder="이 시점에서 바꾸고 싶은 점을 적어 주세요."
                      className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
                    />
                    <div className="flex justify-end mt-1.5">
                      <button
                        onClick={addTimeFeedback}
                        disabled={busy || !(draft.video || '').trim()}
                        className="px-3.5 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 disabled:opacity-40"
                      >
                        {timecode.trim() ? `${timecode.trim()} 에 의견 남기기` : '의견 남기기'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {feedbackFor(p => p.kind === 'time').length > 0 && (
                <div className="mt-3">
                  <p className="text-[9px] text-slate-400 font-black uppercase mb-2">시점별 의견</p>
                  <div className="space-y-2">
                    {feedbackFor(p => p.kind === 'time').map(f => (
                      <FeedbackCard key={f.id} f={f} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 전체 의견 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] text-slate-400 font-black uppercase">전체 의견</p>
              {canComment && target === 'script' && (
                <button
                  onClick={() => setOpenComposer(openComposer === 'whole' ? '' : 'whole')}
                  className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200"
                >
                  {openComposer === 'whole' ? '접기' : '전체에 의견'}
                </button>
              )}
            </div>
            {openComposer === 'whole' && canComment && target === 'script' && (
              <div className="bg-white rounded-xl border border-slate-100 p-3.5 mb-2">
                <Composer
                  anchorKey="whole"
                  anchor=""
                  placeholder="대본 전체에 대한 의견을 적어 주세요."
                />
              </div>
            )}
            {feedbackFor(p => p.kind === 'whole').length === 0 ? (
              <p className="text-[11px] text-slate-400 font-medium">아직 전체 의견이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {feedbackFor(p => p.kind === 'whole').map(f => (
                  <FeedbackCard key={f.id} f={f} />
                ))}
              </div>
            )}
          </div>

          {/* 담당자 결정 */}
          {role === 'manager' && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-[9px] text-slate-400 font-black uppercase mb-2">담당자 결정</p>
              {!canDecide ? (
                <p className="text-[11px] text-slate-400 font-medium">
                  {stage
                    ? `${stage.title} 단계가 ${stage.status === 'done' ? '이미 완료됐습니다' : '검수 대기 상태가 아닙니다'}.`
                    : '이 제출물의 단계를 찾을 수 없습니다.'}
                </p>
              ) : (
                <>
                  <textarea
                    value={reviewNote}
                    onChange={e => setReviewNote(e.target.value)}
                    rows={2}
                    placeholder="검수 메모 (수정 요청은 사유 필수)"
                    className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
                  />
                  <div className="flex gap-1.5 justify-end mt-2">
                    <button
                      onClick={requestRevision}
                      disabled={busy}
                      className="px-3.5 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-[11px] font-black hover:bg-indigo-100 disabled:opacity-40"
                    >
                      수정 요청
                    </button>
                    <button
                      onClick={approve}
                      disabled={busy}
                      className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-[11px] font-black hover:bg-slate-700 disabled:opacity-40"
                    >
                      이 버전 승인
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium mt-1.5">
                    승인하면 다음 단계가 열립니다. 전달하지 않은 브랜드 의견이 남아 있으면 먼저 정리해 주세요.
                  </p>
                </>
              )}
            </div>
          )}

          {role === 'influencer' && (
            <p className="text-[11px] text-slate-400 font-medium">
              전달된 항목마다 반영 여부를 남겨 주세요. 어려운 항목은 사유를 적어 주시면 담당자가 브랜드에 설명합니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default CollabReviewRoom;
export { timecodeToSeconds };
