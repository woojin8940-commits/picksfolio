import type { InsightReel } from '../services/apiService';

/**
 * 콘텐츠 코칭 — 반응이 좋았던 릴스들의 공통점을 문장으로 만든다.
 *
 * 여기서 하는 일은 통계가 아니라 요약이다. 상위 릴스 몇 편의 길이·게시 요일·시간대를
 * 세어 가장 잦은 값을 말해 준다. 숫자를 나열하는 대신 문장으로 만드는 이유는, 이 화면을
 * 보는 사람이 알고 싶은 것이 "평균 32.4초"가 아니라 "다음 편을 몇 초로 만들까"이기
 * 때문이다.
 *
 * 표본이 적으면 아무 말도 하지 않는다. 릴스 세 편으로 "주로 화요일에 올렸다"고 말하면
 * 그건 발견이 아니라 우연이고, 그 말을 믿고 요일을 맞춘 사람은 우리 때문에 헛수고를
 * 한다. 그래서 MIN_REELS 미만이면 섹션 자체가 뜨지 않는다(visible=false).
 *
 * 기준 지표는 저장수다. 저장은 "나중에 다시 볼 만하다"는 뜻이라 조회수보다 콘텐츠의
 * 힘에 가깝다. 저장수를 못 받는 계정(권한 미승인)에서는 도달 → 조회수로 내려간다.
 */

/** 이만큼은 있어야 공통점을 말한다. 이 미만이면 섹션을 숨긴다. */
export const MIN_REELS = 5;
/** 공통점을 뽑아볼 상위 릴스 수. 전체의 3분의 1 정도, 최소 3편. */
const topCount = (total: number) => Math.max(3, Math.round(total / 3));

export const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
export const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 한국 시간 기준 요일 인덱스(0=일). 파싱 실패하면 null. */
export const seoulWeekday = (iso: string): number | null => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const label = new Date(t).toLocaleDateString('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' });
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(label);
  return idx >= 0 ? idx : null;
};

/** 한국 시간 기준 시(0-23). 파싱 실패하면 null. */
export const seoulHour = (iso: string): number | null => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const hh = new Date(t).toLocaleString('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    hour12: false,
  });
  const n = Number(hh.slice(0, 2));
  return Number.isFinite(n) ? n : null;
};

/** 시간대 구간. "14시"보다 "오후"가 다음 편을 올릴 때 쓸 수 있는 말이다. */
export const TIME_BANDS: { from: number; to: number; ko: string; en: string }[] = [
  { from: 5, to: 8, ko: '이른 아침', en: 'early morning' },
  { from: 9, to: 11, ko: '오전', en: 'the morning' },
  { from: 12, to: 14, ko: '점심때', en: 'around lunchtime' },
  { from: 15, to: 17, ko: '늦은 오후', en: 'the late afternoon' },
  { from: 18, to: 21, ko: '저녁', en: 'the evening' },
  { from: 22, to: 23, ko: '밤늦게', en: 'late at night' },
  { from: 0, to: 4, ko: '새벽', en: 'the small hours' },
];

export const bandOf = (hour: number) =>
  TIME_BANDS.find((b) => (b.from <= b.to ? hour >= b.from && hour <= b.to : hour >= b.from || hour <= b.to));

