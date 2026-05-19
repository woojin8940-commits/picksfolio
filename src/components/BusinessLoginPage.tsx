import React, { useState } from 'react';

interface BusinessLoginPageProps {
  onNavigateHome: () => void;
  onNavigateBusinessSignup: () => void;
  onLoginSuccess: (businessUsername: string, companyName: string) => void;
}

const BusinessLoginPage: React.FC<BusinessLoginPageProps> = ({ onNavigateHome, onNavigateBusinessSignup, onLoginSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
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
        alert(result.error || '로그인 실패');
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
        alert(result.error || '로그인에 실패했습니다.');
      }
    } catch (error: any) {
      alert('서버 오류가 발생했습니다: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 py-10 sm:py-20 bg-midnight overflow-y-auto">
      <div className="w-full max-w-[440px] bg-white rounded-[32px] sm:rounded-[40px] p-7 sm:p-10 md:p-12 shadow-[0_30px_100px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-1.5 rounded-full text-xs font-black mb-4">
            BUSINESS
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-2">비즈니스 로그인</h1>
          <p className="text-slate-500 text-sm font-medium">기업 대시보드에 로그인하세요.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-black text-slate-800 ml-1">비즈니스 아이디</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus-within:border-blue-500 transition-colors">
              <input
                type="text" name="username" placeholder="비즈니스 아이디를 입력해 주세요"
                required value={formData.username} onChange={handleChange}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-black text-slate-800 ml-1">비밀번호</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus-within:border-blue-500 transition-colors">
              <input
                type="password" name="password" placeholder="비밀번호를 입력해 주세요"
                required value={formData.password} onChange={handleChange}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                disabled={isLoading}
              />
            </div>
          </div>

          <button
            type="submit" disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl text-lg font-black transition-all hover:shadow-[0_10px_30px_rgba(37,99,235,0.3)] active:scale-95 mt-4 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                로그인 중...
              </>
            ) : (
              '비즈니스 로그인'
            )}
          </button>
        </form>

        <div className="text-center mt-8 space-y-3">
          <p className="text-slate-400 text-sm font-bold">
            비즈니스 계정이 없으신가요?{' '}
            <button onClick={onNavigateBusinessSignup} className="text-slate-800 hover:underline font-black" disabled={isLoading}>
              회원가입하기
            </button>
          </p>
          <p className="text-slate-400 text-xs font-bold">
            인플루언서이신가요?{' '}
            <button onClick={onNavigateHome} className="text-slate-500 hover:text-purple-600 hover:underline" disabled={isLoading}>
              일반 로그인
            </button>
          </p>
          <div className="pt-2">
            <button onClick={onNavigateHome} className="text-slate-400 text-xs hover:text-slate-600 transition-colors">홈으로 돌아가기</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusinessLoginPage;
