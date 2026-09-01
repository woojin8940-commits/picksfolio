/**
 * 협업 진행에서 "지금 누가 무엇을 해야 하는가" 한 줄.
 *
 * 진행사항 화면은 다섯 단계를 순서대로 보여 주기는 했지만, 그 중 어느 줄이 내 차례인지를
 * 말하지 않았다. 완료는 초록, 진행 전은 회색, 지금 단계는 검정 — 색은 "단계가 어디까지
 * 왔는가"만 나타냈고 "그래서 내가 지금 무엇을 눌러야 하는가"는 어디에도 없었다. 제품
 * 배송이 대표적이다. 진행이 시작되면 인플루언서가 받을 주소를 적어야 브랜드가 제품을
 * 보내는데, 브랜드가 가이드를 아직 올리지 않았으면 "현재 단계"는 가이드에 걸려 있어
 * 배송 줄은 회색 '진행 전'으로 남았다. 인플루언서 입장에서는 할 일이 없다는 뜻으로
 * 읽히고, 실제로는 자기 주소를 기다리는 중이었다.
 *
 * 그래서 판정을 화면 밖으로 꺼낸다. 단계마다 "지금 이 단계가 기다리는 사람"을 정하고,
 * 내 차례인 첫 단계 하나를 '진행 요청'으로 세운다. 목록 카드와 상세 보드가 같은 함수를
 * 쓰므로 카드에 뜬 요청과 보드에서 펼쳐지는 단계가 어긋날 자리가 없다.
 *
 * 한 번에 하나만 세우는 것이 중요하다. 비어 있는 칸을 전부 '진행 요청'으로 칠하면
 * (시작 직후에는 기획안 · 영상 · 업로드가 모두 비어 있다) 다시 어느 것이 지금인지
 * 알 수 없어진다.
 */

export type CollabStepKey = 'guide' | 'shipping' | 'plan' | 'video' | 'upload' | 'settlement';

export type CollabActionRole = 'influencer' | 'brand' | 'manager';

/** 단계 한 칸을 판정하는 데 필요한 사실만. 목록 응답과 상세 응답이 모두 만들 수 있는 모양이다. */
export type CollabStepFacts = {
  /** collab_stages 의 상태. done · skipped · revision · submitted · active · pending · '' */
  status?: string;
  /** 그 단계에 올라온 제출물이 있는가 (기획안 · 영상). */
  submitted?: boolean;
};

export type CollabActionInput = {
  steps?: Partial<Record<CollabStepKey, CollabStepFacts | null>> | null;
  shipping?: { filled?: boolean; status?: string } | null;
  uploadUrl?: string;
  uploadConfirmedAt?: string | null;
  /**
   * 정산 단계의 사실. 이 칸은 collab_stages 가 아니라 collab_settlement_info 로
   * 판정한다 — 예전 아홉 단계 묶음에는 'settlement' stage 가 이미 다른 뜻으로
   * 들어가 있어서, 단계 상태를 함께 보면 진행 중인 옛 협업이 정산 단계로 끌려간다.
   */
  settlement?: {
    /** 인플루언서가 신분증 사본과 입금 계좌를 냈는가. */
    submitted?: boolean;
    /** 담당자가 적은 실제 지급일 (YYYY-MM-DD). 비면 미정. */
    payoutDate?: string;
    /** 지급이 끝난 시각. 채워지면 정산 단계가 닫힌다. */
    paidAt?: string | null;
  } | null;
  /** 광고비. 0원(제품 협찬형)이면 정산 단계 자체가 없다. */
  fee?: number;
  /** 브랜드가 가이드(파일 · 메모 · 링크)를 올려 두었는가. */
  guideReady?: boolean;
  /** 협업 자체의 상태. 완료 · 취소된 협업에는 할 일이 없다. */
  collabStatus?: string;
};

