
import React, { useState, useEffect, useRef, useCallback } from 'react';
import SiteHeader from './components/SiteHeader';
import Hero from './components/Hero';
import TemplateShowcase from './components/TemplateShowcase';
import DataBoardSection from './components/DataBoardSection';
import ErrorBoundary from './components/ErrorBoundary';
import Footer from './components/Footer';
import { supabase, withTimeout, safeFetchProfile } from './services/supabase';
// 탭마다 계정 슬롯을 나눠, 일반 유저 · 비즈니스 · 운영자를 동시에 열어 두고 써도
// 새로고침에서 서로의 로그인이 풀리지 않게 한다. 자세한 이유는 모듈 주석에 있다.
import {
  sessionGet,
  sessionSet,
  sessionRemove,
  scopedKey,
  getAccountScope,
  setAccountScope,
  ownPicksKeys,
  ownSupabaseKeys,
  hasOwnSupabaseSession,
  clearTabStateKeepScope,
} from './utils/accountScope';
// 실패한 dynamic import() 를 재시도하고, 그래도 안 되면 오류를 던져 오류 경계가
// 안내하게 하는 래퍼. 구현과 이유는 utils/lazyRoute.tsx 에 있다.
import { lazyWithRetry, LazyRoute } from './utils/lazyRoute';
import { isKakaoSdkSignedIn } from './utils/kakaoLogin';

const UserPage = lazyWithRetry(() => import('./components/UserPage'));
// Auth and the logged-in dashboard are not needed for the public homepage, so
// they are code-split out of the initial bundle for a faster first paint.
const SignupPage = lazyWithRetry(() => import('./components/SignupPage'));
const LoginPage = lazyWithRetry(() => import('./components/LoginPage'));
const AdminDashboard = lazyWithRetry(() => import('./components/AdminDashboard'));
const LinkManagement = lazyWithRetry(() => import('./components/LinkManagement'));
const DmAutomation = lazyWithRetry(() => import('./components/DmAutomation'));
const CreatorInsights = lazyWithRetry(() => import('./components/CreatorInsights'));
const BusinessProposalForm = lazyWithRetry(() => import('./components/BusinessProposalForm'));
const BusinessDashboard = lazyWithRetry(() => import('./components/BusinessDashboard'));
const BusinessCalendar = lazyWithRetry(() => import('./components/BusinessCalendar'));
const OpenScheduleManagement = lazyWithRetry(() => import('./components/OpenScheduleManagement'));
const UserCampaignBrowse = lazyWithRetry(() => import('./components/UserCampaignBrowse'));
const CreatorCampaignCollabs = lazyWithRetry(() => import('./components/CreatorCampaignCollabs'));
const MembershipPlan = lazyWithRetry(() => import('./components/MembershipPlan'));
const OperatorLogin = lazyWithRetry(() => import('./components/OperatorLogin'));
const OperatorDashboard = lazyWithRetry(() => import('./components/OperatorDashboard'));
const SetupLink = lazyWithRetry(() => import('./components/SetupLink'));
const TermsOfService = lazyWithRetry(() => import('./components/TermsOfService'));
const PrivacyPolicy = lazyWithRetry(() => import('./components/PrivacyPolicy'));
const BusinessSignupPage = lazyWithRetry(() => import('./components/BusinessSignupPage'));
const BusinessLoginPage = lazyWithRetry(() => import('./components/BusinessLoginPage'));
const BusinessEnterpriseDashboard = lazyWithRetry(() => import('./components/BusinessEnterpriseDashboard'));
const UserSettlement = lazyWithRetry(() => import('./components/UserSettlement'));
const BusinessTimeline = lazyWithRetry(() => import('./components/BusinessTimeline'));
// 담당자 대시보드. 운영자가 배정한 일반 계정만 들어온다.
const ManagerDashboard = lazyWithRetry(() => import('./components/manager/ManagerDashboard'));
import { apiService } from './services/apiService';
import { clearAllLinkCache } from './services/prefetchService';
import { isNativeApp, isPersistentLoginEnv } from './utils/appEnv';

type View = 'home' | 'signup' | 'login' | 'admin' | 'user-page' | 'setup-link' | 'proposal' | 'operator' | 'operator-login' | 'terms' | 'privacy' | 'business-signup' | 'business-login' | 'business-admin' | 'manager';
type SubView = 'dashboard' | 'links' | 'dm-automation' | 'insights' | 'business' | 'calendar' | 'membership' | 'open-schedule' | 'settlement' | 'timeline' | 'campaigns' | 'my-collabs';

/** 주소 첫 칸이 그대로 화면 이름이 되는 경로. */
const TOP_LEVEL_VIEWS: View[] = ['signup', 'login', 'admin', 'operator', 'operator-login', 'terms', 'privacy', 'business-signup', 'business-login', 'business-admin', 'manager'];

/** 같은 화면을 가리키는 슬래시 표기(sitemap.xml · 외부 링크가 쓰는 형태). */
const SLASH_ALIASES: Record<string, View> = {
  'business/login': 'business-login',
  'business/signup': 'business-signup',
  'business/admin': 'business-admin',
};

/**
 * 크리에이터 아이디로 해석하면 안 되는 주소.
 *
 * 라우터의 마지막 갈래는 "그 밖의 모든 것 = 크리에이터 아이디" 다. 그래서 결제 복귀
 * 주소나 아직 화면이 없는 주소가 전부 "없는 크리에이터의 빈 페이지" 로 보였다.
 * 여기에 적힌 이름은 홈으로 보낸다. og-image 엣지 함수의 예약어 목록과 같은 뜻이다.
 */
const RESERVED_PATHS = new Set([
  'settings', 'checkout', 'success', 'fail', 'profile', 'business',
  'api', 'assets', 'toss', 'portone', 'index.html', 'favicon.ico',
]);

// 지연 로딩 화면은 모두 utils/lazyRoute 의 LazyRoute 로 감싼다 — 로딩 표시와
// 오류 경계가 항상 함께 붙어야, 청크를 못 받은 화면이 로딩 표시에서 멈춘 것처럼
// 보이지 않는다.

// Records that the user asked for the homepage on purpose (header "홈"), so that
// reloading — pull-to-refresh is always on in the native shell — doesn't bounce
// them into the dashboard as if the app had just been launched. Deliberately
// short-lived so a later cold start still lands on the dashboard even if the
// WebView happened to keep sessionStorage around.
const HOME_INTENT_KEY = 'picks_home_intent';
const HOME_INTENT_TTL = 5 * 60 * 1000;

/**
 * 비즈니스 로그인이 쓰는 키. 크리에이터 · 운영자 쪽 정리 로직은 이 키들을 절대
 * 지우지 않는다 — 같은 브라우저의 다른 탭에서 비즈니스 계정이 켜져 있을 수 있고,
 * 지우면 그 탭이 새로고침하는 순간 로그아웃된다.
 */
const BUSINESS_SESSION_KEYS = [
  'picks_business_session',
  'picks_business_company',
  'picks_business_access_token',
  'picks_business_refresh_token',
  'picks_business_last_activity',
];

function markHomeIntent(): void {
  try { sessionStorage.setItem(HOME_INTENT_KEY, Date.now().toString()); } catch {}
}

