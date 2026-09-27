/**
 * 콘텐츠 부스팅 — 이력에서 고른 게시물을 광고로 돌린 기록.
 *
 * 브랜드는 캠페인 이력에서 잘 된 콘텐츠를 찾고, 광고 현황에서 돌아가는 광고를 본다.
 * 그 사이의 동작("이걸 광고로 돌려줘")이 두 화면 중 어디에도 없어서, 지금은 파트너십
 * 코드를 손으로 옮겨 메타 광고 관리자에서 따로 만들어야 한다. 부스팅은 그 동작을
 * 이력 화면 안으로 가져온다.
 *
 * 이 파일은 집행 조건(노출 위치 · 연령 · 지역 · 광고 목적 · CTA)의 선택지와, 그것을
 * 한 줄로 적는 함수만 둔다. 실제 집행은 api-meta-ads-ads 가 메타 Marketing API 로
 * 캠페인 · 광고 세트 · 소재 · 광고를 만들고 그 ID 를 서버에 기록한다(utils/metaAdsApi).
 * 페이지 목록도 메타에서 읽는다(GET /me/accounts, useMetaPages).
 *
 * 예전에는 심사 전이라 집행 요청을 브라우저(localStorage)에만 남겼다. 그 임시 기록은
 * 더 이상 읽지 않는다 — 메타에 없는 광고가 목록에 섞이면 안 되기 때문이다.
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

/** 타겟을 한 줄로 적는다. 비어 있으면 메타 기본값(전체)이라고 쓴다. */
export const targetSummary = (boost: { ageBands: string[]; regions: string[] }): string => {
  const age = boost.ageBands.length ? boost.ageBands.join('·') : '연령 전체';
  const region = boost.regions.length ? boost.regions.join('·') : '전국';
  return `${age} · ${region}`;
};

/** 노출 위치를 한 줄로 적는다. */
export const placementSummary = (boost: { placementMode: 'auto' | 'manual'; placements: readonly string[] }): string => {
  if (boost.placementMode === 'auto') return '자동 노출';
  const labels = boost.placements
    .map((p) => AD_PLACEMENTS.find((x) => x.value === p)?.label)
    .filter(Boolean);
  return labels.length ? labels.join('·') : '자동 노출';
};
