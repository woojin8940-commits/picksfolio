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
 *   1. 웹(자바스크립트 키 있음) → 카카오 JS SDK `Auth.authorize()`.
 *                                 휴대폰에서는 카카오톡 앱이 떠서 한 번 눌러
 *                                 로그인하고, PC 에서는 카카오톡 QR 로그인이 뜬다.
 *                                 앱 WebView는 카카오 스킴/인텐트만 외부로 넘긴다.
 *   2. 웹(자바스크립트 키 없음) → 서버(`/api/kakao-auth-url`)가 REST API 키로 만든
 *                                 카카오 인가 주소로 이동한다. 콜백은 우리 도메인의
 *                                 `/auth-callback` 이라 1번과 뒤 처리가 같다.
 *   3. 위 경로가 모두 막힌 경우  → 기존 Supabase OAuth 리다이렉트.
 *
 * 예전에는 1번을 휴대폰에서만 시도했고, 자바스크립트 키가 없으면(지금 사이트가 그
 * 상태다) 조용히 3번으로 떨어져서 웹에서는 간편로그인이 아예 뜨지 않았다. 이제
 * 데스크톱까지 포함한 모든 웹이 1 → 2 순서로 간편로그인을 먼저 시도하고, 2번은
 * 이미 설정된 `KAKAO_REST_API_KEY` 만으로 동작하므로 추가 설정 없이 곧바로 켜진다.
 * 어느 단계든 실패하면 다음 단계로 내려가므로 로그인 자체가 막히는 일은 없다.
 */

import { supabase } from '../services/supabase';
import { loadKakaoSdk } from './externalScripts';

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
/** 위 표시들의 유효 시간. 로그인 한 번에 쓰고 버리는 값이라 짧게 잡는다. */
const HANDOFF_TTL = 10 * 60 * 1000;

/**
 * 카카오로 넘어갔다 돌아올 때까지 남겨 둘 값을 적는다.
 *
 * sessionStorage 만 쓰면 휴대폰에서 자주 잃어버린다 — 카카오톡 앱을 거쳐 돌아오면
 * 브라우저가 새 탭(또는 새 세션)에서 콜백을 여는 경우가 있고, 그러면 sessionStorage
 * 는 비어 있어서 state 대조가 실패했다. 즉 간편로그인이 성공했는데도 폴백으로
 * 떨어져 카카오계정 입력 화면을 다시 보게 됐다. 그래서 localStorage 에도 같이 적고
 * (탭이 바뀌어도 남는다) 시간 제한을 붙여 오래된 값은 쓰지 않는다.
 */
function rememberHandoff(key: string, value: string): boolean {
  let stored = false;
  try {
    sessionStorage.setItem(key, value);
    stored = true;
  } catch {
    // 아래 localStorage 로도 시도한다.
  }
  try {
    localStorage.setItem(key, JSON.stringify({ v: value, t: Date.now() }));
    stored = true;
  } catch {
    // 둘 다 막혔으면(사파리 프라이빗 등) 호출부가 폴백한다.
  }
  return stored;
}

/** `rememberHandoff` 로 적어 둔 값. 없거나 오래됐으면 빈 문자열. */
function readHandoff(key: string): string {
  try {
    const fromSession = sessionStorage.getItem(key);
    if (fromSession) return fromSession;
  } catch {
    // localStorage 를 본다.
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    if (typeof parsed?.v !== 'string' || typeof parsed?.t !== 'number') return '';
    if (Date.now() - parsed.t > HANDOFF_TTL) return '';
    return parsed.v;
  } catch {
    return '';
  }
}

/** 다 쓴 값은 양쪽에서 지운다. */
function forgetHandoff(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // 무시
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // 무시
  }
}

interface KakaoTokens {
  idToken: string;
  accessToken: string;
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
  // state 를 보관할 수 없으면 콜백에서 대조가 안 된다 → 다음 경로로 간다.
  if (!rememberHandoff(STATE_KEY, nonce)) return false;

