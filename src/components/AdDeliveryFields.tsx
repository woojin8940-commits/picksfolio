import React, { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { formatKoreanWon, formatNumberWithCommas, stripCommas, todayInSeoul } from '../utils/formatters';
import { AD_AGE_BANDS, AD_PLACEMENTS, AD_REGIONS, AdPlacement } from '../utils/adBoosts';

/**
 * 광고 집행 조건 — 얼마를, 언제까지, 누구에게, 어디에.
 *
 * 이 네 가지는 소재가 어디서 왔는지와 상관이 없다. 이력에서 고른 게시물을 부스팅할 때도,
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

export const useAdDelivery = () => {
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState(todayInSeoul());
  const [endDate, setEndDate] = useState(dateAfter(14));
  const [ageBands, setAgeBands] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [placementMode, setPlacementMode] = useState<'auto' | 'manual'>('auto');
  const [placements, setPlacements] = useState<AdPlacement[]>([]);

  const budgetKrw = useMemo(() => parseInt(stripCommas(budget) || '0', 10) || 0, [budget]);

  // 기간으로 나눈 하루 예산. 메타는 하루 단위로 쓰기 때문에, 총 예산만 적으면
  // 브랜드는 이 광고가 하루에 얼마씩 나가는지를 모른 채 집행하게 된다.
  const days = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const from = new Date(`${startDate}T00:00:00`).getTime();
    const to = new Date(`${endDate}T00:00:00`).getTime();
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0;
    return Math.round((to - from) / 86400000) + 1;
  }, [startDate, endDate]);

  const dailyBudget = days > 0 && budgetKrw > 0 ? Math.round(budgetKrw / days) : 0;

  /** 집행을 막아야 하는 이유. 없으면 빈 문자열이다. */
  const validate = (): string => {
    if (budgetKrw <= 0) return '예산을 입력해 주세요.';
    if (days <= 0) return '종료일을 시작일 이후로 정해 주세요.';
    if (placementMode === 'manual' && placements.length === 0) {
      return '노출 위치를 하나 이상 고르거나 자동 노출로 두세요.';
    }
    return '';
  };

  /** 집행 요청에 그대로 담기는 값. 창마다 같은 모양으로 저장된다. */
  const payload = () => ({
    budgetKrw,
    startDate,
    endDate,
    ageBands,
    regions,
    placementMode,
    placements: placementMode === 'manual' ? placements : [],
  });

  return {
    budget, setBudget,
    startDate, setStartDate,
    endDate, setEndDate,
    ageBands, setAgeBands,
    regions, setRegions,
    placementMode, setPlacementMode,
    placements, setPlacements,
    budgetKrw, days, dailyBudget,
    validate, payload,
  };
};

/**
 * 예산 · 기간 · 타겟 · 노출 위치.
 *
 * idPrefix 로 입력 id 를 나눈다 — 두 창이 같은 화면에 겹쳐 열리는 일은 없지만,
 * label 이 가리키는 id 가 겹치면 그 순간 클릭이 엉뚱한 칸으로 간다.
 */
export const AdDeliveryFields: React.FC<{ delivery: AdDelivery; idPrefix: string }> = ({
  delivery: d,
  idPrefix,
}) => (
  <>
    <div>
      <label className={labelCls} htmlFor={`${idPrefix}-budget`}>총 예산</label>
      <input
        id={`${idPrefix}-budget`}
        inputMode="numeric"
        value={d.budget}
        onChange={(e) => d.setBudget(formatNumberWithCommas(stripCommas(e.target.value)))}
        placeholder="예: 500,000"
        className={inputCls}
      />
      <p className="text-[10px] text-slate-400 font-bold mt-1">
        {d.dailyBudget > 0
          ? `${d.days}일 집행 기준 하루 약 ${formatKoreanWon(d.dailyBudget)}`
          : '기간으로 나눈 하루 예산을 여기에 적어 드립니다'}
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
      <p className={labelCls}>타겟 연령</p>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {AD_AGE_BANDS.map((band) => (
          <Chip
            key={band}
            label={band}
            on={d.ageBands.includes(band)}
            onClick={() => d.setAgeBands((prev) => toggleValue(prev, band))}
          />
        ))}
      </div>
      {/* 아무것도 고르지 않은 상태가 "빠뜨렸다"가 아니라 "전체"라는 걸 적어 둔다. */}
      <p className="text-[10px] text-slate-400 font-bold mt-1.5">
        {d.ageBands.length === 0 ? '고르지 않으면 연령 전체로 집행합니다' : `${d.ageBands.length}개 연령대`}
      </p>
    </div>

    <div>
      <p className={labelCls}>타겟 지역</p>
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {AD_REGIONS.map((region) => (
          <Chip
            key={region}
            label={region}
            on={d.regions.includes(region)}
            onClick={() => d.setRegions((prev) => toggleValue(prev, region))}
          />
        ))}
      </div>
      <p className="text-[10px] text-slate-400 font-bold mt-1.5">
        {d.regions.length === 0 ? '고르지 않으면 전국으로 집행합니다' : `${d.regions.length}개 지역`}
      </p>
    </div>

    <div>
      <p className={labelCls}>노출 위치</p>
      <div className="flex gap-1.5 mt-1.5">
        {([['auto', '자동 노출'], ['manual', '직접 선택']] as ['auto' | 'manual', string][]).map(
          ([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => d.setPlacementMode(mode)}
              className={`flex-1 py-2 rounded-xl text-[11px] font-black border transition-colors ${
                d.placementMode === mode
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {d.placementMode === 'auto' ? (
        <p className="text-[10px] text-slate-400 font-bold mt-1.5 leading-relaxed">
          메타가 피드 · 스토리 · 릴스 · 탐색 중 성과가 나오는 위치로 예산을 나눠 씁니다.
        </p>
      ) : (
        <div className="mt-2 animate-in fade-in duration-200">
          <div className="flex flex-wrap gap-1.5">
            {AD_PLACEMENTS.map((p) => (
              <Chip
                key={p.value}
                box
                label={p.label}
                on={d.placements.includes(p.value)}
                onClick={() => d.setPlacements((prev) => toggleValue(prev, p.value))}
              />
            ))}
          </div>
          <p className="text-[10px] text-slate-400 font-bold mt-1.5">
            고른 위치에만 노출됩니다. 위치를 좁히면 단가가 올라갈 수 있습니다.
          </p>
        </div>
      )}
    </div>
  </>
);
