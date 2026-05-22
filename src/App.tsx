
import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import SiteHeader from './components/SiteHeader';
import Hero from './components/Hero';
import TemplateShowcase from './components/TemplateShowcase';
import DataBoardSection from './components/DataBoardSection';
import SignupPage from './components/SignupPage';
import LoginPage from './components/LoginPage';
import AdminDashboard from './components/AdminDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import Footer from './components/Footer';
import { supabase, withTimeout, safeFetchProfile } from './services/supabase';

const UserPage = lazy(() => import('./components/UserPage'));
const LinkManagement = lazy(() => import('./components/LinkManagement'));
const PortfolioManagement = lazy(() => import('./components/PortfolioManagement'));
const LiveCommerceManagement = lazy(() => import('./components/LiveCommerceManagement'));
const BroadcastSettings = lazy(() => import('./components/BroadcastSettings'));
const BroadcastHistory = lazy(() => import('./components/BroadcastHistory'));
const BusinessProposalForm = lazy(() => import('./components/BusinessProposalForm'));
const BusinessDashboard = lazy(() => import('./components/BusinessDashboard'));
const BusinessCalendar = lazy(() => import('./components/BusinessCalendar'));
const OpenScheduleManagement = lazy(() => import('./components/OpenScheduleManagement'));
const UserCampaignBrowse = lazy(() => import('./components/UserCampaignBrowse'));
const MembershipPlan = lazy(() => import('./components/MembershipPlan'));
const OperatorLogin = lazy(() => import('./components/OperatorLogin'));
const OperatorDashboard = lazy(() => import('./components/OperatorDashboard'));
const SetupLink = lazy(() => import('./components/SetupLink'));
const TermsOfService = lazy(() => import('./components/TermsOfService'));
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy'));
const BusinessSignupPage = lazy(() => import('./components/BusinessSignupPage'));
const BusinessLoginPage = lazy(() => import('./components/BusinessLoginPage'));
const BusinessEnterpriseDashboard = lazy(() => import('./components/BusinessEnterpriseDashboard'));
const UserSettlement = lazy(() => import('./components/UserSettlement'));
const BusinessTimeline = lazy(() => import('./components/BusinessTimeline'));
import { apiService } from './services/apiService';
import { clearAllLinkCache } from './services/prefetchService';

type View = 'home' | 'signup' | 'login' | 'admin' | 'user-page' | 'setup-link' | 'proposal' | 'operator' | 'operator-login' | 'terms' | 'privacy' | 'business-signup' | 'business-login' | 'business-admin';
type SubView = 'dashboard' | 'links' | 'portfolio' | 'live' | 'broadcast-settings' | 'broadcast-history' | 'business' | 'calendar' | 'membership' | 'open-schedule' | 'settlement' | 'timeline' | 'campaigns';

const LazyFallback = () => (
  <div className="flex items-center justify-center min-h-[40vh]">
    <div className="text-center animate-in fade-in duration-300">
      <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
      <p className="text-slate-400 font-semibold text-xs">로딩 중...</p>
    </div>
  </div>
);

