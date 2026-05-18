
import React, { useState, useEffect } from 'react';
import SiteHeader from './components/SiteHeader';
import Hero from './components/Hero';
import TemplateShowcase from './components/TemplateShowcase';
import DataBoardSection from './components/DataBoardSection';
import SignupPage from './components/SignupPage';
import LoginPage from './components/LoginPage';
import AdminDashboard from './components/AdminDashboard';
import UserPage from './components/UserPage';
import LinkManagement from './components/LinkManagement';
import AITrendAnalysis from './components/AITrendAnalysis';
import DMAutomation from './components/DMAutomation';
import PortfolioManagement from './components/PortfolioManagement';
import LiveCommerceManagement from './components/LiveCommerceManagement';
import BusinessSignupPage from './components/BusinessSignupPage';
import BusinessLoginPage from './components/BusinessLoginPage';
import BusinessInbox from './components/BusinessInbox';
import CollabCalendar from './components/CollabCalendar';
import SettlementManagement from './components/SettlementManagement';
import MembershipPage from './components/MembershipPage';
import SettingsPage from './components/SettingsPage';
import ErrorBoundary from './components/ErrorBoundary';
import { supabase } from './services/supabase';

type View = 'home' | 'signup' | 'login' | 'admin' | 'user-page' | 'business-signup' | 'business-login' | 'auth-callback' | 'membership' | 'settings';
type SubView = 'dashboard' | 'links' | 'trend' | 'dm' | 'portfolio' | 'live' | 'business' | 'calendar' | 'settlement';

