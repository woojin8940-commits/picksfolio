
import React, { useEffect, useState } from 'react';
import { ArrowRight, Briefcase, Lock, Sparkles, User } from 'lucide-react';
import { supabase } from '../services/supabase';
import { setAccountScope, sessionSet } from '../utils/accountScope';
import { primeSupabaseSession } from '../services/apiService';
import { login as netlifyLogin } from '@netlify/identity';
import FindAccount from './FindAccount';
import { useLanguage } from '../contexts/LanguageContext';
import { isKakaoLoginCancelled, startKakaoLogin } from '../utils/kakaoLogin';

const ADMIN_EMAILS = ['woojin8940@inplace-ad.com', 'picksfolio@picks.me'];
const ADMIN_USERNAMES = ['picksfolio'];

interface LoginPageProps {
  onNavigateHome: () => void;
  onNavigateSignup: () => void;
  onLoginSuccess: (id: string, hasSiteData: boolean, phone: string) => void;
  onAdminLoginSuccess?: (info?: { username: string; token: string }) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onNavigateHome, onNavigateSignup, onLoginSuccess, onAdminLoginSuccess }) => {
  const { language, t } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [showFindAccount, setShowFindAccount] = useState(false);
  // 아이디/비밀번호 로그인은 아무것도 저장하지 않는다 — 아이디를 채워 주는 일은
  // 브라우저·OS 의 비밀번호 관리자(autoComplete)가 한다.
  const [formData, setFormData] = useState({ id: '', password: '' });

  // 카카오 간편로그인이 콜백에서 끝내 실패하면 main.tsx 가 `?kakao_login=fail` 을
  // 남기고 이 화면으로 돌려보낸다. 조용히 로그인 폼만 보여 주면 사용자는 왜
  // 돌아왔는지 알 수 없으므로 한 번 알려 주고 주소는 정리한다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('kakao_login') !== 'fail') return;
    params.delete('kakao_login');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
    alert('카카오 로그인을 완료하지 못했습니다. 다시 시도하거나 아이디/비밀번호로 로그인해 주세요.');
  }, []);

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
      // 카카오 JS SDK 또는 서버가 만든 인가 주소로 이동한다. 앱 WebView 에서는
      // 셸이 카카오 스킴/인텐트만 가로채 카카오톡을 외부 앱으로 연다.
      await startKakaoLogin('/login');
      return;
    } catch (err: any) {
      if (!isKakaoLoginCancelled(err)) {
        alert('카카오 로그인 중 오류가 발생했습니다: ' + (err?.message || '알 수 없는 오류'));
      }
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
            // Netlify Identity 로 들어온 운영자도 이 탭을 운영자 슬롯으로 쓴다.
            setAccountScope('operator');
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
          // 운영자로 들어오는 탭은 운영자 슬롯을 쓴다. 이 표시가 먼저 있어야 아래
          // 저장과 Supabase 세션이 일반 유저 탭의 로그인을 덮지 않는다.
          const slotChanged = setAccountScope('operator');
          sessionSet('picks_user_session', username);
          sessionSet('picks_admin_token', result.access_token || '');
          if (supabase && result.access_token && result.refresh_token) {
            // 슬롯이 바뀐 뒤 새로고침(아래)으로 넘어가야 하므로 저장이 끝날 때까지 기다린다.
            try {
              await supabase.auth.setSession({
                access_token: result.access_token,
                refresh_token: result.refresh_token,
              });
            } catch (err) {
              console.warn('[Login] setSession warning:', err);
            }
          }
          if (slotChanged) {
            // 이 탭은 방금 일반 슬롯에서 운영자 슬롯으로 옮겨 왔다. Supabase
            // 클라이언트는 페이지가 뜰 때의 슬롯 이름으로 만들어져 있어서, 한 번
            // 새로 열어야 다른 탭(일반 유저)의 인증 알림과 완전히 갈라진다.
            window.location.href = window.location.origin + '/operator';
            return;
          }
          onAdminLoginSuccess({ username, token: result.access_token || '' });
          return;
        }

        // Set localStorage BEFORE setSession so that the auth state listener
        // can find the username and won't redirect to setup-link.
        // 일반 계정으로 로그인했으니 이 탭은 다시 기본 슬롯이다.
        const slotChanged = setAccountScope('user');
        sessionSet('picks_user_session', username);

        // 대시보드는 아래 onLoginSuccess 에서 곧바로 열리고, 그 화면들이 띄우는 첫
        // 요청(받은 제안 · 협업 목록 · DM 자동화)은 setSession 이 끝나기 전에 나간다.
        // 토큰을 API 계층에 먼저 넘겨 두지 않으면 그 요청들이 인증 헤더 없이 나가
        // 방금 로그인했는데도 "로그인이 필요합니다" 를 보게 된다.
        primeSupabaseSession(result.access_token || '', result.refresh_token || '');

        // Call onLoginSuccess BEFORE setSession so that loginNavigationHandledRef
        // is set before onAuthStateChange fires (prevents race condition to setup-link)
        onLoginSuccess(username, hasSiteData, phone);

        // Set Supabase session from server tokens if available
        if (supabase && result.access_token && result.refresh_token) {
          supabase.auth.setSession({
            access_token: result.access_token,
            refresh_token: result.refresh_token,
          })
            .then(() => {
              // 운영자로 쓰던 탭에 일반 계정으로 로그인한 경우에만 해당한다.
              // 세션이 새 슬롯에 저장된 뒤 한 번 새로 열어야 Supabase 클라이언트가
              // 이 슬롯 이름으로 다시 만들어진다.
              if (slotChanged) window.location.href = window.location.origin + '/admin';
            })
            .catch(err => console.warn('[Login] setSession warning:', err));
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

  // 홈과 같은 규칙을 쓰는 조각들. 입력칸·버튼이 여러 번 반복되므로 한곳에 모아 둔다.
  const fieldShell =
    'flex items-center gap-2.5 bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-4 py-3 transition-colors focus-within:border-[#2563EB] focus-within:bg-white';
  const fieldInput =
    'bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold placeholder:text-[#C3C9DC] text-sm';

  return (
    <div className="relative min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 pt-20 sm:pt-28 pb-12 sm:pb-16 overflow-hidden">
      {/* 배경은 홈의 히어로와 같다 — 종이색 위에 옅은 점 격자와 파스텔 얼룩 두 개.
          종이색 자체는 body.home-paper 와 App.tsx 의 바깥 틀이 칠하므로 여기서는
          무늬만 올린다. 스크롤과 함께 다시 그리지 않도록 배경 레이어에만 얹는다.

          층 순서는 음수 z-index 로 두지 않는다 — 바깥 틀(App.tsx)이 배경색을
          가지고 있어서, 음수 층은 그 배경보다 먼저 그려져 아예 보이지 않는다.
          배경 층은 z-0, 내용은 z-10 으로 올려 순서를 못 박는다. */}
      <div aria-hidden className="absolute inset-0 z-0 home-dotgrid opacity-70" />
      <div
        aria-hidden
        className="absolute -top-24 -right-16 w-[320px] h-[320px] md:w-[520px] md:h-[520px] rounded-full z-0 blur-[90px] paper-glow-blue"
      />
      <div
        aria-hidden
        className="absolute top-1/2 -left-24 w-[260px] h-[260px] md:w-[400px] md:h-[400px] rounded-full z-0 blur-[90px] paper-glow-green"
      />

      <div className="relative z-10 w-full max-w-sm sm:max-w-md">
        {/* 카드 밖의 인사말. 홈의 히어로와 같은 순서(알약 → 큰 제목 → 설명)다. */}
        <div className="text-center">
          <span className="inline-flex items-center gap-2 bg-white border border-[#0B0F1A]/10 text-[#2563EB] text-[11px] font-black px-3.5 py-1.5 rounded-full shadow-sm">
            <Sparkles size={12} strokeWidth={2.8} />
            {language === 'en' ? 'Creator login' : '크리에이터 로그인'}
          </span>
          <h1 className="mt-4 sm:mt-5 text-[1.6rem] sm:text-[2.15rem] leading-[1.18] font-black tracking-tighter text-[#0B0F1A] font-display">
            {language === 'en' ? (
              <>
                Welcome back to{' '}
                <span className="relative inline-block">
                  <span className="relative z-10 text-[#2563EB]">PICKSFOLIO</span>
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 bottom-0.5 h-2 sm:h-2.5 -z-0 rounded-full"
                    style={{ background: 'rgba(37,99,235,0.16)' }}
                  />
                </span>
              </>
            ) : (
              <>
                <span className="relative inline-block">
                  <span className="relative z-10 text-[#2563EB]">내 링크</span>
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 bottom-0.5 h-2 sm:h-2.5 -z-0 rounded-full"
                    style={{ background: 'rgba(37,99,235,0.16)' }}
                  />
                </span>
                로 다시 들어가기
              </>
            )}
          </h1>
          <p className="mt-2.5 sm:mt-3 text-sm text-[#4A5273] font-medium">
            {language === 'en'
              ? "Check today's trends and introduce them on your link."
              : '오늘의 트렌드를 확인 후 링크에 소개해보세요.'}
          </p>
        </div>

        {/* 로그인 카드 — 홈의 흰 카드와 같은 테두리·그림자·둥근 정도다. */}
        <div className="mt-6 sm:mt-7 bg-white border border-[#0B0F1A]/[0.08] rounded-[1.5rem] sm:rounded-[1.75rem] p-5 sm:p-7 shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] animate-in fade-in slide-in-from-bottom-2 duration-500">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-black text-[#39415C] ml-1">
                {language === 'en' ? 'Username or Email' : '아이디 또는 이메일'}
              </label>
              <div className={fieldShell}>
                <User size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="text"
                  name="id"
                  placeholder={language === 'en' ? 'Enter username or admin email' : '아이디 또는 관리자 이메일'}
                  required
                  value={formData.id}
                  onChange={handleChange}
                  className={fieldInput}
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
              <label className="block text-xs font-black text-[#39415C] ml-1">
                {language === 'en' ? 'Password' : '비밀번호'}
              </label>
              <div className={fieldShell}>
                <Lock size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="password"
                  name="password"
                  placeholder={language === 'en' ? 'Enter password' : '비밀번호를 입력해 주세요'}
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className={fieldInput}
                  disabled={isLoading}
                  autoComplete="current-password"
                />
              </div>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setShowFindAccount(true)}
                  className="text-[11px] text-[#8B93AE] hover:text-[#2563EB] font-bold transition-colors"
                >
                  {language === 'en' ? 'Find ID/Password' : '아이디/비밀번호 찾기'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#2563EB] hover:bg-[#1d4ed8] text-white py-3.5 rounded-full text-sm font-black transition-all shadow-[0_12px_28px_-12px_rgba(37,99,235,0.8)] active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  {language === 'en' ? 'Logging in...' : '로그인 중...'}
                </>
              ) : (
                <>
                  {t('nav.login', '로그인', 'Log In')}
                  <ArrowRight size={16} strokeWidth={2.8} />
                </>
              )}
            </button>
          </form>

          <div className="relative my-4 flex items-center">
            <div className="flex-grow border-t border-[#0B0F1A]/[0.08]"></div>
            <span className="flex-shrink mx-3 text-[#A6ADC6] text-[11px] font-black">
              {language === 'en' ? 'OR' : '또는'}
            </span>
            <div className="flex-grow border-t border-[#0B0F1A]/[0.08]"></div>
          </div>

          <button
            type="button"
            onClick={handleKakaoLogin}
            disabled={isLoading}
            className="w-full py-3 rounded-full text-sm font-black transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 shadow-[0_10px_24px_-14px_rgba(11,15,26,0.7)]"
            style={{ backgroundColor: '#FEE500', color: '#000000' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 3C6.48 3 2 6.36 2 10.44c0 2.62 1.72 4.92 4.32 6.24-.14.52-.92 3.36-.96 3.58 0 0-.02.16.08.22.1.06.22.02.22.02.3-.04 3.44-2.26 3.98-2.64.76.1 1.56.16 2.36.16 5.52 0 10-3.36 10-7.58C22 6.36 17.52 3 12 3z" fill="#000000"/>
            </svg>
            {language === 'en' ? 'Start with Kakao in 1 sec' : '카카오로 1초 만에 시작하기'}
          </button>

          {/* 로그인 유지("간편로그인 저장") 체크는 두지 않는다 — 카카오 로그인 화면이
              이미 자기 "간편로그인 저장"을 제공한다. 우리 화면에 같은 이름을 하나 더
              두면 무엇을 저장하는 건지 알 수 없다. utils/loginPersistence 참고. */}

          <p className="text-center mt-5 text-[#8B93AE] text-[13px] font-bold">
            {language === 'en' ? "Don't have an account?" : '계정이 없으신가요?'}{' '}
            <button
              onClick={onNavigateSignup}
              className="text-[#2563EB] font-black hover:underline"
              disabled={isLoading}
            >
              {t('nav.signup', '회원가입하기', 'Sign Up')}
            </button>
          </p>
        </div>

        {/* 비즈니스 로그인은 다른 종류의 계정이라 카드 밖에 둔다 — 크리에이터
            로그인 버튼과 나란히 두면 어느 쪽을 눌러야 하는지 헷갈린다. */}
        <button
          type="button"
          onClick={() => window.location.href = '/business-login'}
          disabled={isLoading}
          className="w-full mt-4 py-3 rounded-full text-[13px] font-black transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-white text-[#0B0F1A] border border-[#0B0F1A]/10 hover:border-[#0B0F1A]/25 shadow-sm"
        >
          <Briefcase size={15} className="text-[#2563EB]" strokeWidth={2.6} />
          {language === 'en' ? 'Business Login' : '비즈니스 회원 로그인하기'}
        </button>

        <div className="text-center mt-4">
          <button
            onClick={onNavigateHome}
            className="text-[#8B93AE] text-xs font-bold hover:text-[#0B0F1A] transition-colors"
          >
            {language === 'en' ? 'Return to Home' : '홈으로 돌아가기'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
