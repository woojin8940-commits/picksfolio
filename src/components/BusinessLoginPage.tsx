import React, { useState } from 'react';

interface BusinessLoginPageProps {
  onNavigateHome: () => void;
  onNavigateBusinessSignup: () => void;
  onLoginSuccess: (username: string, companyName: string) => void;
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
      const data = await response.json();
      if (!response.ok) { alert(data.error || '로그인 실패'); return; }
      if (data.success) {
        localStorage.setItem('picks_business_session', data.username);
        localStorage.setItem('picks_business_company', data.company_name);
        if (data.access_token) localStorage.setItem('picks_business_access_token', data.access_token);
        if (data.refresh_token) localStorage.setItem('picks_business_refresh_token', data.refresh_token);
        onLoginSuccess(data.username, data.company_name);
      }
    } catch (err: any) {
      alert('서버 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-20 bg-midnight">
      <div className="w-full max-w-[440px] bg-white rounded-[40px] p-10 md:p-12 shadow-[0_30px_100px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black text-slate-900 mb-2">비즈니스 로그인</h1>
          <p className="text-slate-500 text-sm font-medium">브랜드/기업 계정으로 로그인하세요.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-black text-slate-800 ml-1">아이디</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus-within:border-purple-500 transition-colors">
              <input type="text" placeholder="비즈니스 아이디를 입력해 주세요" required
                value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium" disabled={isLoading} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-black text-slate-800 ml-1">비밀번호</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus-within:border-purple-500 transition-colors">
              <input type="password" placeholder="비밀번호를 입력해 주세요" required
                value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium" disabled={isLoading} />
            </div>
          </div>

          <button type="submit" disabled={isLoading}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-5 rounded-2xl text-lg font-black transition-all hover:shadow-[0_10px_30px_rgba(124,58,237,0.3)] active:scale-95 mt-4 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {isLoading ? (
              <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>로그인 중...</>
            ) : '로그인'}
          </button>
        </form>

        <div className="text-center mt-8 text-slate-400 text-sm font-bold">
          계정이 없으신가요? <button onClick={onNavigateBusinessSignup} className="text-slate-800 hover:underline" disabled={isLoading}>비즈니스 회원가입</button>
        </div>

        <div className="text-center mt-4">
          <button onClick={onNavigateHome} className="text-slate-400 text-xs hover:text-slate-600 transition-colors">홈으로 돌아가기</button>
        </div>
      </div>
    </div>
  );
};

export default BusinessLoginPage;