/** 가장 많이 나온 값과 그 횟수. 동수면 먼저 나온 값. */
function mode<T>(values: T[]): { value: T; count: number } | null {
  if (values.length === 0) return null;
  const tally = new Map<T, number>();
  for (const v of values) tally.set(v, (tally.get(v) || 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of tally) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export type CoachingMetric = 'saved' | 'reach' | 'views';

export interface ReelCoaching {
  /** false 면 섹션 자체를 그리지 않는다. */
  visible: boolean;
  /** 상위 릴스를 고른 기준. 화면이 "저장수 기준"을 밝힐 때 쓴다. */
  metric: CoachingMetric;
  /** 공통점을 본 릴스 수. */
  sampled: number;
  /** 화면에 그대로 올릴 문장들. 비어 있으면 할 말이 없다는 뜻이다. */
  lines: string[];
}

/**
 * 무엇을 기준으로 상위를 고를지. 저장수 → 도달 → 조회수 순으로 내려간다.
 * 값이 전부 0/null 인 지표로 정렬하면 순서가 사실 그냥 최신순이 된다.
 */
function pickMetric(reels: InsightReel[]): CoachingMetric {
  if (reels.some((r) => (r.saved ?? 0) > 0)) return 'saved';
  if (reels.some((r) => (r.reach ?? 0) > 0)) return 'reach';
  return 'views';
}

const valueOf = (reel: InsightReel, metric: CoachingMetric): number =>
  metric === 'saved' ? reel.saved ?? 0 : metric === 'reach' ? reel.reach ?? 0 : reel.views;

export function buildReelCoaching(reels: InsightReel[], isEn = false): ReelCoaching {
  const usable = (reels || []).filter((r) => r && r.timestamp);
  if (usable.length < MIN_REELS) {
    return { visible: false, metric: 'views', sampled: 0, lines: [] };
  }

  const metric = pickMetric(usable);
  const top = [...usable].sort((a, b) => valueOf(b, metric) - valueOf(a, metric)).slice(0, topCount(usable.length));

  const lines: string[] = [];

  // ① 평균 길이. 메타가 길이를 안 주는 계정도 있으므로 받은 것만으로 계산하고,
  //    한 편도 없으면 이 문장은 아예 만들지 않는다.
  const durations = top.map((r) => r.durationSeconds).filter((d): d is number => typeof d === 'number' && d > 0);
  if (durations.length > 0) {
    const avg = round1(durations.reduce((a, b) => a + b, 0) / durations.length);
    lines.push(
      isEn
        ? `Your best-performing reels ran about ${avg} seconds on average.`
        : `반응이 좋았던 릴스는 평균 ${avg}초 길이였어요.`,
    );
  }

  // ② 게시 요일. 상위 릴스의 절반 이상이 같은 요일일 때만 말한다. 흩어져 있는데
  //    "주로 화요일"이라고 하면 없는 규칙을 만들어 주는 셈이다.
  const weekdays = top.map((r) => seoulWeekday(r.timestamp)).filter((d): d is number => d !== null);
  const topDay = mode(weekdays);
  if (topDay && topDay.count >= Math.ceil(weekdays.length / 2) && topDay.count >= 2) {
    lines.push(
      isEn
        ? `Most of them went up on ${WEEKDAYS_EN[topDay.value]} (${topDay.count} of ${weekdays.length}).`
        : `그중 ${topDay.count}편이 ${WEEKDAYS_KO[topDay.value]}요일에 올라갔어요.`,
    );
  }

  // ③ 시간대. 요일과 같은 기준.
  const bands = top
    .map((r) => seoulHour(r.timestamp))
    .filter((h): h is number => h !== null)
    .map((h) => bandOf(h)?.ko || '')
    .filter(Boolean);
  const bandsEn = top
    .map((r) => seoulHour(r.timestamp))
    .filter((h): h is number => h !== null)
    .map((h) => bandOf(h)?.en || '')
    .filter(Boolean);
  const topBand = mode(isEn ? bandsEn : bands);
  if (topBand && topBand.count >= Math.ceil(bands.length / 2) && topBand.count >= 2) {
    lines.push(
      isEn
        ? `They were mostly posted in ${topBand.value}.`
        : `게시 시간은 주로 ${topBand.value}였어요.`,
    );
  }

  // ④ 상위 릴스가 나머지보다 얼마나 앞섰는지. 기준 지표에 값이 있을 때만.
  const rest = usable.filter((r) => !top.includes(r));
  const avgTop = top.reduce((a, r) => a + valueOf(r, metric), 0) / (top.length || 1);
  const avgRest = rest.length > 0 ? rest.reduce((a, r) => a + valueOf(r, metric), 0) / rest.length : 0;
  if (avgTop > 0 && avgRest > 0) {
    const times = round1(avgTop / avgRest);
    if (times >= 1.3) {
      const metricKo = metric === 'saved' ? '저장수' : metric === 'reach' ? '도달' : '조회수';
      const metricEn = metric === 'saved' ? 'saves' : metric === 'reach' ? 'reach' : 'views';
      lines.push(
        isEn
          ? `That group averaged ${times}× the ${metricEn} of your other reels.`
          : `이 릴스들의 ${metricKo}는 나머지 릴스 평균의 ${times}배였어요.`,
      );
    }
  }

  return { visible: lines.length > 0, metric, sampled: top.length, lines };
}
