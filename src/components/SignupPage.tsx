import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { digitsOnly, formatPhoneInput } from '../utils/formatters';

interface SignupPageProps {
  initialId: string;
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
  onSignupSuccess: () => void;
}

const SignupPage: React.FC<SignupPageProps> = ({ initialId, onNavigateHome, onNavigateLogin, onSignupSuccess }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

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
    const regex = /^[a-zA-Z0-9]*$/;

    if (regex.test(value)) {
      setId(value);
    } else {
      alert(isEn ? 'User ID can only contain English letters and numbers.' : '주소는 영문으로만 입력 가능합니다.');
    }
  };

  const handleSendSMS = async () => {
    if (!phone) {
      alert(isEn ? 'Please enter your phone number.' : '휴대폰 번호를 입력해 주세요.');
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
        setVerificationCode('');
        setShowVerificationInput(true);
        alert(isResend ? (isEn ? 'Verification code resent.' : '인증번호를 재전송했습니다.') : (isEn ? 'Verification code sent.' : '인증번호가 발송되었습니다.'));
      } else {
        alert(data.error || data.message || (isEn ? 'Failed to send verification code.' : '인증번호 발송에 실패했습니다.'));
      }
    } catch (error) {
      alert(isEn ? 'Server error occurred.' : '서버 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifySMS = async () => {
    if (!verificationCode) {
      alert(isEn ? 'Please enter the verification code.' : '인증번호를 입력해 주세요.');
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
      if (response.ok && data.success) {
        setIsVerified(true);
        alert(isEn ? 'Phone verification complete.' : '휴대폰 인증이 완료되었습니다.');
      } else {
        alert(data.error || data.message || (isEn ? 'Verification failed.' : '인증번호가 일치하지 않거나 만료되었습니다.'));
      }
    } catch (error) {
      alert(isEn ? 'Server error occurred.' : '서버 오류가 발생했습니다.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      alert(isEn ? 'Passwords do not match.' : '비밀번호가 일치하지 않습니다.');
      return;
    }

    if (!isVerified) {
      alert(isEn ? 'Please complete phone verification.' : '휴대폰 번호 인증을 완료해 주세요.');
      return;
    }

    setIsLoading(true);

    try {
      // `identity-signup` 은 가입 API 가 아니다. Netlify Identity 가 계정을 만들 때
      // 스스로 호출하는 예약된 훅 이름이고, 본문에서 `user` 를 읽어 권한(roles)만
      // 돌려준다. 외부에서 직접 부르면 Netlify 가 403 으로 막는다 — 그래서 이 화면의
      // 회원가입은 무엇을 입력해도 "회원가입 실패" 로만 끝났다. 실제로 Supabase
      // 계정 · profiles · site_data · 프로필 코드를 만드는 함수는 `auth-signup` 이다.
      const response = await fetch('/.netlify/functions/auth-signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: id,
          email,
          password,
          full_name: fullName,
          phone,
        }),
      });

      const data = await response.json();

      // auth-signup 은 실패도 200 으로 알려 준다(본문의 success). 상태 코드만 보면
      // 실패를 성공으로 읽어 "가입 완료" 를 띄우고 로그인 화면으로 보내 버린다.
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || (isEn ? 'Signup failed' : '회원가입 실패'));
      }

      alert(isEn ? 'Signup complete! Please log in.' : '회원가입이 완료되었습니다! 로그인해 주세요.');
      onSignupSuccess();
    } catch (error: any) {
      alert(error.message || (isEn ? 'An error occurred during signup.' : '회원가입 중 오류가 발생했습니다.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-midnight text-white flex flex-col justify-center items-center px-4 py-12">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-[32px] p-8 md:p-10 backdrop-blur-xl relative">
        <button
          onClick={onNavigateHome}
          className="absolute top-8 left-8 text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-bold text-sm"
        >
          <ArrowLeft size={18} />
          {isEn ? 'Home' : '홈으로'}
        </button>

        <div className="text-center mt-6 mb-8">
          <h1 className="text-3xl font-black mb-2">{isEn ? 'Sign Up' : '회원가입'}</h1>
          <p className="text-slate-400 font-bold text-sm">
            {isEn ? 'Start building your portfolio with PICKSFOLIO' : '픽스폴리오와 함께 나만의 포트폴리오를 만들어보세요'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">
              {isEn ? 'Username / Handle' : '사용자 아이디 (페이지 주소)'}
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={id}
                onChange={handleIdChange}
                className="w-full bg-white/5 border border-white/10 p-4 pr-28 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                placeholder={isEn ? 'myname' : 'myname'}
                required
              />
              <span className="absolute right-4 text-slate-500 font-bold text-sm pointer-events-none">
                .picks.me
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2 font-bold ml-1">
              {isEn ? `Your site address will be ${id || 'username'}.picks.me` : `완성될 나의 주소: ${id || 'myname'}.picks.me`}
            </p>
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">{isEn ? 'Full Name' : '이름'}</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              placeholder={isEn ? 'Enter your name' : '이름을 입력해 주세요'}
              required
            />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">{isEn ? 'Email' : '이메일'}</label>
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
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">{isEn ? 'Password' : '비밀번호'}</label>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              placeholder={isEn ? 'Enter password' : '비밀번호를 입력해 주세요'}
              required
            />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">{isEn ? 'Confirm Password' : '비밀번호 확인'}</label>
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              placeholder={isEn ? 'Confirm password' : '비밀번호를 다시 입력해 주세요'}
              required
            />
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">{isEn ? 'Phone Number' : '휴대폰 번호'}</label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={formatPhoneInput(phone)}
                onChange={(e) => setPhone(digitsOnly(e.target.value).slice(0, 11))}
                className="flex-1 bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                placeholder="010-1234-5678"
                required
                inputMode="numeric"
                autoComplete="tel"
              />
              <button
                type="button"
                onClick={handleSendSMS}
                disabled={isSending || isVerified}
                className="bg-white/10 text-white px-4 rounded-2xl font-black text-[12px] hover:bg-white/20 transition-colors whitespace-nowrap border border-white/10 disabled:opacity-50 flex-shrink-0"
              >
                {isSending
                  ? (isEn ? 'Sending...' : '발송 중...')
                  : isVerified
                  ? (isEn ? 'Verified' : '인증 완료')
                  : showVerificationInput
                  ? (isEn ? 'Resend' : '인증번호 재전송')
                  : (isEn ? 'Send Code' : '인증번호 전송')}
              </button>
            </div>
          </div>

          {showVerificationInput && !isVerified && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">{isEn ? 'Verification Code' : '인증번호'}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  placeholder={isEn ? '6-digit code' : '6자리 숫자 입력'}
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
                  {isVerifying ? (isEn ? 'Verifying...' : '확인 중...') : (isEn ? 'Verify' : '확인')}
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
                {isEn ? 'Signing up...' : '가입 중...'}
              </>
            ) : (
              isEn ? 'Sign Up' : '회원가입'
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-slate-500 font-bold text-sm">
            {isEn ? 'Already have an account?' : '이미 계정이 있으신가요?'}{' '}
            <button
              onClick={onNavigateLogin}
              className="text-white hover:text-blue-400 hover:underline font-black ml-1 transition-colors"
            >
              {isEn ? 'Log In' : '로그인'}
            </button>
          </p>
          <p className="text-slate-600 font-bold text-xs mt-3">
            {isEn ? 'Are you a business?' : '기업 회원이신가요?'}{' '}
            <button
              onClick={() => window.location.href = '/business-signup'}
              className="text-blue-400 hover:underline font-black transition-colors"
            >
              {isEn ? 'Business Sign Up' : '비즈니스 회원가입'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
