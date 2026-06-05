
import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { login as netlifyLogin } from '@netlify/identity';
import FindAccount from './FindAccount';

const ADMIN_EMAILS = ['woojin8940@inplace-ad.com', 'picksfolio@picks.me'];
const ADMIN_USERNAMES = ['picksfolio'];

interface LoginPageProps {
  onNavigateHome: () => void;
  onNavigateSignup: () => void;
  onLoginSuccess: (id: string, hasSiteData: boolean, phone: string) => void;
  onAdminLoginSuccess?: (info?: { username: string; token: string }) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onNavigateHome, onNavigateSignup, onLoginSuccess, onAdminLoginSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [showFindAccount, setShowFindAccount] = useState(false);
  const [formData, setFormData] = useState({
    id: '',
    password: ''
  });

  const isAdminEmail = (input: string) => {
    return ADMIN_EMAILS.includes(input.trim().toLowerCase());
  };

  const handleKakaoLogin = async () => {
    if (!supabase) {
      console.error('[Login] Supabase 클라이언트가 null입니다. 환경 변수를 확인하세요. VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY');
      alert('서버 연결이 설정되지 않아 카카오 로그인을 사용할 수 없습니다. 아이디/비밀번호로 로그인해 주세요.');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'kakao',
        options: {
          redirectTo: window.location.origin + '/login',
          scopes: 'openid profile_nickname account_email phone_number name',
          queryParams: {
            prompt: 'login',
            auth_type: 'reauthenticate',
          },
        },
      });
      if (error) {
        alert('카카오 로그인 실패: ' + error.message);
      }
    } catch (err: any) {
      alert('카카오 로그인 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Check if the input is an admin email — use Netlify Identity for admin auth
      if (isAdminEmail(formData.id)) {
        try {
          const user = await netlifyLogin(formData.id.trim(), formData.password);
          const roles: string[] = (user as any).app_metadata?.roles || [];
          if (!roles.includes('admin') && !isAdminEmail(formData.id)) {
            alert('관리자 권한이 없는 계정입니다.');
            setIsLoading(false);
            return;
          }
          if (onAdminLoginSuccess) {
            onAdminLoginSuccess();
          }
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

      // Use server-side auth endpoint for reliable login (handles email confirmation automatically)
      console.log('[Login] 서버 인증 요청 시작:', { username: formData.id.trim() });
      const response = await fetch('/.netlify/functions/auth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.id.trim(),
          password: formData.password,
        }),
      });

      console.log('[Login] 서버 응답 상태:', response.status, response.statusText);
      const result = await response.json();
      console.log('[Login] 서버 응답 데이터:', { success: result.success, error: result.error });

      if (!response.ok) {
        alert(result.error || '로그인 실패');
        return;
      }

      if (result.success) {
        const username = result.username || formData.id.trim().toLowerCase();
        const hasSiteData = !!result.has_site_data;
        const phone = result.phone || '';

        if (ADMIN_USERNAMES.includes(username) && onAdminLoginSuccess) {
          localStorage.setItem('picks_user_session', username);
          localStorage.setItem('picks_admin_token', result.access_token || '');
          if (supabase && result.access_token && result.refresh_token) {
            supabase.auth.setSession({
              access_token: result.access_token,
              refresh_token: result.refresh_token,
            }).catch(err => console.warn('[Login] setSession warning:', err));
          }
          onAdminLoginSuccess({ username, token: result.access_token || '' });
          return;
        }

        // Set localStorage BEFORE setSession so that the auth state listener
        // can find the username and won't redirect to setup-link
        localStorage.setItem('picks_user_session', username);

        // Call onLoginSuccess BEFORE setSession so that loginNavigationHandledRef
        // is set before onAuthStateChange fires (prevents race condition to setup-link)
        onLoginSuccess(username, hasSiteData, phone);

        // Set Supabase session from server tokens if available
        if (supabase && result.access_token && result.refresh_token) {
          supabase.auth.setSession({
            access_token: result.access_token,
            refresh_token: result.refresh_token,
          }).catch(err => console.warn('[Login] setSession warning:', err));
        }
      }
    } catch (error: any) {
      console.error('[Login] 로그인 오류 상세:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
        type: error instanceof TypeError ? 'TypeError (네트워크/CORS 오류 가능성)' : error?.constructor?.name,
      });

      // TypeError typically means network failure or CORS block
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        alert('서버에 연결할 수 없습니다. 네트워크 연결을 확인하거나, 잠시 후 다시 시도해주세요.\n\n(콘솔에서 상세 에러를 확인하세요)');
      } else {
        alert('서버 오류가 발생했습니다: ' + error.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  if (showFindAccount) {
    return <FindAccount accountType="user" onBack={() => setShowFindAccount(false)} />;
  }

  return (
    <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 pt-24 sm:pt-28 pb-10 sm:pb-14 bg-midnight overflow-y-auto">
      <div className="w-full max-w-sm sm:max-w-md bg-white rounded-[22px] sm:rounded-[26px] p-6 sm:p-9 shadow-[0_30px_100px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-7">
          <h1 className="text-2xl font-black text-slate-900 mb-1">로그인</h1>
          <p className="text-slate-500 text-sm font-medium">픽스폴리오에 다시 오신 것을 환영합니다.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-black text-slate-800 ml-1">아이디 또는 이메일</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 focus-within:border-blue-500 transition-colors">
              <input
                type="text"
                name="id"
                placeholder="아이디 또는 관리자 이메일을 입력해 주세요"
                required
                value={formData.id}
                onChange={handleChange}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                disabled={isLoading}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-black text-slate-800 ml-1">비밀번호</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 focus-within:border-blue-500 transition-colors">
              <input
                type="password"
                name="password"
                placeholder="비밀번호를 입력해 주세요"
                required
                value={formData.password}
                onChange={handleChange}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                disabled={isLoading}
                autoComplete="current-password"
              />
            </div>
            <div className="text-right">
              <button type="button" onClick={() => setShowFindAccount(true)} className="text-xs text-slate-400 hover:text-blue-600 font-bold transition-colors">
                아이디/비밀번호 찾기
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-2xl text-sm font-black transition-all hover:shadow-[0_10px_30px_rgba(124,58,237,0.3)] active:scale-95 mt-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

        <div className="relative my-4 flex items-center">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink mx-4 text-slate-400 text-xs font-bold">또는</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        <button
          type="button"
          onClick={handleKakaoLogin}
          disabled={isLoading}
          className="w-full py-2.5 rounded-2xl text-sm font-black transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          style={{ backgroundColor: '#FEE500', color: '#000000' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 3C6.48 3 2 6.36 2 10.44c0 2.62 1.72 4.92 4.32 6.24-.14.52-.92 3.36-.96 3.58 0 0-.02.16.08.22.1.06.22.02.22.02.3-.04 3.44-2.26 3.98-2.64.76.1 1.56.16 2.36.16 5.52 0 10-3.36 10-7.58C22 6.36 17.52 3 12 3z" fill="#000000"/>
          </svg>
          카카오로 1초 만에 시작하기
        </button>

        <div className="text-center mt-4 text-slate-400 text-sm font-bold">
          계정이 없으신가요? <button onClick={onNavigateSignup} className="text-slate-800 hover:underline" disabled={isLoading}>회원가입하기</button>
        </div>

        <button
          type="button"
          onClick={() => window.location.href = '/business-login'}
          disabled={isLoading}
          className="w-full py-2.5 rounded-2xl text-sm font-black transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 text-white mt-2.5"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 7h-9" /><path d="M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" />
          </svg>
          비즈니스 회원 로그인하기
        </button>

        <div className="text-center mt-2.5">
          <button onClick={onNavigateHome} className="text-slate-400 text-xs hover:text-slate-600 transition-colors">홈으로 돌아가기</button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
