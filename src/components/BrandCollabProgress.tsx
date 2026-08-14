import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../services/apiService';
import { formatKoreanWon } from '../utils/formatters';
import CampaignProcessBoard from './collab/CampaignProcessBoard';
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
 * 브랜드는 캠페인을 올리고 조건을 담당자와 정리하는 데까지 관여한다. 진행 자체는
 * 다섯 단계로 굴러간다 — 콘텐츠 가이드 · 제품 배송 · 기획안 피드백 · 영상 피드백 ·
 * 업로드. 인플루언서 한 명을 열면 그 다섯 단계가 인플루언서 화면과 같은 컴포넌트
 * (CampaignProcessBoard)로 열린다. 브랜드가 기획안·영상 밑에 바로 피드백을 적고
 * 확인 완료를 누르는 자리도 그 안이다.
 *
 * 조건 · 마감 · 정산처럼 사람 사이를 조율하는 일은 여전히 담당자가 맡는다. 다만
 * "이 기획안의 이 부분을 고쳐 달라"는 말까지 담당자를 거치게 하면 무엇에 대한
 * 답인지가 옮겨 적는 사이에 사라진다. 그 한 종류만 브랜드 → 인플루언서로 바로 간다.
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

/** 세로 진행 스텝의 색. 계산식으로 만들면 Tailwind가 클래스를 찾지 못한다. */
const STEP_TONE = {
  done: { dot: 'bg-emerald-500 text-white', line: 'bg-emerald-200', title: 'text-slate-400' },
  current: { dot: 'bg-blue-600 text-white', line: 'bg-slate-200', title: 'text-slate-900' },
  pending: { dot: 'bg-slate-200 text-slate-400', line: 'bg-slate-200', title: 'text-slate-400' },
} as const;

/**
 * 브랜드가 보는 단계 묶음 — 캠페인 진행 프로세스 다섯 단계 그대로.
 *
 * 예전에는 아홉 단계(조건 · 가이드 · 대본 · 대본검수 · 콘텐츠 · 콘텐츠검수 ·
 * 업로드 · 확인 · 정산)를 브랜드용으로 다섯 줄로 접어서 보여 줬다. 이제는 진행
 * 자체가 다섯 단계라 접을 것이 없다. 예전 아홉 단계로 시작한 협업도 같은 줄에
 * 들어오도록 stageKeys 에 옛 이름을 함께 적어 둔다(보드와 같은 표).
 */
type StepKey = 'guide' | 'shipping' | 'plan' | 'video' | 'upload';

const STEPS: {
  key: StepKey;
  title: string;
  /** 이 묶음에 들어가는 협업 단계 키. 앞이 새 이름, 뒤가 예전 이름. */
  stageKeys: string[];
  /** 브랜드가 볼 것이 올라오는 줄인지. 그 줄에만 검은 버튼이 붙는다. */
  review?: boolean;
  /** 인플루언서가 아직 작업 중일 때 줄에 적는 말. */
  workingLabel?: string;
  icon: React.ReactNode;
}[] = [
  {
    key: 'guide',
    title: '콘텐츠 가이드',
    stageKeys: ['guide'],
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
    ),
  },
  {
    key: 'shipping',
    title: '제품 배송',
    stageKeys: ['shipping', 'terms'],
    review: true,
    workingLabel: '주소 입력 대기',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
    ),
  },
  {
    key: 'plan',
    title: '기획안 피드백',
    stageKeys: ['plan', 'script', 'script_review'],
    review: true,
    workingLabel: '기획안 작성 중',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
    ),
  },
  {
    key: 'video',
    title: '영상 피드백',
    stageKeys: ['video', 'content', 'content_review'],
    review: true,
    workingLabel: '영상 촬영 중',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
  },
  {
    key: 'upload',
    title: '업로드',
    stageKeys: ['upload', 'confirm', 'settlement'],
    review: true,
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
  const [guideOpen, setGuideOpen] = useState(false);

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
    await refreshDetail(collabId);
    setDetailLoading(false);
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
      const done = step.key === 'guide' ? hasGuideline : allDone;
      const state: 'done' | 'current' | 'pending' = done
        ? 'done'
        : active.length > 0 || (step.key === 'guide' && running.length > 0)
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
                  {step.key === 'guide' && hasGuideline && (
                    <button
                      onClick={() => setGuideOpen(true)}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-black text-slate-700 transition-colors"
                    >
                      작성한 가이드라인 보기
                    </button>
                  )}
                </div>
              </div>

              {step.key === 'guide' && !hasGuideline && (
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

                            {/* 볼 것이 올라온 줄에만 검은 버튼. 누르면 아래 진행사항이
                                열리고 그 단계가 펼쳐진 채로 보인다 — 피드백을 적는
                                자리가 곧 그 단계의 자리다. */}
                            {rowState === 'review' ? (
                              <button
                                onClick={() => openDetail(collab.id)}
                                className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-700 transition-colors flex-shrink-0"
                              >
                                {isOpen ? '진행사항 열림' : '확인하고 피드백'}
                              </button>
                            ) : (
                              <div className="text-right flex-shrink-0">
                                <p className="text-xs font-black text-slate-500">
                                  {step.workingLabel || collab.currentStageTitle || '진행 중'}
                                </p>
                                <p className={`text-[10px] font-bold ${(collab.daysLeft ?? 1) < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                                  {due ? `${shortDate(due)} 까지` : '마감일 미정'}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* 이미 지나간 단계도 누가 있었는지는 남긴다 — 접힌 한 줄로만. */}
              {state === 'done' && total > 0 && step.key !== 'guide' && (
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
            줄을 누르면 여기로 열린다. 안은 인플루언서가 보는 것과 같은 다섯 단계
            보드다. 예전에는 이 자리에 가이드라인 카드 · 아홉 줄 단계 · 자료함 ·
            제출물 · 의견함이 차례로 쌓여 있어서, 정작 "지금 무엇을 봐 줘야 하는지"가
            다섯 번째 스크롤에 가서야 나왔다. */}
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
              <div className="space-y-3">
                {/* 조건은 한 줄. 브랜드가 진행 중에 다시 보는 값은 보수와 업로드 마감
                    정도다. 나머지는 담당자가 정리한다. */}
                {detail.terms && (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-white border border-slate-200 px-4 py-3">
                    <div>
                      <p className="text-[10px] text-slate-400 font-black">보수</p>
                      <p className="text-xs text-slate-900 font-black">
                        {detail.terms.fee ? formatKoreanWon(detail.terms.fee) : '협의 중'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-black">업로드 마감</p>
                      <p className="text-xs text-slate-900 font-black">{detail.terms.uploadDue || '-'}</p>
                    </div>
                    <span className={`ml-auto text-[10px] font-black ${detail.terms.lockedAt ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {detail.terms.lockedAt ? '담당자 확정 조건' : '담당자가 조건 정리 중'}
                    </span>
                  </div>
                )}

                <CampaignProcessBoard
                  collabId={openId}
                  role="brand"
                  detail={detail}
                  onRefresh={async () => {
                    await refreshDetail(openId);
                    await load();
                  }}
                  onNotify={notify}
                />

                <p className="text-[10px] text-slate-400 font-bold px-1">
                  기획안 · 영상 피드백은 인플루언서에게 바로 전달됩니다. 조건 · 일정 · 정산 문의는 담당자에게 남겨 주세요.
                </p>
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
