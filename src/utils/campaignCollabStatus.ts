/**
 * 캠페인 협업 한 건을 "현황 화면이 읽는 모양"으로 바꾼다.
 *
 * 현황 화면들(비즈니스 제안 현황 · 협업 현황)은 오랫동안 비즈니스 제안만 보고 있었다.
 * 그런데 실제로 진행되는 일은 두 갈래다 — 브랜드가 인플루언서에게 직접 보낸 제안,
 * 그리고 캠페인에 지원해 선정되어 담당자를 거쳐 돌아가는 캠페인 협업. 뒤쪽은 제안
 * 테이블에 남지 않으므로, 다섯 명이 촬영 중인 캠페인을 진행하고 있어도 "협업 현황"은
 * 비어 있었다. 그러니 현황을 보러 온 사람은 캠페인 협업 화면을 따로 열어 보고,
 * 두 화면의 숫자를 머리로 더해야 했다.
 *
 * 여기서 모양을 하나로 맞춘다. 세 화면이 각자 응답을 해석하면 같은 협업이 화면마다
 * 다른 상태로 뜬다 — 실제로 브랜드 쪽 현황은 진행 중, 인플루언서 쪽은 대기로 보이는
 * 일이 있었다. 판정은 이 파일에서 한 번만 한다.
 */

import {
  CollabActionInput,
  CollabActionRole,
  nextCollabAction,
  waitingCollabStep,
} from './collabNextAction';

/** 현황 화면이 쓰는 네 가지 상태. 제안(pending·accepted·completed·rejected)과 나란히 놓을 수 있게 맞췄다. */
export type CampaignCollabState = 'in_progress' | 'completed' | 'cancelled';

export type CampaignCollabStatus = {
  /** 협업 id. 진행사항 화면을 열 때 쓴다. */
  id: string;
  campaignId: string;
  /** 캠페인 제목. 목록 한 줄의 제목이 된다. */
  title: string;
  /** 브랜드 상호. 인플루언서 화면에서 상대 이름이다. */
  companyName: string;
  /** 인플루언서 아이디. 브랜드 화면에서 상대 이름이다. */
  creatorUsername: string;
  thumbnail: string;
  state: CampaignCollabState;
  stateLabel: string;
  /** 0~100. 다섯 단계 중 끝난 비율. */
  progress: number;
  /** 지금 단계 이름(예: 영상 초안). 비어 있을 수 있다. */
  currentStageTitle: string;
  /**
   * 지금 이 협업이 나에게 요구하는 일 한 줄. 내 차례가 없으면 무엇을 기다리는지 적는다.
   * 카드 하나만 보고 "지금 내가 눌러야 하나"를 알 수 있어야 한다.
   */
  todo: string;
  /** 내 차례인가. 목록 정렬과 강조에 쓴다. */
  mine: boolean;
  /** 진행 기간. 확정된 일정이 없으면 캠페인 종료일로 대신한다. */
  startDate: string;
  endDate: string;
  /** 확정 보수(원). 브랜드·인플루언서 본인에게만 응답에 실려 온다. */
  fee: number;
  /**
   * 협업 내역의 분류. 서버가 협업 일정을 내역에 올릴 때 쓰는 규칙과 같게 맞춘다 —
   * 담당자가 일정을 확정하기 전과 후에 같은 협업이 다른 분류로 보이면 안 된다.
   */
  category: '광고' | '커머스' | '기타';
  createdAt: string;
  updatedAt: string;
};

const STATE_LABEL: Record<CampaignCollabState, string> = {
  in_progress: '진행중',
  completed: '완료',
  cancelled: '취소',
};

const asDate = (raw: unknown) => String(raw || '').slice(0, 10);

/**
 * 협업 응답 한 줄 → 현황 항목.
 *
 * `role` 은 "누가 보는 화면인가"다. 같은 협업이라도 상대 이름과 할 일 문장이 반대가
 * 되므로, 이 값을 넘기지 않으면 브랜드 화면에 "제품 배송을 기다리는 중"처럼 남의
 * 할 일이 자기 할 일로 뜬다.
 */
