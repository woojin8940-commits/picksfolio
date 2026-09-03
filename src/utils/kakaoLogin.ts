/**
 * 카카오 간편로그인 — 카카오톡 앱과 연동해서 한 번 눌러 로그인한다.
 *
 * 예전에는 어디서든 `supabase.auth.signInWithOAuth({ provider: 'kakao' })` 하나만
 * 썼다. 그건 카카오 인가 페이지로 그냥 리다이렉트하는 REST 플로우인데, 카카오는
 * 그 경로에서 카카오톡 앱으로 넘겨주지 않는다 — 카카오 문서가 못박아 둔 것처럼
 * "모바일 웹 환경에서는 Kakao SDK for JavaScript 의 간편로그인을 사용"해야 앱
 * 연동이 뜬다. 그래서 휴대폰에서 로그인하면 카카오계정 아이디·비밀번호 입력
 * 화면만 나왔다.
 *
 * 이제 환경에 따라 세 경로로 갈라진다. 어느 경로든 마지막은 같다 — 카카오가 준
 * ID 토큰(OpenID Connect)을 `signInWithIdToken` 으로 넘겨 Supabase 세션을 만들기
 * 때문에, 로그인 뒤 처리(App.tsx 의 프로필 생성·연동)는 예전과 완전히 동일한
 * 카카오 identity 를 보게 된다.
 *
 *   1. 네이티브 앱(WebView 셸)  → 셸이 카카오 네이티브 SDK 로 앱-to-앱 로그인.
 *                                 카카오톡이 우리 앱으로 바로 돌아온다.
 *   2. 모바일 웹(사파리·크롬)   → 카카오 JS SDK `Auth.authorize()`.
 *                                 카카오톡 앱이 떠서 한 번 눌러 로그인한다.
 *   3. 데스크톱 / 키 미설정     → 기존 Supabase OAuth 리다이렉트(변화 없음).
 *
 * 설정이 빠져 있거나(자바스크립트 키·OIDC 미설정) 중간에 실패하면 언제나 3번으로
 * 폴백한다. 즉 새 설정이 아직 안 들어간 상태에서도 로그인은 예전처럼 동작한다.
 */

import { supabase } from '../services/supabase';
import { loadKakaoSdk } from './externalScripts';
import { isMobileDevice } from './appEnv';

/**
 * 카카오에 요청하는 동의 항목. 기존 OAuth 경로와 같은 목록을 유지한다 —
 * 알림톡 발송에 쓰는 전화번호와 이름이 여기서 들어온다. `openid` 가 있어야
 * ID 토큰이 발급된다(OpenID Connect).
 */
const KAKAO_SCOPES = 'openid,profile_nickname,account_email,phone_number,name';

/** 카카오 콘솔에 등록해야 하는 Redirect URI 경로. netlify.toml 에서 SPA 로 열린다. */
const CALLBACK_PATH = '/auth-callback';

/** 콜백에서 대조할 CSRF 논스. */
const STATE_KEY = 'picks_kakao_state';
/** 간편로그인이 실패해 기존 OAuth 로 한 번 폴백했다는 표시(무한 왕복 방지). */
const FALLBACK_KEY = 'picks_kakao_fallback';

interface KakaoTokens {
  idToken: string;
  accessToken: string;
}

interface NativeKakaoBridge {
  __PICKSFOLIO_NATIVE_KAKAO__?: boolean;
  PicksFolioNative?: {
    kakaoLogin?: () => Promise<{ idToken?: string; accessToken?: string }>;
  };
}

/** 네이티브 셸이 카카오 SDK 로그인을 붙여 놨는지. */
export function isNativeKakaoLoginAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as NativeKakaoBridge;
  return w.__PICKSFOLIO_NATIVE_KAKAO__ === true && typeof w.PicksFolioNative?.kakaoLogin === 'function';
}

/** 사용자가 카카오톡 화면에서 로그인을 취소한 경우. 오류로 알리지 않는다. */
export function isKakaoLoginCancelled(err: unknown): boolean {
  const message = String((err as { message?: string } | null)?.message || err || '');
  return /cancel/i.test(message);
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function encodeState(payload: { n: string; d: string }): string {
  return btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeState(raw: string): { n: string; d: string } | null {
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(padded));
    if (typeof parsed?.n === 'string' && typeof parsed?.d === 'string') return parsed;
  } catch {
    // 손상된 state 는 실패로 취급한다.
  }
  return null;
}

