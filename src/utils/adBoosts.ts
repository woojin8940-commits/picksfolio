/**
 * 콘텐츠 부스팅 — 이력에서 고른 게시물을 광고로 돌린 기록.
 *
 * 브랜드는 캠페인 이력에서 잘 된 콘텐츠를 찾고, 광고 현황에서 돌아가는 광고를 본다.
 * 그 사이의 동작("이걸 광고로 돌려줘")이 두 화면 중 어디에도 없어서, 지금은 파트너십
 * 코드를 손으로 옮겨 메타 광고 관리자에서 따로 만들어야 한다. 부스팅은 그 동작을
 * 이력 화면 안으로 가져온다.
 *
 * 메타 광고 집행 권한(ads_management) 심사가 끝나기 전이라 실제로 광고를 만들 수는
 * 없다. 그래서 집행 요청을 이 화면 안에만 남겨 두고, 광고 현황 목록이 그것을 '요청'
 * 상태의 새 항목으로 같이 보여 준다 — 브랜드가 집행 흐름 전체를 먼저 확인할 수 있게
 * 하되, 어디에서도 실제로 노출이 시작된 것처럼 보이지 않게 한다.
 *
 * 여기에는 브랜드가 직접 올린 소재로 만든 광고(광고 현황의 '새 광고 만들기')도 같이
 * 담긴다. 둘은 소재가 어디서 왔는지만 다르고 — 이력의 게시물이냐, 브랜드가 올린
 * 파일이냐 — 집행 조건(예산·기간·타겟·노출 위치)과 저장 위치, 요청 상태는 같다.
 * 그래서 목록을 나누지 않고 source 로 구분한다: 광고 현황이 한 목록으로 보여야
 * 브랜드가 "지금 돌고 있는 광고"를 한 화면에서 센다.
 *
 * 저장은 브라우저에만 한다. 이 값은 아직 계정의 데이터가 아니라 화면 확인용 임시
 * 기록이고, 연동이 붙으면 이 자리가 메타 광고 API 응답으로 바뀐다. 서버에 테이블을
 * 먼저 만들어 두면 심사 후 실제 광고 객체와 두 갈래로 갈라진다.
 */

/** 노출 위치 — 메타가 쓰는 배치 이름을 그대로 둔다. */
export const AD_PLACEMENTS = [
  { value: 'feed', label: '피드' },
  { value: 'story', label: '스토리' },
  { value: 'reels', label: '릴스' },
  { value: 'explore', label: '탐색' },
] as const;

export type AdPlacement = (typeof AD_PLACEMENTS)[number]['value'];

/** 연령 타겟. 캠페인 브리프의 연령대와 같은 구간을 쓴다(브랜드가 이미 본 구분이다). */
export const AD_AGE_BANDS = ['20대', '30대', '40대', '50대 이상'] as const;

/**
 * 지역 타겟. 시·도를 다 늘어놓으면 17개가 되어 고르는 일이 일이 되므로, 광고에서
 * 실제로 갈라 잡는 권역 단위로 묶어 둔다.
 */
export const AD_REGIONS = [
  '서울',
  '경기·인천',
  '부산·경남',
  '대구·경북',
  '대전·충청',
  '광주·전라',
  '강원',
  '제주',
] as const;

/**
 * 광고 목적 — 메타가 캠페인 단위로 먼저 묻는 값이다.
 *
 * 이력에서 고른 게시물을 다시 돌리는 부스팅은 목적이 전환으로 정해져 있지만(그래서
 * 부스팅 창은 목적을 고르지 않는다), 직접 올린 소재는 무엇을 하려고 만든 광고인지가
 * 브랜드에게만 있다. 목적에 따라 메타가 예산을 쓰는 방식과 화면에서 봐야 하는 지표가
 * 갈리므로, 고른 값을 그대로 저장하고 광고 현황의 카드에도 같이 적는다.
 *
 * 기본값은 전환이다 — 부스팅과 같은 이유로, 소재를 만들어 돈을 붙이는 이유가 대개
 * 판매다. notice 는 창 위쪽에 그리는 안내로, 목적에 따라 문구만 바뀐다.
 */
