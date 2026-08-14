import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService, authHeaders } from '../services/apiService';
import { formatKoreanWon, formatPhone, formatCountKo } from '../utils/formatters';
import CampaignProcessBoard from './collab/CampaignProcessBoard';
import type { GuidelineFile } from './collab/CampaignGuidelineEditor';

/**
 * 브랜드가 보는 협업 진행 현황.
 *
 * 축은 단계다 — 콘텐츠 가이드 · 제품 배송 · 기획안 피드백 · 영상 피드백 · 업로드.
 * 카드 하나가 한 단계이고, 그 안에 지금 그 단계에 서 있는 인플루언서가 한 줄씩
 * 들어간다. 한동안은 축을 사람으로 두고 한 명을 눌러야 그 사람의 다섯 단계가
 * 열리게 했는데, 그러면 "지금 내가 볼 게 있는 사람이 누구인지"를 알기 위해 명단을
 * 한 명씩 열어 봐야 했다. 브랜드가 이 화면에서 하는 일은 대부분 단계 단위다 —
 * "기획안 올라온 사람 피드백 주기", "주소 나온 사람 발송하기". 그 일이 카드 하나로
 * 모여 있어야 열 명이어도 한 화면에서 끝난다.
 *
 * 줄에 붙는 얼굴과 아이디는 인스타 연동 정보에서만 온다(creator_channels). 픽스폴리오
 * 안에서 따로 꾸민 프로필을 쓰면, 인스타만 연동하고 페이지를 안 만든 사람은 회색
 * 동그라미로 남고 브랜드가 리스트업에서 보고 고른 그 계정과도 달라 보인다.
 *
 * 브랜드는 캠페인을 올리고 조건을 담당자와 정리하는 데까지 관여한다. 진행 자체는
 * 다섯 단계로 굴러간다. 줄의 버튼을 누르면 그 사람의 진행사항이 그 단계가 펼쳐진
 * 채로 열리고(CampaignProcessBoard), 기획안·영상 밑에 바로 피드백을 적는다.
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
  /** 이 화면에서 가이드 파일을 올렸을 때 상위 캠페인 상태를 갱신한다. */
  onGuidelineFilesChange?: (files: GuidelineFile[]) => void;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

type ShippingRow = {
  filled: boolean;
  status: string;
  savedAt: string | null;
  courier: string;
  trackingNumber: string;
  recipient?: string;
  phone?: string;
  postcode?: string;
  address1?: string;
  address2?: string;
  memo?: string;
};

/** 인스타 연동에서 온 인플루언서 신원. 목록 API 가 협업 줄마다 함께 싣는다. */
type CreatorChannel = {
  username: string;
  instagramHandle: string;
  instagramUrl: string;
  profileImage: string;
  connected: boolean;
  followers: number;
};

/** 다섯 칸 각각의 상태. 목록 API 가 협업 줄마다 함께 싣는다. */
type StepProgress = {
  status: string;
  title: string;
  dueDate: string;
  submitted: boolean;
  submittedAt: string | null;
  version: number;
  workStatus: string;
};

type CollabRow = {
  id: string;
  campaignId: string;
  campaignTitle: string;
  creatorUsername: string;
  /** 인스타 계정·프로필 사진. 픽스폴리오 프로필이 아니라 연동된 인스타에서 온다. */
  creator?: CreatorChannel;
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
  /** 칸마다의 단계 상태와 제출물 유무. 현재 단계만으로 추측하지 않기 위해 함께 받는다. */
  steps?: Record<string, StepProgress>;
  openFeedbackCount: number;
  uploadUrl: string;
  uploadConfirmedAt: string | null;
  confirmedAt: string | null;
  /** 목록에 함께 실려 오는 배송 요약. 줄을 열지 않아도 주소가 왔는지 알 수 있다. */
  shipping?: ShippingRow;
};

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
  /** 볼 것이 올라온 줄의 버튼 글자. 무엇을 하러 들어가는지가 버튼에 적혀 있어야 한다. */
  reviewLabel?: string;
  /** 인플루언서가 아직 작업 중일 때 줄에 적는 말. */
  workingLabel?: string;
  /** 아직 이 칸까지 오지 않은 사람의 줄에 적는 말. */
  waitingLabel?: string;
  /** 이 칸을 지나간 사람의 줄에 적는 말. */
  doneLabel?: string;
  icon: React.ReactNode;
}[] = [
  {
    key: 'guide',
    title: '콘텐츠 가이드',
    stageKeys: ['guide'],
    workingLabel: '가이드 확인 대기',
    waitingLabel: '가이드 확인 대기',
    doneLabel: '확인 완료',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
    ),
  },
  {
    key: 'shipping',
    title: '제품 배송',
    stageKeys: ['shipping', 'terms'],
    review: true,
    reviewLabel: '발송 처리하기',
    workingLabel: '주소 입력 대기',
    waitingLabel: '주소 입력 전',
    doneLabel: '발송 완료',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
    ),
  },
  {
    key: 'plan',
    title: '기획안 피드백',
    stageKeys: ['plan', 'script', 'script_review'],
    review: true,
    reviewLabel: '기획안 피드백하기',
    workingLabel: '기획안 작성 중',
    waitingLabel: '기획안 작성 전',
    doneLabel: '기획안 확정',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
    ),
  },
  {
    key: 'video',
    title: '영상 피드백',
    stageKeys: ['video', 'content', 'content_review'],
    review: true,
    reviewLabel: '영상 피드백하기',
    workingLabel: '영상 촬영 중',
    waitingLabel: '영상 촬영 전',
    doneLabel: '영상 확정',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
  },
  {
    key: 'upload',
    title: '업로드',
    stageKeys: ['upload', 'confirm', 'settlement'],
    review: true,
    reviewLabel: '업로드 확인하기',
    workingLabel: '업로드 대기',
    waitingLabel: '업로드 전',
    doneLabel: '업로드 확인 완료',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
    ),
  },
];

