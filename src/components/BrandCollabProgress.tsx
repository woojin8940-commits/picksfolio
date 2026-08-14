import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../services/apiService';
import { formatKoreanWon } from '../utils/formatters';
import { normalizeScenes, parseAnchor } from '../utils/collabScenes';
import CollabReviewRoom from './collab/CollabReviewRoom';
import CollabSharedWorkspace from './collab/CollabSharedWorkspace';
import type { GuidelineFile } from './collab/CampaignGuidelineEditor';

/**
 * 브랜드가 보는 협업 진행 현황.
 *
 * 화면은 왼쪽 프로세스 레일 + 오른쪽 단계 카드로 짠다. 예전에는 인플루언서마다
 * 카드 하나를 접었다 폈다 했는데, 세 명만 넘어가도 "지금 우리가 무슨 단계인지"를
 * 알려면 카드를 전부 펴서 각자의 단계를 읽어야 했다. 캠페인은 사람별로 굴러가는
 * 것이 아니라 단계별로 굴러간다 — 가이드라인을 한 번 올리고, 대본을 몰아서 보고,
 * 영상을 몰아서 본다. 그래서 축을 단계로 바꾸고 사람은 그 안의 줄로 넣었다.
 *
 * 브랜드는 캠페인을 올리고 지원자에게 의견을 남기는 데까지 관여한다. 그 뒤의 진행 —
 * 조건 확정, 대본 검수, 마감 관리, 업로드 확인 — 은 담당자가 맡는다. 그래서 이 화면에
 * 단계 승인 권한은 담당자에게 두되, 브랜드는 공유된 기획안·영상 초안을 직접 확인하고
 * 자료함에서 확인 완료 또는 수정 요청을 남긴다.
 *
 * 의견을 인플루언서에게 직접 보내지 않는 것이 이 구조의 핵심이다. 브랜드 원문은 담당자만
 * 보고(visible_to_influencer=false), 담당자가 정리해 전달한다 — 그러지 않으면 중간에
 * 사람을 두는 의미가 없고, 예전처럼 브랜드가 곧 검수자가 된다.
 */

interface BrandCollabProgressProps {
  /** 특정 캠페인의 협업만 볼 때. 비우면 이 브랜드의 전체 협업. */
  campaignId?: string;
  /** 캠페인에 올려 둔 가이드라인. 첫 단계 카드가 이것을 그대로 연다. */
  guidelineFiles?: GuidelineFile[];
  guidelineNote?: string;
  guidelineUrl?: string;
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

const STAGE_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: '대기', cls: 'bg-slate-100 text-slate-400' },
  active: { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  submitted: { label: '검수 대기', cls: 'bg-amber-50 text-amber-600' },
  revision: { label: '수정중', cls: 'bg-indigo-50 text-indigo-600' },
  done: { label: '완료', cls: 'bg-emerald-50 text-emerald-600' },
  skipped: { label: '생략', cls: 'bg-slate-100 text-slate-400' },
};

const OWNER_LABEL: Record<string, string> = {
  influencer: '인플루언서',
  manager: '담당자',
  brand: '브랜드',
};

/** 세로 진행 스텝의 색. 계산식으로 만들면 Tailwind가 클래스를 찾지 못한다. */
const STEP_TONE = {
  done: { dot: 'bg-emerald-500 text-white', line: 'bg-emerald-200', title: 'text-slate-400' },
  current: { dot: 'bg-blue-600 text-white', line: 'bg-slate-200', title: 'text-slate-900' },
  pending: { dot: 'bg-slate-200 text-slate-400', line: 'bg-slate-200', title: 'text-slate-400' },
} as const;

/**
 * 브랜드가 보는 단계 묶음.
 *
 * 협업 템플릿의 단계는 아홉 개다(조건 · 가이드 · 대본 · 대본검수 · 콘텐츠 ·
 * 콘텐츠검수 · 업로드 · 확인 · 정산). 그대로 늘어놓으면 브랜드가 실제로 무언가를
 * 하는 자리(가이드라인 올리기, 대본 보기, 영상 보기, 업로드 확인)가 그 사이에
 * 묻힌다. 작성과 검수는 브랜드에게 한 덩어리다 — "대본이 도는 중"이거나 "볼
 * 차례"이거나 둘 중 하나다. 그래서 묶어서 다섯 줄로 만든다.
 */