/**
 * "담당자가 지금은 자기 크리에이터 대시보드를 보겠다"는 의사 표시.
 *
 * 배정된 담당자는 담당자 대시보드로만 들어가야 한다(운영자가 배정한 뜻이 그렇다).
 * 그래서 담당자 계정이 크리에이터 대시보드에 있으면 담당자 화면으로 되돌린다.
 * 다만 담당자도 자기 링크 페이지를 고쳐야 할 때가 있으므로, 담당자 대시보드에서
 * "크리에이터 대시보드" 버튼으로 나온 경우에는 되돌리지 않는다. 새로고침해도
 * 그 뜻이 살아 있어야 해서 탭 저장소에 남긴다 — 로그아웃 시 함께 지워진다.
 */
const CREATOR_INTENT_KEY = 'picks_manager_creator_intent';

function markCreatorIntent(): void {
  try { sessionStorage.setItem(CREATOR_INTENT_KEY, '1'); } catch {}
}

function clearCreatorIntent(): void {
  try { sessionStorage.removeItem(CREATOR_INTENT_KEY); } catch {}
}

function hasCreatorIntent(): boolean {
  try { return sessionStorage.getItem(CREATOR_INTENT_KEY) === '1'; } catch { return false; }
}

function hasRecentHomeIntent(): boolean {
  try {
    const stamp = sessionStorage.getItem(HOME_INTENT_KEY);
    if (!stamp) return false;
    return Date.now() - parseInt(stamp, 10) < HOME_INTENT_TTL;
  } catch {
    return false;
  }
}

/**
 * Which view a native-app launch should open directly, or null for the normal
 * "start on the homepage" behaviour.
 *
 * The native shell always loads the site root, so a signed-in user used to land
 * on the public marketing homepage and tap through to their dashboard on every
 * single launch. When there is a cached session we open the dashboard as the
 * very first render instead — `isLoggedIn`/`userName`/`profileChecked` are all
 * seeded from that same cache, so the dashboard paints immediately with no
 * homepage flash, and Supabase confirms (or invalidates) the session in the
 * background exactly as before.
 *
 * Deliberately conservative: only the native app, only the bare root url, never
 * during an OAuth callback (the login flow owns that redirect), never a push
 * deep link, and never right after the user asked for the homepage themselves.
 * And only when there is a real auth token to go with the cached username — a
 * user who has to log in must see the homepage, not a dashboard that bounces.
 */
