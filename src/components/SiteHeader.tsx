import React from 'react';
import LanguageSwitcher from './LanguageSwitcher';
import { useLanguage } from '../contexts/LanguageContext';

interface HeaderProps {
  onNavigateHome: () => void;
  onNavigateSignup: () => void;
  onNavigateLogin: () => void;
  onNavigateDashboard: () => void;
  onLogout: () => void;
  isLoggedIn?: boolean;
  /**
   * 'light' 는 홈(마케팅) 화면 전용이다. 홈은 종이색 배경이라 기존의 파란
   * 그라데이션 바가 그 위에 얹히면 화면 맨 위에 짙은 띠 하나만 남는다.
   * 로그인·가입 등 다크로 남는 화면은 'dark' 를 그대로 쓴다.
   */
  variant?: 'dark' | 'light';
}

const SiteHeader: React.FC<HeaderProps> = ({
  onNavigateHome,
  onNavigateLogin,
  onNavigateDashboard,
  onLogout,
  isLoggedIn,
  variant = 'dark',
}) => {
  const { t } = useLanguage();
  const isLight = variant === 'light';

  const shell = isLight
    ? 'bg-[#F4F5FA]/85 backdrop-blur-xl border-b border-[#0B0F1A]/[0.07]'
    : 'bg-gradient-to-r from-[#1e3a8a]/90 via-blue-primary/85 to-blue-secondary/85 backdrop-blur-2xl border-b border-blue-secondary/30';

  const primaryBtn = isLight
    ? 'bg-[#2563EB] text-white hover:bg-[#1d4ed8] shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)]'
    : 'bg-white text-blue-primary hover:opacity-90 shadow-lg shadow-blue-900/20';

  const ghostBtn = isLight
    ? 'bg-white text-[#0B0F1A] border border-[#0B0F1A]/10 hover:border-[#0B0F1A]/25 shadow-sm'
    : 'bg-white/5 hover:bg-white/10 text-white border border-white/10';

  const langClass = isLight
    ? 'bg-white text-[#39415C] border-[#0B0F1A]/10 hover:text-[#0B0F1A]'
    : undefined;

  return (
    <header
      className={`fixed top-0 left-0 w-full h-14 md:h-[4.5rem] z-[1000] flex items-center justify-between px-4 md:px-12 transition-all ${shell}`}
    >
      <div
        className={`text-xl md:text-2xl font-black tracking-tighter cursor-pointer flex items-center gap-2 font-display ${isLight ? 'text-[#0B0F1A]' : 'text-white'}`}
        onClick={onNavigateHome}
      >
        PICKS
        {isLight && <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] translate-y-1" />}
      </div>

      <nav
        className={`hidden md:flex items-center space-x-4 text-sm font-bold uppercase tracking-widest ${isLight ? 'text-[#39415C]' : 'text-blue-100'}`}
      >
        {isLoggedIn ? (
          <>
            <button
              onClick={onNavigateDashboard}
              className={`px-6 py-2.5 rounded-full transition-all active:scale-95 font-bold text-sm ${ghostBtn}`}
            >
              {t('nav.dashboard', '대시보드', 'Dashboard')}
            </button>
            <button
              type="button"
              onClick={() => {
                console.log('Header logout button clicked');
                onLogout();
              }}
              className={`px-6 py-2.5 rounded-full transition-all active:scale-95 font-bold cursor-pointer text-sm ${primaryBtn}`}
            >
              {t('nav.logout', '로그아웃', 'Log Out')}
            </button>
          </>
        ) : (
          <button
            onClick={onNavigateLogin}
            className={`px-6 py-2.5 rounded-full transition-all active:scale-95 font-bold text-sm ${primaryBtn}`}
          >
            {t('nav.login', '로그인', 'Log In')}
          </button>
        )}
        {/* 종이색 헤더에서는 흰 글씨 토글이 보이지 않는다. compact 판에 밝은
            색을 넘겨 같은 자리에 그린다. */}
        <LanguageSwitcher variant={isLight ? 'compact' : 'header'} className={langClass} />
      </nav>

      <div className="md:hidden flex items-center gap-2">
        {isLoggedIn ? (
          <>
            <button
              onClick={onNavigateDashboard}
              className={`px-3 py-2 rounded-full text-xs font-bold uppercase tracking-widest ${ghostBtn}`}
            >
              {t('nav.dashboard', '대시보드', 'Dashboard')}
            </button>
            <button
              type="button"
              onClick={() => {
                console.log('Mobile header logout button clicked');
                onLogout();
              }}
              className={`px-3.5 py-2 rounded-full text-xs font-bold uppercase tracking-widest cursor-pointer ${primaryBtn}`}
            >
              {t('nav.logout', '로그아웃', 'Log Out')}
            </button>
          </>
        ) : (
          <button
            onClick={onNavigateLogin}
            className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest ${primaryBtn}`}
          >
            {t('nav.login', '로그인', 'Log In')}
          </button>
        )}
        <LanguageSwitcher variant="compact" className={langClass} />
      </div>
    </header>
  );
};

export default SiteHeader;
