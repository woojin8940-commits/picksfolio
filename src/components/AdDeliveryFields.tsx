import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, MapPin, X } from 'lucide-react';
import { formatKoreanWon, formatNumberWithCommas, stripCommas, todayInSeoul } from '../utils/formatters';
import {
  AD_AGE_MAX,
  AD_AGE_MIN,
  AD_GENDERS,
  AD_INTEREST_CATEGORIES,
  AD_PLACEMENTS,
  AdInterestCategory,
  AdGender,
  AdPlacement,
  AdTargetItem,
  BID_STRATEGIES,
  BidStrategy,
} from '../utils/adBoosts';
import { MetaAudience, MetaInterest, fetchMetaAudiences, searchMetaInterests } from '../utils/metaAdsApi';

/**
 * 광고 집행 조건 — 얼마를, 언제까지, 누구에게, 어디에.
 *
 * 메타 광고 관리자의 '광고 세트' 화면에서 마케터가 손대는 값을 같은 이름으로 옮겼다 —
 * 예산 유형(일일/총) · 입찰 전략 · Advantage+ 타겟 · 성별 · 연령 · 상세 타겟팅 ·
 * 맞춤 타겟(포함/제외) · 노출 위치(인스타/페이스북). 지역은 대한민국 하나로 고정이고, 상세
 * 타겟팅은 검색 대신 미리 정해 둔 카테고리(뷰티 · 패션 · 육아 …)에서 고른다. 기본값은 광고 관리자의 기본값과 같아서,
 * 아무것도 건드리지 않으면 예전과 같은 광고가 만들어진다.
 *
 * 이 값들은 소재가 어디서 왔는지와 상관이 없다. 이력에서 고른 게시물을 부스팅할 때도,
 * 브랜드가 직접 올린 소재로 광고를 만들 때도 정해야 하는 값이 같고, 메타에 넘길 때의
 * 모양도 같다. 그래서 두 창이 각자 적지 않고 여기 한 번만 적는다 — 한쪽에서만 예산
 * 검증이 바뀌거나 지역 목록이 어긋나면, 브랜드는 같은 화면 두 개에서 다른 규칙을 만난다.
 *
 * 상태는 창이 들고 있어야 한다(집행할 때 같이 보내고, 성공 화면에서 다시 쓴다).
 * 그래서 값·검증은 useAdDelivery 로, 그리는 일은 AdDeliveryFields 로 나눠 둔다.
 */

/** 오늘부터 n일 뒤 날짜(Asia/Seoul 기준의 오늘에서 센다). */
const dateAfter = (days: number): string => {
  const base = new Date(`${todayInSeoul()}T00:00:00`);
  base.setDate(base.getDate() + days);
  return base.toLocaleDateString('en-CA');
};

export const labelCls = 'text-[11px] font-black text-slate-500';
export const fieldCls =
  'w-full px-3 py-2.5 rounded-xl border border-slate-200 text-[13px] font-bold text-slate-900 ' +
  'focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors';
export const inputCls = `mt-1.5 ${fieldCls}`;
/** 드롭다운은 화살표 자리를 비워 두고, 여백은 감싼 쪽에서 준다(화살표를 가운데 맞추려고). */
export const selectCls = `${fieldCls} appearance-none pr-9`;