function launchDashboardView(): View | null {
  if (!isNativeApp()) return null;
  try {
    if (window.location.pathname.replace(/^\//, '')) return null;
    if (window.location.hash.includes('access_token')) return null;
    if (window.location.hash.includes('invite_token=')) return null;
    if (new URLSearchParams(window.location.search).get('code')) return null;
    if (hasRecentHomeIntent()) return null;
    // A creator (Kakao) session wins over a business one when both are cached.
    if (sessionGet('picks_user_session') && hasStoredSupabaseSession()) return 'admin';
    if (
      localStorage.getItem('picks_business_session') &&
      localStorage.getItem('picks_business_access_token')
    ) {
      return 'business-admin';
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * True when Supabase has a persisted session in localStorage (`sb-<ref>-auth-token`).
 * Its access token may well be expired — Supabase refreshes it on start-up — but
 * if the entry is gone entirely then the user is signed out and needs to log in.
 *
 * 이 탭의 계정 슬롯에 저장된 세션만 본다. 다른 탭에 열려 있는 운영자 세션을
 * 자기 것으로 착각하면 안 된다.
 */
function hasStoredSupabaseSession(): boolean {
  return hasOwnSupabaseSession();
}

const App: React.FC = () => {
  // Native-app launch shortcut, resolved once per page load before the first
  // render so the dashboard can be the initial view (see launchDashboardView).
  const launchViewRef = useRef<View | null>(launchDashboardView());
  // Same decision, kept for the whole page load: if the cached session turns out
  // to be dead, an app launch falls back to the homepage (where the user can log
  // in) instead of dropping them straight onto the login form.
  const launchedIntoDashboardRef = useRef<boolean>(launchViewRef.current !== null);
  const [view, setView] = useState<View>(() => launchViewRef.current ?? 'home');
  const [subView, setSubView] = useState<SubView>('dashboard');
  /** 협업 현황에서 눌러 들어온 캠페인 협업 id. 캠페인 협업 화면이 이것을 펼친다. */
  const [collabFocusId, setCollabFocusId] = useState<string | null>(null);
  const [targetUser, setTargetUser] = useState('');
  const [initialId, setInitialId] = useState('');
  const [userName, setUserName] = useState(() => sessionGet('picks_user_session') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!sessionGet('picks_user_session'));
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
  // 카카오 간편로그인은 앱을 그리기 전에 세션을 만들고 주소를 `?kakao_login=1` 로
  // 되돌리므로(main.tsx) URL 에 `code` 가 남아 있지 않다. 그것도 방금 끝난 OAuth
  // 콜백으로 함께 세어야, 처음 가입한 카카오 사용자가 링크네임 설정 화면으로
  // 넘어간다.
  const isOAuthCallbackRef = useRef<boolean>(
    !!new URLSearchParams(window.location.search).get('code')
      || window.location.hash.includes('access_token')
      || isKakaoSdkSignedIn()
  );

  // profileChecked: true once we've verified the user's profile from Supabase.
  // While false, protected views show a loading spinner.
  // For returning users with a cached session (not an OAuth callback), skip the
  // blocking check — the profile will be verified in the background.
  const [profileChecked, setProfileChecked] = useState(() => {
    const hasCache = !!sessionGet('picks_user_session');
    const params = new URLSearchParams(window.location.search);
    const isOAuthCallback = !!params.get('code')
      || window.location.hash.includes('access_token')
      || isKakaoSdkSignedIn();
    return hasCache && !isOAuthCallback;
  });

  // Track the user's role from the Supabase profile (e.g. 'user', 'admin')
  const [, setProfileRole] = useState<string>('');

  // 청크 회복 기록은 앱이 떴다고 지우지 않는다. 새로고침 직후에도 앱은 항상 뜨기
  // 때문에, 여기서 지우면 "한 번만 새로고침" 이 지켜지지 않아 실패한 청크가 있을 때
  // 새로고침이 반복될 수 있다. 대신 utils/chunkReload.ts 가 시각 기반 쿨다운으로
  // 다음 배포에서의 재회복을 허용한다.

  // loginTransitioning: true during the brief period between login success and admin dashboard ready.
  // Shows a smooth loading screen instead of a blank/flickering dashboard.
  const [loginTransitioning, setLoginTransitioning] = useState(false);


  // oauthProcessing: true while an OAuth callback (e.g. Kakao) is being processed.
  // Shows a loading screen on the login page instead of the form.
  const [oauthProcessing, setOauthProcessing] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const hasCode = !!params.get('code');
    const hasHashToken = window.location.hash.includes('access_token');
    // 카카오 간편로그인은 앱을 그리기 전에 세션까지 만들고 주소를 되돌린다
    // (main.tsx → completeKakaoSdkLogin). 그때 남겨 둔 표시를 보고, 대시보드로
    // 넘어가기 전에 로그인 폼이 한 번 번쩍이지 않도록 로딩 화면을 유지한다.
    return hasCode || hasHashToken || isKakaoSdkSignedIn();
  });

  // 담당자 여부. 운영자가 배정한 일반 계정은 관리자가 아니면서 담당자 대시보드를
  // 받는다. profiles.role 로는 알 수 없어서 로그인 직후 한 번 물어본다. ref 로도
  // 들고 있는 이유는 isViewValidForRole 이 role 문자열만 받기 때문이다.
  const [isPlatformManager, setIsPlatformManager] = useState(false);
  const [managerDisplayName, setManagerDisplayName] = useState('');
  const isPlatformManagerRef = useRef(false);
  // 배정 여부를 실제로 확인했는지. isPlatformManager 는 false 로 시작하므로 이 값이
  // 없으면 "아직 모름"과 "담당자 아님"을 구분할 수 없다. 그 구분이 없으면 담당자가
  // /manager 를 새로고침할 때마다 크리에이터 대시보드로 튕겨 나간다.
  const [managerChecked, setManagerChecked] = useState(false);
  const managerCheckedRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  useEffect(() => { isPlatformManagerRef.current = isPlatformManager; }, [isPlatformManager]);
  useEffect(() => { managerCheckedRef.current = managerChecked; }, [managerChecked]);

  // `?kakao_login=1` 은 첫 렌더에 "방금 간편로그인으로 들어왔다"를 알리기 위한
  // 표시일 뿐이다(main.tsx 가 붙인다). 위 초기 상태들이 이미 읽었으니 주소에서
  // 지운다 — 남겨 두면 사용자가 새로고침할 때마다 로그인 직후처럼 취급된다.
  useEffect(() => {
    if (!isKakaoSdkSignedIn()) return;
    const params = new URLSearchParams(window.location.search);
    params.delete('kakao_login');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash
    );
  }, []);

  /**
   * 담당자 배정 여부를 서버에 물어 화면 상태에 반영한다.
   *
   * 로그인 경로가 하나가 아니라서(카카오 OAuth · 아이디+비밀번호 · 세션 복원) 한
   * 곳에서만 물으면 어떤 경로로 들어온 담당자는 계속 일반 사용자로 취급된다. 실제로
   * 아이디 로그인은 인증 이벤트 처리를 건너뛰는 경로여서, 운영자가 담당자로 배정해도
   * 그 계정은 크리에이터 대시보드만 보고 담당자 대시보드에 들어갈 문(플로팅 버튼)조차
   * 뜨지 않았다. 그래서 판정을 이 함수 하나로 모았다.
   *
   * 관리자는 담당자로 보지 않는다 — 관리자의 자리는 운영 콘솔이고, 여기서 담당자로
   * 치면 로그인 직후 운영 콘솔이 아니라 담당자 대시보드로 가게 된다.
   */
  const refreshManagerStatus = useCallback(async (): Promise<boolean> => {
    const status = await apiService.getMyManagerStatus();
    // 확인하지 못했으면 아무것도 바꾸지 않는다. 로그인 직후에는 세션이 막 심어지는
    // 중이라 토큰이 아직 안 붙는 순간이 있는데, 그때의 실패를 확정으로 받으면
    // 배정된 담당자가 일반 대시보드로 떨어진다("가끔" 그랬던 이유다).
    if (!status.checked) return isPlatformManagerRef.current;
    const assigned = !!status.isManager && !status.isAdmin;
    setIsPlatformManager(assigned);
    isPlatformManagerRef.current = assigned;
    setManagerChecked(true);
    managerCheckedRef.current = true;
    setManagerDisplayName(assigned ? status.displayName || '' : '');
    return assigned;
  }, []);

  // Views that are considered "settled" — user should NOT be kicked out of these
  const settledViews: View[] = ['admin', 'operator', 'operator-login', 'user-page', 'setup-link', 'business-admin', 'manager'];

  // Determine if the current view is appropriate for the user's role.
  // Returns true if the user should stay on the current view (no redirect needed).
  const isViewValidForRole = (currentView: View, role: string): boolean => {
    // Operator/admin views: only valid for admin role
    if (currentView === 'operator' || currentView === 'operator-login') {
      return role === 'admin';
    }
    // Admin dashboard: valid for any logged-in user
    if (currentView === 'admin') return true;
    // 담당자 화면은 배정된 계정만. 배정 여부를 아직 못 물었으면 열지 않는다 —
    // 열어 두고 나중에 닫으면 권한 없는 사람이 잠깐이라도 명부를 본다.
    if (currentView === 'manager') return isPlatformManagerRef.current;
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
      // 새로고침할 때마다 "프로필 확인 중" 스피너가 몇 초씩 뜨던 원인.
      // 캐시된 사용자 이름이 이미 있으면 화면을 막지 않고 그대로 대시보드를
      // 보여주고, 프로필 검증은 아래에서 그대로 이어서 한다(끝나면 최신 값으로
      // 덮어쓴다). 캐시가 없는 첫 로그인에서는 예전처럼 확인이 끝날 때까지
      // 기다려야 하므로 그때만 게이트를 닫는다.
      const hasCachedIdentity = !!(sessionGet('picks_user_session') || userNameRef.current);
      if (!hasCachedIdentity) setProfileChecked(false);

      // NON-BLOCKING profile fetch: Use safeFetchProfile with 5s timeout.
      // If the fetch fails or times out, immediately proceed with a fallback
      // (localStorage username or 'Anonymous') so broadcasting/signaling is
      // never delayed. A background retry will update the profile later.
      const fallbackUsername = sessionGet('picks_user_session') || '';
      let profileData: any = await safeFetchProfile(uid, {
        timeoutMs: 5000,
        defaultValue: null,
        onSuccess: (latestProfile: any) => {
          // Background retry succeeded — update UI state with fresh profile data
          console.log('[Auth] Background profile retry succeeded:', latestProfile?.username);
          if (latestProfile?.username) {
            setUserName(latestProfile.username);
            sessionSet('picks_user_session', latestProfile.username);
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

      // 카카오 프로필 보정은 "아직 프로필이 채워지지 않은 경우"에만 필요하다.
      // 이미 username 이 있는 계정이 단순 새로고침한 것이라면, 이 호출은 새로
      // 가져올 정보가 없는데도(provider_token 은 OAuth 콜백에서만 생긴다)
      // 최대 15초까지 기다리게 만들어 대시보드 진입을 늦춘다. 그래서 새 정보가
      // 실제로 있을 때(로그인 직후 또는 프로필 미완성)만 호출한다.
      const hasKakaoHandoff = !!(session.provider_token || capturedProviderToken
        || sessionStorage.getItem('kakao_provider_token')
        || sessionStorage.getItem('kakao_client_phone')
        || sessionStorage.getItem('kakao_client_name'));
      const needsKakaoProfileSetup = !(profileData?.username || '').trim()
        || event === 'SIGNED_IN'
        || hasKakaoHandoff;

      if (isKakaoUser && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && needsKakaoProfileSetup) {
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
              sessionSet('picks_user_session', setupResult.profile.username);
              console.log('[Auth] Kakao profile username persisted to localStorage:', setupResult.profile.username);
            }
          } else {
            console.error('[Debug] Server-side profile setup failed:', setupResult.error);
            // Use localStorage username as fallback when server call fails
            const savedUsername = sessionGet('picks_user_session') || '';
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
          const savedUsernameOnErr = sessionGet('picks_user_session') || '';
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
                const savedName = sessionGet('picks_user_session') || '';
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
      const existingUsername = profileUsername || sessionGet('picks_user_session') || userNameRef.current || emailUsername || '';

      console.log('[Debug] Username resolution:', { profileUsername, localStorage: sessionGet('picks_user_session'), ref: userNameRef.current, emailUsername, final: existingUsername });

      // KEY CHECK: If the user has ANY username (even 1 character), they are an existing user.
      // Only redirect to admin if user is on a non-settled page (login, signup, home).
      // Otherwise, preserve the current path.
      if (existingUsername) {
        const userRole = (profileData?.role || 'user').trim();
        console.log('[Debug] Existing user detected with username:', existingUsername, 'role:', userRole);
        // Clear stale localStorage data from previous user session.
        // 이 탭 슬롯이 가진 키만, 그리고 비즈니스 로그인 키는 남기고 지운다 —
        // 다른 탭에 띄워 둔 비즈니스 · 운영자 계정까지 끊어 버리면 안 된다.
        const prevSessionUser = sessionGet('picks_user_session');
        if (prevSessionUser && prevSessionUser !== existingUsername) {
          const staleKeys = ownPicksKeys(['picks_user_session', ...BUSINESS_SESSION_KEYS]);
          staleKeys.forEach(key => localStorage.removeItem(key));
          console.log('[Auth] Cleared stale localStorage from previous user:', prevSessionUser);
        }
        setUserName(existingUsername);
        setIsLoggedIn(true);
        setProfileRole(userRole);
        sessionSet('picks_user_session', existingUsername);
        setProfileChecked(true);
        // Supabase confirmed a live session, so the optimistic launch was right.
        // From here on, losing the session means a real logout — which belongs on
        // the login page, not the homepage.
        launchedIntoDashboardRef.current = false;

        // 담당자 배정 여부. 관리자는 운영 콘솔로 가므로 물을 필요가 없다.
        // 실패하면 담당자가 아닌 것으로 본다 — 여는 쪽으로 실패하면 안 되는 값이다.
        let managerAssigned = false;
        if (userRole !== 'admin') {
          managerAssigned = await refreshManagerStatus();
        }

        const currentView = viewRef.current;
        // Native app cold start: the shell always loads the site root, so a
        // signed-in user would land on the public marketing homepage and have to
        // tap through to their dashboard every single launch. Treat that first
        // restored session like a login and drop them straight into the
        // dashboard instead. Only the initial page load qualifies
        // (INITIAL_SESSION), so tapping "홈" inside the app still works — and a
        // reload right after doing so is honored via the home-intent marker set
        // by navigate().
        const isAppLaunchOnHome =
          currentView === 'home' &&
          event === 'INITIAL_SESSION' &&
          isNativeApp() &&
          !hasRecentHomeIntent();
        // Only redirect away from the "login" entry page; preserve settled/valid pages.
        // On the web the home page is intentionally NOT auto-redirected: a logged-in
        // user who visits the main homepage stays there and must press a button (e.g.
        // the header "dashboard" link) to move to the dashboard. This prevents the
        // homepage from jumping to the dashboard on its own after a restored session.
        // Exclude 'signup' and 'business-signup' — users who explicitly navigated there should stay
        if (currentView === 'login' || isAppLaunchOnHome) {
          // Redirect logged-in users to dashboard from the login page (and, in the
          // native app, from the launch homepage).
          // This covers fresh logins (OAuth callback) and restored sessions that
          // land on the login page.
          // Set loginTransitioning BEFORE clearing oauthProcessing to prevent
          // a brief flash of the login page between the two state updates.
          setLoginTransitioning(true);
          // 새 로그인이므로 이전 세션의 "크리에이터 대시보드를 보겠다"는 표시는 지운다.
          clearCreatorIntent();
          if (userRole === 'admin') {
            navigate('operator');
          } else if (managerAssigned) {
            // 담당자로 배정된 계정은 담당자 대시보드로. 링크 데이터 유무는
            // 여기서 따지지 않는다 — 담당자에게 필요한 첫 화면은 캠페인이다.
            navigate('manager');
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
          // No session — clear stale local login state if present.
          // 다만 운영자 슬롯은 Netlify Identity 로만 로그인하는 경로가 있어서
          // Supabase 세션이 아예 없을 수 있다. 운영자 토큰이 남아 있으면 이 탭은
          // 정상적으로 로그인된 운영자이므로 건드리지 않는다.
          const operatorStillSignedIn =
            getAccountScope() === 'operator' && !!sessionGet('picks_admin_token');
          if (!operatorStillSignedIn && sessionGet('picks_user_session')) {
            sessionRemove('picks_user_session');
            sessionRemove('picks_last_activity');
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
          const savedUsername = sessionGet('picks_user_session') || userNameRef.current;
          if (savedUsername) {
            setUserName(savedUsername);
            setIsLoggedIn(true);
          }
          // 아이디 로그인은 이 분기로 들어와 processUserSession 을 건너뛴다. 그래서
          // 담당자 배정 여부를 여기서도 물어야 한다 — 묻지 않으면 배정된 계정이
          // 크리에이터 대시보드만 보고, 담당자 대시보드로 가는 버튼도 뜨지 않는다.
          //
          // 세션이 막 만들어진 직후(로그인 처리에서 setSession 을 부른 결과)라서
          // 여기가 배정 여부를 물을 수 있는 첫 시점이다. 화면 이동은 하지 않는다 —
          // 예전에는 여기서 viewRef.current 를 보고 옮겼는데, viewRef 는 렌더가 끝난
          // 뒤의 효과에서 채워지므로 확인이 빨리 끝나면 아직 'login' 이었고 이동이
          // 조용히 버려졌다. 담당자 라우팅은 아래의 선언적 효과 한 곳에서만 한다.
          refreshManagerStatus().catch((e) => console.error('[Auth] 담당자 확인 실패:', e));
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
        const hasLocalSession = sessionGet('picks_user_session');
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

  // Persistent auto-logout after 2 hours of inactivity — desktop only.
  // On mobile (native shell or mobile web) the login is meant to last: see
  // isPersistentLoginEnv(). There the effect exits immediately and drops the
  // stored timestamp, so a session that predates this behaviour can't be
  // logged out by a stale value either.
  // On desktop the check runs on mount BEFORE seeding picks_last_activity so a
  // stale timestamp (e.g. browser closed for 3 hours, or the computer was
  // asleep) is honored and logs the user out instead of being overwritten with
  // "now". The timer is refreshed by real user interaction (mousemove/keydown/
  // scroll/touchstart/click), so passively sitting on any view — public or
  // protected — counts as inactivity once those events stop firing.
  useEffect(() => {
    if (!isLoggedIn) return;
    if (isPersistentLoginEnv()) {
      sessionRemove('picks_last_activity');
      return;
    }

    const INACTIVITY_LIMIT = 2 * 60 * 60 * 1000;
    let loggedOut = false;

    const updateActivity = () => {
      sessionSet('picks_last_activity', Date.now().toString());
    };

    const publicViews: View[] = ['home', 'signup', 'user-page', 'proposal', 'terms', 'privacy', 'business-signup', 'business-login'];

    const silentLogout = async () => {
      setIsLoggedIn(false);
      setUserName('');
      setProfileChecked(false);
      loginNavigationHandledRef.current = false;
      isPlatformManagerRef.current = false;
      setIsPlatformManager(false);
      managerCheckedRef.current = false;
      setManagerChecked(false);
      clearCreatorIntent();
      setManagerDisplayName('');
      // 이 탭 슬롯의 키만 지운다(다른 탭의 계정은 그대로 살아 있어야 한다).
      ownPicksKeys(BUSINESS_SESSION_KEYS).forEach(key => localStorage.removeItem(key));
      ownSupabaseKeys().forEach(key => localStorage.removeItem(key));
      clearTabStateKeepScope();
      clearAllLinkCache();
      if (supabase) { try { await supabase.auth.signOut(); } catch {} }
    };

    const checkInactivity = () => {
      if (loggedOut) return;
      const lastActivity = sessionGet('picks_last_activity');
      if (!lastActivity) return;
      const elapsed = Date.now() - parseInt(lastActivity, 10);
      if (elapsed > INACTIVITY_LIMIT) {
        loggedOut = true;
        console.log(`[Auth] Auto-logout: ${Math.round(elapsed / 60000)}분간 활동 없음 — 세션 종료`);
        if (publicViews.includes(viewRef.current)) {
          silentLogout();
        } else {
          try {
            window.alert('2시간 동안 활동이 없어 자동 로그아웃됩니다.\n보안을 위해 다시 로그인해 주세요.');
          } catch {}
          handleLogout();
        }
      }
    };

    // On mount: honor the stored timestamp BEFORE refreshing it. If the user
    // was idle past the 2-hour window (laptop slept, computer powered off,
    // browser closed), this triggers the logout immediately regardless of
    // which view they land on.
    const stored = sessionGet('picks_last_activity');
    if (stored) {
      const elapsed = Date.now() - parseInt(stored, 10);
      if (elapsed > INACTIVITY_LIMIT) {
        loggedOut = true;
        console.log(`[Auth] Auto-logout on mount: ${Math.round(elapsed / 60000)}분간 활동 없음 — 세션 종료`);
        if (publicViews.includes(viewRef.current)) {
          silentLogout();
        } else {
          try {
            window.alert('2시간 동안 활동이 없어 자동 로그아웃됩니다.\n보안을 위해 다시 로그인해 주세요.');
          } catch {}
          handleLogout();
        }
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
      if (e.key === scopedKey('picks_last_activity')) {
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

  // Business account inactivity timer (separate from regular user timer).
  // Same rule as above: desktop only, mobile logins stay signed in.
  useEffect(() => {
    if (!isBusinessLoggedIn) return;
    if (isPersistentLoginEnv()) {
      localStorage.removeItem('picks_business_last_activity');
      return;
    }

    const INACTIVITY_LIMIT = 2 * 60 * 60 * 1000;
    let loggedOut = false;

    const updateActivity = () => {
      localStorage.setItem('picks_business_last_activity', Date.now().toString());
    };

    const silentBusinessLogout = () => {
      setIsBusinessLoggedIn(false);
      setBusinessUsername('');
      setBusinessCompanyName('');
      BUSINESS_SESSION_KEYS.forEach(key => localStorage.removeItem(key));
    };

    const businessPublicViews: View[] = ['home', 'signup', 'user-page', 'proposal', 'terms', 'privacy', 'business-signup', 'login'];

    const checkInactivity = () => {
      if (loggedOut) return;
      const lastActivity = localStorage.getItem('picks_business_last_activity');
      if (!lastActivity) return;
      const elapsed = Date.now() - parseInt(lastActivity, 10);
      if (elapsed > INACTIVITY_LIMIT) {
        loggedOut = true;
        if (businessPublicViews.includes(viewRef.current)) {
          silentBusinessLogout();
        } else {
          try {
            window.alert('2시간 동안 활동이 없어 자동 로그아웃됩니다.\n보안을 위해 다시 로그인해 주세요.');
          } catch {}
          handleBusinessLogout();
        }
      }
    };

    const stored = localStorage.getItem('picks_business_last_activity');
    if (stored) {
      const elapsed = Date.now() - parseInt(stored, 10);
      if (elapsed > INACTIVITY_LIMIT) {
        loggedOut = true;
        if (businessPublicViews.includes(viewRef.current)) {
          silentBusinessLogout();
        } else {
          try {
            window.alert('2시간 동안 활동이 없어 자동 로그아웃됩니다.\n보안을 위해 다시 로그인해 주세요.');
          } catch {}
          handleBusinessLogout();
        }
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

  // Register the device for native push notifications once a user is signed in.
  // Only the WebView shell exposes PicksFolioNative.registerPush; on the web it
  // is a no-op. This lets the app deliver immediate alerts for new collaboration
  // (chat) messages even when the app is closed.
  useEffect(() => {
    const native = (window as unknown as {
      PicksFolioNative?: { registerPush?: (username: string, userType: string) => void };
    }).PicksFolioNative;
    if (!native || typeof native.registerPush !== 'function') return;
    if (isBusinessLoggedIn && businessUsername) {
      native.registerPush(businessUsername.replace(/^biz\//, ''), 'business');
    } else if (isLoggedIn && userName) {
      native.registerPush(userName, 'influencer');
    }
  }, [isLoggedIn, userName, isBusinessLoggedIn, businessUsername]);

  /**
   * 담당자 라우팅 — 배정된 계정은 담당자 대시보드로만 들어간다.
   *
   * 예전에는 로그인 경로마다(세션 복원 · 인증 이벤트 · 아이디 로그인 안전장치)
   * `viewRef.current === 'admin'` 을 확인하고 navigate 를 불렀다. viewRef 는 렌더가
   * 끝난 뒤의 효과에서 채워지므로, 배정 확인이 빨리 끝나면 그 값이 아직 'login'
   * 이었고 이동이 조용히 버려졌다 — 같은 계정이 어떤 때는 담당자 대시보드로, 어떤
   * 때는 일반 대시보드로 들어가던 이유다. 판정이 끝난 상태를 보고 옮기는 효과 하나로
   * 합쳐서 그 경합을 없앤다.
   *
   * 담당자가 "크리에이터 대시보드" 버튼으로 직접 나온 경우에는 되돌리지 않는다.
   */
  useEffect(() => {
    if (!isLoggedIn || !managerChecked || !isPlatformManager) return;
    if (view !== 'admin') return;
    if (hasCreatorIntent()) return;
    navigate('manager');
  }, [isLoggedIn, managerChecked, isPlatformManager, view]);

  /**
   * /manager 를 직접 열었거나 새로고침한 경우의 배정 확인.
   *
   * 로그인 경로를 거치지 않고 이 주소로 들어오면 아무도 배정 여부를 묻지 않는다.
   * 묻지 않으면 화면은 "권한 확인 중" 에서 멈춘다.
   */
  useEffect(() => {
    if (view !== 'manager' || !isLoggedIn || managerChecked) return;
    refreshManagerStatus().catch((e) => console.error('[Auth] 담당자 확인 실패:', e));
  }, [view, isLoggedIn, managerChecked, refreshManagerStatus]);

  // Clear login transition after a brief delay to allow state to settle
  useEffect(() => {
    // 담당자 대시보드도 로그인 직후 도착지가 될 수 있다. 여기에 'manager' 가 빠져
    // 있으면 그 화면에서는 전환 표시가 8초 안전장치로만 풀려서, 그 사이에 크리에이터
    // 대시보드로 넘어가면 뜬금없는 스피너를 보게 된다.
    if (loginTransitioning && (view === 'admin' || view === 'operator' || view === 'manager') && userName && isLoggedIn) {
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
      sessionSet('picks_user_session', userName);
      import('./components/BusinessTimeline').catch(() => {});
    } else if (!isLoggedIn && wasLoggedInRef.current) {
      sessionRemove('picks_user_session');
      sessionRemove('picks_last_activity');
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

  // 인스타그램 DM 연동 콜백 복귀 — DM 자동화 화면으로 이동한다.
  // (DmAutomation 컴포넌트가 ?ig_connected/?ig_error 를 읽어 배너 표시 후 URL 을 정리한다.)
  //
  // 브랜드 매칭 등록(?collab_match)에서 시작한 연동은 캠페인 화면으로 돌려보낸다.
  // subView 는 URL 이 아니라 상태로만 관리되므로 연동 후 페이지가 새로 뜨면 기본
  // 대시보드로 돌아간다. 그러면 작성 중이던 등록서를 되살릴 화면 자체가 뜨지 않는다.
  // (등록서 복원과 안내 배너는 CollabMatchRegister 가 같은 파라미터를 읽어 처리한다.)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('collab_match')) {
      setSubView('campaigns');
      return;
    }
    // 인사이트 화면에서 시작한 연동(?ig_insights)은 그 화면으로 되돌린다. 아래
    // ig_connected 분기보다 먼저 봐야 한다 — 연동 성공 시 두 파라미터가 함께 붙는다.
    if (params.get('ig_insights')) {
      setSubView('insights');
      return;
    }
    if (params.get('ig_connected') || params.get('ig_error')) {
      setSubView('dm-automation');
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
              sessionSet('picks_user_session', data.username);
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

  /**
   * 협업 현황에서 "캠페인 진행사항 열기"로 지목한 협업.
   *
   * 진행사항 보드는 캠페인 협업(my-collabs) 화면 안에만 있다. 협업 현황이 보드를 한
   * 벌 더 품으면 같은 협업의 상태가 두 화면에서 갈리므로, 이동만 알리고 그리는 일은
   * 원래 자리에 맡긴다.
   */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.collabId) setCollabFocusId(String(detail.collabId));
      setSubView('my-collabs');
    };
    window.addEventListener('navigate-campaign-collab', handler);
    return () => window.removeEventListener('navigate-campaign-collab', handler);
  }, []);

  // Listen for navigate-timeline custom events from BusinessDashboard
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.proposalId) {
        setTimelineProposalId(detail.proposalId);
      }
      setSubView('timeline');
    };
    window.addEventListener('navigate-timeline', handler);
    return () => window.removeEventListener('navigate-timeline', handler);
  }, []);

  // Listen for navigate-membership custom events (e.g. AI assistant upsell)
  useEffect(() => {
    const handler = () => setSubView('membership');
    window.addEventListener('navigate-membership', handler);
    return () => window.removeEventListener('navigate-membership', handler);
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname.replace(/^\//, '');
      if (!path && window.location.hash.includes('invite_token=')) {
        setView('operator-login');
        return;
      }
      if (!path) {
        // First run of a native-app launch that opened the dashboard directly:
        // keep it and align the url with it, instead of resetting to the
        // homepage. Consumed once, so a later Back/popstate to "/" still lands
        // on the homepage as usual.
        const launchView = launchViewRef.current;
        launchViewRef.current = null;
        if (launchView) {
          window.history.replaceState(null, '', `/${launchView}`);
          setView(launchView);
          return;
        }
        setView('home');
      }
      else if (path === 'setup-link') {
        const savedUser = sessionGet('picks_user_session');
        if (savedUser && isLoggedIn) {
          setView('admin');
          window.history.replaceState(null, '', '/admin');
        } else {
          setView('setup-link');
        }
      }
      else if (TOP_LEVEL_VIEWS.includes(path as View)) setView(path as View);
      // sitemap.xml 은 /business/login · /business/signup 을 검색엔진에 제출하는데
      // 화면 이름은 하이픈 표기(business-login)뿐이었다. 슬래시 표기는 아래 else 로
      // 떨어져 "business/login" 을 크리에이터 아이디로 취급했으므로, 검색으로 들어온
      // 업체는 로그인 화면 대신 빈 페이지를 봤다. 두 표기를 같은 화면으로 모은다.
      else if (SLASH_ALIASES[path]) setView(SLASH_ALIASES[path]);
      // /membership 은 netlify.toml 에 리다이렉트까지 있는데(=열리도록 의도한 주소)
      // 화면 이름은 아니다. 멤버십은 대시보드 안의 탭이므로 그 탭을 열어 준다.
      else if (path === 'membership') {
        setSubView('membership');
        setView('admin');
      }
      else if (path.endsWith('/proposal')) {
        // /:username/proposal route
        setTargetUser(path.replace('/proposal', ''));
        setView('proposal');
      }
      // 예약어는 크리에이터 아이디가 될 수 없다. 이 갈래가 없으면 /settings 나
      // /checkout 같은 주소가 "그 이름의 크리에이터" 로 해석돼, 없는 사람의 빈
      // 페이지가 뜬다. 사용자에게는 서비스가 깨진 것으로 보인다.
      else if (RESERVED_PATHS.has(path)) {
        setView('home');
        window.history.replaceState(null, '', '/');
      }
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
    // Remember/forget a deliberate visit to the homepage so the native app's
    // launch redirect can tell "just opened the app" from "tapped 홈".
    if (newView === 'home') markHomeIntent();
    setView(newView);
    window.history.pushState(null, '', path);
    window.scrollTo(0, 0);
  };

  const handleLogout = async () => {
    console.log('Logout process started...');

    // 1. Immediate local cleanup — clear this tab's own picks_ keys but PRESERVE
    //    business session keys, and never touch another slot's keys: 다른 탭에
    //    띄워 둔 비즈니스 · 운영자 로그인은 이 로그아웃과 상관이 없다.
    loginNavigationHandledRef.current = false;
    // 다음 사람이 같은 브라우저로 로그인할 때 앞사람의 담당자 권한이 남아 있으면
    // 안 된다. 서버에 다시 물어 정해질 값이므로 여기서는 비워만 둔다.
    isPlatformManagerRef.current = false;
    setIsPlatformManager(false);
    managerCheckedRef.current = false;
    setManagerChecked(false);
    clearCreatorIntent();
    setManagerDisplayName('');
    setProfileChecked(false);
    setIsLoggedIn(false);
    setUserName('');
    ownPicksKeys(BUSINESS_SESSION_KEYS).forEach(key => localStorage.removeItem(key));
    clearTabStateKeepScope();
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
    //    이 탭 슬롯의 키만 — 다른 계정의 세션까지 지우면 안 된다.
    ownSupabaseKeys().forEach((key) => localStorage.removeItem(key));

    // 4. Immediate feedback
    alert('정상적으로 로그아웃되었습니다.');

    // 5. Force hard redirect using absolute URL
    const loginUrl = window.location.origin + '/login';
    console.log('Redirecting to:', loginUrl);
    window.location.href = loginUrl;
  };

  const handleBusinessLogout = () => {
    // 비즈니스 로그아웃은 비즈니스 키만 건드린다 — 다른 탭의 크리에이터 · 운영자
    // 로그인은 그대로 살아 있어야 한다.
    BUSINESS_SESSION_KEYS.forEach(key => localStorage.removeItem(key));
    setBusinessUsername('');
    setBusinessCompanyName('');
    setIsBusinessLoggedIn(false);
    alert('정상적으로 로그아웃되었습니다.');
    window.location.href = window.location.origin + '/business-login';
  };

  /**
   * 되살릴 수 없는 세션을 만났을 때.
   *
   * `picks_user_session` 만 보고 로그인 상태를 그리기 때문에, Supabase 세션이
   * 끊겨도 화면은 그대로 대시보드다. 그 상태에서는 메뉴마다 서버가 401 을 돌려주고
   * 사용자는 "캠페인 목록이 로그인을 하라고 한다", "DM 자동화를 못 불러온다" 만
   * 보게 된다 — 무엇을 해야 하는지 알 수 없는 화면이다.
   *
   * apiService 가 토큰을 되살리는 데까지 다 실패했을 때만 이 신호가 온다. 그때는
   * 로그인해 있는 척하지 말고 재로그인을 안내한다. 비즈니스 · 운영자 화면은 다른
   * 토큰을 쓰므로 건드리지 않는다.
   */
  useEffect(() => {
    const onAuthLost = () => {
      if (!isLoggedIn) return;
      if (getAccountScope() === 'operator') return;
      const currentView = viewRef.current;
      if (currentView !== 'admin' && currentView !== 'setup-link') return;
      try {
        window.alert('로그인이 만료되었습니다.\n다시 로그인해 주세요.');
      } catch {}
      handleLogout();
    };
    window.addEventListener('picks:auth-lost', onAuthLost);
    return () => window.removeEventListener('picks:auth-lost', onAuthLost);
  }, [isLoggedIn]);

  // Business views
  if (view === 'business-signup') {
    return (
      <LazyRoute>
        <BusinessSignupPage
          onNavigateHome={() => navigate('home')}
          onNavigateLogin={() => navigate('business-login')}
          onSignupSuccess={() => navigate('business-login')}
        />
      </LazyRoute>
    );
  }
  if (view === 'business-login') {
    return (
      <LazyRoute>
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
      </LazyRoute>
    );
  }
  if (view === 'business-admin') {
    if (!isBusinessLoggedIn || !businessUsername) {
      // Redirect to business login — or back to the homepage when this was an
      // app launch on a session that turned out to be dead.
      const fallback: View = launchedIntoDashboardRef.current ? 'home' : 'business-login';
      launchedIntoDashboardRef.current = false;
      setTimeout(() => navigate(fallback), 0);
      return null;
    }
    return (
      <LazyRoute>
        <BusinessEnterpriseDashboard
          businessUsername={businessUsername}
          companyName={businessCompanyName}
          onLogout={handleBusinessLogout}
        />
      </LazyRoute>
    );
  }

  if (view === 'operator-login') return <LazyRoute><OperatorLogin onLoginSuccess={(info) => {
    // 이 탭은 운영자 슬롯이 된다 — 같은 브라우저의 일반 유저 탭과 로그인이
    // 섞이지 않도록 아래 저장은 모두 운영자 슬롯 키로 들어간다.
    const slotChanged = setAccountScope('operator');
    if (info?.username && info?.token) {
      sessionSet('picks_user_session', info.username);
      sessionSet('picks_admin_token', info.token);
      setUserName(info.username);
      setIsLoggedIn(true);
      setProfileChecked(true);
    }
    if (slotChanged && info?.username && info?.token) {
      // 슬롯이 바뀐 탭은 한 번 새로 열어야 Supabase 클라이언트도 이 슬롯으로
      // 다시 만들어진다. 저장은 이미 끝났으므로 그대로 운영 콘솔로 들어간다.
      window.location.href = window.location.origin + '/operator';
      return;
    }
    navigate('operator');
  }} /></LazyRoute>;
  if (view === 'operator') {
    if (!isLoggedIn) {
      setTimeout(() => navigate('operator-login'), 0);
      return null;
    }
    if (!profileChecked && supabase) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-midnight">
          <div className="text-center">
            <div className="w-8 h-8 border-3 border-blue-400/30 border-t-blue-400 rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-slate-400 text-sm">권한 확인 중...</p>
          </div>
        </div>
      );
    }
    return <LazyRoute><OperatorDashboard onLogout={() => navigate('operator-login')} /></LazyRoute>;
  }
  if (view === 'manager') {
    if (!isLoggedIn) {
      setTimeout(() => navigate('login'), 0);
      return null;
    }
    // 배정 확인이 끝나기 전에는 아무것도 렌더하지 않는다. 담당자 여부를 모르는
    // 동안 화면을 열면 배정되지 않은 계정에게 명부가 잠깐 보인다.
    //
    // 여는 쪽으로도, 닫는 쪽으로도 서두르지 않는다. isPlatformManager 는 false 로
    // 시작하므로 판정 전에 "담당자 아님"으로 읽으면 새로고침한 담당자가 매번
    // 크리에이터 대시보드로 튕겨 나간다 — 그래서 판정(managerChecked)이 끝날
    // 때까지는 스피너를 둔다.
    if ((!profileChecked || !managerChecked) && supabase) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="text-center">
            <div className="w-8 h-8 border-3 border-blue-600/30 border-t-blue-600 rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-slate-400 text-sm font-bold">권한 확인 중...</p>
          </div>
        </div>
      );
    }
    if (!isPlatformManager) {
      setTimeout(() => navigate('admin'), 0);
      return null;
    }
    return (
      <LazyRoute>
        <ManagerDashboard
          username={userName}
          displayName={managerDisplayName}
          onLogout={handleLogout}
          onNavigateCreator={() => {
            // 담당자가 직접 나온 것이므로 담당자 라우팅 효과가 되돌리지 않는다.
            markCreatorIntent();
            navigate('admin');
          }}
        />
      </LazyRoute>
    );
  }
  if (view === 'terms') return <LazyRoute><TermsOfService onNavigateHome={() => navigate('home')} /></LazyRoute>;
  if (view === 'privacy') return <LazyRoute><PrivacyPolicy onNavigateHome={() => navigate('home')} /></LazyRoute>;
  if (view === 'proposal') return <LazyRoute><BusinessProposalForm username={targetUser} /></LazyRoute>;
  if (view === 'user-page') return <LazyRoute><UserPage username={targetUser} /></LazyRoute>;
  if (view === 'setup-link') {
    // If user already has a username (existing user), skip setup and go to admin dashboard
    const savedUser = (userName || sessionGet('picks_user_session') || '').trim();
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
          <div className="w-8 h-8 border-3 border-blue-400/30 border-t-blue-400 rounded-full animate-spin"></div>
        </div>
      );
    }
    return (
      <LazyRoute>
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
      </LazyRoute>
    );
  }
  if (view === 'admin') {
    if (!isLoggedIn || !userName) {
      const fallback: View = launchedIntoDashboardRef.current ? 'home' : 'login';
      launchedIntoDashboardRef.current = false;
      setTimeout(() => navigate(fallback), 0);
      return null;
    }
    if (!profileChecked && supabase) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
          <div className="text-center">
            <div className="w-8 h-8 border-3 border-blue-600/30 border-t-blue-600 rounded-full animate-spin mx-auto mb-3"></div>
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
            <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-slate-500 font-bold text-sm">대시보드를 불러오는 중...</p>
          </div>
        </div>
      );
    }

    let subComponent: React.ReactNode = null;

    switch (subView) {
      case 'links':
        subComponent = <LazyRoute><LinkManagement userName={userName} onNavigateMembership={() => setSubView('membership')} /></LazyRoute>;
        break;
      case 'dm-automation':
        subComponent = <LazyRoute><DmAutomation userName={userName} /></LazyRoute>;
        break;
      case 'insights':
        subComponent = <LazyRoute><CreatorInsights userName={userName} /></LazyRoute>;
        break;
      case 'business':
        subComponent = <LazyRoute><BusinessDashboard userName={userName} /></LazyRoute>;
        break;
      case 'calendar':
        subComponent = <LazyRoute><BusinessCalendar userName={userName} /></LazyRoute>;
        break;
      case 'open-schedule':
        subComponent = <LazyRoute><OpenScheduleManagement userName={userName} /></LazyRoute>;
        break;
      case 'settlement':
        subComponent = <LazyRoute><UserSettlement userName={userName} /></LazyRoute>;
        break;
      case 'timeline':
        subComponent = (
          <LazyRoute>
            <BusinessTimeline userName={userName} initialProposalId={timelineProposalId || undefined} />
          </LazyRoute>
        );
        break;
      case 'membership':
        subComponent = <LazyRoute><MembershipPlan userName={userName} /></LazyRoute>;
        break;
      case 'campaigns':
        subComponent = <LazyRoute><UserCampaignBrowse userName={userName} /></LazyRoute>;
        break;
      // 캠페인 협업. 선정된 캠페인을 브랜드 화면과 같은 모양으로 — 캠페인 카드가
      // 깔리고, 하나를 누르면 진행사항 · 인사이트 · 정산 탭이 열린다. 캠페인 찾기
      // (UserCampaignBrowse)에는 이 상자를 얹지 않는다. 새 캠페인을 찾는 자리와
      // 이미 시작한 캠페인을 굴리는 자리는 하는 일이 다르다.
      case 'my-collabs':
        subComponent = <LazyRoute><CreatorCampaignCollabs userName={userName} initialCollabId={collabFocusId || undefined} /></LazyRoute>;
        break;
      default:
        subComponent = null; // AdminDashboard will show default dashboard if children is null
    }

    return (
      <>
        {/* 담당자로 배정된 계정은 자기 크리에이터 대시보드도 그대로 쓴다. 두 화면을
            오갈 길이 없으면 로그인 직후에만 담당자 화면에 갈 수 있게 되므로,
            여기에 들어가는 문을 하나 둔다. */}
        {isPlatformManager && (
          <button
            onClick={() => {
              clearCreatorIntent();
              navigate('manager');
            }}
            className="fixed bottom-5 right-5 z-50 px-4 py-3 bg-slate-900 text-white rounded-2xl shadow-xl text-xs font-black hover:bg-slate-700"
          >
            담당자 대시보드
          </button>
        )}
        <LazyRoute>
        <AdminDashboard
        userName={userName}
        onLogout={handleLogout}
        currentSubView={subView}
        onNavigateDashboard={() => setSubView('dashboard')}
        onNavigateLinks={() => setSubView('links')}
        onNavigateDmAutomation={() => setSubView('dm-automation')}
        onNavigateInsights={() => setSubView('insights')}
        onNavigateBusiness={() => setSubView('business')}
        onNavigateCalendar={() => setSubView('calendar')}
        onNavigateOpenSchedule={() => setSubView('open-schedule')}
        onNavigateTimeline={() => setSubView('timeline')}
        onNavigateMembership={() => setSubView('membership')}
        onNavigateCampaigns={() => setSubView('campaigns')}
        onNavigateMyCollabs={() => setSubView('my-collabs')}
      >
        {subComponent ? (
          <ErrorBoundary key={subView}>
            {subComponent}
          </ErrorBoundary>
        ) : null}
      </AdminDashboard>
        </LazyRoute>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background selection:bg-blue-primary/30 flex flex-col">
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
          <LazyRoute>
          <SignupPage
            initialId={initialId}
            onNavigateHome={() => navigate('home')}
            onNavigateLogin={() => navigate('login')}
            onSignupSuccess={() => navigate('login')}
          />
          </LazyRoute>
        ) : (
          (oauthProcessing || loginTransitioning) ? (
            <div className="min-h-screen flex items-center justify-center bg-midnight">
              <div className="text-center animate-in fade-in duration-300">
                <div className="w-10 h-10 border-3 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-slate-300 font-bold text-sm">{loginTransitioning ? '대시보드를 불러오는 중...' : '카카오 로그인 처리 중...'}</p>
              </div>
            </div>
          ) : (
          <LazyRoute>
          <LoginPage
            onNavigateHome={() => navigate('home')}
            onNavigateSignup={() => navigate('signup')}
            onLoginSuccess={(id, hasSiteData, _phone) => {
              loginNavigationHandledRef.current = true;
              setProfileChecked(true);
              setLoginTransitioning(true);
              // 담당자로 배정된 계정이면 첫 화면은 담당자 대시보드다. 다만 이 시점에는
              // Supabase 세션이 아직 없어서(로그인 화면이 이 콜백 뒤에 setSession 을
              // 부른다) 배정 여부를 물을 수 없다. 그래서 여기서는 예전처럼 크리에이터
              // 대시보드로 가 두고, 세션이 생긴 뒤 확인이 끝나면 담당자 라우팅 효과가
              // 담당자 화면으로 옮긴다. 새 로그인이므로 앞 세션이 남긴 "크리에이터
              // 대시보드를 보겠다"는 표시는 지운다 — 그 표시가 남아 있으면 담당자가
              // 로그인해도 담당자 화면으로 가지 못한다.
              clearCreatorIntent();
              // Clear any previous user's cached data before setting new user.
              // 지우는 범위는 이 탭 슬롯 · 비즈니스 키 제외로 제한한다.
              const prevUser = sessionGet('picks_user_session');
              if (prevUser && prevUser !== id) {
                const staleKeys = ownPicksKeys(['picks_user_session', ...BUSINESS_SESSION_KEYS]);
                staleKeys.forEach(key => localStorage.removeItem(key));
                console.log('[Auth] Cleared previous user localStorage data, switching from', prevUser, 'to', id);
              }
              setUserName(id);
              setIsLoggedIn(true);
              // 인증 이벤트가 오지 않는 경우(세션 심기가 실패했거나 토큰이 비어서
              // 왔을 때)를 위한 안전장치. 아직 판정하지 못했으면 한 번 더 묻는다.
              window.setTimeout(() => {
                if (managerCheckedRef.current) return;
                refreshManagerStatus().catch((e) => console.error('[Auth] 담당자 확인 실패:', e));
              }, 1500);
              if (hasSiteData) {
                navigate('admin');
              } else {
                // No link data — show link management page
                setSubView('links');
                navigate('admin');
              }
            }}
            onAdminLoginSuccess={(info) => {
              // 운영자로 들어온 탭은 운영자 슬롯을 쓴다(로그인 화면에서 이미
              // 표시해 두지만, Netlify Identity 경로로 들어온 경우도 있어 여기서
              // 한 번 더 못 박는다).
              setAccountScope('operator');
              if (info?.username && info?.token) {
                sessionSet('picks_user_session', info.username);
                sessionSet('picks_admin_token', info.token);
                setUserName(info.username);
                setIsLoggedIn(true);
                setProfileChecked(true);
              }
              navigate('operator');
            }}
          />
          </LazyRoute>
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
