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

export type AdBoost = {
  id: string;
  /** 집행 요청 시각(ISO). 광고 현황에서 최신순으로 올린다. */
  requestedAt: string;
  campaignId: string;
  campaignTitle: string;
  collabId: string;
  creatorHandle: string;
  partnershipCode: string;
  /** 광고 소재로 쓰는 게시물 썸네일. 없으면 광고 현황이 빈 자리로 그린다. */
  thumbnailUrl: string;
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