/** 여러 개를 켜고 끄는 칩. 연령·지역·노출 위치가 같은 모양을 쓴다. */
export const Chip: React.FC<{ label: string; on: boolean; onClick: () => void; box?: boolean }> = ({
  label, on, onClick, box,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black border transition-colors ${
      on
        ? 'bg-blue-50 border-blue-200 text-blue-700'
        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
    }`}
  >
    {box && (
      <span
        className={`w-3.5 h-3.5 rounded-[5px] border flex items-center justify-center flex-shrink-0 ${
          on ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
        }`}
      >
        {on && <Check className="w-2.5 h-2.5 text-white" strokeWidth={4} />}
      </span>
    )}
    {label}
  </button>
);

export const toggleValue = <T extends string>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

export type AdDelivery = ReturnType<typeof useAdDelivery>;

/** 예전 기록의 연령대 칩(20대 · 30대 …)을 연령 범위로 옮긴다. */
const bandsToRange = (bands: string[]): [number, number] | null => {
  const ranges: Record<string, [number, number]> = {
    '20대': [20, 29],
    '30대': [30, 39],
    '40대': [40, 49],
    '50대 이상': [50, 65],
  };
  const picked = bands.map((b) => ranges[b]).filter(Boolean);
  if (picked.length === 0) return null;
  return [Math.min(...picked.map((r) => r[0])), Math.max(...picked.map((r) => r[1]))];
};

export const useAdDelivery = () => {
  const [budget, setBudget] = useState('');
  const [budgetType, setBudgetType] = useState<'daily' | 'lifetime'>('lifetime');
  const [startDate, setStartDate] = useState(todayInSeoul());
  const [endDate, setEndDate] = useState(dateAfter(14));
  const [bidStrategy, setBidStrategy] = useState<BidStrategy>('lowest_cost');
  const [bidAmount, setBidAmount] = useState('');
  const [regions, setRegions] = useState<string[]>([]);
  const [gender, setGender] = useState<AdGender>('all');
  const [ageMin, setAgeMin] = useState(AD_AGE_MIN);
  const [ageMax, setAgeMax] = useState(AD_AGE_MAX);
  const [interests, setInterests] = useState<AdTargetItem[]>([]);
  /** 고른 상세 타겟팅 카테고리와, 각 카테고리가 메타에서 찾아 넣은 관심사. 화면에서만 쓴다. */
  const [interestCategories, setInterestCategories] = useState<AdInterestCategory[]>([]);
  const categoryItems = useRef<Partial<Record<AdInterestCategory, AdTargetItem[]>>>({});
  const [audiences, setAudiences] = useState<AdTargetItem[]>([]);
  const [excludedAudiences, setExcludedAudiences] = useState<AdTargetItem[]>([]);
  const [advantageAudience, setAdvantageAudience] = useState(false);
  const [placementMode, setPlacementMode] = useState<'auto' | 'manual'>('auto');
  const [placements, setPlacements] = useState<AdPlacement[]>([]);

  const amount = useMemo(() => parseInt(stripCommas(budget) || '0', 10) || 0, [budget]);
  const bidAmountKrw = useMemo(() => parseInt(stripCommas(bidAmount) || '0', 10) || 0, [bidAmount]);

  const days = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const from = new Date(`${startDate}T00:00:00`).getTime();
    const to = new Date(`${endDate}T00:00:00`).getTime();
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
    return Math.round((to - from) / 86400000) + 1;
  }, [startDate, endDate]);

  /**
   * 입력한 금액은 예산 유형에 따라 하루치이거나 기간 전체다. 화면 곳곳(성공 화면 · 요약)은
   * 기간 전체 금액을 적으므로 budgetKrw 는 늘 '기간 전체'로 맞춰 둔다.
   */
  const budgetKrw = budgetType === 'daily' ? amount * Math.max(days, 0) : amount;
  const dailyBudget = budgetType === 'daily' ? amount : days > 0 && amount > 0 ? Math.round(amount / days) : 0;

  /** 집행을 막아야 하는 이유. 없으면 빈 문자열이다. */
  const validate = (): string => {
    if (amount <= 0) return '예산을 입력해 주세요.';
    if (days <= 0) return '종료일을 시작일 이후로 정해 주세요.';
    if (budgetType === 'daily' && amount < 1000) return '일일 예산은 1,000원 이상으로 정해 주세요.';
    if (bidStrategy !== 'lowest_cost' && bidAmountKrw <= 0) {
      return bidStrategy === 'cost_cap' ? '결과당 비용 목표 금액을 입력해 주세요.' : '입찰가 한도 금액을 입력해 주세요.';
    }
    if (ageMin > ageMax) return '최소 연령이 최대 연령보다 클 수 없습니다.';
    if (placementMode === 'manual' && placements.length === 0) {
      return '노출 위치를 하나 이상 고르거나 Advantage+ 노출 위치로 두세요.';
    }
    return '';
  };

  /** 집행 요청에 그대로 담기는 값. 창마다 같은 모양으로 저장된다. */
  const payload = () => ({
    budgetKrw: amount,
    budgetType,
    startDate,
    endDate,
    bidStrategy,
    bidAmountKrw: bidStrategy === 'lowest_cost' ? 0 : bidAmountKrw,
    ageBands: [] as string[],
    ageMin,
    ageMax,
    gender,
    // 지역은 대한민국 하나로만 집행한다(빈 목록 = 대한민국 전체).
    regions: [] as string[],
    interests,
    audiences,
    excludedAudiences,
    advantageAudience,
    placementMode,
    placements: placementMode === 'manual' ? placements : [],
  });

  /**
   * 멈춘 광고를 이어서 만들 때, 그 광고에 저장된 조건으로 채운다. 지난 시작일이 이미
   * 지났으면 오늘로 당긴다 — 메타는 과거 시작 시각으로 광고 세트를 만들지 않는다.
   */
  const fill = (v: {
    budgetKrw: number;
    budgetType?: 'daily' | 'lifetime';
    startDate: string;
    endDate: string;
    bidStrategy?: BidStrategy;
    bidAmountKrw?: number;
    ageBands: string[];
    ageMin?: number;
    ageMax?: number;
    gender?: AdGender;
    regions: string[];
    interests?: AdTargetItem[];
    audiences?: AdTargetItem[];
    excludedAudiences?: AdTargetItem[];
    advantageAudience?: boolean;
    placementMode: 'auto' | 'manual';
    placements: string[];
  }) => {
    const today = todayInSeoul();
    setBudget(v.budgetKrw > 0 ? formatNumberWithCommas(String(v.budgetKrw)) : '');
    setBudgetType(v.budgetType === 'daily' ? 'daily' : 'lifetime');
    setStartDate(v.startDate && v.startDate >= today ? v.startDate : today);
    setEndDate(v.endDate && v.endDate >= today ? v.endDate : dateAfter(14));
    setBidStrategy(v.bidStrategy || 'lowest_cost');
    setBidAmount(v.bidAmountKrw ? formatNumberWithCommas(String(v.bidAmountKrw)) : '');
    const legacy = bandsToRange(v.ageBands || []);
    setAgeMin(v.ageMin || legacy?.[0] || AD_AGE_MIN);
    setAgeMax(v.ageMax || legacy?.[1] || AD_AGE_MAX);
    setGender(v.gender || 'all');
    setRegions([]);
    setInterests(v.interests || []);
    setInterestCategories([]);
    categoryItems.current = {};
    setAudiences(v.audiences || []);
    setExcludedAudiences(v.excludedAudiences || []);
    setAdvantageAudience(!!v.advantageAudience);
    setPlacementMode(v.placementMode === 'manual' ? 'manual' : 'auto');
    setPlacements((v.placements || []) as AdPlacement[]);
  };

  return {
    fill,
    budget, setBudget,
    budgetType, setBudgetType,
    startDate, setStartDate,
    endDate, setEndDate,
    bidStrategy, setBidStrategy,
    bidAmount, setBidAmount,
    ageMin, setAgeMin,
    ageMax, setAgeMax,
    gender, setGender,
    regions, setRegions,
    interests, setInterests,
    interestCategories, setInterestCategories, categoryItems,
    audiences, setAudiences,
    excludedAudiences, setExcludedAudiences,
    advantageAudience, setAdvantageAudience,
    placementMode, setPlacementMode,
    placements, setPlacements,
    budgetKrw, days, dailyBudget,
    validate, payload,
  };
};

/** 두 개 중 하나를 고르는 버튼 줄(일일/총 예산, 자동/직접 노출 위치). */
export const Segmented = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) => (
  <div className="flex gap-1.5 mt-1.5">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        onClick={() => onChange(o.value)}
        aria-pressed={value === o.value}
        className={`flex-1 py-2 rounded-xl text-[11px] font-black border transition-colors ${
          value === o.value
            ? 'bg-slate-900 border-slate-900 text-white'
            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** 광고 관리자의 한 덩어리(캠페인 · 광고 세트 · 광고 안의 소제목). */
export const AdSection: React.FC<{ title: string; badge?: string; children: React.ReactNode }> = ({
  title,
  badge,
  children,
}) => (
  <section className="rounded-2xl border border-slate-100 bg-white p-4 space-y-4">
    <div className="flex items-center gap-2">
      <p className="text-[13px] font-black text-slate-900">{title}</p>
      {badge && (
        <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] font-black text-slate-500">{badge}</span>
      )}
    </div>
    {children}
  </section>
);

const hintCls = 'text-[10px] text-slate-400 font-bold mt-1.5 leading-relaxed';

const AGE_OPTIONS = Array.from({ length: AD_AGE_MAX - AD_AGE_MIN + 1 }, (_, i) => AD_AGE_MIN + i);

const formatCount = (n: number) => {
  if (!n) return '';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}만`;
  return n.toLocaleString();
};

/** 고른 항목 칩(× 로 뺀다). */
const PickedList: React.FC<{ items: AdTargetItem[]; onRemove: (id: string) => void; tone?: 'blue' | 'rose' }> = ({
  items,
  onRemove,
  tone = 'blue',
}) =>
  items.length === 0 ? null : (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {items.map((it) => (
        <span
          key={it.id}
          className={`inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-lg text-[11px] font-black ${
            tone === 'rose' ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'
          }`}
        >
          <span className="max-w-[180px] truncate">{it.name}</span>
          <button type="button" onClick={() => onRemove(it.id)} aria-label={`${it.name} 빼기`} className="opacity-70 hover:opacity-100">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );

/**
 * 상세 타겟팅 — 미리 정해 둔 카테고리(뷰티 · 패션 · 육아 …)를 누르기만 하면 된다.
 * 카테고리를 켜면 그 묶음의 키워드를 메타 관심사 목록에서 찾아 실제 관심사로 넣고,
 * 끄면 그 카테고리가 넣은 관심사를 뺀다. 고른 관심사는 '하나라도 해당하는 사람(또는)'으로 묶인다.
 */
const InterestCategories: React.FC<{ username: string; delivery: AdDelivery }> = ({ username, delivery: d }) => {
  const [loading, setLoading] = useState<AdInterestCategory | ''>('');
  const [error, setError] = useState('');

  /** 키워드마다 이름이 같은 항목(없으면 첫 항목)을 고른다. */
  const resolve = async (keywords: readonly string[]): Promise<AdTargetItem[] | string> => {
    const results = await Promise.all(keywords.map((k) => searchMetaInterests(username, k)));
    const failed = results.find((r) => !r.ok);
    const items: AdTargetItem[] = [];
    results.forEach((res, i) => {
      if (!res.ok) return;
      const list: MetaInterest[] = res.interests;
      const kw = keywords[i].toLowerCase();
      const hit = list.find((it) => it.name.toLowerCase() === kw) || list[0];
      if (hit && !items.some((p) => p.id === hit.id)) items.push({ id: hit.id, name: hit.name });
    });
    if (items.length === 0) return failed && !failed.ok ? failed.error : '이 카테고리의 관심사를 찾지 못했습니다.';
    return items;
  };

  const toggle = async (key: AdInterestCategory) => {
    setError('');
    if (d.interestCategories.includes(key)) {
      const own = new Set((d.categoryItems.current[key] || []).map((it) => it.id));
      // 다른 켜진 카테고리도 넣은 관심사는 남긴다.
      const keep = new Set(
        d.interestCategories
          .filter((c) => c !== key)
          .flatMap((c) => (d.categoryItems.current[c] || []).map((it) => it.id)),
      );
      d.setInterests((prev) => prev.filter((p) => !own.has(p.id) || keep.has(p.id)));
      d.setInterestCategories((prev) => prev.filter((c) => c !== key));
      return;
    }
    const cat = AD_INTEREST_CATEGORIES.find((c) => c.key === key);
    if (!cat) return;
    let items = d.categoryItems.current[key];
    if (!items) {
      setLoading(key);
      const res = await resolve(cat.keywords);
      setLoading('');
      if (typeof res === 'string') {
        setError(res);
        return;
      }
      items = res;
      d.categoryItems.current[key] = items;
    }
    const add = items;
    d.setInterests((prev) => [...prev, ...add.filter((it) => !prev.some((p) => p.id === it.id))].slice(0, 25));
    d.setInterestCategories((prev) => (prev.includes(key) ? prev : [...prev, key]));
  };

  return (
    <div>
      <p className={labelCls}>상세 타겟팅</p>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {AD_INTEREST_CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => void toggle(c.key)}
            disabled={!!loading}
            aria-pressed={d.interestCategories.includes(c.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black border transition-colors disabled:opacity-60 ${
              d.interestCategories.includes(c.key)
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {loading === c.key ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              d.interestCategories.includes(c.key) && <Check className="w-3 h-3" />
            )}
            {c.label}
          </button>
        ))}
      </div>
      {error && <p className="text-[10px] text-amber-600 font-bold mt-1.5">{error}</p>}
      <PickedList items={d.interests} onRemove={(id) => d.setInterests((prev) => prev.filter((p) => p.id !== id))} />
      <p className={hintCls}>
        {d.interests.length === 0
          ? '카테고리를 고르지 않으면 관심사 제한 없이 집행합니다'
          : '고른 관심사 중 하나라도 해당하는 사람에게 노출합니다 · 필요 없는 관심사는 × 로 뺄 수 있습니다'}
      </p>
    </div>
  );
};

/** 맞춤 타겟 · 유사 타겟(포함/제외). 광고 계정에 만들어 둔 타겟을 그대로 읽는다. */
const AudiencePicker: React.FC<{ username: string; adAccountId: string; delivery: AdDelivery; idPrefix: string }> = ({
  username,
  adAccountId,
  delivery: d,
  idPrefix,
}) => {
  const [list, setList] = useState<MetaAudience[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!adAccountId) return;
    let alive = true;
    setLoading(true);
    setError('');
    fetchMetaAudiences(username, adAccountId).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (res.ok) setList(res.audiences);
      else {
        setList([]);
        setError(res.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [username, adAccountId]);

  const used = new Set([...d.audiences, ...d.excludedAudiences].map((a) => a.id));
  const available = list.filter((a) => !used.has(a.id));

  const add = (kind: 'include' | 'exclude', id: string) => {
    const found = list.find((a) => a.id === id);
    if (!found) return;
    const item = { id: found.id, name: found.name };
    if (kind === 'include') d.setAudiences((prev) => [...prev, item]);
    else d.setExcludedAudiences((prev) => [...prev, item]);
  };

  const subtypeLabel = (s: string) =>
    ({ LOOKALIKE: '유사 타겟', WEBSITE: '웹사이트', CUSTOM: '고객 리스트', ENGAGEMENT: '참여', IG_BUSINESS: '인스타 참여', VIDEO: '동영상' } as Record<string, string>)[s] || '맞춤 타겟';

  const select = (kind: 'include' | 'exclude') => (
    <div className="relative">
      <select
        id={`${idPrefix}-aud-${kind}`}
        value=""
        onChange={(e) => add(kind, e.target.value)}
        disabled={loading || available.length === 0}
        className={`${selectCls} disabled:bg-slate-50 disabled:text-slate-400`}
      >
        <option value="">
          {loading ? '불러오는 중...' : available.length === 0 ? (list.length ? '모두 골랐습니다' : '만든 맞춤 타겟이 없습니다') : kind === 'include' ? '포함할 타겟 고르기' : '제외할 타겟 고르기'}
        </option>
        {available.map((a) => (
          <option key={a.id} value={a.id}>
            [{subtypeLabel(a.subtype)}] {a.name}{a.size > 0 ? ` · 약 ${formatCount(a.size)}명` : ''}
          </option>
        ))}
      </select>
      <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );

  return (
    <div>
      <p className={labelCls}>맞춤 타겟</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
        <div>
          {select('include')}
          <PickedList items={d.audiences} onRemove={(id) => d.setAudiences((prev) => prev.filter((p) => p.id !== id))} />
        </div>
        <div>
          {select('exclude')}
          <PickedList
            tone="rose"
            items={d.excludedAudiences}
            onRemove={(id) => d.setExcludedAudiences((prev) => prev.filter((p) => p.id !== id))}
          />
        </div>
      </div>
      <p className={hintCls}>
        {error
          ? error
          : '광고 관리자에서 만든 고객 리스트 · 웹사이트 방문자 · 유사 타겟을 그대로 씁니다. 구매자를 제외하면 신규 고객에게만 노출됩니다.'}
      </p>
    </div>
  );
};

/**
 * 예산 및 일정 · 타겟 · 노출 위치.
 *
 * idPrefix 로 입력 id 를 나눈다 — 두 창이 같은 화면에 겹쳐 열리는 일은 없지만,
 * label 이 가리키는 id 가 겹치면 그 순간 클릭이 엉뚱한 칸으로 간다.
 *
 * username · adAccountId 는 상세 타겟팅 검색과 맞춤 타겟 목록에 쓴다. 계정이 아직 없으면
 * 그 두 칸만 빠진다.
 */
export const AdDeliveryFields: React.FC<{
  delivery: AdDelivery;
  idPrefix: string;
  username?: string;
  adAccountId?: string;
}> = ({ delivery: d, idPrefix, username, adAccountId }) => {
  const igPlacements = AD_PLACEMENTS.filter((p) => p.group === 'instagram');
  const fbPlacements = AD_PLACEMENTS.filter((p) => p.group === 'facebook');
  const bid = BID_STRATEGIES.find((b) => b.value === d.bidStrategy);

  return (
    <>
      <AdSection title="예산 및 일정">
        <div>
          <p className={labelCls}>예산</p>
          <Segmented
            value={d.budgetType}
            onChange={d.setBudgetType}
            options={[
              { value: 'daily', label: '일일 예산' },
              { value: 'lifetime', label: '총 예산' },
            ]}
          />
          <input
            id={`${idPrefix}-budget`}
            aria-label={d.budgetType === 'daily' ? '일일 예산' : '총 예산'}
            inputMode="numeric"
            value={d.budget}
            onChange={(e) => d.setBudget(formatNumberWithCommas(stripCommas(e.target.value)))}
            placeholder={d.budgetType === 'daily' ? '예: 30,000' : '예: 500,000'}
            className={inputCls}
          />
          <p className={hintCls}>
            {d.budgetType === 'daily'
              ? d.budgetKrw > 0
                ? `${d.days}일 동안 최대 ${formatKoreanWon(d.budgetKrw)} · 메타는 날마다 조금 더 쓰거나 덜 쓸 수 있습니다`
                : '하루에 평균적으로 쓸 금액입니다'
              : d.dailyBudget > 0
              ? `${d.days}일 집행 기준 하루 약 ${formatKoreanWon(d.dailyBudget)} · 성과가 좋은 날에 더 씁니다`
              : '기간 전체에 쓸 금액입니다. 하루 예산을 여기에 계산해 드립니다'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor={`${idPrefix}-start`}>시작일</label>
            <input
              id={`${idPrefix}-start`}
              type="date"
              value={d.startDate}
              onChange={(e) => d.setStartDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${idPrefix}-end`}>종료일</label>
            <input
              id={`${idPrefix}-end`}
              type="date"
              value={d.endDate}
              min={d.startDate}
              onChange={(e) => d.setEndDate(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor={`${idPrefix}-bid`}>입찰 전략</label>
          <div className="relative mt-1.5">
            <select
              id={`${idPrefix}-bid`}
              value={d.bidStrategy}
              onChange={(e) => d.setBidStrategy(e.target.value as BidStrategy)}
              className={selectCls}
            >
              {BID_STRATEGIES.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          {d.bidStrategy !== 'lowest_cost' && (
            <input
              aria-label={d.bidStrategy === 'cost_cap' ? '결과당 비용 목표' : '입찰가 한도'}
              inputMode="numeric"
              value={d.bidAmount}
              onChange={(e) => d.setBidAmount(formatNumberWithCommas(stripCommas(e.target.value)))}
              placeholder={d.bidStrategy === 'cost_cap' ? '결과당 목표 비용 (예: 15,000)' : '최대 입찰가 (예: 3,000)'}
              className={inputCls}
            />
          )}
          <p className={hintCls}>{bid?.hint}</p>
        </div>
      </AdSection>

      <AdSection title="타겟">
        <label className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={d.advantageAudience}
            onChange={(e) => d.setAdvantageAudience(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-blue-600"
          />
          <span>
            <span className="block text-[12px] font-black text-slate-800">Advantage+ 타겟</span>
            <span className="block text-[10px] text-slate-500 font-bold mt-0.5 leading-relaxed">
              켜면 아래 연령 · 관심사를 '제안'으로 쓰고, 성과가 더 나을 것 같은 사람에게도 넓혀 노출합니다(성별 제한은 쓰지 않습니다).
              지역과 제외 타겟은 그대로 지킵니다.
            </span>
          </span>
        </label>

        <div>
          <p className={labelCls}>지역</p>
          <div className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black border bg-blue-50 border-blue-200 text-blue-700">
            <MapPin className="w-3 h-3" />
            대한민국
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className={labelCls}>연령</p>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="relative flex-1">
                <select
                  aria-label="최소 연령"
                  value={d.ageMin}
                  onChange={(e) => d.setAgeMin(Number(e.target.value))}
                  className={selectCls}
                >
                  {AGE_OPTIONS.filter((a) => a < AD_AGE_MAX).map((a) => (
                    <option key={a} value={a}>{a}세</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <span className="text-slate-300 font-black">~</span>
              <div className="relative flex-1">
                <select
                  aria-label="최대 연령"
                  value={d.ageMax}
                  onChange={(e) => d.setAgeMax(Number(e.target.value))}
                  className={selectCls}
                >
                  {AGE_OPTIONS.filter((a) => a > AD_AGE_MIN).map((a) => (
                    <option key={a} value={a}>{a === AD_AGE_MAX ? '65세+' : `${a}세`}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>
          <div>
            <p className={labelCls}>성별</p>
            <Segmented value={d.gender} onChange={d.setGender} options={AD_GENDERS} />
          </div>
        </div>

        {username && <InterestCategories username={username} delivery={d} />}
        {username && adAccountId && (
          <AudiencePicker username={username} adAccountId={adAccountId} delivery={d} idPrefix={idPrefix} />
        )}
      </AdSection>

      <AdSection title="노출 위치">
        <Segmented
          value={d.placementMode}
          onChange={d.setPlacementMode}
          options={[
            { value: 'auto', label: 'Advantage+ 노출 위치' },
            { value: 'manual', label: '수동 노출 위치' },
          ]}
        />
        {d.placementMode === 'auto' ? (
          <p className={hintCls}>
            메타가 인스타그램 · 페이스북 · 메신저 · Audience Network 중 성과가 나오는 위치로 예산을 나눠 씁니다(권장).
          </p>
        ) : (
          <div className="space-y-3 animate-in fade-in duration-200">
            {[
              { title: 'Instagram', items: igPlacements },
              { title: 'Facebook', items: fbPlacements },
            ].map((g) => (
              <div key={g.title}>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-black text-slate-700">{g.title}</p>
                  <button
                    type="button"
                    onClick={() =>
                      d.setPlacements((prev) => {
                        const all = g.items.every((p) => prev.includes(p.value));
                        const vals = g.items.map((p) => p.value) as AdPlacement[];
                        return all ? prev.filter((v) => !vals.includes(v)) : [...new Set([...prev, ...vals])];
                      })
                    }
                    className="text-[10px] font-black text-blue-600 hover:text-blue-700"
                  >
                    {g.items.every((p) => d.placements.includes(p.value)) ? '모두 해제' : '모두 선택'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {g.items.map((p) => (
                    <Chip
                      key={p.value}
                      box
                      label={p.label}
                      on={d.placements.includes(p.value)}
                      onClick={() => d.setPlacements((prev) => toggleValue(prev, p.value))}
                    />
                  ))}
                </div>
              </div>
            ))}
            <p className={hintCls}>고른 위치에만 노출됩니다. 위치를 좁히면 단가가 올라갈 수 있습니다.</p>
          </div>
        )}
      </AdSection>
    </>
  );
};
