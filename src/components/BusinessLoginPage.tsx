import React, { useState } from 'react';
import FindAccount from './FindAccount';
import { useLanguage } from '../contexts/LanguageContext';

interface BusinessLoginPageProps {
  onNavigateHome: () => void;
  onNavigateBusinessSignup: () => void;
  onLoginSuccess: (businessUsername: string, companyName: string) => void;
}

const BusinessLoginPage: React.FC<BusinessLoginPageProps> = ({ onNavigateHome, onNavigateBusinessSignup, onLoginSuccess }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

  const [isLoading, setIsLoading] = useState(false);
  const [showFindAccount, setShowFindAccount] = useState(false);
  // 비즈니스 로그인은 아이디도, 로그인 유지도 저장하지 않는다 — 아이디를 채워 주는
  // 일은 브라우저·OS 의 비밀번호 관리자(autoComplete)가 한다. 이제 어느 로그인
  // 화면에도 저장 옵션이 없다(utils/loginPersistence).
  const [formData, setFormData] = useState({ username: '', password: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const response = await fetch('/.netlify/functions/business-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          username: formData.username.trim().toLowerCase(),
          password: formData.password,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        alert(result.error || (isEn ? 'Login failed' : '로그인 실패'));
        return;
      }

      if (result.success) {
        localStorage.setItem('picks_business_session', result.username);
        localStorage.setItem('picks_business_company', result.company_name);
        if (result.access_token) {
          localStorage.setItem('picks_business_access_token', result.access_token);
        }
        if (result.refresh_token) {
          localStorage.setItem('picks_business_refresh_token', result.refresh_token);
        }
        onLoginSuccess(result.username, result.company_name);
      } else {
        alert(result.error || (isEn ? 'Failed to log in.' : '로그인에 실패했습니다.'));
      }
    } catch (error: any) {
      alert((isEn ? 'Server error: ' : '서버 오류가 발생했습니다: ') + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  if (showFindAccount) {
    return <FindAccount accountType="business" onBack={() => setShowFindAccount(false)} />;
  }

  return (
    <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 py-10 sm:py-20 paper-page overflow-y-auto">
      <div className="w-full max-w-[440px] bg-white border border-[#0B0F1A]/[0.08] rounded-[1.5rem] sm:rounded-[1.75rem] p-6 sm:p-9 md:p-10 shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-white border border-[#0B0F1A]/10 text-[#2563EB] px-3.5 py-1.5 rounded-full text-[11px] font-black mb-4 shadow-sm">
            BUSINESS
          </div>
          <h1 className="text-[1.75rem] sm:text-3xl font-black tracking-tighter text-[#0B0F1A] mb-2 font-display">{isEn ? 'Business Log In' : '비즈니스 로그인'}</h1>
          <p className="text-[#4A5273] text-sm font-medium">{isEn ? 'Sign in to your brand dashboard' : '기업 대시보드에 로그인하세요.'}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="block text-sm font-black text-[#39415C] ml-1">{isEn ? 'Business ID' : '비즈니스 아이디'}</label>
            <div className="bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-4 py-3.5 transition-colors focus-within:border-[#2563EB] focus-within:bg-white">
              <input
                type="text" name="username" placeholder={isEn ? 'Enter business ID' : '비즈니스 아이디를 입력해 주세요'}
                required value={formData.username} onChange={handleChange}
                className="bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold text-sm"
                disabled={isLoading}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-black text-[#39415C] ml-1">{isEn ? 'Password' : '비밀번호'}</label>
            <div className="bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-4 py-3.5 transition-colors focus-within:border-[#2563EB] focus-within:bg-white">
              <input
                type="password" name="password" placeholder={isEn ? 'Enter password' : '비밀번호를 입력해 주세요'}
                required value={formData.password} onChange={handleChange}
                className="bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold text-sm"
                disabled={isLoading}
                autoComplete="current-password"
              />
            </div>
            <div className="flex items-center justify-end">
              <button type="button" onClick={() => setShowFindAccount(true)} className="text-xs text-[#8B93AE] hover:text-[#2563EB] font-bold transition-colors">
                {isEn ? 'Find ID / Password' : '아이디/비밀번호 찾기'}
              </button>
            </div>
          </div>

          <button
            type="submit" disabled={isLoading}
            className="w-full bg-[#2563EB] hover:bg-[#1d4ed8] text-white py-4 rounded-full text-base font-black transition-all shadow-[0_12px_28px_-12px_rgba(37,99,235,0.8)] active:scale-[0.97] mt-4 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                {isEn ? 'Logging in...' : '로그인 중...'}
              </>
            ) : (
              isEn ? 'Business Log In' : '비즈니스 로그인'
            )}
          </button>
        </form>

        <div className="text-center mt-6 space-y-3">
          <p className="text-[#8B93AE] text-sm font-bold">
            {isEn ? "Don't have a business account?" : '비즈니스 계정이 없으신가요?'}{' '}
            <button onClick={onNavigateBusinessSignup} className="text-[#2563EB] hover:underline font-black" disabled={isLoading}>
              {isEn ? 'Sign Up' : '회원가입하기'}
            </button>
          </p>
          <p className="text-[#8B93AE] text-xs font-bold">
            {isEn ? 'Are you an influencer?' : '인플루언서이신가요?'}{' '}
            <button onClick={onNavigateHome} className="text-[#39415C] hover:text-[#2563EB] hover:underline" disabled={isLoading}>
              {isEn ? 'Creator Login' : '일반 로그인'}
            </button>
          </p>
          <div className="pt-2">
            <button onClick={onNavigateHome} className="text-[#8B93AE] text-xs font-bold hover:text-[#0B0F1A] transition-colors">
              {isEn ? 'Return to Home' : '홈으로 돌아가기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusinessLoginPage;
