import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService, authHeaders } from '../services/apiService';
import { formatKoreanWon, formatPhone } from '../utils/formatters';
import CampaignProcessBoard from './collab/CampaignProcessBoard';
import type { GuidelineFile } from './collab/CampaignGuidelineEditor';

/**
 * 브랜드가 보는 협업 진행 현황.
 *
 * 화면은 두 겹이다 — 진행이 확정된 인플루언서 명단이 먼저 나오고, 한 명을 누르면
 * 그 사람의 진행사항이 열린다. 한동안은 단계를 축으로 놓고(가이드 · 배송 · 기획안 …)
 * 각 단계 밑에 사람을 줄로 넣었는데, 브랜드가 이 화면에서 하는 일은 대부분 사람
 * 단위였다 — "이 사람 주소 나왔나", "이 사람 기획안 봐 줘야 하나". 단계가 축이면
 * 한 사람의 사정을 알기 위해 다섯 카드를 훑어 그 사람의 이름을 찾아야 했고, 같은
 * 이름이 카드마다 나왔다 사라졌다 해서 지금 몇 명이 진행 중인지도 세기 어려웠다.
 * 그래서 축을 사람으로 되돌리고, 단계는 줄 안의 다섯 칸 막대로 접어 넣었다.
 *
 * 가이드라인은 사람이 아니라 캠페인에 딸린 것이라 명단 위에 카드 하나로 남긴다.
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

  /**
   * 배송은 현재 단계와 무관하게 판정한다.
   *
   * 주소가 저장됐는지는 그 자체로 알 수 있는 사실인데, 예전에는 협업의 "현재 단계"가
   * 배송 줄에 와 있을 때만 이 줄에 사람이 나타났다. 가이드 확인을 아무도 누르지 않아
   * 현재 단계가 앞에 걸려 있으면, 인플루언서가 주소를 넣어도 브랜드 화면에는 아무
   * 일도 일어나지 않았다 — "입력했는데 확인이 안 된다"는 말이 여기서 나왔다.
   */
  if (step.key === 'shipping' && collab.shipping) {
    if (collab.shipping.status === 'shipped') return { state: 'done', due: '' };
    if (collab.shipping.filled) return { state: 'review', due: collab.dueDate };
  }

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
 * 줄 안 진행 막대 한 칸의 색. 계산식으로 만들면 Tailwind가 클래스를 찾지 못한다.
 *
 * 지나간 칸은 초록, 지금 브랜드가 봐 줘야 하는 칸은 검정, 인플루언서가 작업 중인
 * 칸은 파랑이다. 검정을 파랑보다 진하게 둔 것은 "내가 움직여야 하는 자리"가 명단을
 * 훑을 때 먼저 눈에 들어와야 하기 때문이다.
 */
