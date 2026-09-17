import React, { useMemo, useState } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import { formatKoreanWon, formatNumberWithCommas, stripCommas, todayInSeoul } from '../utils/formatters';
import {
  AD_AGE_BANDS,
  AD_PLACEMENTS,
  AD_REGIONS,
  AdBoost,
  AdPlacement,
} from '../utils/adBoosts';

/**
 * 콘텐츠 부스팅 창 — 이력에서 고른 게시물을 광고로 돌리는 설정.
 *
 * 이 창에서 브랜드가 고르는 것은 네 가지뿐이다: 얼마를, 언제까지, 누구에게, 어디에.
 * 무엇을 광고할지(콘텐츠)와 누구 이름으로 나갈지(인플루언서), 무엇을 목적으로 돌릴지
 * (전환)는 이미 정해져 있다 — 이력에서 그 게시물을 눌러 들어왔고, 브랜디드 콘텐츠
 * 광고는 게시물 소유자가 고정이며, 이력에서 성과가 좋은 소재를 다시 돌리는 이유는
 * 전환이다. 그래서 그 셋은 고를 수 있는 항목이 아니라 창 위쪽의 안내로 둔다.
 * 선택지로 만들면 브랜드는 "무엇을 고르라는 건지" 를 한 번 더 생각해야 한다.
 *
 * 노출 위치는 자동이 기본이다. 메타에서도 자동 노출이 단가가 낮게 나오는 쪽이라,
 * 직접 고르는 것은 이유가 있을 때만 하는 선택이어야 한다. 그래서 자동을 켜 둔 채
 * 체크박스를 숨기고, '직접 선택'을 눌렀을 때만 펼친다.
 *
 * 집행은 아직 실제로 나가지 않는다(메타 광고 집행 권한 심사 전). 성공 화면에서
 * 그 사실을 분명히 적고, 광고 현황에는 '요청' 상태로만 올린다.
 */

interface AdBoostModalProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  campaignTitle: string;
  collabId: string;
  creatorHandle: string;
  partnershipCode: string;
  thumbnailUrl: string;
  /** 집행 요청이 만들어졌을 때. 광고 현황 목록에 올리는 일은 부모가 한다. */
  onSubmitted: (boost: AdBoost) => void;
  /** 성공 화면에서 광고 현황으로 넘어갈 수 있으면 넘겨준다. */
  onViewAdStatus?: () => void;
}

/** 오늘부터 n일 뒤 날짜(Asia/Seoul 기준의 오늘에서 센다). */
const dateAfter = (days: number): string => {
  const base = new Date(`${todayInSeoul()}T00:00:00`);
  base.setDate(base.getDate() + days);
  return base.toLocaleDateString('en-CA');
};

const labelCls = 'text-[11px] font-black text-slate-500';
const inputCls =
  'mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-[13px] font-bold text-slate-900 ' +
  'focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors';