export const AD_OBJECTIVES = [
  {
    value: 'awareness',
    label: '브랜드 인지도',
    notice: {
      title: '최대한 많은 사람에게 도달하도록 진행됩니다',
      body:
        '같은 예산으로 더 많은 사람에게 한 번 이상 보이도록 집행합니다. 성과는 광고 현황에서 ' +
        '도달 · 빈도 · CPM 으로 확인합니다.',
    },
  },
  {
    value: 'traffic',
    label: '트래픽',
    notice: {
      title: '웹사이트 방문을 늘리도록 진행됩니다',
      body:
        '연결 URL 을 눌러 들어올 가능성이 높은 사람에게 집행합니다. 성과는 광고 현황에서 ' +
        '클릭수 · CTR · CPC 로 확인합니다.',
    },
  },
  {
    value: 'conversions',
    label: '전환(판매)',
    notice: {
      title: '전환 목적으로 진행됩니다',
      body:
        '업로드한 소재로 구매 전환을 목적으로 집행합니다. 성과는 광고 현황에서 ' +
        '전환수 · 전환당 비용 · ROAS 로 확인합니다.',
    },
  },
] as const;

export type AdObjective = (typeof AD_OBJECTIVES)[number]['value'];

export const DEFAULT_AD_OBJECTIVE: AdObjective = 'conversions';

export const findObjective = (value: AdObjective | undefined) =>
  AD_OBJECTIVES.find((o) => o.value === value) || null;

/** CTA 버튼 문구. 메타 광고의 call_to_action 과 같은 선택지만 둔다. */
export const AD_CTAS = [
  { value: 'learn_more', label: '더 알아보기' },
  { value: 'shop_now', label: '지금 구매' },
  { value: 'sign_up', label: '가입하기' },
  { value: 'book_now', label: '지금 예약' },
  { value: 'contact_us', label: '문의하기' },
] as const;

export type AdCta = (typeof AD_CTAS)[number]['value'];

/**
 * 목적에 맞는 문구가 위로 오는 순서.
 *
 * 다섯 개를 늘 같은 순서로 두면 브랜드는 목적과 어울리지 않는 문구(인지도 광고에
 * '지금 구매')를 맨 위에서 집는다. 목록에서 빼지는 않는다 — 목적과 문구를 다르게
 * 가는 판단은 브랜드 쪽에 있다.
 */
const CTA_ORDER: Record<AdObjective, AdCta[]> = {
  awareness: ['learn_more', 'contact_us', 'sign_up', 'book_now', 'shop_now'],
  traffic: ['learn_more', 'book_now', 'sign_up', 'shop_now', 'contact_us'],
  conversions: ['shop_now', 'sign_up', 'book_now', 'learn_more', 'contact_us'],
};

export const ctasForObjective = (objective: AdObjective) => {
  const order = CTA_ORDER[objective] || [];
  return [...AD_CTAS].sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
};

export const ctaLabel = (value: AdCta | undefined): string =>
  AD_CTAS.find((c) => c.value === value)?.label || '';

/**
 * 광고를 내보내는 페이지 — 광고가 누구 이름으로 보이는지.
 *
 * 한 브랜드가 페이지를 여럿 들고 있는 경우(본 브랜드/서브 라인/팝업 계정)가 있어서,
 * 어느 페이지 이름으로 나가는지는 브랜드가 골라야 한다. 지금은 화면 확인용 예시이고,
 * 실제 연동에서는 GET /me/accounts 응답으로 바뀐다(광고 계정과 같은 자리).
 */
export const MOCK_AD_PAGES = [
  { id: 'page_88213001', name: '픽스폴리오 공식', handle: 'picksfolio.official' },
  { id: 'page_88213002', name: '픽스폴리오 뷰티', handle: 'picksfolio.beauty' },
  { id: 'page_88213003', name: '픽스폴리오 리빙', handle: 'picksfolio.living' },
] as const;

export const findAdPage = (pageId: string | undefined) =>
  MOCK_AD_PAGES.find((p) => p.id === pageId) || null;