type StepKey = 'guideline' | 'terms' | 'script' | 'content' | 'upload';

const STEPS: {
  key: StepKey;
  title: string;
  /** 이 묶음에 들어가는 협업 단계 키. */
  stageKeys: string[];
  /** 검수 화면을 여는 줄인지. 대본·영상만 해당한다. */
  review?: 'script' | 'content';
  /** 인플루언서가 아직 작업 중일 때 줄에 적는 말. */
  workingLabel?: string;
  icon: React.ReactNode;
}[] = [
  {
    key: 'guideline',
    title: '콘텐츠 가이드라인',
    stageKeys: ['guide'],
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
    ),
  },
  {
    key: 'terms',
    title: '조건 확정',
    stageKeys: ['terms'],
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
    ),
  },
  {
    key: 'script',
    title: '대본 피드백',
    stageKeys: ['script', 'script_review'],
    review: 'script',
    workingLabel: '대본 작성 중',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
    ),
  },
  {
    key: 'content',
    title: '영상 피드백',
    stageKeys: ['content', 'content_review'],
    review: 'content',
    workingLabel: '영상 촬영 중',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
  },
  {
    key: 'upload',
    title: '업로드 확인',
    stageKeys: ['upload', 'confirm', 'settlement'],
    workingLabel: '업로드 대기',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
    ),
  },
];

