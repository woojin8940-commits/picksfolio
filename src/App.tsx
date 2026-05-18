
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
import ErrorBoundary from './components/ErrorBoundary';
import { supabase } from './services/supabase';

type View = 'home' | 'signup' | 'login' | 'admin' | 'user-page' | 'business-signup' | 'business-login';
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

        if (view === 'login' || view === 'signup') {
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
      else if (path === 'business-signup') setView('business-signup');
      else if (path === 'business-login') setView('business-login');
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
              <div className="container mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
                <div className="text-2xl font-black text-white font-display">PICKS</div>
                <div className="text-slate-500 text-sm font-medium">
                  © 2026 PICKS. All rights reserved.
                </div>
                <div className="flex gap-8 text-slate-400 text-sm font-bold uppercase tracking-widest">
                  <a href="#" className="hover:text-white transition-colors">Privacy</a>
                  <a href="#" className="hover:text-white transition-colors">Terms</a>
                  <a href="#" className="hover:text-white transition-colors">Contact</a>
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
