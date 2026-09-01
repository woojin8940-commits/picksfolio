import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService, authHeaders } from '../services/apiService';
import { formatKoreanWon, formatPhone, formatCountKo } from '../utils/formatters';
import BrandContactCard from './collab/BrandContactCard';
import CampaignProcessBoard from './collab/CampaignProcessBoard';
import type { GuidelineFile } from './collab/CampaignGuidelineEditor';

/**
 * 협업 진행 현황 — 단계를 가로로 늘어놓은 보드.
 *
 * 칸(열) 하나가 한 단계이고, 그 칸에 지금 서 있는 인플루언서가 카드로 들어간다.
 * 가로로 늘어놓으면 "어느 단계에 몇 명이 몰려 있는지"가 스크롤 없이 한눈에 들어오고,
 * 카드가 왼쪽에서 오른쪽으로 옮겨 가는 것이 곧 진행이다.
 *
 * 지나온 칸에는 이름이 남는다 — 카드가 아니라 '완료'가 붙은 한 줄로. 한동안은 사람이
 * 보드 전체에서 딱 한 번, 지금 서 있는 칸에만 나오게 했다. 그러면 손댈 카드는 잘
 * 보였지만, 배송을 이미 보낸 사람의 이름이 배송 칸에서 통째로 사라져서 브랜드는
 * "이 사람이 명단에서 빠졌나"를 되물었다. 앞 칸에서 찾는 것은 할 일이 아니라 "끝났나"의
 * 확인이므로, 손댈 카드와 같은 무게로 그리지 않고 아래쪽 완료 줄로 내려 둔다. 아직
 * 오지 않은 칸에는 여전히 아무것도 적지 않는다 — 그건 확인할 것이 없는 일이다.
 *
 * 칸은 다섯이다 — 제품 배송 · 기획안 · 영상 초안 · 업로드 · 진행 완료. 콘텐츠 가이드는
 * 칸이 아니다. 가이드는 사람마다 진행되는 일이 아니라 캠페인에 한 번 올려 두는
 * 파일이고, "인플루언서가 가이드를 확인했는지"를 단계로 세면 아무도 누르지 않는 확인
 * 버튼 때문에 모두가 첫 칸에 멈춰 있는 것처럼 보였다. 그래서 가이드는 보드 위쪽의
 * 파일 줄로 올라갔다.
 *
 * 맨 위 줄에는 진행 중 인원과 총 진행 예산이 함께 있다. 브랜드가 이 화면에서 가장
 * 먼저 확인하는 두 값이고, 예산은 캠페인에 적어 둔 계획이 아니라 확정된 협업들의
 * 보수를 더한 값이다 — 지금 실제로 나갈 돈이 얼마인지가 계획보다 중요하다.
 *
 * 줄에 붙는 얼굴과 아이디는 인스타 연동 정보에서만 온다(creator_channels). 픽스폴리오
 * 안에서 따로 꾸민 프로필을 쓰면, 인스타만 연동하고 페이지를 안 만든 사람은 회색
 * 동그라미로 남고 브랜드가 리스트업에서 보고 고른 그 계정과도 달라 보인다.
 *
 * 브랜드와 담당자가 같은 보드를 본다(viewer). 담당자용 진행 화면을 따로 만들지 않는
 * 이유는, 둘이 묻는 것이 같은 질문이기 때문이다 — "지금 어느 단계에 누가 서 있나".
 * 화면이 둘이면 같은 협업을 서로 다른 모양으로 보게 되고, 브랜드가 "저기 멈춰 있다"고
 * 말하는 자리를 담당자가 자기 화면에서 찾지 못한다. 다른 것은 두 가지뿐이다 — 담당자
 * 화면 맨 위에는 브랜드 담당자의 이름과 연락처가 붙고(정산을 받아야 하니 카톡·유선으로
 * 연락할 상대다), 마지막 칸의 사람별 지급 상태와 금액은 담당자에게만 남는다.
 *
 * 카드를 누르면 그 사람의 진행사항이 그 단계가 펼쳐진 채로 열리고
 * (CampaignProcessBoard), 기획안·영상 밑에 바로 피드백을 적는다. 조건 · 마감 · 정산처럼
 * 사람 사이를 조율하는 일은 여전히 담당자가 맡는다. 다만 "이 기획안의 이 부분을 고쳐
 * 달라"는 말까지 담당자를 거치게 하면 무엇에 대한 답인지가 옮겨 적는 사이에 사라진다.
 * 그 한 종류만 브랜드 → 인플루언서로 바로 간다.
 */

