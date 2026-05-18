import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

interface BusinessSignupPageProps {
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
  onNavigateInfluencerSignup: () => void;
  onSignupSuccess: () => void;
}

const formatPhone = (value: string) => {
  const numbers = value.replace(/\D/g, '');
  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
};

const BusinessSignupPage: React.FC<BusinessSignupPageProps> = ({ onNavigateHome, onNavigateLogin, onNavigateInfluencerSignup, onSignupSuccess }) => {
  const [companyName, setCompanyName] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationInput, setShowVerificationInput] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSendSMS = async () => {
    if (!phone) { alert('휴대폰 번호를 입력해 주세요.'); return; }
    setIsSending(true);
    try {
      const response = await fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver: phone }),
      });
      const data = await response.json();
      if (response.ok) {
        setGeneratedCode(data.code);
        alert('인증번호가 발송되었습니다.');
        setShowVerificationInput(true);
      } else {
        alert(data.message || '인증번호 발송에 실패했습니다.');
      }
    } catch { alert('서버 오류가 발생했습니다.'); }
    finally { setIsSending(false); }
  };

  const handleVerifySMS = () => {
    if (verificationCode === generatedCode && generatedCode !== '') {
      alert('인증되었습니다.');
      setIsVerified(true);
    } else {
      alert('인증번호가 일치하지 않습니다.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) { alert('비밀번호가 일치하지 않습니다.'); return; }
    if (!isVerified) { alert('휴대폰 인증을 완료해 주세요.'); return; }
    if (!companyName || !businessNumber || !contactPerson || !contactEmail) {
      alert('모든 필수 항목을 입력해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/.netlify/functions/business-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'signup',
          company_name: companyName.trim(),
          business_number: businessNumber.trim(),
          contact_person: contactPerson.trim(),
          contact_email: contactEmail.trim(),
          contact_phone: phone.replace(/\D/g, ''),
          username: username.trim().toLowerCase(),
          password,
        }),
      });
      const data = await response.json();
      if (!response.ok) { alert(data.error || '회원가입 실패'); return; }
      if (data.success) {
        alert('비즈니스 회원가입이 완료되었습니다. 로그인해주세요.');
        onSignupSuccess();
      }
    } catch (err: any) {
      alert('서버 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass = "w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all";

  return (
    <div className="min-h-[100dvh] bg-midnight flex items-start justify-center p-4 sm:p-6 py-10 sm:py-16 overflow-y-auto">
      <div className="bg-slate-900/40 backdrop-blur-3xl border border-white/10 p-6 sm:p-8 md:p-12 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-[520px] relative shadow-2xl">
        <button onClick={onNavigateHome} className="absolute left-5 top-7 sm:left-8 sm:top-10 text-slate-500 hover:text-white transition-colors p-2 -m-2">
          <ArrowLeft size={24} strokeWidth={3} />
        </button>

        <div className="text-center mb-8 sm:mb-10 mt-6 sm:mt-0">
          <h2 className="text-2xl sm:text-[30px] font-black text-white mb-3 tracking-tight">비즈니스 회원가입</h2>
          <p className="text-slate-400 font-bold text-sm sm:text-base">브랜드/기업 회원으로 가입하세요.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2 ml-1">회사명 *</label>
            <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputClass} placeholder="회사명을 입력해 주세요" required />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2 ml-1">사업자등록번호 *</label>
            <input type="text" value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value)} className={inputClass} placeholder="000-00-00000" required />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2 ml-1">담당자명 *</label>
            <input type="text" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className={inputClass} placeholder="담당자명" required />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2 ml-1">담당자 이메일 *</label>
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputClass} placeholder="email@company.com" required />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2 ml-1">아이디 *</label>
            <input type="text" value={username} onChange={(e) => { if (/^[a-zA-Z0-9]*$/.test(e.target.value)) setUsername(e.target.value); }} className={inputClass} placeholder="영문, 숫자만 가능" required />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2 ml-1">비밀번호 *</label>
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="비밀번호를 입력해 주세요" required />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2 ml-1">비밀번호 확인 *</label>
            <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} placeholder="비밀번호를 다시 입력해 주세요" required />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2 ml-1">휴대폰 번호 *</label>
            <div className="flex gap-2">
              <input type="tel" value={formatPhone(phone)} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} className={`flex-1 ${inputClass}`} placeholder="01012345678" required />
              <button type="button" onClick={handleSendSMS} disabled={isSending || isVerified}
                className="bg-white/10 text-white px-4 rounded-2xl font-black text-[12px] hover:bg-white/20 transition-colors whitespace-nowrap border border-white/10 disabled:opacity-50 flex-shrink-0">
                {isSending ? '발송 중...' : isVerified ? '인증 완료' : '인증번호 전송'}
              </button>
            </div>
          </div>

          {showVerificationInput && !isVerified && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label className="block text-[14px] font-black text-slate-300 mb-2 ml-1">인증번호</label>
              <div className="flex gap-2">
                <input type="text" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} className={`flex-1 ${inputClass}`} placeholder="6자리 숫자 입력" maxLength={6} />
                <button type="button" onClick={handleVerifySMS}
                  className="bg-purple-600/20 text-purple-400 px-5 rounded-2xl font-black text-[13px] hover:bg-purple-600/30 transition-colors whitespace-nowrap border border-purple-500/30 flex-shrink-0">
                  확인
                </button>
              </div>
            </div>
          )}

          <button type="submit" disabled={isLoading}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-purple-500/20 transition-all active:scale-[0.98] mt-4 disabled:opacity-50 flex items-center justify-center gap-2">
            {isLoading ? (
              <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>가입 중...</>
            ) : '비즈니스 회원가입'}
          </button>
        </form>

        <div className="mt-8 text-center space-y-3">
          <p className="text-slate-500 font-bold text-sm">
            이미 계정이 있으신가요?{' '}
            <button onClick={onNavigateLogin} className="text-white hover:text-purple-400 hover:underline font-black ml-1 transition-colors">
              비즈니스 회원 로그인하기
            </button>
          </p>
          <p className="text-slate-600 font-bold text-xs">
            인플루언서이신가요?{' '}
            <button onClick={onNavigateInfluencerSignup} className="text-slate-400 hover:text-purple-400 hover:underline font-black transition-colors">
              일반 회원가입
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default BusinessSignupPage;
