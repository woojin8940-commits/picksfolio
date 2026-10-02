
import React, { useEffect, useState } from 'react';
import { Briefcase, Sparkles } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import { isKakaoLoginCancelled, startKakaoLogin } from '../utils/kakaoLogin';

interface LoginPageProps {
  onNavigateHome: () => void;
  onNavigateSignup: () => void;
  onLoginSuccess: (id: string, hasSiteData: boolean, phone: string) => void;
  onAdminLoginSuccess?: (info?: { username: string; token: string }) => void;
}

/**
 * 크리에이터(인플루언서) 로그인. 카카오 간편로그인 하나만 둔다.
 *
 * 아이디·비밀번호 로그인과 이메일 회원가입은 없앴다 — 처음 온 사람도 카카오로 시작하면
 * 바로 가입된다. 예전 아이디·비밀번호 계정으로 쓰던 유저네임은 카카오로 다시 가입한 뒤
 * 링크 만들기 화면에서 그대로 이어받을 수 있다(auth-claim-username 의 이전 규칙).
 * 운영자는 /operator-login, 브랜드는 /business-login 을 쓴다.
 */
const LoginPage: React.FC<LoginPageProps> = ({ onNavigateHome }) => {
  const { language } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);

  // 카카오 간편로그인이 콜백에서 끝내 실패하면 main.tsx 가 `?kakao_login=fail` 을
  // 남기고 이 화면으로 돌려보낸다. 조용히 로그인 폼만 보여 주면 사용자는 왜
  // 돌아왔는지 알 수 없으므로 한 번 알려 주고 주소는 정리한다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('kakao_login') !== 'fail') return;
    params.delete('kakao_login');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
    alert('카카오 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }, []);

  const handleKakaoLogin = async () => {
    if (!supabase) {
      console.error('[Login] Supabase 클라이언트가 null입니다. 환경 변수를 확인하세요. VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY');
      alert('서버 연결이 설정되지 않아 카카오 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.');
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

          <p className="text-center mt-4 text-[#8B93AE] text-[12px] font-bold leading-relaxed">
            {language === 'en'
              ? 'New here? Starting with Kakao creates your account right away.'
              : '처음이신가요? 카카오로 시작하면 바로 가입돼요.'}
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
