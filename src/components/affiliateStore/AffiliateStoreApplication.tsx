import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { affiliateStoreService, isHttpsUrl, withHttps, type ApplicationInput, type StoreApplication } from '../../services/affiliateStoreService';
import DirectDealAgreement from './DirectDealAgreement';

/**
 * 어필리에이트 입점 신청서.
 *
 * 1) 사업자 정보 → 2) 브랜드 정보 → 3) 담당자 정보 순서로 한 단계씩 받는다.
 * 위쪽 진행 막대와 "다음 ○○" 안내로 지금 어디쯤인지 보여 준다.
 */

const isChannelUrl = (v: string) => /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v.trim());

interface Props {
  businessUsername: string;
  categories: string[];
  /** 반려된 신청서가 있으면 그 내용으로 미리 채운다. */
  previous: StoreApplication | null;
  onSubmitted: (app: StoreApplication) => void;
}

const STEPS = [
  { key: 'business', title: '사업자 정보를 입력해 주세요', desc: '입점 심사에 사용할 사업자 정보를 알려주세요.', label: '사업자 정보' },
  { key: 'brand', title: '브랜드 정보를 입력해 주세요', desc: '입점 심사에 사용할 대표 브랜드와 판매 채널을 알려주세요.', label: '브랜드 정보' },
  { key: 'contact', title: '담당자 정보를 입력해 주세요', desc: '입점 심사 결과와 운영 안내를 받을 담당자 연락처를 알려주세요.', label: '담당자 정보' },
] as const;

const formatBizNo = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};

const formatPhone = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
};

const Required = () => (
  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-500 ml-1.5">
    <span className="w-1 h-1 rounded-full bg-orange-500" />필수 항목
  </span>
);

const Field: React.FC<{ label: string; required?: boolean; hint?: string; children: React.ReactNode }> = ({ label, required, hint, children }) => (
  <div className="mb-7">
    <label className="flex items-center text-[13px] font-bold text-slate-900 mb-1.5">
      {label}
      {required && <Required />}
    </label>
    {hint && <p className="text-[11px] text-slate-500 mb-2">{hint}</p>}
    {children}
  </div>
);

const inputCls =
  'w-full h-12 px-4 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 transition-colors';

