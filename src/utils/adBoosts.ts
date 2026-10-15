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
  { value: 'feed', label: '인스타 피드', group: 'instagram' },
  { value: 'ig_profile_feed', label: '인스타 프로필 피드', group: 'instagram' },
  { value: 'story', label: '인스타 스토리', group: 'instagram' },
  { value: 'reels', label: '인스타 릴스', group: 'instagram' },
  { value: 'explore', label: '인스타 탐색', group: 'instagram' },
  { value: 'fb_feed', label: '페이스북 피드', group: 'facebook' },
  { value: 'fb_story', label: '페이스북 스토리', group: 'facebook' },
  { value: 'fb_reels', label: '페이스북 릴스', group: 'facebook' },
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
 * 상세 타겟팅 카테고리. 관심사를 하나씩 검색해 고르는 대신, 자주 쓰는 묶음을 미리
 * 정해 두고 카테고리만 고르게 한다. 키워드는 메타 관심사 이름(영문이 가장 잘 맞는다)이고,
 * 고르는 순간 메타 목록에서 찾아 실제 관심사 ID 로 바꾼다.
 */
export const AD_INTEREST_CATEGORIES = [
  { key: 'beauty', label: '뷰티', keywords: ['Beauty', 'Cosmetics', 'Skin care', 'Makeup', 'Perfume'] },
  { key: 'fashion', label: '패션', keywords: ['Fashion', 'Clothing', 'Shoes', 'Handbags', 'Fashion accessories'] },
  { key: 'parenting', label: '육아', keywords: ['Parenting', 'Motherhood', 'Baby food', 'Toddlers', "Children's clothing"] },
  { key: 'food', label: '푸드·맛집', keywords: ['Food', 'Restaurants', 'Cooking', 'Desserts', 'Coffee'] },
  { key: 'fitness', label: '건강·운동', keywords: ['Physical fitness', 'Health & wellness', 'Dieting', 'Yoga', 'Nutrition'] },
  { key: 'travel', label: '여행', keywords: ['Travel', 'Hotels', 'Vacations', 'Air travel', 'Tourism'] },
  { key: 'living', label: '리빙·인테리어', keywords: ['Interior design', 'Home improvement', 'Furniture', 'Home Appliances'] },
  { key: 'pets', label: '반려동물', keywords: ['Pets', 'Dogs', 'Cats', 'Pet food'] },
  { key: 'tech', label: 'IT·가전', keywords: ['Technology', 'Consumer electronics', 'Smartphones', 'Computers'] },
  { key: 'games', label: '게임', keywords: ['Video games', 'Mobile games', 'Online games'] },
] as const;

export type AdInterestCategory = (typeof AD_INTEREST_CATEGORIES)[number]['key'];

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

export const findObjective = (value: string | undefined) =>
  AD_OBJECTIVES.find((o) => o.value === value) || null;

/** CTA 버튼 문구. 메타 광고의 call_to_action 과 같은 선택지만 둔다. */
export const AD_CTAS = [
  { value: 'learn_more', label: '더 알아보기' },
  { value: 'see_more', label: '자세히 보기' },
  { value: 'shop_now', label: '지금 구매' },
  { value: 'sign_up', label: '가입하기' },
  { value: 'book_now', label: '지금 예약' },
  { value: 'contact_us', label: '문의하기' },
  // 아래는 광고 관리자의 '웹사이트' 도착 위치에서 고를 수 있는 나머지 버튼이다.
  { value: 'order_now', label: '지금 주문하기' },
  { value: 'buy_now', label: '지금 구매하기' },
  { value: 'get_offer', label: '혜택 받기' },
  { value: 'apply_now', label: '지금 신청하기' },
  { value: 'subscribe', label: '구독하기' },
  { value: 'download', label: '다운로드' },
  { value: 'get_quote', label: '견적 받기' },
  { value: 'see_menu', label: '메뉴 보기' },
  { value: 'watch_more', label: '더 보기' },
  { value: 'buy_tickets', label: '티켓 구매' },
  { value: 'request_time', label: '시간 요청' },
  { value: 'get_showtimes', label: '상영 시간 보기' },
  { value: 'listen_now', label: '지금 듣기' },
  { value: 'donate_now', label: '지금 기부하기' },
  { value: 'inquire_now', label: '지금 문의하기' },
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
  awareness: ['learn_more', 'see_more', 'contact_us', 'sign_up', 'book_now', 'shop_now'],
  traffic: ['see_more', 'learn_more', 'shop_now', 'book_now', 'sign_up', 'contact_us'],
  conversions: ['shop_now', 'buy_now', 'order_now', 'see_more', 'get_offer', 'learn_more', 'sign_up', 'book_now', 'contact_us'],
};