/** 여러 개를 켜고 끄는 칩. 연령·지역·노출 위치가 같은 모양을 쓴다. */
const Chip: React.FC<{ label: string; on: boolean; onClick: () => void; box?: boolean }> = ({
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

const AdBoostModal: React.FC<AdBoostModalProps> = ({
  open,
  onClose,
  campaignId,
  campaignTitle,
  collabId,
  creatorHandle,
  partnershipCode,
  thumbnailUrl,
  onSubmitted,
  onViewAdStatus,
}) => {
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState(todayInSeoul());
  const [endDate, setEndDate] = useState(dateAfter(14));
  const [ageBands, setAgeBands] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [placementMode, setPlacementMode] = useState<'auto' | 'manual'>('auto');
  const [placements, setPlacements] = useState<AdPlacement[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useCloseOnBack(open, onClose);

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

  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const submit = async () => {
    if (budgetKrw <= 0) {
      setError('예산을 입력해 주세요.');
      return;
    }
    if (days <= 0) {
      setError('종료일을 시작일 이후로 정해 주세요.');
      return;
    }
    if (placementMode === 'manual' && placements.length === 0) {
      setError('노출 위치를 하나 이상 고르거나 자동 노출로 두세요.');
      return;
    }
    setError('');
    setSubmitting(true);

    // 연동 전이라 실제 집행은 없다. 버튼을 누른 뒤의 흐름만 확인할 수 있게,
    // 잠깐 기다린 뒤 성공으로 넘긴다.
    await new Promise((r) => setTimeout(r, 700));

    onSubmitted({
      id: `boost_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      requestedAt: new Date().toISOString(),
      campaignId,
      campaignTitle,
      collabId,
      creatorHandle,
      partnershipCode,
      thumbnailUrl,
      budgetKrw,
      startDate,
      endDate,
      ageBands,
      regions,
      placementMode,
      placements: placementMode === 'manual' ? placements : [],
    });

    setSubmitting(false);
    setDone(true);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 max-h-[90vh] modal-maxh-90 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <p className="text-sm font-black text-slate-900">메타 광고로 부스팅</p>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              이력에서 고른 게시물을 그대로 광고 소재로 씁니다
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="p-6 md:p-8 text-center overflow-y-auto">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-emerald-600" strokeWidth={3} />
            </div>
            <p className="text-sm font-black text-slate-900 mt-3">집행 요청이 접수되었습니다</p>
            <p className="text-[12px] text-slate-500 font-bold mt-1.5 leading-relaxed">
              {campaignTitle} · @{creatorHandle}
              <br />
              예산 {formatKoreanWon(budgetKrw)} · {startDate} ~ {endDate}
            </p>
            <p className="text-[11px] text-amber-600 font-bold mt-3 leading-relaxed">
              메타 광고 집행 권한 심사 전이라 실제 노출은 아직 시작되지 않습니다. 광고 현황에
              '요청' 상태로 올라가고, 심사가 끝나면 이 요청이 그대로 집행됩니다.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {onViewAdStatus && (
                <button
                  type="button"
                  onClick={() => { onClose(); onViewAdStatus(); }}
                  className="w-full py-3 rounded-xl bg-slate-900 text-white text-[12px] font-black hover:bg-slate-800 transition-colors"
                >
                  광고 현황에서 보기
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-xl border border-slate-200 text-slate-500 text-[12px] font-black hover:bg-slate-50 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto px-5 py-4 space-y-5">
              {/* 무엇을, 누구 이름으로 돌리는지. 고르는 항목이 아니라 확인용이다. */}
              <div className="flex items-center gap-3 bg-slate-50 rounded-2xl p-3">
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="w-14 aspect-[9/16] rounded-xl object-cover bg-slate-200 flex-shrink-0"
                  />
                ) : (
                  <div className="w-14 aspect-[9/16] rounded-xl bg-slate-200 flex-shrink-0 flex items-center justify-center">
                    <span className="text-[9px] text-slate-400 font-black">소재</span>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[13px] font-black text-slate-900 leading-snug">
                    인플루언서 @{creatorHandle}로 광고 진행
                  </p>
                  <p className="text-[11px] text-slate-500 font-bold mt-1 truncate">{campaignTitle}</p>
                  <p className="text-[10px] text-slate-400 font-medium mt-0.5 break-all">
                    파트너십 코드 {partnershipCode}
                  </p>
                </div>
              </div>

              {/* 목적은 전환으로 고정한다 — 이력에서 소재를 다시 돌리는 이유다. */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
                <p className="text-[12px] font-black text-blue-800">전환 목적으로 진행됩니다</p>
                <p className="text-[11px] text-blue-600 font-medium mt-1 leading-relaxed">
                  이 게시물의 브랜디드 콘텐츠 파트너십 코드를 광고 소재로 써서, 구매 전환을
                  목적으로 집행합니다. 성과는 광고 현황에서 전환수 · 전환당 비용 · ROAS 로 확인합니다.
                </p>
              </div>

              <div>
                <label className={labelCls} htmlFor="boost-budget">총 예산</label>
                <input
                  id="boost-budget"
                  inputMode="numeric"
                  value={budget}
                  onChange={(e) => setBudget(formatNumberWithCommas(stripCommas(e.target.value)))}
                  placeholder="예: 500,000"
                  className={inputCls}
                />
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  {dailyBudget > 0
                    ? `${days}일 집행 기준 하루 약 ${formatKoreanWon(dailyBudget)}`
                    : '기간으로 나눈 하루 예산을 여기에 적어 드립니다'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="boost-start">시작일</label>
                  <input
                    id="boost-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="boost-end">종료일</label>
                  <input
                    id="boost-end"
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
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
                      on={ageBands.includes(band)}
                      onClick={() => setAgeBands((prev) => toggle(prev, band))}
                    />
                  ))}
                </div>
                {/* 아무것도 고르지 않은 상태가 "빠뜨렸다"가 아니라 "전체"라는 걸 적어 둔다. */}
                <p className="text-[10px] text-slate-400 font-bold mt-1.5">
                  {ageBands.length === 0 ? '고르지 않으면 연령 전체로 집행합니다' : `${ageBands.length}개 연령대`}
                </p>
              </div>

              <div>
                <p className={labelCls}>타겟 지역</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {AD_REGIONS.map((region) => (
                    <Chip
                      key={region}
                      label={region}
                      on={regions.includes(region)}
                      onClick={() => setRegions((prev) => toggle(prev, region))}
                    />
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 font-bold mt-1.5">
                  {regions.length === 0 ? '고르지 않으면 전국으로 집행합니다' : `${regions.length}개 지역`}
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
                        onClick={() => setPlacementMode(mode)}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-black border transition-colors ${
                          placementMode === mode
                            ? 'bg-slate-900 border-slate-900 text-white'
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>

                {placementMode === 'auto' ? (
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
                          on={placements.includes(p.value)}
                          onClick={() => setPlacements((prev) => toggle(prev, p.value))}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-400 font-bold mt-1.5">
                      고른 위치에만 노출됩니다. 위치를 좁히면 단가가 올라갈 수 있습니다.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 px-5 py-4 bg-white">
              {error && <p className="text-[11px] text-rose-500 font-black mb-2">{error}</p>}
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-blue-600 text-white text-[13px] font-black hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? '집행 요청 중' : '집행하기'}
              </button>
              <p className="text-[10px] text-slate-400 font-medium mt-2 text-center leading-relaxed">
                메타 광고 집행 권한 심사 전이라 실제 노출은 시작되지 않습니다.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdBoostModal;