export function toCampaignCollabStatus(row: any, role: CollabActionRole): CampaignCollabStatus {
  const raw = String(row?.status || '');
  const state: CampaignCollabState =
    raw === 'completed' ? 'completed' : raw === 'cancelled' ? 'cancelled' : 'in_progress';

  const input: CollabActionInput = {
    steps: row?.steps || null,
    shipping: row?.shipping || null,
    uploadUrl: row?.uploadUrl || '',
    uploadConfirmedAt: row?.uploadConfirmedAt || null,
    guideReady: Boolean(row?.guideReady),
    settlement: row?.settlement || null,
    fee: Number(row?.fee || 0),
    collabStatus: raw,
  };

  const next = nextCollabAction(input, role);
  const waiting = next ? null : waitingCollabStep(input, role);
  const todo =
    state === 'completed'
      ? '모든 단계가 끝났습니다'
      : state === 'cancelled'
        ? '취소된 협업입니다'
        : next?.todo || waiting?.waitingNote || '진행을 기다리는 중입니다';

  return {
    id: String(row?.id || ''),
    campaignId: String(row?.campaignId || ''),
    title: String(row?.campaignTitle || '캠페인 협업'),
    companyName: String(row?.companyName || ''),
    creatorUsername: String(row?.creatorUsername || ''),
    thumbnail: String(row?.campaignThumbnail || ''),
    state,
    stateLabel: STATE_LABEL[state],
    progress: Math.max(0, Math.min(100, Number(row?.progress || 0))),
    currentStageTitle: String(row?.currentStageTitle || ''),
    todo,
    mine: Boolean(next),
    startDate: asDate(row?.scheduleStart) || asDate(row?.createdAt),
    // 일정이 확정되지 않은 협업이 많다. 그때는 캠페인 종료일이 사실상의 마감이라
    // 캘린더에 놓을 수 있는 유일한 날짜다 — 비워 두면 캘린더에서 아예 사라진다.
    endDate: asDate(row?.scheduleEnd) || asDate(row?.campaignEndDate),
    fee: Number(row?.fee || 0),
    category:
      row?.campaignType === 'ad_collab' ? '광고' : row?.campaignType === 'group_buy' ? '커머스' : '기타',
    createdAt: String(row?.createdAt || ''),
    updatedAt: String(row?.updatedAt || row?.createdAt || ''),
  };
}

