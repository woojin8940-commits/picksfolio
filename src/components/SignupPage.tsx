import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

interface SignupPageProps {
  initialId: string;
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
  onSignupSuccess: () => void;
}

const SignupPage: React.FC<SignupPageProps> = ({ initialId, onNavigateHome, onNavigateLogin, onSignupSuccess }) => {
  const [id, setId] = useState(initialId);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationInput, setShowVerificationInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Regex for English letters and numbers only
    const regex = /^[a-zA-Z0-9]*$/;
    
    if (regex.test(value)) {
      setId(value);
    } else {
      alert('주소는 영문으로만 입력 가능합니다.');
    }
  };

  const handleSendSMS = async () => {
    if (!phone) {
      alert('휴대폰 번호를 입력해 주세요.');
      return;
    }

    const isResend = showVerificationInput;
    setIsSending(true);
    try {
      const response = await fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver: phone, purpose: 'signup' }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        // The code lives only on the server; clear any previously typed value
        setVerificationCode('');
        setShowVerificationInput(true);
        alert(isResend ? '인증번호를 재전송했습니다.' : '인증번호가 발송되었습니다.');
      } else {
        // send-sms returns its reason in `error` (e.g. rate-limit message)
        alert(data.error || data.message || '인증번호 발송에 실패했습니다.');
      }
    } catch (error) {
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
        body: JSON.stringify({ phone, code: verificationCode, purpose: 'signup' }),
      });
      const data = await response.json();
      if (data.success) {
        alert('인증되었습니다.');
        setIsVerified(true);
      } else {
        alert(data.error || '인증번호가 일치하지 않습니다.');
      }
    } catch (error) {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      alert('비밀번호가 일치하지 않습니다.');
      return;
    }
    const cleanEmail = email.trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      alert('올바른 이메일을 입력해 주세요.');
      return;
    }
    if (!isVerified) {
      alert('휴대폰 인증을 완료해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      // Use server-side signup for reliable user creation (auto-confirms email)
      const response = await fetch('/.netlify/functions/auth-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: id.trim(),
          password,
          email: cleanEmail,
          phone: phone.replace(/\D/g, ''),
          full_name: fullName.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        alert(result.error || '회원가입 실패');
        return;
      }

      if (result.success) {
        alert('회원가입이 완료되었습니다. 로그인해주세요.');
        onSignupSuccess();
      }
    } catch (error: any) {
      console.error('Signup catch error:', error);
      alert('서버 오류가 발생했습니다: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-midnight flex items-start justify-center p-4 sm:p-6 py-10 sm:py-16 overflow-y-auto">
      <div className="bg-slate-900/40 backdrop-blur-3xl border border-white/10 p-6 sm:p-8 md:p-12 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-[480px] relative shadow-2xl">
        <button
          onClick={onNavigateHome}
          className="absolute left-5 top-7 sm:left-8 sm:top-10 text-slate-500 hover:text-white transition-colors p-2 -m-2"
        >
          <ArrowLeft size={24} strokeWidth={3} />
        </button>

        <div className="text-center mb-8 sm:mb-10 mt-6 sm:mt-0">
          <h2 className="text-2xl sm:text-[30px] font-black text-white mb-3 tracking-tight">회원가입</h2>
          <p className="text-slate-400 font-bold text-sm sm:text-base">나만의 픽스 주소를 만들고 수익을 창출하세요.</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-6">
          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">아이디 (내 링크 주소)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-base">picks-folio.com/</span>
              <input 
                type="text" 
                value={id} 
                onChange={handleIdChange} 
                className="w-full bg-white/5 border border-white/10 p-4 pl-[9.5rem] rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                placeholder=""
                required
              />
            </div>
            <p className="text-[11px] text-slate-500 font-bold mt-2.5 ml-1">※ 아이디는 나중에 변경할 수 없습니다.</p>
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">이름</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              placeholder="이름을 입력해 주세요"
              required
            />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              placeholder="email@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">비밀번호</label>
            <input 
              type="password" 
              name="password"
              autoComplete="new-password"
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all" 
              placeholder="비밀번호를 입력해 주세요"
              required
            />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">비밀번호 확인</label>
            <input 
              type="password" 
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
              className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all" 
              placeholder="비밀번호를 다시 입력해 주세요"
              required
            />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">휴대폰 번호</label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                placeholder="01012345678"
                required
                inputMode="numeric"
                autoComplete="tel"
                pattern="[0-9]*"
              />
              <button 
                type="button"
                onClick={handleSendSMS}
                disabled={isSending || isVerified}
                className="bg-white/10 text-white px-4 rounded-2xl font-black text-[12px] hover:bg-white/20 transition-colors whitespace-nowrap border border-white/10 disabled:opacity-50 flex-shrink-0"
              >
                {isSending ? '발송 중...' : isVerified ? '인증 완료' : showVerificationInput ? '인증번호 재전송' : '인증번호 전송'}
              </button>
            </div>
          </div>

          {showVerificationInput && !isVerified && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">인증번호</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  placeholder="6자리 숫자 입력"
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                />
                <button
                  type="button"
                  onClick={handleVerifySMS}
                  disabled={isVerifying}
                  className="bg-blue-600/20 text-blue-400 px-5 rounded-2xl font-black text-[13px] hover:bg-blue-600/30 transition-colors whitespace-nowrap border border-blue-500/30 flex-shrink-0 disabled:opacity-50"
                >
                  {isVerifying ? '확인 중...' : '확인'}
                </button>
              </div>
            </div>
          )}

          <button 
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-blue-500/20 transition-all active:scale-[0.98] mt-4 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                가입 중...
              </>
            ) : (
              '회원가입'
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-slate-500 font-bold text-sm">
            이미 계정이 있으신가요?{' '}
            <button
              onClick={onNavigateLogin}
              className="text-white hover:text-blue-400 hover:underline font-black ml-1 transition-colors"
            >
              로그인
            </button>
          </p>
          <p className="text-slate-600 font-bold text-xs mt-3">
            기업 회원이신가요?{' '}
            <button
              onClick={() => window.location.href = '/business-signup'}
              className="text-blue-400 hover:underline font-black transition-colors"
            >
              비즈니스 회원가입
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
