import React from 'react';
import { Check } from 'lucide-react';

/**
 * '일시중지 상태로 만들기' — 광고를 메타에 실제로 만들되 노출·과금은 시작하지 않는다.
 *
 * 집행하기의 기본은 바로 집행(ACTIVE)이다. 다만 연동을 처음 확인할 때(앱 역할 계정으로
 * 흐름을 검증하거나, 예산을 쓰기 전에 광고 관리자에서 모양을 보고 싶을 때)는 돈이 나가지
 * 않는 길이 있어야 한다. 캠페인·광고 세트·광고를 PAUSED 로 만들고, 광고 현황에서 재개한다.
 */
const StartPausedToggle: React.FC<{ checked: boolean; onChange: (next: boolean) => void }> = ({
  checked,
  onChange,
}) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="w-full flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100 transition-colors"
  >
    <span
      className={`mt-0.5 w-4 h-4 rounded-[5px] border flex items-center justify-center flex-shrink-0 ${
        checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
      }`}
    >
      {checked && <Check className="w-3 h-3 text-white" strokeWidth={4} />}
    </span>
    <span>
      <span className="block text-[12px] font-black text-slate-800">일시중지 상태로 만들기(과금 없음)</span>
      <span className="block text-[10px] text-slate-500 font-medium mt-0.5 leading-relaxed">
        Meta에 광고는 만들어지지만 노출·과금은 시작되지 않습니다. 광고 현황에서 언제든 재개할 수 있습니다.
      </span>
    </span>
  </button>
);

export default StartPausedToggle;
