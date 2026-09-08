/**
 * 협업 현황 달력의 캠페인 색 한 곳.
 *
 * 달력의 점은 오랫동안 "상태"만 색으로 말했다 — 예정은 파랑, 완료는 초록, 마감이 지난
 * 건은 빨강. 그래서 한 달에 다섯 캠페인을 진행하면 칸마다 똑같은 파란 막대가 겹쳐
 * 놓이고, 어느 막대가 어느 캠페인인지는 글자를 끝까지 읽어야만 알 수 있었다(칸이
 * 좁아 제목은 대개 잘려 있다).
 *
 * 그래서 색이 답하는 질문을 "무슨 상태인가" 에서 "어느 캠페인인가" 로 옮긴다. 상태는
 * 아이콘(⬆️ · ⚠️ · ✅ · 💰 · 💸)과 글자색으로 남는다 — 아이콘은 잘리지 않는 맨 앞에
 * 붙으므로 좁은 칸에서도 상태를 읽을 수 있다.
 *
 * 색은 캠페인 이름에서 계산한다. 어디에도 저장하지 않는 이유는, 저장하면 캠페인마다
 * 색을 들고 다녀야 하고(달력 · 상세 · 협업 내역이 각자 다른 경로로 같은 캠페인을
 * 읽는다) 새 캠페인이 생길 때마다 색을 정해 줄 사람이 필요해지기 때문이다. 이름이
 * 같으면 언제 어느 화면에서 그려도 같은 색이 나오므로 그 일이 아예 없다.
 */

/**
 * 캠페인 색 팔레트.
 *
 * 배경은 연한 톤, 글자는 같은 계열의 진한 톤이다(Tailwind 100 · 700 정도의 관계).
 * 빨강 · 초록 계열은 일부러 넣지 않았다 — 그 두 색은 달력에서 '마감 지남' 과 '완료'
 * 라는 뜻을 이미 갖고 있어서, 캠페인 색으로 쓰면 상태를 잘못 읽게 된다.
 */
export const CAMPAIGN_CHIP_COLORS: Array<{ bg: string; text: string; dot: string }> = [
  { bg: '#DBEAFE', text: '#1D4ED8', dot: '#3B82F6' }, // 블루
  { bg: '#EDE9FE', text: '#6D28D9', dot: '#8B5CF6' }, // 바이올렛
  { bg: '#FEF3C7', text: '#B45309', dot: '#F59E0B' }, // 앰버
  { bg: '#CCFBF1', text: '#0F766E', dot: '#14B8A6' }, // 티일
  { bg: '#FCE7F3', text: '#BE185D', dot: '#EC4899' }, // 핑크
  { bg: '#E0E7FF', text: '#4338CA', dot: '#6366F1' }, // 인디고
  { bg: '#FFEDD5', text: '#C2410C', dot: '#F97316' }, // 오렌지
  { bg: '#CFFAFE', text: '#0E7490', dot: '#06B6D4' }, // 시안
  { bg: '#FAE8FF', text: '#A21CAF', dot: '#D946EF' }, // 푸시아
  { bg: '#ECFCCB', text: '#4D7C0F', dot: '#84CC16' }, // 라임
  { bg: '#E0F2FE', text: '#0369A1', dot: '#0EA5E9' }, // 스카이
  { bg: '#F3E8FF', text: '#7E22CE', dot: '#A855F7' }, // 퍼플
];

/** 취소된 일정. 캠페인 색을 주지 않는다 — 지워진 약속은 눈에 덜 걸려야 한다. */
export const CANCELLED_CHIP_COLOR = { bg: '#F1F5F9', text: '#94A3B8', dot: '#CBD5E1' };

/**
 * 캠페인을 가리키는 키.
 *
 * 캠페인 id 가 있으면 그것이 가장 정확하다. 다만 달력에는 캠페인 id 가 없는 줄도
 * 섞인다(브랜드가 직접 보낸 제안 · 직접 남긴 협업 기록 · 정산 항목). 그런 줄은
 * 업체명과 제목으로 같은 캠페인을 알아본다 — 업로드 점과 정산 점이 같은 색이어야
 * 두 점이 한 캠페인의 일이라는 것이 보인다.
 */
export function campaignColorKey(...parts: Array<string | undefined | null>): string {
  return parts
    .map(p => (p || '').trim().toLowerCase())
    .filter(Boolean)
    .join('|');
}

/** 문자열 → 팔레트 index. FNV-1a 계열의 단순 해시로, 같은 이름은 늘 같은 색이 된다. */
function hashIndex(key: string, size: number): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % size;
}

/** 캠페인 하나의 색. 키가 비어 있으면 팔레트의 첫 색(블루)으로 둔다. */
export function campaignChipColor(key: string) {
  if (!key) return CAMPAIGN_CHIP_COLORS[0];
  return CAMPAIGN_CHIP_COLORS[hashIndex(key, CAMPAIGN_CHIP_COLORS.length)];
}

/**
 * 화면에 놓인 캠페인들에 색을 나눠 준 표.
 *
 * 해시만 쓰면 캠페인 두 개가 우연히 같은 색을 뽑는 일이 생긴다 — 그러면 색을 캠페인
 * 구분에 쓰자던 이유가 그 달만 사라진다. 그래서 지금 달력에 있는 캠페인 목록을 한 번
 * 훑어, 이미 누가 쓰고 있는 색이면 다음 빈 색으로 넘긴다(팔레트를 다 쓰면 다시
 * 해시 색으로 돌아간다 — 열두 개가 넘게 겹치는 달은 어차피 색으로 세지 않는다).
 *
 * 키를 정렬해서 순서대로 배정하므로, 같은 캠페인 묶음이면 몇 번을 다시 그려도 같은
 * 색이 나온다.
 */
export function buildCampaignColorMap(keys: Array<string>) {
  const unique = Array.from(new Set(keys.filter(Boolean))).sort();
  const taken = new Set<number>();
  const map = new Map<string, (typeof CAMPAIGN_CHIP_COLORS)[number]>();
  for (const key of unique) {
    let index = hashIndex(key, CAMPAIGN_CHIP_COLORS.length);
    if (taken.size < CAMPAIGN_CHIP_COLORS.length) {
      let steps = 0;
      while (taken.has(index) && steps < CAMPAIGN_CHIP_COLORS.length) {
        index = (index + 1) % CAMPAIGN_CHIP_COLORS.length;
        steps++;
      }
      taken.add(index);
    }
    map.set(key, CAMPAIGN_CHIP_COLORS[index]);
  }
  return map;
}