/** 인스타 아이콘. 아이디 옆에 붙어 "이 계정은 인스타에서 왔다"를 한 글자도 안 쓰고 말한다. */
const InstagramMark: React.FC<{ className?: string }> = ({ className = 'w-3 h-3' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

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
 * 붙는다. 'working' 은 인플루언서가 작업 중, 'done' 은 이 묶음을 지나간 것,
 * 'waiting' 은 아직 이 칸까지 오지 않은 것.
 */
type StepState = 'done' | 'review' | 'working' | 'waiting';

/**
 * 현재 단계 하나로만 판정하던 예전 방식. 목록이 칸별 상태(steps)를 싣기 전에
 * 배포된 응답을 받았을 때만 쓴다.
 */
const stepStateByCurrent = (collab: CollabRow, step: typeof STEPS[number]): { state: StepState; due: string } => {
  const key = collab.currentStageKey || '';
  const idx = STEPS.findIndex(s => s.stageKeys.includes(key));
  const myIdx = STEPS.findIndex(s => s.key === step.key);
  if (idx === -1) return { state: myIdx === 0 ? 'working' : 'waiting', due: collab.dueDate };
  if (myIdx < idx) return { state: 'done', due: '' };
  if (myIdx > idx) return { state: 'waiting', due: '' };
  const isReviewStage = key.endsWith('_review') || collab.currentStageStatus === 'submitted';
  return { state: step.review && isReviewStage ? 'review' : 'working', due: collab.dueDate };
};

/**
 * 칸 하나에서 이 사람이 지금 어디에 서 있는지.
 *
 * 판정의 근거는 그 칸의 단계 상태와 실제로 올라온 제출물이다. 예전에는 협업의
 * "현재 단계"만 보고 다섯 칸을 추측했는데, 그러면 순서를 벗어난 진행이 통째로
 * 사라졌다 — 가이드 확인을 아무도 누르지 않아 현재 단계가 첫 칸에 걸려 있으면,
 * 인플루언서가 기획안을 올려도 브랜드 화면에서는 "아직 이 단계에 온 인플루언서가
 * 없습니다"로 남았다. "입력했는데 확인이 안 된다"는 말이 여기서 나왔다.
 */
const stepStateOf = (collab: CollabRow, step: typeof STEPS[number]): { state: StepState; due: string } => {
  if (collab.status === 'completed') return { state: 'done', due: '' };

  const progress = collab.steps?.[step.key];
  const status = String(progress?.status || '');
  const stageDone = status === 'done' || status === 'skipped';
  const due = progress?.dueDate || collab.dueDate;

  if (step.key === 'shipping') {
    if (collab.shipping?.status === 'shipped' || stageDone) return { state: 'done', due: '' };
    if (collab.shipping?.filled) return { state: 'review', due };
  } else if (step.key === 'upload') {
    if (collab.uploadConfirmedAt || stageDone) return { state: 'done', due: '' };
    if (collab.uploadUrl) return { state: 'review', due };
  } else if (stageDone) {
    return { state: 'done', due: '' };
  } else if (step.review && progress?.submitted && status !== 'revision') {
    // 기획안 · 영상: 올라온 안이 있고 아직 피드백을 주지 않았으면 브랜드 차례다.
    return { state: 'review', due };
  }

  if (!progress) return stepStateByCurrent(collab, step);
  // 아직 열리지 않은 칸('pending')과 지금 사람이 서 있는 칸을 나눈다. 예전 아홉 단계
  // 협업은 이 칸에 해당하는 단계 자체가 없을 수 있어(status 가 빈 문자열) 현재 단계로 돌아간다.
  if (!status) return stepStateByCurrent(collab, step);
  return { state: status === 'pending' ? 'waiting' : 'working', due };
};

/** 줄 정렬 — 지금 손대야 하는 사람이 맨 위. 그다음이 진행 중, 대기, 지나간 사람 순. */
const STATE_ORDER: Record<StepState, number> = { review: 0, working: 1, waiting: 2, done: 3 };

/**
 * 단계 카드 머리의 색. 계산식으로 만들면 Tailwind가 클래스를 찾지 못한다.
 *
 * 지나간 단계는 초록, 지금 사람이 서 있는 단계는 검정, 아직 아무도 오지 않은 단계는
 * 회색이다. "지금 봐 줄 것이 있는 카드"가 화면을 훑을 때 먼저 눈에 들어와야 한다.
 */
const CARD_TONE = {
  done: { badge: 'bg-emerald-500 text-white', title: 'text-slate-900', icon: 'text-emerald-500' },
  current: { badge: 'bg-slate-900 text-white', title: 'text-slate-900', icon: 'text-slate-600' },
  pending: { badge: 'bg-slate-100 text-slate-400', title: 'text-slate-400', icon: 'text-slate-300' },
} as const;

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
  instagramHandle: string;
  instagramUrl: string;
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

/**
 * 리스트업에 굳어 있는 인플루언서 표시 정보.
 *
 * 얼굴과 인스타 아이디는 협업 목록이 실어 주는 연동 정보(collab.creator)가 먼저다.
 * 이 스냅샷은 그것이 아직 없는 사람(연동 전·동기화 전)에게만 쓰는 보조 자료이고,
 * 이름은 여기에만 있다.
 */
type Snapshot = { name: string; instagramHandle: string; instagramUrl: string; profileImage: string };

const BrandCollabProgress: React.FC<BrandCollabProgressProps> = ({
  campaignId,
  guidelineFiles = [],
  guidelineNote = '',
  guidelineUrl = '',
  onGuidelineFilesChange,
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
  /** 진행사항을 어느 단계로 열지. 배송 줄에서 눌렀으면 배송이 펼쳐져야 한다. */
  const [focusStep, setFocusStep] = useState<StepKey | ''>('');
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  /** 진행사항 화면에서 바로 올리는 가이드 파일. */
  const [guideUploading, setGuideUploading] = useState(false);

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

      // 이름과 (연동 정보가 아직 없을 때의) 얼굴. 협업 목록 API 는 계정 아이디와
      // 인스타 연동 정보를 주지만 사람 이름은 리스트업에만 있다.
      const snaps: Record<string, Snapshot> = {};
      for (const c of candidates) {
        const key = String(c.snapshot?.username || c.influencerUsername || '').toLowerCase();
        if (!key) continue;
        snaps[key] = {
          name: String(c.snapshot?.name || ''),
          instagramHandle: String(c.snapshot?.instagramHandle || ''),
          instagramUrl: String(c.snapshot?.instagramUrl || ''),
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
          instagramHandle: String(c.snapshot?.instagramHandle || ''),
          instagramUrl: String(c.snapshot?.instagramUrl || ''),
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

  const openDetail = async (collabId: string, step: StepKey | '' = '') => {
    if (openId === collabId) {
      // 같은 줄을 다시 눌렀을 때: 다른 단계에서 눌렀다면 그 단계로 옮겨 주고,
      // 같은 단계면 접는다.
      if (step && step !== focusStep) {
        setFocusStep(step);
        return;
      }
      setOpenId('');
      setDetail(null);
      return;
    }
    setOpenId(collabId);
    setFocusStep(step);
    setDetail(null);
    setDetailLoading(true);
    await refreshDetail(collabId);
    setDetailLoading(false);
  };

  /** 주소 한 줄. 브랜드가 택배 송장에 그대로 옮겨 적는 형태로 만든다. */
  const addressLine = (s?: ShippingRow) =>
    [s?.postcode && `(${s.postcode})`, s?.address1, s?.address2].filter(Boolean).join(' ');

  /**
   * 배송지를 택배사 화면에 붙여 넣을 수 있게 통째로 복사한다.
   *
   * 이름·연락처·주소를 각각 드래그해서 옮기다 보면 한 줄을 빠뜨린다. 세 줄을 한 번에
   * 주면 옮겨 적는 실수가 사라진다. 클립보드를 못 쓰는 브라우저에서는 조용히
   * 실패하지 않고 "직접 복사해 달라"고 알린다.
   */
  const copyShipping = async (s?: ShippingRow) => {
    const text = [s?.recipient, formatPhone(s?.phone), addressLine(s), s?.memo && `요청사항: ${s.memo}`]
      .filter(Boolean)
      .join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notify('배송지를 복사했습니다.', 'success');
    } catch {
      notify('복사에 실패했습니다. 주소를 직접 선택해 복사해 주세요.', 'error');
    }
  };

  /**
   * 배송지를 한 장의 표로 내려받는다.
   *
   * 열 명에게 보낼 때 한 줄씩 복사하면 열 번 오간다. 택배사 대량 등록은 대부분
   * 엑셀을 받으므로 CSV 로 준다. 앞의 BOM 은 엑셀이 한글을 깨뜨리지 않게 하는
   * 표식이다 — 이게 없으면 받는 사람 이름이 전부 깨져 보인다.
   */
  const downloadAddresses = () => {
    const filled = collabs.filter(c => c.status === 'in_progress' && c.shipping?.filled);
    if (filled.length === 0) return;
    const cell = (v: string) => `"${String(v || '').replace(/"/g, '""')}"`;
    const lines = [
      ['인스타 계정', '받는 분', '연락처', '우편번호', '주소', '상세주소', '요청사항'].map(cell).join(','),
      ...filled.map(c =>
        [
          identityOf(c).title,
          c.shipping?.recipient || '',
          formatPhone(c.shipping?.phone),
          c.shipping?.postcode || '',
          c.shipping?.address1 || '',
          c.shipping?.address2 || '',
          c.shipping?.memo || '',
        ].map(cell).join(','),
      ),
    ];
    const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `배송지_${filled.length}건.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * 콘텐츠 가이드 파일을 이 자리에서 바로 올린다.
   *
   * 예전에는 화면 맨 위 가이드라인 카드에서만 올릴 수 있었다. 그런데 브랜드가 가이드를
   * 올려야겠다고 생각하는 순간은 진행사항에서 "콘텐츠 가이드 · 진행 전"을 봤을 때다.
   * 그 자리에 올릴 곳이 없으면 위로 올라가 다른 카드를 찾아야 하고, 그 사이에 하려던
   * 일을 잊는다. 올린 파일은 캠페인 가이드라인에 그대로 들어가므로 두 자리가 같은
   * 것을 가리킨다.
   */
  const uploadGuideFiles = async (picked: FileList | null) => {
    if (!picked || picked.length === 0 || !campaignId) return;
    setGuideUploading(true);
    const added: GuidelineFile[] = [];
    for (const file of Array.from(picked)) {
      const url = await apiService.uploadProposalAttachment(`guideline-${campaignId}`, file);
      if (!url) {
        notify(`${file.name} 업로드에 실패했습니다.`, 'error');
        continue;
      }
      added.push({ url, name: file.name, mimeType: file.type || '', uploadedAt: new Date().toISOString() });
    }
    if (added.length === 0) {
      setGuideUploading(false);
      return;
    }
    const next = [...guidelineFiles, ...added];
    try {
      const res = await fetch('/api/campaigns', {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: campaignId, guideline_files: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        notify(err.error || '가이드 저장에 실패했습니다.', 'error');
        return;
      }
      onGuidelineFilesChange?.(next);
      notify('가이드를 올렸습니다. 진행 중인 인플루언서에게 바로 표시됩니다.');
    } catch {
      notify('가이드 저장에 실패했습니다.', 'error');
    } finally {
      setGuideUploading(false);
    }
  };

  const hasGuideline = guidelineFiles.length > 0 || !!guidelineNote.trim() || !!guidelineUrl.trim();

  /**
   * 단계 하나에 들어 있는 인플루언서들.
   *
   * 카드 하나가 이 값 하나다. 진행 중인 사람은 상태와 무관하게 모두 한 줄씩 들어간다 —
   * "3명 모두 이 단계를 지났습니다" 한 줄로 접어 두면 그 세 명이 누구인지, 누가 아직
   * 안 왔는지를 다시 어딘가에서 찾아야 한다. 대신 줄 오른쪽에 그 사람의 지금 상태를
   * 적고, 손댈 것이 있는 줄만 검은 버튼을 단다.
   *
   * 취소·완료된 협업은 여기서 빼고 아래 "종료된 협업"으로 보낸다 — 남겨 두면 끝난
   * 사람이 계속 단계마다 세어져 인원이 실제와 어긋난다. 가이드는 협업 단계보다
   * 브랜드가 파일을 올렸는지가 먼저다. 협업이 아직 없어도 올려 두었으면 완료로 본다 —
   * 그것이 이 단계에서 브랜드가 하는 일의 전부다.
   */
  const steps = useMemo(() => {
    const running = collabs.filter(c => c.status === 'in_progress');
    return STEPS.map(step => {
      const all = running
        .map(c => ({ collab: c, ...stepStateOf(c, step) }))
        .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
      const active = all.filter(r => r.state === 'review' || r.state === 'working');
      const reviewCount = all.filter(r => r.state === 'review').length;
      const doneCount = all.filter(r => r.state === 'done').length;
      const done = step.key === 'guide' ? hasGuideline : running.length > 0 && doneCount === running.length;
      const state: 'done' | 'current' | 'pending' = done
        ? 'done'
        : active.length > 0
          ? 'current'
          : 'pending';
      const dues = active.map(r => r.due).filter(Boolean).sort();
      return {
        step,
        rows: all,
        active,
        state,
        reviewCount,
        doneCount,
        total: running.length,
        dueFrom: dues[0] || '',
        dueTo: dues[dues.length - 1] || '',
      };
    });
  }, [collabs, hasGuideline]);

  /** 진행 중인 사람 수와, 그중 지금 브랜드가 손대야 하는 건수. 화면 맨 위 한 줄. */
  const runningCount = collabs.filter(c => c.status === 'in_progress').length;
  const reviewCount = steps.reduce((sum, s) => sum + s.reviewCount, 0);
  /** 배송지를 채워 둔 사람 수. 0명이면 내려받을 표가 없으니 버튼도 없다. */
  const addressCount = collabs.filter(c => c.status === 'in_progress' && c.shipping?.filled).length;

  /**
   * 줄에 그릴 인플루언서 신원.
   *
   * 얼굴과 아이디는 인스타 연동 정보(collab.creator)에서만 가져온다. 픽스폴리오
   * 프로필에서 가져오면 인스타만 연동하고 페이지를 안 만든 사람이 빈 동그라미로
   * 남고, 브랜드가 리스트업에서 보고 고른 계정과도 달라 보인다. 연동 정보가 아직
   * 없는 사람만 리스트업 스냅샷으로 되돌아간다.
   */
  const identityOf = (collab: CollabRow) => {
    const snap = snapshots[String(collab.creatorUsername || '').toLowerCase()];
    const handle = collab.creator?.instagramHandle || snap?.instagramHandle || '';
    return {
      handle,
      instagramUrl:
        collab.creator?.instagramUrl ||
        snap?.instagramUrl ||
        (handle ? `https://www.instagram.com/${handle}/` : ''),
      image: collab.creator?.profileImage || snap?.profileImage || '',
      name: snap?.name || '',
      /** 인스타 아이디가 없으면 계정 아이디로 대신한다. 빈 줄로 두면 누구인지 알 수 없다. */
      title: handle || snap?.name || `@${collab.creatorUsername}`,
      /**
       * 아랫줄은 사람 이름, 없으면 팔로워 수. 굵은 줄에 이미 아이디가 있는데 아이디를
       * 한 번 더 쓰면 두 줄이 같은 말을 한다. 둘 다 없으면 아예 안 그린다.
       */
      sub:
        snap?.name ||
        (collab.creator?.followers ? `팔로워 ${formatCountKo(collab.creator.followers)}` : ''),
    };
  };

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

  const openedCollab = collabs.find(c => c.id === openId);
  /** 열어 둔 사람의 신원. 상세에서 온 연동 정보가 있으면 그것이 가장 새 값이다. */
  const openedIdentity = openedCollab
    ? (() => {
        const base = identityOf(openedCollab);
        const live = detail?.creator;
        if (!live) return base;
        return {
          ...base,
          handle: live.instagramHandle || base.handle,
          instagramUrl: live.instagramUrl || base.instagramUrl,
          image: live.profileImage || base.image,
          title: live.instagramHandle || base.title,
        };
      })()
    : null;
  /** 열어 둔 사람이 지금 브랜드의 손을 기다리는지. 상세 머리에 그대로 이어 보여 준다. */
  const openedNeedsReview = openedCollab
    ? STEPS.some(step => stepStateOf(openedCollab, step).state === 'review')
    : false;

  return (
    <div className="space-y-3">
      {openId ? (
        /* ── 한 사람의 진행사항 ───────────────────────────────────────────
           단계 카드를 옆에 남겨 두지 않고 자리를 통째로 바꾼다. 여기서 브랜드가 하는
           일은 기획안을 읽고 피드백을 쓰는 것 — 한 사람에게만 쓰는 시간이라, 다른
           사람의 줄이 옆에 계속 보이면 쓰던 문장을 놓친다. */
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => { setOpenId(''); setDetail(null); setFocusStep(''); }}
            className="inline-flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-slate-900 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            진행사항으로 돌아가기
          </button>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:p-5">
            <div className="flex items-center gap-3 mb-4">
              {openedIdentity?.image ? (
                <img
                  src={openedIdentity.image}
                  alt=""
                  loading="lazy"
                  className="w-10 h-10 rounded-full object-cover bg-slate-100 flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-slate-100 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-900 truncate flex items-center gap-1.5">
                  {openedIdentity?.title || `@${openedCollab?.creatorUsername || ''}`}
                  {openedIdentity?.instagramUrl && (
                    <a
                      href={openedIdentity.instagramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="인스타그램 프로필 열기"
                      className="text-pink-500 hover:text-pink-600 transition-colors flex-shrink-0"
                    >
                      <InstagramMark className="w-3.5 h-3.5" />
                    </a>
                  )}
                </p>
                <p className="text-[11px] text-slate-400 font-bold truncate">
                  {openedIdentity?.sub || `@${openedCollab?.creatorUsername || ''}`}
                  {openedCollab?.campaignTitle ? ` · ${openedCollab.campaignTitle}` : ''}
                </p>
              </div>
              {openedNeedsReview && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-black flex-shrink-0">
                  확인 필요
                </span>
              )}
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
                  focusStep={focusStep}
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
        </div>
      ) : (
        <>
          {/* 지금 진행 중인 인원과, 그중 브랜드가 손대야 하는 건수. 카드를 훑기 전에
              "오늘 할 일이 있는지"부터 한 줄로 답한다. */}
          <div className="flex flex-wrap items-center gap-2 px-1">
            <p className="text-sm font-black text-slate-900">진행 확정 인플루언서 {runningCount}명</p>
            {reviewCount > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-black">
                확인 필요 {reviewCount}건
              </span>
            )}
          </div>

          {/* 아직 아무도 확정되지 않았다면 한 번만 말한다. 단계 카드마다 같은 문장을
              다섯 번 되풀이하면 화면이 비어 있다는 사실보다 문장이 먼저 읽힌다. */}
          {runningCount === 0 && (
            <p className="px-1 text-xs text-slate-400 font-medium">
              담당자가 진행을 확정하면 아래 단계에 인플루언서가 한 줄씩 들어옵니다.
              {picks.length > 0 && " 확정 전 후보는 아래 '제안 진행 중'에서 볼 수 있습니다."}
            </p>
          )}

          {/* ── 단계 카드 ────────────────────────────────────────────────────
              카드 하나가 한 단계이고, 그 안에 지금 그 단계에 서 있는 인플루언서가
              한 줄씩 들어간다. 검은 버튼이 붙은 줄이 브랜드가 움직일 자리다 —
              누르면 그 사람의 진행사항이 그 단계가 펼쳐진 채로 열린다. */}
          {steps.map(({ step, rows, active, state, reviewCount: stepReviewCount, total, dueFrom, dueTo }) => {
            const tone = CARD_TONE[state];
            const isGuide = step.key === 'guide';
            const rangeText =
              dueFrom && dueTo && dueFrom !== dueTo
                ? `${shortDate(dueFrom)} ~ ${shortDate(dueTo)}`
                : dueFrom
                  ? `${shortDate(dueFrom)} 까지`
                  : '';
            return (
              <section key={step.key} className="bg-white rounded-2xl border border-slate-100 shadow-sm">
                <div className="px-4 md:px-5 py-4 flex flex-wrap items-center gap-2">
                  <span className={`flex-shrink-0 ${tone.icon}`}>{step.icon}</span>
                  <p className={`text-sm font-black flex-shrink-0 ${tone.title}`}>{step.title}</p>
                  {isGuide ? (
                    <span className={`text-[11px] font-bold flex-shrink-0 ${hasGuideline ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {hasGuideline ? '올림' : '올리기 전'}
                    </span>
                  ) : (
                    <span
                      className={`text-[11px] font-bold flex-shrink-0 ${
                        state === 'done' ? 'text-emerald-600' : state === 'current' ? 'text-slate-500' : 'text-slate-400'
                      }`}
                    >
                      {state === 'done' ? '완료' : state === 'current' ? `진행중 ${active.length}명` : '진행 전'}
                    </span>
                  )}
                  {stepReviewCount > 0 && (
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black flex-shrink-0 ${tone.badge}`}>
                      확인 필요 {stepReviewCount}
                    </span>
                  )}

                  <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                    {rangeText && (
                      <span className={`text-[11px] font-black ${state === 'current' ? 'text-orange-500' : 'text-slate-400'}`}>
                        {rangeText}
                      </span>
                    )}
                    {/* 배송지가 한 건이라도 들어와 있으면 표로 내려받을 수 있다. 택배사에
                        대량 등록할 때 한 줄씩 복사하는 수고를 없앤다. */}
                    {step.key === 'shipping' && addressCount > 0 && (
                      <button
                        onClick={downloadAddresses}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-black text-slate-700 transition-colors"
                      >
                        주소지 일괄 다운로드
                      </button>
                    )}
                    {isGuide && hasGuideline && (
                      <button
                        onClick={() => setGuideOpen(true)}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-black text-slate-700 transition-colors"
                      >
                        작성한 가이드라인 보기
                      </button>
                    )}
                  </div>
                </div>

                {/* 가이드는 사람이 아니라 캠페인에 딸린 것이라, 파일을 올리는 자리가
                    이 카드 안에 함께 있다. 브랜드가 "콘텐츠 가이드 · 올리기 전"을 본
                    바로 그 자리에 올릴 곳이 없으면 위로 올라가 다른 카드를 찾아야 하고,
                    그 사이에 하려던 일을 잊는다. */}
                {isGuide && campaignId && (
                  <div className="px-4 md:px-5 pb-4 space-y-2">
                    {guidelineFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {guidelineFiles.map(f => (
                          <a
                            key={f.url}
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-[11px] font-black text-slate-700 max-w-full transition-colors"
                          >
                            <span className="truncate">{f.name}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    {!hasGuideline && (
                      <p className="text-[11px] text-slate-400 font-medium">
                        가이드 파일(PDF·이미지)을 여기에 올리면 진행 중인 인플루언서의 진행사항에서 그대로 열립니다.
                      </p>
                    )}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <input
                        type="file"
                        multiple
                        accept="image/*,video/*,application/pdf,.doc,.docx,.ppt,.pptx"
                        disabled={guideUploading}
                        onChange={e => { uploadGuideFiles(e.target.files); e.target.value = ''; }}
                        className="min-w-0 flex-1 text-[11px] text-slate-500 file:mr-2 file:border-0 file:rounded-lg file:bg-slate-100 file:px-3 file:py-2 file:text-[11px] file:font-black file:text-slate-700 disabled:opacity-50"
                      />
                      <span className="text-[11px] font-bold text-slate-400 flex-shrink-0">
                        {guideUploading ? '올리는 중...' : '파일을 고르면 바로 올라갑니다'}
                      </span>
                    </div>
                  </div>
                )}

                {rows.length > 0 && (
                  <div className="px-2.5 md:px-3 pb-3 space-y-1.5">
                    {rows.map(({ collab, state: rowState, due }) => {
                      const who = identityOf(collab);
                      const rowDue = due || collab.dueDate;
                      const isDone = rowState === 'done';
                      return (
                        <div
                          key={collab.id}
                          className={`rounded-xl border transition-colors ${
                            rowState === 'review'
                              ? 'border-slate-200 bg-white hover:border-slate-300'
                              : isDone
                                ? 'border-transparent bg-emerald-50/50'
                                : 'border-transparent bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => openDetail(collab.id, step.key)}
                              className="flex items-center gap-3 min-w-0 flex-1 text-left"
                            >
                              {who.image ? (
                                <img src={who.image} alt="" loading="lazy" className="w-10 h-10 rounded-full object-cover bg-slate-100 flex-shrink-0" />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-slate-100 flex-shrink-0" />
                              )}
                              <div className="min-w-0">
                                {/* 굵은 줄은 인스타 아이디다. 브랜드가 리스트업에서 보고
                                    고른 것이 그 계정이라, 같은 이름이어야 같은 사람으로 읽힌다. */}
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <p className="text-xs font-black text-slate-900 truncate">{who.title}</p>
                                  {who.instagramUrl && (
                                    <span className="text-pink-500 flex-shrink-0"><InstagramMark /></span>
                                  )}
                                  {collab.openFeedbackCount > 0 && rowState !== 'done' && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-black flex-shrink-0">
                                      의견 {collab.openFeedbackCount}
                                    </span>
                                  )}
                                </div>
                                {who.sub && (
                                  <p className="text-[10px] text-slate-400 font-bold truncate">{who.sub}</p>
                                )}
                              </div>
                            </button>

                            {/* 오른쪽은 이 사람이 지금 이 단계에서 어디에 있는지. 볼 것이
                                올라온 줄에만 검은 버튼이 붙고, 버튼 글자가 곧 그 자리에서
                                할 일이다 — "기획안 피드백하기"를 누르면 기획안이 펼쳐진다. */}
                            {rowState === 'review' ? (
                              <button
                                onClick={() => openDetail(collab.id, step.key)}
                                className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-700 transition-colors flex-shrink-0"
                              >
                                {step.reviewLabel || '확인하기'}
                              </button>
                            ) : isDone ? (
                              <div className="text-right flex-shrink-0">
                                <p className="text-xs font-black text-emerald-600">{step.doneLabel || '완료'}</p>
                              </div>
                            ) : (
                              <div className="text-right flex-shrink-0">
                                <p className={`text-xs font-black ${rowState === 'working' ? 'text-slate-500' : 'text-slate-400'}`}>
                                  {rowState === 'working'
                                    ? step.workingLabel || collab.currentStageTitle || '진행 중'
                                    : step.waitingLabel || '진행 전'}
                                </p>
                                <p className={`text-[10px] font-bold ${(collab.daysLeft ?? 1) < 0 && rowState === 'working' ? 'text-red-500' : 'text-slate-400'}`}>
                                  {rowDue ? `${shortDate(rowDue)} 까지` : '마감일 미정'}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* 배송지는 줄을 열지 않아도 여기서 그대로 읽힌다 — 송장을 쓰는
                              사람이 원하는 것은 "이름·연락처·주소" 세 줄이 전부인데, 그걸
                              보려고 진행사항을 열게 하면 열 명이면 열 번 연다. 복사 버튼은
                              택배사 화면에 붙여 넣기 위한 것이다. */}
                          {step.key === 'shipping' && collab.shipping?.filled && collab.shipping.status !== 'shipped' && (
                            <div className="mx-3 mb-3 rounded-lg bg-emerald-50/70 border border-emerald-100 px-3 py-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 space-y-0.5">
                                  <p className="text-[11px] font-black text-emerald-700">
                                    {collab.shipping.recipient || '받는 분 미입력'}
                                    {collab.shipping.phone ? ` · ${formatPhone(collab.shipping.phone)}` : ''}
                                  </p>
                                  <p className="text-[11px] font-bold text-slate-600 break-words">
                                    {addressLine(collab.shipping) || '주소 미입력'}
                                  </p>
                                  {collab.shipping.memo && (
                                    <p className="text-[10px] font-bold text-slate-400 break-words">
                                      요청사항: {collab.shipping.memo}
                                    </p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => copyShipping(collab.shipping)}
                                  className="px-2.5 py-1.5 rounded-lg bg-white border border-emerald-200 text-[10px] font-black text-emerald-700 hover:bg-emerald-100 flex-shrink-0 transition-colors"
                                >
                                  주소 복사
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 진행 확정된 사람이 아직 한 명도 없을 때만 한 마디 남긴다. 사람이
                    있으면 그 사람들의 줄이 곧 상태라, 문장을 덧붙일 자리가 없다. */}
                {total === 0 && !(isGuide && campaignId) && (
                  <p className="px-4 md:px-5 pb-4 text-[11px] text-slate-400 font-bold">
                    아직 진행이 확정된 인플루언서가 없습니다.
                  </p>
                )}
              </section>
            );
          })}

          {/* 선택은 했지만 아직 협업이 안 열린 후보. 명단 아래에 둔다 — 확정된 사람과
              같은 줄에 섞으면 누를 수 있는 줄과 없는 줄이 구분되지 않는다. */}
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
                        {/* 확정 전 후보도 위 카드와 같은 이름으로 부른다 — 인스타 아이디.
                            여기서는 이름, 위에서는 아이디로 부르면 같은 사람이 두 사람으로 읽힌다. */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-xs font-black text-slate-900 truncate">
                            {p.instagramHandle || p.name || (p.username ? `@${p.username}` : '선정한 인플루언서')}
                          </p>
                          {p.instagramHandle && (
                            <span className="text-pink-500 flex-shrink-0"><InstagramMark /></span>
                          )}
                        </div>
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

          {/* 끝난 협업(취소·완료)은 아래에 따로 둔다. 명단에서 빠져 버리면 브랜드는
              그 사람이 사라졌다고 읽는다. */}
          {collabs.filter(c => c.status !== 'in_progress').length > 0 && (
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-4 md:p-5">
              <p className="text-xs font-black text-slate-900 mb-2.5">종료된 협업</p>
              <div className="space-y-1.5">
                {collabs
                  .filter(c => c.status !== 'in_progress')
                  .map(c => {
                    const who = identityOf(c);
                    return (
                    <button
                      key={c.id}
                      onClick={() => openDetail(c.id)}
                      className="w-full flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100 transition-colors"
                    >
                      {who.image ? (
                        <img src={who.image} alt="" loading="lazy" className="w-8 h-8 rounded-full object-cover bg-slate-100 flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-slate-900 truncate">{who.title}</p>
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
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

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