/** 단계 한 칸이 지금 기다리는 것. 닫힌 단계는 null 이다. */
export type CollabStepTurn = {
  key: CollabStepKey;
  title: string;
  /** 이 단계가 기다리는 사람. 브랜드와 담당자는 같은 편이다. */
  owner: 'influencer' | 'brand';
  /** 내 차례인가. 역할을 넣어 판정한 결과다. */
  mine: boolean;
  /** 해야 하는 일 한 문장. 배너에 그대로 적는다. */
  todo: string;
  /** 줄 끝에 붙는 짧은 말. 목록 카드와 단계 한 줄에 쓴다. */
  short: string;
  /**
   * 이 단계를 기다리는 쪽에서 읽는 문장.
   *
   * todo 는 해야 하는 사람에게 하는 말이라 그대로 상대에게 보여 주면 안 된다 —
   * 인플루언서 화면에 "제품을 발송해 주세요"가 떠 있으면 자기가 할 일로 읽는다.
   */
  waitingNote: string;
  /** 브랜드 피드백을 반영해야 하는 되돌림인가. 색과 배지 글자가 달라진다. */
  revision: boolean;
  /**
   * 브랜드가 아니라 담당자만 할 수 있는 일인가.
   *
   * owner 는 인플루언서/브랜드 둘로만 갈라진다(브랜드와 담당자는 같은 편이다).
   * 그런데 정산 지급은 담당자만 한다 — 브랜드 화면에 "지급일을 입력해 주세요"가
   * 뜨면 자기가 눌러야 할 일로 읽히지만 누를 버튼이 없다.
   */
  managerOnly?: boolean;
};

export const COLLAB_STEP_ORDER: CollabStepKey[] = ['guide', 'shipping', 'plan', 'video', 'upload', 'settlement'];

export const COLLAB_STEP_TITLES: Record<CollabStepKey, string> = {
  guide: '콘텐츠 가이드',
  shipping: '제품 배송',
  plan: '기획안',
  video: '영상 초안',
  upload: '업로드',
  settlement: '정산',
};

const CLOSED = ['done', 'skipped'];

const factsOf = (input: CollabActionInput, step: CollabStepKey): CollabStepFacts =>
  (input.steps?.[step] as CollabStepFacts | undefined) || {};

const statusOf = (input: CollabActionInput, step: CollabStepKey) =>
  String(factsOf(input, step).status || '');

/**
 * 단계 한 칸이 기다리는 것. 닫혔으면 null.
 *
 * "닫혔는가"의 판정은 단계 상태 하나만 보지 않는다. 배송은 송장이 찍히면 끝이고,
 * 업로드는 브랜드가 게시물을 확인한 시각이 남으면 끝이다 — 그 두 칸은 예전 아홉 단계
 * 묶음으로 시작한 협업에서 단계 상태가 끝까지 움직이지 않는 경우가 있어서, 실제 기록을
 * 함께 본다.
 */