const AffiliateStoreApplication: React.FC<Props> = ({ businessUsername, categories, previous, onSubmitted }) => {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ApplicationInput>(() => ({
    businessName: previous?.businessName || '',
    businessNumber: formatBizNo(previous?.businessNumber || ''),
    ceoName: previous?.ceoName || '',
    businessAddress: previous?.businessAddress || '',
    csPhone: previous?.csPhone || '',
    mailOrderNumber: previous?.mailOrderNumber || '',
    inquiryUrl: previous?.inquiryUrl || '',
    brandName: previous?.brandName || '',
    channelUrl: previous?.channelUrl || '',
    // 카테고리 목록이 상품 카테고리와 하나로 합쳐졌다 — 예전 신청서의 없는 항목은 뺀다.
    categories: (previous?.categories || []).filter(c => categories.includes(c)),
    contactName: previous?.contactName || '',
    contactPosition: previous?.contactPosition || '',
    contactPhone: previous?.contactPhone || '',
    contactEmail: previous?.contactEmail || '',
  }));
  const [agree, setAgree] = useState(false);
  const [agreeDirectDeal, setAgreeDirectDeal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof ApplicationInput>(k: K, v: ApplicationInput[K]) => setForm(f => ({ ...f, [k]: v }));

  const stepValid = useMemo(() => {
    if (step === 0) return form.businessName.trim().length > 0 && form.businessNumber.replace(/\D/g, '').length === 10
      && form.ceoName.trim().length > 0 && form.businessAddress.trim().length > 0 && form.csPhone.replace(/\D/g, '').length >= 8
      && form.mailOrderNumber.trim().length > 0;
    if (step === 1) return form.brandName.trim().length > 0 && isChannelUrl(withHttps(form.channelUrl)) && form.categories.length > 0
      && isHttpsUrl(withHttps(form.inquiryUrl));
    return (
      form.contactName.trim().length > 0 &&
      form.contactPhone.replace(/\D/g, '').length >= 9 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim()) &&
      agree && agreeDirectDeal
    );
  }, [step, form, agree, agreeDirectDeal]);

  /** 브랜드 정보 단계에서 아직 채우지 않은 항목(다음 버튼 옆에 안내). */
  const brandMissing = useMemo(() => {
    if (step !== 1) return [];
    const m: string[] = [];
    if (!form.brandName.trim()) m.push('대표 브랜드명');
    if (!isChannelUrl(withHttps(form.channelUrl))) m.push('대표 판매 채널 주소');
    if (!isHttpsUrl(withHttps(form.inquiryUrl))) m.push('고객 문의 링크');
    if (form.categories.length === 0) m.push('주요 카테고리');
    return m;
  }, [step, form]);

  const toggleCategory = (c: string) =>
    set('categories', form.categories.includes(c) ? form.categories.filter(x => x !== c) : [...form.categories, c]);

  const next = async () => {
    setError('');
    if (!stepValid) return;
    if (step < STEPS.length - 1) {
      if (step === 1) setForm(f => ({ ...f, channelUrl: withHttps(f.channelUrl), inquiryUrl: withHttps(f.inquiryUrl) }));
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSubmitting(true);
    const res = await affiliateStoreService.apply(businessUsername, {
      ...form,
      channelUrl: withHttps(form.channelUrl),
      inquiryUrl: withHttps(form.inquiryUrl),
      businessNumber: form.businessNumber.replace(/\D/g, ''),
      directDealAgreement: agreeDirectDeal,
    });
    setSubmitting(false);
    if (res.error || !res.application) {
      setError(res.error || '신청서를 보내지 못했습니다.');
      return;
    }
    onSubmitted(res.application);
  };

  const current = STEPS[step];
  const nextLabel = STEPS[step + 1]?.label;

  return (
    <div className="min-h-screen bg-[#f8f9fb] px-5 py-10 md:py-16">
      <div className="max-w-[560px] mx-auto">
        {/* 상단: 로고 + 다음 단계 안내 + 진행 막대 */}
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-[10px] font-black tracking-[0.2em] text-slate-400 uppercase">Affiliate</p>
            <p className="text-xl font-black tracking-tighter text-slate-900">PICKSFOLIO</p>
          </div>
          <p className="text-[11px] text-slate-500">
            {nextLabel ? <>다음 <b className="text-slate-900">{nextLabel}</b></> : <b className="text-slate-900">마지막 단계</b>}
          </p>
        </div>
        <div className="h-[3px] bg-slate-200 rounded-full mb-12 overflow-hidden">
          <div className="h-full bg-slate-900 transition-all duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>

        {previous?.status === 'rejected' && step === 0 && (
          <div className="mb-8 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-xs font-black text-red-600">이전 입점 신청이 반려되었어요</p>
            {previous.rejectReason && <p className="text-xs text-red-500 mt-1 whitespace-pre-wrap">{previous.rejectReason}</p>}
            <p className="text-[11px] text-red-400 mt-1">내용을 고쳐 다시 신청해 주세요.</p>
          </div>
        )}

        <h2 className="text-2xl font-black text-slate-900 mb-1.5">{current.title}</h2>
        <p className="text-[13px] text-slate-500 mb-9">{current.desc}</p>

        {step === 0 && (
          <>
            <Field label="사업자명" required hint="사업자등록증에 적힌 상호를 입력해 주세요.">
              <input className={inputCls} placeholder="예: 주식회사 픽스폴리오" value={form.businessName} onChange={e => set('businessName', e.target.value)} maxLength={100} />
            </Field>
            <Field label="사업자 등록번호" required hint="숫자 10자리를 입력해 주세요.">
              <input
                className={inputCls}
                inputMode="numeric"
                placeholder="000-00-00000"
                value={form.businessNumber}
                onChange={e => set('businessNumber', formatBizNo(e.target.value))}
              />
            </Field>
            <Field label="대표자" required>
              <input className={inputCls} placeholder="사업자등록증의 대표자 이름" value={form.ceoName} onChange={e => set('ceoName', e.target.value)} maxLength={50} />
            </Field>
            <Field label="사업장 주소" required hint="상품 페이지의 판매자 정보에 표시됩니다.">
              <input className={inputCls} placeholder="사업자등록증의 사업장 주소" value={form.businessAddress} onChange={e => set('businessAddress', e.target.value)} maxLength={300} />
            </Field>
            <Field label="고객센터 연락처" required hint="상품 페이지의 판매자 정보에 표시되는 번호예요.">
              <input className={inputCls} inputMode="tel" placeholder="02-000-0000" value={form.csPhone} onChange={e => set('csPhone', e.target.value)} maxLength={20} />
            </Field>
            <Field label="통신판매업 신고번호" required hint="상품 페이지의 판매자 정보에 표시됩니다.">
              <input className={inputCls} placeholder="예: 제 2026-서울강남-0000 호" value={form.mailOrderNumber} onChange={e => set('mailOrderNumber', e.target.value)} maxLength={60} />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="대표 브랜드명" required>
              <input className={inputCls} placeholder="예: PICKSFOLIO" value={form.brandName} onChange={e => set('brandName', e.target.value)} maxLength={100} />
            </Field>
            <Field label="대표 판매 채널 주소" required hint="자사몰, 스마트스토어 등 판매가 잘 이뤄지고 있는 주소를 입력해 주세요.">
              <input className={inputCls} placeholder="www.example.com" value={form.channelUrl} onChange={e => set('channelUrl', e.target.value.trim())} onBlur={() => set('channelUrl', withHttps(form.channelUrl))} maxLength={500} inputMode="url" />
              {form.channelUrl && !isChannelUrl(withHttps(form.channelUrl)) && <p className="text-[11px] font-bold text-red-500 mt-1.5">주소 형식을 확인해 주세요. (예: www.brand.com)</p>}
            </Field>
            <Field label="고객 문의 링크(자사몰 주소)" required hint="구매자가 문의하기를 누르면 이 주소로 이동해요. 자사몰 고객센터나 카카오톡 채널 주소를 넣어도 돼요.">
              <input className={`${inputCls} ${form.inquiryUrl && !isHttpsUrl(withHttps(form.inquiryUrl)) ? 'border-red-300' : ''}`} placeholder="pf.kakao.com/... 또는 www.example.com" value={form.inquiryUrl} onChange={e => set('inquiryUrl', e.target.value.trim())} onBlur={() => set('inquiryUrl', withHttps(form.inquiryUrl))} maxLength={500} inputMode="url" />
              {form.inquiryUrl && !isHttpsUrl(withHttps(form.inquiryUrl)) && <p className="text-[11px] font-bold text-red-500 mt-1.5">주소 형식을 확인해 주세요. (예: pf.kakao.com/_abc)</p>}
            </Field>
            <div className="border-t border-slate-200 my-8" />
            <Field label="주요 카테고리" required hint="브랜드와 가장 가까운 카테고리를 하나 이상 선택해 주세요.">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {categories.map(c => {
                  const on = form.categories.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleCategory(c)}
                      className={`h-11 rounded-xl border text-[13px] font-bold transition-all ${
                        on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3">
              <Field label="담당자 이름" required>
                <input className={inputCls} placeholder="홍길동" value={form.contactName} onChange={e => set('contactName', e.target.value)} maxLength={50} />
              </Field>
              <Field label="직책">
                <input className={inputCls} placeholder="예: 마케팅 팀장" value={form.contactPosition} onChange={e => set('contactPosition', e.target.value)} maxLength={50} />
              </Field>
            </div>
            <Field label="담당자 연락처" required>
              <input className={inputCls} inputMode="tel" placeholder="010-0000-0000" value={form.contactPhone} onChange={e => set('contactPhone', formatPhone(e.target.value))} />
            </Field>
            <Field label="담당자 이메일" required>
              <input className={inputCls} inputMode="email" placeholder="name@company.com" value={form.contactEmail} onChange={e => set('contactEmail', e.target.value.trim())} maxLength={200} />
            </Field>
            <label className="flex items-start gap-2.5 p-4 rounded-xl bg-white border border-slate-200 cursor-pointer">
              <input type="checkbox" className="mt-0.5 w-4 h-4 accent-slate-900" checked={agree} onChange={e => setAgree(e.target.checked)} />
              <span className="text-xs text-slate-600 leading-relaxed">
                <b className="text-slate-900">[필수] 개인정보 수집·이용 동의</b><br />
                입점 심사와 운영 안내를 위해 담당자 이름 · 직책 · 연락처 · 이메일을 수집하며, 입점 해지 시까지 보관합니다.
              </span>
            </label>
            <div className="mt-2">
              <DirectDealAgreement checked={agreeDirectDeal} onChange={setAgreeDirectDeal} tone="slate" />
            </div>
          </>
        )}

        {error && <p className="mt-6 text-xs font-bold text-red-500">{error}</p>}

        {brandMissing.length > 0 && (
          <p className="mt-6 text-right text-[11px] font-bold text-slate-500">
            다음으로 넘어가려면 <span className="text-red-500">{brandMissing.join(' · ')}</span> 항목을 확인해 주세요.
          </p>
        )}

        <div className={`flex justify-end gap-2 ${brandMissing.length > 0 ? 'mt-3' : 'mt-10'}`}>
          <button
            type="button"
            onClick={() => { setError(''); setStep(s => Math.max(0, s - 1)); }}
            disabled={step === 0 || submitting}
            className="h-11 px-5 rounded-xl bg-slate-200 text-slate-700 text-sm font-bold disabled:opacity-40"
          >
            이전
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!stepValid || submitting}
            className="h-11 px-6 rounded-xl bg-slate-900 text-white text-sm font-bold disabled:bg-slate-200 disabled:text-slate-400 flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {step === STEPS.length - 1 ? '입점 신청하기' : '다음'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AffiliateStoreApplication;
