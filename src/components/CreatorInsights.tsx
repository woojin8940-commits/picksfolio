import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LineChart, ComposedChart, Line, Bar, Cell, ReferenceLine, LabelList,
  PieChart, Pie, RadarChart, PolarGrid, PolarAngleAxis, Radar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  apiService,
  type BenchmarkMetricKey,
  type BenchmarkResponse,
  type CreatorInsightsResponse,
  type FollowerDemographicsResponse,
  type FollowerSeriesResponse,
  type InsightReel,
} from '../services/apiService';
import { useLanguage } from '../contexts/LanguageContext';
import {
  bandOf,
  buildReelCoaching,
  MIN_REELS,
  seoulHour,
  seoulWeekday,
  TIME_BANDS,
  WEEKDAYS_KO,
  type ReelCoaching,
} from '../utils/reelCoaching';

/**
 * 인사이트 — 인플루언서 본인이 자기 계정 성과를 보는 화면.
 *
 * 이 화면은 새 연동을 만들지 않는다. 캠페인 등록에서 붙여 둔 계정(없으면 디엠
 * 자동화에 붙여 둔 계정)의 토큰으로 조회만 한다. 그래서 화면 어디에도 "연동
 * 설정"은 없고, 아직 연동이 없을 때만 기존 연동 흐름으로 내보내는 버튼이 하나 있다.
 *
 * 릴스 데이터는 서버가 계정별로 굳혀 둔다(기본 30분). 새로고침할 때마다 메타를
 * 다시 부르면 사람 한 명이 시간당 호출 한도를 혼자 태우기 때문이다. 그래서 화면은
 * "언제 기준 숫자인지"를 항상 함께 적고, 지금 값을 받고 싶은 사람에게만 버튼을 준다.
 *
 * 그래프는 콘텐츠 성과가 먼저다. 이 화면에 들어오는 사람이 알고 싶은 것은 대개 "내
 * 릴스가 어떻게 됐나" 이고, 팔로워 수는 그 결과로 따라오는 값이다. 팔로워 쪽은 탭
 * 하나 뒤로 물러나 있을 뿐 그대로 남아 있다.
 *
 * 두 번째 탭은 "팔로워 분석"이다. 추이 그래프(하루 한 번 기록한 팔로워 수) 위에
 * 기간 증감 세 칸과 팔로워 구성(성별 · 연령대 · 국가)이 함께 있다. 셋을 한 탭에 둔
 * 이유는 같은 질문의 앞뒤이기 때문이다 — 몇 명이 늘었나, 그래서 지금 내 팔로워는
 * 누구인가. 구성은 인스타그램이 팔로워 100명부터만 알려주고 최대 48시간 늦게
 * 반영되는 값이라, 화면은 비어 있을 때 그 이유를 그대로 적는다.
 *
 * 콘텐츠 그래프는 조회수·도달·좋아요·댓글·저장·공유를 한 그래프에 함께 그린다. 지표를
 * 하나씩 눌러 보게 하면 "조회수는 늘었는데 저장은 줄었다" 같은 관계가 보이지 않는다.
 * 자릿수가 다른 두 무리(조회수·도달 vs 반응 지표)는 축을 나눠 둔다.
 *
 * 기본 정렬은 저장수순이다. 조회수는 인스타그램이 밀어 준 결과에 가깝고, 저장은
 * 본 사람이 "다시 보겠다"고 누른 것이라 다음 편을 만들 때 참고할 값에 더 가깝다.
 * 다만 저장수는 인사이트 권한이 통했을 때만 내려온다 — 못 받은 계정에서는 조회수를
 * 기준으로 내려앉고, 화면은 그 사실을 숨기지 않는다.
 */

type SortKey = 'saved' | 'views' | 'recent';
type RangeDays = 7 | 30 | 90;

const RANGES: RangeDays[] = [7, 30, 90];

/**
 * 그래프 탭. 콘텐츠 성과가 기본이다(파일 위 주석 참고).
 *
 * 순서는 "내 콘텐츠 → 내 팔로워 → 남과 비교 → 다음에 뭘 할까"다. 앞의 둘은 사실을
 * 보여 주고, 뒤의 둘은 그 사실로 판단을 돕는다. 벤치마킹을 앞에 두면 자기 숫자를
 * 보기 전에 남과 견주게 되는데, 그러면 좋은 달에도 화면이 기죽는 이야기부터 한다.
 */
type InsightTab = 'content' | 'followers' | 'benchmark' | 'strategy';

/**
 * 팔로워 구성(인구통계)의 이름표와 색.
 *
 * 서버는 메타가 준 키(F · 18-24 · KR)를 그대로 보낸다. 이름 붙이기를 화면에서 하는
 * 이유는, 한글 이름 표가 서버·화면 두 곳에 생기면 언젠가 둘이 어긋나기 때문이다.
 */
const GENDER_LABEL: Record<string, { ko: string; en: string; color: string }> = {
  F: { ko: '여성', en: 'Women', color: '#e11d48' },
  M: { ko: '남성', en: 'Men', color: '#2563eb' },
  // 미지정은 계열이 아니라 "메타가 성별을 모르는 사람"이다. 색을 주면 세 번째
  // 그룹처럼 읽히므로 회색으로 물러나 있게 한다.
  U: { ko: '미지정', en: 'Unknown', color: '#94a3b8' },
};

/**
 * 연령대 축의 순서.
 *
 * 서버는 값이 큰 순으로 보낸다(국가 목록에는 그게 맞다). 나이는 순서가 있는 축이라
 * 큰 순으로 늘어놓으면 "25-34 다음이 13-17" 같은 막대가 되어 분포의 모양이 사라진다.
 */
const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

/** 분포 막대·도넛의 단색. 계열이 하나인 그래프라 색으로 구분할 것이 없다. */
const DEMO_BAR_COLOR = '#2563eb';

/**
 * 국가 코드 → 한글 이름.
 *
 * 전 세계를 다 적지 않는다. 없는 코드는 코드 그대로 보여 준다 — 'MN' 이 그대로
 * 나오는 것은 읽을 수 있지만, 없는 이름을 지어 내면 틀린 나라가 된다.
 */
const COUNTRY_KO: Record<string, string> = {
  KR: '대한민국', US: '미국', JP: '일본', CN: '중국', TW: '대만', HK: '홍콩',
  VN: '베트남', TH: '태국', PH: '필리핀', ID: '인도네시아', MY: '말레이시아',
  SG: '싱가포르', IN: '인도', AU: '호주', NZ: '뉴질랜드', CA: '캐나다',
  MX: '멕시코', BR: '브라질', AR: '아르헨티나', CL: '칠레', PE: '페루',
  GB: '영국', IE: '아일랜드', FR: '프랑스', DE: '독일', IT: '이탈리아',
  ES: '스페인', PT: '포르투갈', NL: '네덜란드', BE: '벨기에', CH: '스위스',
  AT: '오스트리아', SE: '스웨덴', NO: '노르웨이', DK: '덴마크', FI: '핀란드',
  PL: '폴란드', CZ: '체코', RO: '루마니아', HU: '헝가리', GR: '그리스',
  TR: '터키', RU: '러시아', UA: '우크라이나', IL: '이스라엘', AE: '아랍에미리트',
  SA: '사우디아라비아', EG: '이집트', ZA: '남아프리카공화국', NG: '나이지리아',
  MA: '모로코', KZ: '카자흐스탄', UZ: '우즈베키스탄', MN: '몽골', NP: '네팔',
  BD: '방글라데시', PK: '파키스탄', LK: '스리랑카', MM: '미얀마', KH: '캄보디아',
  LA: '라오스', BN: '브루나이',
};

const countryLabel = (code: string, isEn: boolean): string =>
  isEn ? code : COUNTRY_KO[code.toUpperCase()] || code;

/** 받은 값 안에서의 비율(%). 소수점은 한 자리까지, 10% 이상은 정수로. */
const share = (value: number, total: number): number => {
  if (!total) return 0;
  const pct = (value / total) * 100;
  return pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
};

/**
 * 콘텐츠 그래프의 기간. 팔로워 추이(7/30/90)와 값이 다르다.
 *
 * 릴스는 하루에 여러 편 올라오지 않으므로 90일을 고르면 한 편당 막대가 실 한 올처럼
 * 얇아지고, 서버가 계정별로 최근 24편만 들고 있어 90일을 채우지도 못한다. 일주일 ·
 * 2주 · 한 달이 실제로 비교가 되는 폭이다.
 */
type ContentRangeDays = 7 | 14 | 30;
const CONTENT_RANGES: ContentRangeDays[] = [7, 14, 30];

/**
 * 한 그래프에 함께 그리는 계열.
 *
 * `axis: 'big'` 은 조회수·도달(수천~수만), `'small'` 은 좋아요·댓글·저장·공유(수십~수백)
 * 다. 한 축에 같이 두면 반응 지표는 바닥에 붙어 아무 모양도 보이지 않는다.
 */
const CONTENT_SERIES = [
  { key: 'views', ko: '조회수', en: 'Views', color: '#2563eb', axis: 'big', kind: 'bar' },
  { key: 'reach', ko: '도달', en: 'Reach', color: '#0ea5e9', axis: 'big', kind: 'line' },
  { key: 'likes', ko: '좋아요', en: 'Likes', color: '#f43f5e', axis: 'small', kind: 'line' },
  { key: 'comments', ko: '댓글', en: 'Comments', color: '#f59e0b', axis: 'small', kind: 'line' },
  { key: 'saved', ko: '저장수', en: 'Saves', color: '#10b981', axis: 'small', kind: 'line' },
  { key: 'shares', ko: '공유수', en: 'Shares', color: '#6366f1', axis: 'small', kind: 'line' },
] as const;

type ContentSeriesKey = (typeof CONTENT_SERIES)[number]['key'];

/** 이번 달 막대 색. 지난달까지의 막대(파랑)와 구분해 한눈에 잡히게 한다. */
const THIS_MONTH_COLOR = '#7c3aed';

/**
 * 공유수는 예전 판 캐시 응답에 없는 필드다. `undefined` 를 0 으로 세면 "공유가 한
 * 번도 없었다"로 읽히므로 못 받은 값(null)과 같이 취급한다.
 */
const sharesOf = (reel: InsightReel): number | null =>
  typeof reel.shares === 'number' ? reel.shares : null;

/** '2026-08' — 서울 기준 달 키. 이번 달/지난달을 가르는 기준이 한국 달력이다. */
const seoulMonthKey = (iso: string | number | Date): string => {
  const t = iso instanceof Date ? iso.getTime() : typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date(t));
};

/** 한 달 앞의 키. '2026-01' → '2025-12'. */
const prevMonthKey = (key: string): string => {
  const m = key.match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};

/** 'YYYY-MM' → '8월' / 'Aug'. 비교 칸의 제목에 쓴다. */
const monthLabel = (key: string, isEn: boolean): string => {
  const m = key.match(/^(\d{4})-(\d{2})$/);
  if (!m) return key;
  const month = Number(m[2]);
  if (!isEn) return `${month}월`;
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1] || key;
};

/**
 * 값이 있는 항목만 더한 합계.
 *
 * 못 받은 지표를 0 으로 세면 합계가 진짜보다 작게 나오는데 화면에는 "합계"라고
 * 적힌다. 그래서 몇 편을 근거로 낸 값인지(`counted`)를 함께 들고 다닌다.
 */
const sumOf = (reels: InsightReel[], pick: (r: InsightReel) => number | null) => {
  let total = 0;
  let counted = 0;
  for (const r of reels) {
    const value = pick(r);
    if (typeof value !== 'number') continue;
    total += value;
    counted += 1;
  }
  return { total, counted, of: reels.length };
};

/** 큰 숫자는 만·억 단위로 접는다. 카드 안에서 자리를 다투지 않게. */
const compact = (n: number | null | undefined): string => {
  if (n === null || typeof n === 'undefined' || !Number.isFinite(n)) return '—';
  if (n < 0) return '—';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}만`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}천`;
  return n.toLocaleString();
};

/** 지표 한 칸. 못 받은 값은 0 이 아니라 '—' 다. */
const metricText = (value: number | null): string =>
  value === null ? '—' : compact(value);