const SEG_TONE: Record<StepState, string> = {
  done: 'bg-emerald-400',
  review: 'bg-slate-900',
  working: 'bg-blue-500',
  waiting: 'bg-slate-200',
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

  /**
   * 인플루언서 한 명이 다섯 단계 중 어디에 있는지.
   *
   * 명단의 한 줄이 곧 이 값 하나다. 지금 서 있는 칸(active)은 브랜드가 봐 줄 것이
   * 올라온 칸을 먼저 고르고, 없으면 인플루언서가 작업 중인 칸을 고른다 — 줄을 눌렀을
   * 때 열려야 하는 단계도 같은 칸이다. 취소·완료된 협업은 여기서 빼고 아래 "종료된
   * 협업"으로 보낸다. 남겨 두면 끝난 사람이 계속 진행 중으로 세어진다.
   */
  const rows = useMemo(() => {
    return collabs
      .filter(c => c.status === 'in_progress')
      .map(c => {
        const states = STEPS.map(step => ({ step, ...stepStateOf(c, step) }));
        const reviewIdx = states.findIndex(s => s.state === 'review');
        const workingIdx = states.findIndex(s => s.state === 'working');
        const pendingIdx = states.findIndex(s => s.state !== 'done');
        const activeIdx =
          reviewIdx >= 0 ? reviewIdx : workingIdx >= 0 ? workingIdx : pendingIdx >= 0 ? pendingIdx : states.length - 1;
        return {
          collab: c,
          states,
          active: states[activeIdx],
          activeIdx,
          needsReview: reviewIdx >= 0,
          doneCount: states.filter(s => s.state === 'done').length,
        };
      });
  }, [collabs]);

  /** 지금 브랜드가 손대야 하는 사람 수. 명단 맨 위에 이 숫자 하나만 적는다. */
  const reviewCount = rows.filter(r => r.needsReview).length;
  const hasGuideline = guidelineFiles.length > 0 || !!guidelineNote.trim() || !!guidelineUrl.trim();

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

  const openedCollab = collabs.find(c => c.id === openId);
  /** 열어 둔 사람의 명단 줄. 상세 머리에 "확인 필요"를 그대로 이어 보여 준다. */
  const openedRow = rows.find(r => r.collab.id === openId);

  return (
    <div className="space-y-3">
      {openId ? (
        /* ── 한 사람의 진행사항 ───────────────────────────────────────────
           명단을 옆에 남겨 두지 않고 자리를 통째로 바꾼다. 여기서 브랜드가 하는 일은
           기획안을 읽고 피드백을 쓰는 것 — 한 사람에게만 쓰는 시간이라, 다른 사람의
           줄이 옆에 계속 보이면 쓰던 문장을 놓친다. */
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => { setOpenId(''); setDetail(null); setFocusStep(''); }}
            className="inline-flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-slate-900 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            인플루언서 목록
          </button>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:p-5">
            <div className="flex items-center gap-3 mb-4">
              {imageOf(openedCollab?.creatorUsername || '') ? (
                <img
                  src={imageOf(openedCollab?.creatorUsername || '')}
                  alt=""
                  loading="lazy"
                  className="w-10 h-10 rounded-full object-cover bg-slate-100 flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-slate-100 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-900 truncate">
                  {nameOf(openedCollab?.creatorUsername || '') || `@${openedCollab?.creatorUsername || ''}`}
                </p>
                <p className="text-[11px] text-slate-400 font-bold truncate">
                  @{openedCollab?.creatorUsername || ''}
                  {openedCollab?.campaignTitle ? ` · ${openedCollab.campaignTitle}` : ''}
                </p>
              </div>
              {openedRow?.needsReview && (
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
          {/* ── 콘텐츠 가이드 ────────────────────────────────────────────────
              사람이 아니라 캠페인에 딸린 것이라 명단 위에 한 장으로 둔다. 올린 파일은
              진행 중인 모두의 첫 단계에서 그대로 열린다. 캠페인 한 건을 보고 있을
              때만 나온다 — 전체 협업 목록에서는 어느 캠페인의 가이드인지 알 수 없다. */}
          {campaignId && (
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
            <div className="px-4 md:px-5 py-4 flex items-center gap-3">
              <span className={`flex-shrink-0 ${hasGuideline ? 'text-slate-500' : 'text-slate-300'}`}>
                {STEPS[0].icon}
              </span>
              <p className="text-sm font-black text-slate-900 flex-shrink-0">콘텐츠 가이드</p>
              <span className={`text-[11px] font-bold flex-shrink-0 ${hasGuideline ? 'text-emerald-600' : 'text-slate-400'}`}>
                {hasGuideline ? '올림' : '올리기 전'}
              </span>
              {hasGuideline && (
                <button
                  onClick={() => setGuideOpen(true)}
                  className="ml-auto px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-black text-slate-700 flex-shrink-0 transition-colors"
                >
                  작성한 가이드라인 보기
                </button>
              )}
            </div>

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
          </section>
          )}

          {/* ── 진행 확정 인플루언서 명단 ──────────────────────────────────
              한 줄이 한 사람이다. 줄 안의 다섯 칸 막대가 그 사람이 어디까지 왔는지를
              말해 주고, 오른쪽 딱지가 지금 누가 움직일 차례인지를 말해 준다. 누르면
              그 사람의 진행사항이 열리되, 지금 서 있는 단계가 펼쳐진 채로 열린다. */}
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
            <div className="px-4 md:px-5 py-4 flex flex-wrap items-center gap-2">
              <p className="text-sm font-black text-slate-900">진행 확정 인플루언서 {rows.length}명</p>
              {reviewCount > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-black">
                  확인 필요 {reviewCount}명
                </span>
              )}
              {rows.length > 0 && (
                <span className="ml-auto text-[11px] text-slate-400 font-bold">
                  인플루언서를 누르면 진행사항이 열립니다
                </span>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="px-4 md:px-5 pb-6 text-xs text-slate-400 font-medium">
                담당자가 진행을 확정하면 이곳에 한 줄씩 생깁니다. 확정 전 후보는 아래 &apos;제안 진행 중&apos;에서 볼 수 있습니다.
              </p>
            ) : (
              <div className="px-2.5 md:px-3 pb-3 space-y-1.5">
                {rows.map(({ collab, states, active, activeIdx, needsReview, doneCount }) => {
                  const name = nameOf(collab.creatorUsername);
                  const image = imageOf(collab.creatorUsername);
                  const allDone = doneCount === STEPS.length;
                  const due = active.due || collab.dueDate;
                  return (
                    <div
                      key={collab.id}
                      className={`rounded-xl border transition-colors ${
                        needsReview ? 'border-slate-200 bg-white hover:border-slate-300' : 'border-transparent bg-slate-50 hover:bg-slate-100'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => openDetail(collab.id, active.step.key)}
                        className="w-full flex items-center gap-3 px-3 py-3 text-left"
                      >
                        {image ? (
                          <img src={image} alt="" loading="lazy" className="w-10 h-10 rounded-full object-cover bg-slate-100 flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-slate-100 flex-shrink-0" />
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-black text-slate-900 truncate">
                              {name || `@${collab.creatorUsername}`}
                            </p>
                            {collab.openFeedbackCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-black flex-shrink-0">
                                의견 {collab.openFeedbackCount}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 font-bold truncate">@{collab.creatorUsername}</p>

                          {/* 다섯 단계를 다섯 칸으로. 이름 밑에 붙여 두면 명단을 세로로
                              훑는 것만으로 누가 앞서 있고 누가 걸려 있는지 보인다. */}
                          <div className="mt-2 flex items-center gap-1">
                            {states.map(s => (
                              <span
                                key={s.step.key}
                                title={s.step.title}
                                className={`h-1.5 flex-1 rounded-full ${SEG_TONE[s.state]}`}
                              />
                            ))}
                          </div>
                          <p className="mt-1.5 text-[10px] font-bold text-slate-400 truncate">
                            {allDone ? '다섯 단계 모두 완료' : `${activeIdx + 1}/${STEPS.length} ${active.step.title}`}
                          </p>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-black ${
                              needsReview ? 'bg-slate-900 text-white' : allDone ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                            }`}
                          >
                            {needsReview
                              ? active.step.key === 'shipping'
                                ? '발송 대기'
                                : '확인 필요'
                              : allDone
                                ? '완료'
                                : active.step.workingLabel || collab.currentStageTitle || '진행 중'}
                          </span>
                          <p className={`text-[10px] font-bold mt-1 ${(collab.daysLeft ?? 1) < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                            {due ? `${shortDate(due)} 까지` : '마감일 미정'}
                          </p>
                        </div>

                        <svg className="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                      </button>

                      {/* 배송지는 줄을 열지 않아도 여기서 그대로 읽힌다 — 송장을 쓰는
                          사람이 원하는 것은 "이름·연락처·주소" 세 줄이 전부인데, 그걸
                          보려고 진행사항을 열게 하면 열 명이면 열 번 연다. 복사 버튼은
                          택배사 화면에 붙여 넣기 위한 것이다. */}
                      {collab.shipping?.filled && collab.shipping.status !== 'shipped' && (
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
          </section>

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

          {/* 끝난 협업(취소·완료)은 아래에 따로 둔다. 명단에서 빠져 버리면 브랜드는
              그 사람이 사라졌다고 읽는다. */}
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
