/**
 * 릴스 조회수 동향.
 *
 * 브랜드가 후보를 고를 때 평균 조회수 하나만 보면 터진 영상 한 개로 계정 전체를
 * 잘못 판단한다. 그래서 최근 절반과 그 이전 절반의 평균을 비교해 "지금 올라가는
 * 계정인가"를 보여주고, 평균 대비 최고·최저를 같이 낸다. 최고가 평균의 몇 배씩
 * 벌어지는 계정은 평균값이 다음 협업에서 재현되지 않는다는 뜻이다.
 *
 * 회차별 꺾은선은 그리지 않는다. 이 값을 쓰는 곳이 모두 후보 카드 안이고, 후보
 * 열 명을 나란히 볼 때 필요한 것은 한 줄 요약이다 — 그래프는 자리만 차지한다.
 *
 * 계산을 여기 한 군데 둔 이유는 화면이 둘이기 때문이다(브랜드 리스트업 보드 ·
 * 담당자·브랜드 공용 후보 카드). 같은 계정을 두 화면에서 봤을 때 "상승"과 "하락"이
 * 갈리면 어느 화면도 못 믿게 된다.
 */

export type ReelTrend = {
  /** 조회수를 받은 릴스 편수. 조회수 비공개 영상은 세지 않는다. */
  sampled: number;
  recent: number;
  previous: number;
  /** 증감률(%). 비교할 이전 편이 없으면 null — 0 으로 적으면 "변화 없음"으로 읽힌다. */
  percent: number | null;
  best: number;
  worst: number;
  average: number;
};

const mean = (nums: number[]) =>
  nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;

/** 저장된 릴스(최신순, 최대 6편)로 동향을 낸다. 조회수를 하나도 못 받으면 null. */
export const reelTrendOf = (reels: any[]): ReelTrend | null => {
  const views = (Array.isArray(reels) ? reels : [])
    .map((r: any) => Number(r?.views || 0))
    .filter((n) => n > 0);
  if (views.length === 0) return null;

  const half = Math.ceil(views.length / 2);
  const recent = mean(views.slice(0, half));
  const previous = views.length > half ? mean(views.slice(half)) : 0;
  return {
    sampled: views.length,
    recent,
    previous,
    percent: previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null,
    best: Math.max(...views),
    worst: Math.min(...views),
    average: mean(views),
  };
};

/** 클래스 이름은 문자열 조립 없이 표에서 꺼내야 Tailwind 가 살려 둔다. */
const TREND_TONE = {
  up: { label: '상승', cls: 'bg-emerald-50 text-emerald-600' },
  down: { label: '하락', cls: 'bg-rose-50 text-rose-500' },
  flat: { label: '유지', cls: 'bg-slate-100 text-slate-500' },
};

/** ±10% 안쪽은 '유지'로 본다. 릴스 조회수는 그 정도 폭으로 늘 흔들린다. */
export const trendTone = (percent: number) =>
  percent > 10 ? TREND_TONE.up : percent < -10 ? TREND_TONE.down : TREND_TONE.flat;

/** 편차가 세 배를 넘으면 평균값을 그대로 믿지 말라고 알려 준다. */
export const trendIsVolatile = (trend: ReelTrend) =>
  trend.average > 0 && trend.best >= trend.average * 3;
