import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { affiliateStoreService, isHttpsUrl, withHttps, type StoreApplication } from '../../services/affiliateStoreService';

/**
 * 판매자 정보 · 고객 문의 링크. 상품 페이지의 "판매자 정보 보기"와 구매자 주문 상세에 그대로 보인다
 * (상호 · 사업자등록번호는 입점 신청 값, 나머지는 여기서 언제든 고친다).
 * 고객 문의 링크는 구매자가 "문의하기"를 누르면 새 창으로 열린다 — https:// 주소만 받는다(서버도 같은 규칙).
 */
const inputCls = 'w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-blue-600';

const BrandSellerInfo: React.FC<{ businessUsername: string; application: StoreApplication; onSaved: (a: StoreApplication) => void }> = ({ businessUsername, application, onSaved }) => {
  const [ceoName, setCeoName] = useState(application.ceoName || '');
  const [businessAddress, setBusinessAddress] = useState(application.businessAddress || '');
  const [csPhone, setCsPhone] = useState(application.csPhone || application.contactPhone || '');
  const [mailOrderNumber, setMailOrderNumber] = useState(application.mailOrderNumber || '');
  const [inquiryUrl, setInquiryUrl] = useState(application.inquiryUrl || '');
  const urlOk = isHttpsUrl(withHttps(inquiryUrl));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async () => {
    setMsg('');
    if (!urlOk) { setMsg('고객 문의 링크 주소 형식을 확인해 주세요.'); return; }
    setSaving(true);
    const res = await affiliateStoreService.updateSeller(businessUsername, { ceoName, businessAddress, csPhone, mailOrderNumber, inquiryUrl: withHttps(inquiryUrl) });
    setSaving(false);
    if (res.error || !res.application) { setMsg(res.error || '저장하지 못했습니다.'); return; }
    onSaved(res.application);
    setMsg('저장했어요.');
  };

  const bizNo = application.businessNumber.length === 10
    ? `${application.businessNumber.slice(0, 3)}-${application.businessNumber.slice(3, 5)}-${application.businessNumber.slice(5)}`
    : application.businessNumber;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-7 max-w-2xl space-y-4">
      <div>
        <h3 className="text-base font-black text-slate-900">판매자 정보</h3>
        <p className="text-xs text-slate-500 mt-0.5">전자상거래법에 따라 상품 페이지에 표시됩니다. 비어 있으면 구매자에게 "-"로 보여요.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-3 text-sm">
        <div><p className="text-[11px] font-bold text-slate-400 mb-1">상호</p><p className="font-bold text-slate-800">{application.businessName}</p></div>
        <div><p className="text-[11px] font-bold text-slate-400 mb-1">사업자등록번호</p><p className="font-bold text-slate-800">{bizNo}</p></div>
      </div>
      <label className="block">
        <span className="text-xs font-bold text-slate-700">고객 문의 링크(자사몰 주소) *</span>
        <input className={`${inputCls} mt-1 ${inquiryUrl && !urlOk ? 'border-red-300' : ''}`} value={inquiryUrl} onChange={e => setInquiryUrl(e.target.value.trim())} maxLength={500} inputMode="url" placeholder="pf.kakao.com/... 또는 www.example.com" />
        <span className="block text-[11px] text-slate-500 mt-1">구매자가 문의하기를 누르면 이 주소로 이동해요. 자사몰 고객센터나 카카오톡 채널 주소를 넣어도 돼요.</span>
        {inquiryUrl && !urlOk && <span className="block text-[11px] font-bold text-red-500 mt-0.5">주소 형식을 확인해 주세요. (예: pf.kakao.com/_abc)</span>}
      </label>
      <label className="block"><span className="text-xs font-bold text-slate-700">대표자 *</span><input className={`${inputCls} mt-1`} value={ceoName} onChange={e => setCeoName(e.target.value)} maxLength={50} /></label>
      <label className="block"><span className="text-xs font-bold text-slate-700">고객센터 연락처 *</span><input className={`${inputCls} mt-1`} value={csPhone} onChange={e => setCsPhone(e.target.value)} maxLength={20} inputMode="tel" /></label>
      <label className="block"><span className="text-xs font-bold text-slate-700">사업장 주소 *</span><input className={`${inputCls} mt-1`} value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} maxLength={300} /></label>
      <label className="block"><span className="text-xs font-bold text-slate-700">통신판매업 신고번호 *</span><input className={`${inputCls} mt-1`} value={mailOrderNumber} onChange={e => setMailOrderNumber(e.target.value)} maxLength={60} placeholder="예: 제 2026-서울강남-0000 호" /></label>
      {msg && <p className="text-xs font-bold text-blue-600">{msg}</p>}
      <button onClick={save} disabled={saving} className="h-11 px-6 rounded-xl bg-blue-600 text-white text-sm font-black disabled:opacity-50 flex items-center gap-2">
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}저장
      </button>
    </div>
  );
};

export default BrandSellerInfo;
