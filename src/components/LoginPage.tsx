
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';

interface LoginPageProps {
  onNavigateHome: () => void;
  onNavigateSignup: () => void;
  onNavigateBusinessLogin?: () => void;
  onLoginSuccess: (id: string, hasSiteData?: boolean, phone?: string) => void;
}

const KAKAO_SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';

const isAdminEmail = (id: string) => {
  const adminIds = ['admin', 'picksfolio'];
  return adminIds.includes(id.toLowerCase());
};

const supabaseAdminLogin = async (id: string, password: string) => {
  if (!supabase) throw { status: 500, message: 'Supabase not configured' };
  const virtualEmail = `${id.trim()}@picks.me`;
  const { data, error } = await supabase.auth.signInWithPassword({ email: virtualEmail, password });
  if (error) throw { status: 401, message: error.message };
  return data;
};

const LoginPage: React.FC<LoginPageProps> = ({ onNavigateHome, onNavigateSignup, onNavigateBusinessLogin, onLoginSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [kakaoLoading, setKakaoLoading] = useState(false);
  const [formData, setFormData] = useState({ id: '', password: '' });
  const [loginTransitioning, setLoginTransitioning] = useState(false);

  useEffect(() => {
    const loadKakaoSDK = () => {
      if ((window as any).Kakao) {
        initKakao();
        return;
      }
      const script = document.createElement('script');
      script.src = KAKAO_SDK_URL;
      script.async = true;
      script.onload = () => initKakao();
      script.onerror = () => console.warn('[Kakao] SDK load failed');
      document.head.appendChild(script);
    };

    const initKakao = () => {
      const Kakao = (window as any).Kakao;
      if (Kakao && !Kakao.isInitialized()) {
        const kakaoKey = import.meta.env.VITE_KAKAO_JS_KEY || '';
        if (kakaoKey) {
          Kakao.init(kakaoKey);
        }
      }
    };

    loadKakaoSDK();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      alert(`카카오 로그인 오류: ${decodeURIComponent(error)}`);
      window.history.replaceState({}, '', '/login');
    }
  }, []);

  useEffect(() => {
    if (!loginTransitioning) return;
    const timeout = setTimeout(() => {
      console.warn('[Auth] Safety timeout: loginTransitioning still true after 8s, force-clearing');
      setLoginTransitioning(false);
      setKakaoLoading(false);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [loginTransitioning]);

  const handleKakaoLogin = useCallback(() => {
    setKakaoLoading(true);
    setLoginTransitioning(true);
    window.location.href = '/.netlify/functions/kakao-login-start';
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isAdminEmail(formData.id)) {
        try {
          const data = await supabaseAdminLogin(formData.id.trim(), formData.password);
          const roles = data?.user?.app_metadata?.roles || [];
          if (!roles.includes('admin') && !isAdminEmail(formData.id)) {
            alert('관리자 권한이 없는 계정입니다.');
            setIsLoading(false);
            return;
          }
          onLoginSuccess(formData.id.trim());
          return;
        } catch (err: any) {
          if (err?.status === 401) {
            alert('이메일 또는 비밀번호가 올바르지 않습니다.');
          } else {
            alert('관리자 로그인 중 오류가 발생했습니다: ' + (err?.message || '알 수 없는 오류'));
          }
          setIsLoading(false);
          return;
        }
      }

      const response = await fetch('/.netlify/functions/auth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.id.trim(),
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || '로그인 실패');
        return;
      }

      if (data.success) {
        const userId = data.username || formData.id.trim().toLowerCase();
        const hasSiteData = !!data.has_site_data;
        const phone = data.phone || '';

        localStorage.setItem('picks_user_session', userId);

        if (supabase && data.access_token && data.refresh_token) {
          supabase.auth.setSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
          }).catch(() => {});
        }

        onLoginSuccess(userId, hasSiteData, phone);
      }
    } catch (error: any) {
      console.error('Login catch error:', error);
      alert('서버 오류가 발생했습니다: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-20 bg-midnight">
      <div className="w-full max-w-[440px] bg-white rounded-[40px] p-10 md:p-12 shadow-[0_30px_100px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black text-slate-900 mb-2">로그인</h1>
          <p className="text-slate-500 text-sm font-medium">픽스폴리오에 다시 오신 것을 환영합니다.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-black text-slate-800 ml-1">아이디 또는 이메일</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus-within:border-purple-500 transition-colors">
              <input
                type="text"
                name="id"
                placeholder="아이디 또는 관리자 이메일을 입력해 주세요"
                required
                value={formData.id}
                onChange={handleChange}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-black text-slate-800 ml-1">비밀번호</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus-within:border-purple-500 transition-colors">
              <input
                type="password"
                name="password"
                placeholder="비밀번호를 입력해 주세요"
                required
                value={formData.password}
                onChange={handleChange}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                disabled={isLoading}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-5 rounded-2xl text-lg font-black transition-all hover:shadow-[0_10px_30px_rgba(124,58,237,0.3)] active:scale-95 mt-4 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                로그인 중...
              </>
            ) : (
              '로그인'
            )}
          </button>
        </form>

        <div className="relative flex items-center gap-4 my-8">
          <div className="flex-1 h-px bg-slate-200"></div>
          <span className="text-slate-400 text-xs font-bold">또는</span>
          <div className="flex-1 h-px bg-slate-200"></div>
        </div>

        {/* Kakao Login */}
        <div className="mb-6">
          <button
            onClick={handleKakaoLogin}
            disabled={kakaoLoading}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-black text-[15px] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#FEE500', color: '#3C1E1E' }}
          >
            {kakaoLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-[#3C1E1E]/30 border-t-[#3C1E1E] rounded-full animate-spin"></div>
                로그인 중...
              </>
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3C6.48 3 2 6.48 2 10.5c0 2.58 1.7 4.83 4.24 6.12l-1.08 3.96c-.08.28.24.52.48.36L9.96 18.3c.66.12 1.34.18 2.04.18 5.52 0 10-3.48 10-7.98S17.52 3 12 3z" fill="#3C1E1E"/>
                </svg>
                카카오로 1초 만에 시작하기
              </>
            )}
          </button>
        </div>

        <div className="text-center mb-4 text-slate-400 text-sm font-bold">
          계정이 없으신가요? <button onClick={onNavigateSignup} className="text-slate-800 hover:underline" disabled={isLoading}>회원가입하기</button>
        </div>

        {onNavigateBusinessLogin && (
          <button
            onClick={onNavigateBusinessLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-black text-[15px] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-500 text-white mb-4"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            비즈니스 회원 로그인하기
          </button>
        )}

        <div className="text-center">
          <button onClick={onNavigateHome} className="text-slate-400 text-xs hover:text-slate-600 transition-colors">홈으로 돌아가기</button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
