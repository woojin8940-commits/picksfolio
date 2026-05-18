import React, { useState } from 'react';

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
  onNavigateSignup,
  onNavigateLogin,
  onNavigateDashboard,
  onLogout,
  isLoggedIn
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 w-full h-16 md:h-20 z-[1000] bg-background/80 backdrop-blur-2xl border-b border-white/5 flex items-center justify-between px-4 md:px-12 transition-all">
        <div
          className="text-xl md:text-2xl font-black text-purple-primary tracking-tighter cursor-pointer flex items-center font-display"
          onClick={onNavigateHome}
        >
          PICKS
        </div>

        <nav className="hidden md:flex items-center space-x-4 text-[13px] font-bold text-slate-400 uppercase tracking-widest">
          {isLoggedIn ? (
            <>
              <button
                onClick={onNavigateDashboard}
                className="bg-white/5 hover:bg-white/10 text-white px-6 py-2.5 rounded-full transition-all active:scale-95 font-bold border border-white/10"
              >
                대시보드
              </button>
              <button
                type="button"
                onClick={() => {
                  console.log('Header logout button clicked');
                  onLogout();
                }}
                className="bg-gradient-to-r from-purple-primary to-purple-secondary hover:opacity-90 text-white px-6 py-2.5 rounded-full transition-all active:scale-95 font-bold shadow-lg shadow-purple-500/20 cursor-pointer"
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onNavigateLogin}
                className="text-slate-400 hover:text-white px-4 py-2.5 rounded-full transition-all font-bold"
              >
                로그인
              </button>
              <button
                onClick={onNavigateSignup}
                className="bg-gradient-to-r from-purple-primary to-purple-secondary hover:opacity-90 text-white px-6 py-2.5 rounded-full transition-all active:scale-95 font-bold shadow-lg shadow-purple-500/20"
              >
                무료로 시작하기
              </button>
            </>
          )}
        </nav>

        <div className="md:hidden flex items-center gap-2">
          {isLoggedIn ? (
            <>
              <button
                onClick={onNavigateDashboard}
                className="text-white px-3 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest bg-white/5 border border-white/10"
              >
                대시보드
              </button>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="text-white p-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16m-7 6h7" />
                  )}
                </svg>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onNavigateLogin}
                className="text-slate-400 px-3 py-2 rounded-full text-[11px] font-bold"
              >
                로그인
              </button>
              <button
                onClick={onNavigateSignup}
                className="bg-purple-primary text-white px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest"
              >
                시작하기
              </button>
            </>
          )}
        </div>
      </header>

      {mobileMenuOpen && isLoggedIn && (
        <div className="md:hidden fixed inset-0 z-[999] animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}></div>
          <div className="absolute top-16 right-0 w-56 bg-[#0b1221] border border-white/10 rounded-bl-2xl shadow-2xl p-4 animate-in slide-in-from-top-2 duration-300">
            <div className="space-y-1">
              <button
                onClick={() => { onNavigateDashboard(); setMobileMenuOpen(false); }}
                className="w-full text-left text-white font-bold text-sm px-4 py-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                대시보드
              </button>
              <div className="border-t border-white/5 my-2"></div>
              <button
                type="button"
                onClick={() => {
                  console.log('Mobile header logout button clicked');
                  setMobileMenuOpen(false);
                  onLogout();
                }}
                className="w-full text-left text-rose-400 font-bold text-sm px-4 py-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SiteHeader;
