import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';

interface SignupPageProps {
  initialId: string;
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
  onSignupSuccess: () => void;
}

const KAKAO_SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';

const SignupPage: React.FC<SignupPageProps> = ({ initialId, onNavigateHome, onNavigateLogin, onSignupSuccess }) => {
  const [id, setId] = useState(initialId);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationInput, setShowVerificationInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [kakaoLoading, setKakaoLoading] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);

  useEffect(() => {
    if ((window as any).Kakao) return;
    const script = document.createElement('script');
    script.src = KAKAO_SDK_URL;
    script.async = true;
    script.onload = () => {
      const Kakao = (window as any).Kakao;
      if (Kakao && !Kakao.isInitialized()) {
        const key = import.meta.env.VITE_KAKAO_JS_KEY || '';
        if (key) Kakao.init(key);
      }
    };
    document.head.appendChild(script);
  }, []);

  const handleKakaoSignup = useCallback(() => {
    if (!privacyAgreed) {
      alert('개인정보 수집 및 이용에 동의해 주세요.');
      return;
    }
    setKakaoLoading(true);
    window.location.href = '/.netlify/functions/kakao-login-start';
  }, [privacyAgreed]);

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
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
    } catch (error) {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifySMS = () => {
    if (verificationCode === generatedCode && generatedCode !== '') {
      alert('인증되었습니다.');
      setIsVerified(true);
    } else {
      alert('인증번호가 일치하지 않습니다.');
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

    setIsLoading(true);
    try {
      const response = await fetch('/.netlify/functions/auth-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: id.trim(),
          password,
          phone: phone.replace(/\D/g, ''),
          full_name: id.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || '회원가입 실패');
        return;
      }
      if (data.success) {
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
    <div className="min-h-screen bg-midnight flex items-center justify-center p-6">
      <div className="bg-slate-900/40 backdrop-blur-3xl border border-white/10 p-8 md:p-12 rounded-[2.5rem] w-full max-w-[480px] relative shadow-2xl mt-20 mb-10">
        <button
          onClick={onNavigateHome}
          className="absolute left-8 top-10 text-slate-500 hover:text-white transition-colors"
        >
          <ArrowLeft size={24} strokeWidth={3} />
        </button>

        <div className="text-center mb-10">
          <h2 className="text-[30px] font-black text-white mb-3 tracking-tight">회원가입</h2>
          <p className="text-slate-400 font-bold text-base">나만의 픽스 주소를 만들고 수익을 창출하세요.</p>
        </div>

        {/* Kakao Signup Section */}
        <div className="mb-8">
          <div className="flex items-start gap-2 mb-4">
            <input
              type="checkbox"
              id="signup-privacy-agree"
              checked={privacyAgreed}
              onChange={(e) => setPrivacyAgreed(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-slate-600 text-purple-600 focus:ring-purple-500 accent-purple-600 flex-shrink-0"
            />
            <label htmlFor="signup-privacy-agree" className="text-[11px] text-slate-400 font-medium leading-relaxed cursor-pointer">
              <a href="/privacy" target="_blank" className="text-purple-400 font-bold underline">개인정보처리방침</a>에 따른 개인정보 수집·이용에 동의합니다.
            </label>
          </div>

          <button
            onClick={handleKakaoSignup}
            disabled={kakaoLoading || !privacyAgreed}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-black text-[15px] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#FEE500', color: '#3C1E1E' }}
          >
            {kakaoLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-[#3C1E1E]/30 border-t-[#3C1E1E] rounded-full animate-spin"></div>
                가입 중...
              </>
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3C6.48 3 2 6.48 2 10.5c0 2.58 1.7 4.83 4.24 6.12l-1.08 3.96c-.08.28.24.52.48.36L9.96 18.3c.66.12 1.34.18 2.04.18 5.52 0 10-3.48 10-7.98S17.52 3 12 3z" fill="#3C1E1E"/>
                </svg>
                동의하고 카카오로 시작하기
              </>
            )}
          </button>
        </div>

        <div className="relative flex items-center gap-4 mb-8">
          <div className="flex-1 h-px bg-white/10"></div>
          <span className="text-slate-500 text-xs font-bold">또는 아이디로 가입</span>
          <div className="flex-1 h-px bg-white/10"></div>
        </div>

        <form onSubmit={handleSignup} className="space-y-6">
          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">아이디 (내 링크 주소)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-base">picks.me/</span>
              <input
                type="text"
                value={id}
                onChange={handleIdChange}
                className="w-full bg-white/5 border border-white/10 p-4 pl-[5.5rem] rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                placeholder=""
                required
              />
            </div>
            <p className="text-[11px] text-slate-500 font-bold mt-2.5 ml-1">※ 아이디는 나중에 변경할 수 없습니다.</p>
          </div>

          <div>
            <label className="block text-[14px] font-black text-slate-300 mb-2.5 ml-1">비밀번호</label>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
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
              className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
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
                className="flex-1 bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                placeholder="01012345678"
                required
              />
              <button
                type="button"
                onClick={handleSendSMS}
                disabled={isSending || isVerified}
                className="bg-white/10 text-white px-4 rounded-2xl font-black text-[12px] hover:bg-white/20 transition-colors whitespace-nowrap border border-white/10 disabled:opacity-50 flex-shrink-0"
              >
                {isSending ? '발송 중...' : isVerified ? '인증 완료' : '인증번호 전송'}
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
                  className="flex-1 bg-white/5 border border-white/10 p-4 rounded-2xl font-bold text-lg text-white placeholder:text-slate-600 focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all"
                  placeholder="6자리 숫자 입력"
                  maxLength={6}
                />
                <button
                  type="button"
                  onClick={handleVerifySMS}
                  className="bg-purple-600/20 text-purple-400 px-5 rounded-2xl font-black text-[13px] hover:bg-purple-600/30 transition-colors whitespace-nowrap border border-purple-500/30 flex-shrink-0"
                >
                  확인
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-purple-500/20 transition-all active:scale-[0.98] mt-4 disabled:opacity-50 flex items-center justify-center gap-2"
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

        <div className="mt-6 text-center">
          <p className="text-slate-500 text-[11px] font-medium mb-4">
            비즈니스/브랜드 계정이 필요하신가요?{' '}
            <button onClick={() => window.location.href = '/business-signup'} className="text-purple-400 font-bold hover:underline">비즈니스 가입</button>
          </p>
        </div>

        <div className="mt-2 text-center">
          <p className="text-slate-500 font-bold text-sm">
            이미 계정이 있으신가요?{' '}
            <button
              onClick={onNavigateLogin}
              className="text-white hover:text-purple-400 hover:underline font-black ml-1 transition-colors"
            >
              로그인
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