export const ctasForObjective = (objective: AdObjective) => {
  const order = CTA_ORDER[objective] || [];
  // 순서에 없는 문구는 원래 순서대로 뒤에 둔다(indexOf 가 -1 이면 맨 앞으로 올라간다).
  const rank = (v: AdCta) => {
    const i = order.indexOf(v);
    return i < 0 ? order.length + AD_CTAS.findIndex((c) => c.value === v) : i;
  };
  return [...AD_CTAS].sort((a, b) => rank(a.value) - rank(b.value));
};

export const ctaLabel = (value: AdCta | undefined): string =>
  AD_CTAS.find((c) => c.value === value)?.label || '';

/* ---------------------------------------------------------------------------------------- */
/* 광고 관리자와 같은 이름의 세부 설정                                                       */
/*                                                                                          */
/* 메타 광고 관리자에서 마케터가 실제로 손대는 값만 옮겨 둔다 — 캠페인 목표 · 성과 목표 ·    */
/* 전환 이벤트 · 예산 유형 · 입찰 전략 · 성별/연령 · 상세 타겟팅 · 맞춤 타겟 · Advantage+.   */
/* 이름은 광고 관리자 한국어 화면의 말을 그대로 쓴다. 같은 광고를 광고 관리자에서 열었을 때  */
/* 같은 말이 보여야 이 화면에서 정한 값이 그대로 들어갔는지 확인할 수 있다.                 */
/* ---------------------------------------------------------------------------------------- */

/**
 * 부스팅의 캠페인 목표. 직접 만들기의 세 목표에 '참여'가 더해진다 — 이미 반응이 좋은
 * 인플루언서 게시물에 좋아요·댓글·조회를 더 붙이는 것은 부스팅에서만 의미가 있다.
 */
export const BOOST_OBJECTIVES = [
  { value: 'conversions', label: '판매', hint: '구매 · 장바구니 등 웹사이트 전환' },
  { value: 'traffic', label: '트래픽', hint: '웹사이트 방문 · 링크 클릭' },
  { value: 'engagement', label: '참여', hint: '게시물 반응 · 동영상 조회' },
  { value: 'awareness', label: '인지도', hint: '최대한 많은 사람에게 도달' },
] as const;

export type BoostObjective = (typeof BOOST_OBJECTIVES)[number]['value'];

/** 목표별 성과 목표(광고 세트의 optimization_goal). 맨 앞이 메타의 기본값이다. */
export const PERFORMANCE_GOALS: Record<BoostObjective, { value: string; label: string; hint: string }[]> = {
  conversions: [
    { value: 'OFFSITE_CONVERSIONS', label: '전환수 최대화', hint: '고른 전환 이벤트가 일어날 사람에게 노출합니다' },
    { value: 'VALUE', label: '전환 가치 최대화', hint: '구매 금액이 클 사람에게 노출합니다(구매 이벤트 · 금액 전송 필요)' },
    { value: 'LANDING_PAGE_VIEWS', label: '랜딩 페이지 조회수 최대화', hint: '픽셀이 페이지 로드를 확인한 방문만 셉니다' },
    { value: 'LINK_CLICKS', label: '링크 클릭수 최대화', hint: '픽셀이 없거나 이벤트가 적을 때 씁니다' },
  ],
  traffic: [
    { value: 'LINK_CLICKS', label: '링크 클릭수 최대화', hint: '광고 링크를 누를 사람에게 노출합니다' },
    { value: 'LANDING_PAGE_VIEWS', label: '랜딩 페이지 조회수 최대화', hint: '페이지가 실제로 열린 방문만 셉니다(픽셀 필요)' },
    { value: 'REACH', label: '일일 고유 도달 최대화', hint: '하루 한 번씩 최대한 많은 사람에게 노출합니다' },
  ],
  engagement: [
    { value: 'POST_ENGAGEMENT', label: '참여 최대화', hint: '좋아요 · 댓글 · 공유 · 저장을 늘립니다' },
    { value: 'THRUPLAY', label: 'ThruPlay 조회수 최대화', hint: '동영상을 15초 이상(짧으면 끝까지) 본 수를 늘립니다' },
    { value: 'REACH', label: '도달 최대화', hint: '최대한 많은 사람에게 노출합니다' },
  ],
  awareness: [
    { value: 'REACH', label: '도달 최대화', hint: '최대한 많은 사람에게 한 번 이상 노출합니다' },
    { value: 'IMPRESSIONS', label: '노출 최대화', hint: '같은 사람에게 여러 번 보여도 노출 횟수를 늘립니다' },
    { value: 'AD_RECALL_LIFT', label: '광고 상기도 성과 증대', hint: '광고를 기억할 가능성이 높은 사람에게 노출합니다' },
  ],
};

