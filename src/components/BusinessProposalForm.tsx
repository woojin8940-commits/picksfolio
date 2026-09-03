import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ProposalCategory } from '../types';
import { apiService } from '../services/apiService';
import { formatNumberWithCommas, stripCommas } from '../utils/formatters';
import { useLanguage } from '../contexts/LanguageContext';

interface BusinessProposalFormProps {
  username: string;
  onBack: () => void;
}

const BusinessProposalForm: React.FC<BusinessProposalFormProps> = ({ username, onBack }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

  const initialSession = typeof window !== 'undefined'
    ? localStorage.getItem('picks_business_session')
    : null;
  const cachedProfileRaw = typeof window !== 'undefined' && initialSession
    ? localStorage.getItem(`picks_business_profile_${initialSession.toLowerCase()}`)
    : null;
  const cachedProfile = (() => {
    try { return cachedProfileRaw ? JSON.parse(cachedProfileRaw) : null; } catch { return null; }
  })();

  const draftKey = `picks_proposal_draft_${username.toLowerCase()}`;
  const savedDraft = (() => {
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem(draftKey) : null;
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();

  const [isBusinessLoggedIn, setIsBusinessLoggedIn] = useState(!!initialSession);
  const [businessUsername, setBusinessUsername] = useState(initialSession || '');

  const [category, setCategory] = useState<ProposalCategory>(savedDraft?.category || '광고');
  const [companyName, setCompanyName] = useState(savedDraft?.company_name ?? cachedProfile?.company_name ?? '');
  const [contactPerson, setContactPerson] = useState(savedDraft?.contact_person ?? cachedProfile?.contact_person ?? '');
  const [contactEmail, setContactEmail] = useState(savedDraft?.contact_email ?? cachedProfile?.contact_email ?? '');
  const [contactPhone, setContactPhone] = useState(savedDraft?.contact_phone ?? cachedProfile?.contact_phone ?? '');
  const [title, setTitle] = useState(savedDraft?.title || '');
  const [content, setContent] = useState(savedDraft?.content || '');
  const [startDate, setStartDate] = useState(savedDraft?.start_date || '');
  const [fee, setFee] = useState(savedDraft?.fee || '');
  const [feeDisplay, setFeeDisplay] = useState(savedDraft?.fee ? formatNumberWithCommas(savedDraft.fee) : '');
  const [revenueShare, setRevenueShare] = useState(savedDraft?.revenue_share || '');

  const handleFeeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = stripCommas(e.target.value);
    setFee(raw);
    setFeeDisplay(raw ? formatNumberWithCommas(raw) : '');
  };
  const [attachments, setAttachments] = useState<string[]>(savedDraft?.attachments || []);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({
        category,
        company_name: companyName,
        contact_person: contactPerson,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        title,
        content,
        start_date: startDate,
        fee,
        revenue_share: revenueShare,
        attachments,
      }));
    } catch {}
  }, [draftKey, category, companyName, contactPerson, contactEmail, contactPhone, title, content, startDate, fee, revenueShare, attachments]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingFiles(true);
    try {
      const uploadedUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 20 * 1024 * 1024) {
          alert(isEn ? `File ${file.name} exceeds maximum limit of 20MB.` : `파일 ${file.name}이(가) 20MB를 초과합니다.`);
          continue;
        }

        const formData = new FormData();
        formData.append('image', file);

        const res = await fetch('/.netlify/functions/api-upload-image', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (data.success && data.imageUrl) {
          uploadedUrls.push(data.imageUrl);
        } else {
          alert(isEn ? `Failed to upload file ${file.name}.` : `파일 ${file.name} 업로드에 실패했습니다.`);
        }
      }

      setAttachments(prev => [...prev, ...uploadedUrls]);
    } catch {
      alert(isEn ? 'An error occurred while uploading file.' : '파일 업로드 중 오류가 발생했습니다.');
    } finally {
      setUploadingFiles(false);
      e.target.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!companyName.trim() || !contactPerson.trim() || !contactEmail.trim() || !title.trim() || !content.trim()) {
      alert(isEn ? 'Please fill in all required fields.' : '필수 항목을 모두 입력해주세요.');
      return;
    }

    if (!startDate) {
      alert(isEn ? 'Please select start date.' : '시작 희망일을 선택해주세요.');
      return;
    }

    if (!fee) {
      alert(isEn ? 'Please enter proposed fee.' : '제시 금액을 입력해주세요.');
      return;
    }

    if (!isBusinessLoggedIn) {
      alert(isEn ? 'Business login is required to send proposal. You will be directed to login.' : '제안서를 전송하려면 비즈니스 로그인이 필요합니다. 작성하신 내용은 저장되며 로그인 페이지로 이동합니다.');
      window.location.href = `/business-login?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    setIsSubmitting(true);

    try {
      const success = await apiService.submitProposal(username, {
        business_username: businessUsername,
        category,
        company_name: companyName.trim(),
        contact_person: contactPerson.trim(),
        contact_email: contactEmail.trim(),
        contact_phone: contactPhone.trim(),
        title: title.trim(),
        content: content.trim(),
        start_date: startDate,
        end_date: startDate,
        fee: parseInt(fee, 10) || 0,
        revenue_share: revenueShare ? parseFloat(revenueShare) : undefined,
        reference_links: [],
        attachments,
      });

      if (success) {
        setSubmitted(true);
        try { sessionStorage.removeItem(draftKey); } catch {}
      } else {
        alert(isEn ? 'Failed to send proposal.' : '제안서 전송에 실패했습니다.');
      }
    } catch {
      alert(isEn ? 'An error occurred while sending proposal.' : '제안서 전송 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="relative min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
        <button
          type="button"
          onClick={onBack}
          className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black text-slate-600 transition-colors hover:bg-white hover:text-slate-900 md:left-8 md:top-8"
          aria-label={isEn ? 'Back to profile' : '프로필로 돌아가기'}
        >
          <ArrowLeft size={20} strokeWidth={2.5} />
          <span>{isEn ? 'Back to profile' : '프로필로 돌아가기'}</span>
        </button>
        <div className="bg-white rounded-3xl p-8 md:p-12 max-w-lg w-full text-center border border-slate-100 shadow-xl animate-in fade-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-4xl mx-auto mb-6 shadow-lg shadow-green-100">
              ✓
            </div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-900 mb-3">{isEn ? 'Proposal Sent' : '제안서 전송 완료'}</h2>
          <p className="text-slate-500 font-medium text-sm leading-relaxed mb-8">
            <span className="font-black text-slate-900">@{username}</span>{isEn ? ' has received your proposal. You will be notified when they review it.' : '님에게 제안서가 성공적으로 전달되었습니다.\n인플루언서가 제안을 검토한 후 답변을 보내드립니다.'}
          </p>
            <div className="space-y-3">
            <button
              onClick={() => window.location.href = '/business-dashboard'}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-2xl font-black text-sm shadow-lg shadow-blue-500/30 transition-all"
            >
              {isEn ? 'Go to Business Dashboard' : '비즈니스 대시보드로 이동'}
            </button>
            <button
              onClick={() => {
                setSubmitted(false);
                setTitle('');
                setContent('');
                setStartDate('');
                setFee('');
                setFeeDisplay('');
                setRevenueShare('');
                setAttachments([]);
              }}
              className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 py-4 rounded-2xl font-black text-sm transition-all"
            >
              {isEn ? 'Send Another Proposal' : '다른 제안서 작성하기'}
              </button>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <div className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white">
        <div className="max-w-3xl mx-auto px-4 py-8 md:py-12">
          <button
            type="button"
            onClick={onBack}
            className="mb-5 inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-black text-white transition-colors hover:bg-white/20"
            aria-label={isEn ? 'Back to profile' : '프로필로 돌아가기'}
          >
            <ArrowLeft size={20} strokeWidth={2.5} />
            <span>{isEn ? 'Back to profile' : '프로필로 돌아가기'}</span>
          </button>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-xl">📨</div>
            <h1 className="text-2xl md:text-3xl font-black">{isEn ? 'Business Proposal' : '비즈니스 제안'}</h1>
          </div>
          <p className="text-white/80 font-medium text-sm">
            {isEn ? <>Send a collaboration proposal to <span className="font-black text-white">@{username}</span>.</> : <><span className="font-black text-white">@{username}</span>님에게 협업을 제안합니다.</>}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{isEn ? 'Select Category' : '카테고리 선택'}</label>
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
              {isEn ? 'Ad / Sponsor' : '광고 / 협찬'}
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
              {isEn ? 'Commerce / Group Buy' : '커머스 / 공구'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{isEn ? 'Company & Contact Info' : '회사 / 담당자 정보'}</label>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Company Name' : '회사명'} <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              required
              placeholder={isEn ? 'Enter company name' : '회사명을 입력하세요'}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Contact Person' : '담당자명'} <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={contactPerson}
                onChange={e => setContactPerson(e.target.value)}
                required
                placeholder={isEn ? 'Name' : '홍길동'}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Email' : '이메일'} <span className="text-red-500">*</span></label>
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
              <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Phone' : '연락처'}</label>
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

        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{isEn ? 'Proposal Details' : '제안 내용'}</label>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Title' : '제안 제목'} <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              placeholder={
                category === '광고'
                  ? (isEn ? 'e.g. New Product Launch Instagram Sponsor Proposal' : '예: 신제품 런칭 인스타그램 협찬 제안')
                  : (isEn ? 'e.g. Spring Season Group Buy Proposal' : '예: 봄 시즌 공구 진행 제안')
              }
              className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Content' : '상세 내용'} <span className="text-red-500">*</span></label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              required
              rows={6}
              placeholder={
                category === '광고'
                  ? (isEn ? 'Please describe proposal background, content format (feed/reels/story), key guidelines, etc.' : '제안 배경, 콘텐츠 형식(피드/릴스/스토리), 필수 포함 사항, 가이드라인 등을 상세히 작성해주세요.')
                  : (isEn ? 'Please describe product info, sales format, revenue share, target volume, etc.' : '공구 상품 소개, 진행 방식, 수수료 구조, 예상 판매량 등을 상세히 작성해주세요.')
              }
              className="w-full px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Attachments' : '첨부 파일'}</label>
            <p className="text-xs text-slate-400 font-medium mb-3">{isEn ? 'Attach files related to the proposal (max 20MB).' : '제안과 관련된 파일을 첨부할 수 있습니다. (최대 20MB)'}</p>

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
                  <p className="text-sm font-bold text-blue-600">{isEn ? 'Uploading...' : '업로드 중...'}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm font-bold text-slate-500">{isEn ? 'Click to upload files' : '클릭하여 파일 업로드'}</p>
                  <p className="text-[10px] text-slate-400">Image, PDF, Word, Excel, PPT, TXT, ZIP ({isEn ? 'Max 20MB' : '최대 20MB'})</p>
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
                          alt={`Attachment ${idx + 1}`}
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

        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{isEn ? 'Schedule & Budget' : '일정 및 예산'}</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="min-w-0">
              <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Target Start Date' : '시작 희망일'} <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                required
                className="w-full min-w-0 box-border appearance-none px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-bold text-slate-600 mb-1.5">
                {category === '광고' ? (isEn ? 'Proposed Fee (KRW)' : '제시 원고료 (원)') : (isEn ? 'Fixed Fee (KRW)' : '고정 수수료 (원)')}
                <span className="text-red-500"> *</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={feeDisplay}
                onChange={handleFeeChange}
                required
                placeholder="0"
                className="w-full min-w-0 box-border px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
          </div>
          {category === '커머스' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="min-w-0">
                <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Revenue Share (%)' : '수익 배분율 (%)'}</label>
                <input
                  type="number"
                  value={revenueShare}
                  onChange={e => setRevenueShare(e.target.value)}
                  min="0"
                  max="100"
                  placeholder={isEn ? 'e.g. 15' : '예: 15'}
                  className="w-full min-w-0 box-border px-4 py-3 rounded-xl border border-slate-200 font-medium text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all"
                />
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-blue-600/30 hover:shadow-blue-600/50 transition-all disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99] cursor-pointer"
        >
          {isSubmitting ? (isEn ? 'Sending...' : '전송 중...') : (isEn ? 'Send Proposal' : '제안서 보내기')}
        </button>
        {!isBusinessLoggedIn && (
          <p className="text-center text-xs text-slate-400 font-bold -mt-2">
            {isEn ? 'Business login required upon sending. Your input will be saved.' : '전송 시 비즈니스 로그인이 필요합니다. 작성하신 내용은 그대로 유지됩니다.'}
          </p>
        )}
      </form>
    </div>
  );
};

export default BusinessProposalForm;