/** '2026-08-30' → '08.30' */
const shortDate = (iso: string): string => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}.${m[3]}` : String(iso || '');
};

/** 게시일. 한국 시간 기준으로 'YYYY.MM.DD' 까지만. */
const postedOn = (iso: string): string => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    .replace(/-/g, '.');
};

/** '3분 전' 같은 상대 시각. 캐시된 값이 언제 기준인지 밝히는 데 쓴다. */
const agoText = (iso: string | undefined, isEn: boolean): string => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return isEn ? 'just now' : '방금';
  if (mins < 60) return isEn ? `${mins} min ago` : `${mins}분 전`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return isEn ? `${hours}h ago` : `${hours}시간 전`;
  return isEn ? `${Math.round(hours / 24)}d ago` : `${Math.round(hours / 24)}일 전`;
};

const sortReels = (reels: InsightReel[], key: SortKey): InsightReel[] => {
  const copy = [...reels];
  if (key === 'recent') {
    return copy.sort((a, b) => Date.parse(b.timestamp || '') - Date.parse(a.timestamp || ''));
  }
  if (key === 'views') return copy.sort((a, b) => b.views - a.views);
  return copy.sort((a, b) => (b.saved ?? 0) - (a.saved ?? 0));
};

const CreatorInsights: React.FC<{ userName: string }> = ({ userName }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

  const [data, setData] = useState<CreatorInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [series, setSeries] = useState<FollowerSeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  /**
   * 팔로워 구성(성별·연령대·국가).
   *
   * 이 탭을 처음 열 때 한 번만 부른다. 기간 버튼과 무관한 값이라 추이 응답에 묶지
   * 않았고(서버 주석 참고), 화면을 여는 사람 대부분은 콘텐츠 성과만 보고 나가므로
   * 열지도 않은 탭의 값을 미리 받아 두려고 메타를 부를 이유가 없다.
   */
  const [demo, setDemo] = useState<FollowerDemographicsResponse | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  /** 벤치마킹(같은 규모 평균). 이 탭을 처음 열 때 한 번. 우리 DB 만 읽는 조회다. */
  const [benchmark, setBenchmark] = useState<BenchmarkResponse | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [range, setRange] = useState<RangeDays>(7);
  const [sort, setSort] = useState<SortKey>('saved');
  /** 콘텐츠 성과가 기본 탭이다. 팔로워 분석은 탭 하나 뒤에 그대로 남아 있다. */
  const [tab, setTab] = useState<InsightTab>('content');
  const [contentRange, setContentRange] = useState<ContentRangeDays>(14);
  /**
   * 잠시 끈 계열.
   *
   * 여섯 계열을 한 그래프에 겹쳐 두면 어떤 조합에서는 선이 서로를 가린다. 처음에는
   * 전부 켜 두고(그게 이 그래프의 요점이다) 필요할 때만 범례를 눌러 끄게 한다.
   */
  const [hiddenSeries, setHiddenSeries] = useState<Partial<Record<ContentSeriesKey, boolean>>>({});
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<string>('');

  /**
   * 인사이트 응답이 도착한 시각.
   *
   * 추이 그래프는 이 값이 바뀐 뒤에 읽는다. 두 요청을 동시에 보내면 그래프 쪽이 먼저
   * 도착하는데, 오늘자 팔로워 점을 남기는 것은 인사이트 쪽 요청이다 — 순서가 뒤집히면
   * 처음 화면을 연 사람은 점이 하나도 없는 "수집 중" 화면을 보게 된다.
   */
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(
    async (opts: { refresh?: boolean } = {}) => {
      if (!userName) return;
      if (opts.refresh) setRefreshing(true);
      else setLoading(true);
      const res = await apiService.getCreatorInsights(userName, { refresh: opts.refresh });
      setData(res);
      setLoading(false);
      setRefreshing(false);
      setLoadedAt(Date.now());
    },
    [userName],
  );

  const loadSeries = useCallback(
    async (days: RangeDays) => {
      if (!userName) return;
      setSeriesLoading(true);
      const res = await apiService.getCreatorFollowerSeries(userName, days);
      setSeries(res);
      setSeriesLoading(false);
    },
    [userName],
  );

  const loadDemographics = useCallback(
    async (opts: { refresh?: boolean } = {}) => {
      if (!userName) return;
      setDemoLoading(true);
      const res = await apiService.getCreatorFollowerDemographics(userName, opts);
      setDemo(res);
      setDemoLoading(false);
    },
    [userName],
  );

  const loadBenchmark = useCallback(async () => {
    if (!userName) return;
    setBenchmarkLoading(true);
    const res = await apiService.getCreatorBenchmark(userName);
    setBenchmark(res);
    setBenchmarkLoading(false);
  }, [userName]);

  useEffect(() => { load(); }, [load]);
  // 탭을 처음 열 때만 부른다. 여닫을 때마다 다시 부르면, 서버가 굳혀 둔 같은 값을
  // 받으려고 매번 함수를 깨우는 셈이 된다.
  useEffect(() => {
    if (tab !== 'followers' || demo || demoLoading) return;
    loadDemographics();
  }, [tab, demo, demoLoading, loadDemographics]);
  useEffect(() => {
    if (tab !== 'benchmark' || benchmark || benchmarkLoading) return;
    loadBenchmark();
  }, [tab, benchmark, benchmarkLoading, loadBenchmark]);
  // 오늘자 점이 남은 뒤에 읽는다(loadedAt 주석 참고). 기간을 바꾸면 그때 다시 읽는다.
  useEffect(() => {
    if (!loadedAt) return;
    loadSeries(range);
  }, [loadSeries, range, loadedAt]);

  // 연동 콜백에서 돌아온 경우. 결과를 한 줄로 알리고 주소창의 표식은 지운다 —
  // 남겨 두면 다음 새로고침 때도 이 화면으로 끌려온다. 디엠 자동화 화면이 쓰는
  // 파라미터와 이름이 같아도, 그 화면의 처리 로직은 건드리지 않고 여기서 우리
  // 흐름으로 돌아온 경우(ig_insights)만 정리한다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('ig_insights')) return;
    const failed = params.get('ig_error');
    setNotice(
      failed
        ? (isEn ? 'Instagram connection failed. Please try again.' : '인스타그램 연동에 실패했습니다. 다시 시도해 주세요.')
        : '',
    );
    ['ig_insights', 'ig_connected', 'ig_error'].forEach(k => params.delete(k));
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
    );
  }, [isEn]);

  const reels = data?.reels || [];
  // 저장수를 못 받는 계정에서 저장수순으로 정렬하면 순서가 사실 아무 의미가 없다.
  // 그런 계정의 기본값은 조회수순으로 내려앉는다.
  const savedUsable = Boolean(data?.insightsAvailable);
  const effectiveSort: SortKey = sort === 'saved' && !savedUsable ? 'views' : sort;

  const sorted = useMemo(() => sortReels(reels, effectiveSort), [reels, effectiveSort]);
  // 하이라이트 기준도 같다 — 저장수를 못 받으면 조회수로 고른다.
  const top5 = useMemo(
    () => sortReels(reels, savedUsable ? 'saved' : 'views').slice(0, 5),
    [reels, savedUsable],
  );
  const coaching = useMemo(() => buildReelCoaching(reels, isEn), [reels, isEn]);

  /**
   * 고른 기간의 팔로워 증감 — 늘어난 날의 합계와 줄어든 날의 합계.
   *
   * "신규 팔로워 12명 / 이탈 3명"이라고 적지 않는다. 우리가 가진 것은 하루에 한 번
   * 기록한 팔로워 수뿐이라, 같은 날 열 명이 팔로우하고 아홉 명이 언팔로우했으면
   * 그 날의 값은 +1 이다. 그 +1 을 "신규 1명"이라고 부르면 사실이 아니다. 그래서
   * 이름을 값의 정체 그대로 — 늘어난 날 · 줄어든 날의 합계로 적는다.
   */
  const followerFlow = useMemo(() => {
    const pts = series?.points || [];
    if (pts.length < 2) return null;
    let up = 0;
    let down = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const diff = pts[i].followers - pts[i - 1].followers;
      if (diff > 0) up += diff;
      else if (diff < 0) down += -diff;
    }
    return {
      up,
      down,
      net: pts[pts.length - 1].followers - pts[0].followers,
      days: pts.length,
    };
  }, [series]);

  /**
   * 콘텐츠 그래프가 읽는 줄들. 고른 기간 안의 릴스를 오래된 것부터 늘어놓는다.
   *
   * 정렬 칩(저장수순 등)과 따로 계산한다 — 시간 축 그래프에서 순서가 성과순이면
   * 선은 아무 의미 없이 내려가는 모양이 된다.
   */
  const contentRows = useMemo(() => {
    const since = Date.now() - contentRange * 86_400_000;
    const nowMonth = seoulMonthKey(Date.now());
    return reels
      .filter(r => {
        const at = Date.parse(r.timestamp || '');
        return Number.isFinite(at) && at >= since;
      })
      .sort((a, b) => Date.parse(a.timestamp || '') - Date.parse(b.timestamp || ''))
      .map(r => ({
        id: r.id,
        label: shortDate(
          new Date(Date.parse(r.timestamp)).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
        ),
        views: r.views,
        reach: r.reach,
        likes: r.likes,
        comments: r.comments,
        saved: r.saved,
        shares: sharesOf(r),
        /** 이번 달에 올린 편인가. 막대 색을 여기서 가른다. */
        isThisMonth: seoulMonthKey(r.timestamp) === nowMonth,
      }));
  }, [reels, contentRange]);

  /**
   * 이번 달과 지난달 성과.
   *
   * 기간 칩과 무엇을 세는지가 다르다 — 칩은 그래프의 가로 폭이고, 이 비교는 달력상의
   * 두 달이다. 일주일만 보고 있어도 "이번 달이 지난달보다 나은가"는 그대로 답할 수 있어야 한다.
   */
  const monthCompare = useMemo(() => {
    const nowKey = seoulMonthKey(Date.now());
    const lastKey = prevMonthKey(nowKey);
    const inMonth = (key: string) => reels.filter(r => seoulMonthKey(r.timestamp) === key);
    const now = inMonth(nowKey);
    const before = inMonth(lastKey);
    const pack = (list: InsightReel[]) => ({
      reels: list.length,
      views: sumOf(list, r => r.views),
      reach: sumOf(list, r => r.reach),
      engagement: sumOf(list, r => r.likes + r.comments),
      saved: sumOf(list, r => r.saved),
      shares: sumOf(list, r => sharesOf(r)),
    });
    return { nowKey, lastKey, now: pack(now), before: pack(before) };
  }, [reels]);

  /** 지난달 릴스 한 편당 평균 조회수. 그래프의 점선 자리다. */
  const lastMonthAvgViews = monthCompare.before.views.counted > 0
    ? Math.round(monthCompare.before.views.total / monthCompare.before.views.counted)
    : null;

  const toggleSeries = (key: ContentSeriesKey) =>
    setHiddenSeries(prev => ({ ...prev, [key]: !prev[key] }));

  const startConnect = async () => {
    setConnecting(true);
    setNotice('');
    // 기존 연동 흐름을 그대로 쓴다(purpose:'collab'). 돌아올 곳만 이 화면으로 표시해 둔다.
    const returnTo = `${window.location.pathname}?ig_insights=1`;
    const res = await apiService.instagramConnectUrl(userName, returnTo, 'collab');
    if (!res.url) {
      setConnecting(false);
      setNotice(res.error || (isEn ? 'Could not start the connection.' : '연동을 시작하지 못했습니다.'));
      return;
    }
    window.location.href = res.url;
  };

  // ---------------------------------------------------------------- 로딩
  if (loading) {
    return (
      <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
        <Header isEn={isEn} />
        <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-20 md:h-28 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
        <div className="h-56 rounded-[1.5rem] bg-slate-100 animate-pulse mb-6" />
        <div className="h-72 rounded-[1.5rem] bg-slate-100 animate-pulse" />
      </div>
    );
  }

  // ------------------------------------------------------- 연동이 없는 경우
  if (data && data.connected === false) {
    return (
      <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
        <Header isEn={isEn} />
        <div className="bg-white border border-slate-100 rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-10 shadow-sm max-w-2xl">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-2xl mb-4">📊</div>
          <h3 className="text-base md:text-xl font-black text-slate-900 mb-2">
            {data.needsReauth
              ? (isEn ? 'Reconnect your Instagram account' : '인스타그램 계정을 다시 연동해 주세요')
              : (isEn ? 'Connect your Instagram account' : '인스타그램 계정을 연동해 주세요')}
          </h3>
          <p className="text-xs md:text-sm text-slate-500 font-medium leading-relaxed mb-6">
            {data.error ||
              (isEn
                ? 'Once connected, your follower count and reel performance appear here.'
                : '연동하면 팔로워 수와 릴스별 조회수·도달·저장수를 이 화면에서 볼 수 있어요.')}
          </p>
          <button
            type="button"
            onClick={startConnect}
            disabled={connecting}
            className="rounded-xl bg-slate-900 text-white font-black text-xs md:text-sm px-5 py-3 hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {connecting
              ? (isEn ? 'Opening…' : '연동 창을 여는 중')
              : data.needsReauth
                ? (isEn ? 'Reconnect' : '다시 연동하기')
                : (isEn ? 'Connect Instagram' : '인스타그램 연동하기')}
          </button>
          {notice && <p className="text-[11px] font-bold text-rose-600 mt-3">{notice}</p>}
        </div>
      </div>
    );
  }

  const delta = data?.followerDelta7d;
  const deltaDays = data?.followerDeltaDays || 0;

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <Header
        isEn={isEn}
        igUsername={data?.igUsername}
        fetchedAt={data?.fetchedAt}
        refreshing={refreshing}
        // 강제 조회는 오늘자 스냅샷도 함께 남긴다. 그래프는 응답이 도착한 뒤에
        // (loadedAt 이 바뀌면서) 다시 읽히므로 여기서 따로 부르지 않는다.
        onRefresh={() => {
          load({ refresh: true });
          // 팔로워 구성은 여섯 시간 굳어 있다. 그 탭을 보고 있는 사람이 새로
          // 불러오기를 누른 것은 "이 화면의 값"을 다시 받고 싶다는 뜻이므로 캐시를
          // 건너뛴다. 다른 탭을 보고 있을 때는 부르지 않는다 — 안 보고 있는 값을
          // 받으려고 메타 호출 한도를 쓸 이유가 없다.
          if (tab === 'followers') loadDemographics({ refresh: true });
        }}
      />

      {(notice || data?.error) && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[11px] md:text-xs font-bold text-amber-800 leading-relaxed">{notice || data?.error}</p>
        </div>
      )}

      {/* --------------------------------------------------- 계정 요약 카드 */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-5 md:mb-6">
        <StatTile
          label={isEn ? 'Followers' : '팔로워'}
          value={compact(data?.followers ?? null)}
        />
        <StatTile
          label={isEn ? 'Following' : '팔로잉'}
          value={compact(data?.following ?? null)}
        />
        {/* 스냅샷이 이틀치 미만이면 증감은 아직 말할 수 없는 값이다. 0 으로 적으면
            "일주일째 그대로"로 읽히므로 수집 중이라고 적는다. */}
        {typeof delta === 'number' ? (
          <StatTile
            label={
              deltaDays >= 7
                ? (isEn ? 'Last 7 days' : '최근 7일 증감')
                : (isEn ? `Last ${deltaDays} days` : `최근 ${deltaDays}일 증감`)
            }
            value={`${delta > 0 ? '+' : delta < 0 ? '−' : ''}${compact(Math.abs(delta))}`}
            tone={delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}
          />
        ) : (
          <StatTile
            label={isEn ? 'Last 7 days' : '최근 7일 증감'}
            value={isEn ? 'Collecting' : '수집 중'}
            muted
          />
        )}
      </div>

      {/* --------------------------------------------------------- 그래프 */}
      <section className="bg-white border border-slate-100 rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-8 shadow-sm mb-5 md:mb-6">
        {/* 콘텐츠 성과가 앞에 온다. 나머지는 사라진 것이 아니라 옆 탭에 있다.
            칩 넷이 좁은 화면에서 두 줄이 되는 것은 그대로 둔다 — 줄이려고 이름을
            줄이면(“전략”, “비교”) 눌러 보기 전에는 무슨 탭인지 알 수 없다. */}
        <div className="flex flex-wrap gap-1 bg-slate-50 rounded-xl p-1 mb-4 md:mb-6 self-start w-fit">
          <SortChip active={tab === 'content'} onClick={() => setTab('content')}>
            {isEn ? 'Content' : '콘텐츠 성과'}
          </SortChip>
          <SortChip active={tab === 'followers'} onClick={() => setTab('followers')}>
            {isEn ? 'Followers' : '팔로워 분석'}
          </SortChip>
          <SortChip active={tab === 'benchmark'} onClick={() => setTab('benchmark')}>
            {isEn ? 'Benchmark' : '벤치마킹'}
          </SortChip>
          <SortChip active={tab === 'strategy'} onClick={() => setTab('strategy')}>
            {isEn ? 'Upload strategy' : '업로드 전략'}
          </SortChip>
        </div>

        {tab === 'content' ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3 md:mb-4">
              <div>
                <h3 className="text-sm md:text-lg font-black text-slate-900">
                  {isEn ? 'Reel performance' : '릴스 성과'}
                </h3>
                <p className="text-[10px] md:text-xs text-slate-400 font-bold mt-0.5">
                  {isEn
                    ? 'Views, reach, likes, comments, saves and shares per reel'
                    : '릴스별 조회수 · 도달 · 좋아요 · 댓글 · 저장 · 공유'}
                </p>
              </div>
              <div className="flex gap-1 bg-slate-50 rounded-xl p-1">
                {CONTENT_RANGES.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setContentRange(d)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] md:text-xs font-black transition-all ${
                      contentRange === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {isEn
                      ? d === 7 ? '1 week' : d === 14 ? '2 weeks' : '1 month'
                      : d === 7 ? '일주일' : d === 14 ? '2주' : '한 달'}
                  </button>
                ))}
              </div>
            </div>

            {/* 범례가 곧 스위치다. 눌러 끄면 그래프에서 그 계열만 빠진다. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-3">
              {CONTENT_SERIES.map(sr => (
                <SeriesChip
                  key={sr.key}
                  color={sr.color}
                  label={isEn ? sr.en : sr.ko}
                  on={!hiddenSeries[sr.key]}
                  onClick={() => toggleSeries(sr.key)}
                />
              ))}
              <span className="flex items-center gap-1.5 ml-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: THIS_MONTH_COLOR }} />
                <span className="text-[10px] md:text-[11px] font-black text-slate-500">
                  {isEn ? 'This month' : '이번 달'}
                </span>
              </span>
            </div>

            <ContentChart
              rows={contentRows}
              hidden={hiddenSeries}
              lastMonthAvgViews={lastMonthAvgViews}
              range={contentRange}
              isEn={isEn}
            />

            {/* 선이 끊겨 있는 이유를 그 자리에서 밝힌다 — 0 이 아니라 못 받은 값이다. */}
            <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2">
              {isEn
                ? 'Reach, saves and shares come from Instagram insights — where a value has not been received the line breaks instead of dropping to zero. Tap a legend item to hide a series.'
                : '도달 · 저장 · 공유는 인스타그램 인사이트에서 받는 값입니다. 받지 못한 구간은 0 이 아니라 선이 끊겨 표시됩니다. 범례를 누르면 지표를 잠시 숨길 수 있어요.'}
            </p>

            <MonthCompare compare={monthCompare} isEn={isEn} />
          </>
        ) : tab === 'followers' ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 md:mb-6">
              <div>
                <h3 className="text-sm md:text-lg font-black text-slate-900">
                  {isEn ? 'Follower trend' : '팔로워 증감 추이'}
                </h3>
                <p className="text-[10px] md:text-xs text-slate-400 font-bold mt-0.5">
                  {isEn ? 'One snapshot per day (KST)' : '하루 한 번 기록한 값 (한국 시간 기준)'}
                </p>
              </div>
              <div className="flex gap-1 bg-slate-50 rounded-xl p-1">
                {RANGES.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setRange(d)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] md:text-xs font-black transition-all ${
                      range === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {isEn ? `${d}d` : `${d}일`}
                  </button>
                ))}
              </div>
            </div>

            <FollowerChart series={series} loading={seriesLoading} range={range} isEn={isEn} />

            {/* 그래프 바로 아래에 증감을 숫자로 적는다. 선의 기울기로 "얼마나"까지
                읽어 내는 사람은 거의 없고, 이 탭에서 가장 많이 확인하는 값이 이 셋이다. */}
            <FollowerFlow flow={followerFlow} range={range} isEn={isEn} />

            {/* ------------------------------------------- 팔로워 구성 */}
            <DemographicsPanel demo={demo} loading={demoLoading} isEn={isEn} />
          </>
        ) : tab === 'benchmark' ? (
          <BenchmarkPanel data={benchmark} loading={benchmarkLoading} isEn={isEn} />
        ) : (
          <StrategyPanel
            reels={reels}
            coaching={coaching}
            insightsAvailable={Boolean(data?.insightsAvailable)}
            isEn={isEn}
          />
        )}
      </section>

      {/* 콘텐츠 코칭은 "다음 편을 어떻게 만들까"에 답하는 값이라 업로드 전략 탭
          안으로 옮겼다(StrategyPanel). 여기 독립 섹션으로 두면 같은 이야기가 화면
          두 곳에 있게 된다. */}

      {/* --------------------------------------------- 가장 반응 좋은 릴스 */}
      {top5.length > 0 && (
        <section className="mb-5 md:mb-6">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h3 className="text-sm md:text-lg font-black text-slate-900">
              {isEn ? 'Top 5 reels' : '가장 반응 좋은 릴스 TOP 5'}
            </h3>
            <span className="text-[10px] md:text-xs font-bold text-slate-400 shrink-0">
              {savedUsable
                ? (isEn ? 'by saves' : '저장수 기준')
                : (isEn ? 'by views' : '조회수 기준')}
            </span>
          </div>
          {/* 다섯 편은 순위가 보여야 의미가 있다. 좁은 화면에서는 옆으로 흐르게 둔다.
              넓은 화면에서 5칸이 본문 폭을 다 쓰면 카드(9:16)가 지나치게 커지므로
              max-w 로 살짝 줄여 다른 섹션과 크기 균형을 맞춘다. */}
          <div className="flex gap-2.5 md:gap-3 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-5 md:max-w-[52rem]">
            {top5.map((reel, i) => (
              <TopReelCard key={reel.id || i} reel={reel} rank={i + 1} isEn={isEn} savedUsable={savedUsable} />
            ))}
          </div>
        </section>
      )}

      {/* ----------------------------------------------------- 릴스 목록 */}
      <section className="bg-white border border-slate-100 rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-8 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 md:mb-6">
          <div>
            <h3 className="text-sm md:text-lg font-black text-slate-900">
              {isEn ? 'Recent reels' : '최근 릴스'}
            </h3>
            <p className="text-[10px] md:text-xs text-slate-400 font-bold mt-0.5">
              {isEn ? `${reels.length} reels` : `총 ${reels.length}편`}
            </p>
          </div>
          <div className="flex gap-1 bg-slate-50 rounded-xl p-1">
            <SortChip active={effectiveSort === 'saved'} onClick={() => setSort('saved')} disabled={!savedUsable}>
              {isEn ? 'Saves' : '저장수순'}
            </SortChip>
            <SortChip active={effectiveSort === 'views'} onClick={() => setSort('views')}>
              {isEn ? 'Views' : '조회수순'}
            </SortChip>
            <SortChip active={effectiveSort === 'recent'} onClick={() => setSort('recent')}>
              {isEn ? 'Newest' : '최신순'}
            </SortChip>
          </div>
        </div>

        {/* 도달·저장수가 비어 있을 때. 숫자가 안 보이는 이유를 화면이 말한다.
            권한 승인 전에 연동한 계정이면 재연동 버튼까지 함께 준다 — 토큰 갱신으로는
            권한 범위가 늘지 않아서, 사람이 동의 화면을 한 번 더 지나야 값이 온다. */}
        {reels.length > 0 && !savedUsable && (
          <div className="mb-4 rounded-2xl bg-slate-50 px-4 py-3">
            <p className="text-[11px] md:text-xs font-bold text-slate-500 leading-relaxed">
              {data?.reconnectForInsights
                ? (isEn
                    ? 'This account was connected before insights access was approved, so reach and saves are missing. Reconnect once and they will load from then on.'
                    : '인사이트 권한이 승인되기 전에 연동한 계정이라 도달·저장수가 비어 있습니다. 한 번만 다시 연동하면 이후로는 함께 불러옵니다.')
                : (isEn
                    ? 'Reach and saves are not available for this account yet — reconnect and allow insights access to see them.'
                    : '도달·저장수를 아직 받지 못했습니다. 계정을 다시 연동해 인사이트 접근을 허용하면 함께 보입니다.')}
            </p>
            <button
              type="button"
              onClick={startConnect}
              disabled={connecting}
              className="mt-2 rounded-xl bg-slate-900 text-white font-black text-[11px] md:text-xs px-4 py-2 hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {connecting
                ? (isEn ? 'Opening…' : '연동 창을 여는 중')
                : (isEn ? 'Reconnect' : '다시 연동하기')}
            </button>
          </div>
        )}

        {reels.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-black text-slate-900 mb-1">
              {isEn ? 'No reels yet' : '아직 릴스가 없습니다'}
            </p>
            <p className="text-xs font-medium text-slate-400">
              {isEn
                ? 'Post a reel on Instagram and it will show up here.'
                : '인스타그램에 릴스를 올리면 이 목록에 나타납니다.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
            {sorted.map((reel, i) => (
              <ReelCard key={reel.id || i} reel={reel} isEn={isEn} />
            ))}
          </div>
        )}

        {reels.length > 0 && reels.length < MIN_REELS && (
          <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-4">
            {isEn
              ? `Content coaching appears once you have ${MIN_REELS} reels.`
              : `릴스가 ${MIN_REELS}편 이상 쌓이면 콘텐츠 코칭이 함께 표시됩니다.`}
          </p>
        )}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 조각들
// ---------------------------------------------------------------------------

const Header: React.FC<{
  isEn: boolean;
  igUsername?: string;
  fetchedAt?: string;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
}> = ({ isEn, igUsername, fetchedAt, refreshing, onRefresh }) => (
  <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 md:mb-8">
    <div>
      <h2 className="text-base md:text-3xl font-black text-slate-900">
        {isEn ? 'Insights' : '인사이트'}
      </h2>
      <p className="text-slate-500 font-bold text-[10px] md:text-base mt-0.5">
        {igUsername
          ? (isEn ? `@${igUsername} · reel performance` : `@${igUsername} 계정의 릴스 성과`)
          : (isEn ? 'Your account and reel performance' : '내 계정과 릴스 성과를 확인하세요')}
      </p>
    </div>
    {onRefresh && (
      <div className="flex items-center gap-2 shrink-0">
        {fetchedAt && (
          <span className="text-[10px] md:text-[11px] font-bold text-slate-400 whitespace-nowrap">
            {isEn ? `Updated ${agoText(fetchedAt, true)}` : `${agoText(fetchedAt, false)} 기준`}
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-xl border border-slate-200 bg-white text-slate-600 font-black text-[11px] md:text-xs px-3 py-2 hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {refreshing ? (isEn ? 'Loading…' : '불러오는 중') : (isEn ? 'Refresh' : '새로 불러오기')}
        </button>
      </div>
    )}
  </header>
);

const StatTile: React.FC<{
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'flat';
  muted?: boolean;
}> = ({ label, value, tone, muted }) => (
  <div className="bg-white border border-slate-100 rounded-2xl md:rounded-[1.5rem] px-3 py-3 md:px-6 md:py-5 shadow-sm">
    <p className="text-[9px] md:text-[11px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
      {label}
    </p>
    <p
      className={`text-lg md:text-3xl font-black mt-1 ${
        muted
          ? 'text-slate-300 text-xs md:text-lg'
          : tone === 'up'
            ? 'text-emerald-600'
            : tone === 'down'
              ? 'text-rose-600'
              : 'text-slate-900'
      }`}
    >
      {value}
    </p>
  </div>
);

const SortChip: React.FC<{
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, disabled, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`px-2.5 md:px-3 py-1.5 rounded-lg text-[11px] md:text-xs font-black transition-all ${
      active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'
    } ${disabled ? 'opacity-40 cursor-not-allowed hover:text-slate-400' : ''}`}
  >
    {children}
  </button>
);

/**
 * 범례 겸 스위치 한 칸.
 *
 * 껐다는 것이 보여야 사람이 자기가 무엇을 감췄는지 안다 — 꺼진 칸은 사라지지 않고
 * 색만 빠진다.
 */
const SeriesChip: React.FC<{
  color: string;
  label: string;
  on: boolean;
  onClick: () => void;
}> = ({ color, label, on, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition-all ${
      on ? 'bg-slate-50' : 'bg-transparent opacity-40 hover:opacity-70'
    }`}
  >
    <span
      className="w-2.5 h-2.5 rounded-full"
      style={{ background: on ? color : '#cbd5e1' }}
    />
    <span className="text-[10px] md:text-[11px] font-black text-slate-600 whitespace-nowrap">
      {label}
    </span>
  </button>
);