/** 열린 리다이렉트를 막는다: 돌아갈 곳은 우리 사이트 안의 경로여야 한다. */
function safeDestination(path: string | undefined | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/login';
  return path;
}

/**
 * 카카오가 준 토큰으로 Supabase 세션을 만든다.
 *
 * 액세스 토큰은 `kakao_provider_token` 으로 남겨 둔다. 전화번호·이름은 카카오가
 * user_metadata 로 넘겨주지 않아서 서버(`kakao-profile-setup`)가 이 토큰으로
 * 카카오 API 를 직접 호출해 채운다 — App.tsx 가 이미 이 키를 읽는다.
 */
async function signInWithKakaoTokens({ idToken, accessToken }: KakaoTokens): Promise<void> {
  if (!supabase) throw new Error('서버 연결이 설정되지 않았습니다.');
  if (!idToken) throw new Error('카카오 ID 토큰을 받지 못했습니다.');

  if (accessToken) {
    try {
      sessionStorage.setItem('kakao_provider_token', accessToken);
    } catch {
      // 시크릿 모드 등에서 저장이 막혀도 로그인 자체는 진행한다.
    }
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'kakao',
    token: idToken,
    access_token: accessToken || undefined,
  });
  if (error) throw error;
}

/** 기존 경로. 데스크톱과 모든 폴백에서 쓴다. */
async function startSupabaseKakaoOAuth(destination: string): Promise<void> {
  if (!supabase) throw new Error('서버 연결이 설정되지 않았습니다.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: {
      redirectTo: window.location.origin + safeDestination(destination),
      // 공백 구분(Supabase 규약). 카카오 쪽에서는 콤마로 바뀌어 전달된다.
      scopes: KAKAO_SCOPES.replace(/,/g, ' '),
      // prompt 를 주지 않는다. `prompt=login` 은 카카오계정 재인증을 강제해서
      // 아이디·비밀번호 입력 화면을 띄우고 카카오톡 로그인 버튼을 숨긴다.
    },
  });
  if (error) throw error;
}

/**
 * 카카오 JS SDK 간편로그인 시작. 성공하면 카카오톡 앱(또는 카카오 로그인
 * 페이지)으로 넘어가므로 이 함수는 돌아오지 않는다고 봐도 된다.
 * SDK 를 못 쓰는 상황이면 `false` 를 돌려주고 호출부가 폴백한다.
 */
async function startKakaoSdkLogin(destination: string): Promise<boolean> {
  const kakao = await loadKakaoSdk();
  if (!kakao?.Auth?.authorize) return false;

  const nonce = randomToken();
  try {
    sessionStorage.setItem(STATE_KEY, nonce);
  } catch {
    // state 를 보관할 수 없으면 콜백에서 대조가 안 된다 → 기존 경로로 간다.
    return false;
  }

  kakao.Auth.authorize({
    redirectUri: window.location.origin + CALLBACK_PATH,
    scope: KAKAO_SCOPES,
    state: encodeState({ n: nonce, d: safeDestination(destination) }),
    // 카카오톡 앱으로 넘기는 간편로그인. 기본값이지만 의도를 남겨 둔다.
    throughTalk: true,
  });
  return true;
}

export type KakaoLoginRoute = 'native' | 'redirect' | 'oauth';

/**
 * 카카오 로그인 버튼이 부르는 함수.
 *
 * @param destination 로그인을 마치고 돌아올 우리 사이트 경로(`/login`, `/{아이디}` …).
 * @returns 어느 경로로 처리했는지. `'native'` 면 이 시점에 이미 세션이 만들어졌고,
 *          나머지는 페이지가 카카오로 넘어간 상태다.
 */
export async function startKakaoLogin(destination: string): Promise<KakaoLoginRoute> {
  const target = safeDestination(destination);

  // 1) 네이티브 앱: 카카오톡 앱-to-앱. 카카오톡이 우리 앱으로 되돌아온다.
  if (isNativeKakaoLoginAvailable()) {
    const bridge = (window as unknown as NativeKakaoBridge).PicksFolioNative!;
    const tokens = await bridge.kakaoLogin!();
    await signInWithKakaoTokens({
      idToken: tokens?.idToken || '',
      accessToken: tokens?.accessToken || '',
    });
    return 'native';
  }

  // 2) 모바일 웹: JS SDK 간편로그인만 카카오톡 앱을 띄운다.
  if (isMobileDevice()) {
    try {
      if (await startKakaoSdkLogin(target)) return 'redirect';
    } catch (err) {
      console.warn('[KakaoLogin] 간편로그인을 시작하지 못했습니다 — 기존 경로로 진행합니다', err);
    }
  }

  // 3) 데스크톱 · 설정 미완료 · 실패: 기존 Supabase OAuth.
  await startSupabaseKakaoOAuth(target);
  return 'oauth';
}

