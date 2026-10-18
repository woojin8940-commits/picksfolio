import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2 } from 'lucide-react';
import {
  affiliateService,
  won,
  TERMS_STATE_LABEL,
  type TermsInput,
  type TermsSummary,
} from '../../services/affiliateService';

/**
 * 판매 수수료 이용약관 — 브랜드 화면.
 *
 * 결제는 브랜드 자사몰에서 끝나고 픽스폴리오는 매월 수수료를 청구한다. 첫 판매 캠페인을
 * 심사 요청하기 전에 이 약관(정산 · 입금 기한 · 입금 계좌 · 미정산 한도)에 동의해야 한다.
 * 약관 문안은 서버가 내려준다 — 운영자가 바꾼 계좌 · 한도가 그대로 들어간다.
 */

const STATE_CHIP: Record<string, string> = {
  none: 'bg-slate-100 text-slate-500',
  agreed: 'bg-emerald-50 text-emerald-700',
  outdated: 'bg-amber-50 text-amber-700',
};

const FIELDS: { key: keyof TermsInput; label: string; placeholder: string; type?: string }[] = [
  { key: 'companyName', label: '상호', placeholder: '사업자등록증의 상호' },
  { key: 'representative', label: '대표자', placeholder: '대표자 성명' },
  { key: 'businessNumber', label: '사업자등록번호', placeholder: '000-00-00000' },
  { key: 'contactName', label: '정산 담당자명', placeholder: '청구 · 입금 담당자' },
  { key: 'contactPhone', label: '담당자 연락처', placeholder: '010-0000-0000', type: 'tel' },
  { key: 'contactEmail', label: '담당자 이메일', placeholder: 'name@company.com', type: 'email' },
];

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
};

interface Props {
  summary: TermsSummary | null;
  onChange: (s: TermsSummary) => void;
  /** 동의 후 "캠페인 등록 계속하기" — 등록하려다 이 화면으로 온 경우에만. */
  onContinue?: () => void;
  /** 등록하려다 막혀서 온 경우 위에 안내를 띄운다. */
  gated?: boolean;
}

const BrandAffiliateTerms: React.FC<Props> = ({ summary, onChange, onContinue, gated }) => {
  const [form, setForm] = useState<TermsInput>({
    companyName: '', representative: '', businessNumber: '', contactName: '', contactPhone: '', contactEmail: '',
  });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (summary?.defaults) setForm(f => (f.companyName || f.contactName ? f : { ...f, ...summary.defaults }));
  }, [summary?.defaults]);

  const submit = async () => {
    setError('');
    setBusy(true);
    const res = await affiliateService.agreeTerms(form);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onChange(res);
  };

  if (!summary) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
      </div>
    );
  }

  const a = summary.agreement;
  const state = summary.state;
  const filled = FIELDS.every(f => String(form[f.key] || '').trim());

  return (
    <div className="space-y-3">
      {gated && !summary.valid && (
        <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 flex gap-2.5">
          <FileText className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] font-bold text-blue-800 leading-relaxed">
            {state === 'outdated'
              ? '판매 수수료 이용약관이 바뀌었습니다. 새 약관에 동의한 뒤 판매 캠페인 심사를 요청할 수 있습니다.'
              : '판매 캠페인 심사를 요청하려면 먼저 판매 수수료 이용약관에 동의해 주세요. 한 번 동의하면 이후 캠페인에도 그대로 적용됩니다.'}
          </p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[15px] font-black text-slate-900">판매 수수료 이용약관</p>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              결제는 자사몰에서 그대로 받고, 판매 수수료는 매월 청구서로 픽스폴리오 계좌에 입금합니다.
            </p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-black ${STATE_CHIP[state] || STATE_CHIP.none}`}>
            {TERMS_STATE_LABEL[state]}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-black text-slate-400">미정산 한도</p>
            <p className="text-[13px] font-black text-slate-800">
              {summary.terms.unsettledLimit > 0 ? won(summary.terms.unsettledLimit) : '별도 안내'}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-black text-slate-400">입금 기한</p>
            <p className="text-[13px] font-black text-slate-800">{summary.terms.paymentTerms}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-black text-slate-400">입금 계좌</p>
            <p className="text-[12px] font-black text-slate-800 break-all">{summary.terms.depositAccount || '청구서에 안내'}</p>
          </div>
        </div>

        <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-3">
          {summary.terms.sections.map(sec => (
            <div key={sec.title}>
              <p className="text-[12px] font-black text-slate-800">{sec.title}</p>
              <p className="text-[12px] font-medium text-slate-600 leading-relaxed mt-0.5 break-keep">{sec.body}</p>
            </div>
          ))}
          <p className="text-[10px] font-bold text-slate-400">약관 버전 {summary.terms.version}</p>
        </div>

        {state === 'agreed' && a && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-100 p-4">
            <p className="text-[13px] font-black text-emerald-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> 약관에 동의했습니다
            </p>
            <p className="text-[11px] text-emerald-700 font-bold mt-1">
              {formatDate(a.agreedAt)} 동의{a.companyName && ` · ${a.companyName}`}{a.contactName && ` · 담당 ${a.contactName}`}
            </p>
            {onContinue && (
              <button
                type="button"
                onClick={onContinue}
                className="mt-3 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-[12px] font-black hover:bg-slate-800"
              >
                판매 캠페인 등록 계속하기
              </button>
            )}
          </div>
        )}

        {state === 'outdated' && (
          <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 p-3 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-[12px] font-bold text-amber-800 leading-relaxed">
              약관이 바뀌었습니다. 진행 중인 캠페인은 그대로 운영되고, 다음 캠페인을 등록하려면 새 약관에 동의해 주세요.
            </p>
          </div>
        )}

        {state !== 'agreed' && (
          <div className="mt-4">
            <p className="text-[12px] font-black text-slate-700 mb-2">브랜드 정보</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {FIELDS.map(f => (
                <label key={f.key} className="block">
                  <span className="text-[11px] font-black text-slate-500">{f.label}</span>
                  <input
                    type={f.type || 'text'}
                    value={form[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-[13px] font-bold text-slate-800 focus:outline-none focus:border-slate-400"
                  />
                </label>
              ))}
            </div>
            <label className="mt-3 flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={agree}
                onChange={e => setAgree(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 flex-shrink-0"
              />
              <span className="text-[12px] font-bold text-slate-600 leading-relaxed break-keep">
                (필수) 위 판매 수수료 이용약관을 읽었으며, 정산월 다음 달 15일까지 청구 금액을 픽스폴리오 계좌로 입금하는 조건에 동의합니다.
              </span>
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={!filled || !agree || busy}
              className="mt-3 w-full py-3 rounded-xl bg-slate-900 text-white text-[13px] font-black hover:bg-slate-800 disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {state === 'outdated' ? '새 약관에 동의하기' : '약관에 동의하기'}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-[12px] font-bold text-rose-500">{error}</p>}
      </div>
    </div>
  );
};

export default BrandAffiliateTerms;
