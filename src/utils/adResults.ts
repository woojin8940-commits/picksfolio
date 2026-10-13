import { CONVERSION_EVENTS } from './adBoosts';
import type { MetaAdWithLive } from './metaAdsApi';

/**
 * 광고 관리자의 '결과' 열을 같은 규칙으로 만든다.
 *
 * 광고 관리자는 광고마다 성과 목표(optimization_goal)에 맞는 숫자 하나를 '결과'로 보여 준다 —
 * 판매 광고는 고른 전환 이벤트, 트래픽 광고는 링크 클릭이나 랜딩 페이지 조회, 인지도 광고는
 * 도달. 목적이 다른 광고를 한 목록에 섞어 두면 노출·클릭만으로는 어느 광고가 제 일을 하고
 * 있는지 알 수 없어서, 그 광고가 노린 결과와 결과당 비용을 같은 자리에 둔다.
 *
 * 숫자는 서버가 메타 인사이트에서 그대로 옮긴 원본(events · reach · impressions …)이고,
 * 여기서는 고르고 나누기만 한다.
 */

export type AdStatus = 'draft' | 'review' | 'active' | 'paused' | 'rejected' | 'issue' | 'ended';

export const AD_STATUS_LABEL: Record<AdStatus, { label: string; cls: string }> = {
  draft: { label: '만드는 중 멈춤', cls: 'bg-rose-50 text-rose-600' },
  review: { label: 'Meta 검토 중', cls: 'bg-amber-50 text-amber-600' },
  active: { label: '게재 중', cls: 'bg-emerald-50 text-emerald-600' },
  paused: { label: '일시중지', cls: 'bg-slate-100 text-slate-500' },
  rejected: { label: '반려됨', cls: 'bg-rose-50 text-rose-600' },
  issue: { label: '게재 문제', cls: 'bg-orange-50 text-orange-600' },
  ended: { label: '종료', cls: 'bg-slate-100 text-slate-500' },
};

/** 광고 목적 이름. 부스팅과 직접 만들기가 같은 말을 쓰도록 한 군데 둔다. */
export const OBJECTIVE_LABEL: Record<string, string> = {
  conversions: '판매',
  traffic: '트래픽',
  engagement: '참여',
  awareness: '인지도',
};

/** 서버 이벤트 키 → 화면 이름. 광고 관리자 열 이름을 따른다. */
export const EVENT_LABEL: Record<string, string> = {
  ...Object.fromEntries(CONVERSION_EVENTS.map((e) => [e.value, e.label])),
  SEARCH: '검색',
  LANDING_PAGE_VIEW: '랜딩 페이지 조회',
  LINK_CLICK: '링크 클릭',
  POST_ENGAGEMENT: '게시물 참여',
  VIDEO_VIEW: '동영상 3초 이상 재생',
  THRUPLAY: 'ThruPlay',
};

/** 웹사이트 구매 흐름. 앞 단계에서 뒤 단계로 몇 %가 넘어가는지 같이 본다. */
export const WEBSITE_FUNNEL = ['LANDING_PAGE_VIEW', 'CONTENT_VIEW', 'ADD_TO_CART', 'INITIATED_CHECKOUT', 'PURCHASE'] as const;

/** 픽셀이 사이트에서 받는 표준 이벤트 이름(fbq('track', …)) → 화면 이름. */
export const PIXEL_EVENT_LABEL: Record<string, string> = {
  PageView: '페이지 조회',
  ViewContent: '콘텐츠 조회',
  Search: '검색',
  AddToCart: '장바구니에 담기',
  AddToWishlist: '위시리스트 추가',
  InitiateCheckout: '결제 시작',
  AddPaymentInfo: '결제 정보 추가',
  Purchase: '구매',
  Lead: '잠재 고객',
  CompleteRegistration: '등록 완료',
  Contact: '문의',
  Subscribe: '구독',
  StartTrial: '체험 시작',
  Schedule: '예약',
  FindLocation: '위치 찾기',
  CustomizeProduct: '제품 맞춤 설정',
  Donate: '기부',
  SubmitApplication: '지원서 제출',
};