const App: React.FC = () => {
  const [view, setView] = useState<View>('home');
  const [subView, setSubView] = useState<SubView>('dashboard');
  const [targetUser, setTargetUser] = useState('');
  const [initialId, setInitialId] = useState('');
  const [userName, setUserName] = useState(() => localStorage.getItem('picks_user_session') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('picks_user_session'));
  const [authUserId, setAuthUserId] = useState<string>('');

  // Business account state
  const [businessUsername, setBusinessUsername] = useState(() => localStorage.getItem('picks_business_session') || '');
  const [businessCompanyName, setBusinessCompanyName] = useState(() => localStorage.getItem('picks_business_company') || '');
  const [isBusinessLoggedIn, setIsBusinessLoggedIn] = useState(() => !!localStorage.getItem('picks_business_session'));
  const viewRef = useRef<View>(view);
  const userNameRef = useRef<string>(userName);
  const loginNavigationHandledRef = useRef<boolean>(false);

  // Track whether this page load involves a fresh OAuth callback (code or access_token in URL).
  // Used to prevent stale sessions from auto-redirecting to setup-link on the login page.
  const isOAuthCallbackRef = useRef<boolean>(
    !!new URLSearchParams(window.location.search).get('code') || window.location.hash.includes('access_token')
  );

  // profileChecked: true once we've verified the user's profile from Supabase.
  // While false, protected views show a loading spinner.
  // For returning users with a cached session (not an OAuth callback), skip the
  // blocking check — the profile will be verified in the background.
  const [profileChecked, setProfileChecked] = useState(() => {
    const hasCache = !!localStorage.getItem('picks_user_session');
    const params = new URLSearchParams(window.location.search);
    const isOAuthCallback = !!params.get('code') || window.location.hash.includes('access_token');
    return hasCache && !isOAuthCallback;
  });

  // Track the user's role from the Supabase profile (e.g. 'user', 'admin')
  const [, setProfileRole] = useState<string>('');

  // loginTransitioning: true during the brief period between login success and admin dashboard ready.
  // Shows a smooth loading screen instead of a blank/flickering dashboard.
  const [loginTransitioning, setLoginTransitioning] = useState(false);


  // oauthProcessing: true while an OAuth callback (e.g. Kakao) is being processed.
  // Shows a loading screen on the login page instead of the form.
  const [oauthProcessing, setOauthProcessing] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const hasCode = !!params.get('code');
    const hasHashToken = window.location.hash.includes('access_token');
    return hasCode || hasHashToken;
  });

  // Keep refs in sync
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { userNameRef.current = userName; }, [userName]);

  // Views that are considered "settled" — user should NOT be kicked out of these
  const settledViews: View[] = ['admin', 'operator', 'operator-login', 'user-page', 'setup-link', 'business-admin'];

  // Determine if the current view is appropriate for the user's role.
  // Returns true if the user should stay on the current view (no redirect needed).
  const isViewValidForRole = (currentView: View, role: string): boolean => {
    // Operator/admin views: only valid for admin role
    if (currentView === 'operator' || currentView === 'operator-login') {
      return role === 'admin';
    }
    // Admin dashboard: valid for any logged-in user
    if (currentView === 'admin') return true;
    // Setup-link: valid for users without a username (handled separately)
    if (currentView === 'setup-link') return true;
    // User-page: always valid (public)
    if (currentView === 'user-page') return true;
    // Proposal: always valid (public)
    if (currentView === 'proposal') return true;
    return false;
  };

  // Supabase Auth Listener
  useEffect(() => {
    if (!supabase) {
      console.warn('[App] Supabase 클라이언트가 null입니다. 환경 변수가 설정되지 않아 데모 모드로 실행합니다.');
      setProfileChecked(true);
      return;
    }

    // Flag to prevent double-processing between initAuth and onAuthStateChange
    let sessionProcessed = false;
    // Flag to track if OAuth callback has completed (to prevent processUserSession
    // from running before provider_token is captured)
    let oauthCallbackComplete = false;
    // Capture provider_token from exchangeCodeForSession — the onAuthStateChange callback
    // and getSession() may NOT include it, but the server needs it to call the Kakao API
    // directly (Supabase GoTrue doesn't forward phone_number/name to user_metadata).
    // Store in both a local variable AND sessionStorage so it survives async race conditions.
    let capturedProviderToken: string | null = sessionStorage.getItem('kakao_provider_token');

    // Handle PKCE OAuth callback: explicitly exchange the code for a session
    // OR detect implicit grant hash fragment (#access_token) from Supabase
    const handleOAuthCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const hashFragment = window.location.hash;
      const hasHashToken = hashFragment.includes('access_token');

      // === URL 파라미터 점검 ===
      if (code) console.log('[Auth] OAuth code 파라미터 감지');
      if (hasHashToken) console.log('[Auth] Hash fragment access_token 감지');

      // If #access_token is in the URL, Supabase has already completed the OAuth flow
      // via implicit grant. detectSessionInUrl: true will parse the hash automatically.
      // We just need to wait for Supabase to process it — do NOT try to exchange a code.
      if (hasHashToken) {
        console.log('[Auth] Hash fragment에 access_token 감지 — Supabase가 세션을 자동 파싱하도록 대기합니다.');
        // Give Supabase time to parse the hash fragment and establish the session
        await new Promise(r => setTimeout(r, 1500));
        // Clean the hash from the URL after Supabase has had time to read it
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        console.log('[Auth] Hash fragment 대기 완료, URL 정리됨.');
        oauthCallbackComplete = true;
        return;
      }

      if (code) {
        try {
          const { data: exchangeData, error } = await supabase!.auth.exchangeCodeForSession(code);
          if (exchangeData?.session) {
            // Capture provider_token for server-side Kakao API calls
            if (exchangeData.session.provider_token) {
              capturedProviderToken = exchangeData.session.provider_token;
              sessionStorage.setItem('kakao_provider_token', capturedProviderToken);
            }

            // === OIDC: id_token에서 사용자 정보 추출 ===
            // openid 스코프를 요청하면 Supabase가 카카오에서 id_token(JWT)을 받아옴.
            // id_token의 payload에 phone_number, name 등의 클레임이 포함됨.
            // 이 방식은 카카오 API를 직접 호출할 필요 없이 표준 OIDC로 사용자 정보를 얻음.
            const userMeta = exchangeData.session.user?.user_metadata || {};
            const identities = exchangeData.session.user?.identities || [];
            const kakaoIdentity = identities.find((i: any) => i.provider === 'kakao');
            const identityData = kakaoIdentity?.identity_data || {};

            // OIDC id_token 클레임은 user_metadata 및 identity_data에 반영됨
            // Supabase GoTrue가 id_token을 파싱하여 user_metadata에 저장함
            const oidcPhone = userMeta.phone_number || identityData.phone_number
              || userMeta.kakao_account?.phone_number || identityData.kakao_account?.phone_number || '';
            const oidcName = userMeta.name || identityData.name
              || userMeta.kakao_account?.name || identityData.kakao_account?.name
              || userMeta.full_name || identityData.full_name || '';

            if (oidcPhone) {
              sessionStorage.setItem('kakao_client_phone', oidcPhone);
            }
            if (oidcName) {
              sessionStorage.setItem('kakao_client_name', oidcName);
            }

            if (!oidcPhone) {
              // 서버 kakao-profile-setup에서 카카오 API 폴백 예정
            }
          }
          console.log('[Auth] === OAuth 코드 교환 결과 끝 ===');
          if (error) {
            console.error('[Auth] OAuth code exchange failed:', error.message);
            alert('카카오 로그인 처리 중 오류가 발생했습니다. 다시 시도해 주세요.');
            setOauthProcessing(false);
          }
        } catch (e) {
          console.error('[Auth] OAuth callback error:', e);
          alert('카카오 로그인 중 오류가 발생했습니다. 다시 시도해 주세요.');
          setOauthProcessing(false);
        } finally {
          // Always clean up the URL (remove ?code=... from address bar)
          const cleanUrl = window.location.pathname + window.location.hash;
          window.history.replaceState(null, '', cleanUrl);
        }
      }
      oauthCallbackComplete = true;
    };

    // Process a signed-in user session (shared logic for all auth events).
    // IMPORTANT: This function ALWAYS checks the Supabase profile before deciding
    // whether to show setup-link or admin. It sets profileChecked=true when done,
    // which unblocks the setup-link render gate.
    const processUserSession = async (event: string, session: any) => {
      if (!session?.user || !supabase) return;
      if (sessionProcessed) return;
      sessionProcessed = true;

      // If OAuth callback hasn't completed yet (onAuthStateChange fired early),
      // wait for the FULL OAuth callback to finish — including the client-side
      // Kakao API call that fetches phone_number. Previously we broke out of this
      // loop as soon as capturedProviderToken was set, but that was BEFORE the
      // Kakao API call completed, causing client_kakao_phone to always be empty.
      const isKakaoProvider = session.user.app_metadata?.provider === 'kakao';
      if (isKakaoProvider && !oauthCallbackComplete) {
        for (let i = 0; i < 25; i++) {
          await new Promise(r => setTimeout(r, 200));
          if (oauthCallbackComplete) break;
        }
        // Re-read from sessionStorage in case it was set during the wait
        if (!capturedProviderToken) {
          capturedProviderToken = sessionStorage.getItem('kakao_provider_token');
        }
      }

      const uid = session.user.id;
      setAuthUserId(uid);
      setProfileChecked(false); // Start profile verification

      // NON-BLOCKING profile fetch: Use safeFetchProfile with 5s timeout.
      // If the fetch fails or times out, immediately proceed with a fallback
      // (localStorage username or 'Anonymous') so broadcasting/signaling is
      // never delayed. A background retry will update the profile later.
      const fallbackUsername = localStorage.getItem('picks_user_session') || '';
      let profileData: any = await safeFetchProfile(uid, {
        timeoutMs: 5000,
        defaultValue: null,
        onSuccess: (latestProfile: any) => {
          // Background retry succeeded — update UI state with fresh profile data
          console.log('[Auth] Background profile retry succeeded:', latestProfile?.username);
          if (latestProfile?.username) {
            setUserName(latestProfile.username);
            localStorage.setItem('picks_user_session', latestProfile.username);
          }
          if (latestProfile?.role === 'admin') {
            setProfileRole('admin');
          }
        },
        maxRetries: 3,
        retryDelayMs: 3000,
      });

      // If initial fetch returned null, use fallback immediately without blocking
      if (!profileData && fallbackUsername) {
        console.log('[Auth] Profile fetch returned null, using localStorage fallback immediately:', fallbackUsername);
        profileData = { username: fallbackUsername, _fallback: true };
      }

      console.log('[Debug] Profile fetch result (non-blocking):', { profileData, fallback: !!profileData?._fallback });

      // Use server-side function to create/update Kakao profile.
      // OIDC 방식: id_token에서 추출된 클레임이 user_metadata에 포함되어 있으므로
      // 서버에서는 metadata + 클라이언트 캐시(sessionStorage)에서 정보를 추출함.
      const isKakaoUser = session.user.app_metadata?.provider === 'kakao'
        || session.user.identities?.some((i: any) => i.provider === 'kakao');

      if (isKakaoUser && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        const effectiveProviderToken = session.provider_token || capturedProviderToken || sessionStorage.getItem('kakao_provider_token') || '';
        // 클라이언트에서 캐시한 카카오 전화번호/이름 (handleOAuthCallback에서 직접 API 호출 결과)
        const clientKakaoPhone = sessionStorage.getItem('kakao_client_phone') || '';
        const clientKakaoName = sessionStorage.getItem('kakao_client_name') || '';
        // Clean up sessionStorage after use (one-time token)
        if (effectiveProviderToken) {
          sessionStorage.removeItem('kakao_provider_token');
        }
        sessionStorage.removeItem('kakao_client_phone');
        sessionStorage.removeItem('kakao_client_name');
        console.log('[Debug] Kakao user detected, calling server-side profile setup...');
        try {
          const setupController = new AbortController();
          const setupTimeout = setTimeout(() => setupController.abort(), 15000);
          const setupResponse = await fetch('/.netlify/functions/kakao-profile-setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: uid,
              user_metadata: session.user.user_metadata || {},
              identities: session.user.identities || [],
              email: session.user.email || '',
              provider_token: effectiveProviderToken,
              client_kakao_phone: clientKakaoPhone,
              client_kakao_name: clientKakaoName,
            }),
            signal: setupController.signal,
          });
          clearTimeout(setupTimeout);
          const setupResult = await setupResponse.json();

          if (setupResult.success && setupResult.profile) {
            profileData = {
              username: setupResult.profile.username || '',
              role: setupResult.profile.role || 'user',
              phone: setupResult.profile.phone || '',
              kakao_id: setupResult.profile.kakao_id || '',
              full_name: setupResult.profile.full_name || '',
              email: setupResult.profile.email || '',
              avatar_url: setupResult.profile.avatar_url || '',
            };
            // Persist username to localStorage immediately so it survives page reloads
            if (setupResult.profile.username) {
              localStorage.setItem('picks_user_session', setupResult.profile.username);
              console.log('[Auth] Kakao profile username persisted to localStorage:', setupResult.profile.username);
            }
          } else {
            console.error('[Debug] Server-side profile setup failed:', setupResult.error);
            // Use localStorage username as fallback when server call fails
            const savedUsername = localStorage.getItem('picks_user_session') || '';
            if (savedUsername) {
              profileData = { username: savedUsername, role: 'user' };
              console.log('[Auth] Using saved username from localStorage as fallback:', savedUsername);
            }
            console.log('[Auth] 서버 함수 실패 응답 — 5초 후 세션 강제 갱신 예약됨');
            setTimeout(async () => {
              try {
                console.log('[Auth] 5초 타임아웃: 서버 실패 후 세션 강제 갱신 시작...');
                const { data: refreshData } = await supabase!.auth.refreshSession();
                if (refreshData?.session) {
                  setAuthUserId(refreshData.session.user.id);
                  setIsLoggedIn(true);
                  setProfileChecked(true);
                  setOauthProcessing(false);
                  console.log('[Auth] 세션 강제 갱신 완료 — 로그인 상태 복원됨');
                }
              } catch (refreshErr) {
                console.error('[Auth] 세션 강제 갱신 실패:', refreshErr);
                setOauthProcessing(false);
                setProfileChecked(true);
              }
            }, 5000);
          }
        } catch (serverErr) {
          console.error('[Debug] Server-side profile setup call failed:', serverErr);
          // Use localStorage username as fallback when server call throws
          const savedUsernameOnErr = localStorage.getItem('picks_user_session') || '';
          if (savedUsernameOnErr && !profileData) {
            profileData = { username: savedUsernameOnErr, role: 'user' };
            console.log('[Auth] Using saved username from localStorage after server error:', savedUsernameOnErr);
          }
          console.log('[Auth] 서버 함수 에러 — 5초 후 세션 강제 갱신 예약됨');
          setTimeout(async () => {
            try {
              console.log('[Auth] 5초 타임아웃: 세션 강제 갱신 시작...');
              const { data: refreshData, error: refreshError } = await supabase!.auth.refreshSession();
              console.log('[Auth] 세션 강제 갱신 결과:', {
                success: !refreshError,
                hasSession: !!refreshData?.session,
                error: refreshError?.message,
              });
              if (refreshData?.session) {
                const refreshUid = refreshData.session.user.id;
                setAuthUserId(refreshUid);
                setIsLoggedIn(true);
                setProfileChecked(true);
                setOauthProcessing(false);
                const savedName = localStorage.getItem('picks_user_session') || '';
                if (savedName) {
                  setUserName(savedName);
                }
                console.log('[Auth] 세션 강제 갱신 완료 — 로그인 상태 복원됨');
              }
            } catch (refreshErr) {
              console.error('[Auth] 세션 강제 갱신 실패:', refreshErr);
              setOauthProcessing(false);
              setProfileChecked(true);
            }
          }, 5000);
          // Fallback: try client-side profile creation if server call fails
          if (!profileData) {
            console.log('[Debug] Falling back to client-side profile creation...');
            const meta = session.user.user_metadata || {};
            const kakaoIdentityForFallback = session.user.identities?.find((i: any) => i.provider === 'kakao');
            const idData = kakaoIdentityForFallback?.identity_data || {};
            const kakaoId = meta.provider_id || meta.sub || idData.sub || '';
            const finalKakaoId = kakaoId || kakaoIdentityForFallback?.id || '';
            // Extract phone: identity_data.kakao_account first, then meta paths
            const kakaoPhone = idData.kakao_account?.phone_number || idData.phone_number
              || meta.phone_number || meta.kakao_account?.phone_number || meta.phone || '';
            const normalizedPhone = kakaoPhone
              ? kakaoPhone.replace(/[^0-9+]/g, '').replace(/^\+82/, '0')
              : '';
            // Extract name with sanitization: skip "." or empty
            const rawNameFb = idData.kakao_account?.name || idData.name || idData.full_name
              || meta.full_name || meta.name || '';
            const sanitizedNameFb = (rawNameFb && rawNameFb.trim() !== '.' && rawNameFb.trim() !== '') ? rawNameFb.trim() : '';
            const profilePayload: Record<string, any> = {
              id: uid,
              username: '',
              email: session.user.email || '',
              full_name: sanitizedNameFb,
              avatar_url: meta.avatar_url || meta.picture || idData.avatar_url || '',
              kakao_id: finalKakaoId,
              phone: normalizedPhone || '',
              role: 'user',
            };
            try {
              const { error: insertError } = await supabase.from('profiles').insert(profilePayload);
              if (!insertError) {
                profileData = { username: '', role: 'user' };
              } else if (insertError.code === '23505') {
                const { data: refetchedProfile } = await supabase
                  .from('profiles')
                  .select('*')
                  .eq('id', uid)
                  .maybeSingle();
                if (refetchedProfile) profileData = refetchedProfile;
              }
            } catch (e) {
              console.error('[Debug] Client-side fallback also failed:', e);
            }
          }
        }
      } else if (!profileData && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        // Non-Kakao OAuth user with no profile — retry fetch and create if needed
        console.log('[Debug] No profile found, retrying once before auto-create...');
        await new Promise(r => setTimeout(r, 500));
        try {
          const { data: retryData } = await withTimeout(
            supabase
              .from('profiles')
              .select('*')
              .eq('id', uid)
              .maybeSingle(),
            5000,
            'processUserSession auto-create 전 재확인'
          );
          if (retryData) {
            profileData = retryData;
          } else {
            const profilePayload: Record<string, any> = {
              id: uid,
              username: '',
              email: session.user.email || '',
              role: 'user',
            };
            const { error: insertError } = await supabase.from('profiles').insert(profilePayload);
            if (!insertError) {
              profileData = { username: '', role: 'user' };
            } else if (insertError.code === '23505') {
              const { data: refetchedProfile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', uid)
                .maybeSingle();
              if (refetchedProfile) profileData = refetchedProfile;
            }
          }
        } catch (retryErr) {
          console.error('[Debug] Auto-create retry failed:', retryErr);
        }
      }

      // Determine username: check profile first, then fallback sources
      const profileUsername = (profileData?.username || '').trim();
      const emailUsername = session.user.email?.endsWith('@picks.me')
        ? session.user.email.replace('@picks.me', '')
        : '';
      const existingUsername = profileUsername || localStorage.getItem('picks_user_session') || userNameRef.current || emailUsername || '';

      console.log('[Debug] Username resolution:', { profileUsername, localStorage: localStorage.getItem('picks_user_session'), ref: userNameRef.current, emailUsername, final: existingUsername });

      // KEY CHECK: If the user has ANY username (even 1 character), they are an existing user.
      // Only redirect to admin if user is on a non-settled page (login, signup, home).
      // Otherwise, preserve the current path.
      if (existingUsername) {
        const userRole = (profileData?.role || 'user').trim();
        console.log('[Debug] Existing user detected with username:', existingUsername, 'role:', userRole);
        // Clear stale localStorage data from previous user session
        const prevSessionUser = localStorage.getItem('picks_user_session');
        if (prevSessionUser && prevSessionUser !== existingUsername) {
          const staleKeys = Object.keys(localStorage).filter(key =>
            key.startsWith('picks_') && key !== 'picks_user_session'
          );
          staleKeys.forEach(key => localStorage.removeItem(key));
          console.log('[Auth] Cleared stale localStorage from previous user:', prevSessionUser);
        }
        setUserName(existingUsername);
        setIsLoggedIn(true);
        setProfileRole(userRole);
        localStorage.setItem('picks_user_session', existingUsername);
        setProfileChecked(true);

        const currentView = viewRef.current;
        // Only redirect away from "entry" pages; preserve settled/valid pages
        // Exclude 'signup' and 'business-signup' — users who explicitly navigated there should stay
        if (currentView === 'login' || currentView === 'home') {
          // Redirect logged-in users to dashboard from home/login pages.
          // This covers both fresh logins (OAuth callback) and restored sessions
          // (e.g., user coming from KakaoTalk while already logged in).
          // Set loginTransitioning BEFORE clearing oauthProcessing to prevent
          // a brief flash of the login page between the two state updates.
          setLoginTransitioning(true);
          if (userRole === 'admin') {
            navigate('operator');
          } else {
            // Check if user has site data (link blocks) before deciding destination
            try {
              const siteData = await apiService.getSiteData(existingUsername);
              const hasLinks = siteData && siteData.blocks && Array.isArray(siteData.blocks) && siteData.blocks.length > 0;
              if (hasLinks) {
                console.log(`[Auth] User has link data, redirecting to dashboard`);
                navigate('admin');
              } else {
                console.log(`[Auth] User has no link data, redirecting to link management`);
                setSubView('links');
                navigate('admin');
              }
            } catch (e) {
              console.error('[Auth] Error checking site data:', e);
              navigate('admin');
            }
          }
          setOauthProcessing(false);
        } else if (currentView === 'setup-link') {
          // User already has username, redirect away from setup
          console.log('[Auth] Redirecting to /admin because user already has username but was on /setup-link');
          setLoginTransitioning(true);
          setOauthProcessing(false);
          navigate('admin');
        } else if (settledViews.includes(currentView) && isViewValidForRole(currentView, userRole)) {
          setOauthProcessing(false);
          console.log(`[Auth] Staying on /${currentView} — valid for role "${userRole}"`);
        } else {
          setOauthProcessing(false);
          console.log(`[Auth] Staying on /${currentView} — no redirect needed`);
        }
        return;
      }

      // No username found — profile confirmed empty. Now safe to show setup-link.
      // Only for SIGNED_IN/INITIAL_SESSION events, and only if login handler didn't already navigate.
      setProfileChecked(true);
      setOauthProcessing(false);
      const currentViewForSetup = viewRef.current;
      console.log('[Debug] No username found. profileData:', profileData, 'event:', event, 'currentView:', currentViewForSetup, 'loginNavHandled:', loginNavigationHandledRef.current);
      // Redirect to setup-link for new OAuth users (profileData may be null if auto-create failed,
      // but we still need to navigate so the user isn't stuck on the login page)
      // For INITIAL_SESSION: only redirect if this page load is from an OAuth callback,
      // to prevent stale sessions from auto-redirecting users who are just visiting /login.
      const isNewOAuthUser = (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && isOAuthCallbackRef.current))
          && !localStorage.getItem('picks_live_kakao_redirect')
          && !localStorage.getItem('picks_notify_kakao_redirect')
          && currentViewForSetup !== 'admin'
          && !loginNavigationHandledRef.current;
      if (isNewOAuthUser && (currentViewForSetup === 'login' || currentViewForSetup === 'home')) {
        console.log('[Debug] Redirecting to setup-link because username is empty/null (profileData:', !!profileData, ')');
        setIsLoggedIn(true);
        setView('setup-link');
        window.history.pushState(null, '', '/setup-link');
      } else {
        console.log('[Debug] Not redirecting to setup-link. Conditions not met or user already on admin.');
      }
    };

    const initAuth = async () => {
      // Track if this is a hash-token flow for better error handling
      const hadHashToken = window.location.hash.includes('access_token');

      // Step 1: Exchange OAuth code if present, or wait for hash token parsing
      await handleOAuthCallback();

      // Step 2: Check existing session
      try {
        const { data: { session } } = await supabase!.auth.getSession();
        if (sessionProcessed) {
          // processUserSession from onAuthStateChange is already handling this session.
          // Safety: if oauthProcessing is still true after a delay, force-clear it
          // to prevent the user from being stuck on the spinner forever.
          setTimeout(() => {
            setOauthProcessing((prev) => {
              if (prev) {
                console.warn('[Auth] Safety timeout: oauthProcessing still true after 10s, force-clearing');
                return false;
              }
              return prev;
            });
            setProfileChecked(true);
          }, 10000);
          return;
        }
        if (session?.user) {
          // Delegate to processUserSession which handles ALL cases consistently,
          // including auto-creating profiles for new Kakao OAuth users.
          // Previously this had inline logic that missed profile auto-creation,
          // causing new Kakao users to get stuck on the login page.
          console.log('[Debug] initAuth: delegating to processUserSession');
          await processUserSession('INITIAL_SESSION', session);
        } else if (hadHashToken) {
          // Hash token was present but getSession() returned null — Supabase may need
          // a bit more time. Retry once after a short delay.
          console.log('[Auth] Hash token이 있었지만 getSession()이 null 반환 — 1초 후 재시도합니다.');
          await new Promise(r => setTimeout(r, 1000));
          const { data: { session: retrySession } } = await supabase!.auth.getSession();
          if (retrySession?.user) {
            console.log('[Auth] Hash token 재시도 성공 — 세션 발견됨');
            await processUserSession('INITIAL_SESSION', retrySession);
          } else {
            console.warn('[Auth] Hash token 재시도 후에도 세션 없음. onAuthStateChange에서 처리 대기.');
            // Don't show error — onAuthStateChange will pick up the session
            setOauthProcessing(false);
            setProfileChecked(true);
          }
        } else {
          // No session — clear stale local login state if present
          if (localStorage.getItem('picks_user_session')) {
            localStorage.removeItem('picks_user_session');
            localStorage.removeItem('picks_last_activity');
            setIsLoggedIn(false);
            setUserName('');
          }
          setOauthProcessing(false);
          setProfileChecked(true);
        }
      } catch (e) {
        console.error('[Debug] Error initializing session:', e);
        setOauthProcessing(false);
        setProfileChecked(true);
      }
    };
    initAuth();

    // Step 3: Listen for ongoing auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        // If login flow already handled navigation (ID/password login),
        // just sync the auth state without any view changes
        if (loginNavigationHandledRef.current) {
          const uid = session.user.id;
          setAuthUserId(uid);
          const savedUsername = localStorage.getItem('picks_user_session') || userNameRef.current;
          if (savedUsername) {
            setUserName(savedUsername);
            setIsLoggedIn(true);
          }
          return;
        }
        // Skip re-processing for TOKEN_REFRESHED if user is already settled on a page
        // This prevents unwanted navigation when Supabase refreshes tokens in the background
        if (event === 'TOKEN_REFRESHED') {
          const currentView = viewRef.current;
          if (currentView === 'admin' || currentView === 'user-page' || currentView === 'operator' || currentView === 'setup-link' || currentView === 'signup' || currentView === 'login') {
            console.log('[Auth] TOKEN_REFRESHED ignored — user already on', currentView);
            return;
          }
        }
        try {
          await processUserSession(event, session);
        } catch (err) {
          console.error('[Auth] processUserSession threw unexpectedly:', err);
          // Safety: ensure oauthProcessing is cleared so the user isn't stuck on spinner
          setOauthProcessing(false);
          setProfileChecked(true);
        }
      } else if (event === 'SIGNED_OUT') {
        // Only act on SIGNED_OUT if the local session was already cleared
        // (i.e., this was an intentional logout via handleLogout).
        // Supabase may fire SIGNED_OUT on token refresh failures — ignore those
        // so users don't get unexpectedly kicked out of admin/personal pages.
        const hasLocalSession = localStorage.getItem('picks_user_session');
        if (!hasLocalSession) {
          setIsLoggedIn(false);
          setUserName('');
          setAuthUserId('');
          if (viewRef.current === 'admin') {
            navigate('home');
          }
        } else {
          console.log('[Auth] SIGNED_OUT event ignored — local session still active (likely token refresh issue)');
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []); // Only run once on mount

  // Persistent auto-logout after 2 hours of inactivity.
  // The check runs on mount BEFORE seeding picks_last_activity so a stale
  // timestamp (e.g. browser closed for 3 hours, or the computer was asleep)
  // is honored and logs the user out instead of being overwritten with "now".
  // The timer is refreshed by real user interaction (mousemove/keydown/scroll/
  // touchstart/click), so passively sitting on any view — public or protected —
  // counts as inactivity once those events stop firing.
  useEffect(() => {
    if (!isLoggedIn) return;

    const INACTIVITY_LIMIT = 2 * 60 * 60 * 1000;
    let loggedOut = false;

    const updateActivity = () => {
      localStorage.setItem('picks_last_activity', Date.now().toString());
    };

    const checkInactivity = () => {
      if (loggedOut) return;
      const lastActivity = localStorage.getItem('picks_last_activity');
      if (!lastActivity) return;
      const elapsed = Date.now() - parseInt(lastActivity, 10);
      if (elapsed > INACTIVITY_LIMIT) {
        loggedOut = true;
        console.log(`[Auth] Auto-logout: ${Math.round(elapsed / 60000)}분간 활동 없음 — 세션 종료`);
        try {
          window.alert('2시간 동안 활동이 없어 자동 로그아웃됩니다.\n보안을 위해 다시 로그인해 주세요.');
        } catch {}
        handleLogout();
      }
    };

    // On mount: honor the stored timestamp BEFORE refreshing it. If the user
    // was idle past the 2-hour window (laptop slept, computer powered off,
    // browser closed), this triggers the logout immediately regardless of
    // which view they land on.
    const stored = localStorage.getItem('picks_last_activity');
    if (stored) {
      const elapsed = Date.now() - parseInt(stored, 10);
      if (elapsed > INACTIVITY_LIMIT) {
        loggedOut = true;
        console.log(`[Auth] Auto-logout on mount: ${Math.round(elapsed / 60000)}분간 활동 없음 — 세션 종료`);
        try {
          window.alert('2시간 동안 활동이 없어 자동 로그아웃됩니다.\n보안을 위해 다시 로그인해 주세요.');
        } catch {}
        handleLogout();
        return;
      }
    } else {
      // First-ever load — seed the timestamp so the timer starts now.
      updateActivity();
    }

    // Cross-tab sync: activity in another tab should keep this tab alive too.
    // Without this, opening the app in two tabs and using only one would log
    // the idle tab out mid-session.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'picks_last_activity') {
        // Storage events already reflect the new value; no action needed beyond
        // re-reading on the next check tick, which reads directly from storage.
      }
    };

    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(event => window.addEventListener(event, updateActivity));
    window.addEventListener('storage', onStorage);

    // When the tab becomes visible again after being hidden (laptop sleep,
    // tab switch, etc.), re-check inactivity *before* counting the return as
    // activity. Otherwise visibilitychange would refresh the timestamp and
    // mask the fact that the user was idle past the 2-hour limit while away.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkInactivity();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Check every 30s so the logout happens within 30s of the 2-hour mark,
    // rather than drifting up to a full minute past it.
    const interval = setInterval(checkInactivity, 30000);

    return () => {
      activityEvents.forEach(event => window.removeEventListener(event, updateActivity));
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [isLoggedIn]);

  // Business account inactivity timer (separate from regular user timer)
  useEffect(() => {
    if (!isBusinessLoggedIn) return;

    const INACTIVITY_LIMIT = 2 * 60 * 60 * 1000;
    let loggedOut = false;

    const updateActivity = () => {
      localStorage.setItem('picks_business_last_activity', Date.now().toString());
    };

    const checkInactivity = () => {
      if (loggedOut) return;
      const lastActivity = localStorage.getItem('picks_business_last_activity');
      if (!lastActivity) return;
      const elapsed = Date.now() - parseInt(lastActivity, 10);
      if (elapsed > INACTIVITY_LIMIT) {
        loggedOut = true;
        try {
          window.alert('2시간 동안 활동이 없어 자동 로그아웃됩니다.\n보안을 위해 다시 로그인해 주세요.');
        } catch {}
        handleBusinessLogout();
      }
    };

    const stored = localStorage.getItem('picks_business_last_activity');
    if (stored) {
      const elapsed = Date.now() - parseInt(stored, 10);
      if (elapsed > INACTIVITY_LIMIT) {
        loggedOut = true;
        try {
          window.alert('2시간 동안 활동이 없어 자동 로그아웃됩니다.\n보안을 위해 다시 로그인해 주세요.');
        } catch {}
        handleBusinessLogout();
        return;
      }
    } else {
      updateActivity();
    }

    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(event => window.addEventListener(event, updateActivity));

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkInactivity();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const interval = setInterval(checkInactivity, 30000);

    return () => {
      activityEvents.forEach(event => window.removeEventListener(event, updateActivity));
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [isBusinessLoggedIn]);

  // Clear login transition after a brief delay to allow state to settle
  useEffect(() => {
    if (loginTransitioning && (view === 'admin' || view === 'operator') && userName && isLoggedIn) {
      const timer = setTimeout(() => {
        setLoginTransitioning(false);
      }, 400);
      return () => clearTimeout(timer);
    }
    // Safety: force-clear loginTransitioning after 8 seconds to prevent infinite spinner
    if (loginTransitioning) {
      const safetyTimer = setTimeout(() => {
        console.warn('[Auth] Safety timeout: loginTransitioning still true after 8s, force-clearing');
        setLoginTransitioning(false);
      }, 8000);
      return () => clearTimeout(safetyTimer);
    }
  }, [loginTransitioning, view, userName, isLoggedIn]);

  const wasLoggedInRef = useRef(false);
  useEffect(() => {
    if (isLoggedIn && userName) {
      wasLoggedInRef.current = true;
      localStorage.setItem('picks_user_session', userName);
      import('./components/BusinessTimeline').catch(() => {});
    } else if (!isLoggedIn && wasLoggedInRef.current) {
      localStorage.removeItem('picks_user_session');
      localStorage.removeItem('picks_last_activity');
    }
  }, [isLoggedIn, userName]);

  // Route invite tokens to operator-login
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('invite_token=')) {
      setView('operator-login');
      window.history.replaceState(null, '', '/operator-login' + hash);
    }
  }, []);

  // Handle magic link timeline tokens — auto-login and navigate to timeline
  const [timelineProposalId, setTimelineProposalId] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const timelineParam = params.get('timeline');
    const tokenParam = params.get('token');

    if (timelineParam && tokenParam) {
      // Validate token and auto-login
      fetch('/api/timeline/magic-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenParam }),
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            // Set session based on user type
            if (data.userType === 'influencer') {
              localStorage.setItem('picks_user_session', data.username);
              setUserName(data.username);
              setIsLoggedIn(true);
            }
            setTimelineProposalId(timelineParam);
            setSubView('timeline');
            setView('admin');
          }
          // Clean URL
          window.history.replaceState(null, '', '/admin');
        })
        .catch(() => {
          window.history.replaceState(null, '', '/');
        });
    }
  }, []);

  // Listen for navigate-timeline custom events from BusinessDashboard
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.proposalId) {
        setTimelineProposalId(detail.proposalId);
        setSubView('timeline');
      }
    };
    window.addEventListener('navigate-timeline', handler);
    return () => window.removeEventListener('navigate-timeline', handler);
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname.replace(/^\//, '');
      if (!path && window.location.hash.includes('invite_token=')) {
        setView('operator-login');
        return;
      }
      if (!path) setView('home');
      else if (path === 'setup-link') {
        const savedUser = localStorage.getItem('picks_user_session');
        if (savedUser && isLoggedIn) {
          setView('admin');
          window.history.replaceState(null, '', '/admin');
        } else {
          setView('setup-link');
        }
      }
      else if (['signup', 'login', 'admin', 'operator', 'operator-login', 'terms', 'privacy', 'business-signup', 'business-login', 'business-admin'].includes(path)) setView(path as View);
      else if (path.endsWith('/proposal')) {
        // /:username/proposal route
        setTargetUser(path.replace('/proposal', ''));
        setView('proposal');
      } else {
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

    // 1. Immediate local cleanup — clear user-specific picks_ keys
    //    but PRESERVE business session keys so business login survives
    const businessKeys = ['picks_business_session', 'picks_business_company', 'picks_business_access_token', 'picks_business_refresh_token'];
    loginNavigationHandledRef.current = false;
    setProfileChecked(false);
    setIsLoggedIn(false);
    setUserName('');
    const keysToRemove = Object.keys(localStorage).filter(key => key.startsWith('picks_') && !businessKeys.includes(key));
    keysToRemove.forEach(key => localStorage.removeItem(key));
    sessionStorage.clear();
    clearAllLinkCache();
    console.log('User picks_ localStorage keys cleared (business keys preserved)');

    // 2. Await Supabase signout so its session tokens (sb-*-auth-token) are fully
    //    cleared from storage BEFORE the hard redirect. If we don't wait, the stored
    //    session can survive into the next page load, causing Supabase to re-emit
    //    INITIAL_SESSION and auto-log the user back in on /login.
    if (supabase) {
      try {
        await Promise.race([
          supabase.auth.signOut(),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
        console.log('Supabase signout completed (or timed out safely)');
      } catch (err) {
        console.warn('Supabase signout failed (ignoring):', err);
      }
    }

    // 3. Belt-and-suspenders: strip any remaining sb-* auth keys in case signOut
    //    didn't finish wiping them. Prevents Supabase from rehydrating a session.
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('sb-') || key.includes('supabase.auth'))
        .forEach((key) => localStorage.removeItem(key));
    } catch {}

    // 4. Immediate feedback
    alert('정상적으로 로그아웃되었습니다.');

    // 5. Force hard redirect using absolute URL
    const loginUrl = window.location.origin + '/login';
    console.log('Redirecting to:', loginUrl);
    window.location.href = loginUrl;
  };

  const handleBusinessLogout = () => {
    localStorage.removeItem('picks_business_session');
    localStorage.removeItem('picks_business_company');
    localStorage.removeItem('picks_business_access_token');
    localStorage.removeItem('picks_business_refresh_token');
    localStorage.removeItem('picks_business_last_activity');
    setBusinessUsername('');
    setBusinessCompanyName('');
    setIsBusinessLoggedIn(false);
    alert('정상적으로 로그아웃되었습니다.');
    window.location.href = window.location.origin + '/business-login';
  };

  // Business views
  if (view === 'business-signup') {
    return (
      <Suspense fallback={<LazyFallback />}>
        <BusinessSignupPage
          onNavigateHome={() => navigate('home')}
          onNavigateLogin={() => navigate('business-login')}
          onSignupSuccess={() => navigate('business-login')}
        />
      </Suspense>
    );
  }
  if (view === 'business-login') {
    return (
      <Suspense fallback={<LazyFallback />}>
        <BusinessLoginPage
          onNavigateHome={() => navigate('home')}
          onNavigateBusinessSignup={() => navigate('business-signup')}
          onLoginSuccess={(bizUsername, compName) => {
            setBusinessUsername(bizUsername);
            setBusinessCompanyName(compName);
            setIsBusinessLoggedIn(true);
            localStorage.setItem('picks_business_session', bizUsername);
            localStorage.setItem('picks_business_company', compName);
            const redirectPath = sessionStorage.getItem('picks_business_redirect');
            if (redirectPath) {
              sessionStorage.removeItem('picks_business_redirect');
              window.history.pushState(null, '', redirectPath);
              window.dispatchEvent(new PopStateEvent('popstate'));
            } else {
              navigate('business-admin');
            }
          }}
        />
      </Suspense>
    );
  }
  if (view === 'business-admin') {
    if (!isBusinessLoggedIn || !businessUsername) {
      // Redirect to business login
      setTimeout(() => navigate('business-login'), 0);
      return null;
    }
    return (
      <Suspense fallback={<LazyFallback />}>
        <BusinessEnterpriseDashboard
          businessUsername={businessUsername}
          companyName={businessCompanyName}
          onLogout={handleBusinessLogout}
        />
      </Suspense>
    );
  }

  if (view === 'operator-login') return <Suspense fallback={<LazyFallback />}><OperatorLogin onLoginSuccess={(info) => {
    if (info?.username && info?.token) {
      localStorage.setItem('picks_user_session', info.username);
      localStorage.setItem('picks_admin_token', info.token);
      setUserName(info.username);
      setIsLoggedIn(true);
      setProfileChecked(true);
    }
    navigate('operator');
  }} /></Suspense>;
  if (view === 'operator') {
    if (!isLoggedIn) {
      setTimeout(() => navigate('operator-login'), 0);
      return null;
    }
    if (!profileChecked && supabase) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-midnight">
          <div className="text-center">
            <div className="w-8 h-8 border-3 border-purple-400/30 border-t-purple-400 rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-slate-400 text-sm">권한 확인 중...</p>
          </div>
        </div>
      );
    }
    return <Suspense fallback={<LazyFallback />}><OperatorDashboard onLogout={() => navigate('operator-login')} /></Suspense>;
  }
  if (view === 'terms') return <Suspense fallback={<LazyFallback />}><TermsOfService onNavigateHome={() => navigate('home')} /></Suspense>;
  if (view === 'privacy') return <Suspense fallback={<LazyFallback />}><PrivacyPolicy onNavigateHome={() => navigate('home')} /></Suspense>;
  if (view === 'proposal') return <Suspense fallback={<LazyFallback />}><BusinessProposalForm username={targetUser} /></Suspense>;
  if (view === 'user-page') return <Suspense fallback={<LazyFallback />}><UserPage username={targetUser} /></Suspense>;
  if (view === 'setup-link') {
    // If user already has a username (existing user), skip setup and go to admin dashboard
    const savedUser = (userName || localStorage.getItem('picks_user_session') || '').trim();
    if (savedUser) {
      console.log('[Auth] Redirecting to /admin because user already has username on setup-link render gate:', savedUser);
      // Use setTimeout to avoid state update during render
      setTimeout(() => {
        setUserName(savedUser);
        setIsLoggedIn(true);
        navigate('admin');
      }, 0);
      return null;
    }
    console.log('[Debug] setup-link render gate: no username found. profileChecked:', profileChecked, 'userName state:', userName);
    // While the profile has NOT been definitively checked from Supabase,
    // show a loading spinner instead of the SetupLink form.
    // This prevents existing users from ever seeing the link creation screen.
    if (!profileChecked) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-midnight">
          <div className="w-8 h-8 border-3 border-purple-400/30 border-t-purple-400 rounded-full animate-spin"></div>
        </div>
      );
    }
    return (
      <Suspense fallback={<LazyFallback />}>
        <SetupLink
          userId={authUserId}
          onSetupComplete={(newUsername) => {
            loginNavigationHandledRef.current = true;
            setLoginTransitioning(true);
            setUserName(newUsername);
            setIsLoggedIn(true);
            navigate('admin');
          }}
        />
      </Suspense>
    );
  }
  if (view === 'admin') {
    if (!isLoggedIn || !userName) {
      setTimeout(() => navigate('login'), 0);
      return null;
    }
    if (!profileChecked && supabase) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
          <div className="text-center">
            <div className="w-8 h-8 border-3 border-purple-600/30 border-t-purple-600 rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-slate-400 text-sm">프로필 확인 중...</p>
          </div>
        </div>
      );
    }
    // Show smooth transition screen while login completes
    if (loginTransitioning) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
          <div className="text-center animate-in fade-in duration-300">
            <div className="w-10 h-10 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-slate-500 font-bold text-sm">대시보드를 불러오는 중...</p>
          </div>
        </div>
      );
    }

    let subComponent: React.ReactNode = null;

    switch (subView) {
      case 'links':
        subComponent = <Suspense fallback={<LazyFallback />}><LinkManagement userName={userName} /></Suspense>;
        break;
      case 'portfolio':
        subComponent = <Suspense fallback={<LazyFallback />}><PortfolioManagement userName={userName} onNavigateMembership={() => setSubView('membership')} /></Suspense>;
        break;
      case 'live':
        subComponent = <Suspense fallback={<LazyFallback />}><LiveCommerceManagement userName={userName} onNavigateMembership={() => setSubView('membership')} onNavigateBroadcastSettings={() => setSubView('broadcast-settings')} /></Suspense>;
        break;
      case 'broadcast-settings':
        subComponent = <Suspense fallback={<LazyFallback />}><BroadcastSettings userName={userName} onNavigateLive={() => setSubView('live')} /></Suspense>;
        break;
      case 'broadcast-history':
        subComponent = <Suspense fallback={<LazyFallback />}><BroadcastHistory userName={userName} /></Suspense>;
        break;
      case 'business':
        subComponent = <Suspense fallback={<LazyFallback />}><BusinessDashboard userName={userName} /></Suspense>;
        break;
      case 'calendar':
        subComponent = <Suspense fallback={<LazyFallback />}><BusinessCalendar userName={userName} /></Suspense>;
        break;
      case 'open-schedule':
        subComponent = <Suspense fallback={<LazyFallback />}><OpenScheduleManagement userName={userName} /></Suspense>;
        break;
      case 'settlement':
        subComponent = <Suspense fallback={<LazyFallback />}><UserSettlement userName={userName} /></Suspense>;
        break;
      case 'timeline':
        subComponent = (
          <Suspense fallback={<LazyFallback />}>
            <BusinessTimeline userName={userName} initialProposalId={timelineProposalId || undefined} />
          </Suspense>
        );
        break;
      case 'membership':
        subComponent = <Suspense fallback={<LazyFallback />}><MembershipPlan userName={userName} /></Suspense>;
        break;
      case 'campaigns':
        subComponent = <Suspense fallback={<LazyFallback />}><UserCampaignBrowse userName={userName} /></Suspense>;
        break;
      default:
        subComponent = null; // AdminDashboard will show default dashboard if children is null
    }

    return (
      <>
        <AdminDashboard
        userName={userName}
        onLogout={handleLogout}
        currentSubView={subView}
        onNavigateDashboard={() => setSubView('dashboard')}
        onNavigateLinks={() => setSubView('links')}
        onNavigatePortfolio={() => setSubView('portfolio')}
        onNavigateLive={() => setSubView('live')}
        onNavigateBroadcastSettings={() => setSubView('broadcast-settings')}
        onNavigateBusiness={() => setSubView('business')}
        onNavigateCalendar={() => setSubView('calendar')}
        onNavigateOpenSchedule={() => setSubView('open-schedule')}
        onNavigateSettlement={() => setSubView('settlement')}
        onNavigateTimeline={() => setSubView('timeline')}
        onNavigateMembership={() => setSubView('membership')}
        onNavigateCampaigns={() => setSubView('campaigns')}
      >
        {subComponent ? (
          <ErrorBoundary key={subView}>
            {subComponent}
          </ErrorBoundary>
        ) : null}
      </AdminDashboard>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background selection:bg-purple-primary/30 flex flex-col">
      <SiteHeader
        onNavigateHome={() => navigate('home')}
        onNavigateSignup={() => navigate('signup')}
        onNavigateLogin={() => navigate('login')}
        onNavigateDashboard={() => navigate('admin')}
        onLogout={handleLogout}
        isLoggedIn={isLoggedIn}
      />
      <main className="flex-1">
        {view === 'home' ? (
          <>
            <Hero onSignup={(id) => { setInitialId(id); navigate('signup'); }} />
            <TemplateShowcase onSignup={() => navigate('signup')} userName={userName} />
            <DataBoardSection />
          </>
        ) : view === 'signup' ? (
          <SignupPage
            initialId={initialId}
            onNavigateHome={() => navigate('home')}
            onNavigateLogin={() => navigate('login')}
            onSignupSuccess={() => navigate('login')}
          />
        ) : (
          (oauthProcessing || loginTransitioning) ? (
            <div className="min-h-screen flex items-center justify-center bg-midnight">
              <div className="text-center animate-in fade-in duration-300">
                <div className="w-10 h-10 border-3 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-slate-300 font-bold text-sm">{loginTransitioning ? '대시보드를 불러오는 중...' : '카카오 로그인 처리 중...'}</p>
              </div>
            </div>
          ) : (
          <LoginPage
            onNavigateHome={() => navigate('home')}
            onNavigateSignup={() => navigate('signup')}
            onLoginSuccess={(id, hasSiteData, _phone) => {
              loginNavigationHandledRef.current = true;
              setProfileChecked(true);
              setLoginTransitioning(true);
              // Clear any previous user's cached data before setting new user
              const prevUser = localStorage.getItem('picks_user_session');
              if (prevUser && prevUser !== id) {
                const businessKeysToKeep = ['picks_business_session', 'picks_business_company', 'picks_business_access_token', 'picks_business_refresh_token'];
                const staleKeys = Object.keys(localStorage).filter(key =>
                  key.startsWith('picks_') && key !== 'picks_user_session' && !businessKeysToKeep.includes(key)
                );
                staleKeys.forEach(key => localStorage.removeItem(key));
                console.log('[Auth] Cleared previous user localStorage data, switching from', prevUser, 'to', id);
              }
              setUserName(id);
              setIsLoggedIn(true);
              if (hasSiteData) {
                navigate('admin');
              } else {
                // No link data — show link management page
                setSubView('links');
                navigate('admin');
              }
            }}
            onAdminLoginSuccess={(info) => {
              if (info?.username && info?.token) {
                localStorage.setItem('picks_user_session', info.username);
                localStorage.setItem('picks_admin_token', info.token);
                setUserName(info.username);
                setIsLoggedIn(true);
                setProfileChecked(true);
              }
              navigate('operator');
            }}
          />
          )
        )}
      </main>
      {view === 'home' && (
        <Footer onNavigateTerms={() => navigate('terms')} onNavigatePrivacy={() => navigate('privacy')} />
      )}
    </div>
  );
};

export default App;