const pendingOf = (input: CollabActionInput, step: CollabStepKey): Omit<CollabStepTurn, 'mine'> | null => {
  const status = statusOf(input, step);
  const stageClosed = CLOSED.includes(status);
  const title = COLLAB_STEP_TITLES[step];
  const revision = status === 'revision';
  const base = { key: step, title, revision };

  switch (step) {
    case 'guide': {
      if (stageClosed) return null;
      // 올라온 가이드가 없으면 기다리는 쪽은 브랜드다. 인플루언서에게 "확인해 주세요"를
      // 띄워 두면 열 것이 없는 단계를 계속 열어 보게 된다.
      if (!input.guideReady) {
        return {
          ...base,
          owner: 'brand',
          todo: '콘텐츠 가이드를 올려 주세요.',
          short: '가이드 등록 필요',
          waitingNote: '브랜드가 가이드를 올리면 이 단계에서 바로 열어 볼 수 있습니다.',
        };
      }
      return {
        ...base,
        owner: 'influencer',
        todo: '브랜드가 올린 가이드를 열어 보고 확인을 눌러 주세요.',
        short: '가이드 확인 필요',
        waitingNote: '인플루언서가 가이드를 확인하면 이 단계가 닫힙니다.',
      };
    }

    case 'shipping': {
      const shipping = input.shipping || {};
      if (stageClosed || String(shipping.status) === 'shipped') return null;
      if (!shipping.filled) {
        return {
          ...base,
          owner: 'influencer',
          todo: '제품을 받을 주소와 연락처를 입력해 주세요. 입력하면 브랜드가 바로 발송합니다.',
          short: '배송 정보 입력 필요',
          waitingNote: '인플루언서가 받을 주소를 입력하면 발송할 수 있습니다.',
        };
      }
      return {
        ...base,
        owner: 'brand',
        todo: '입력된 주소로 제품을 발송하고 송장 번호를 남겨 주세요.',
        short: '제품 발송 필요',
        waitingNote: '브랜드가 제품을 발송하면 송장 번호가 이 단계에 표시됩니다.',
      };
    }

    case 'plan':
    case 'video': {
      if (stageClosed) return null;
      const label = step === 'plan' ? '기획안' : '영상 초안';
      if (revision) {
        return {
          ...base,
          owner: 'influencer',
          todo: `브랜드 피드백을 반영해 ${label}을 다시 올려 주세요.`,
          short: '피드백 반영 필요',
          waitingNote: `인플루언서가 피드백을 반영해 ${label}을 다시 올리면 검토할 수 있습니다.`,
        };
      }
      if (!factsOf(input, step).submitted) {
        return {
          ...base,
          owner: 'influencer',
          todo: step === 'plan'
            ? '장면별로 기획안을 작성해 저장해 주세요.'
            : '완성된 초안 영상과 인스타 본문 캡션을 올려 주세요.',
          short: `${label} 등록 필요`,
          waitingNote: `인플루언서가 ${label}을 올리면 검토할 수 있습니다.`,
        };
      }
      return {
        ...base,
        owner: 'brand',
        todo: `올라온 ${label}을 확인하고 피드백을 남기거나 검토를 완료해 주세요.`,
        short: `${label} 검토 필요`,
        waitingNote: `브랜드가 ${label}을 검토하면 피드백이나 다음 단계가 열립니다.`,
      };
    }

    case 'upload': {
      if (stageClosed || input.uploadConfirmedAt) return null;
      if (revision) {
        return {
          ...base,
          owner: 'influencer',
          todo: '브랜드 요청을 반영해 게시물을 수정해 주세요.',
          short: '게시물 수정 필요',
          waitingNote: '인플루언서가 게시물을 수정하면 다시 확인할 수 있습니다.',
        };
      }
      if (!String(input.uploadUrl || '').trim()) {
        return {
          ...base,
          owner: 'influencer',
          // 영상 검토가 끝나 이 단계가 열렸다는 것 자체가 게시 허락이다. 예전 문장은
          // 이미 올린 사람에게 하는 말이어서, 아직 안 올린 사람은 "올려도 되나"를
          // 다시 확인하고 하루를 보냈다.
          todo: '검토가 끝난 영상과 본문 캡션 그대로 게시하고, 게시물 링크와 광고 파트너십 코드를 남겨 주세요.',
          short: '업로드 · 링크 등록 필요',
          waitingNote: '인플루언서가 게시물 링크를 남기면 확인할 수 있습니다.',
        };
      }
      return {
        ...base,
        owner: 'brand',
        todo: '업로드된 게시물을 확인하고 확인 완료를 눌러 주세요.',
        short: '업로드 확인 필요',
        waitingNote: '브랜드가 게시물을 확인하면 협업이 마무리됩니다.',
      };
    }

    /**
     * 정산. 업로드 확인으로 협업이 끝난 뒤에 남는 마지막 한 칸이다.
     *
     * 예전에는 업로드가 확인되면 진행사항에 할 일이 없어졌다. 그런데 실제로는 거기서
     * 신분증 사본과 계좌를 주고받고 지급일을 잡는 일이 카카오톡·메일로 이어졌고,
     * 인플루언서는 "언제 들어오나"를 물어봐야 알 수 있었다. 그 왕복을 이 칸으로 옮긴다.
     */
    case 'settlement': {
      const settlement = input.settlement || {};
      // 광고비가 없는 협업(제품 협찬형)에는 정산할 것이 없다. 서류를 받을 이유도 없다.
      if (Number(input.fee || 0) <= 0) return null;
      if (settlement.paidAt) return null;
      // 업로드 확인 전에는 열지 않는다. 촬영도 시작하지 않은 시점에 신분증을 요구하면
      // 무엇에 쓰는 서류인지 알 수 없다.
      if (!input.uploadConfirmedAt) return null;

      if (!settlement.submitted) {
        return {
          ...base,
          owner: 'influencer',
          todo: '신분증 사본과 입금 계좌를 입력해 주세요. 담당자가 확인하면 지급일이 잡힙니다.',
          short: '정산 서류 제출 필요',
          waitingNote: '인플루언서가 신분증 사본과 계좌를 제출하면 담당자가 지급일을 잡습니다.',
        };
      }
      if (!String(settlement.payoutDate || '').trim()) {
        return {
          ...base,
          owner: 'brand',
          managerOnly: true,
          todo: '제출된 정산 서류를 확인하고 지급일을 입력해 주세요.',
          short: '지급일 입력 필요',
          waitingNote: '담당자가 서류를 확인하고 지급일을 정하면 이 단계에 표시됩니다.',
        };
      }
      return {
        ...base,
        owner: 'brand',
        managerOnly: true,
        todo: '지정한 지급일에 정산금을 보내고 지급 완료를 눌러 주세요.',
        short: '지급 대기',
        waitingNote: `담당자가 정한 지급일(${settlement.payoutDate})에 입금됩니다.`,
      };
    }

    default:
      return null;
  }
};