/** 26/03/01 꼴. 뮤즈바이처럼 짧게 — 줄 오른쪽 끝에 붙는 값이라 길면 이름을 밀어낸다. */
const shortDate = (raw: string) => {
  const key = String(raw || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  return `${key.slice(2, 4)}/${key.slice(5, 7)}/${key.slice(8, 10)}`;
};

/**
 * 협업 한 건이 이 묶음에서 어디까지 왔는지.
 *
 * 'review' 는 지금 브랜드가 볼 것이 올라와 있다는 뜻이다 — 그 줄에만 검은 버튼이
 * 붙는다. 'working' 은 인플루언서가 작업 중, 'done' 은 이 묶음을 지나간 것.
 */
type StepState = 'done' | 'review' | 'working' | 'waiting';

const stepStateOf = (collab: CollabRow, step: typeof STEPS[number]): { state: StepState; due: string } => {
  const key = collab.currentStageKey || '';
  const idx = STEPS.findIndex(s => s.stageKeys.includes(key));
  const myIdx = STEPS.findIndex(s => s.key === step.key);

  if (collab.status === 'completed') return { state: 'done', due: '' };
  // 현재 단계가 이 묶음보다 뒤에 있으면 지나간 것이다. 협업 목록 API 는 단계
  // 전체를 주지 않으므로(줄마다 아홉 줄씩 받으면 목록이 무거워진다) 현재 단계의
  // 위치로 판정한다.
  if (idx === -1) return { state: myIdx === 0 ? 'working' : 'waiting', due: collab.dueDate };
  if (myIdx < idx) return { state: 'done', due: '' };
  if (myIdx > idx) return { state: 'waiting', due: '' };

  // 같은 묶음 안. 검수 단계(script_review · content_review)이거나 제출이 올라온
  // 상태면 브랜드가 볼 차례다.
  const isReviewStage = key.endsWith('_review') || collab.currentStageStatus === 'submitted';
  return { state: step.review && isReviewStage ? 'review' : 'working', due: collab.dueDate };
};

/**
 * 브랜드가 선택만 해 둔 후보 한 줄.
 *
 * 선택('리스트에 담기' 확정)과 협업 시작 사이에는 두 단계가 더 있다 — 담당자가
 * 제안을 보내고, 인플루언서가 수락해야 협업 기록이 생긴다. 그동안 진행사항이
 * 비어 있으면 브랜드는 자기가 누른 선택이 어디로 갔는지 알 수 없어서 같은 사람을
 * 다시 고르거나 담당자에게 되묻는다. 그래서 협업이 생기기 전 구간도 한 줄로 남긴다.
 */
type PickRow = {
  id: string;
  username: string;
  name: string;
  profileImage: string;
  outreachStatus: string;
  quotedFee: number;
};

/** 제안 진행 상태를 브랜드가 읽는 말로. 내부 상태 이름은 브랜드에게 뜻이 없다. */
const OUTREACH_STEP: Record<string, { label: string; cls: string; hint: string }> = {
  not_sent: {
    label: '제안 준비 중',
    cls: 'bg-slate-100 text-slate-500',
    hint: '담당자가 조건을 정리해 제안을 보냅니다.',
  },
  sent: {
    label: '제안 발송',
    cls: 'bg-blue-50 text-blue-600',
    hint: '인플루언서의 수락을 기다리는 중입니다.',
  },
  declined: {
    label: '거절',
    cls: 'bg-red-50 text-red-500',
    hint: '담당자가 대체 후보를 다시 제안합니다.',
  },
  expired: {
    label: '응답 없음',
    cls: 'bg-slate-100 text-slate-500',
    hint: '기한 안에 답이 오지 않았습니다. 담당자가 다시 연락합니다.',
  },
};

type Snapshot = { name: string; profileImage: string };

const BrandCollabProgress: React.FC<BrandCollabProgressProps> = ({
  campaignId,
  guidelineFiles = [],
  guidelineNote = '',
  guidelineUrl = '',
  onNotify,
}) => {
  const [collabs, setCollabs] = useState<CollabRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [loading, setLoading] = useState(true);
  /** 목록을 못 불러온 이유. 예전에는 이것을 삼키고 빈 화면을 그려서, 담당자가
   *  진행을 시작한 인플루언서가 "안 나온다"는 말이 여기서 나왔다. */
  const [loadError, setLoadError] = useState('');
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackStage, setFeedbackStage] = useState('');
  const [sending, setSending] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  /** 열어 둔 검수 화면. 협업마다 따로 열리므로 협업 ID까지 같이 들고 있는다. */
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
    setLoadError(res.error || '');
    const rows: CollabRow[] = res.collabs || [];
    const mine = campaignId ? rows.filter(c => c.campaignId === campaignId) : rows;
    setCollabs(mine);

    // 선택은 했지만 아직 협업이 안 열린 후보. 캠페인 한 건을 보고 있을 때만 붙인다 —
    // 전체 협업 목록에서는 어느 캠페인의 선택인지 구분이 안 돼 줄만 늘어난다.
    if (campaignId) {
      const started = new Set(mine.map(c => String(c.creatorUsername || '').toLowerCase()));
      const listup = await apiService.getCampaignListup(campaignId);
      const candidates = (listup?.candidates || []) as any[];

      // 얼굴과 이름. 협업 목록 API 는 계정 아이디만 주는데, 브랜드가 기억하는 것은
      // 아이디가 아니라 리스트업에서 본 얼굴이다.
      const snaps: Record<string, Snapshot> = {};
      for (const c of candidates) {
        const key = String(c.snapshot?.username || c.influencerUsername || '').toLowerCase();
        if (!key) continue;
        snaps[key] = {
          name: String(c.snapshot?.name || ''),
          profileImage: String(c.snapshot?.profileImage || ''),
        };
      }
      setSnapshots(snaps);

      const waiting: PickRow[] = candidates
        .filter(c => c.brandDecision === 'pick' && c.outreachStatus !== 'accepted')
        .filter(c => !started.has(String(c.snapshot?.username || c.influencerUsername || '').toLowerCase()))
        .map(c => ({
          id: String(c.id),
          username: String(c.influencerUsername || ''),
          name: String(c.snapshot?.name || ''),
          profileImage: String(c.snapshot?.profileImage || ''),
          outreachStatus: String(c.outreachStatus || 'not_sent'),
          quotedFee: Number(c.quotedFee || 0),
        }));
      setPicks(waiting);
    } else {
      setPicks([]);
      setSnapshots({});
    }
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

  /** 단계 묶음마다: 어떤 인플루언서가 어떤 상태로 들어 있는지. */
  const steps = useMemo(() => {
    const hasGuideline = guidelineFiles.length > 0 || !!guidelineNote.trim() || !!guidelineUrl.trim();
    // 취소·완료된 협업은 단계 카드에서 빼고 아래 "종료된 협업"으로 보낸다. 남겨 두면
    // 끝난 사람이 계속 "진행중"으로 세어져 단계별 인원이 실제와 어긋난다.
    const running = collabs.filter(c => c.status === 'in_progress');
    return STEPS.map(step => {
      const rows = running.map(c => ({ collab: c, ...stepStateOf(c, step) }));
      const active = rows.filter(r => r.state === 'review' || r.state === 'working');
      const allDone = running.length > 0 && rows.every(r => r.state === 'done');
      // 가이드라인은 협업 단계보다 브랜드가 파일을 올렸는지가 먼저다. 협업이 아직
      // 없어도 올려 두었으면 완료로 본다 — 그것이 브랜드가 한 일의 전부다.
      const done = step.key === 'guideline' ? hasGuideline : allDone;
      const state: 'done' | 'current' | 'pending' = done
        ? 'done'
        : active.length > 0 || (step.key === 'guideline' && running.length > 0)
          ? 'current'
          : 'pending';
      const dues = rows.map(r => r.due).filter(Boolean).sort();
      return { step, rows, active, state, dueFrom: dues[0] || '', dueTo: dues[dues.length - 1] || '', total: running.length };
    });
  }, [collabs, guidelineFiles.length, guidelineNote, guidelineUrl]);

  const nameOf = (username: string) => snapshots[String(username || '').toLowerCase()]?.name || '';
  const imageOf = (username: string) => snapshots[String(username || '').toLowerCase()]?.profileImage || '';

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-sm text-slate-400 font-bold">협업 진행 현황을 불러오는 중...</p>
      </div>
    );
  }

  // 못 불러온 것과 아직 없는 것은 다르다. 예전에는 둘 다 "아직 없습니다"로 보여서,
  // 담당자가 진행을 시작해 둔 인플루언서가 사라진 것처럼 보였다.
  if (loadError) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm text-center">
        <p className="text-sm font-black text-slate-900">진행 현황을 불러오지 못했습니다</p>
        <p className="text-xs text-slate-400 font-medium mt-1">{loadError}</p>
        <button
          onClick={load}
          className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 transition-colors"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (collabs.length === 0 && picks.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm">
        <h3 className="text-lg font-black text-slate-900 mb-2">협업 진행 현황</h3>
        <p className="text-xs text-slate-400 font-medium">
          인플루언서 명단에서 선택을 완료하면 선택한 사람이 이곳에 한 줄씩 생기고, 담당자가 진행을
          확정하면 단계별 진행 상황과 가이드라인·자료함이 함께 표시됩니다.
        </p>
      </div>
    );
  }

  const openedCollab = collabs.find(c => c.id === openId);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[176px_minmax(0,1fr)] gap-5 md:gap-8">
      {/* ── 왼쪽 프로세스 레일 ─────────────────────────────────────────────
          지금 캠페인 전체가 어느 단계에 있는지. 사람 수를 함께 적는 이유는
          단계가 사람마다 다르게 굴러가기 때문이다 — "대본 피드백 · 진행중 2명"이
          한 줄로 그것을 말해 준다. */}
      <aside className="md:sticky md:top-4 md:self-start">
        <p className="text-xs font-black text-slate-900 mb-3">
          전체 프로세스 {collabs.length + picks.length}명
        </p>
        <div>
          {steps.map(({ step, active, state }, i) => {
            const tone = STEP_TONE[state];
            const last = i === steps.length - 1;
            return (
              <div key={step.key} className="flex gap-2.5">
                <div className="flex flex-col items-center flex-shrink-0">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black ${tone.dot}`}>
                    {state === 'done' ? '✓' : i + 1}
                  </span>
                  {!last && <span className={`w-px flex-1 my-1 ${tone.line}`} />}
                </div>
                <div className={`min-w-0 ${last ? '' : 'pb-4'}`}>
                  <p className={`text-xs font-black leading-tight ${tone.title}`}>{step.title}</p>
                  <p
                    className={`text-[10px] font-bold mt-0.5 ${
                      state === 'done' ? 'text-slate-300' : state === 'current' ? 'text-blue-600' : 'text-slate-300'
                    }`}
                  >
                    {state === 'done'
                      ? '완료'
                      : active.length > 0
                        ? `진행중 ${active.length}명`
                        : state === 'current'
                          ? '진행 대기'
                          : '진행 전'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── 오른쪽 단계 카드 ─────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        {/* 선택했지만 아직 협업이 안 열린 후보를 맨 위에 둔다. 브랜드가 방금 누른
            결과가 위에 있어야 "선택이 됐나?"를 다시 확인하러 명단으로 돌아가지 않는다. */}
        {picks.length > 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
            <p className="text-xs font-black text-slate-900 mb-2.5">제안 진행 중 {picks.length}명</p>
            <div className="space-y-1.5">
              {picks.map(p => {
                const step = OUTREACH_STEP[p.outreachStatus] || OUTREACH_STEP.not_sent;
                return (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5">
                    {p.profileImage ? (
                      <img src={p.profileImage} alt="" loading="lazy" className="w-8 h-8 rounded-full object-cover bg-slate-100 flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-slate-900 truncate">
                        {p.name || (p.username ? `@${p.username}` : '선정한 인플루언서')}
                      </p>
                      <p className="text-[10px] text-slate-400 font-bold truncate">{step.hint}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${step.cls}`}>{step.label}</span>
                      {p.quotedFee > 0 && (
                        <p className="text-[10px] text-slate-400 font-bold mt-1">{formatKoreanWon(p.quotedFee)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {steps.map(({ step, rows, active, state, dueFrom, dueTo, total }) => {
          const hasGuideline = guidelineFiles.length > 0 || !!guidelineNote.trim() || !!guidelineUrl.trim();
          const showRows = state === 'current' && active.length > 0;
          const rangeText =
            state === 'done'
              ? ''
              : dueFrom && dueTo && dueFrom !== dueTo
                ? `${shortDate(dueFrom)} ~ ${shortDate(dueTo)}`
                : dueFrom
                  ? `${shortDate(dueFrom)} 까지`
                  : '';
          return (
            <section key={step.key} className="bg-white rounded-2xl border border-slate-100 shadow-sm">
              <div className="px-4 md:px-5 py-4 flex items-center gap-3">
                <span className={`flex-shrink-0 ${state === 'pending' ? 'text-slate-300' : 'text-slate-500'}`}>
                  {step.icon}
                </span>
                <p className={`text-sm font-black flex-shrink-0 ${state === 'pending' ? 'text-slate-400' : 'text-slate-900'}`}>
                  {step.title}
                </p>
                {state === 'pending' && (
                  <span className="text-[11px] text-slate-400 font-bold flex-shrink-0">진행 전</span>
                )}
                {state === 'done' && (
                  <span className="text-[11px] text-emerald-600 font-bold flex-shrink-0">완료</span>
                )}

                <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                  {rangeText && (
                    <span className={`text-[11px] font-black ${state === 'current' ? 'text-blue-600' : 'text-slate-400'}`}>
                      {rangeText}
                    </span>
                  )}
                  {/* 가이드라인 줄에만 붙는 버튼. 브랜드가 올려 둔 파일을 그 자리에서 연다. */}
                  {step.key === 'guideline' && hasGuideline && (
                    <button
                      onClick={() => setGuideOpen(true)}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-black text-slate-700 transition-colors"
                    >
                      작성한 가이드라인 보기
                    </button>
                  )}
                </div>
              </div>

              {step.key === 'guideline' && !hasGuideline && (
                <div className="px-4 md:px-5 pb-4">
                  <p className="text-[11px] text-slate-400 font-medium">
                    화면 위쪽의 가이드라인 카드에서 파일(PDF·이미지)을 올려 주세요. 올린 파일은 진행 중인
                    인플루언서의 진행사항에서 그대로 열립니다.
                  </p>
                </div>
              )}

              {showRows && (
                <div className="px-3 md:px-4 pb-4 space-y-1.5">
                  {rows
                    .filter(r => r.state === 'review' || r.state === 'working')
                    .map(({ collab, state: rowState, due }) => {
                      const isOpen = openId === collab.id;
                      const reviewOpen = reviewFor?.collabId === collab.id;
                      const name = nameOf(collab.creatorUsername);
                      const image = imageOf(collab.creatorUsername);
                      return (
                        <div
                          key={collab.id}
                          className={`rounded-xl border transition-colors ${
                            rowState === 'review' ? 'border-slate-200 bg-white' : 'border-transparent bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => openDetail(collab.id)}
                              aria-expanded={isOpen}
                              className="flex items-center gap-3 min-w-0 flex-1 text-left"
                            >
                              {image ? (
                                <img src={image} alt="" loading="lazy" className="w-9 h-9 rounded-full object-cover bg-slate-100 flex-shrink-0" />
                              ) : (
                                <div className="w-9 h-9 rounded-full bg-slate-100 flex-shrink-0" />
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-black text-slate-900 truncate hover:text-blue-600 transition-colors">
                                  {name || `@${collab.creatorUsername}`}
                                </p>
                                <p className="text-[10px] text-slate-400 font-bold truncate">
                                  @{collab.creatorUsername}
                                  {collab.openFeedbackCount > 0 && ` · 확인 중 의견 ${collab.openFeedbackCount}`}
                                </p>
                              </div>
                            </button>

                            {rowState === 'review' && step.review ? (
                              <button
                                onClick={() =>
                                  setReviewFor(reviewOpen ? null : { collabId: collab.id, target: step.review! })
                                }
                                className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-700 transition-colors flex-shrink-0"
                              >
                                {reviewOpen ? '닫기' : step.review === 'script' ? '대본 피드백하기' : '영상 피드백하기'}
                              </button>
                            ) : (
                              <div className="text-right flex-shrink-0">
                                <p className="text-xs font-black text-slate-500">
                                  {collab.currentStageStatus === 'submitted'
                                    ? '담당자 검수 중'
                                    : step.workingLabel || collab.currentStageTitle || '진행 중'}
                                </p>
                                <p className={`text-[10px] font-bold ${(collab.daysLeft ?? 1) < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                                  {due ? `${shortDate(due)} 까지` : '마감일 미정'}
                                </p>
                              </div>
                            )}
                          </div>

                          {reviewOpen && reviewFor && (
                            <div className="px-3 pb-3">
                              <CollabReviewRoom
                                collabId={collab.id}
                                target={reviewFor.target}
                                onClose={() => setReviewFor(null)}
                                onChanged={() => {
                                  load();
                                  if (openId === collab.id) refreshDetail(collab.id);
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              {/* 이미 지나간 단계도 누가 있었는지는 남긴다 — 접힌 한 줄로만. */}
              {state === 'done' && total > 0 && step.key !== 'guideline' && (
                <div className="px-4 md:px-5 pb-4">
                  <p className="text-[11px] text-slate-400 font-bold">
                    {total}명 모두 이 단계를 지났습니다.
                  </p>
                </div>
              )}
            </section>
          );
        })}

        {/* 어느 단계에도 걸리지 않는 협업(취소·완료)은 아래에 따로 둔다. 위 카드에서
            빠져 버리면 브랜드는 그 사람이 사라졌다고 읽는다. */}
        {collabs.filter(c => c.status !== 'in_progress').length > 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-4 md:p-5">
            <p className="text-xs font-black text-slate-900 mb-2.5">종료된 협업</p>
            <div className="space-y-1.5">
              {collabs
                .filter(c => c.status !== 'in_progress')
                .map(c => (
                  <button
                    key={c.id}
                    onClick={() => openDetail(c.id)}
                    className="w-full flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100 transition-colors"
                  >
                    {imageOf(c.creatorUsername) ? (
                      <img src={imageOf(c.creatorUsername)} alt="" loading="lazy" className="w-8 h-8 rounded-full object-cover bg-slate-100 flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-slate-900 truncate">
                        {nameOf(c.creatorUsername) || `@${c.creatorUsername}`}
                      </p>
                      <p className="text-[10px] text-slate-400 font-bold truncate">{c.campaignTitle}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-black flex-shrink-0 ${
                        c.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                      }`}
                    >
                      {c.status === 'completed' ? '완료' : '취소'}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* ── 인플루언서 한 명의 진행사항 ─────────────────────────────────
            줄을 누르면 여기로 열린다. 맨 위가 가이드라인인 것은 일부러다 —
            "이 사람이 무엇을 보고 찍고 있는지"가 나머지를 읽는 전제다. */}
        {openId && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">
                  {nameOf(openedCollab?.creatorUsername || '') || `@${openedCollab?.creatorUsername || ''}`} 진행사항
                </p>
                <p className="text-[11px] text-slate-400 font-bold truncate">{openedCollab?.campaignTitle || ''}</p>
              </div>
              <button
                onClick={() => { setOpenId(''); setDetail(null); }}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-black text-slate-500 hover:bg-slate-100 flex-shrink-0 transition-colors"
              >
                닫기
              </button>
            </div>

            {detailLoading ? (
              <p className="text-xs text-slate-400 font-bold text-center py-6">불러오는 중...</p>
            ) : !detail ? (
              <p className="text-xs text-slate-400 font-bold text-center py-6">정보를 불러오지 못했습니다.</p>
            ) : (
              <div className="space-y-4">
                {/* 가이드라인 — 캠페인에 올린 파일 + 담당자가 이 인플루언서에게 맞춰
                    정리한 내용이 서버에서 이미 합쳐져 온다(detail.guideline). */}
                {(() => {
                  const g = detail.guideline || {};
                  const files: GuidelineFile[] = Array.isArray(g.files) ? g.files : [];
                  const note = String(g.note || '').trim();
                  const url = String(g.url || '').trim();
                  const guideStage = (detail.stages || []).find((s: any) => s.stageKey === 'guide');
                  const gb = guideStage
                    ? STAGE_STATUS_LABEL[guideStage.status] || { label: guideStage.status, cls: 'bg-slate-100 text-slate-500' }
                    : null;
                  return (
                    <div className="bg-white rounded-xl border border-slate-100 p-4">
                      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                        <p className="text-xs font-black text-slate-900">콘텐츠 가이드라인</p>
                        {gb && (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${gb.cls}`}>
                            {guideStage.title} · {gb.label}
                          </span>
                        )}
                      </div>
                      {files.length > 0 || note || url ? (
                        <>
                          {files.length > 0 && (
                            <div className="space-y-1.5">
                              {files.map(f => (
                                <a
                                  key={f.url}
                                  href={f.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 hover:border-blue-200 hover:bg-blue-50/40 transition-colors"
                                >
                                  <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                  <span className="min-w-0 flex-1 text-xs font-bold text-slate-800 truncate">{f.name}</span>
                                  <span className="text-[10px] font-black text-blue-600 flex-shrink-0">열기</span>
                                </a>
                              ))}
                            </div>
                          )}
                          {note && (
                            <p className={`text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed ${files.length ? 'mt-2.5' : ''}`}>
                              {note}
                            </p>
                          )}
                          {url && (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block text-xs text-blue-600 font-bold hover:underline break-all mt-2"
                            >
                              가이드 문서 열기
                            </a>
                          )}
                          <p className="text-[10px] text-slate-400 font-medium mt-2.5">
                            이 인플루언서가 보고 있는 가이드라인입니다. 고칠 내용은 아래 의견으로 남겨 주세요.
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-slate-400 font-medium">
                          아직 전달된 가이드라인이 없습니다. 화면 위쪽의 가이드라인 카드에서 파일을 올리면
                          이 자리에 바로 표시됩니다.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* 조건 */}
                {detail.terms && (
                  <div className="bg-white rounded-xl border border-slate-100 p-4">
                    <p className="text-xs font-black text-slate-900 mb-2.5">협업 조건</p>
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

                {/* 단계 — 이 사람의 아홉 단계. 왼쪽 레일이 캠페인 전체라면 이것은 한 명. */}
                <div className="bg-white rounded-xl border border-slate-100 p-4">
                  <p className="text-xs font-black text-slate-900 mb-2.5">
                    단계 {detail.stages?.length || 0}개
                  </p>
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
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black ${tone.dot}`}>
                            {state === 'done' ? '✓' : s.seq}
                          </span>
                          {!last && <span className={`w-px flex-1 my-1 ${tone.line}`} />}
                        </div>
                        <div className={`min-w-0 ${last ? '' : 'pb-3'}`}>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-xs font-black ${tone.title}`}>{s.title}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${sb.cls}`}>{sb.label}</span>
                          </div>
                          <p className={`text-[10px] font-bold mt-0.5 ${state === 'current' ? 'text-blue-600' : 'text-slate-300'}`}>
                            {s.dueDate ? `${s.dueDate} 까지` : '마감일 미정'}
                            {s.ownerRole ? ` · ${OWNER_LABEL[s.ownerRole] || s.ownerRole}` : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <CollabSharedWorkspace
                  collabId={openId}
                  role="brand"
                  detail={detail}
                  onRefresh={() => refreshDetail(openId)}
                  onNotify={notify}
                />

                {/* 제출물 */}
                {(detail.deliverables || []).length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-100 p-4">
                    <p className="text-xs font-black text-slate-900 mb-2.5">제출물</p>
                    <div className="space-y-2">
                      {detail.deliverables.map((d: any) => {
                        const scenes = normalizeScenes(d.payload?.scenes);
                        return (
                          <div key={d.id} className="rounded-lg border border-slate-100 p-3">
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
                                  onClick={() => setReviewFor({ collabId: openId, target: d.kind })}
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
                            {d.payload?.uploadUrl && (
                              <a href={d.payload.uploadUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 font-bold hover:underline break-all">
                                {d.payload.uploadUrl}
                              </a>
                            )}
                            {d.payload?.contentUrl && (
                              <a href={d.payload.contentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 font-bold hover:underline break-all">
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
                <div className="bg-white rounded-xl border border-slate-100 p-4">
                  <p className="text-xs font-black text-slate-900 mb-2.5">의견 · 피드백</p>
                  {(detail.feedbacks || []).length > 0 && (
                    <div className="space-y-2 mb-3">
                      {detail.feedbacks.map((f: any) => {
                        const anchor = parseAnchor(f.anchor);
                        const stageTitle = (detail.stages || []).find((s: any) => s.stageKey === f.stageKey)?.title;
                        return (
                          <div key={f.id} className="rounded-lg border border-slate-100 p-3">
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

                  <div className="rounded-lg border border-slate-100 p-3">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
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

      {/* 작성한 가이드라인 보기 */}
      {guideOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end md:items-center justify-center p-0 md:p-6">
          <div className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl max-h-[85vh] overflow-y-auto">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <h3 className="text-base font-black text-slate-900">작성한 가이드라인</h3>
              <button
                onClick={() => setGuideOpen(false)}
                className="text-slate-400 hover:text-slate-900 text-xs font-black transition-colors"
              >
                닫기
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {guidelineFiles.map(f => (
                <a
                  key={f.url}
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2.5 hover:border-blue-200 hover:bg-blue-50/40 transition-colors"
                >
                  <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  <span className="min-w-0 flex-1 text-xs font-bold text-slate-800 truncate">{f.name}</span>
                  <span className="text-[10px] font-black text-blue-600 flex-shrink-0">열기</span>
                </a>
              ))}
              {guidelineNote.trim() && (
                <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">{guidelineNote}</p>
              )}
              {guidelineUrl.trim() && (
                <a
                  href={guidelineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs text-blue-600 font-bold hover:underline break-all"
                >
                  가이드라인 문서 열기
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandCollabProgress;
