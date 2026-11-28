import React, { useEffect, useState } from 'react';
import { apiService } from '../services/apiService';
import { formatPhoneInput } from '../utils/formatters';

/**
 * 브랜드 멤버십 "엔터프라이즈 문의하기" 폼.
 *
 * 예전에는 mailto 링크라, 메일 앱이 연결되지 않은 기기(앱 · 대부분의 PC 브라우저)에서는
 * 눌러도 아무 일이 없었다. 이제는 이 폼에서 바로 남기고, 운영 콘솔 "엔터프라이즈 문의" 탭에서 본다.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

const INPUT =
  'w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';
const LABEL = 'block text-xs font-black text-slate-700 mb-1.5';

const EMPTY = { company: '', name: '', phone: '', email: '', message: '' };

const EnterpriseInquiryModal: React.FC<Props> = ({ open, onClose }) => {
  const [form, setForm] = useState(EMPTY);
  const [consent, setConsent] = useState(false);
  const [botField, setBotField] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setDone(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: key === 'phone' ? formatPhoneInput(e.target.value) : e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = (['company', 'name', 'phone', 'email', 'message'] as const).some((k) => !form[k].trim());
    if (missing) { setError('회사명, 담당자 성함, 연락처, 이메일, 문의 내용을 모두 입력해 주세요.'); return; }
    if (form.phone.replace(/[^0-9]/g, '').length < 9) { setError('연락처를 정확히 입력해 주세요.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError('이메일 주소를 정확히 입력해 주세요.'); return; }
    if (!consent) { setError('개인정보 수집·이용에 동의해 주세요.'); return; }
    setSending(true);
    setError('');
    const res = await apiService.submitEnterpriseInquiry({
      company: form.company.trim(),
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      message: form.message.trim(),
      privacy_consent: true,
      'bot-field': botField,
    });
    setSending(false);
    if (res.error) { setError(res.error); return; }
    setDone(true);
    setForm(EMPTY);
    setConsent(false);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="엔터프라이즈 문의"
      >
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">엔터프라이즈 문의</h2>
            <p className="text-xs text-slate-500 font-medium mt-1">
              필요한 캠페인 수와 선정 인원, 직원 좌석을 알려 주시면 담당자가 확인 후 연락드립니다.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none px-1" aria-label="닫기">
            ×
          </button>
        </div>

        {done ? (
          <div className="px-5 py-10 text-center">
            <p className="text-base font-black text-slate-900">문의가 접수됐어요</p>
            <p className="text-sm text-slate-500 font-medium mt-2">남겨 주신 연락처로 담당자가 연락드릴게요.</p>
            <button type="button" onClick={onClose} className="mt-6 px-6 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800">
              확인
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 py-4 space-y-3.5">
            {/* 봇이 채우는 숨은 칸 — 사람에게는 보이지 않는다. */}
            <input
              type="text"
              name="bot-field"
              value={botField}
              onChange={(e) => setBotField(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              className="hidden"
              aria-hidden="true"
            />
            <div>
              <label className={LABEL}>회사명</label>
              <input className={INPUT} value={form.company} onChange={set('company')} maxLength={100} placeholder="회사 또는 브랜드 이름" />
            </div>
            <div>
              <label className={LABEL}>담당자 성함</label>
              <input className={INPUT} value={form.name} onChange={set('name')} maxLength={50} placeholder="예: 홍길동" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className={LABEL}>연락처</label>
                <input className={INPUT} value={form.phone} onChange={set('phone')} inputMode="tel" maxLength={20} placeholder="010-0000-0000" />
              </div>
              <div>
                <label className={LABEL}>이메일</label>
                <input className={INPUT} value={form.email} onChange={set('email')} type="email" maxLength={200} placeholder="name@company.com" />
              </div>
            </div>
            <div>
              <label className={LABEL}>문의 내용</label>
              <textarea
                className={`${INPUT} resize-y`}
                rows={5}
                value={form.message}
                onChange={set('message')}
                maxLength={3000}
                placeholder="예: 월 10건 정도 캠페인을 진행하고, 선정 인플루언서는 월 150명 정도 필요합니다. 직원 계정은 5명 정도 쓸 예정이에요."
              />
            </div>
            <label className="flex items-start gap-2 text-[11px] text-slate-500 font-medium leading-relaxed cursor-pointer">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
              <span>
                (필수) 문의 답변과 계약 상담을 위해 회사명, 담당자 성함, 연락처, 이메일, 문의 내용을 수집·이용하는 데 동의합니다.
                상담이 끝나면 지체 없이 파기하며, 계약을 맺은 경우에는 계약 관련 기록으로 보관합니다.
              </span>
            </label>
            {error && <p className="text-[11px] font-bold text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <button
              type="submit"
              disabled={sending}
              className="w-full py-3 rounded-xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800 disabled:opacity-50"
            >
              {sending ? '보내는 중...' : '문의 남기기'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default EnterpriseInquiryModal;