/** 목록 전체 변환. 취소된 건은 현황에서 뒤로 밀고, 내 차례인 것을 앞으로 올린다. */
export function toCampaignCollabStatuses(rows: any[], role: CollabActionRole): CampaignCollabStatus[] {
  return (rows || [])
    .map(row => toCampaignCollabStatus(row, role))
    .filter(c => c.id)
    .sort((a, b) => {
      const rank = (c: CampaignCollabStatus) =>
        c.state === 'cancelled' ? 3 : c.state === 'completed' ? 2 : c.mine ? 0 : 1;
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
}

/**
 * 캠페인 진행사항 화면 열기.
 *
 * 현황에서 협업 한 줄을 눌렀을 때 갈 곳은 결국 진행사항 보드다. 현황 화면이 보드를
 * 직접 품으면 같은 보드가 화면마다 한 벌씩 생기고(브랜드 쪽은 이미 캠페인 협업 안에
 * 있다), 상태가 어긋난다. 그래서 이동만 알리고 그리는 일은 원래 자리에 맡긴다.
 */
export function openCampaignCollab(detail: { campaignId?: string; collabId?: string }) {
  window.dispatchEvent(new CustomEvent('navigate-campaign-collab', { detail }));
}

/**
 * 브랜드 제안 목록이 같은 협업을 한 번 더 보내는 것을 걸러낸다.
 *
 * `/api/business-proposals` 는 선정된 캠페인 지원자를 제안 한 줄로도 만들어 보낸다
 * (id 는 `campaign_<캠페인id>_<아이디>`). 그런데 지원자를 선정하는 그 요청이 협업 행도
 * 같이 만든다 — 두 목록을 그냥 합치면 같은 협업이 두 줄이 되고, 캘린더 막대도 건수도
 * 협업비 합계도 두 번 세어진다.
 *
 * 남기는 쪽은 협업이다. 제안으로 접힌 줄은 금액과 기간만 알지만, 협업 줄은 지금 단계와
 * 진행률까지 알고 진행사항으로 들어가는 길이 있다.
 *
 * 취소된 협업은 짝을 지우지 않는다 — 협업 줄이 목록에서 빠지는 쪽이라, 여기서 제안까지
 * 지우면 선정 기록이 통째로 사라진다.
 */
export function campaignProposalId(c: { campaignId: string; creatorUsername: string }): string {
  return `campaign_${c.campaignId}_${String(c.creatorUsername || '').toLowerCase()}`;
}

export function dropProposalsCoveredByCollabs<T extends { id: string }>(
  proposals: T[],
  collabs: CampaignCollabStatus[],
): T[] {
  const covered = new Set(
    collabs.filter(c => c.state !== 'cancelled').map(campaignProposalId),
  );
  if (covered.size === 0) return proposals;
  return proposals.filter(p => !covered.has(String(p.id)));
}

/**
 * 협업 현황 화면(캘린더 · 협업 내역)이 읽는 모양으로 한 번 더 바꾼다.
 *
 * 그 화면들은 처음부터 비즈니스 제안 배열 하나로 만들어져 있다 — 캘린더 칸, 인플루언서별
 * 묶음, 마감 임박, 통계가 전부 같은 배열을 본다. 캠페인 협업을 위해 두 번째 배열을
 * 나란히 끼워 넣으면 그 다섯 곳을 각각 두 번씩 계산해야 하고, 한 곳을 빠뜨리면 캘린더에는
 * 있는데 통계에는 없는 협업이 생긴다. 그래서 배열을 하나로 유지하고, 들어오는 쪽에서
 * 모양을 맞춘다.
 *
 * `_collabId` 가 붙은 줄이 캠페인 협업이다. 화면은 이 값으로만 배지와 이동을 가른다.
 */
export type ProposalLikeCollab = {
  id: string;
  influencer_username: string;
  category: '광고' | '커머스';
  company_name: string;
  contact_person: string;
  contact_email: string;
  contact_phone: string;
  title: string;
  content: string;
  start_date: string;
  end_date: string;
  fee: number;
  reference_links: string[];
  business_username?: string;
  status: 'accepted' | 'completed';
  created_at: string;
  updated_at?: string;
  /** 캠페인 협업임을 나타내는 표시. 제안에는 없다. */
  _collabId: string;
  _campaignId: string;
  /** 진행률 · 지금 단계 · 할 일. 목록 줄에 그대로 적는다. */
  _progress: number;
  _stageTitle: string;
  _todo: string;
};

/**
 * 일정이 없는 협업은 캘린더에 놓을 수 없다.
 *
 * 시작일은 협업이 만들어진 날(선정된 날)로 대신할 수 있지만 종료일은 대신할 것이 없어서,
 * 캠페인 종료일도 비어 있으면 그 협업은 기간이 없는 것이다. 억지로 오늘 하루로 놓으면
 * 날마다 위치가 바뀌는 칸이 생긴다 — 목록에는 남기고 캘린더에서만 뺀다.
 */
export function campaignCollabAsProposal(c: CampaignCollabStatus): ProposalLikeCollab {
  return {
    id: `collab:${c.id}`,
    influencer_username: c.creatorUsername,
    // 제안 화면의 분류는 광고·커머스 두 가지뿐이라 '기타'를 놓을 자리가 없다.
    category: c.category === '커머스' ? '커머스' : '광고',
    company_name: c.companyName,
    contact_person: '',
    contact_email: '',
    contact_phone: '',
    title: c.title,
    content: c.todo,
    start_date: c.startDate,
    end_date: c.endDate,
    fee: c.fee,
    reference_links: [],
    status: c.state === 'completed' ? 'completed' : 'accepted',
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    _collabId: c.id,
    _campaignId: c.campaignId,
    _progress: c.progress,
    _stageTitle: c.currentStageTitle,
    _todo: c.todo,
  };
}

/** 캘린더에 올릴 수 있는(기간이 있는) 협업만. */
export function campaignCollabsAsProposals(rows: CampaignCollabStatus[]): ProposalLikeCollab[] {
  return rows.filter(c => c.state !== 'cancelled').map(campaignCollabAsProposal);
}
