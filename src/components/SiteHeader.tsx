
import React from 'react';

interface HeaderProps {
  onNavigateHome: () => void;
  onNavigateSignup: () => void;
  onNavigateLogin: () => void;
  onNavigateDashboard: () => void;
  onLogout: () => void;
  isLoggedIn?: boolean;
}

const SiteHeader: React.FC<HeaderProps> = ({ 
  onNavigateHome, 
  onNavigateLogin,
  onNavigateDashboard,
  onLogout,
  isLoggedIn 
}) => {
  return (
    <header className="fixed top-0 left-0 w-full h-16 md:h-[4.5rem] z-[1000] bg-gradient-to-r from-[#1e3a8a]/90 via-blue-primary/85 to-blue-secondary/85 backdrop-blur-2xl border-b border-blue-secondary/30 flex items-center justify-between px-4 md:px-12 transition-all">
      <div
        className="text-2xl md:text-2xl font-black text-white tracking-tighter cursor-pointer flex items-center font-display"
        onClick={onNavigateHome}
      >
        PICKS
      </div>

      <nav className="hidden md:flex items-center space-x-6 text-sm font-bold text-blue-100 uppercase tracking-widest">
        {isLoggedIn ? (
          <>
            <button
              onClick={onNavigateDashboard}
              className="bg-white/5 hover:bg-white/10 text-white px-6 py-2.5 rounded-full transition-all active:scale-95 font-bold border border-white/10 text-sm"
            >
              대시보드
            </button>
            <button
              type="button"
              onClick={() => {
                console.log('Header logout button clicked');
                onLogout();
              }}
              className="bg-white hover:opacity-90 text-blue-primary px-6 py-2.5 rounded-full transition-all active:scale-95 font-bold shadow-lg shadow-blue-900/20 cursor-pointer text-sm"
            >
              로그아웃
            </button>
          </>
        ) : (
          <button
            onClick={onNavigateLogin}
            className="bg-white hover:opacity-90 text-blue-primary px-6 py-2.5 rounded-full transition-all active:scale-95 font-bold shadow-lg shadow-blue-900/20 text-sm"
          >
            로그인
          </button>
        )}
      </nav>

      <div className="md:hidden flex items-center gap-2">
        {isLoggedIn ? (
          <>
            <button 
              onClick={onNavigateDashboard}
              className="text-white px-4 py-2.5 rounded-full text-sm font-bold uppercase tracking-widest bg-white/5 border border-white/10"
            >
              대시보드
            </button>
            <button 
              type="button"
              onClick={() => {
                console.log('Mobile header logout button clicked');
                onLogout();
              }}
              className="bg-white text-blue-primary px-5 py-2.5 rounded-full text-sm font-bold uppercase tracking-widest cursor-pointer"
            >
              로그아웃
            </button>
          </>
        ) : (
          <button
            onClick={onNavigateLogin}
            className="bg-white text-blue-primary px-7 py-2.5 rounded-full text-sm font-bold uppercase tracking-widest"
          >
            로그인
          </button>
        )}
      </div>
    </header>
  );
};

export default SiteHeader;
