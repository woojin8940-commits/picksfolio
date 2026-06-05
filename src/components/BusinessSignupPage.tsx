import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

interface BusinessSignupPageProps {
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
  onSignupSuccess: () => void;
}

const BusinessSignupPage: React.FC<BusinessSignupPageProps> = ({ onNavigateHome, onNavigateLogin, onSignupSuccess }) => {
  const [companyName, setCompanyName] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [isBizVerifying, setIsBizVerifying] = useState(false);
  const [isBizVerified, setIsBizVerified] = useState(false);
  const [bizVerifyMsg, setBizVerifyMsg] = useState('');
  const [bizVerifyError, setBizVerifyError] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationInput, setShowVerificationInput] = useState(false);

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const regex = /^[a-zA-Z0-9_-]*$/;
    if (regex.test(value)) {
      setUsername(value);
    } else {
      alert('아이디는 영문, 숫자, -, _ 만 입력 가능합니다.');
    }
  };

  const handleSendSMS = async () => {
    if (!contactPhone) {
      alert('휴대폰 번호를 입력해 주세요.');
      return;
    }
    const isResend = showVerificationInput;
    setIsSending(true);
    try {
      const response = await fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver: contactPhone, purpose: 'business_signup' }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setVerificationCode('');
        setShowVerificationInput(true);
        alert(isResend ? '인증번호를 재전송했습니다.' : '인증번호가 발송되었습니다.');
      } else {
        alert(data.error || data.message || '인증번호 발송에 실패했습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifySMS = async () => {
    if (!verificationCode) {
      alert('인증번호를 입력해 주세요.');
      return;
    }
    setIsVerifying(true);
    try {
      const response = await fetch('/.netlify/functions/verify-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: contactPhone, code: verificationCode, purpose: 'business_signup' }),
      });
      const data = await response.json();
      if (data.success) {
        alert('인증되었습니다.');
        setIsVerified(true);
      } else {
        alert(data.error || '인증번호가 일치하지 않습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBusinessNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBusinessNumber(e.target.value);
    // 번호가 바뀌면 직전 인증 상태를 초기화한다.
    if (isBizVerified || bizVerifyMsg || bizVerifyError) {
      setIsBizVerified(false);
      setBizVerifyMsg('');
      setBizVerifyError('');
    }
  };

  const handleVerifyBusiness = async () => {
    const digits = businessNumber.replace(/\D/g, '');
    if (digits.length !== 10) {
      setBizVerifyError('사업자등록번호 10자리를 정확히 입력해 주세요.');
      return;
    }
    setIsBizVerifying(true);
    setBizVerifyError('');
    setBizVerifyMsg('');
    try {
      const response = await fetch('/.netlify/functions/business-verify-nts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_number: digits }),
      });
      const result = await response.json();
      if (result.verified) {
        setIsBizVerified(true);
        setBizVerifyMsg(`국세청 확인 완료 · ${result.status || '계속사업자'}`);
      } else {
        setIsBizVerified(false);
        setBizVerifyError(result.error || '사업자 조회에 실패했습니다.');
      }
    } catch {
      setBizVerifyError('서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsBizVerifying(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      alert('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (!isVerified) {
      alert('휴대폰 인증을 완료해 주세요.');
      return;
    }
    if (!companyName || !businessNumber || !contactPerson || !contactEmail) {
      alert('모든 필수 항목을 입력해 주세요.');
      return;
    }
    if (!isBizVerified) {
      alert('사업자등록번호 조회(국세청 확인)를 완료해 주세요.');
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
          business_verified: true,
          contact_person: contactPerson.trim(),
          contact_email: contactEmail.trim(),
          contact_phone: contactPhone.replace(/\D/g, ''),
          username: username.trim().toLowerCase(),
          password,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        alert(result.error || '회원가입 실패');
        return;
      }

      if (result.success) {
        alert('비즈니스 회원가입이 완료되었습니다. 로그인해주세요.');
        onSignupSuccess();
      } else {
        alert(result.error || '회원가입에 실패했습니다.');
      }
    } catch (error: any) {
      alert('서버 오류가 발생했습니다: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass = "w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all";
  const labelClass = "block text-[14px] font-black text-slate-300 mb-2.5 ml-1";

  return (
    <div className="min-h-[100dvh] bg-midnight flex items-start justify-center p-4 sm:p-6 py-10 sm:py-16 overflow-y-auto">
      <div className="bg-slate-900/40 backdrop-blur-3xl border border-white/10 p-6 sm:p-8 md:p-12 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-[520px] relative shadow-2xl">
        <button
          onClick={onNavigateHome}
          className="absolute left-5 top-7 sm:left-8 sm:top-10 text-slate-500 hover:text-white transition-colors p-2 -m-2"
        >
          <ArrowLeft size={24} strokeWidth={3} />
        </button>

        <div className="text-center mb-8 sm:mb-10 mt-6 sm:mt-0">
          <div className="inline-flex items-center gap-2 bg-blue-600/20 text-blue-400 px-4 py-1.5 rounded-full text-xs font-black mb-4 border border-blue-500/20">
            BUSINESS
          </div>
          <h2 className="text-2xl sm:text-[28px] font-black text-white mb-3 tracking-tight">비즈니스 회원가입</h2>
          <p className="text-slate-400 font-bold text-sm">기업 회원으로 가입하고 인플루언서와 협업하세요.</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-5">
          <div>
            <label className={labelClass}>회사명 *</label>
            <input
              type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              className={inputClass} placeholder="회사명을 입력해 주세요" required
            />
          </div>

          <div>
            <label className={labelClass}>사업자등록번호 *</label>
            <div className="flex gap-2">
              <input
                type="text" value={businessNumber} onChange={handleBusinessNumberChange}
                className={`flex-1 ${inputClass}`} placeholder="000-00-00000" required
                disabled={isBizVerified}
              />
              <button
                type="button" onClick={handleVerifyBusiness} disabled={isBizVerifying || isBizVerified}
                className="bg-white/10 text-white px-4 rounded-2xl font-black text-[12px] hover:bg-white/20 transition-colors whitespace-nowrap border border-white/10 disabled:opacity-50 flex-shrink-0"
              >
                {isBizVerifying ? '조회 중...' : isBizVerified ? '확인 완료' : '사업자 조회'}
              </button>
            </div>
            {bizVerifyMsg && (
              <p className="text-[12px] text-emerald-400 font-bold mt-2 ml-1">✓ {bizVerifyMsg}</p>
            )}
            {bizVerifyError && (
              <p className="text-[12px] text-red-400 font-bold mt-2 ml-1">{bizVerifyError}</p>
            )}
          </div>

          <div>
            <label className={labelClass}>담당자명 *</label>
            <input
              type="text" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)}
              className={inputClass} placeholder="담당자 이름" required
            />
          </div>

          <div>
            <label className={labelClass}>이메일 *</label>
            <input
              type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
              className={inputClass} placeholder="company@example.com" required
            />
          </div>

          <div>
            <label className={labelClass}>아이디 (비즈니스 로그인용) *</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-base">biz/</span>
              <input
                type="text" value={username} onChange={handleUsernameChange}
                className={`${inputClass} pl-[3.5rem]`} placeholder="" required
              />
            </div>
            <p className="text-[11px] text-slate-500 font-bold mt-2 ml-1">※ 아이디는 나중에 변경할 수 없습니다.</p>
          </div>

          <div>
            <label className={labelClass}>비밀번호 *</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={inputClass} placeholder="비밀번호를 입력해 주세요" required
            />
          </div>

          <div>
            <label className={labelClass}>비밀번호 확인 *</label>
            <input
              type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className={inputClass} placeholder="비밀번호를 다시 입력해 주세요" required
            />
          </div>

          <div>
            <label className={labelClass}>담당자 연락처 *</label>
            <div className="flex gap-2">
              <input
                type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                className={`flex-1 ${inputClass}`} placeholder="01012345678" required
              />
              <button
                type="button" onClick={handleSendSMS} disabled={isSending || isVerified}
                className="bg-white/10 text-white px-4 rounded-2xl font-black text-[12px] hover:bg-white/20 transition-colors whitespace-nowrap border border-white/10 disabled:opacity-50 flex-shrink-0"
              >
                {isSending ? '발송 중...' : isVerified ? '인증 완료' : showVerificationInput ? '인증번호 재전송' : '인증번호 전송'}
              </button>
            </div>
          </div>

          {showVerificationInput && !isVerified && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label className={labelClass}>인증번호</label>
              <div className="flex gap-2">
                <input
                  type="text" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)}
                  className={`flex-1 ${inputClass}`} placeholder="6자리 숫자 입력" maxLength={6}
                />
                <button
                  type="button" onClick={handleVerifySMS} disabled={isVerifying}
                  className="bg-blue-600/20 text-blue-400 px-5 rounded-2xl font-black text-[13px] hover:bg-blue-600/30 transition-colors whitespace-nowrap border border-blue-500/30 flex-shrink-0 disabled:opacity-50"
                >
                  {isVerifying ? '확인 중...' : '확인'}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit" disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-blue-500/20 transition-all active:scale-[0.98] mt-4 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                가입 중...
              </>
            ) : (
              '비즈니스 회원가입'
            )}
          </button>
        </form>

        <div className="mt-8 text-center space-y-3">
          <p className="text-slate-500 font-bold text-sm">
            이미 비즈니스 계정이 있으신가요?{' '}
            <button onClick={onNavigateLogin} className="text-white hover:text-blue-400 hover:underline font-black ml-1 transition-colors">
              로그인
            </button>
          </p>
          <p className="text-slate-600 font-bold text-xs">
            인플루언서이신가요?{' '}
            <button onClick={onNavigateHome} className="text-slate-400 hover:text-blue-400 hover:underline font-black transition-colors">
              일반 회원가입
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default BusinessSignupPage;