interface BrandCollabProgressProps {
  /**
   * 이 보드를 누가 보는가.
   *
   * 협업 목록·상세를 어느 역할로 읽을지와, 마지막 칸에 지급 정보를 그릴지가 이 값으로
   * 갈린다. 서버도 같은 값으로 응답을 좁힌다 — 브랜드 응답에는 지급 기록이 아예
   * 담기지 않는다.
   */
  viewer?: 'brand' | 'manager';
  /** 특정 캠페인의 협업만 볼 때. 비우면 이 계정(담당자면 담당 전체)의 협업. */
  campaignId?: string;
  /** 담당자 화면 맨 위 연락처 칸에 적을 브랜드명. 연락처를 못 찾았을 때의 폴백이다. */
  brandName?: string;
  /** 캠페인에 올려 둔 가이드라인. 보드 위쪽 가이드 줄이 이것을 그대로 연다. */
  guidelineFiles?: GuidelineFile[];
  guidelineNote?: string;
  guidelineUrl?: string;
  /** 이 화면에서 가이드 파일을 올렸을 때 상위 캠페인 상태를 갱신한다. */
  onGuidelineFilesChange?: (files: GuidelineFile[]) => void;
  /**
   * 캠페인 등록 때 적어 둔 집행 예산(원).
   *
   * 맨 위 줄의 총 진행 예산 옆에 견줄 값으로만 쓴다 — 확정된 보수의 합이 계획보다
   * 얼마나 남았는지가 브랜드가 다음 사람을 더 넣을지 정하는 근거다.
   */
  budgetKrw?: number;
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
  /** 인플루언서가 업로드할 때 남긴 광고 파트너십 코드. 업로드 칸이 그대로 보여 준다. */
  adCode?: string;
  uploadConfirmedAt: string | null;
  confirmedAt: string | null;
  /**
   * 확정된 보수(원)와 조건 잠금 여부. 브랜드·담당자에게만 실려 온다 — 총 진행 예산의
   * 재료다. 담당자가 조건을 아직 정리하지 않은 협업은 0원으로 온다.
   */
  fee?: number;
  feeLocked?: boolean;
  /** 목록에 함께 실려 오는 배송 요약. 줄을 열지 않아도 주소가 왔는지 알 수 있다. */
  shipping?: ShippingRow;
  /**
   * 정산 단계의 사실. 담당자 응답에만 실려 온다 — 브랜드는 개별 지급을 하지 않으므로
   * 서버가 브랜드 응답에서 이 덩어리를 비운다. 개인정보(신분증 · 계좌)는 어느 역할의
   * 목록에도 담기지 않는다.
   */
  settlement?: { submitted?: boolean; payoutDate?: string; paidAt?: string | null };
};

/**
 * 보드의 칸 — 제품 배송 · 기획안 · 영상 초안 · 업로드 · 정산.
 *
 * 콘텐츠 가이드는 칸이 아니다. 가이드는 사람마다 굴러가는 일이 아니라 캠페인에 한 번
 * 올려 두는 파일이고, "확인했는지"를 단계로 세면 아무도 누르지 않는 확인 버튼 때문에
 * 모두가 첫 칸에 멈춰 있는 것처럼 보였다. 그 자리는 보드 위쪽 파일 줄이 대신한다.
 *
 * 마지막 칸은 협업 단계가 아니다 — 네 칸을 모두 지난 사람이 서는 자리다. 업로드까지
 * 끝난 사람이 보드에서 통째로 사라지면 "이 사람은 어떻게 됐나"를 다른 탭에서 다시
 * 찾아야 한다.
 *
 * 한동안 이 칸은 '정산'이었고, 카드마다 지급 예정일과 금액, 지급 완료 배지가 브랜드에게
 * 그려졌다. 브랜드는 인플루언서에게 개별 송금을 하지 않으므로(픽스폴리오에 한 번 보낸다)
 * 그 줄은 자기 일이 아닌 일정을 인원수만큼 확인하게 만들었다. 브랜드에게는 '진행 완료'와
 * 업로드 확인 날짜만 남기고, 사람별 지급은 담당자 화면에만 둔다 — 서류를 받고 지급일을
 * 잡고 입금하는 것이 담당자의 일이다.
 *
 * stageKeys 에는 예전 아홉 단계 묶음의 이름도 함께 적어 둔다. 그 묶음으로 시작한
 * 협업은 단계 이름이 영원히 예전 것이라, 새 이름만 보면 보드에서 통째로 사라진다.
 */
type ColumnKey = 'shipping' | 'plan' | 'video' | 'upload' | 'settlement';

/**
 * 진행사항 상세 화면(CampaignProcessBoard)이 아는 단계 키.
 *
 * 보드의 칸과 거의 같지만 둘이 완전히 겹치지는 않는다 — 정산은 그 화면의 단계가
 * 아니고(업로드 칸으로 열어 준다), 가이드는 보드의 칸이 아니다.
 */
type ProcessStepKey = 'guide' | 'shipping' | 'plan' | 'video' | 'upload';

type Column = {
  key: ColumnKey;
  title: string;
  /** 이 칸에 들어가는 협업 단계 키. 앞이 새 이름, 뒤가 예전 이름. */
  stageKeys: string[];
  /** 카드를 눌렀을 때 상세에서 펼칠 단계. 마지막 칸은 업로드를 펼친다. */
  focus: ProcessStepKey;
  /** 브랜드가 볼 것이 올라오는 칸인지. 그 카드에만 검은 버튼이 붙는다. */
  review?: boolean;
  /** 볼 것이 올라온 카드의 버튼 글자. 무엇을 하러 들어가는지가 버튼에 적혀 있어야 한다. */
  reviewLabel?: string;
  /** 인플루언서가 아직 작업 중일 때 카드에 적는 말. */
  workingLabel?: string;
  /** 이 칸을 지나간 사람의 카드에 적는 말. 마지막 칸에서만 쓴다. */
  doneLabel?: string;
  /** 아무도 없는 칸에 적는 한 마디. */
  emptyLabel: string;
  /** 마지막 칸인지. 협업 단계가 아니라 "네 칸을 다 지났다"로 그린다. */
  terminal?: boolean;
  icon: React.ReactNode;
};

const COLUMNS: Column[] = [
  {
    key: 'shipping',
    title: '제품 배송',
    stageKeys: ['shipping', 'terms'],
    focus: 'shipping',
    review: true,
    reviewLabel: '발송 처리',
    workingLabel: '주소 입력 대기',
    emptyLabel: '배송을 기다리는 인플루언서가 없습니다.',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
    ),
  },
  {
    key: 'plan',
    title: '기획안',
    stageKeys: ['plan', 'script', 'script_review'],
    focus: 'plan',
    review: true,
    reviewLabel: '기획안 피드백',
    workingLabel: '기획안 작성 중',
    emptyLabel: '기획안 단계의 인플루언서가 없습니다.',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
    ),
  },
  {
    key: 'video',
    title: '영상 초안',
    stageKeys: ['video', 'content', 'content_review'],
    focus: 'video',
    review: true,
    reviewLabel: '영상 피드백',
    workingLabel: '촬영·편집 중',
    emptyLabel: '영상 초안 단계의 인플루언서가 없습니다.',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
  },
  {
    key: 'upload',
    title: '업로드',
    stageKeys: ['upload', 'confirm'],
    focus: 'upload',
    review: true,
    reviewLabel: '업로드 확인',
    workingLabel: '업로드 대기',
    emptyLabel: '업로드를 기다리는 인플루언서가 없습니다.',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
    ),
  },
  {
    key: 'settlement',
    title: '진행 완료',
    stageKeys: ['settlement'],
    focus: 'upload',
    terminal: true,
    doneLabel: '진행 완료',
    emptyLabel: '업로드 확인이 끝나면 이 칸으로 넘어옵니다.',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    ),
  },
];

