/**
 * 인플루언서가 스스로 고르는 활동 카테고리.
 *
 * 예전에는 "뷰티, 패션 등" 이라는 안내가 붙은 빈 입력칸 하나였다. 그러면 같은
 * 분야가 사람마다 "뷰티" / "뷰티/코스메틱" / "beauty" / "메이크업" 으로 적히고,
 * 담당자가 캠페인에 맞는 사람을 고를 때 카테고리로 추릴 수가 없다. 어떤 사람은
 * 아무 것도 적지 않는다 — 무엇을 적어야 하는지 몰라서다.
 *
 * 그래서 캠페인 카테고리와 같은 목록을 눌러서 고르게 하고, 여러 개 고를 수
 * 있게 한다(대부분의 인플루언서는 한 분야만 하지 않는다). 목록에 없는 분야는
 * 직접 추가한다 — 목록을 닫아 두면 "홈카페", "자취 브이로그" 처럼 실제로
 * 존재하는 분야가 전부 "기타" 로 뭉개진다.
 *
 * 저장은 캠페인 카테고리처럼 slug 를 쓰지 않고, 고른 이름을 그대로 쉼표로 이어
 * 문자열 한 칸에 넣는다. 직접 추가한 분야에는 애초에 slug 가 없어서 두 방식이
 * 섞이면 화면마다 다시 이름표를 찾아 붙여야 하고, 운영자 명단·브랜드 카드는
 * 이 값을 그대로 읽어 보여 주기 때문이다.
 */

/** 캠페인 카테고리와 같은 14개. 순서도 같게 둔다. */
export const CREATOR_CATEGORIES = [
  '뷰티', '패션', '식품', '라이프스타일', '여행', '건강', 'IT/테크',
  '육아', '반려동물', '인테리어', '스포츠', '엔터테인먼트', '교육', '기타',
] as const;

/** "뷰티, 패션" → ['뷰티', '패션']. 빈 값·중복·앞뒤 공백을 정리한다. */
export const parseCategoryList = (raw: string | null | undefined): string[] => {
  const parts = String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
};

/** ['뷰티', '패션'] → "뷰티, 패션". 저장/전송용 한 칸. */
export const joinCategoryList = (list: string[]): string =>
  Array.from(new Set(list.map(s => s.trim()).filter(Boolean))).join(', ');

/**
 * 화면에 그릴 칩 목록. 기본 14개 뒤에, 직접 추가해서 고른 분야를 붙인다.
 * (고른 것을 목록에 넣지 않으면 직접 추가한 분야를 다시 뺄 방법이 없다.)
 */
export const categoryOptions = (selected: string[]): string[] => [
  ...CREATOR_CATEGORIES,
  ...selected.filter(s => !CREATOR_CATEGORIES.includes(s as typeof CREATOR_CATEGORIES[number])),
];