/** 판매 목표의 전환 이벤트(픽셀 표준 이벤트). */
export const CONVERSION_EVENTS = [
  { value: 'PURCHASE', label: '구매' },
  { value: 'ADD_TO_CART', label: '장바구니에 담기' },
  { value: 'INITIATED_CHECKOUT', label: '결제 시작' },
  { value: 'ADD_PAYMENT_INFO', label: '결제 정보 추가' },
  { value: 'COMPLETE_REGISTRATION', label: '등록 완료' },
  { value: 'LEAD', label: '잠재 고객' },
  { value: 'CONTENT_VIEW', label: '콘텐츠 조회' },
] as const;

/** 입찰 전략. 광고 관리자 이름 그대로. */
export const BID_STRATEGIES = [
  { value: 'lowest_cost', label: '최고 볼륨', hint: '예산을 다 쓰면서 결과를 최대한 많이 냅니다(기본값)' },
  { value: 'cost_cap', label: '결과당 비용 목표', hint: '평균 결과당 비용을 목표 금액 근처로 맞춥니다' },
  { value: 'bid_cap', label: '입찰가 한도', hint: '경매마다 입찰가가 이 금액을 넘지 않게 합니다' },
] as const;

export type BidStrategy = (typeof BID_STRATEGIES)[number]['value'];

export const AD_GENDERS = [
  { value: 'all', label: '전체' },
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
] as const;

export type AdGender = (typeof AD_GENDERS)[number]['value'];

/** 메타가 받는 연령 범위. 65 는 '65세 이상'이다. */
export const AD_AGE_MIN = 18;
export const AD_AGE_MAX = 65;

/** 상세 타겟팅 · 맞춤 타겟 한 줄. 이름은 화면과 요약에만 쓰고, 메타에는 id 만 보낸다. */
export type AdTargetItem = { id: string; name: string };

/** 타겟을 한 줄로 적는다. 비어 있으면 메타 기본값(전체)이라고 쓴다. */
export const targetSummary = (boost: {
  ageBands: string[];
  regions: string[];
  ageMin?: number;
  ageMax?: number;
  gender?: AdGender;
  interests?: AdTargetItem[];
  audiences?: AdTargetItem[];
}): string => {
  const age =
    boost.ageMin || boost.ageMax
      ? `${boost.ageMin || AD_AGE_MIN}~${(boost.ageMax || AD_AGE_MAX) >= AD_AGE_MAX ? '65+' : boost.ageMax}세`
      : boost.ageBands.length
      ? boost.ageBands.join('·')
      : '연령 전체';
  const region = boost.regions.length ? boost.regions.join('·') : '대한민국';
  const gender = boost.gender && boost.gender !== 'all' ? AD_GENDERS.find((g) => g.value === boost.gender)?.label : '';
  const extra = [
    boost.interests?.length ? `관심사 ${boost.interests.length}개` : '',
    boost.audiences?.length ? `맞춤 타겟 ${boost.audiences.length}개` : '',
  ];
  return [age, gender, region, ...extra].filter(Boolean).join(' · ');
};

/** 노출 위치를 한 줄로 적는다. */
export const placementSummary = (boost: { placementMode: 'auto' | 'manual'; placements: readonly string[] }): string => {
  if (boost.placementMode === 'auto') return '자동 노출';
  const labels = boost.placements
    .map((p) => AD_PLACEMENTS.find((x) => x.value === p)?.label)
    .filter(Boolean);
  return labels.length ? labels.join('·') : '자동 노출';
};