const sideOf = (role: CollabActionRole) => (role === 'influencer' ? 'influencer' : 'brand');

/** 다섯 칸 각각이 지금 기다리는 것. 닫힌 칸은 null 로 남는다. */
export const collabStepTurns = (
  input: CollabActionInput,
  role: CollabActionRole,
): Record<CollabStepKey, CollabStepTurn | null> => {
  const status = String(input.collabStatus || '');
  const cancelled = status === 'cancelled';
  // 완료된 협업에도 정산은 남아 있다. 업로드 확인이 곧 완료 처리라서, 여기서 정산까지
  // 닫아 버리면 서류를 내고 돈을 받는 마지막 왕복이 화면에서 사라진다.
  const closedFor = (step: CollabStepKey) =>
    cancelled || (status === 'completed' && step !== 'settlement');
  // 정산은 브랜드의 칸이 아니다. 브랜드는 픽스폴리오에 회차마다 한 번 보내고, 서류를
  // 받고 지급일을 잡고 입금하는 것은 담당자가 한다. 브랜드 화면에 이 칸이 열리면
  // 손댈 수 없는 남의 일정이 "기다리는 중"으로 남는다.
  const hiddenFor = (step: CollabStepKey) => role === 'brand' && step === 'settlement';
  const out = {} as Record<CollabStepKey, CollabStepTurn | null>;
  for (const step of COLLAB_STEP_ORDER) {
    const pending = closedFor(step) || hiddenFor(step) ? null : pendingOf(input, step);
    out[step] = pending
      ? {
          ...pending,
          // 담당자만 할 수 있는 일은 브랜드의 차례로 세지 않는다. 브랜드 화면에
          // 누를 버튼이 없는 '진행 요청'이 뜨면 무엇을 기다리는지 알 수 없어진다.
          mine: pending.owner === sideOf(role) && (!pending.managerOnly || role === 'manager'),
        }
      : null;
  }
  return out;
};

/**
 * 지금 내가 해야 하는 단계 하나. 없으면 null.
 *
 * 순서상 앞의 단계가 상대를 기다리는 중이라도 건너뛴다 — 가이드를 기다리는 동안 배송지를
 * 미리 적어 두는 것을 막을 이유가 없고, 실제로 그 사이가 가장 길다.
 */
export const nextCollabAction = (
  input: CollabActionInput,
  role: CollabActionRole,
): CollabStepTurn | null => {
  const turns = collabStepTurns(input, role);
  // 되돌림(피드백 반영)이 있으면 그것이 먼저다. 브랜드가 고쳐 달라고 한 것을 놔두고
  // 다음 단계를 채우면, 같은 단계를 두 번 왕복하게 된다.
  const mine = COLLAB_STEP_ORDER.map(k => turns[k]).filter((t): t is CollabStepTurn => Boolean(t?.mine));
  return mine.find(t => t.revision) || mine[0] || null;
};

/** 내 차례는 아니고 상대를 기다리는 중인 첫 단계. 할 일이 없을 때 무엇을 기다리는지 적는다. */
export const waitingCollabStep = (
  input: CollabActionInput,
  role: CollabActionRole,
): CollabStepTurn | null => {
  const turns = collabStepTurns(input, role);
  return COLLAB_STEP_ORDER.map(k => turns[k]).find((t): t is CollabStepTurn => Boolean(t && !t.mine)) || null;
};
