
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
import ErrorBoundary from './components/ErrorBoundary';
import { supabase } from './services/supabase';

type View = 'home' | 'signup' | 'login' | 'admin' | 'user-page';
type SubView = 'dashboard' | 'links' | 'trend' | 'dm' | 'portfolio' | 'live';

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
        // Fetch profile to get the username
        const { data: profileData } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', session.user.id)
          .maybeSingle();
        
        const userId = profileData?.username || session.user.email?.split('@')[0] || 'user';
        setUserName(userId);
        setIsLoggedIn(true);
        
        // If we are on login or signup page, force navigate to admin
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
  }, [view]); // Add view to dependencies to handle redirection correctly

  // Persistent auto-logout after 2 hours of inactivity
  useEffect(() => {
    if (!isLoggedIn) return;

    const INACTIVITY_LIMIT = 2 * 60 * 60 * 1000; // 2 hours
    
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

    // Check immediately on mount/login
    checkInactivity();
    updateActivity();

    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(event => window.addEventListener(event, updateActivity));

    // Check periodically for open tabs
    const interval = setInterval(checkInactivity, 60000); // Every minute

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
    console.log('Logout process started...');
    
    // 1. Immediate local cleanup
    setIsLoggedIn(false);
    setUserName('');
    localStorage.clear();
    sessionStorage.clear();
    console.log('Local storage and state cleared');

    // 2. Background signout (don't await to prevent hanging)
    if (supabase) {
      supabase.auth.signOut()
        .then(() => console.log('Supabase signout successful'))
        .catch(err => console.warn('Supabase signout failed (ignoring):', err));
    }

    // 3. Immediate feedback
    alert('정상적으로 로그아웃되었습니다.');
    
    // 4. Force hard redirect using absolute URL
    const loginUrl = window.location.origin + '/login';
    console.log('Redirecting to:', loginUrl);
    window.location.href = loginUrl;
  };

  if (view === 'user-page') return <UserPage username={targetUser} />;
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
      default:
        subComponent = null; // AdminDashboard will show default dashboard if children is null
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