const App: React.FC = () => {
  const [view, setView] = useState<View>('home');
  const [subView, setSubView] = useState<SubView>('dashboard');
  const [targetUser, setTargetUser] = useState('');
  const [initialId, setInitialId] = useState('');
  const [userName, setUserName] = useState(() => localStorage.getItem('picks_user_session') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('picks_user_session'));

  // Supabase Auth Listener
  useEffect(() => {
    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user && supabase) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', session.user.id)
          .maybeSingle();

        const userId = profileData?.username || session.user.email?.split('@')[0] || 'user';
        setUserName(userId);
        setIsLoggedIn(true);

        if (view === 'login' || view === 'signup' || view === 'auth-callback') {
          navigate('admin');
        }
      } else if (event === 'SIGNED_OUT') {
        setIsLoggedIn(false);
        setUserName('');
        if (view === 'admin') {
          navigate('home');
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [view]);

  // Persistent auto-logout after 2 hours of inactivity
  useEffect(() => {
    if (!isLoggedIn) return;

    const INACTIVITY_LIMIT = 2 * 60 * 60 * 1000;

    const checkInactivity = () => {
      const lastActivity = localStorage.getItem('picks_last_activity');
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity, 10);
        if (elapsed > INACTIVITY_LIMIT) {
          handleLogout();
          return true;
        }
      }
      return false;
    };

    const updateActivity = () => {
      localStorage.setItem('picks_last_activity', Date.now().toString());
    };

    checkInactivity();
    updateActivity();

    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(event => window.addEventListener(event, updateActivity));

    const interval = setInterval(checkInactivity, 60000);

    return () => {
      activityEvents.forEach(event => window.removeEventListener(event, updateActivity));
      clearInterval(interval);
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (isLoggedIn && userName) {
      localStorage.setItem('picks_user_session', userName);
    } else if (!isLoggedIn) {
      localStorage.removeItem('picks_user_session');
      localStorage.removeItem('picks_last_activity');
    }
  }, [isLoggedIn, userName]);

  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname.replace('/', '');
      if (!path) setView('home');
      else if (path === 'auth-callback') handleAuthCallback();
      else if (path === 'business-signup') setView('business-signup');
      else if (path === 'business-login') setView('business-login');
      else if (path === 'membership') setView('membership');
      else if (path === 'settings') setView('settings');
      else if (['signup', 'login', 'admin'].includes(path)) setView(path as View);
      else {
        setTargetUser(path);
        setView('user-page');
      }
    };
    window.addEventListener('popstate', handleLocationChange);
    handleLocationChange();
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const handleAuthCallback = async () => {
    setView('auth-callback');

    if (!supabase) {
      navigate('login');
      return;
    }

    try {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        console.warn('[Auth] No session found in callback, redirecting to login');
        navigate('login');
        return;
      }

      const user = session.user;
      const provider = user.app_metadata?.provider;

      if (provider === 'kakao') {
        const kakaoMeta = user.user_metadata || {};
        const kakaoId = user.id;
        const kakaoName = kakaoMeta.full_name || kakaoMeta.name || '';
        const kakaoPhone = kakaoMeta.phone || '';
        const kakaoEmail = user.email || '';

        localStorage.setItem('picks_kakao_user', JSON.stringify({
          id: kakaoId,
          name: kakaoName,
          phone: kakaoPhone,
          email: kakaoEmail,
        }));

        try {
          const res = await fetch('/.netlify/functions/kakao-profile-setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kakao_id: kakaoId,
              kakao_name: kakaoName,
              kakao_phone: kakaoPhone,
              email: kakaoEmail,
              access_token: session.access_token,
              refresh_token: session.refresh_token,
              provider_token: session.provider_token,
            }),
          });

          if (res.ok) {
            const profileData = await res.json();
            const userId = profileData.username || kakaoName || kakaoEmail?.split('@')[0] || 'user';
            setUserName(userId);
            setIsLoggedIn(true);
            localStorage.setItem('picks_user_session', userId);
            navigate('admin');
            return;
          }
        } catch (err) {
          console.error('[UserPage] kakao-profile-setup fallback failed:', err);
        }
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .maybeSingle();

      const userId = profileData?.username || user.email?.split('@')[0] || 'user';
      setUserName(userId);
      setIsLoggedIn(true);
      localStorage.setItem('picks_user_session', userId);
      navigate('admin');
    } catch (err) {
      console.error('[Auth] Callback error:', err);
      navigate('login');
    }
  };

  const navigate = (newView: View, param?: string) => {
    let path = '/';
    if (newView === 'user-page' && param) {
      path = `/${param}`;
      setTargetUser(param);
    } else if (newView !== 'home') {
      path = `/${newView}`;
    }
    setView(newView);
    window.history.pushState(null, '', path);
    window.scrollTo(0, 0);
  };

  const handleLogout = async () => {
    setIsLoggedIn(false);
    setUserName('');
    localStorage.clear();
    sessionStorage.clear();

    if (supabase) {
      supabase.auth.signOut()
        .then(() => console.log('Supabase signout successful'))
        .catch(err => console.warn('Supabase signout failed (ignoring):', err));
    }

    alert('정상적으로 로그아웃되었습니다.');

    const loginUrl = window.location.origin + '/login';
    window.location.href = loginUrl;
  };

  // KakaoTalk in-app browser detection
  useEffect(() => {
    const ua = navigator.userAgent || '';
    if (/KAKAOTALK/i.test(ua)) {
      const currentUrl = window.location.href;
      if ((window as any).location?.href && !sessionStorage.getItem('picks_kakao_redirect_done')) {
        sessionStorage.setItem('picks_kakao_redirect_done', 'true');
        window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(currentUrl)}`;
      }
    }
  }, []);

  if (view === 'auth-callback') {
    return (
      <div className="min-h-screen bg-midnight flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-6"></div>
          <p className="text-white font-bold text-lg">로그인 처리 중...</p>
          <p className="text-slate-400 text-sm mt-2">잠시만 기다려 주세요.</p>
        </div>
      </div>
    );
  }

  if (view === 'user-page') return <UserPage username={targetUser} />;

  if (view === 'business-signup') {
    return (
      <BusinessSignupPage
        onNavigateHome={() => navigate('home')}
        onNavigateLogin={() => navigate('business-login')}
        onNavigateInfluencerSignup={() => navigate('signup')}
        onSignupSuccess={() => navigate('business-login')}
      />
    );
  }

  if (view === 'business-login') {
    return (
      <BusinessLoginPage
        onNavigateHome={() => navigate('home')}
        onNavigateBusinessSignup={() => navigate('business-signup')}
        onLoginSuccess={(id, _companyName) => {
          setUserName(id);
          setIsLoggedIn(true);
          navigate('admin');
        }}
      />
    );
  }

  if (view === 'membership') {
    return (
      <MembershipPage
        userName={userName}
        isLoggedIn={isLoggedIn}
        onNavigateHome={() => navigate('home')}
        onNavigateLogin={() => navigate('login')}
        onNavigateBack={() => navigate('admin')}
      />
    );
  }

  if (view === 'settings') {
    return (
      <SettingsPage
        userName={userName}
        onNavigateBack={() => navigate('admin')}
        onNavigateMembership={() => navigate('membership')}
        onLogout={handleLogout}
      />
    );
  }

  if (view === 'admin') {
    let subComponent: React.ReactNode = null;

    switch (subView) {
      case 'links':
        subComponent = <LinkManagement userName={userName} />;
        break;
      case 'trend':
        subComponent = <AITrendAnalysis userName={userName} />;
        break;
      case 'dm':
        subComponent = <DMAutomation userName={userName} />;
        break;
      case 'portfolio':
        subComponent = <PortfolioManagement userName={userName} />;
        break;
      case 'live':
        subComponent = <LiveCommerceManagement userName={userName} />;
        break;
      case 'business':
        subComponent = <BusinessInbox userName={userName} />;
        break;
      case 'calendar':
        subComponent = <CollabCalendar userName={userName} />;
        break;
      case 'settlement':
        subComponent = <SettlementManagement userName={userName} />;
        break;
      default:
        subComponent = null;
    }

    return (
      <AdminDashboard
        userName={userName}
        onLogout={handleLogout}
        currentSubView={subView}
        onNavigateDashboard={() => setSubView('dashboard')}
        onNavigateLinks={() => setSubView('links')}
        onNavigateTrend={() => setSubView('trend')}
        onNavigateDM={() => setSubView('dm')}
        onNavigatePortfolio={() => setSubView('portfolio')}
        onNavigateLive={() => setSubView('live')}
        onNavigateBusiness={() => setSubView('business')}
        onNavigateCalendar={() => setSubView('calendar')}
        onNavigateSettlement={() => setSubView('settlement')}
        onNavigateMembership={() => navigate('membership')}
        onNavigateSettings={() => navigate('settings')}
      >
        {subComponent ? (
          <ErrorBoundary key={subView}>
            {subComponent}
          </ErrorBoundary>
        ) : null}
      </AdminDashboard>
    );
  }

  return (
    <div className="min-h-screen bg-background selection:bg-purple-primary/30">
      <SiteHeader
        onNavigateHome={() => navigate('home')}
        onNavigateSignup={() => navigate('signup')}
        onNavigateLogin={() => navigate('login')}
        onNavigateDashboard={() => navigate('admin')}
        onLogout={handleLogout}
        isLoggedIn={isLoggedIn}
      />
      <main>
        {view === 'home' ? (
          <>
            <Hero onSignup={(id) => { setInitialId(id); navigate('signup'); }} />
            <TemplateShowcase onSignup={() => navigate('signup')} userName={userName} />
            <DataBoardSection />

            {/* Footer */}
            <footer className="py-20 border-t border-white/5 bg-background">
              <div className="container mx-auto px-6">
                <div className="flex flex-col md:flex-row justify-between items-start gap-12 mb-12">
                  <div>
                    <div className="text-2xl font-black text-white font-display mb-3">PICKS</div>
                    <p className="text-slate-500 text-xs font-medium leading-relaxed max-w-xs">
                      픽스폴리오(Picksfolio)<br />
                      일상을 큐레이션하고 스타일을 연결하는 소셜 커머스 링크 플랫폼.
                    </p>
                    <p className="text-slate-600 text-[10px] font-medium mt-3">admin@picks.me</p>
                  </div>
                  <div className="flex gap-12 text-sm">
                    <div>
                      <h4 className="text-white text-[10px] font-black uppercase tracking-widest mb-4">Legal</h4>
                      <ul className="space-y-3">
                        <li><a href="/privacy" className="text-slate-500 hover:text-white text-[11px] font-bold transition-colors">개인정보처리방침</a></li>
                        <li><a href="/terms" className="text-slate-500 hover:text-white text-[11px] font-bold transition-colors">이용약관</a></li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-white text-[10px] font-black uppercase tracking-widest mb-4">Platform</h4>
                      <ul className="space-y-3">
                        <li><a href="#" className="text-slate-500 hover:text-white text-[11px] font-bold transition-colors">Templates</a></li>
                        <li><a href="#" className="text-slate-500 hover:text-white text-[11px] font-bold transition-colors">AI Scout</a></li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-white text-[10px] font-black uppercase tracking-widest mb-4">Company</h4>
                      <ul className="space-y-3">
                        <li><a href="#" className="text-slate-500 hover:text-white text-[11px] font-bold transition-colors">About Us</a></li>
                        <li><a href="#" className="text-slate-500 hover:text-white text-[11px] font-bold transition-colors">Press Kit</a></li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
                  <div className="text-slate-600 text-[11px] font-medium">
                    © 2026 Picksfolio. All rights reserved.
                  </div>
                  <div className="flex gap-6 text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                    <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
                    <a href="/terms" className="hover:text-white transition-colors">Terms</a>
                    <a href="#" className="hover:text-white transition-colors">Contact</a>
                  </div>
                </div>
              </div>
            </footer>
          </>
        ) : view === 'signup' ? (
          <SignupPage
            initialId={initialId}
            onNavigateHome={() => navigate('home')}
            onNavigateLogin={() => navigate('login')}
            onSignupSuccess={() => navigate('login')}
          />
        ) : (
          <LoginPage
            onNavigateHome={() => navigate('home')}
            onNavigateSignup={() => navigate('signup')}
            onNavigateBusinessLogin={() => navigate('business-login')}
            onLoginSuccess={(id) => {
              setUserName(id);
              setIsLoggedIn(true);
              navigate('admin');
            }}
          />
        )}
      </main>
    </div>
  );
};

export default App;