/**
 * 간편로그인으로 세션이 이미 만들어진 채 이 페이지가 떴는지.
 *
 * `completeKakaoSdkLogin` 이 앱을 그리기 전에 세션을 만들고 주소를
 * `…?kakao_login=1` 로 되돌려 놓는다. 그래서 App.tsx 는 URL 에 `code` 가 없어도
 * "방금 로그인해서 들어온 페이지"라는 걸 알아야 한다 — 그걸 모르면 처음 가입한
 * 카카오 사용자가 링크네임 설정 화면으로 넘어가지 못하고 로그인 화면에 남는다.
 */
export function isKakaoSdkSignedIn(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('kakao_login') === '1';
}

/** 지금 열린 주소가 카카오 JS SDK 간편로그인 콜백인지. */
export function isKakaoSdkCallback(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.pathname !== CALLBACK_PATH) return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('code') || params.has('error');
}

/**
 * 간편로그인 콜백을 끝낸다. 앱을 그리기 **전에**(main.tsx) 호출한다 — 인가 코드를
 * 세션으로 바꾸고 주소를 원래 가려던 경로로 되돌린 다음 앱이 뜨게 하려는 것이다.
 * 그래야 App.tsx 의 기존 OAuth 처리(`?code=` → `exchangeCodeForSession`)와 부딪히지
 * 않는다. 카카오가 준 code 는 Supabase 가 만든 code 가 아니라서 그 경로로 흘러가면
 * 실패한다.
 */
export async function completeKakaoSdkLogin(): Promise<void> {
  if (!isKakaoSdkCallback()) return;

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code') || '';
  const kakaoError = params.get('error') || '';
  const state = decodeState(params.get('state') || '');

  let storedNonce = '';
  try {
    storedNonce = sessionStorage.getItem(STATE_KEY) || '';
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    // 아래에서 대조 실패로 처리된다.
  }

  const destination = safeDestination(state?.d);

  const giveUp = async (reason: string) => {
    console.warn('[KakaoLogin] 간편로그인 콜백 실패 —', reason);
    let alreadyFellBack = false;
    try {
      alreadyFellBack = sessionStorage.getItem(FALLBACK_KEY) === '1';
      sessionStorage.setItem(FALLBACK_KEY, '1');
    } catch {
      alreadyFellBack = true;
    }
    // 사용자가 직접 취소한 것이면 그대로 돌려보낸다.
    if (!alreadyFellBack && kakaoError !== 'access_denied') {
      try {
        await startSupabaseKakaoOAuth(destination);
        return;
      } catch (err) {
        console.warn('[KakaoLogin] 기존 로그인 경로로도 넘어가지 못했습니다', err);
      }
    }
    window.history.replaceState(null, '', `${destination}${destination.includes('?') ? '&' : '?'}kakao_login=fail`);
  };

  if (kakaoError) return giveUp(`카카오가 오류를 돌려줌(${kakaoError})`);
  if (!code) return giveUp('인가 코드가 없음');
  if (!state || !storedNonce || state.n !== storedNonce) return giveUp('state 불일치');

  try {
    const res = await fetch('/api/kakao-token-exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: window.location.origin + CALLBACK_PATH }),
    });
    const result = await res.json().catch(() => null);
    if (!res.ok || !result?.success || !result?.id_token) {
      return giveUp(result?.error || `토큰 교환 실패(${res.status})`);
    }

    await signInWithKakaoTokens({
      idToken: result.id_token,
      accessToken: result.access_token || '',
    });

    try {
      sessionStorage.removeItem(FALLBACK_KEY);
    } catch {
      // 지우지 못해도 다음 로그인에 지장은 없다.
    }
    // 세션이 만들어졌다. 원래 가려던 곳으로 주소를 되돌리고 앱을 띄운다.
    // `kakao_login=1` 은 App.tsx 가 로그인 폼 대신 로딩 화면을 보여 주는 표시다.
    window.history.replaceState(
      null,
      '',
      `${destination}${destination.includes('?') ? '&' : '?'}kakao_login=1`,
    );
  } catch (err) {
    return giveUp((err as Error)?.message || '알 수 없는 오류');
  }
}