type ContentRow = {
  id: string;
  label: string;
  views: number;
  reach: number | null;
  likes: number;
  comments: number;
  saved: number | null;
  shares: number | null;
  isThisMonth: boolean;
};

/**
 * 릴스별 성과 그래프. 여섯 지표를 한 그래프에 겹쳐 그린다.
 *
 * 가로축은 게시일이다(성과순이 아니다 — 시간 축에서 성과순으로 늘어놓으면 선은
 * 언제나 내려가는 모양이 되어 아무것도 말하지 않는다).
 *
 * 축은 둘이다. 조회수·도달은 수천~수만, 좋아요·댓글·저장·공유는 수십~수백이라 한 축에
 * 두면 뒤쪽 네 계열이 바닥에 눌린다. 조회수만 막대로 두고 나머지를 선으로 얹은 것도
 * 같은 이유다 — 막대가 여섯 개면 한 날짜의 폭을 여섯이 나눠 갖는다.
 *
 * 이번 달에 올린 릴스의 막대는 색이 다르고, 지난달 한 편당 평균 조회수에 점선을 하나
 * 긋는다. "이번 달이 지난달보다 나았나"는 그 선 위로 올라간 막대가 몇 개인지로 읽힌다.
 * 달의 합계가 아니라 한 편당 평균을 쓰는 이유는, 편수가 다른 두 달을 합계로 비교하면
 * 많이 올린 달이 언제나 이기기 때문이다.
 *
 * 못 받은 값은 0 으로 채우지 않고 끊는다. 도달·저장·공유는 인사이트 권한이 통한
 * 계정에서만 오므로, 0 으로 이으면 "도달이 0 이었다"로 읽힌다.
 */