export type AdResult = {
  /** '구매', '링크 클릭', '도달' … */
  label: string;
  value: number;
  /** 결과당 비용(원). 도달·노출은 1,000회당이다. 결과가 없으면 0. */
  costPer: number;
  /** 결과당 비용이 1,000 단위인지(도달 · 노출). */
  perThousand: boolean;
};

type LiveNumbers = {
  impressions: number;
  reach: number;
  linkClicks: number;
  spend: number;
  events: Record<string, number>;
};

const numbersOf = (ad: MetaAdWithLive): LiveNumbers => ({
  impressions: ad.meta.impressions || 0,
  reach: ad.meta.reach || 0,
  linkClicks: ad.meta.linkClicks || ad.meta.events?.LINK_CLICK || 0,
  spend: ad.meta.spend || 0,
  events: ad.meta.events || {},
});

/** 이 광고의 '결과' 가 무엇인지(값 없이). 묶음 합계에서 같은 결과끼리만 더할 때 쓴다. */
export function resultKind(ad: MetaAdWithLive): { key: string; label: string; perThousand: boolean } {
  // 픽셀이 없어 판매를 트래픽으로 돌린 광고는 서버가 성과 목표를 LINK_CLICKS 로 바꿔 둔다.
  const goal =
    ad.optimizationGoal ||
    ({ conversions: 'OFFSITE_CONVERSIONS', traffic: 'LINK_CLICKS', engagement: 'POST_ENGAGEMENT', awareness: 'REACH' } as Record<
      string,
      string
    >)[ad.objective] ||
    'LINK_CLICKS';
  switch (goal) {
    case 'OFFSITE_CONVERSIONS': {
      const event = ad.conversionEvent || 'PURCHASE';
      return { key: event, label: EVENT_LABEL[event] || event, perThousand: false };
    }
    case 'VALUE':
      return { key: 'PURCHASE', label: EVENT_LABEL.PURCHASE, perThousand: false };
    case 'LANDING_PAGE_VIEWS':
      return { key: 'LANDING_PAGE_VIEW', label: EVENT_LABEL.LANDING_PAGE_VIEW, perThousand: false };
    case 'POST_ENGAGEMENT':
      return { key: 'POST_ENGAGEMENT', label: EVENT_LABEL.POST_ENGAGEMENT, perThousand: false };
    case 'THRUPLAY':
      return { key: 'THRUPLAY', label: EVENT_LABEL.THRUPLAY, perThousand: false };
    case 'IMPRESSIONS':
      return { key: 'IMPRESSIONS', label: '노출', perThousand: true };
    case 'REACH':
    case 'AD_RECALL_LIFT':
      // 광고 상기도는 메타가 추정치만 주고 일반 인사이트에는 없다. 같은 묶음의 도달로 본다.
      return { key: 'REACH', label: '도달', perThousand: true };
    default:
      return { key: 'LINK_CLICK', label: EVENT_LABEL.LINK_CLICK, perThousand: false };
  }
}

/** 결과 종류의 값을 숫자 묶음에서 꺼낸다. */
export function resultValue(key: string, n: Pick<LiveNumbers, 'impressions' | 'reach' | 'linkClicks' | 'events'>): number {
  if (key === 'IMPRESSIONS') return n.impressions;
  if (key === 'REACH') return n.reach;
  if (key === 'LINK_CLICK') return n.linkClicks;
  return n.events[key] || 0;
}

export function resultOf(ad: MetaAdWithLive): AdResult {
  const kind = resultKind(ad);
  const n = numbersOf(ad);
  const value = resultValue(kind.key, n);
  const costPer = value > 0 ? Math.round((n.spend / value) * (kind.perThousand ? 1000 : 1)) : 0;
  return { label: kind.label, value, costPer, perThousand: kind.perThousand };
}