/** 카드가 실제로 굴러가는 네 칸. 마지막 칸은 이 네 칸을 다 지난 사람이 서는 자리다. */
const PROCESS_COLUMNS = COLUMNS.filter(c => !c.terminal);

/** 인스타 아이콘. 아이디 옆에 붙어 "이 계정은 인스타에서 왔다"를 한 글자도 안 쓰고 말한다. */
const InstagramMark: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * 11월 20일 꼴. 보드 카드의 마감은 이 표기를 쓴다.
 *
 * 카드는 폭이 좁은 대신 한 줄에 날짜가 하나만 들어가서, 숫자만 늘어놓은 26/11/20 보다
 * "몇 월 며칠"이 바로 읽히는 편이 낫다.
 */
const korDate = (raw: string) => {
  const key = String(raw || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  return `${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일`;
};

/** 오늘까지 남은 날. 마감이 지난 카드에 붉은 테를 두르기 위한 값이다. */
const daysUntil = (raw: string): number | null => {
  const key = String(raw || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const today = new Date();
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const target = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  return Math.round((target - start) / 86400000);
};

/**
 * 줄 앞의 얼굴.
 *
 * 인스타에서 온 사진 주소는 두 가지 이유로 깨진다 — 메타가 주는 주소에 만료가
 * 걸려 있고, 참조 주소(referrer)를 붙여 부르면 막히는 경우가 있다. 깨진 <img> 는
 * 빈 사각형이나 깨짐 표시로 남아 "사진이 없는 사람"과 다르게 보이므로, 실패하면
 * 아이디 첫 글자를 넣은 회색 동그라미로 되돌린다.
 */
const CreatorAvatar: React.FC<{ src: string; label: string; size?: string }> = ({
  src,
  label,
  size = 'w-11 h-11',
}) => {
  const [failed, setFailed] = useState(false);
  const initial = String(label || '?').replace(/^@/, '').slice(0, 1).toUpperCase();
  if (!src || failed) {
    return (
      <div
        className={`${size} rounded-full bg-slate-100 flex-shrink-0 flex items-center justify-center text-sm font-black text-slate-300`}
      >
        {initial}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${size} rounded-full object-cover bg-slate-100 flex-shrink-0`}
    />
  );
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
const stepStateByCurrent = (collab: CollabRow, step: Column): { state: StepState; due: string } => {
  const key = collab.currentStageKey || '';
  const idx = PROCESS_COLUMNS.findIndex(s => s.stageKeys.includes(key));
  const myIdx = PROCESS_COLUMNS.findIndex(s => s.key === step.key);
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
const stepStateOf = (collab: CollabRow, step: Column): { state: StepState; due: string } => {
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
 * 보드 카드 하나 — 사람 한 명.
 *
 * 카드로 그려지는 것은 지금 서 있는 칸 하나뿐이고, 지나온 칸에는 같은 사람이 완료
 * 줄(doneCards)로 한 번 더 들어간다.
 */
type Card = { collab: CollabRow; state: StepState; due: string };

/**
 * 마지막 칸의 지급 상태 — 담당자 화면에만 그린다.
 *
 * 재료는 협업 목록이 함께 싣는 정산 단계의 사실(collab.settlement)이다. 브랜드 응답에는
 * 이 덩어리가 아예 없으므로, 브랜드 화면에서는 이 함수가 불리지 않는다.
 */
const payoutBadge = (collab: CollabRow): { label: string; cls: string } => {
  const info = collab.settlement || {};
  if (info.paidAt) return { label: '지급 완료', cls: 'bg-emerald-50 text-emerald-600' };
  if (String(info.payoutDate || '').trim()) return { label: '지급 예정', cls: 'bg-blue-50 text-blue-600' };
  if (info.submitted) return { label: '지급일 미정', cls: 'bg-amber-50 text-amber-600' };
  return { label: '서류 대기', cls: 'bg-slate-100 text-slate-500' };
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
  viewer = 'brand',
  campaignId,
  brandName = '',
  guidelineFiles = [],
  guidelineNote = '',
  guidelineUrl = '',
  onGuidelineFilesChange,
  budgetKrw = 0,
  onNotify,
}) => {
  /** 담당자만 하는 일(브랜드 연락처 확인)과 브랜드만 하는 일(가이드 올리기)이 갈린다. */
  const isManager = viewer === 'manager';
  const [collabs, setCollabs] = useState<CollabRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [loading, setLoading] = useState(true);
  /** 목록을 못 불러온 이유. 예전에는 이것을 삼키고 빈 화면을 그려서, 담당자가
   *  진행을 시작한 인플루언서가 "안 나온다"는 말이 여기서 나왔다. */
  const [loadError, setLoadError] = useState('');
  const [openId, setOpenId] = useState('');
  /** 진행사항을 어느 단계로 열지. 배송 줄에서 눌렀으면 배송이 펼쳐져야 한다. */
  const [focusStep, setFocusStep] = useState<ProcessStepKey | ''>('');
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
    const res = await apiService.getCollabs(viewer);
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
  }, [campaignId, viewer]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshDetail = useCallback(
    async (collabId: string) => {
      const res = await apiService.getCollabDetail(collabId, undefined, viewer);
      if (res.error) {
        notify(res.error, 'error');
        return null;
      }
      setDetail(res);
      return res;
    },
    [notify, viewer],
  );

  const openDetail = async (collabId: string, step: ProcessStepKey | '' = '') => {
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
   * 보드 — 칸마다 그 칸에 서 있는 사람들.
   *
   * 사람 한 명이 카드 하나다. 그 카드가 놓이는 칸은 **아직 끝나지 않은 첫 칸**이고,
   * 칸에 쌓인 카드 수가 곧 "어디에서 막혀 있는지"다. 예전에는 다섯 단계를 위아래로
   * 쌓고 칸마다 관련된 사람을 모두 같은 무게로 넣었는데, 그러면 한 사람이 화면에
   * 다섯 번 나오고 그중 넷은 지금 할 일이 아니라, 정작 손댈 카드가 그 사이에 묻혔다.
   *
   * 그래서 지나온 칸에는 카드 대신 완료 줄만 남긴다(doneCards). 칸의 숫자는 여전히
   * "지금 여기 몇 명"이고, 완료한 사람 수는 그 옆에 따로 적는다. 아직 오지 않은 칸에는
   * 아무것도 넣지 않는다 — 대기는 확인할 것이 없고, 넣으면 다섯 번 나오던 화면으로
   * 되돌아간다.
   *
   * 네 칸을 모두 지난 사람과 완료된 협업은 마지막 칸으로 간다. 업로드 확인까지 끝난
   * 사람이 보드에서 사라지면 "이 사람은 어떻게 됐나"를 다른 탭에서 다시 찾아야 한다.
   * 취소된 협업만 보드에서 빠져 아래 목록으로 내려간다.
   */
  const board = useMemo(() => {
    const buckets: Record<ColumnKey, Card[]> = { shipping: [], plan: [], video: [], upload: [], settlement: [] };
    /** 칸을 이미 지나간 사람들. 카드가 아니라 한 줄짜리 완료 명단으로 그린다. */
    const passed: Record<ColumnKey, Card[]> = { shipping: [], plan: [], video: [], upload: [], settlement: [] };

    for (const collab of collabs) {
      if (collab.status !== 'in_progress' && collab.status !== 'completed') continue;
      const states = PROCESS_COLUMNS.map(column => ({ column, ...stepStateOf(collab, column) }));
      // 완료된 협업은 단계를 볼 것도 없이 마지막 칸이다.
      const placed = collab.status === 'completed' ? null : states.find(r => r.state !== 'done') || null;
      if (!placed) {
        buckets.settlement.push({ collab, state: 'done', due: '' });
      } else {
        buckets[placed.column.key].push({ collab, state: placed.state, due: placed.due });
      }
      // 지나온 칸에도 이름을 남긴다. 지금 서 있는 칸에만 나오게 하면, 브랜드는 배송을
      // 이미 보낸 사람의 이름이 배송 칸에서 사라진 것을 "빠졌다"로 읽는다. 앞 칸에서
      // 찾는 것은 손댈 일이 아니라 "이 사람 배송은 끝났나"의 확인이므로, 카드가 아니라
      // 완료 표시가 붙은 한 줄로 둔다.
      for (const r of states) {
        if (r.state !== 'done') continue;
        if (placed && r.column.key === placed.column.key) continue;
        passed[r.column.key].push({ collab, state: 'done', due: '' });
      }
    }

    return COLUMNS.map(column => {
      const cards = buckets[column.key].sort((a, b) => {
        const order = STATE_ORDER[a.state] - STATE_ORDER[b.state];
        // 같은 상태면 마감이 급한 사람이 위로. 마감이 없는 카드는 맨 아래.
        if (order !== 0) return order;
        return (a.due || '9999').localeCompare(b.due || '9999');
      });
      return {
        column,
        cards,
        /** 이 칸을 지나간 사람들. 칸의 숫자에는 세지 않는다 — 그 숫자는 "지금 여기 몇 명"이다. */
        doneCards: passed[column.key],
        reviewCount: cards.filter(c => c.state === 'review').length,
      };
    });
  }, [collabs]);

  /** 진행 중인 사람 수와, 그중 지금 브랜드가 손대야 하는 건수. 화면 맨 위 한 줄. */
  const runningCount = collabs.filter(c => c.status === 'in_progress').length;
  const reviewCount = board.reduce((sum, c) => sum + c.reviewCount, 0);
  /** 배송지를 채워 둔 사람 수. 0명이면 내려받을 표가 없으니 버튼도 없다. */
  const addressCount = collabs.filter(c => c.status === 'in_progress' && c.shipping?.filled).length;

  /**
   * 총 진행 예산 — 확정된 보수의 합.
   *
   * 캠페인에 적어 둔 집행 예산이 아니라, 지금 진행 중·완료된 협업들의 확정 보수를
   * 더한 값이다. 예산은 등록할 때 세운 계획이고 브랜드가 진행 중에 알고 싶은 것은
   * "지금 확정된 사람들에게 나갈 돈이 얼마인가"다. 취소된 협업은 세지 않는다.
   *
   * 담당자가 아직 조건을 잠그지 않은 협업은 보수가 0원으로 오므로 합계에서 빠진다.
   * 그 사람 수를 함께 세어 옆에 적어 둔다 — 안 그러면 합계가 실제보다 작은 이유를
   * 화면에서 알 수 없다.
   */
  const feeRows = collabs.filter(c => c.status === 'in_progress' || c.status === 'completed');
  /** 보드의 어느 칸에도 속하지 않는 협업(취소 등). 보드 아래 목록에만 남는다. */
  const cancelledCollabs = collabs.filter(c => c.status !== 'in_progress' && c.status !== 'completed');
  const totalFee = feeRows.reduce((sum, c) => sum + Number(c.fee || 0), 0);
  const pendingFeeCount = feeRows.filter(c => !Number(c.fee || 0)).length;

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
    ? PROCESS_COLUMNS.some(column => stepStateOf(openedCollab, column).state === 'review')
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
                <p className="text-xs text-slate-400 font-bold truncate">
                  {openedIdentity?.sub || `@${openedCollab?.creatorUsername || ''}`}
                  {openedCollab?.campaignTitle ? ` · ${openedCollab.campaignTitle}` : ''}
                </p>
              </div>
              {openedNeedsReview && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-black flex-shrink-0">
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
                      <p className="text-[11px] text-slate-400 font-black">보수</p>
                      <p className="text-sm text-slate-900 font-black">
                        {detail.terms.fee ? formatKoreanWon(detail.terms.fee) : '협의 중'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400 font-black">업로드 마감</p>
                      <p className="text-sm text-slate-900 font-black">{detail.terms.uploadDue || '-'}</p>
                    </div>
                    <span className={`ml-auto text-[11px] font-black ${detail.terms.lockedAt ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {detail.terms.lockedAt ? '담당자 확정 조건' : '담당자가 조건 정리 중'}
                    </span>
                  </div>
                )}

                {/* 들어온 칸의 단계 하나만 그린다. "기획안" 칸에서 눌러 들어왔으면 이
                    화면에서 할 일은 그 기획안을 읽고 피드백을 쓰는 것 하나이고, 배송과
                    업로드 줄이 위아래에 남아 있으면 읽던 자리를 매번 다시 찾는다.
                    지난 단계는 보드 안의 "전체 단계 보기"로 되돌아온다. */}
                <CampaignProcessBoard
                  collabId={openId}
                  role={viewer}
                  detail={detail}
                  focusStep={focusStep}
                  onlyStep={focusStep}
                  onRefresh={async () => {
                    await refreshDetail(openId);
                    await load();
                  }}
                  onNotify={notify}
                  /* 검토를 끝냈으면 이 사람의 상세를 계속 띄워 둘 이유가 없다. 끝낸
                     화면에는 "검토 완료 · 다음 단계로 넘어갔습니다" 한 줄만 남는데,
                     그 줄을 보려고 들어온 사람은 없다 — 다음 할 일은 다른 사람의
                     다른 단계이고 그것은 진행사항 목록에 있다. 목록으로 돌려보낸다. */
                  onStepComplete={() => {
                    setOpenId('');
                    setDetail(null);
                    setFocusStep('');
                  }}
                />

                <p className="text-xs text-slate-400 font-bold px-1">
                  {isManager
                    ? '조건 · 일정 · 정산은 담당자가 정리합니다. 브랜드 의견은 단계별 피드백으로 들어옵니다.'
                    : '기획안 · 영상 피드백은 인플루언서에게 바로 전달됩니다. 조건 · 일정 · 정산 문의는 담당자에게 남겨 주세요.'}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* ── 맨 위 한 줄 ──────────────────────────────────────────────
              브랜드가 이 화면을 열고 먼저 확인하는 두 값 — 지금 몇 명이 굴러가는지,
              그 사람들에게 나갈 돈이 얼마인지. 그다음이 "오늘 내가 손댈 것이 있는지"다. */}
          {/* 담당자 화면에만 붙는 줄 — 브랜드 담당자의 이름과 연락처.
              브랜드에게서 정산금을 받아야 하고 조건 · 일정도 결국 카톡이나 유선으로
              풀리는데, 그 번호를 찾으러 캠페인 목록으로 되돌아가던 걸음을 없앤다.
              브랜드↔담당자 대화방은 만들지 않는다(서버 threads.brandSupport). */}
          {isManager && campaignId && (
            <BrandContactCard campaignId={campaignId} brandName={brandName} />
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
            <p className="text-base md:text-lg font-black text-slate-900">
              진행 중 인플루언서 {runningCount}명
            </p>
            <span className="text-slate-300 font-black">·</span>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="text-base md:text-lg font-black text-slate-900">
                총 진행 예산 {formatKoreanWon(totalFee) || '0원'}
              </p>
              {budgetKrw > 0 && (
                <span className="text-xs font-bold text-slate-400">
                  집행 예산 {formatKoreanWon(budgetKrw)} 중
                </span>
              )}
              {pendingFeeCount > 0 && (
                <span className="text-xs font-bold text-amber-600">
                  조건 정리 중 {pendingFeeCount}명 제외
                </span>
              )}
            </div>
            {reviewCount > 0 && (
              <span className="px-2.5 py-1 rounded-md bg-slate-900 text-white text-[11px] font-black">
                확인 필요 {reviewCount}건
              </span>
            )}
            {addressCount > 0 && (
              <button
                onClick={downloadAddresses}
                className="ml-auto px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-black text-slate-700 transition-colors flex-shrink-0"
              >
                주소지 일괄 다운로드 {addressCount}건
              </button>
            )}
          </div>

          {/* ── 콘텐츠 가이드 ────────────────────────────────────────────
              가이드는 칸이 아니라 이 줄이다. 사람마다 굴러가는 일이 아니라 캠페인에 한
              번 올려 두는 파일이고, "인플루언서가 확인했는지"를 단계로 세면 아무도 누르지
              않는 확인 버튼 때문에 모두가 첫 칸에 멈춰 있는 것처럼 보였다. 올린 파일은
              진행 중인 인플루언서의 진행사항에서 그대로 열린다. */}
          {campaignId && (
            <section className="rounded-2xl border border-slate-100 bg-white shadow-sm px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className={`flex-shrink-0 ${hasGuideline ? 'text-emerald-500' : 'text-slate-300'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </span>
                <p className="text-sm font-black text-slate-900 flex-shrink-0">콘텐츠 가이드</p>
                <span className={`text-xs font-bold flex-shrink-0 ${hasGuideline ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {hasGuideline ? `올림 ${guidelineFiles.length > 0 ? `${guidelineFiles.length}개` : ''}`.trim() : '올리기 전'}
                </span>
                {guidelineFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    {guidelineFiles.map(f => (
                      <a
                        key={f.url}
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-xs font-black text-slate-700 max-w-[200px] transition-colors"
                      >
                        <span className="truncate">{f.name}</span>
                      </a>
                    ))}
                  </div>
                )}
                <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                  {/* 가이드는 캠페인을 등록한 브랜드가 올린다. 담당자에게는 올리기 칸을
                      두지 않는다 — 캠페인 저장은 소유 브랜드 권한이라 눌러도 막히고,
                      담당자가 여기서 할 일은 올라온 파일을 여는 것이다. */}
                  {!isManager && (
                    <input
                      type="file"
                      multiple
                      accept="image/*,video/*,application/pdf,.doc,.docx,.ppt,.pptx"
                      disabled={guideUploading}
                      onChange={e => { uploadGuideFiles(e.target.files); e.target.value = ''; }}
                      className="max-w-[210px] text-xs text-slate-500 file:mr-2 file:border-0 file:rounded-lg file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-black file:text-slate-700 disabled:opacity-50"
                    />
                  )}
                  {guideUploading && <span className="text-xs font-bold text-slate-400">올리는 중...</span>}
                  {hasGuideline && (
                    <button
                      onClick={() => setGuideOpen(true)}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-black text-slate-700 transition-colors"
                    >
                      가이드라인 보기
                    </button>
                  )}
                </div>
              </div>
              {!hasGuideline && (
                <p className="text-xs text-slate-400 font-medium mt-2">
                  {isManager
                    ? '브랜드가 아직 가이드 파일을 올리지 않았습니다. 올라오면 진행 중인 인플루언서가 자기 진행사항에서 바로 엽니다.'
                    : '가이드 파일(PDF·이미지)을 올려 두면 진행 중인 인플루언서가 자기 진행사항에서 바로 엽니다. 따로 확인 체크는 받지 않습니다.'}
                </p>
              )}
            </section>
          )}

          {/* 아직 아무도 확정되지 않았다면 한 번만 말한다. 칸마다 같은 문장을 다섯 번
              되풀이하면 화면이 비어 있다는 사실보다 문장이 먼저 읽힌다. */}
          {runningCount === 0 && (
            <p className="px-1 text-sm text-slate-400 font-medium">
              {isManager
                ? '진행을 확정하면 아래 보드의 제품 배송 칸에 카드가 한 장씩 들어옵니다.'
                : '담당자가 진행을 확정하면 아래 보드의 제품 배송 칸에 카드가 한 장씩 들어옵니다.'}
              {picks.length > 0 && " 확정 전 후보는 아래 '제안 진행 중'에서 볼 수 있습니다."}
            </p>
          )}

          {/* ── 보드 ─────────────────────────────────────────────────────
              칸 하나가 한 단계이고, 그 칸에 지금 서 있는 사람이 카드로 들어간다. 사람은
              보드 전체에서 한 번만 나오고, 카드가 왼쪽에서 오른쪽으로 옮겨 가는 것이 곧
              진행이다. 좁은 화면에서는 가로로 밀어 본다 — 칸을 세로로 접으면 예전의
              "한 사람이 다섯 번 나오는" 화면으로 되돌아간다. */}
          <div className="-mx-1 overflow-x-auto pb-2">
            <div className="flex gap-3 items-start px-1 min-w-max">
              {board.map(({ column, cards, doneCards, reviewCount: colReviewCount }) => (
                <section
                  key={column.key}
                  className="w-[268px] flex-shrink-0 rounded-2xl border border-slate-100 bg-slate-50/80"
                >
                  <div className="px-3 py-2.5 flex items-center gap-2 border-b border-slate-100">
                    <span className="text-slate-400 flex-shrink-0">{column.icon}</span>
                    <p className="text-sm font-black text-slate-900 flex-shrink-0">{column.title}</p>
                    <span className="px-1.5 py-0.5 rounded-md bg-white text-[11px] font-black text-slate-500 flex-shrink-0">
                      {cards.length}
                    </span>
                    {/* 지나간 사람 수는 칸의 숫자와 따로 적는다. 둘을 더해 하나로 적으면
                        "지금 여기 몇 명이 걸려 있나"를 알 수 없다. */}
                    {doneCards.length > 0 && (
                      <span className="text-[11px] font-black text-emerald-600 flex-shrink-0">
                        완료 {doneCards.length}
                      </span>
                    )}
                    {colReviewCount > 0 && (
                      <span className="ml-auto px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-black flex-shrink-0">
                        확인 {colReviewCount}
                      </span>
                    )}
                  </div>

                  {/* 세로로도 밀어 본다. 한 칸에 열 명이 몰리면 칸이 화면보다 길어져서
                      옆 칸의 머리글까지 아래로 밀려나고, 보드 전체를 스크롤해야 다음 칸의
                      카드를 볼 수 있었다. 칸 안에서 접히면 머리글 줄은 항상 제자리에 있다. */}
                  <div className="p-2 space-y-2 max-h-[520px] overflow-y-auto overscroll-contain">
                    {cards.length === 0 && doneCards.length === 0 ? (
                      <p className="px-1.5 py-4 text-[11px] text-slate-400 font-bold leading-relaxed">
                        {column.emptyLabel}
                      </p>
                    ) : (
                      cards.map(({ collab, state: cardState, due }) => {
                        const who = identityOf(collab);
                        const cardDue = due || collab.dueDate;
                        const left = daysUntil(cardDue);
                        /* 마감이 지났거나 이틀 안이면 붉은 테, 닷새 안이면 노란 테.
                           카드가 수십 장 늘어서 있어도 손이 급한 것이 먼저 눈에 들어와야
                           한다. 마지막 칸과 다 끝난 카드에는 급할 마감이 없다. */
                        const urgency =
                          column.terminal || cardState === 'done' || left === null
                            ? ''
                            : left < 0
                              ? 'over'
                              : left <= 2
                                ? 'soon'
                                : left <= 5
                                  ? 'near'
                                  : '';
                        const frame =
                          urgency === 'over' || urgency === 'soon'
                            ? 'border-red-200'
                            : urgency === 'near'
                              ? 'border-amber-200'
                              : 'border-slate-200/70';
                        /* 사람별 지급 상태는 담당자 화면에만. 브랜드는 이 칸에서
                           "업로드 확인까지 끝났다"만 확인한다. */
                        const badge = column.terminal && isManager ? payoutBadge(collab) : null;
                        return (
                          <div key={collab.id} className={`rounded-xl border bg-white ${frame}`}>
                            <button
                              type="button"
                              onClick={() => openDetail(collab.id, column.focus)}
                              className="w-full text-left px-2.5 pt-2.5 pb-2"
                            >
                              <div className="flex items-center gap-2.5">
                                <CreatorAvatar src={who.image} label={who.title} size="w-9 h-9" />
                                <div className="min-w-0 flex-1">
                                  {/* 굵은 줄은 인스타 아이디다. 브랜드가 리스트업에서
                                      보고 고른 것이 그 계정이라, 같은 이름이어야 같은
                                      사람으로 읽힌다. */}
                                  <div className="flex items-center gap-1 min-w-0">
                                    <p className="text-sm font-black text-slate-900 truncate">{who.title}</p>
                                    {who.instagramUrl && (
                                      <span className="text-pink-500 flex-shrink-0"><InstagramMark className="w-3 h-3" /></span>
                                    )}
                                  </div>
                                  {who.sub && (
                                    <p className="text-[11px] text-slate-400 font-bold truncate">{who.sub}</p>
                                  )}
                                </div>
                                {collab.openFeedbackCount > 0 && cardState !== 'done' && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-black flex-shrink-0">
                                    의견 {collab.openFeedbackCount}
                                  </span>
                                )}
                              </div>

                              <div className="mt-2 flex items-center gap-1.5">
                                {column.terminal ? (
                                  <>
                                    <p className="text-[11px] font-bold text-slate-500 truncate">
                                      {isManager
                                        ? `지급 예정일 ${collab.settlement?.payoutDate || '미정'}`
                                        : collab.uploadConfirmedAt
                                          ? `업로드 확인 완료 · ${korDate(collab.uploadConfirmedAt)}`
                                          : '업로드 확인 완료'}
                                    </p>
                                    {badge && (
                                      <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-black flex-shrink-0 ${badge.cls}`}>
                                        {badge.label}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <p className={`text-[11px] font-bold ${urgency === 'over' || urgency === 'soon' ? 'text-red-500' : 'text-slate-400'}`}>
                                      {cardDue ? `마감 ${korDate(cardDue)}` : '마감일 미정'}
                                    </p>
                                    {urgency && (
                                      <span
                                        className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-black flex-shrink-0 ${
                                          urgency === 'over' || urgency === 'soon'
                                            ? 'bg-red-50 text-red-500'
                                            : 'bg-amber-50 text-amber-600'
                                        }`}
                                      >
                                        {urgency === 'over' ? `${-(left ?? 0)}일 지남` : urgency === 'soon' ? '시급' : '임박'}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>

                              {/* 업로드 칸에서는 광고 코드가 카드에 그대로 보인다 —
                                  브랜드가 이 칸에서 확인하는 것이 게시물과 그 코드다.
                                  코드는 인플루언서가 업로드할 때 함께 넣으므로, 게시물이
                                  올라왔는데 코드가 비어 있으면 그것을 대기로 적는다. */}
                              {column.key === 'upload' && (collab.adCode || collab.uploadUrl) && (
                                <p
                                  className={`mt-1.5 text-[11px] font-black truncate ${
                                    collab.adCode ? 'text-slate-600' : 'text-amber-600'
                                  }`}
                                >
                                  {collab.adCode ? `광고 코드 ${collab.adCode}` : '광고 코드 대기'}
                                </p>
                              )}
                              {/* 지급 금액도 담당자 화면에만 남는다. 브랜드는 회차로
                                  묶인 일괄 정산 금액을 정산 탭에서 본다. */}
                              {column.terminal && isManager && (
                                <p className="mt-1.5 text-sm font-black text-slate-900">
                                  {Number(collab.fee || 0) > 0
                                    ? formatKoreanWon(collab.fee)
                                    : /* 담당자가 아직 조건을 정리하지 않은 협업. 0원으로
                                         그리면 지급할 것이 없는 협업으로 읽힌다. */
                                      <span className="text-amber-600">금액 조율 중</span>}
                                </p>
                              )}
                            </button>

                            {/* 지금 브랜드 차례인 카드에만 검은 버튼이 붙고, 버튼 글자가
                                곧 그 자리에서 할 일이다 — "기획안 피드백"을 누르면
                                기획안이 펼쳐진 채로 열린다. */}
                            {cardState === 'review' ? (
                              <div className="px-2.5 pb-2.5">
                                <button
                                  onClick={() => openDetail(collab.id, column.focus)}
                                  className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-black hover:bg-slate-700 transition-colors"
                                >
                                  {column.reviewLabel || '확인하기'}
                                </button>
                              </div>
                            ) : (
                              <p className="px-2.5 pb-2.5 text-[11px] font-bold text-slate-400 truncate">
                                {column.terminal
                                  ? column.doneLabel || '진행 완료'
                                  : column.workingLabel || collab.currentStageTitle || '진행 중'}
                              </p>
                            )}

                            {/* 배송지는 카드를 열지 않아도 여기서 그대로 읽힌다 — 송장을
                                쓰는 사람이 원하는 것은 "이름·연락처·주소" 세 줄이 전부인데,
                                그걸 보려고 진행사항을 열게 하면 열 명이면 열 번 연다.
                                복사 버튼은 택배사 화면에 붙여 넣기 위한 것이다. */}
                            {column.key === 'shipping' && collab.shipping?.filled && collab.shipping.status !== 'shipped' && (
                              <div className="mx-2 mb-2 rounded-lg bg-emerald-50/70 border border-emerald-100 px-2.5 py-2">
                                <p className="text-[11px] font-black text-emerald-700 break-words">
                                  {collab.shipping.recipient || '받는 분 미입력'}
                                  {collab.shipping.phone ? ` · ${formatPhone(collab.shipping.phone)}` : ''}
                                </p>
                                <p className="text-[11px] font-bold text-slate-600 break-words mt-0.5">
                                  {addressLine(collab.shipping) || '주소 미입력'}
                                </p>
                                {collab.shipping.memo && (
                                  <p className="text-[10px] font-bold text-slate-400 break-words mt-0.5">
                                    요청사항: {collab.shipping.memo}
                                  </p>
                                )}
                                <button
                                  type="button"
                                  onClick={() => copyShipping(collab.shipping)}
                                  className="mt-1.5 w-full px-2 py-1.5 rounded-lg bg-white border border-emerald-200 text-[11px] font-black text-emerald-700 hover:bg-emerald-100 transition-colors"
                                >
                                  주소 복사
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}

                    {/* ── 이 칸을 지나간 사람들 ──────────────────────────────
                        카드가 아니라 한 줄이다. 여기서 브랜드가 하는 일은 "이 사람
                        배송은 끝났나"의 확인뿐이라, 손댈 카드와 같은 크기로 그리면
                        지금 할 일이 다시 그 사이에 묻힌다. 눌러서 열 수는 있다 —
                        지난 단계의 내용을 되짚어 볼 곳이 그 화면이다. */}
                    {doneCards.length > 0 && (
                      <div className="pt-1 space-y-1">
                        <div className="flex items-center gap-1.5 px-0.5 pb-0.5">
                          <span className="h-px flex-1 bg-slate-200" />
                          <span className="text-[10px] font-black text-slate-400 flex-shrink-0">
                            완료 {doneCards.length}명
                          </span>
                          <span className="h-px flex-1 bg-slate-200" />
                        </div>
                        {doneCards.map(({ collab }) => {
                          const who = identityOf(collab);
                          return (
                            <button
                              key={collab.id}
                              type="button"
                              onClick={() => openDetail(collab.id, column.focus)}
                              className="w-full flex items-center gap-2 rounded-lg border border-slate-100 bg-white/70 px-2 py-1.5 text-left hover:bg-white transition-colors"
                            >
                              <CreatorAvatar src={who.image} label={who.title} size="w-6 h-6" />
                              <p className="min-w-0 flex-1 text-[11px] font-black text-slate-500 truncate">
                                {who.title}
                              </p>
                              <span className="flex items-center gap-0.5 text-[10px] font-black text-emerald-600 flex-shrink-0">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                                완료
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>

          {/* 선택은 했지만 아직 협업이 안 열린 후보. 명단 아래에 둔다 — 확정된 사람과
              같은 줄에 섞으면 누를 수 있는 줄과 없는 줄이 구분되지 않는다. */}
          {picks.length > 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
              <p className="text-sm font-black text-slate-900 mb-2.5">제안 진행 중 {picks.length}명</p>
              <div className="space-y-1.5">
                {picks.map(p => {
                  const step = OUTREACH_STEP[p.outreachStatus] || OUTREACH_STEP.not_sent;
                  const pickTitle =
                    p.instagramHandle || p.name || (p.username ? `@${p.username}` : '선정한 인플루언서');
                  return (
                    <div key={p.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5">
                      <CreatorAvatar src={p.profileImage} label={pickTitle} size="w-9 h-9" />
                      <div className="min-w-0 flex-1">
                        {/* 확정 전 후보도 위 카드와 같은 이름으로 부른다 — 인스타 아이디.
                            여기서는 이름, 위에서는 아이디로 부르면 같은 사람이 두 사람으로 읽힌다. */}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-sm font-black text-slate-900 truncate">{pickTitle}</p>
                          {p.instagramHandle && (
                            <span className="text-pink-500 flex-shrink-0"><InstagramMark /></span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 font-bold truncate">{step.hint}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-black ${step.cls}`}>{step.label}</span>
                        {p.quotedFee > 0 && (
                          <p className="text-[11px] text-slate-400 font-bold mt-1">{formatKoreanWon(p.quotedFee)}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 취소된 협업만 아래에 따로 둔다. 완료된 협업은 보드의 정산 칸에 남아 있어
              여기 다시 적으면 한 사람이 두 번 나온다. 취소는 보드의 어느 칸에도 속하지
              않지만, 명단에서 통째로 빠지면 브랜드는 그 사람이 사라졌다고 읽는다. */}
          {cancelledCollabs.length > 0 && (
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-4 md:p-5">
              <p className="text-sm font-black text-slate-900 mb-2.5">취소된 협업</p>
              <div className="space-y-1.5">
                {cancelledCollabs
                  .map(c => {
                    const who = identityOf(c);
                    return (
                    <button
                      key={c.id}
                      onClick={() => openDetail(c.id)}
                      className="w-full flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100 transition-colors"
                    >
                      <CreatorAvatar src={who.image} label={who.title} size="w-9 h-9" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-900 truncate">{who.title}</p>
                        <p className="text-xs text-slate-400 font-bold truncate">{c.campaignTitle}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-black flex-shrink-0 bg-red-50 text-red-500">
                        취소
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
                  <span className="text-[11px] font-black text-blue-600 flex-shrink-0">열기</span>
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