  kakao.Auth.authorize({
    redirectUri: window.location.origin + CALLBACK_PATH,
    scope: KAKAO_SCOPES,
    state: encodeState({ n: nonce, d: safeDestination(destination) }),
    // 카카오톡 앱으로 넘기는 간편로그인. 기본값이지만 의도를 남겨 둔다.
    throughTalk: true,
  });
  return true;
}

/**
 * 자바스크립트 키 없이 간편로그인을 시작한다.
 *
 * 카카오 인가 주소의 client_id 는 REST API 키인데 그건 서버 전용 환경변수라
 * 브라우저에서 만들 수 없다. 그래서 서버 함수에게 주소만 받아 그리로 이동한다.
 * 콜백은 JS SDK 경로와 똑같이 우리 도메인의 `/auth-callback` 이라, 돌아온 뒤
 * 처리(코드 → ID 토큰 → Supabase 세션)는 한 갈래로 유지된다.
 *
 * 카카오 로그인 화면은 기기에 맞는 간편로그인을 스스로 제공한다 — 휴대폰이면
 * 카카오톡 앱으로 넘기는 버튼, PC 면 카카오톡 QR 로그인이 기본 탭이다.
 */
async function startKakaoRestLogin(destination: string): Promise<boolean> {
  const nonce = randomToken();
  if (!rememberHandoff(STATE_KEY, nonce)) return false;

  const redirectUri = window.location.origin + CALLBACK_PATH;
  const res = await fetch('/api/kakao-auth-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uri: redirectUri,
      state: encodeState({ n: nonce, d: safeDestination(destination) }),
    }),
  });
  const result = await res.json().catch(() => null);
  if (!res.ok || !result?.success || typeof result?.url !== 'string') {
    console.warn('[KakaoLogin] 인가 주소를 받지 못했습니다 —', result?.error || `HTTP ${res.status}`);
    forgetHandoff(STATE_KEY);
    return false;
  }

  window.location.href = result.url;
  return true;
}

export type KakaoLoginRoute = 'redirect' | 'oauth';

/**
 * 카카오 로그인 버튼이 부르는 함수.
 *
 * @param destination 로그인을 마치고 돌아올 우리 사이트 경로(`/login`, `/{아이디}` …).
 * @returns 어느 웹 로그인 경로로 이동했는지.
 */
export async function startKakaoLogin(destination: string): Promise<KakaoLoginRoute> {
  const target = safeDestination(destination);

  // 1) 웹 전체(휴대폰·PC): 자바스크립트 키가 들어와 있으면 JS SDK 간편로그인.
  //    앱 WebView 는 여기서 발생하는 카카오 스킴/인텐트/유니버설 링크만 가로채
  //    카카오톡 앱으로 넘기며, 인증 처리는 그대로 웹 콜백에서 마무리한다.
  try {
    if (await startKakaoSdkLogin(target)) return 'redirect';
  } catch (err) {
    console.warn('[KakaoLogin] JS SDK 간편로그인을 시작하지 못했습니다 — 다음 경로로 진행합니다', err);
  }

  // 2) 웹 전체: 서버가 만들어 준 카카오 인가 주소. 자바스크립트 키가 없어도
  //    간편로그인 화면(카카오톡 앱 · QR)까지 갈 수 있는 경로다.
  try {
    if (await startKakaoRestLogin(target)) return 'redirect';
  } catch (err) {
    console.warn('[KakaoLogin] 간편로그인 주소로 이동하지 못했습니다 — 기존 경로로 진행합니다', err);
  }

  // 3) 위가 모두 막힌 경우: 기존 Supabase OAuth.
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

  // 값이 없으면 아래에서 대조 실패로 처리된다.
  const storedNonce = readHandoff(STATE_KEY);
  forgetHandoff(STATE_KEY);

  const destination = safeDestination(state?.d);

  const giveUp = async (reason: string) => {
    console.warn('[KakaoLogin] 간편로그인 콜백 실패 —', reason);
    const alreadyFellBack = readHandoff(FALLBACK_KEY) === '1' || !rememberHandoff(FALLBACK_KEY, '1');
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

    forgetHandoff(FALLBACK_KEY);
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
