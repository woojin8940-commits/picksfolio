/**
 * 인플루언서 인사이트 점수 — 팔로워 수와는 다른 축으로 명단을 정렬하기 위한 값.
 *
 * 운영자가 명단을 팔로워 순으로만 보면, 팔로워는 많지만 아무도 보지 않는 계정이
 * 늘 맨 위에 온다. 팔로워는 한번 쌓이면 잘 줄지 않기 때문이다. 그래서 "콘텐츠가
 * 실제로 잘 되고 있는가"를 한 숫자로 만들어 팔로워 순과 나란히 둔다.
 *
 * 규모가 아니라 비율로 계산한다. 평균 조회수를 그대로 쓰면 그건 결국 팔로워 순과
 * 같은 줄서기가 되고, 정렬을 하나 더 만든 의미가 없다. 대신 세 가지를 본다.
 *
 *  - 조회율: 평균 조회수 ÷ 팔로워. 올린 것이 팔로워에게 실제로 닿는 비율.
 *  - 반응률: (평균 좋아요 + 평균 댓글) ÷ 팔로워. 보고 나서 움직이는 비율.
 *  - 최근 동향: 최근 릴스 3개 평균을 그 이전 3개와 비교한 변화율. 지금 뜨는지 식는지.
 *
 * 세 값의 단위가 달라서 각각 0~100 으로 환산한 뒤 가중 평균한다. 만점 기준은 아래
 * 상수에 모아 두었다 — 수치를 조정할 때 계산식을 읽지 않아도 되도록.
 *
 * 동향이 없는 계정(릴스가 3개 이하)은 그 항목을 0 점으로 깎지 않고 계산에서 빼고
 * 남은 가중치를 다시 정규화한다. 0 점은 "나쁘다"는 뜻이고, 여기서 필요한 말은
 * "아직 알 수 없다"이기 때문이다.
 *
 * 지표가 아예 없는 계정은 0 점이 아니라 null 이다. 0 점으로 두면 "성과가 나쁜
 * 사람"과 "아직 연동하지 않은 사람"이 같은 자리에 섞인다 — 운영자가 해야 할 일이
 * 전혀 다른 두 집단이다. 화면은 null 을 '집계 전'으로 표시한다.
 *
 * 주의: 채널 지표를 본인이 손으로 적은 계정도 점수가 계산된다(그 숫자로 이미
 * 평균 조회수·참여율을 보여주고 있으므로 점수만 가리는 것은 일관되지 않다).
 * 대신 `verified` 로 출처를 함께 넘겨, 화면이 Meta 확인값과 자기 입력값을 구분해
 * 보여줄 수 있게 한다. 자기 입력만으로 명단 맨 위에 올라오는 일을 운영자가
 * 알아볼 수 있어야 한다.
 */

/** 조회율 만점 기준. 팔로워의 50% 가 볼 정도면 릴스로는 최상급이다. */
const VIEW_RATE_FULL = 0.5;

/** 반응률 만점 기준. 좋아요+댓글이 팔로워의 5% 면 상위권이다. */
const ENGAGEMENT_RATE_FULL = 0.05;

/**
 * 가중치. 조회율을 가장 크게 본다 — 브랜드가 캠페인에서 먼저 확인하는 숫자다.
 * 동향은 흔들리기 쉬워(한 편이 터지면 크게 튄다) 비중을 가장 작게 둔다.
 */
const WEIGHT = { views: 0.45, engagement: 0.35, trend: 0.2 };

export interface InsightInput {
  followers: number;
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  /** 최근 릴스 동향(%). 비교할 이전 구간이 없으면 null. */
  trendPercent?: number | null;
  /** 'meta_api' 면 검증된 지표. 그 밖의 값은 본인 입력으로 본다. */
  metricsSource?: string;
}

export interface InsightScore {
  /** 0~100. 클수록 좋다. */
  score: number;
  /** 조회율(%). 소수 첫째 자리까지. */
  viewRate: number;
  /** 반응률(%). 소수 첫째 자리까지. */
  engagementRate: number;
  trendPercent: number | null;
  /** Meta 연동으로 받아온 지표인지. */
  verified: boolean;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * 점수를 계산한다. 계산할 수 없으면 null.
 *
 * 팔로워를 모르면 비율을 만들 수 없고, 조회수와 반응이 모두 0 이면 아직 아무
 * 지표도 들어오지 않은 계정이다(성과가 0 인 계정과 구분해야 한다 — 실제로
 * 올렸는데 조회수가 0 인 계정은 없다).
 */
export const insightScoreOf = (input: InsightInput): InsightScore | null => {
  const followers = Number(input.followers || 0);
  const avgViews = Number(input.avgViews || 0);
  const reactions = Number(input.avgLikes || 0) + Number(input.avgComments || 0);
  if (followers <= 0) return null;
  if (avgViews <= 0 && reactions <= 0) return null;

  const viewRate = avgViews / followers;
  const engagementRate = reactions / followers;
  const trendPercent =
    typeof input.trendPercent === 'number' && Number.isFinite(input.trendPercent)
      ? input.trendPercent
      : null;

  const parts: Array<{ weight: number; value: number }> = [
    { weight: WEIGHT.views, value: clamp((viewRate / VIEW_RATE_FULL) * 100, 0, 100) },
    { weight: WEIGHT.engagement, value: clamp((engagementRate / ENGAGEMENT_RATE_FULL) * 100, 0, 100) },
  ];
  // 동향은 0% 가 중간(50점)이다. +50% 면 만점, -50% 면 0점.
  if (trendPercent !== null) {
    parts.push({ weight: WEIGHT.trend, value: clamp(50 + trendPercent, 0, 100) });
  }

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const score = parts.reduce((sum, p) => sum + p.weight * p.value, 0) / totalWeight;

  return {
    score: Math.round(score),
    viewRate: round1(viewRate * 100),
    engagementRate: round1(engagementRate * 100),
    trendPercent,
    verified: input.metricsSource === 'meta_api',
  };
};

/**
 * 정렬 비교용 값. 점수가 없는 계정은 -1 로 두어 항상 맨 아래에 놓는다
 * (0 점 계정보다도 아래여야 한다 — 0 점은 계산된 결과이고 -1 은 계산 불가다).
 */
export const insightSortValue = (input: InsightInput): number => {
  const result = insightScoreOf(input);
  return result ? result.score : -1;
};

/**
 * 점수 구간별 이름표와 색. Tailwind 클래스는 문자열을 이어 붙이지 않고
 * 이 표에서만 꺼낸다(빌드 시 클래스가 사라지지 않게).
 */
export const INSIGHT_GRADES = [
  { min: 75, label: '최상위', cls: 'bg-emerald-50 text-emerald-600' },
  { min: 55, label: '좋음', cls: 'bg-blue-50 text-blue-600' },
  { min: 35, label: '보통', cls: 'bg-slate-100 text-slate-500' },
  { min: 0, label: '낮음', cls: 'bg-amber-50 text-amber-600' },
] as const;

export const insightGrade = (score: number) =>
  INSIGHT_GRADES.find(g => score >= g.min) || INSIGHT_GRADES[INSIGHT_GRADES.length - 1];

/** 화면마다 같은 설명을 쓰도록 한 곳에 둔다. */
export const INSIGHT_HINT =
  '인사이트 점수는 조회율·반응률·최근 릴스 동향을 합친 값입니다. 팔로워 규모와 무관하게 콘텐츠 성과만 봅니다.';