const ContentChart: React.FC<{
  rows: ContentRow[];
  hidden: Partial<Record<ContentSeriesKey, boolean>>;
  lastMonthAvgViews: number | null;
  range: ContentRangeDays;
  isEn: boolean;
}> = ({ rows, hidden, lastMonthAvgViews, range, isEn }) => {
  if (rows.length === 0) {
    return (
      <div className="h-[200px] md:h-[280px] rounded-2xl bg-slate-50 flex flex-col items-center justify-center text-center px-6">
        <p className="text-sm font-black text-slate-900 mb-1">
          {isEn ? 'No reels in this period' : '이 기간에 올린 릴스가 없습니다'}
        </p>
        <p className="text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed max-w-sm">
          {isEn
            ? `Nothing was posted in the last ${range} days. Pick a longer period, or post a reel and refresh.`
            : `최근 ${range}일 안에 올린 릴스가 없습니다. 기간을 늘려 보거나, 릴스를 올린 뒤 새로 불러오세요.`}
        </p>
      </div>
    );
  }

  const name = (key: string): string => {
    const found = CONTENT_SERIES.find(sr => sr.key === key);
    return found ? (isEn ? found.en : found.ko) : key;
  };
  /** 조회수는 '회', 도달은 사람 수다. 반응 지표는 단위를 붙이지 않는다. */
  const unit = (key: string): string => {
    if (isEn) return '';
    if (key === 'views') return '회';
    if (key === 'reach') return '명';
    return '';
  };

  /** 값이 하나도 없는 계열은 축 계산에서 빼야 반응 지표 축이 눌리지 않는다. */
  const shown = CONTENT_SERIES.filter(sr => !hidden[sr.key]);
  const hasSmall = shown.some(
    sr => sr.axis === 'small' && rows.some(r => typeof r[sr.key] === 'number'),
  );

  return (
    <div className="h-[240px] md:h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
            interval="preserveStartEnd"
            minTickGap={18}
            dy={8}
          />
          <YAxis
            yAxisId="big"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
            tickFormatter={(v: number) => compact(v)}
            width={44}
            allowDecimals={false}
          />
          {/* 오른쪽 축은 반응 지표 전용이다. 켜진 계열이 없으면 축도 두지 않는다. */}
          <YAxis
            yAxisId="small"
            orientation="right"
            hide={!hasSmall}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fontWeight: 700, fill: '#f43f5e' }}
            tickFormatter={(v: number) => compact(v)}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.10)' }}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
              fontSize: 12,
              fontWeight: 700,
            }}
            labelFormatter={(raw, payload) => {
              const row = payload?.[0]?.payload as ContentRow | undefined;
              const mark = row?.isThisMonth ? (isEn ? ' (this month)' : ' (이번 달)') : '';
              return `${String(raw ?? '')}${mark}`;
            }}
            formatter={(value, _n, entry) => {
              const key = String(entry?.dataKey || '');
              return [
                typeof value === 'number'
                  ? `${value.toLocaleString()}${unit(key)}`
                  : '—',
                name(key),
              ];
            }}
          />

          {/* 지난달 한 편당 평균 조회수. 이번 달 막대가 이 선을 넘었는지가 질문이다. */}
          {!hidden.views && lastMonthAvgViews !== null && (
            <ReferenceLine
              yAxisId="big"
              y={lastMonthAvgViews}
              stroke={THIS_MONTH_COLOR}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: isEn ? 'last month avg' : '지난달 평균',
                position: 'insideTopLeft',
                fontSize: 10,
                fontWeight: 800,
                fill: THIS_MONTH_COLOR,
              }}
            />
          )}

          {!hidden.views && (
            <Bar yAxisId="big" dataKey="views" radius={[4, 4, 0, 0]} maxBarSize={36}>
              {rows.map(r => (
                <Cell key={r.id} fill={r.isThisMonth ? THIS_MONTH_COLOR : '#2563eb'} />
              ))}
            </Bar>
          )}

          {CONTENT_SERIES.filter(sr => sr.kind === 'line' && !hidden[sr.key]).map(sr => (
            <Line
              key={sr.key}
              yAxisId={sr.axis}
              type="monotone"
              dataKey={sr.key}
              stroke={sr.color}
              strokeWidth={2}
              dot={rows.length <= 14 ? { r: 2.5, strokeWidth: 0, fill: sr.color } : false}
              activeDot={{ r: 4 }}
              // 못 받은 값을 이어 버리면 없는 값이 있는 것처럼 보인다.
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

/**
 * 이번 달 vs 지난달.
 *
 * 그래프에서 색과 점선으로 보이는 것을 숫자로 한 번 더 적는다 — 눈으로 잰 차이는
 * "조금 나아졌다"까지고, 협업 제안에 적어 보낼 수 있는 것은 숫자다.
 *
 * 지난달이 0 이면 비율을 만들지 않는다. 0 에서 늘어난 것을 "+100%" 로 적으면 첫 달의
 * 성과가 실제보다 대단해 보인다.
 */
const MonthCompare: React.FC<{
  compare: {
    nowKey: string;
    lastKey: string;
    now: Record<string, any>;
    before: Record<string, any>;
  };
  isEn: boolean;
}> = ({ compare, isEn }) => {
  const { now, before } = compare;
  if (now.reels === 0 && before.reels === 0) return null;

  const rows: { key: string; label: string; now: number | null; before: number | null }[] = [
    {
      key: 'reels',
      label: isEn ? 'Reels' : '릴스 수',
      now: now.reels,
      before: before.reels,
    },
    {
      key: 'views',
      label: isEn ? 'Views' : '조회수',
      now: now.views.counted > 0 ? now.views.total : null,
      before: before.views.counted > 0 ? before.views.total : null,
    },
    {
      key: 'reach',
      label: isEn ? 'Reach' : '도달',
      now: now.reach.counted > 0 ? now.reach.total : null,
      before: before.reach.counted > 0 ? before.reach.total : null,
    },
    {
      key: 'engagement',
      label: isEn ? 'Likes + comments' : '좋아요 + 댓글',
      now: now.engagement.counted > 0 ? now.engagement.total : null,
      before: before.engagement.counted > 0 ? before.engagement.total : null,
    },
    {
      key: 'saved',
      label: isEn ? 'Saves' : '저장수',
      now: now.saved.counted > 0 ? now.saved.total : null,
      before: before.saved.counted > 0 ? before.saved.total : null,
    },
    {
      key: 'shares',
      label: isEn ? 'Shares' : '공유수',
      now: now.shares.counted > 0 ? now.shares.total : null,
      before: before.shares.counted > 0 ? before.shares.total : null,
    },
  ];

  return (
    <div className="mt-4 md:mt-5">
      <p className="text-[10px] md:text-[11px] font-black text-slate-500 mb-2">
        {isEn
          ? `${monthLabel(compare.nowKey, true)} vs ${monthLabel(compare.lastKey, true)}`
          : `이번 달(${monthLabel(compare.nowKey, false)}) vs 지난달(${monthLabel(compare.lastKey, false)})`}
      </p>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {rows.map(r => (
          <CompareTile key={r.key} label={r.label} now={r.now} before={r.before} isEn={isEn} />
        ))}
      </div>
      {before.reels === 0 && (
        <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2">
          {isEn
            ? 'No reels were posted last month, so there is nothing to compare against yet.'
            : '지난달에 올린 릴스가 없어 아직 비교할 값이 없습니다.'}
        </p>
      )}
    </div>
  );
};

/** 비교 한 칸. 이번 달 값 아래에 지난달 대비 증감을 적는다. */
const CompareTile: React.FC<{
  label: string;
  now: number | null;
  before: number | null;
  isEn: boolean;
}> = ({ label, now, before, isEn }) => {
  const known = typeof now === 'number' && typeof before === 'number';
  const diff = known ? (now as number) - (before as number) : null;
  const pct = known && (before as number) > 0
    ? Math.round(((diff as number) / (before as number)) * 100)
    : null;
  const tone = diff === null || diff === 0
    ? 'text-slate-400'
    : diff > 0 ? 'text-emerald-600' : 'text-rose-500';

  return (
    <div className="rounded-2xl bg-slate-50 px-2.5 py-2">
      <p className="text-[9px] md:text-[10px] font-black text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
        {label}
      </p>
      <p className="text-sm md:text-base font-black text-slate-900 leading-tight mt-0.5">
        {typeof now === 'number' ? compact(now) : '—'}
      </p>
      <p className={`text-[9px] md:text-[10px] font-black ${tone} mt-0.5 whitespace-nowrap`}>
        {diff === null
          ? (isEn ? 'no comparison' : '비교 불가')
          : diff === 0
            ? (isEn ? 'same' : '지난달과 같음')
            : `${diff > 0 ? '+' : '−'}${compact(Math.abs(diff))}${pct !== null ? ` (${diff > 0 ? '+' : ''}${pct}%)` : ''}`}
      </p>
    </div>
  );
};

/**
 * 팔로워 추이 선 그래프.
 *
 * 한 계정의 팔로워 수 하나만 그린다. 계열이 하나라 범례를 두지 않고(제목이 그
 * 계열의 이름이다), 축은 뒤로 물러나고 값은 짚었을 때만 나온다. 점은 며칠치가
 * 쌓였는지에 따라 찍는다 — 90일을 고르면 점이 선을 덮지만, 며칠치뿐일 때는 점이
 * 없으면 값이 어느 날의 것인지 알 수 없다.
 *
 * 기록이 하루치뿐이어도 그린다. 선은 이어지지 않지만 그래프의 축·격자와 점 하나가
 * 보이면 사람은 "무엇이 언제부터 쌓이고 있는가"를 볼 수 있다. 빈 상자에 안내 문구만
 * 띄우면 값이 있는 계정에서도 화면이 고장 난 것처럼 읽힌다.
 *
 * y축은 0 에서 시작하지 않는다. 팔로워 3만 계정의 하루 증감 40명은 0 기준 축에서
 * 완전한 수평선이 되고, 그러면 이 그래프는 아무것도 말하지 않는다.
 */
const FollowerChart: React.FC<{
  series: FollowerSeriesResponse | null;
  loading: boolean;
  range: RangeDays;
  isEn: boolean;
}> = ({ series, loading, range, isEn }) => {
  if (loading) {
    return <div className="h-[200px] md:h-[260px] rounded-2xl bg-slate-50 animate-pulse" />;
  }

  const points = series?.points || [];

  // 기록이 아예 없으면 그릴 것이 없다. 가짜 0 을 채워 그리면 그 날 팔로워가 전부
  // 빠진 것으로 읽힌다.
  if (points.length === 0) {
    return (
      <div className="h-[200px] md:h-[260px] rounded-2xl bg-slate-50 flex flex-col items-center justify-center text-center px-6">
        <p className="text-sm font-black text-slate-900 mb-1">
          {isEn ? 'Collecting data' : '데이터 수집 중'}
        </p>
        <p className="text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed max-w-sm">
          {isEn
            ? 'Follower counts are recorded once a day. The first point appears as soon as your account is read.'
            : '팔로워 수는 하루에 한 번 기록됩니다. 계정을 한 번 불러오면 첫 점이 생기고, 이틀치가 쌓이는 날부터 선으로 이어집니다.'}
        </p>
      </div>
    );
  }

  /** 하루치뿐이면 증감을 말할 수 없다 — 점 하나만 찍고 그 사실을 옆에 적는다. */
  const single = points.length === 1;
  const values = points.map(p => p.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 위아래로 약간 띄운다. 완전히 붙으면 선이 축에 눌린다.
  const pad = Math.max(1, Math.round((max - min) * 0.2));
  const change = values[values.length - 1] - values[0];

  // 배치를 켠 날보다 앞선 구간은 물어볼 곳이 없다. 고른 기간을 다 채우지 못했다면
  // 그 사실을 그래프 옆에 적는다 — 선이 짧은 이유가 팔로워 변화가 아니라 수집
  // 시작일이라는 것을 알 수 있어야 한다.
  const partial = points.length < range;

  return (
    <>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-xl md:text-3xl font-black text-slate-900">
          {values[values.length - 1].toLocaleString()}
        </span>
        {!single && (
          <span
            className={`text-xs md:text-sm font-black ${
              change > 0 ? 'text-emerald-600' : change < 0 ? 'text-rose-600' : 'text-slate-400'
            }`}
          >
            {change > 0 ? '+' : change < 0 ? '−' : ''}{Math.abs(change).toLocaleString()}
          </span>
        )}
        <span className="text-[10px] md:text-xs font-bold text-slate-400">
          {single
            ? (isEn ? `first record ${shortDate(points[0].date)}` : `첫 기록 ${shortDate(points[0].date)}`)
            : (isEn ? `over ${points.length} days` : `${points.length}일 동안`)}
        </span>
      </div>

      <div className="h-[180px] md:h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
              // 점이 많으면 라벨이 겹친다. 리차트가 알아서 건너뛰게 둔다.
              interval="preserveStartEnd"
              minTickGap={24}
              dy={8}
            />
            <YAxis
              domain={[min - pad, max + pad]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
              tickFormatter={(v: number) => compact(v)}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
                fontSize: 12,
                fontWeight: 700,
              }}
              labelFormatter={(label) => shortDate(String(label ?? ''))}
              formatter={(value) => [
                `${Number(value ?? 0).toLocaleString()}${isEn ? '' : '명'}`,
                isEn ? 'Followers' : '팔로워',
              ]}
            />
            <Line
              type="monotone"
              dataKey="followers"
              stroke="#2563eb"
              strokeWidth={2}
              // 며칠치뿐일 때는 점을 찍는다. 하루치면 선이 아예 없으므로 점이 유일한
              // 표시이고, 90일치면 점이 선을 덮으므로 끈다.
              dot={points.length <= 14 ? { r: 3, strokeWidth: 2, stroke: '#ffffff' } : false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {partial && (
        <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2">
          {single
            ? (isEn
                ? 'Only one day has been recorded so far — the line is drawn from the second day onward.'
                : '아직 하루치만 기록돼 있습니다. 이틀치가 쌓이는 날부터 선으로 이어집니다.')
            : (isEn
                ? `Only ${points.length} of the last ${range} days have been recorded so far — the rest is still being collected.`
                : `최근 ${range}일 중 ${points.length}일치만 기록돼 있습니다. 나머지 기간은 데이터 수집 중입니다.`)}
        </p>
      )}
    </>
  );
};

/**
 * 기간 안의 팔로워 증감 세 칸 — 순증감 · 늘어난 날 합계 · 줄어든 날 합계.
 *
 * 이틀치가 안 쌓였으면 아무것도 그리지 않는다. 그 사실은 바로 위 그래프가 이미
 * 말하고 있어서(“이틀치가 쌓이는 날부터 선으로 이어집니다”), 같은 말을 두 번 하면
 * 화면이 안내문으로 채워진다.
 */
const FollowerFlow: React.FC<{
  flow: { up: number; down: number; net: number; days: number } | null;
  range: RangeDays;
  isEn: boolean;
}> = ({ flow, range, isEn }) => {
  if (!flow) return null;
  const netTone =
    flow.net > 0 ? 'text-emerald-600' : flow.net < 0 ? 'text-rose-600' : 'text-slate-900';
  return (
    <div className="mt-4 md:mt-5">
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
          <p className="text-[9px] md:text-[10px] font-black text-slate-400">
            {isEn ? `Net (${flow.days}d)` : `${flow.days}일 순증감`}
          </p>
          <p className={`text-base md:text-xl font-black leading-tight mt-0.5 ${netTone}`}>
            {flow.net > 0 ? '+' : flow.net < 0 ? '−' : ''}
            {Math.abs(flow.net).toLocaleString()}
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-50 px-3 py-2.5">
          <p className="text-[9px] md:text-[10px] font-black text-emerald-700/70">
            {isEn ? 'Gained (up days)' : '늘어난 날 합계'}
          </p>
          <p className="text-base md:text-xl font-black leading-tight mt-0.5 text-emerald-700">
            +{flow.up.toLocaleString()}
          </p>
        </div>
        <div className="rounded-2xl bg-rose-50 px-3 py-2.5">
          <p className="text-[9px] md:text-[10px] font-black text-rose-700/70">
            {isEn ? 'Lost (down days)' : '줄어든 날 합계'}
          </p>
          <p className="text-base md:text-xl font-black leading-tight mt-0.5 text-rose-700">
            −{flow.down.toLocaleString()}
          </p>
        </div>
      </div>
      {/* 이 숫자가 무엇이 아닌지를 적어 둔다. "신규 팔로워"로 읽으면 같은 날 들어오고
          나간 사람이 서로를 지운 만큼 실제보다 작은 값이 된다. */}
      <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2">
        {isEn
          ? `Daily snapshots over the last ${range} days. Each day contributes its net change, so follows and unfollows on the same day cancel out.`
          : `최근 ${range}일 동안 하루 한 번 기록한 값의 변화입니다. 하루 단위 순증감이라, 같은 날 팔로우와 언팔로우가 함께 있었다면 서로 상쇄된 뒤의 숫자입니다.`}
      </p>
    </div>
  );
};

/**
 * 팔로워 구성 — 성별 · 연령대 · 국가.
 *
 * ── 값의 성질을 화면이 지키는 것들 ──
 *
 * 1. 못 받은 칸은 0 이 아니다. 메타는 값이 없으면 그 칸을 아예 빼고 보낸다. 없는
 *    나이대를 0 으로 채워 막대를 그리면 "그 나이대 팔로워가 한 명도 없다"가 되는데,
 *    실제로는 "메타가 말해 주지 않았다"다. 온 칸만 그린다.
 * 2. 비율의 분모는 팔로워 수가 아니라 받은 값의 합이다. 국가는 상위 45개국에서
 *    잘리고 성별·연령대도 일부가 빠질 수 있어, 팔로워 수로 나누면 합이 100%가 안 되는
 *    이유를 아무도 알 수 없게 된다.
 * 3. 최대 48시간 늦다. 오늘 늘어난 팔로워는 아직 이 분포에 없다.
 *
 * ── 왜 도넛 하나, 막대 하나, 목록 하나인가 ──
 *
 * 성별은 조각이 둘~셋이라 도넛에서 비율이 한눈에 읽힌다. 연령대는 순서가 있는 축이라
 * 막대가 분포의 모양을 보여 준다(도넛에 일곱 조각을 넣으면 순서가 사라진다). 국가는
 * 수십 개가 오고 상위 몇 개가 대부분을 차지하므로 목록이 맞다 — 지도나 파이는
 * 1% 국가들을 읽을 수 없게 만든다.
 */
const DemographicsPanel: React.FC<{
  demo: FollowerDemographicsResponse | null;
  loading: boolean;
  isEn: boolean;
}> = ({ demo, loading, isEn }) => {
  const genderRows = useMemo(() => {
    const rows = (demo?.gender || []).map(sl => {
      const meta = GENDER_LABEL[sl.key.toUpperCase()];
      return {
        key: sl.key,
        value: sl.value,
        label: meta ? (isEn ? meta.en : meta.ko) : sl.key,
        color: meta?.color || '#94a3b8',
        unknown: sl.key.toUpperCase() === 'U',
      };
    });
    // 값이 큰 조각부터, 미지정은 언제나 맨 끝. 미지정이 가장 큰 계정에서 그 조각이
    // 첫 자리에 오면 "이 계정 팔로워는 성별 미지정입니다"가 결론처럼 읽힌다.
    return rows.sort((a, b) => (a.unknown ? 1 : b.unknown ? -1 : b.value - a.value));
  }, [demo, isEn]);

  const ageRows = useMemo(() => {
    const got = new Map((demo?.age || []).map(sl => [sl.key, sl.value]));
    return AGE_ORDER.filter(key => got.has(key)).map(key => ({
      key,
      value: got.get(key) as number,
    }));
  }, [demo]);

  const countryRows = demo?.country || [];

  const genderTotal = genderRows.reduce((sum, r) => sum + r.value, 0);
  const ageTotal = ageRows.reduce((sum, r) => sum + r.value, 0);
  const countryTotal = countryRows.reduce((sum, r) => sum + r.value, 0);

  const Heading = (
    <div className="mt-6 md:mt-8 pt-5 md:pt-6 border-t border-slate-100">
      <h3 className="text-sm md:text-lg font-black text-slate-900">
        {isEn ? 'Follower makeup' : '팔로워 구성'}
      </h3>
      <p className="text-[10px] md:text-xs text-slate-400 font-bold mt-0.5">
        {isEn
          ? 'Gender, age and country as reported by Instagram'
          : '인스타그램이 알려주는 성별 · 연령대 · 국가 분포'}
      </p>
    </div>
  );

  if (loading) {
    return (
      <>
        {Heading}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          <div className="h-[220px] rounded-2xl bg-slate-50 animate-pulse" />
          <div className="h-[220px] rounded-2xl bg-slate-50 animate-pulse" />
        </div>
      </>
    );
  }

  if (!demo) return null;

  const hasAny = genderRows.length > 0 || ageRows.length > 0 || countryRows.length > 0;

  if (!hasAny) {
    // 빈 이유를 그대로 적는다. 넷은 사람이 할 수 있는 일이 서로 다르다 — 팔로워를
    // 더 모아야 하는 경우, 기다리면 되는 경우, 재연동해야 하는 경우.
    const min = demo.minFollowers || 100;
    const followers = typeof demo.followers === 'number' ? demo.followers : null;
    const message =
      demo.reason === 'few_followers'
        ? isEn
          ? `Instagram only reports follower demographics for accounts with ${min}+ followers${
              followers !== null ? ` (yours has ${followers.toLocaleString()})` : ''
            }.`
          : `인스타그램은 팔로워 ${min}명부터 팔로워 구성을 알려줍니다${
              followers !== null ? ` (현재 ${followers.toLocaleString()}명)` : ''
            }. 팔로워가 그 선을 넘으면 이 자리에 성별 · 연령대 · 국가 분포가 채워집니다.`
        : demo.reason === 'empty'
          ? isEn
            ? 'Instagram has not aggregated this account yet. Demographics can take up to 48 hours to appear.'
            : '인스타그램이 아직 이 계정의 팔로워 구성을 집계하지 않았습니다. 이 값은 최대 48시간까지 늦게 반영되므로, 잠시 뒤 다시 열어 보면 채워져 있을 수 있어요.'
          : isEn
            ? 'Could not read follower demographics. Reconnecting your Instagram account usually fixes it.'
            : '팔로워 구성을 불러오지 못했습니다. 계정을 다시 연동하면 대부분 해결됩니다.';
    return (
      <>
        {Heading}
        <div className="mt-4 rounded-2xl bg-slate-50 px-5 py-8 text-center">
          <p className="text-sm font-black text-slate-900 mb-1">
            {demo.reason === 'few_followers'
              ? (isEn ? 'Not enough followers yet' : '아직 받을 수 없는 값')
              : (isEn ? 'Collecting data' : '데이터 집계 중')}
          </p>
          <p className="text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed max-w-md mx-auto">
            {message}
          </p>
        </div>
      </>
    );
  }

  const topGender = genderRows.find(r => !r.unknown) || genderRows[0];

  return (
    <>
      {Heading}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {/* ------------------------------------------------------- 성별 */}
        {genderRows.length > 0 && (
          <div className="rounded-2xl border border-slate-100 p-4">
            <p className="text-[11px] md:text-xs font-black text-slate-900">
              {isEn ? 'Gender' : '성별 분포'}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <div className="relative w-[124px] h-[124px] md:w-[140px] md:h-[140px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={genderRows}
                      dataKey="value"
                      nameKey="label"
                      innerRadius="60%"
                      outerRadius="92%"
                      // 조각 사이에 배경색 틈을 둔다. 붙여 두면 두 조각의 경계가
                      // 색 경계뿐이라 색약인 사람에게는 한 덩어리로 보인다.
                      paddingAngle={2}
                      stroke="#ffffff"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {genderRows.map(r => (
                        <Cell key={r.key} fill={r.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                      formatter={(value: any, name: any) => [
                        `${Number(value ?? 0).toLocaleString()}${isEn ? '' : '명'} (${share(Number(value ?? 0), genderTotal)}%)`,
                        String(name ?? ''),
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* 가운데는 결론 한 줄이다. 도넛에서 사람이 가장 먼저 찾는 값이
                    "그래서 어느 쪽이 많은가"이고, 그것을 조각 크기로 눈대중하게
                    두면 40%와 45%를 구별할 수 없다. */}
                {topGender && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-lg md:text-xl font-black text-slate-900 leading-none">
                      {share(topGender.value, genderTotal)}%
                    </span>
                    <span className="text-[9px] md:text-[10px] font-black text-slate-400 mt-0.5">
                      {topGender.label}
                    </span>
                  </div>
                )}
              </div>
              {/* 범례가 곧 값 표다. 조각 옆에 숫자가 없으면 도넛은 분위기만 준다. */}
              <ul className="min-w-0 flex-1 space-y-1.5">
                {genderRows.map(r => (
                  <li key={r.key} className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: r.color }}
                    />
                    <span className="text-[11px] font-black text-slate-600 truncate">{r.label}</span>
                    <span className="text-[11px] font-black text-slate-900 ml-auto">
                      {share(r.value, genderTotal)}%
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 w-12 text-right">
                      {compact(r.value)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------- 연령대 */}
        {ageRows.length > 0 && (
          <div className="rounded-2xl border border-slate-100 p-4">
            <p className="text-[11px] md:text-xs font-black text-slate-900">
              {isEn ? 'Age' : '연령대 분포'}
            </p>
            <div className="h-[140px] md:h-[156px] w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={ageRows} margin={{ top: 18, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="key"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                    interval={0}
                    dy={6}
                  />
                  {/* 축은 하나다. 눈금 숫자는 지우고 막대 위에 비율을 직접 적는다 —
                      이 그래프에서 읽는 값은 사람 수가 아니라 비율이다. */}
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                    formatter={(value: any) => [
                      `${Number(value ?? 0).toLocaleString()}${isEn ? '' : '명'} (${share(Number(value ?? 0), ageTotal)}%)`,
                      isEn ? 'Followers' : '팔로워',
                    ]}
                  />
                  <Bar
                    dataKey="value"
                    fill={DEMO_BAR_COLOR}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={34}
                    isAnimationActive={false}
                  >
                    <LabelList
                      dataKey="value"
                      position="top"
                      offset={6}
                      formatter={(v: any) => `${share(Number(v ?? 0), ageTotal)}%`}
                      style={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }}
                    />
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------- 국가 */}
      {countryRows.length > 0 && (
        <div className="rounded-2xl border border-slate-100 p-4 mt-3 md:mt-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] md:text-xs font-black text-slate-900">
              {isEn ? 'Top countries' : '국가 분포'}
            </p>
            <p className="text-[10px] font-bold text-slate-400">
              {isEn ? `${countryRows.length} countries` : `${countryRows.length}개국`}
            </p>
          </div>
          <ul className="mt-2.5 space-y-2">
            {countryRows.slice(0, 6).map(row => {
              const pct = share(row.value, countryTotal);
              return (
                <li key={row.key} className="flex items-center gap-2.5">
                  <span className="text-[11px] font-black text-slate-600 w-24 md:w-32 shrink-0 truncate">
                    {countryLabel(row.key, isEn)}
                  </span>
                  {/* 막대는 가장 큰 나라를 100 으로 두지 않는다. 비율끼리 비교하는
                      자리라, 첫 줄이 항상 꽉 찬 막대가 되면 8%인 1위와 80%인 1위가
                      같은 그림이 된다. */}
                  <span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.max(pct, 1)}%`, background: DEMO_BAR_COLOR }}
                    />
                  </span>
                  <span className="text-[11px] font-black text-slate-900 w-10 text-right">
                    {pct}%
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 w-12 text-right">
                    {compact(row.value)}
                  </span>
                </li>
              );
            })}
          </ul>
          {countryRows.length > 6 && (
            <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2.5">
              {isEn
                ? `${countryRows.length - 6} more countries make up the remaining ${share(
                    countryRows.slice(6).reduce((sum, r) => sum + r.value, 0),
                    countryTotal,
                  )}%.`
                : `그 외 ${countryRows.length - 6}개국이 남은 ${share(
                    countryRows.slice(6).reduce((sum, r) => sum + r.value, 0),
                    countryTotal,
                  )}%를 차지합니다.`}
            </p>
          )}
        </div>
      )}

      {/* 비율의 분모와 지연을 밝힌다. 이 문구가 없으면 합이 100%가 아닌 이유도,
          오늘 늘어난 팔로워가 안 보이는 이유도 화면 오류로 읽힌다. */}
      <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2">
        {isEn
          ? 'Percentages are of the followers Instagram reported for each breakdown, not of your total follower count — Instagram returns up to the top 45 values and can lag by up to 48 hours.'
          : '비율은 인스타그램이 알려준 값의 합을 기준으로 계산합니다. 국가는 상위 45개까지만 내려오고 값이 최대 48시간 늦게 반영되므로, 팔로워 수와 정확히 맞지 않을 수 있습니다.'}
      </p>
    </>
  );
};

// ---------------------------------------------------------------------------
// 벤치마킹 (3단계)
// ---------------------------------------------------------------------------

/** 팔로워 규모 구간의 이름과 범위. 서버의 TIERS 와 같은 경계를 쓴다. */
const TIER_LABEL: Record<string, { ko: string; en: string; range: string }> = {
  nano: { ko: '나노', en: 'Nano', range: '1만 미만' },
  micro: { ko: '마이크로', en: 'Micro', range: '1만~10만' },
  macro: { ko: '매크로', en: 'Macro', range: '10만 이상' },
};

/**
 * 비교하는 네 지표.
 *
 * 저장률·공유율은 넣지 못했다. 그 둘은 인스타그램 인사이트 지표라 계정 주인의
 * 토큰으로만 받을 수 있고, 우리 DB 의 채널 표에는 남의 저장수가 없다. 없는 값을
 * 평균이라고 그리는 대신, 비교 축에서 빼고 그 사실을 화면에 적었다 — 내 저장률은
 * 콘텐츠 성과 탭과 업로드 전략 탭에서 그대로 볼 수 있다.
 */
const BENCHMARK_METRICS: {
  key: BenchmarkMetricKey;
  ko: string;
  en: string;
  unit: '%' | '편/주';
  /** 이 값이 높다는 게 무슨 뜻인지. 숫자만 있으면 잘한 건지 알 수 없다. */
  meaningKo: string;
  meaningEn: string;
}[] = [
  {
    key: 'engagement',
    ko: '참여율',
    en: 'Engagement',
    unit: '%',
    meaningKo: '팔로워 대비 좋아요·댓글',
    meaningEn: 'Likes + comments per follower',
  },
  {
    key: 'viewRate',
    ko: '조회율',
    en: 'View rate',
    unit: '%',
    meaningKo: '팔로워 대비 평균 조회수',
    meaningEn: 'Average views per follower',
  },
  {
    key: 'commentRate',
    ko: '댓글률',
    en: 'Comment rate',
    unit: '%',
    meaningKo: '조회수 대비 댓글',
    meaningEn: 'Comments per view',
  },
  {
    key: 'uploads',
    ko: '업로드 빈도',
    en: 'Upload cadence',
    unit: '편/주',
    meaningKo: '최근 4주 주당 편수',
    meaningEn: 'Posts per week, last 4 weeks',
  },
];

/** 내 값은 파랑, 동급 평균은 회색이다. 평균은 겨룰 상대가 아니라 기준선이라서. */
const ME_COLOR = '#2563eb';
const PEER_COLOR = '#94a3b8';

/**
 * 벤치마킹 값 한 칸.
 *
 * 위쪽 metricText 는 조회수처럼 큰 수를 '3.2만'으로 줄이는 함수다. 여기 값들은 %와
 * 편/주 — 소수 한두 자리의 작은 수라서 줄일 것이 없고, 대신 단위를 붙여야 3.2 가
 * 3.2% 인지 3.2편인지 알 수 있다. 그래서 따로 둔다.
 */
const benchmarkText = (value: number | null | undefined, unit: string): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString()}${unit === '%' ? '%' : ''}`
    : '—';

/**
 * 벤치마킹 탭 — 같은 규모 계정들의 평균과 견주기.
 *
 * ── 표본이 모자랄 때 무엇을 하는가 ──
 *
 * 평균을 그리지 않는다. 지금 우리 DB 에는 채널 지표가 있는 인플루언서가 손에 꼽을
 * 만큼이라, 둘·셋의 평균으로 "상위 30%"를 적으면 숫자는 그럴듯하지만 뜻이 없다.
 * 그래서 서버가 표본을 세어 최소선(5명) 미만이면 collecting 으로 알려주고, 화면은
 * 내 값만 보여 주면서 몇 명이 모였는지를 그대로 적는다. 등록이 쌓이면 같은 화면에
 * 레이더가 저절로 켜진다 — 사람이 다시 만들 것은 없다.
 *
 * ── 왜 레이더인가 ──
 *
 * 지표 넷의 단위가 서로 다르다(%, 편/주). 한 막대 그래프에 같이 두면 축이 둘
 * 필요해지고, 그건 하지 않는다. 레이더는 축마다 자기 기준으로 정규화하므로 단위가
 * 달라도 "어느 쪽이 두툼한가"를 한 번에 볼 수 있다. 대신 축의 눈금은 읽을 수 없으므로
 * 아래 표에 실제 값을 그대로 적는다 — 레이더는 모양, 표는 값이다.
 */
const BenchmarkPanel: React.FC<{
  data: BenchmarkResponse | null;
  loading: boolean;
  isEn: boolean;
}> = ({ data, loading, isEn }) => {
  const rows = useMemo(() => {
    if (!data?.me) return [];
    return BENCHMARK_METRICS.map(m => {
      const mine = data.me?.[m.key] ?? null;
      const peer = data.peer?.[m.key] ?? null;
      // 축마다 큰 쪽을 100 으로 두고 상대 크기로 그린다. 상한(200% 등)을 두면 크게
      // 앞선 축이 잘려 "비슷하다"로 보이고, 정규화를 안 하면 편/주(한 자리)가 %(두
      // 자리) 옆에서 점으로 찍힌다.
      const scale = Math.max(mine ?? 0, peer ?? 0);
      return {
        ...m,
        axis: isEn ? m.en : m.ko,
        mine,
        peer,
        top: data.topPercent?.[m.key] ?? null,
        counted: data.counted?.[m.key] ?? 0,
        meShape: scale > 0 && mine !== null ? Math.round((mine / scale) * 100) : 0,
        peerShape: scale > 0 && peer !== null ? Math.round((peer / scale) * 100) : 0,
      };
    });
  }, [data, isEn]);

  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4 md:mb-6">
      <div>
        <h3 className="text-sm md:text-lg font-black text-slate-900">
          {isEn ? 'Benchmark' : '동급 계정과 비교'}
        </h3>
        <p className="text-[10px] md:text-xs text-slate-400 font-bold mt-0.5">
          {isEn
            ? 'Your channel numbers against accounts of a similar follower size'
            : '비슷한 팔로워 규모의 인플루언서들과 내 채널 지표를 견줍니다'}
        </p>
      </div>
      {data?.tier && (
        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-black">
          {isEn
            ? `${TIER_LABEL[data.tier]?.en || data.tier} tier`
            : `${TIER_LABEL[data.tier]?.ko || data.tier}급 · 팔로워 ${TIER_LABEL[data.tier]?.range}`}
        </span>
      )}
    </div>
  );

  if (loading) {
    return (
      <>
        {heading}
        <div className="h-[260px] rounded-2xl bg-slate-50 animate-pulse" />
      </>
    );
  }

  // 내 채널 숫자가 아직 없는 경우. 견줄 대상이 아니라 견줄 내 값이 없는 상태다.
  if (!data || data.ok === false || !data.me) {
    return (
      <>
        {heading}
        <div className="rounded-2xl bg-slate-50 px-5 py-10 text-center">
          <p className="text-sm font-black text-slate-900 mb-1">
            {isEn ? 'Nothing to compare yet' : '아직 견줄 값이 없습니다'}
          </p>
          <p className="text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed max-w-md mx-auto">
            {data?.reason === 'no_channel'
              ? (isEn
                  ? 'Your channel metrics are created when you register for brand matching. Once they exist, this tab compares them with accounts of a similar size.'
                  : '채널 지표는 브랜드 매칭에 등록하면 만들어집니다. 등록하고 계정을 연동하면 이 탭에서 비슷한 규모 계정들과 견줄 수 있어요.')
              : (isEn
                  ? 'Could not load the comparison. Please try again in a moment.'
                  : '비교 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')}
          </p>
        </div>
      </>
    );
  }

  const collecting = Boolean(data.collecting);

  return (
    <>
      {heading}

      {collecting ? (
        <>
          {/* 표본이 모자랄 때. 평균 자리를 비워 두는 대신 내 값을 그대로 보여 준다 —
              비교는 못 해도 이 네 숫자는 오늘 쓸 수 있는 값이다. */}
          <div className="rounded-2xl bg-amber-50 border border-amber-100 px-4 py-4 mb-4">
            <p className="text-[12px] md:text-sm font-black text-amber-900 mb-1">
              {isEn ? 'Collecting comparison data' : '비교 데이터 쌓이는 중'}
            </p>
            <p className="text-[11px] md:text-xs font-medium text-amber-800/80 leading-relaxed">
              {isEn
                ? `Only ${data.sample ?? 0} other account(s) of your size are registered so far — at least ${
                    data.minSample ?? 5
                  } are needed before an average means anything. Your own numbers are below, and the comparison chart turns on by itself once enough accounts join.`
                : `지금 같은 규모로 등록된 계정이 ${data.sample ?? 0}명입니다. 평균이 뜻을 가지려면 최소 ${
                    data.minSample ?? 5
                  }명이 필요해서, 그 전에는 평균을 그리지 않습니다. 아래는 내 값이고, 등록이 쌓이면 이 자리에 비교 그래프가 저절로 켜집니다.`}
            </p>
            {typeof data.totalCreators === 'number' && (
              <p className="text-[10px] font-bold text-amber-700/70 mt-1.5">
                {isEn
                  ? `${data.totalCreators} influencer(s) have channel metrics in total.`
                  : `전체 등록 인플루언서 ${data.totalCreators}명 기준입니다.`}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            {rows.map(r => (
              <div key={r.key} className="rounded-2xl border border-slate-100 px-3 py-3">
                <p className="text-[10px] font-black text-slate-400">{r.axis}</p>
                <p className="text-lg md:text-xl font-black text-slate-900 mt-0.5">
                  {r.mine === null ? '—' : `${r.mine.toLocaleString()}${r.unit === '%' ? '%' : ''}`}
                  {r.unit === '편/주' && r.mine !== null && (
                    <span className="text-[10px] font-bold text-slate-400 ml-1">
                      {isEn ? '/wk' : '편/주'}
                    </span>
                  )}
                </p>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5 leading-tight">
                  {isEn ? r.meaningEn : r.meaningKo}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* 범례를 그래프 위에 둔다. 레이더는 두 겹이 겹쳐 그려지므로 어느 겹이
              나인지 모르면 모양만 보고 정반대로 읽을 수 있다. */}
          <div className="flex items-center gap-3 mb-2">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: ME_COLOR }} />
              <span className="text-[10px] md:text-[11px] font-black text-slate-600">
                {isEn ? 'You' : '내 계정'}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: PEER_COLOR }} />
              <span className="text-[10px] md:text-[11px] font-black text-slate-600">
                {isEn
                  ? `Average of ${data.sample ?? 0} similar accounts`
                  : `동급 ${data.sample ?? 0}명 평균`}
              </span>
            </span>
          </div>

          <div className="h-[260px] md:h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={rows} outerRadius="72%">
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis
                  dataKey="axis"
                  tick={{ fontSize: 11, fontWeight: 800, fill: '#64748b' }}
                />
                {/* 동급 평균을 먼저 그린다. 나중에 그린 겹이 위에 오므로 내 값이
                    평균에 가려지지 않는다. */}
                <Radar
                  name={isEn ? 'Average' : '동급 평균'}
                  dataKey="peerShape"
                  stroke={PEER_COLOR}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  fill={PEER_COLOR}
                  fillOpacity={0.14}
                  isAnimationActive={false}
                />
                <Radar
                  name={isEn ? 'You' : '내 계정'}
                  dataKey="meShape"
                  stroke={ME_COLOR}
                  strokeWidth={2}
                  fill={ME_COLOR}
                  fillOpacity={0.22}
                  isAnimationActive={false}
                />
                {/* 눈금이 상대값(0~100)이라 그 숫자를 그대로 보여 주면 안 된다.
                    짚었을 때는 실제 값을 적는다. */}
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                  formatter={(_value: any, name: any, entry: any) => {
                    const row = entry?.payload;
                    const isMe = String(name) === (isEn ? 'You' : '내 계정');
                    const raw = isMe ? row?.mine : row?.peer;
                    return [
                      raw === null || typeof raw === 'undefined'
                        ? '—'
                        : `${Number(raw).toLocaleString()}${row?.unit === '%' ? '%' : (isEn ? '/wk' : '편/주')}`,
                      String(name),
                    ];
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* 레이더는 모양만 준다. 값과 순위는 표로 적는다. */}
          <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
            {rows.map(r => (
              <li key={r.key} className="flex items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-black text-slate-900 truncate">{r.axis}</p>
                  <p className="text-[10px] font-bold text-slate-400 truncate">
                    {isEn ? r.meaningEn : r.meaningKo}
                  </p>
                </div>
                <div className="text-right w-20 md:w-24">
                  <p className="text-[10px] font-black text-slate-400">{isEn ? 'You' : '내 값'}</p>
                  <p className="text-[13px] font-black" style={{ color: ME_COLOR }}>
                    {benchmarkText(r.mine, r.unit)}
                    {r.unit === '편/주' && r.mine !== null && (
                      <span className="text-[9px] ml-0.5">{isEn ? '/wk' : '편'}</span>
                    )}
                  </p>
                </div>
                <div className="text-right w-20 md:w-24">
                  <p className="text-[10px] font-black text-slate-400">
                    {isEn ? 'Average' : '동급 평균'}
                  </p>
                  <p className="text-[13px] font-black text-slate-500">
                    {benchmarkText(r.peer, r.unit)}
                    {r.unit === '편/주' && r.peer !== null && (
                      <span className="text-[9px] ml-0.5">{isEn ? '/wk' : '편'}</span>
                    )}
                  </p>
                </div>
                {/* "상위 O%" — 이 탭에서 사람이 가장 먼저 찾는 한 줄이다. */}
                <div className="text-right w-16 md:w-20">
                  {typeof r.top === 'number' ? (
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded-md text-[11px] font-black ${
                        r.top <= 30
                          ? 'bg-emerald-50 text-emerald-700'
                          : r.top <= 70
                            ? 'bg-slate-100 text-slate-600'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {isEn ? `Top ${r.top}%` : `상위 ${r.top}%`}
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold text-slate-300">—</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 무엇을 기준으로 비교했고 무엇이 빠졌는지. 이 문구가 없으면 "왜 저장률은
          없나"와 "이 숫자는 언제 것인가"에 답할 곳이 없다. */}
      <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-3 leading-relaxed">
        {isEn
          ? 'Compared using the channel metrics we hold for every registered influencer — the same numbers brands see. Saves and shares are not compared: those come from each account owner’s own Instagram insights, so no average exists for them.'
          : '비교는 등록된 인플루언서 모두에게 있는 채널 지표(브랜드에게 보이는 그 숫자)로 합니다. 저장률·공유율은 계정 주인 본인의 인사이트로만 받을 수 있는 값이라 평균이 존재하지 않아 비교 축에서 빼 뒀습니다 — 내 저장·공유는 콘텐츠 성과 탭에서 그대로 볼 수 있어요.'}
      </p>
    </>
  );
};

// ---------------------------------------------------------------------------
// 업로드 전략 (4단계)
// ---------------------------------------------------------------------------

/**
 * 콘텐츠 유형 셋.
 *
 * 반응의 종류로 나눈다 — 댓글이 유난히 많았던 편은 소통형, 저장이 많았던 편은
 * 정보형, 공유가 많았던 편은 확산형이다. 같은 조회수라도 이 셋은 브랜드에게
 * 팔리는 이유가 다르다(댓글은 커뮤니티, 저장은 정보 가치, 공유는 도달).
 *
 * 색 순서는 정보형 → 소통형 → 확산형으로 고정한다. 이웃한 두 색만 색약 판정을
 * 통과한 조합이고(teal↔rose, rose↔blue), 조각마다 비율을 직접 적어 색만으로
 * 구분하지 않게 했다.
 */
const CONTENT_TYPES: {
  key: 'info' | 'talk' | 'spread';
  metric: 'saved' | 'comments' | 'shares';
  ko: string;
  en: string;
  color: string;
  hintKo: string;
  hintEn: string;
}[] = [
  {
    key: 'info',
    metric: 'saved',
    ko: '정보형',
    en: 'Reference',
    color: '#0d9488',
    hintKo: '저장이 유난히 많았던 편 — 다시 보려고 담아 둔 콘텐츠',
    hintEn: 'Unusually many saves — people kept it for later',
  },
  {
    key: 'talk',
    metric: 'comments',
    ko: '소통형',
    en: 'Conversation',
    color: '#e11d48',
    hintKo: '댓글이 유난히 많았던 편 — 말을 걸고 싶게 만든 콘텐츠',
    hintEn: 'Unusually many comments — it made people reply',
  },
  {
    key: 'spread',
    metric: 'shares',
    ko: '확산형',
    en: 'Shareable',
    color: '#2563eb',
    hintKo: '공유가 유난히 많았던 편 — 남에게 보여 주고 싶은 콘텐츠',
    hintEn: 'Unusually many shares — people passed it on',
  },
];

/** 유형을 말하려면 이만큼은 있어야 한다. 두 편으로 "내 계정은 정보형"은 우연이다. */
const MIN_TYPED_REELS = 3;
/** 요일·시간대 한 칸을 근거로 쓰려면 이만큼. 한 편은 그 편의 이야기일 뿐이다. */
const MIN_SLOT_REELS = 2;

/**
 * 시간대의 짧은 영어 이름.
 *
 * reelCoaching 의 TIME_BANDS.en 은 문장에 끼워 넣을 형태다('the evening' → posted in
 * the evening). 축 눈금에 'the evening'을 적을 수는 없으므로 축용 짧은 이름을 따로
 * 둔다. 한국어는 원래 이름('저녁')이 둘 다에 맞아서 나누지 않았다.
 */
const BAND_AXIS_EN: Record<string, string> = {
  '이른 아침': 'Early AM',
  오전: 'Morning',
  점심때: 'Lunch',
  '늦은 오후': 'Late PM',
  저녁: 'Evening',
  밤늦게: 'Late night',
  새벽: 'Overnight',
};

/** 요일의 짧은 이름과 문장용 이름. 'Reels posted on Mondays' 처럼 쓰인다. */
const WEEKDAY_AXIS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_PHRASE_EN = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

/** 값이 있는 것만 골라 평균. 없으면 null. */
const avgOf = (values: (number | null)[]): number | null => {
  const usable = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (usable.length === 0) return null;
  return Math.round(usable.reduce((sum, v) => sum + v, 0) / usable.length);
};

/**
 * 업로드 전략 탭.
 *
 * ── 팔로워 활동 시간대를 왜 안 쓰는가 ──
 *
 * 원래 계획은 "팔로워가 온라인인 시간대 vs 내 업로드 시간대"였다. 그 값(online_followers)은
 * 현행 인스타그램 API 지표 표에 아예 없다 — 페이스북 로그인 시절의 지표로, 권한을
 * 새로 신청해도 열리지 않는다. 그래서 남의 활동 시간표 대신 내 실제 성과로 대체했다.
 * "팔로워가 저녁에 많다"보다 "내가 저녁에 올린 릴스가 실제로 잘됐다"가 한 단계 더
 * 직접적인 근거이고, 우리가 실제로 가진 값이기도 하다.
 *
 * ── 표본을 숨기지 않는다 ──
 *
 * 릴스 24편을 요일 7칸 · 시간대 7칸에 흩으면 대부분의 칸이 한두 편이다. 그래서 칸마다
 * 편수를 적고, 한 편뿐인 칸은 색을 흐리게 해 "이건 아직 근거가 아니다"를 눈으로도
 * 알 수 있게 했다. 결론 문장은 두 편 이상 쌓인 칸에서만 만든다.
 */
const StrategyPanel: React.FC<{
  reels: InsightReel[];
  coaching: ReelCoaching;
  insightsAvailable: boolean;
  isEn: boolean;
}> = ({ reels, coaching, insightsAvailable, isEn }) => {
  /** 요일별 업로드 편수와 평균 조회수. 한 주는 항상 일곱 칸이다(빈 요일도 자리를 지킨다). */
  const weekdayRows = useMemo(() => {
    const buckets: { views: (number | null)[] }[] = WEEKDAYS_KO.map(() => ({ views: [] }));
    for (const r of reels) {
      const wd = seoulWeekday(r.timestamp);
      if (wd === null) continue;
      buckets[wd].views.push(typeof r.views === 'number' ? r.views : null);
    }
    return WEEKDAYS_KO.map((ko, i) => ({
      key: ko,
      // label 은 축 눈금(좁다), phrase 는 결론 문장에 들어가는 형태다.
      label: isEn ? WEEKDAY_AXIS_EN[i] : ko,
      phrase: isEn ? WEEKDAY_PHRASE_EN[i] : `${ko}요일`,
      count: buckets[i].views.length,
      avgViews: avgOf(buckets[i].views),
    }));
  }, [reels, isEn]);

  /**
   * 시간대별 업로드 편수와 평균 조회수.
   *
   * 24칸이 아니라 사람이 쓰는 말의 단위(새벽·오전·점심때…)로 묶는다. "14시에 올려라"는
   * 지킬 수 없는 조언이고, 릴스 스물 몇 편을 24칸에 흩으면 모든 칸이 한 편 이하가 된다.
   * 순서는 시계 순이다(새벽부터).
   */
  const bandRows = useMemo(() => {
    const ordered = [...TIME_BANDS].sort((a, b) => a.from - b.from);
    const bucket = new Map<string, (number | null)[]>();
    for (const b of ordered) bucket.set(b.ko, []);
    for (const r of reels) {
      const hour = seoulHour(r.timestamp);
      if (hour === null) continue;
      const band = bandOf(hour);
      if (!band) continue;
      bucket.get(band.ko)?.push(typeof r.views === 'number' ? r.views : null);
    }
    return ordered.map(b => {
      const values = bucket.get(b.ko) || [];
      return {
        key: b.ko,
        label: isEn ? BAND_AXIS_EN[b.ko] || b.en : b.ko,
        phrase: isEn ? b.en : b.ko,
        count: values.length,
        avgViews: avgOf(values),
      };
    });
  }, [reels, isEn]);

  /** 전체 평균 조회수. 어떤 칸이 "잘된 칸"인지는 이 값과 견줘서 정한다. */
  const overallAvgViews = useMemo(
    () => avgOf(reels.map(r => (typeof r.views === 'number' ? r.views : null))),
    [reels],
  );

  /**
   * 결론 한 줄에 쓸 최고의 칸.
   *
   * 두 편 이상 쌓인 칸만 후보다. 한 편으로 정한 "가장 좋은 시간대"는 그 한 편이 잘된
   * 이유(주제·협업·운)를 시간대의 공으로 돌리는 일이다.
   */
  const bestSlot = useMemo(() => {
    const candidates = [
      ...weekdayRows.map(r => ({ kind: 'weekday' as const, ...r })),
      ...bandRows.map(r => ({ kind: 'band' as const, ...r })),
    ].filter(r => r.count >= MIN_SLOT_REELS && r.avgViews !== null);
    if (candidates.length === 0 || !overallAvgViews) return null;
    const best = candidates.reduce((a, b) => ((b.avgViews as number) > (a.avgViews as number) ? b : a));
    const ratio = Math.round(((best.avgViews as number) / overallAvgViews) * 100) / 100;
    // 전체 평균과 사실상 같은 칸을 "가장 좋은 시간"이라고 부르지 않는다.
    if (ratio < 1.15) return null;
    return { ...best, ratio };
  }, [weekdayRows, bandRows, overallAvgViews]);

  /**
   * 콘텐츠 유형 자동 분류.
   *
   * 댓글·저장·공유의 원래 크기를 그대로 비교하지 않는다. 릴스는 대개 공유가 댓글보다
   * 훨씬 많아서, 큰 값 그대로 고르면 거의 모든 편이 확산형이 된다. 그래서 각 지표를
   * "내 계정의 그 지표 평균"으로 나눠(=내 기준으로 몇 배인가) 가장 두드러진 반응을
   * 그 편의 유형으로 삼는다. 셋 중 하나라도 못 받은 편은 분류에서 빼고, 몇 편을 셌는지
   * 화면에 적는다 — 저장·공유는 인사이트 권한이 통한 계정에만 온다.
   */
  const typeMix = useMemo(() => {
    const usable = reels.filter(
      r =>
        typeof r.comments === 'number' &&
        typeof r.saved === 'number' &&
        typeof r.shares === 'number',
    );
    if (usable.length < MIN_TYPED_REELS) {
      return { ready: false as const, counted: usable.length, total: reels.length, rows: [] };
    }
    const means: Record<string, number> = {};
    for (const t of CONTENT_TYPES) {
      const values = usable.map(r => Number((r as any)[t.metric] || 0));
      const sum = values.reduce((a, b) => a + b, 0);
      means[t.metric] = sum > 0 ? sum / values.length : 0;
    }
    const tally = new Map<string, { count: number; views: (number | null)[] }>();
    for (const t of CONTENT_TYPES) tally.set(t.key, { count: 0, views: [] });
    for (const r of usable) {
      let bestKey = CONTENT_TYPES[0].key;
      let bestScore = -1;
      for (const t of CONTENT_TYPES) {
        const mean = means[t.metric];
        // 그 지표를 한 번도 못 받은 계정(평균 0)은 후보에서 뺀다. 0 으로 나눌 수도 없다.
        const score = mean > 0 ? Number((r as any)[t.metric] || 0) / mean : -1;
        if (score > bestScore) {
          bestScore = score;
          bestKey = t.key;
        }
      }
      const slot = tally.get(bestKey);
      if (slot) {
        slot.count += 1;
        slot.views.push(typeof r.views === 'number' ? r.views : null);
      }
    }
    const rows = CONTENT_TYPES.map(t => {
      const slot = tally.get(t.key) as { count: number; views: (number | null)[] };
      return {
        ...t,
        count: slot.count,
        pct: Math.round((slot.count / usable.length) * 100),
        avgViews: avgOf(slot.views),
      };
    });
    return { ready: true as const, counted: usable.length, total: reels.length, rows };
  }, [reels]);

  const dominant = typeMix.ready
    ? typeMix.rows.reduce((a, b) => (b.count > a.count ? b : a))
    : null;

  const hasAnyUpload = reels.length > 0;

  return (
    <>
      <div className="mb-4 md:mb-6">
        <h3 className="text-sm md:text-lg font-black text-slate-900">
          {isEn ? 'Upload strategy' : '업로드 전략'}
        </h3>
        <p className="text-[10px] md:text-xs text-slate-400 font-bold mt-0.5">
          {isEn
            ? 'When your uploads actually performed, and what kind of reactions they earned'
            : '언제 올린 릴스가 실제로 잘됐는지, 어떤 반응을 받는 계정인지'}
        </p>
      </div>

      {!hasAnyUpload ? (
        <div className="rounded-2xl bg-slate-50 px-5 py-10 text-center">
          <p className="text-sm font-black text-slate-900 mb-1">
            {isEn ? 'No reels yet' : '아직 릴스가 없습니다'}
          </p>
          <p className="text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed max-w-md mx-auto">
            {isEn
              ? 'This tab reads your own uploads. Once a few reels are out, it shows which days and times actually worked.'
              : '이 탭은 내가 올린 릴스를 읽습니다. 몇 편 쌓이면 어느 요일 · 시간대가 실제로 잘됐는지 보여 줍니다.'}
          </p>
        </div>
      ) : (
        <>
          {/* 결론을 맨 위에 한 줄. 그래프를 다 읽고 스스로 결론을 만드는 사람은 드물다. */}
          {bestSlot ? (
            <div className="rounded-2xl bg-blue-50 border border-blue-100 px-4 py-3 mb-4">
              <p className="text-[12px] md:text-sm font-black text-blue-900">
                {isEn
                  ? `Reels posted ${bestSlot.kind === 'weekday' ? 'on' : 'in'} ${bestSlot.phrase} averaged ${bestSlot.ratio}× your overall views (${bestSlot.count} reels).`
                  : `${bestSlot.phrase}에 올린 릴스가 전체 평균의 ${bestSlot.ratio}배 (${bestSlot.count}편 기준)`}
              </p>
              <p className="text-[10px] md:text-[11px] font-bold text-blue-800/70 mt-0.5">
                {isEn
                  ? 'Based on your own uploads, not on when followers are online.'
                  : '팔로워 활동 시간이 아니라 내가 실제로 올린 릴스의 성과로 계산했습니다.'}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-50 px-4 py-3 mb-4">
              <p className="text-[12px] md:text-sm font-black text-slate-700">
                {isEn
                  ? 'No day or time stands out yet.'
                  : '아직 두드러지는 요일 · 시간대가 없습니다'}
              </p>
              <p className="text-[10px] md:text-[11px] font-bold text-slate-500 mt-0.5">
                {isEn
                  ? `A slot needs at least ${MIN_SLOT_REELS} reels and a clearly higher average before it is called out.`
                  : `한 칸에 릴스 ${MIN_SLOT_REELS}편 이상이 쌓이고 평균이 뚜렷하게 높아야 결론으로 적습니다. 한 편으로 정한 "좋은 시간대"는 그 한 편의 이야기일 뿐이라서요.`}
              </p>
            </div>
          )}

          {/* ------------------------------------------- 요일 · 시간대 성과 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            <SlotChart
              title={isEn ? 'By weekday' : '요일별 성과'}
              rows={weekdayRows}
              overall={overallAvgViews}
              isEn={isEn}
            />
            <SlotChart
              title={isEn ? 'By time of day' : '시간대별 성과'}
              rows={bandRows}
              overall={overallAvgViews}
              isEn={isEn}
            />
          </div>
          <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2 leading-relaxed">
            {isEn
              ? 'Bars are average views for reels posted in that slot; the number above each bar is how many reels it holds. Faded bars hold a single reel — not enough to conclude from. The dashed line is your overall average.'
              : '막대는 그 칸에 올린 릴스의 평균 조회수이고, 막대 위 숫자는 그 칸의 릴스 편수입니다. 흐린 막대는 한 편뿐인 칸이라 아직 근거로 쓰기 어렵습니다. 점선은 전체 평균 조회수입니다.'}
          </p>

          {/* --------------------------------------------- 콘텐츠 유형 */}
          <div className="mt-6 md:mt-8 pt-5 md:pt-6 border-t border-slate-100">
            <h4 className="text-sm md:text-base font-black text-slate-900">
              {isEn ? 'Content type mix' : '콘텐츠 유형'}
            </h4>
            <p className="text-[10px] md:text-xs text-slate-400 font-bold mt-0.5">
              {isEn
                ? 'Each reel is typed by which reaction stood out most — saves, comments or shares'
                : '릴스마다 어떤 반응이 가장 두드러졌는지로 나눕니다 — 저장 · 댓글 · 공유'}
            </p>

            {!typeMix.ready ? (
              <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-6 text-center">
                <p className="text-[12px] font-black text-slate-700 mb-1">
                  {isEn ? 'Not enough data to type your reels' : '아직 유형을 나눌 수 없습니다'}
                </p>
                <p className="text-[11px] font-medium text-slate-500 leading-relaxed max-w-md mx-auto">
                  {insightsAvailable
                    ? (isEn
                        ? `Typing needs comments, saves and shares on the same reel — ${typeMix.counted} of ${typeMix.total} reels have all three so far (at least ${MIN_TYPED_REELS} needed).`
                        : `유형을 나누려면 한 편에 댓글 · 저장 · 공유가 모두 있어야 합니다. 지금은 ${typeMix.total}편 중 ${typeMix.counted}편이고, ${MIN_TYPED_REELS}편부터 계산합니다.`)
                    : (isEn
                        ? 'Saves and shares come from Instagram insights. Reconnect your account to receive them, and this section fills in.'
                        : '저장 · 공유는 인스타그램 인사이트에서 받는 값입니다. 계정을 다시 연동해 그 값이 들어오면 이 자리가 채워집니다.')}
                </p>
              </div>
            ) : (
              <>
                {/* 비율 한 줄. 조각마다 숫자를 적어 색만으로 읽지 않게 한다. */}
                <div className="mt-3 flex h-8 rounded-xl overflow-hidden bg-slate-100">
                  {typeMix.rows
                    .filter(r => r.count > 0)
                    .map(r => (
                      <div
                        key={r.key}
                        className="flex items-center justify-center min-w-0"
                        style={{ width: `${r.pct}%`, background: r.color }}
                        title={`${isEn ? r.en : r.ko} ${r.pct}%`}
                      >
                        <span className="text-[10px] font-black text-white truncate px-1">
                          {r.pct >= 18 ? `${isEn ? r.en : r.ko} ${r.pct}%` : `${r.pct}%`}
                        </span>
                      </div>
                    ))}
                </div>

                <ul className="mt-3 space-y-2">
                  {typeMix.rows.map(r => (
                    <li key={r.key} className="flex items-start gap-2.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                        style={{ background: r.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-black text-slate-900">
                          {isEn ? r.en : r.ko}
                          <span className="text-[11px] font-bold text-slate-400 ml-1.5">
                            {isEn ? `${r.count} reels` : `${r.count}편`}
                          </span>
                        </p>
                        <p className="text-[10px] font-bold text-slate-400 leading-tight">
                          {isEn ? r.hintEn : r.hintKo}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[10px] font-black text-slate-400">
                          {isEn ? 'Avg views' : '평균 조회수'}
                        </p>
                        <p className="text-[13px] font-black text-slate-900">
                          {r.avgViews === null ? '—' : compact(r.avgViews)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>

                {dominant && dominant.count > 0 && (
                  <p className="text-[11px] md:text-xs font-bold text-slate-600 mt-3 leading-relaxed">
                    {isEn
                      ? `Your account leans ${dominant.en.toLowerCase()} — ${dominant.count} of ${typeMix.counted} typed reels.`
                      : `내 계정은 ${dominant.ko}에 가깝습니다 — 분류된 ${typeMix.counted}편 중 ${dominant.count}편. 브랜드에게 제안할 때 이 강점을 그대로 말하면 됩니다.`}
                  </p>
                )}

                <p className="text-[10px] md:text-[11px] font-bold text-slate-400 mt-2 leading-relaxed">
                  {isEn
                    ? `Typed ${typeMix.counted} of ${typeMix.total} reels — the rest are missing saves or shares. Each metric is compared against your own average for it, so "stood out" means unusual for this account, not a universal threshold.`
                    : `${typeMix.total}편 중 ${typeMix.counted}편을 분류했습니다(나머지는 저장 · 공유를 못 받은 편입니다). 각 지표는 내 계정의 그 지표 평균과 견줘서 판정하므로, "두드러졌다"는 절대 기준이 아니라 내 계정 안에서의 이야기입니다.`}
                </p>
              </>
            )}
          </div>

          {/* --------------------------------------------- 콘텐츠 코칭 */}
          <div className="mt-6 md:mt-8">
            {coaching.visible ? (
              <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-2xl md:rounded-[1.5rem] p-5 md:p-6 shadow-lg">
                <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-2">
                  {isEn ? 'Content coaching' : 'AI 콘텐츠 코칭'}
                </p>
                <ul className="space-y-1.5">
                  {coaching.lines.map((line, i) => (
                    <li key={i} className="text-sm md:text-base font-black leading-relaxed">
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] md:text-[11px] font-bold opacity-60 mt-3">
                  {isEn
                    ? `Based on your top ${coaching.sampled} reels by ${coaching.metric}.`
                    : `${
                        coaching.metric === 'saved' ? '저장수' : coaching.metric === 'reach' ? '도달' : '조회수'
                      } 상위 릴스 ${coaching.sampled}편의 공통점입니다.`}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-50 px-4 py-5 text-center">
                <p className="text-[12px] font-black text-slate-700 mb-1">
                  {isEn ? 'Coaching needs a few more reels' : 'AI 콘텐츠 코칭 준비 중'}
                </p>
                <p className="text-[11px] font-medium text-slate-500 leading-relaxed">
                  {isEn
                    ? `Common patterns are only worth stating from ${MIN_REELS} reels onward.`
                    : `릴스가 ${MIN_REELS}편 이상 쌓이면 잘된 편들의 공통점을 문장으로 정리해 드립니다.`}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
};

/**
 * 칸별 성과 막대(요일 · 시간대 공용).
 *
 * 축은 하나다 — 평균 조회수. 편수는 막대 위에 직접 적는다. 조회수와 편수는 자릿수가
 * 세 자리 넘게 다르므로 한 축에 같이 두면 편수는 바닥에 눌리고, 축을 둘로 나누는 것은
 * 이 프로젝트에서 하지 않는다(무엇이 어느 축인지 아무도 확신할 수 없게 된다).
 */
const SlotChart: React.FC<{
  title: string;
  rows: { key: string; label: string; count: number; avgViews: number | null }[];
  overall: number | null;
  isEn: boolean;
}> = ({ title, rows, overall, isEn }) => (
  <div className="rounded-2xl border border-slate-100 p-4">
    <p className="text-[11px] md:text-xs font-black text-slate-900">{title}</p>
    <div className="h-[160px] md:h-[180px] w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 18, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
            interval={0}
            dy={6}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
            tickFormatter={(v: number) => compact(v)}
            width={38}
          />
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,0.12)' }}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
              fontSize: 12,
              fontWeight: 700,
            }}
            formatter={(value: any, _name: any, entry: any) => [
              `${compact(Number(value ?? 0))} (${
                isEn ? `${entry?.payload?.count} reels` : `${entry?.payload?.count}편`
              })`,
              isEn ? 'Avg views' : '평균 조회수',
            ]}
          />
          {/* 전체 평균선. 어떤 칸이 "잘된 칸"인지는 이 선과의 관계로만 말할 수 있다. */}
          {typeof overall === 'number' && (
            <ReferenceLine
              y={overall}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{
                value: isEn ? 'avg' : '평균',
                position: 'insideTopRight',
                fontSize: 9,
                fontWeight: 800,
                fill: '#94a3b8',
              }}
            />
          )}
          <Bar dataKey="avgViews" radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false}>
            {rows.map(r => (
              // 한 편뿐인 칸은 흐리게. 색을 같게 두면 편수를 읽지 않은 사람에게는
              // 우연히 잘된 한 편이 "가장 좋은 요일"로 보인다.
              <Cell key={r.key} fill={r.count <= 1 ? '#60a5fa' : ME_COLOR} />
            ))}
            <LabelList
              dataKey="count"
              position="top"
              offset={6}
              formatter={(v: any) => (Number(v) > 0 ? (isEn ? `${v}` : `${v}편`) : '')}
              style={{ fontSize: 9, fontWeight: 800, fill: '#64748b' }}
            />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  </div>
);

/** 썸네일 한 장. 인스타 CDN 주소는 만료되므로 실패하면 자리만 채운다. */
const Thumb: React.FC<{ src: string; className: string }> = ({ src, className }) => {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className={`${className} bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center`}>
        <span className="text-lg opacity-40">🎬</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className={`${className} object-cover bg-slate-100`}
    />
  );
};

const TopReelCard: React.FC<{
  reel: InsightReel;
  rank: number;
  isEn: boolean;
  savedUsable: boolean;
}> = ({ reel, rank, isEn, savedUsable }) => {
  const body = (
    <>
      <div className="relative">
        <Thumb src={reel.thumbnailUrl} className="w-full aspect-[9/16] rounded-xl" />
        <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-slate-900/85 text-white text-[10px] font-black flex items-center justify-center">
          {rank}
        </span>
      </div>
      <p className="text-[10px] font-bold text-slate-400 mt-1.5">{postedOn(reel.timestamp)}</p>
      <p className="text-[11px] md:text-xs font-black text-slate-900 mt-0.5">
        {savedUsable
          ? `${isEn ? 'Saves' : '저장'} ${metricText(reel.saved)}`
          : `${isEn ? 'Views' : '조회'} ${compact(reel.views)}`}
      </p>
    </>
  );

  const className = 'block w-[112px] shrink-0 md:w-auto';
  return reel.permalink ? (
    <a href={reel.permalink} target="_blank" rel="noopener noreferrer" className={`${className} group`}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
};

const ReelCard: React.FC<{ reel: InsightReel; isEn: boolean }> = ({ reel, isEn }) => {
  const body = (
    <div className="flex gap-3 rounded-2xl border border-slate-100 p-3 hover:border-slate-200 hover:shadow-sm transition-all h-full">
      <Thumb src={reel.thumbnailUrl} className="w-16 md:w-20 shrink-0 aspect-[9/16] rounded-xl" />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex items-center gap-2">
          <p className="text-[10px] md:text-[11px] font-black text-slate-400">{postedOn(reel.timestamp)}</p>
          {reel.durationSeconds ? (
            <span className="text-[10px] font-bold text-slate-400">{reel.durationSeconds}s</span>
          ) : null}
        </div>
        {reel.caption ? (
          <p className="text-[11px] md:text-xs font-medium text-slate-500 mt-0.5 line-clamp-2 break-words">
            {reel.caption}
          </p>
        ) : null}
        <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 mt-auto pt-2">
          <MiniStat label={isEn ? 'Views' : '조회'} value={compact(reel.views)} />
          <MiniStat label={isEn ? 'Reach' : '도달'} value={metricText(reel.reach)} />
          <MiniStat label={isEn ? 'Saves' : '저장'} value={metricText(reel.saved)} />
          <MiniStat label={isEn ? 'Likes' : '좋아요'} value={compact(reel.likes)} />
          <MiniStat label={isEn ? 'Comments' : '댓글'} value={compact(reel.comments)} />
          {/* 공유수는 도달·저장수와 같은 조건에서 오는 인사이트 지표다. 예전 판
              캐시에는 없는 필드라 못 받은 값과 같이 '—' 로 적는다. */}
          <MiniStat label={isEn ? 'Shares' : '공유'} value={metricText(sharesOf(reel))} />
        </div>
      </div>
    </div>
  );

  return reel.permalink ? (
    <a href={reel.permalink} target="_blank" rel="noopener noreferrer" className="block">
      {body}
    </a>
  ) : (
    body
  );
};

const MiniStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[9px] font-bold text-slate-400 whitespace-nowrap">{label}</p>
    <p className="text-[11px] md:text-xs font-black text-slate-900">{value}</p>
  </div>
);

export default CreatorInsights;
