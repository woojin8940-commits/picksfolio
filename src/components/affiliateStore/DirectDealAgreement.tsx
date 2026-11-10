import React from 'react';
import { ShieldAlert } from 'lucide-react';

/**
 * 직거래 금지 동의 체크(필수). 브랜드 입점 신청 · 크리에이터 지원 때 받고,
 * 그 전에 승인된 계정은 처음 선정 · 판매 신청할 때 한 번 받는다. 서버도 같은 동의를 확인한다.
 */
export const DIRECT_DEAL_TEXT =
  '픽스폴리오에서 만난 브랜드 · 인플루언서와 픽스폴리오를 거치지 않고 직접 거래(협찬 · 판매 · 광고비 정산 등)하는 것을 금지합니다. 직거래가 확인되면 사전 안내 없이 바로 서비스 이용이 제한됩니다.';

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** 'slate' = 브랜드 입점 신청 화면 색, 'blue' = 크리에이터 화면 색 */
  tone?: 'slate' | 'blue';
}

const DirectDealAgreement: React.FC<Props> = ({ checked, onChange, tone = 'blue' }) => (
  <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50/60 border border-red-100 cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      className={`mt-0.5 w-4 h-4 shrink-0 ${tone === 'slate' ? 'accent-slate-900' : 'accent-blue-600'}`}
    />
    <span className="text-xs text-slate-600 leading-relaxed">
      <b className="text-slate-900 inline-flex items-center gap-1">
        <ShieldAlert className="w-3.5 h-3.5 text-red-500" />[필수] 직거래 금지 동의
      </b>
      <br />
      {DIRECT_DEAL_TEXT}
    </span>
  </label>
);

export default DirectDealAgreement;
