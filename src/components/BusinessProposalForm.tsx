import React, { useState, useEffect } from 'react';
import type { ProposalCategory } from '../types';
import { apiService } from '../services/apiService';
import { formatNumberWithCommas, stripCommas } from '../utils/formatters';

interface BusinessProposalFormProps {
  username: string;
}

const BusinessProposalForm: React.FC<BusinessProposalFormProps> = ({ username }) => {
  // Resolve auth state synchronously from localStorage so the form can render immediately
  const initialSession = typeof window !== 'undefined'
    ? localStorage.getItem('picks_business_session')
    : null;
  const cachedProfileRaw = typeof window !== 'undefined' && initialSession
    ? localStorage.getItem(`picks_business_profile_${initialSession.toLowerCase()}`)
    : null;
  const cachedProfile = (() => {
    try { return cachedProfileRaw ? JSON.parse(cachedProfileRaw) : null; } catch { return null; }
  })();

  const [isBusinessLoggedIn, setIsBusinessLoggedIn] = useState(!!initialSession);
  const [businessUsername, setBusinessUsername] = useState(initialSession || '');

  const [category, setCategory] = useState<ProposalCategory>('광고');
  const [companyName, setCompanyName] = useState(cachedProfile?.company_name || '');
  const [contactPerson, setContactPerson] = useState(cachedProfile?.contact_person || '');
  const [contactEmail, setContactEmail] = useState(cachedProfile?.contact_email || '');
  const [contactPhone, setContactPhone] = useState(cachedProfile?.contact_phone || '');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fee, setFee] = useState('');
  const [feeDisplay, setFeeDisplay] = useState('');
  const [revenueShare, setRevenueShare] = useState('');

  const handleFeeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = stripCommas(e.target.value);
    setFee(raw);
    setFeeDisplay(raw ? formatNumberWithCommas(raw) : '');
  };
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Refresh profile in the background — never blocks rendering
  useEffect(() => {
    if (!initialSession) return;
    fetch('/.netlify/functions/business-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'profile', username: initialSession }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.profile) {
          if (data.profile.company_name) setCompanyName((prev: string) => prev || data.profile.company_name);
          if (data.profile.contact_person) setContactPerson((prev: string) => prev || data.profile.contact_person);
          if (data.profile.contact_email) setContactEmail((prev: string) => prev || data.profile.contact_email);
          if (data.profile.contact_phone) setContactPhone((prev: string) => prev || data.profile.contact_phone);
          try {
            localStorage.setItem(
              `picks_business_profile_${initialSession.toLowerCase()}`,
              JSON.stringify({
                company_name: data.profile.company_name || '',
                contact_person: data.profile.contact_person || '',
                contact_email: data.profile.contact_email || '',
                contact_phone: data.profile.contact_phone || '',
              })
            );
          } catch {}
          setIsBusinessLoggedIn(true);
          setBusinessUsername(initialSession);
        }
      })
      .catch(() => {});
  }, [initialSession]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingFiles(true);
    const newUrls: string[] = [];

    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        alert(`${file.name} 파일이 너무 큽니다. 최대 20MB까지 업로드 가능합니다.`);
        continue;
      }
      const url = await apiService.uploadProposalAttachment(username, file);
      if (url) {
        newUrls.push(url);
      } else {
        alert(`${file.name} 업로드에 실패했습니다.`);
      }
    }

    if (newUrls.length > 0) {
      setAttachments(prev => [...prev, ...newUrls]);
    }
    setUploadingFiles(false);
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    const proposal = {
      category,
      company_name: companyName,
      contact_person: contactPerson,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      title,
      content,
      start_date: startDate,
      end_date: endDate,
      fee: parseInt(fee) || 0,
      revenue_share: revenueShare ? parseFloat(revenueShare) : undefined,
      reference_links: [],
      attachments,
      business_username: businessUsername,
    };

    const success = await apiService.submitProposal(username, proposal);
    setIsSubmitting(false);
    if (success) {
      setSubmitted(true);
    } else {
      alert('제안 전송에 실패했습니다. 다시 시도해주세요.');
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-6 md:p-12 max-w-lg w-full text-center shadow-xl border border-slate-100">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-black text-slate-900 mb-3">제안이 전송되었습니다!</h2>
          <p className="text-slate-500 font-medium text-sm leading-relaxed">
            <span className="font-black text-blue-600">@{username}</span>님에게 비즈니스 제안이 성공적으로 전달되었습니다.
            <br />인플루언서가 확인 후 수락/거절 여부를 결정합니다.
          </p>
        </div>
      </div>
    );
  }

  // Require business login to submit proposals
  if (!isBusinessLoggedIn) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl p-6 md:p-12 max-w-lg w-full text-center shadow-xl border border-slate-100">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-2xl font-black text-slate-900 mb-3">비즈니스 로그인이 필요합니다</h2>
          <p className="text-slate-500 font-medium text-sm leading-relaxed mb-8">
            <span className="font-black text-blue-600">@{username}</span>님에게 비즈니스 제안을 보내려면
            <br />비즈니스 계정으로 로그인해 주세요.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => {
                sessionStorage.setItem('picks_business_redirect', `/${username}/proposal`);
                window.history.pushState(null, '', '/business-login');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-blue-600/30 hover:shadow-blue-600/50 transition-all active:scale-[0.99]"
            >
              비즈니스 로그인
            </button>
            <p className="text-slate-400 text-sm font-bold">
              비즈니스 계정이 없으신가요?{' '}
              <button
                onClick={() => {
                  sessionStorage.setItem('picks_business_redirect', `/${username}/proposal`);
                  window.history.pushState(null, '', '/business-signup');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }}
                className="text-slate-800 hover:underline font-black"
              >
                회원가입하기
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white">
        <div className="max-w-3xl mx-auto px-4 py-8 md:py-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl">📨</div>
            <h1 className="text-2xl md:text-3xl font-black">비즈니스 제안</h1>
          </div>
          <p className="text-white/80 font-medium text-sm">
            <span className="font-black text-white">@{username}</span>님에게 협업을 제안합니다.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Category Selection */}
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">카테고리 선택</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCategory('광고')}
              className={`p-4 rounded-xl border-2 font-black text-sm transition-all ${
                category === '광고'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-400 hover:border-slate-300'
              }`}
            >
              <span className="text-2xl block mb-2">📢</span>
              광고 / 협찬
            </button>
            <button
              type="button"
              onClick={() => setCategory('커머스')}
              className={`p-4 rounded-xl border-2 font-black text-sm transition-all ${
                category === '커머스'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-400 hover:border-slate-300'
              }`}
            >
              <span className="text-2xl block mb-2">🛒</span>
              커머스 / 공구
            </button>
          </div>
        </div>

        {/* Company Info */}
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">회사 / 담당자 정보</label>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">회사명 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              required
              placeholder="회사명을 입력하세요"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">담당자명 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={contactPerson}
                onChange={e => setContactPerson(e.target.value)}
                required
                placeholder="홍길동"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">이메일 <span className="text-red-500">*</span></label>
              <input
                type="email"
                value={contactEmail}
                onChange={e => setContactEmail(e.target.value)}
                required
                placeholder="email@company.com"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">연락처</label>
              <input
                type="tel"
                value={contactPhone}
                onChange={e => setContactPhone(e.target.value)}
                placeholder="010-0000-0000"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Proposal Details */}
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">제안 내용</label>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">제안 제목 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              placeholder={category === '광고' ? '예: 신제품 런칭 인스타그램 협찬 제안' : '예: 봄 시즌 공구 진행 제안'}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">상세 내용 <span className="text-red-500">*</span></label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              required
              rows={6}
              placeholder={
                category === '광고'
                  ? '제안 배경, 콘텐츠 형식(피드/릴스/스토리), 필수 포함 사항, 가이드라인 등을 상세히 작성해주세요.'
                  : '공구 상품 소개, 진행 방식, 수수료 구조, 예상 판매량 등을 상세히 작성해주세요.'
              }
              className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
            />
          </div>

          {/* File Attachments */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">첨부 파일</label>
            <p className="text-xs text-slate-400 font-medium mb-3">제안과 관련된 파일을 첨부할 수 있습니다. (최대 20MB)</p>

            <label className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${uploadingFiles ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/50'}`}>
              <input
                type="file"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                multiple
                onChange={handleFileUpload}
                disabled={uploadingFiles}
                className="hidden"
              />
              {uploadingFiles ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-bold text-blue-600">업로드 중...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm font-bold text-slate-500">클릭하여 파일 업로드</p>
                  <p className="text-[10px] text-slate-400">이미지, PDF, Word, Excel, PPT, TXT, ZIP (최대 20MB)</p>
                </div>
              )}
            </label>

            {attachments.length > 0 && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {attachments.map((url, idx) => {
                  const ext = url.split('.').pop()?.toLowerCase() || '';
                  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);
                  const fileLabel: Record<string, string> = {
                    pdf: 'PDF', doc: 'DOC', docx: 'DOCX', xls: 'XLS', xlsx: 'XLSX',
                    ppt: 'PPT', pptx: 'PPTX', txt: 'TXT', zip: 'ZIP',
                  };
                  return (
                    <div key={idx} className="relative group">
                      {isImage ? (
                        <img
                          src={url}
                          alt={`첨부 ${idx + 1}`}
                          className="w-full h-24 object-cover rounded-xl border border-slate-200"
                        />
                      ) : (
                        <div className="w-full h-24 rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-1">
                          <span className="text-lg">
                            {ext === 'pdf' ? '📄' : ['doc', 'docx'].includes(ext) ? '📝' : ['xls', 'xlsx'].includes(ext) ? '📊' : ['ppt', 'pptx'].includes(ext) ? '📑' : ext === 'zip' ? '📦' : '📎'}
                          </span>
                          <span className="text-[10px] font-black text-slate-500">{fileLabel[ext] || ext.toUpperCase()}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeAttachment(idx)}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs font-black shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Schedule & Budget */}
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">일정 및 예산</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">시작 희망일 <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">마감일 <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                {category === '광고' ? '제시 원고료 (원)' : '고정 수수료 (원)'}
                <span className="text-red-500"> *</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={feeDisplay}
                onChange={handleFeeChange}
                required
                placeholder="0"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
            {category === '커머스' && (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">수익 배분율 (%)</label>
                <input
                  type="number"
                  value={revenueShare}
                  onChange={e => setRevenueShare(e.target.value)}
                  min="0"
                  max="100"
                  placeholder="예: 15"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
            )}
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-blue-600/30 hover:shadow-blue-600/50 transition-all disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]"
        >
          {isSubmitting ? '전송 중...' : '제안서 보내기'}
        </button>
      </form>
    </div>
  );
};

export default BusinessProposalForm;