export type AdBoost = {
  id: string;
  /** 집행 요청 시각(ISO). 광고 현황에서 최신순으로 올린다. */
  requestedAt: string;
  /**
   * 소재가 어디서 왔는지. 'partnership' 은 이력에서 고른 게시물(부스팅),
   * 'own' 은 브랜드가 직접 올린 파일이다.
   *
   * 없으면 부스팅으로 읽는다 — 이 값이 생기기 전에 저장된 요청이 전부 부스팅이다.
   */
  source?: 'partnership' | 'own';
  /**
   * 아래 다섯 개는 부스팅에만 있다. 직접 올린 소재에는 캠페인도, 인플루언서도,
   * 파트너십 코드도 없다 — 그래서 있는 쪽만 채운다.
   */
  campaignId?: string;
  campaignTitle?: string;
  collabId?: string;
  creatorHandle?: string;
  partnershipCode?: string;
  /**
   * 광고 소재 썸네일. 부스팅은 이력에서 고른 게시물 썸네일, 직접 올린 소재는 업로드한
   * 파일에서 만든 작은 미리보기다. 없으면 광고 현황이 빈 자리로 그린다.
   */
  thumbnailUrl: string;
  /**
   * 아래는 직접 올린 소재에만 있다. 광고 목적과 소재·문구·연결 URL·페이지 —
   * 부스팅에서는 게시물이 이미 정해 두는 값들이다.
   */
  objective?: AdObjective;
  /** 업로드한 파일 이름·종류. 실제 업로드는 아직 하지 않고 이 기록만 남긴다. */
  creativeName?: string;
  creativeKind?: 'image' | 'video';
  headline?: string;
  bodyText?: string;
  cta?: AdCta;
  /** CTA 버튼을 눌렀을 때 가는 주소. 직접 올린 소재에서는 필수다. */
  linkUrl?: string;
  /** 광고가 어느 페이지 이름으로 나가는지(MOCK_AD_PAGES 의 id). */
  pageId?: string;
  /**
   * 집행할 광고 계정(act_… ). 연동한 계정 중 부스팅 창에서 고른 것이다.
   *
   * 광고는 계정 단위로 만들어지므로 요청에 계정이 남아 있어야 심사 후 그대로 집행할
   * 수 있다. 연동 전에 만든 옛 요청에는 없을 수 있어 optional 로 둔다 — 그 요청은
   * 광고 현황에서 어느 계정에서든 보이게 한다.
   */
  adAccountId?: string;
  budgetKrw: number;
  startDate: string;
  endDate: string;
  ageBands: string[];
  regions: string[];
  /** 'auto' 는 메타가 위치를 알아서 고르는 자동 노출. */
  placementMode: 'auto' | 'manual';
  placements: AdPlacement[];
};

const keyFor = (username: string) => `picks_ad_boosts_${username}`;

/** 같은 탭 안의 다른 화면(이력 → 광고 현황)에 바뀐 것을 알린다. */
const CHANGED_EVENT = 'picks:ad-boosts-changed';

export const readAdBoosts = (username: string): AdBoost[] => {
  try {
    const raw = localStorage.getItem(keyFor(username));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // 최신 요청이 목록 맨 위로 온다.
    return [...parsed].sort((a, b) => String(b?.requestedAt || '').localeCompare(String(a?.requestedAt || '')));
  } catch {
    return [];
  }
};

export const addAdBoost = (username: string, boost: AdBoost): void => {
  try {
    const next = [boost, ...readAdBoosts(username)].slice(0, 50);
    localStorage.setItem(keyFor(username), JSON.stringify(next));
  } catch {
    // 저장에 실패해도 집행 요청 자체는 성공으로 보여 준다 — 이 값은 화면 확인용이라
    // 저장 실패를 브랜드가 할 일로 바꿔 줄 방법이 없다.
  }
  try {
    window.dispatchEvent(new Event(CHANGED_EVENT));
  } catch {}
};

/** 광고 현황이 목록을 다시 읽도록 구독한다. 다른 탭에서 집행한 건도 받는다. */
export const subscribeAdBoosts = (onChange: () => void): (() => void) => {
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};

/** 타겟을 한 줄로 적는다. 비어 있으면 메타 기본값(전체)이라고 쓴다. */
export const targetSummary = (boost: Pick<AdBoost, 'ageBands' | 'regions'>): string => {
  const age = boost.ageBands.length ? boost.ageBands.join('·') : '연령 전체';
  const region = boost.regions.length ? boost.regions.join('·') : '전국';
  return `${age} · ${region}`;
};

/** 노출 위치를 한 줄로 적는다. */
export const placementSummary = (boost: Pick<AdBoost, 'placementMode' | 'placements'>): string => {
  if (boost.placementMode === 'auto') return '자동 노출';
  const labels = boost.placements
    .map((p) => AD_PLACEMENTS.find((x) => x.value === p)?.label)
    .filter(Boolean);
  return labels.length ? labels.join('·') : '자동 노출';
};
