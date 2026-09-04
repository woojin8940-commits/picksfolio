import { Block, DesignSettings, BusinessProposal, CollabRecord, ProductFolder, OpenScheduleItem, SellerVerification, Settlement } from '../types';
import type { MembershipTier } from '../utils/membershipTiers';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, withTimeout } from './supabase';
import { scopedKey } from '../utils/accountScope';

const BIZ_SESSION_KEY = 'picks_business_session';
const BIZ_TOKEN_KEY = 'picks_business_access_token';
const BIZ_REFRESH_KEY = 'picks_business_refresh_token';
const SUPABASE_STORAGE_KEY = `sb-${SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0]}-auth-token`;

/** `_shared/user-auth.mts` 의 비교 방식과 같게 맞춘다(biz/ 접두사 제거 · 소문자). */
const normalizeAccount = (raw: string | null | undefined): string =>
  (raw || '').replace(/^biz\//, '').trim().toLowerCase();

const readLocal = (key: string): string => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

/** 브라우저에 저장된 일반 회원 Supabase 세션 뭉치. 없으면 null. */
function readStoredSupabaseSession(): Record<string, any> | null {
  try {
    const raw = localStorage.getItem(scopedKey(SUPABASE_STORAGE_KEY));
    if (!raw) return null;
    const stored = JSON.parse(raw);
    // supabase-js v1 은 세션을 currentSession 아래에 넣었다. 둘 다 읽는다.
    const session = stored?.currentSession && typeof stored.currentSession === 'object'
      ? stored.currentSession
      : stored;
    return session && typeof session === 'object' ? session : null;
  } catch {
    return null;
  }
}

/** 저장된 세션 뭉치를 새 토큰으로 갈아끼운다. 모양(user 등)은 그대로 둔다. */
function writeStoredSupabaseSession(next: Record<string, any>): void {
  try {
    const raw = localStorage.getItem(scopedKey(SUPABASE_STORAGE_KEY));
    const stored = raw ? JSON.parse(raw) : null;
    if (stored?.currentSession && typeof stored.currentSession === 'object') {
      localStorage.setItem(
        scopedKey(SUPABASE_STORAGE_KEY),
        JSON.stringify({ ...stored, currentSession: { ...stored.currentSession, ...next } }),
      );
      return;
    }
    localStorage.setItem(scopedKey(SUPABASE_STORAGE_KEY), JSON.stringify({ ...(stored || {}), ...next }));
  } catch {
    // 저장하지 못해도 이번 요청은 새 토큰으로 보낼 수 있다.
  }
}

/** 브라우저에 저장된 일반 회원 Supabase 액세스 토큰. 만료가 가까우면 빈 문자열. */
function persistedSupabaseToken(): string {
  const session = readStoredSupabaseSession();
  const token = String(session?.access_token || '');
  if (!token) return '';
  const expiresAt = tokenExpiresAt(token);
  return !expiresAt || expiresAt - Date.now() > 30_000 ? token : '';
}

/**
 * 지금 화면이 다루고 있는 비즈니스 계정. 비즈니스 대시보드가 켜져 있는 동안만 값이 있다.
 *
 * 브라우저에는 크리에이터 세션(Supabase)과 비즈니스 세션(localStorage 토큰)이 함께
 * 남아 있을 수 있다 — 로그아웃할 때 서로의 키를 일부러 지우지 않기 때문이다. 그래서
 * 이 값 없이는 어느 쪽 토큰으로 보내야 하는지 알 수 없고, 비즈니스 화면의 요청이
 * 크리에이터 토큰으로 나가 서버에서 "다른 계정의 정보에는 접근할 수 없습니다"(403)로
 * 막혔다. 캠페인 등록이 마지막 단계에서 실패한 원인이 이것이다.
 */
let activeBusinessAccount = '';

/** 비즈니스 대시보드가 마운트되는 동안 자기 계정을 등록한다. 빠져나갈 때 비운다. */
export function setActiveBusinessAccount(username: string): void {
  activeBusinessAccount = normalizeAccount(username);
}

/** JWT 만료 시각(ms). 읽을 수 없으면 0 — 그때는 만료 판단을 하지 않는다. */
function tokenExpiresAt(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    const json = JSON.parse(
      decodeURIComponent(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
          .split('')
          .map(ch => `%${`00${ch.charCodeAt(0).toString(16)}`.slice(-2)}`)
          .join(''),
      ),
    );
    return typeof json?.exp === 'number' ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

let businessRefreshInFlight: Promise<string> | null = null;

/**
 * 비즈니스 액세스 토큰을 갱신한다.
 *
 * 비즈니스 로그인은 서버 함수가 대신 로그인해 토큰을 넘겨주는 방식이라 Supabase
 * 클라이언트가 자동 갱신해 주지 않는다. 액세스 토큰 수명은 1시간이라, 캠페인 등록처럼
 * 오래 붙잡고 쓰는 화면에서는 저장할 때 이미 만료돼 있는 일이 흔하다. 리프레시 토큰으로
 * auth 엔드포인트를 직접 불러 갱신하고, 새 토큰을 같은 자리에 저장한다.
 */
async function refreshBusinessToken(refreshToken: string): Promise<string> {
  if (businessRefreshInFlight) return businessRefreshInFlight;
  businessRefreshInFlight = (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return '';
      const data = await res.json().catch(() => null);
      const nextAccess = String(data?.access_token || '');
      if (!nextAccess) return '';
      try {
        localStorage.setItem(BIZ_TOKEN_KEY, nextAccess);
        if (data?.refresh_token) localStorage.setItem(BIZ_REFRESH_KEY, String(data.refresh_token));
      } catch {
        // 저장하지 못해도 이번 요청은 새 토큰으로 보낼 수 있다.
      }
      return nextAccess;
    } catch {
      return '';
    } finally {
      businessRefreshInFlight = null;
    }
  })();
  return businessRefreshInFlight;
}

/** 저장된 비즈니스 토큰. 만료가 가까우면 갱신한 값을 돌려준다. */
async function businessAccessToken(): Promise<string> {
  const token = readLocal(BIZ_TOKEN_KEY);
  const expiresAt = tokenExpiresAt(token);
  // 60초 여유를 둔다 — 요청이 서버에 닿는 사이 만료되는 경계를 피한다.
  if (token && (!expiresAt || expiresAt - Date.now() > 60_000)) return token;

  const refreshToken = readLocal(BIZ_REFRESH_KEY);
  if (!refreshToken) return token;
  const refreshed = await refreshBusinessToken(refreshToken);
  // 갱신에 실패하면 있는 토큰을 그대로 보낸다. 서버가 만료로 판단해 재로그인을 안내한다.
  return refreshed || token;
}

/** 직전 요청에서 실제로 통했던 일반 회원 토큰. 세션 조회가 흔들릴 때의 버팀목. */
let lastKnownSupabaseToken = '';
let primedSupabaseRefreshToken = '';

/**
 * 로그인이 막 끝난 순간의 토큰을 API 계층에 먼저 심어 둔다.
 *
 * 아이디 로그인은 서버 함수가 토큰을 내려주고, 화면은 곧바로 대시보드로 넘어간다.
 * `supabase.auth.setSession()` 은 그 뒤에 끝나므로, 대시보드가 처음 띄우는 요청들
 * (받은 제안 · 협업 목록 · DM 자동화)은 아직 아무 데도 저장되지 않은 세션을 찾다가
 * 인증 헤더 없이 나갔다. 서버는 당연히 401 을 돌려주고, 화면에는 방금 로그인했는데도
 * "로그인이 필요합니다" 가 떴다.
 */
export function primeSupabaseSession(accessToken: string, refreshToken: string): void {
  if (accessToken) lastKnownSupabaseToken = accessToken;
  if (refreshToken) primedSupabaseRefreshToken = refreshToken;
}

/** 만료되지 않은 토큰만 돌려준다. */
function usableToken(token: string, marginMs = 30_000): string {
  if (!token) return '';
  const expiresAt = tokenExpiresAt(token);
  return !expiresAt || expiresAt - Date.now() > marginMs ? token : '';
}

let supabaseRefreshInFlight: Promise<string> | null = null;

/**
 * 마지막 갱신 시도가 "세션이 정말 끝났다"로 끝났는지.
 *
 * 서버에 닿지 못한 것(오프라인 · 5xx)과 서버가 리프레시 토큰을 거절한 것은 전혀
 * 다르다. 앞의 경우까지 재로그인으로 몰면 잠깐 끊긴 네트워크가 로그아웃이 된다.
 */
let supabaseSessionDead = false;

/**
 * 일반 회원 세션을 리프레시 토큰으로 되살린다.
 *
 * `supabase.auth.getSession()` 이 항상 알아서 갱신해 줄 것 같지만, 그렇지 못한
 * 경우가 실제로 있다 — 탭 사이 잠금(navigator.locks)이 얽혀 갱신이 시간 안에 끝나지
 * 않거나, 갱신 요청이 한 번 실패하면 supabase-js 는 세션을 비우고 SIGNED_OUT 을
 * 쏜다. 앱은 `picks_user_session` 을 보고 여전히 로그인 상태로 그리는데, 저장소에는
 * 만료된 액세스 토큰만 남아 있어 이후 모든 요청이 인증 헤더 없이 나갔다. 화면에서는
 * 로그인해 있는데도 캠페인 목록이 "로그인이 필요합니다" 로, DM 자동화가 "설정을
 * 불러오지 못했습니다" 로 보이는 상태가 된다.
 *
 * 리프레시 토큰은 그대로 남아 있으므로 여기서 직접 갱신한다. 비즈니스 계정에 이미
 * 쓰고 있는 방식(`refreshBusinessToken`)과 같다. 성공하면 supabase 클라이언트에도
 * 새 토큰을 넘겨, 다음 갱신 때 이미 회전된 옛 리프레시 토큰을 다시 쓰지 않게 한다.
 */
async function refreshSupabaseSession(): Promise<string> {
  if (supabaseRefreshInFlight) return supabaseRefreshInFlight;

  supabaseRefreshInFlight = (async () => {
    const stored = readStoredSupabaseSession();
    const refreshToken = String(stored?.refresh_token || '') || primedSupabaseRefreshToken;
    if (!refreshToken) {
      // 되살릴 재료 자체가 없다 — 로그아웃됐거나 세션이 지워진 상태다.
      supabaseSessionDead = true;
      return '';
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        // 400 · 401 · 403 은 "이 리프레시 토큰은 더 못 쓴다"는 확정 답이다.
        // 5xx 는 서버 사정이므로 다음 요청에서 다시 시도한다.
        supabaseSessionDead = res.status >= 400 && res.status < 500;
        return '';
      }
      const data = await res.json().catch(() => null);
      const access = String(data?.access_token || '');
      if (!access) return '';
      supabaseSessionDead = false;

      const nextRefresh = String(data?.refresh_token || refreshToken);
      primedSupabaseRefreshToken = nextRefresh;
      lastKnownSupabaseToken = access;

      // 클라이언트가 새 토큰을 쓰게 한다. 여기서 실패하면 저장소에라도 남겨 둬야
      // 다음 페이지 로드가 로그아웃으로 끝나지 않는다.
      let adopted = false;
      if (supabase) {
        adopted = await withTimeout(
          supabase.auth.setSession({ access_token: access, refresh_token: nextRefresh }),
          8_000,
          'setSession',
        )
          .then((r: any) => !r?.error)
          .catch(() => false);
      }
      if (!adopted) {
        writeStoredSupabaseSession({
          ...(stored || {}),
          access_token: access,
          refresh_token: nextRefresh,
          token_type: data?.token_type || 'bearer',
          expires_in: data?.expires_in,
          expires_at: data?.expires_at,
        });
      }
      return access;
    } catch {
      return '';
    } finally {
      supabaseRefreshInFlight = null;
    }
  })();

  return supabaseRefreshInFlight;
}

/**
 * 되살릴 방법이 없는 세션을 화면에 알린다.
 *
 * 여기까지 왔다는 것은 앱은 로그인 상태로 그려져 있는데 서버에 보낼 토큰이 하나도
 * 없다는 뜻이다. 그대로 두면 사용자는 메뉴마다 "로그인이 필요합니다" 만 만나면서
 * 왜 그런지 알 수 없다. App 이 이 신호를 받아 다시 로그인하도록 안내한다.
 */
let authLostNotified = false;

function notifyAuthLost(): void {
  if (authLostNotified) return;
  try {
    if (!localStorage.getItem(scopedKey('picks_user_session'))) return;
  } catch {
    return;
  }
  authLostNotified = true;
  try {
    window.dispatchEvent(new CustomEvent('picks:auth-lost'));
  } catch {
    // 이벤트를 못 쏘더라도 요청 자체는 그대로 진행한다.
  }
}

export interface AuthHeaderOptions {
  /**
   * 이 요청이 다루는 계정. 비즈니스 계정이면 그 계정 토큰으로 보낸다.
   * 생략하면 지금 켜져 있는 비즈니스 대시보드의 계정으로 판단한다.
   */
  account?: string;
}

function isBusinessRequest(opts: AuthHeaderOptions): boolean {
  const requested = normalizeAccount(opts.account);
  const storedBusiness = normalizeAccount(readLocal(BIZ_SESSION_KEY));
  if (!storedBusiness) return false;

  if (!opts.account) return !!activeBusinessAccount && activeBusinessAccount === storedBusiness;

  const explicitlyPrefixed = /^biz\//i.test(opts.account.trim());
  const activeDashboardAccount = !!activeBusinessAccount && requested === activeBusinessAccount;
  return requested === storedBusiness && (explicitlyPrefixed || activeDashboardAccount);
}

let lastKnownBusinessToken = '';

/**
 * 본인 확인이 필요한 API 에 붙일 인증 헤더.
 *
 * 서버(`_shared/user-auth.mts`)는 Supabase 액세스 토큰으로 호출자가 정말 그 계정의
 * 주인인지 확인한다. 일반 회원은 Supabase 세션에서, 비즈니스 계정은 로그인할 때
 * 저장해 둔 토큰에서 가져온다.
 *
 * 두 세션이 동시에 남아 있을 수 있으므로(위 `activeBusinessAccount` 주석) 요청이
 * 다루는 계정이 비즈니스 계정이면 Supabase 세션보다 비즈니스 토큰을 먼저 쓴다.
 */
export async function authHeaders(
  extra: Record<string, string> = {},
  opts: AuthHeaderOptions = {},
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  const useBusinessToken = isBusinessRequest(opts);
  let token = useBusinessToken ? await businessAccessToken() : '';

  if (!useBusinessToken) {
    try {
      const { data } = (await supabase?.auth.getSession()) || { data: null };
      token = data?.session?.access_token || '';
    } catch {
      token = '';
    }
    // 세션을 못 읽었다고 바로 포기하면 인증 헤더 없는 요청이 나가고, 화면은
    // 로그인해 있는데도 "로그인이 필요합니다" 를 본다. 저장소 → 직전 토큰 →
    // 리프레시 순으로 되살릴 수 있는 데까지 되살린다.
    if (!token) token = persistedSupabaseToken();
    if (!token) token = usableToken(lastKnownSupabaseToken);
    if (!token) token = await refreshSupabaseSession();
    // 네트워크가 잠깐 끊긴 것뿐이라면 다음 요청에서 다시 살아난다. 서버가 세션을
    // 확실히 거절했을 때만 재로그인을 안내한다.
    if (!token && supabaseSessionDead) notifyAuthLost();
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    if (useBusinessToken) lastKnownBusinessToken = token;
    else lastKnownSupabaseToken = token;
  }
  return headers;
}

/**
 * 인증이 필요한 조회 요청. 401 이면 세션을 한 번 되살려 다시 부른다.
 *
 * 화면이 처음 뜰 때 나가는 조회들은 실패를 되돌릴 기회가 없다 — 한 번 401 을 받으면
 * 그 자리에 "로그인이 필요합니다" 가 그대로 남는다. 토큰이 잠깐 준비되지 않았을
 * 뿐인 경우(세션 갱신 직전, 로그인 직후)까지 그렇게 끝나지 않도록, 조회에 한해
 * 한 번만 다시 시도한다. GET 이라 다시 불러도 같은 결과다.
 */
async function authedGet(
  url: string,
  build: () => Promise<Record<string, string>>,
): Promise<Response> {
  const res = await fetch(url, { credentials: 'same-origin', headers: await build() });
  if (res.status !== 401) return res;

  const refreshed = await refreshSupabaseSession();
  if (!refreshed) return res;
  return await fetch(url, { credentials: 'same-origin', headers: await build() });
}

/**
 * 협업 API 용 인증 헤더.
 *
 * 협업 화면은 브랜드 · 인플루언서 · 담당자가 같은 엔드포인트를 쓰는데 인증 방식이
 * 다르다 — 서비스 화면은 Supabase 토큰(`authHeaders`)이고, 운영 콘솔은 Netlify
 * Identity 토큰이라 화면에서 명시적으로 넘겨받는다. `token` 이 있으면 담당자 호출.
 */
export async function collabHeaders(token?: string, opts: AuthHeaderOptions = {}): Promise<Record<string, string>> {
  if (token) return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  return await authHeaders({ 'Content-Type': 'application/json' }, opts);
}

/**
 * 페이지 언로드(beforeunload/pagehide) 시점에 쓸 토큰 캐시.
 *
 * `supabase.auth.getSession()` 은 비동기라 탭이 닫히는 중에는 resolve 를 보장할 수 없다.
 * 또 `navigator.sendBeacon` 은 헤더를 실을 수 없어서 인증이 필요한 경로(방송 종료 기록)에
 * 쓸 수 없다. 그래서 평소 호출에서 얻은 토큰을 캐싱해 두고, 언로드 때는 이 값으로
 * `fetch(..., { keepalive: true })` 를 쏜다.
 */
/** 동기적으로 즉시 쓸 수 있는 인증 헤더(언로드 전용). 없으면 빈 객체. */
export function syncAuthHeaders(
  extra: Record<string, string> = {},
  opts: AuthHeaderOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const useBusinessToken = isBusinessRequest(opts);
  const token = useBusinessToken
    ? lastKnownBusinessToken || readLocal(BIZ_TOKEN_KEY)
    : lastKnownSupabaseToken || persistedSupabaseToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * 응답을 기다리다 화면이 멈추지 않도록 시간 제한을 둔 fetch.
 *
 * 화면이 "불러오는 중" 스피너를 걸어 두고 `then` 만 붙여 두면, 요청이 끝나지 않는
 * 상황(인앱 웹뷰에서 연결이 끊겼는데 소켓이 닫히지 않는 경우 등)에서 스피너가
 * 영원히 남는다. 실패는 실패로 끝나야 화면이 "다시 시도"를 제안할 수 있다.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 인증 헤더를 만드는 동안 걸릴 수 있는 시간에도 상한을 둔다.
 *
 * `authHeaders()` 는 Supabase 세션 조회를 기다리는데, 탭 사이 잠금(navigator.locks)
 * 이 얽히면 드물게 아주 오래 걸린다. 여기서 막히면 요청 자체가 시작되지 않아
 * fetch 타임아웃도 소용이 없다. 시간이 지나면 앞선 요청에서 확인한 세션을 재사용해
 * 요청을 계속한다. 캐시도 없으면 서버가 401 로 답하고 화면이 재로그인을 안내한다.
 */
async function authHeadersWithTimeout(
  extra: Record<string, string> = {},
  opts: AuthHeaderOptions = {},
  timeoutMs = 8_000,
): Promise<Record<string, string>> {
  try {
    return await withTimeout(authHeaders(extra, opts), timeoutMs, 'authHeaders');
  } catch (e) {
    console.warn('[API] 인증 헤더 준비가 지연되어 캐시된 세션으로 요청합니다:', e);
    return syncAuthHeaders(extra, opts);
  }
}

/**
 * 저장 요청의 결과. 실패한 이유와 "다시 보내면 될 수 있는 실패인지"를 함께 담는다.
 *
 * `retryable` 이 false 면 같은 요청을 다시 보내도 같은 응답이 온다 — 로그인 만료,
 * 권한 없음, 용량 초과 같은 경우다. 그럴 때 "재시도 중..." 을 띄우면 사용자는
 * 기다리기만 하고 실제로 해야 할 일(다시 로그인 · 이미지 줄이기)을 알 수 없다.
 */
export interface SaveResult {
  ok: boolean;
  /** HTTP 상태. 네트워크 단계에서 끊겼으면 0. */
  status: number;
  /** 서버가 준 사람이 읽을 수 있는 이유. 성공이면 빈 문자열. */
  error: string;
  retryable: boolean;
}

/** 다시 보내면 결과가 달라질 수 있는 상태 코드만 재시도 대상으로 본다. */
function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

export interface SiteData {
  blocks?: Block[];
  design?: DesignSettings;
  profile?: {
    name: string;
    bio: string;
    avatar_url?: string;
    aboutSections?: { id: string; title: string; content: string }[];
  };
  // socials holds simple flags/handles (strings, booleans) plus the
  // customButtons array, so the value type must allow arrays as well.
  socials?: Record<string, string | boolean | unknown[]>;
  portfolio?: any[];
  productFolders?: ProductFolder[];
  openSchedule?: OpenScheduleItem[];
  materials?: any[];
  selectedLiveProductIds?: string[];
  linkGridCategories?: string[];
}

// ─── 인사이트 (인플루언서 본인 화면) ────────────────────────────────────────
//
// 도달·저장수는 권한(instagram_business_manage_insights)이 통했을 때만 내려온다.
// 못 받은 항목은 0 이 아니라 null 이다 — 0 으로 두면 아무도 저장하지 않은 릴스로
// 읽히고, 화면은 "집계 전"과 "실제로 0"을 구분할 수 없게 된다.
export interface InsightReel {
  id: string;
  permalink: string;
  thumbnailUrl: string;
  caption: string;
  timestamp: string;
  views: number;
  reach: number | null;
  saved: number | null;
  /**
   * 공유 수. 인사이트 권한이 통했을 때만 온다 — 도달·저장수와 같은 조건이다.
   * 예전 판 캐시에서 온 응답에는 이 칸이 없어서 undefined 일 수 있다.
   */
  shares?: number | null;
  likes: number;
  comments: number;
  durationSeconds: number | null;
}

export interface CreatorInsightsResponse {
  connected?: boolean;
  needsReauth?: boolean;
  igUsername?: string;
  followers?: number | null;
  following?: number | null;
  /** 최근 구간 팔로워 증감. 스냅샷이 두 개 미만이면 null(아직 말할 수 없다). */
  followerDelta7d?: number | null;
  /** 증감을 계산한 실제 일수. 스냅샷이 이틀치면 7 이 아니라 2 다. */
  followerDeltaDays?: number;
  reels: InsightReel[];
  viewsAvailable?: boolean;
  insightsAvailable?: boolean;
  /**
   * 도달·저장수가 비어 있는 이유가 "권한 승인 전에 발급된 토큰"인 경우 참.
   * 이때만 화면이 재연동을 권한다 — 갱신으로는 권한 범위가 늘어나지 않는다.
   */
  reconnectForInsights?: boolean;
  fetchedAt?: string;
  cached?: boolean;
  cacheTtlMinutes?: number;
  error?: string;
  code?: string;
}

export interface FollowerSeriesPoint {
  /** 'YYYY-MM-DD' (한국 날짜) */
  date: string;
  followers: number;
  following: number;
}

export interface FollowerSeriesResponse {
  days: number;
  points: FollowerSeriesPoint[];
  /** 점이 두 개 미만 — 아직 선을 그릴 수 없다. */
  collecting?: boolean;
  /** 스냅샷이 처음 쌓인 날. 이 날 이전 구간은 물어볼 곳이 없다. */
  firstSnapshotDate?: string;
  error?: string;
}

/**
 * 팔로워 인구통계 한 칸. `key` 는 메타가 준 값 그대로다 — 18-24 / F / KR.
 *
 * 이름 붙이기(남성·여성, 대한민국)는 화면에서 한다. 서버가 한글 이름을 실어 보내면
 * 국가 이름 표가 서버·화면 두 곳에 생기고, 둘이 어긋나는 날이 온다.
 */
export interface DemographicSlice {
  key: string;
  value: number;
}

export interface FollowerDemographicsResponse {
  age: DemographicSlice[];
  gender: DemographicSlice[];
  country: DemographicSlice[];
  /**
   * 비어 있는 이유. 값이 하나라도 왔으면 빈 문자열이다.
   *
   * few_followers(팔로워 100명 미만) · empty(집계 대기) · denied(요청 거절) ·
   * error(그 외). 화면은 이 값으로 빈 자리에 적을 말을 고른다 — "0명"이라고 적으면
   * 안 되는 자리이기 때문이다.
   */
  reason?: '' | 'few_followers' | 'empty' | 'denied' | 'error';
  /** 메타가 인구통계를 주기 시작하는 팔로워 수(=100). 문구를 서버 기준에 맞춘다. */
  minFollowers?: number;
  /** 판정에 쓴 팔로워 수(스냅샷의 마지막 값). */
  followers?: number | null;
  connected?: boolean;
  needsReauth?: boolean;
  /** 이 값을 메타에서 받아 온 시각. 최대 48시간 늦을 수 있음을 함께 적기 위한 값. */
  fetchedAt?: string;
  error?: string;
}

/** 벤치마킹 지표. 분모가 없는 값은 0 이 아니라 null 이다. */
export interface BenchmarkMetrics {
  /** 참여율(%) — (평균 좋아요 + 평균 댓글) ÷ 팔로워 */
  engagement: number | null;
  /** 조회율(%) — 평균 조회수 ÷ 팔로워. 팔로워 밖 도달이 있어 100%를 넘을 수 있다. */
  viewRate: number | null;
  /** 댓글률(%) — 평균 댓글 ÷ 평균 조회수 */
  commentRate: number | null;
  /** 주당 업로드 편수 */
  uploads: number | null;
}

export type BenchmarkMetricKey = keyof BenchmarkMetrics;

export interface BenchmarkResponse {
  /** false 면 견줄 준비가 안 된 상태다 — reason 을 보고 화면이 할 말을 고른다. */
  ok?: boolean;
  reason?: 'no_channel' | 'error';
  /** 표본이 최소선 미만 — 내 값만 보여 주고 평균은 그리지 않는다. */
  collecting?: boolean;
  tier?: 'nano' | 'micro' | 'macro';
  followers?: number;
  me?: BenchmarkMetrics;
  peer?: BenchmarkMetrics | null;
  /** 지표별로 평균에 들어간 계정 수. */
  counted?: Partial<Record<BenchmarkMetricKey, number>>;
  /** 지표별 "상위 O%". 같은 규모 계정 중 내 값 이상인 비율. */
  topPercent?: Partial<Record<BenchmarkMetricKey, number | null>> | null;
  /** 같은 규모의 다른 계정 수(나 제외). */
  sample?: number;
  /** 평균을 말하기 위해 필요한 최소 표본. */
  minSample?: number;
  /** 채널 지표가 있는 전체 인플루언서 수. "쌓이는 중" 안내의 근거. */
  totalCreators?: number;
  error?: string;
}

// ─── 태그된 콘텐츠 (브랜드 계정 화면) ───────────────────────────────────────
//
// 다른 계정이 올린 게시물이라 도달·저장수는 애초에 조회할 수 없다. 조회수도 릴스가
// 우리 서비스에 연동된 인플루언서의 것일 때만 있다 — 없는 값은 0 이 아니라 null 이고,
// 화면은 그 자리를 '—' 로 비운다.
export interface TaggedMediaItem {
  id: string;
  permalink: string;
  thumbnailUrl: string;
  caption: string;
  timestamp: string;
  /** 태그한 계정의 인스타그램 아이디. */
  authorHandle: string;
  /** 그 계정이 우리 서비스 사용자면 사용자명. 아니면 빈 문자열. */
  authorUsername: string;
  mediaType: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  source: 'tags_api' | 'creator_feed' | 'brand_feed';
}

/** 값이 있는 항목만 더한 합계. `counted`/`of` 로 몇 개를 근거로 냈는지 밝힌다. */
export interface TaggedMediaSum {
  total: number;
  counted: number;
  of: number;
}

export interface TaggedMediaResponse {
  connected?: boolean;
  needsReauth?: boolean;
  /** 브랜드 자신의 인스타그램 아이디. 무엇을 기준으로 찾았는지 화면이 밝힌다. */
  igUsername?: string;
  /**
   * 브랜드 계정 자체의 추이. 태그된 콘텐츠 요약과 다른 질문에 답하는 값이라
   * (저쪽은 "누가 우리를 걸었나", 이쪽은 "우리 계정이 자라고 있나") 따로 둔다.
   * 조회에 실패하면 null 이고, 그때 화면은 이 블록을 그리지 않는다.
   */
  account?: {
    followers: number | null;
    following: number | null;
    /** 최근 구간 팔로워 증감. 스냅샷이 두 줄 미만이면 null — 0 과 다른 뜻이다. */
    followerDelta: number | null;
    /** 증감을 계산한 실제 일수. 문구가 "7일"이라고 단정하지 않도록 함께 온다. */
    followerDeltaDays: number;
  } | null;
  items: TaggedMediaItem[];
  /**
   * 브랜드 계정이 직접 올린 게시물.
   *
   * 태그된 콘텐츠 목록과 섞지 않는다 — "누가 우리를 태그했나" 목록에 우리 게시물이
   * 끼면 그건 틀린 목록이다. 월별 추이만 이 배열을 함께 센다.
   */
  ownItems?: TaggedMediaItem[];
  summary?: {
    monthCount: number;
    totalCount: number;
    monthViews: TaggedMediaSum;
    views: TaggedMediaSum;
    likes: TaggedMediaSum;
    comments: TaggedMediaSum;
    authors: number;
    /** 브랜드 계정이 이번 달 올린 게시물 수. */
    monthOwnCount?: number;
    ownCount?: number;
    ownViews?: TaggedMediaSum;
    /** 태그된 콘텐츠 + 브랜드 계정 게시물을 합친 조회수. 화면의 "총 조회수". */
    allViews?: TaggedMediaSum;
    /** 같은 합계의 이번 달 구간. */
    monthAllViews?: TaggedMediaSum;
  };
  /**
   * 메타 tags 엣지 결과. 인스타그램 로그인 방식 토큰에서는 거부되는 것이 정상이라
   * (메타 문서: "This API setup cannot access ads or tagging") 실패를 오류로 다루지
   * 않고 사유만 받는다 — 목록은 연동된 인플루언서 피드에서 채워진다.
   */
  tagsApi?: { ok: boolean; reason: string | null };
  /** 캡션에서 우리 계정 언급을 찾은 연동 인플루언서 수. */
  scannedCreators?: number;
  /** 이번 조회에서 조회수를 직접 받아 채운 콘텐츠 수. */
  viewsFilled?: number;
  /**
   * 조회수가 비어 있는 이유를 세어 둔 값.
   *
   * '—' 가 나오는 이유는 하나가 아니다 — 올린 계정이 우리 서비스 연동 계정이 아니라
   * 물어볼 토큰이 없었거나(noToken), 물어봤는데 메타가 아직 값을 주지 않은 경우다.
   * 화면은 이 값으로 그 둘을 구분해 말한다.
   */
  viewsFill?: {
    candidates: number;
    attempted: number;
    filled: number;
    /** 이미 받아 둔 값(크리에이터 인사이트 캐시)으로 채운 수. */
    fromCache?: number;
    noToken: number;
  };
  fetchedAt?: string;
  cached?: boolean;
  cacheTtlHours?: number;
  error?: string;
  code?: string;
}

// 인스타그램 DM 자동화 규칙 및 설정.
export type DmTrigger = 'welcome' | 'new_follower' | 'comment_keyword' | 'story_reply' | 'new_order';

export interface DmRule {
  id: string;
  trigger: DmTrigger;
  keyword?: string;
  message: string;
  enabled: boolean;
}

/** 자동 발송 활동 기록 한 건(진단 패널에 그대로 보여준다). */
export interface DmLogEntry {
  at: string;
  /** 'dm' | 'reply' — 자동 DM 인지 공개 답글인지. */
  kind?: string | null;
  /** 'sent' | 'failed' | 'skipped' | 'external' */
  status?: string | null;
  /** 건너뛴 이유 코드('switch_off' | 'not_connected' | 'plan_required'). */
  reason?: string | null;
  ruleName?: string | null;
  error?: string | null;
  errorKind?: string | null;
  /** 인사말 같은 부가 메시지가 빠진 경우의 사유(실패가 아니다). */
  followUpSkipped?: string | null;
}

export interface DmAutomationSettings {
  enabled: boolean;
  connected: boolean;
  igUserId: string;
  igAccountId: string;
  igUsername: string;
  hasAccessToken: boolean;
  automations: DmAutomationItem[];
  rules?: DmRule[];
  /** 인스타그램 장기 토큰 만료 시각(ISO). 만료되면 재연동이 필요하다. */
  tokenExpiresAt?: string;
  updatedAt?: string;
  // 디엠 자동화는 프로 플랜 전용 — 서버가 계정 자격을 함께 내려준다.
  entitled?: boolean;
  requiredTier?: MembershipTier;
  /**
   * 이 앱이 보내지 않은 자동 DM 이 감지된 경우의 기록.
   *
   * 인스타그램 계정에는 이 서비스 말고도 댓글에 자동 DM 을 보내는 경로가 있다
   * (인스타그램/메타 자체 자동 메시지, 예전에 연결해 둔 다른 자동화 서비스).
   * 이런 발송은 여기 설정과 무관해서, 문구를 바꾸거나 자동 발송을 꺼도 예전 문구가
   * 계속 도착한다. 감지되면 화면에서 그 사실과 끄는 방법을 안내한다.
   */
  externalDm?: { text: string; at: string; count: number } | null;
  /**
   * 발신 에코(`message_echoes`) 웹훅 구독 여부. false 면 이 앱을 거치지 않고
   * 나간 자동 DM 을 감지할 수 없다.
   */
  echoSubscribed?: boolean;
  /** 계정별 웹훅 구독(`subscribed_apps`)을 마친 시각. 비어 있으면 구독 자체가 없다. */
  webhookSubscribedAt?: string;
  /** 실제로 구독에 성공한 웹훅 필드 목록. */
  webhookFields?: string;
  /**
   * 자동 발송 진단 정보.
   *
   * 자동 발송이 안 될 때, 인스타그램이 이벤트를 보내지 않는 것인지(웹훅 구독 문제)
   * 받고도 건너뛴 것인지(플랜·스위치·중복)를 화면에서 구분하기 위한 값이다.
   */
  diagnostics?: {
    /** 이 계정으로 웹훅 이벤트가 마지막으로 도착한 시각. */
    lastWebhookAt?: string | null;
    /** 최근 발송·건너뜀 기록(최신 순). */
    recentLog?: DmLogEntry[];
  };
  /**
   * 서버 응답을 받지 못했다는 표시(네트워크·타임아웃·인증 실패). 이 값이 true 면
   * 나머지 필드는 "모른다"는 뜻이므로, 화면은 설정이 아니라 재시도 안내를 보여준다.
   */
  loadError?: boolean;
}

// 인포크 링크식 "댓글 → DM" 자동화 항목.
export interface DmMessageButton {
  id: string;
  label: string;
  url: string;
}

/**
 * 캐러셀(제네릭 템플릿) 카드 — 이미지 + 제목/설명 + 버튼.
 *
 * `imageUrl` 은 인스타그램이 발송 시점에 서버에서 직접 받아가는 주소다. 그래서
 * 상대 경로(`/api/images/...`)나 브라우저 안에서만 유효한 값(`blob:`, `data:`)은
 * 쓸 수 없고, 공개된 http/https 절대주소여야 한다. 업로드/피드 복사 경로가 모두
 * 공개 저장소의 절대주소를 돌려주는 이유다.
 */
export interface DmCarouselCard {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  buttonLabel: string;
  buttonUrl: string;
}

/** 카드 이미지 한 장의 크기 상한. 인스타그램이 받아가지 못할 만큼 큰 파일을 미리 막는다. */
export const DM_CARD_IMAGE_MAX_MB = 8;
export const DM_CARD_IMAGE_MAX_BYTES = DM_CARD_IMAGE_MAX_MB * 1024 * 1024;

export interface DmAutomationItem {
  id: string;
  name: string;
  enabled: boolean;
  commentMatch: 'all' | 'keyword';
  keywords: string[];
  replyEnabled: boolean;
  replies: string[];
  followFilter: 'all' | 'followers' | 'non_followers';
  // 적용 대상 게시물 — 'all' 이면 모든 게시물, 'selected' 이면 mediaIds 목록만.
  mediaScope: 'all' | 'selected';
  mediaIds: string[];
  // 메시지 형식 — 'text'(텍스트+버튼) 또는 'carousel'(캐러셀 카드).
  messageType: 'text' | 'carousel';
  message: string;
  /**
   * 캐러셀 앞에 먼저 보낼 인사말(선택).
   *
   * `message` 를 재사용하지 않는다 — 텍스트 형식으로 써 둔 본문이 형식만 캐러셀로
   * 바꿨다고 갑자기 함께 발송되면, 사용자가 화면에서 본 적 없는 문구가 나간다.
   */
  cardIntro?: string;
  buttons: DmMessageButton[];
  cards: DmCarouselCard[];
  createdAt: string;
  /**
   * 이 자동화를 마지막으로 저장한 시각(서버가 찍는다). 조건이 겹치는 자동화가
   * 여러 개일 때 발송기가 "가장 최근에 설정한 것"을 고르는 기준이다.
   */
  updatedAt?: string;
}

// 연동된 인스타그램 계정의 피드 게시물.
export interface InstagramMedia {
  id: string;
  caption: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl: string;
  permalink: string;
  timestamp: string;
}

// Claude plan credit wallet — public shape returned by /api/claude-credits.
export interface ClaudeCreditUsage {
  at: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  // Raw inference cost in ₩ (operator bookkeeping); the member is charged in credits.
  costKrw: number;
  chargedCredits: number;
}

export interface ClaudeCreditsResponse {
  success?: boolean;
  credits: {
    planActive: boolean;
    planActivatedAt: string | null;
    // Wallet balance in credits (the unit shown to the member), not ₩.
    balanceCredits: number;
    recentUsage: ClaudeCreditUsage[];
    // 환불(결제 취소)로 회수된 누적 크레딧/금액. 잔액이 줄어든 이유를 안내하는 데 쓴다.
    refundedCredits?: number;
    refundedKrw?: number;
  };
  activationPriceKrw: number;
  activationGrantCredits: number;
  rechargePacksKrw: number[];
  // Credits granted per ₩ paid (used to show how many credits a ₩ pack buys).
  creditsPerKrw: number;
  marginMultiplier?: number;
}

// Orderer (주문자) + shipping address (배송지) collected at live checkout.
// Reused across orders by persisting it per-viewer via the shipping-profile API.
export interface ShippingProfile {
  ordererName: string;
  ordererPhone: string;
  recipientName: string;
  recipientPhone: string;
  postcode?: string;
  address1: string;
  address2?: string;
  memo?: string;
}

export interface LiveOrderInfo {
  paymentId: string;
  amount: number;
  paidAt: string;
  status: string;
  orderName?: string;
  batchPaymentId?: string;
  product: {
    id: string;
    name: string;
    link?: string;
    image?: string;
    selectedOptions?: Record<string, string>;
  };
  viewer: {
    viewerId: string;
    nickname?: string;
    profileImage?: string;
  };
  shipping?: Partial<ShippingProfile>;
}

// ─────────────────────────────────────────────────────────────────────────
// Client-side caches. Site data and seller verification are fetched on every
// dashboard navigation; without caching each menu switch re-hits the network
// and the UI flashes empty (products/content "사라진 것처럼") or shows the
// membership gate before verification resolves. A short in-memory cache plus
// in-flight de-duplication makes repeat navigation instant while keeping the
// data fresh; the seller verification is additionally mirrored to
// localStorage so the very first paint after a reload is already correct.
// ─────────────────────────────────────────────────────────────────────────
const SITE_DATA_TTL = 60 * 1000; // 1 minute
const siteDataCache: Record<string, { data: SiteData; ts: number }> = {};
const siteDataInflight: Record<string, Promise<SiteData | null>> = {};

const VERIFICATION_TTL = 5 * 60 * 1000; // 5 minutes
const verificationCache: Record<string, { data: SellerVerification | null; ts: number }> = {};

const verifKey = (username: string) => `picks_verif_${username.toLowerCase()}`;

const writeVerificationCache = (username: string, data: SellerVerification | null) => {
  const key = username.toLowerCase();
  verificationCache[key] = { data, ts: Date.now() };
  try {
    if (data) localStorage.setItem(verifKey(username), JSON.stringify(data));
  } catch {
    // localStorage may be unavailable (private mode) — memory cache still works.
  }
};

/** 협업 API 를 어느 화면에서 부르는지. 서버가 역할을 고를 때 쓴다. */
export type CollabViewerRole = 'brand' | 'influencer' | 'manager';

export const apiService = {
  async getSiteData(username: string, opts?: { force?: boolean }): Promise<SiteData | null> {
    const key = username.toLowerCase();
    const cached = siteDataCache[key];
    if (!opts?.force && cached && Date.now() - cached.ts < SITE_DATA_TTL) {
      return cached.data;
    }
    // De-duplicate concurrent requests (multiple components mount at once).
    if (!opts?.force && key in siteDataInflight) {
      return siteDataInflight[key];
    }

    const request = (async () => {
      try {
        const res = await fetch(`/api/site/${encodeURIComponent(key)}`);
        if (!res.ok) return null;
        const data = (await res.json()) as SiteData;
        siteDataCache[key] = { data, ts: Date.now() };
        return data;
      } catch (e) {
        console.error('[API] Failed to get site data:', e);
        return null;
      } finally {
        delete siteDataInflight[key];
      }
    })();

    siteDataInflight[key] = request;
    return request;
  },

  /**
   * 저장 결과를 이유까지 붙여 돌려준다.
   *
   * 예전에는 `res.ok` 만 돌려줬다. 그래서 화면은 실패를 알아도 왜 실패했는지 알 수
   * 없었고, 로그인 만료(401)나 용량 초과(413)처럼 다시 보내도 결과가 같은 실패에도
   * "재시도 중..." 을 띄우고 같은 요청을 한 번 더 보냈다. 사용자에게는 원인을 알
   * 수 없는 경고만 남았다.
   */
  async saveSiteDataResult(username: string, data: Partial<SiteData>): Promise<SaveResult> {
    try {
      const res = await fetch(`/api/site/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(data)
      });
      if (res.ok) {
        // Keep the cache in sync with what we just persisted so a subsequent
        // navigation doesn't briefly render pre-save data. Create the entry even
        // when nothing was cached yet, so the very next read is immediately fresh.
        const key = username.toLowerCase();
        const cached = siteDataCache[key];
        const base = (cached?.data || {}) as SiteData;
        siteDataCache[key] = { data: { ...base, ...data }, ts: Date.now() };
        return { ok: true, status: res.status, error: '', retryable: false };
      }

      const body = await res.json().catch(() => null);
      const error = String(body?.error || '') || `HTTP ${res.status}`;
      console.error('[API] Failed to save site data:', res.status, error);
      return { ok: false, status: res.status, error, retryable: isRetryableStatus(res.status) };
    } catch (e) {
      // 네트워크가 끊겼거나 함수가 응답 없이 끝난 경우. 이건 다시 보내면 될 수 있다.
      console.error('[API] Failed to save site data:', e);
      return { ok: false, status: 0, error: '네트워크 연결을 확인해 주세요.', retryable: true };
    }
  },

  async saveSiteData(username: string, data: Partial<SiteData>): Promise<boolean> {
    return (await apiService.saveSiteDataResult(username, data)).ok;
  },

  async uploadImage(username: string, blob: Blob, filename: string): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append('image', blob, filename);
      formData.append('username', username.toLowerCase());

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃

      const res = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const { url } = await res.json();
      return url;
    } catch (e) {
      console.error('[API] Failed to upload image:', e);
      return null;
    }
  },

  // Live State API
  async getLiveState(username: string): Promise<{ isLive: boolean; viewerCount: number; currentProduct?: any; activeMaterial?: any } | null> {
    try {
      const res = await fetch(`/api/live/${encodeURIComponent(username.toLowerCase())}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get live state:', e);
      return null;
    }
  },

  async saveLiveState(username: string, state: { isLive: boolean; viewerCount: number; currentProduct?: any; activeMaterial?: any; broadcastTitle?: string; startedAt?: string; heartbeatAt?: number }): Promise<boolean> {
    try {
      const res = await fetch(`/api/live/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(state)
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to save live state:', e);
      return false;
    }
  },

  // Business Proposals API
  async submitProposal(username: string, proposal: Omit<BusinessProposal, 'id' | 'influencer_username' | 'status' | 'created_at'>): Promise<boolean> {
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proposal)
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to submit proposal:', e);
      return false;
    }
  },

  async getProposals(username: string): Promise<BusinessProposal[]> {
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.proposals || [];
    } catch (e) {
      console.error('[API] Failed to get proposals:', e);
      return [];
    }
  },

  async updateProposalStatus(username: string, proposalId: string, status: 'accepted' | 'rejected' | 'completed', rejectionReason?: string): Promise<boolean> {
    try {
      const body: any = { status };
      if (status === 'rejected' && rejectionReason) {
        body.rejection_reason = rejectionReason;
      }
      const res = await fetch(`/api/proposals/${encodeURIComponent(username.toLowerCase())}/${proposalId}`, {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to update proposal status:', e);
      return false;
    }
  },

  async deleteProposal(username: string, proposalId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(username.toLowerCase())}/${proposalId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to delete proposal:', e);
      return false;
    }
  },

  /**
   * 비즈니스 제안 현황에서 한 줄 내리기.
   *
   * `scope: 'hide'` 는 캠페인 협업 줄이다 — 업체 목록에서만 내리고 협업 자체는
   * 그대로 둔다(인플루언서 진행사항과 담당자 큐가 함께 사라지면 안 된다).
   * 그 밖은 업체가 보낸 비즈니스 제안이라 실제로 지운다.
   */
  async deleteBusinessProposal(
    businessUsername: string,
    itemId: string,
    scope?: 'hide',
  ): Promise<boolean> {
    try {
      const clean = businessUsername.replace(/^biz\//, '').toLowerCase();
      const query = scope === 'hide' ? '?scope=hide' : '';
      const res = await fetch(
        `/api/business-proposals/${encodeURIComponent(clean)}/${encodeURIComponent(itemId)}${query}`,
        { method: 'DELETE', headers: await authHeaders() },
      );
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to delete business proposal:', e);
      return false;
    }
  },

  /**
   * 첨부 파일을 올린다. 파일은 우리 서버를 지나가지 않는다.
   *
   * 예전에는 파일을 함수로 보내고 함수가 저장소에 옮겼다. 함수의 요청 본문 한도가
   * 약 6MB 이고 그 한도는 함수 코드가 실행되기 전에 걸리므로, 초안 영상(보통
   * 20~100MB)은 어떻게 해도 통과할 수 없었다. 파일을 3MB 조각으로 잘라 여러 번
   * 보내는 방법으로 한도를 피해 봤지만, 그건 한 번에 큰 파일을 보낼 방법이 아니라
   * 한도를 우회하려고 요청 수를 늘린 것이었다(100MB 면 34번).
   *
   * 지금은 두 걸음이다.
   *   1. 서버에서 업로드용 링크만 받는다(짧은 JSON 한 번, 파일 크기와 무관).
   *   2. 브라우저가 그 링크로 스토리지에 파일을 곧장 올린다.
   *
   * 진행률은 XMLHttpRequest 로 읽는다. fetch 는 업로드 진행 상황을 알려주지 않아서,
   * 조각을 나눠 보낼 때는 "몇 번째 조각까지 갔는지"로 진행률을 대신 나타내야 했다. 이제는
   * 실제로 올라간 바이트를 그대로 쓰므로 100MB 짜리 한 개도 매끄럽게 채워진다.
   *
   * 실패는 서버·스토리지가 보낸 문장을 그대로 담아 돌려준다. "파일 업로드에
   * 실패했습니다." 한 마디로 접으면, 형식이 안 맞는지 너무 큰지 통신이 끊긴 건지
   * 사람이 알 수 없다.
   */
  async uploadAttachment(
    username: string,
    file: File,
    onProgress?: (ratio: number) => void,
    /**
     * 저장 폴더 앞에 붙는 이름. 기본값은 제안서 첨부다. 다른 용도(디엠 카드 이미지 등)는
     * 자기 이름을 넘겨, 나중에 경로만 보고 무엇에 쓰인 파일인지 구분할 수 있게 한다.
     */
    ownerPrefix: string = 'proposals',
  ): Promise<{ url?: string; error?: string }> {
    const owner = `${ownerPrefix}-${username.toLowerCase()}`;

    // 서버 응답에서 사람에게 보여줄 사유를 꺼낸다. JSON 이 아닐 수도 있다 — 그때는
    // 상태 코드로 말을 만든다.
    const reasonOf = async (res: Response): Promise<string> => {
      try {
        const data = await res.json();
        if (data?.error) return String(data.error);
      } catch {
        /* 아래 기본 문장으로 */
      }
      if (res.status === 413) return '파일이 너무 큽니다.';
      if (res.status === 415) return '이미지·영상·PDF 파일만 올릴 수 있습니다.';
      return `업로드에 실패했습니다. (${res.status})`;
    };

    try {
      // ① 올릴 자리와 서명된 링크를 받는다. 형식·크기 검사도 이 단계에서 끝난다 —
      //    거절될 파일을 몇 분 동안 올려보내고 나서 알게 되는 일이 없다.
      const signRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: owner,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      });
      if (!signRes.ok) return { error: await reasonOf(signRes) };

      const sign = await signRes.json();
      const uploadUrl = String(sign?.uploadUrl || '');
      const publicUrl = String(sign?.publicUrl || '');
      if (!uploadUrl || !publicUrl) return { error: '업로드를 시작할 수 없습니다.' };

      // ② 브라우저 → 스토리지. 우리 함수는 이 구간에 없다.
      const sent = await new Promise<{ error?: string }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        // 형식은 서버가 확장자를 보고 정한 값을 쓴다. 브라우저가 보낸 file.type 은
        // 비어 있거나 틀릴 수 있고(.mov 등), 그대로 저장되면 재생할 때 형식을 몰라
        // 열리지 않는다.
        xhr.setRequestHeader('content-type', String(sign?.contentType || 'application/octet-stream'));
        xhr.setRequestHeader('cache-control', 'max-age=31536000');
        // 경로는 매번 새로 만들어지므로 덮어쓸 일이 없다. 실수로 덮어쓰지 않게 끈다.
        xhr.setRequestHeader('x-upsert', 'false');

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve({});
          // 스토리지가 보낸 사유를 그대로 쓴다. 크기 상한을 넘으면 여기로 온다.
          let message = '';
          try {
            const data = JSON.parse(xhr.responseText || '{}');
            message = String(data?.message || data?.error || '');
          } catch {
            /* 본문이 JSON 이 아니면 상태 코드로 */
          }
          if (xhr.status === 413 || /EntityTooLarge|exceeded the maximum/i.test(message)) {
            return resolve({ error: '파일이 저장소 허용 크기를 넘습니다. 더 짧게 잘라 올려 주세요.' });
          }
          resolve({ error: message || `업로드에 실패했습니다. (${xhr.status})` });
        };
        xhr.onerror = () => resolve({ error: '업로드 중 연결이 끊겼습니다. 다시 시도해 주세요.' });
        xhr.onabort = () => resolve({ error: '업로드가 취소됐습니다.' });
        xhr.send(file);
      });
      if (sent.error) return { error: sent.error };

      onProgress?.(1);
      return { url: publicUrl };
    } catch (e) {
      console.error('[API] Failed to upload attachment:', e);
      return { error: '업로드 중 연결이 끊겼습니다. 다시 시도해 주세요.' };
    }
  },

  /** 예전 호출부를 위한 얇은 겉면. 사유가 필요한 화면은 uploadAttachment 를 쓴다. */
  async uploadProposalAttachment(username: string, file: File): Promise<string | null> {
    const res = await apiService.uploadAttachment(username, file);
    if (res.error) console.error('[API] Failed to upload proposal attachment:', res.error);
    return res.url || null;
  },

  /**
   * 캐러셀 카드에 넣을 이미지를 올린다.
   *
   * 첨부 업로드와 같은 경로(브라우저 → 스토리지)를 쓰되 폴더만 따로 둔다. 중요한 건
   * 돌려주는 값이 공개 절대주소라는 점이다 — 인스타그램은 발송할 때 이 주소로 직접
   * 이미지를 받아가므로, 우리 화면에서만 열리는 주소를 저장하면 카드가 이미지 없이
   * 도착한다.
   */
  async uploadDmCardImage(
    username: string,
    file: File,
    onProgress?: (ratio: number) => void,
  ): Promise<{ url?: string; error?: string }> {
    if (file.type && !file.type.startsWith('image/')) {
      return { error: '이미지 파일만 카드에 넣을 수 있습니다. (JPG · PNG · WEBP)' };
    }
    if (file.size > DM_CARD_IMAGE_MAX_BYTES) {
      return {
        error: `이미지가 큽니다. ${DM_CARD_IMAGE_MAX_MB}MB 이하로 올려 주세요. (현재 ${(file.size / (1024 * 1024)).toFixed(1)}MB)`,
      };
    }
    return apiService.uploadAttachment(username, file, onProgress, 'dm-cards');
  },

  /**
   * 인스타그램 피드 사진을 카드 이미지로 복사한다.
   *
   * 피드 이미지 주소를 그대로 카드에 저장하면 안 된다. 인스타그램 CDN 주소는 서명이
   * 붙어 있어 며칠 뒤 만료되고, 그때부터 카드는 이미지 없이 도착한다(설정은 그대로인데
   * 어느 날부터 사진만 사라지는, 원인 찾기 어려운 고장이다). 그래서 서버가 사진을
   * 우리 저장소로 옮기고, 만료되지 않는 주소를 돌려준다.
   */
  async copyDmCardImageFromFeed(
    username: string,
    sourceUrl: string,
  ): Promise<{ url?: string; error?: string }> {
    try {
      const res = await fetch(`/api/dm-card-image/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: username }),
        body: JSON.stringify({ sourceUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        return { error: String(data?.error || `이미지를 가져오지 못했습니다. (HTTP ${res.status})`) };
      }
      return { url: String(data.url) };
    } catch (e) {
      console.error('[API] Failed to copy feed image:', e);
      return { error: '네트워크 오류로 이미지를 가져오지 못했습니다.' };
    }
  },

  // AWS IVS Stream Key API
  async getStreamKey(username: string): Promise<{ ingestServer: string; streamKey: string; playbackUrl: string; rtmpUrl: string; capReached?: 'monthly' | 'daily' | 'exhausted'; gate?: 'membership'; error?: string } | null> {
    try {
      const res = await fetch(`/api/stream-key/${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (res.status === 403) {
        // 한도 초과이거나 라이브 자격(멤버십) 미충족 — 구조화된 응답을
        // 그대로 넘겨 UI 가 "월 50시간 도달" / "라이브 멤버십 필요"를 구분해 보여준다.
        try { return await res.json(); } catch { return null; }
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get stream key:', e);
      return null;
    }
  },

  async saveStreamKey(username: string, config: { ingestServer?: string; streamKey?: string; playbackUrl?: string }): Promise<boolean> {
    try {
      const res = await fetch(`/api/stream-key/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(config)
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to save stream key:', e);
      return false;
    }
  },

  // Viewer diagnostics — fire-and-forget report of a playback failure so
  // we can review real-world errors (esp. from in-app WebViews where devtools
  // cannot attach) without depending on a user screenshot.
  reportViewerError(
    username: string,
    payload: {
      viewerId?: string;
      userAgent?: string;
      pageProtocol?: string;
      inApp?: string;
      isMobile?: boolean;
      isRelayOnly?: boolean;
      onStreamCallCount?: number;
      webrtc?: {
        viewerId?: string;
        running?: boolean;
        connected?: boolean;
        forceRelay?: boolean;
        reconnectAttempts?: number;
        hasReceivedOffer?: boolean;
        handlingOffer?: boolean;
        pcConnectionState?: string;
        pcIceConnectionState?: string;
        pcIceGatheringState?: string;
        signalingState?: string;
        localIce?: Record<string, number>;
        remoteIce?: Record<string, number>;
        bufferedRemoteCandidates?: number;
        lastOfferAt?: number | null;
      };
      error: { source: string; code: string | number; message: string; at?: string };
    },
  ): void {
    try {
      const body = JSON.stringify(payload);
      const url = `/api/viewer-diagnostics/${encodeURIComponent(username.toLowerCase())}`;
      // sendBeacon survives page navigations (useful when the user bails out
      // after a failed connection), falls back to keepalive fetch otherwise.
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return;
      }
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Never throw from diagnostic reporting.
    }
  },

  // Live Products API (pre-broadcast product setup)
  async getLiveProducts(username: string): Promise<{ id: string; name: string; price?: string; image?: string; link?: string; blockTitle?: string; options?: any[] }[]> {
    try {
      const res = await fetch(`/api/live-products/${encodeURIComponent(username.toLowerCase())}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.products || [];
    } catch (e) {
      console.error('[API] Failed to get live products:', e);
      return [];
    }
  },

  async saveLiveProducts(username: string, products: { id: string; name: string; price?: string; image?: string; link?: string; blockTitle?: string; options?: { id: string; name: string; values: any[] }[] }[]): Promise<boolean> {
    try {
      const res = await fetch(`/api/live-products/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ products })
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to save live products:', e);
      return false;
    }
  },

  async getLiveOrders(username: string): Promise<LiveOrderInfo[]> {
    try {
      const res = await fetch(`/api/live-orders/${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.orders) ? data.orders : [];
    } catch (e) {
      console.error('[API] Failed to get live orders:', e);
      return [];
    }
  },

  // Collaboration Records API
  async getCollabRecords(username: string): Promise<CollabRecord[]> {
    try {
      const res = await fetch(`/api/collabs/${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.records || [];
    } catch (e) {
      console.error('[API] Failed to get collab records:', e);
      return [];
    }
  },

  // Settlements created from accepted proposals. The influencer view of the
  // 협업 현황 page reads these so completed settlements also surface in 협업 내역.
  // 브랜드 쪽(role='business')은 같은 정산을 지급하는 입장에서 읽는다 — 캠페인
  // 상세의 정산 탭이 이 값을 캠페인별로 걸러 보여 준다.
  async getSettlements(username: string, role: 'influencer' | 'business' = 'influencer'): Promise<Settlement[]> {
    try {
      const res = await fetch(`/api/settlements/${encodeURIComponent(username.toLowerCase())}?role=${role}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.settlements || [];
    } catch (e) {
      console.error('[API] Failed to get settlements:', e);
      return [];
    }
  },

  async createCollabRecord(username: string, record: Omit<CollabRecord, 'id' | 'created_at'>): Promise<CollabRecord | null> {
    try {
      const res = await fetch(`/api/collabs/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(record)
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.record;
    } catch (e) {
      console.error('[API] Failed to create collab record:', e);
      return null;
    }
  },

  async updateCollabRecord(username: string, collabId: string, updates: Partial<CollabRecord>): Promise<boolean> {
    try {
      const res = await fetch(`/api/collabs/${encodeURIComponent(username.toLowerCase())}/${collabId}`, {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(updates)
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to update collab record:', e);
      return false;
    }
  },

  async deleteCollabRecord(username: string, collabId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/collabs/${encodeURIComponent(username.toLowerCase())}/${collabId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to delete collab record:', e);
      return false;
    }
  },

  // Live Cart API (viewer product cart)
  async addToLiveCart(username: string, data: {
    viewerId: string;
    viewerNickname: string;
    viewerProfileImage?: string;
    productId: string;
    productName: string;
    productPrice?: string;
    productImage?: string;
    productLink: string;
    selectedOptions?: Record<string, string>;
  }): Promise<{ success: boolean; itemCount?: number }> {
    try {
      const res = await fetch(`/api/live-cart/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) return { success: false };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to add to live cart:', e);
      return { success: false };
    }
  },

  async getLiveCartStats(username: string): Promise<{
    carts: any[];
    stats: { totalViewers: number; totalItems: number; totalRevenue: number; productCounts: { productId: string; name: string; count: number; image?: string; link: string; price?: string; optionCounts: Record<string, Record<string, number>> }[] };
  } | null> {
    try {
      const res = await fetch(`/api/live-cart/${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get live cart stats:', e);
      return null;
    }
  },

  async getViewerCart(username: string, viewerId: string): Promise<any | null> {
    try {
      const res = await fetch(`/api/live-cart/${encodeURIComponent(username.toLowerCase())}?viewerId=${encodeURIComponent(viewerId)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.cart;
    } catch (e) {
      console.error('[API] Failed to get viewer cart:', e);
      return null;
    }
  },

  async markKakaoSent(username: string, viewerId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/live-cart/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ viewerId })
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to mark kakao sent:', e);
      return false;
    }
  },

  async clearLiveCart(username: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/live-cart/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to clear live cart:', e);
      return false;
    }
  },

  async removeFromLiveCart(username: string, data: {
    viewerId: string;
    productId: string;
    selectedOptions?: Record<string, string>;
  }): Promise<boolean> {
    try {
      const res = await fetch(`/api/live-cart/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to remove from live cart:', e);
      return false;
    }
  },

  // Broadcast History API
  async getBroadcastHistory(username: string): Promise<{ id: string; startedAt: string; endedAt: string; durationMinutes: number; products: any[]; cartStats: any; peakViewers: number; totalMessages: number }[]> {
    try {
      const res = await fetch(`/api/broadcast-history/${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.records || [];
    } catch (e) {
      console.error('[API] Failed to get broadcast history:', e);
      return [];
    }
  },

  async saveBroadcastRecord(username: string, record: {
    id: string;
    startedAt: string;
    endedAt: string;
    durationMinutes: number;
    products: any[];
    cartStats: any;
    peakViewers: number;
    totalMessages: number;
  }): Promise<boolean> {
    try {
      const res = await fetch(`/api/broadcast-history/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(record)
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to save broadcast record:', e);
      return false;
    }
  },

  async deleteBroadcastRecord(username: string, recordId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/broadcast-history/${encodeURIComponent(username.toLowerCase())}/${recordId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to delete broadcast record:', e);
      return false;
    }
  },

  // Live time usage — current month's broadcast minutes used vs included,
  // overage (postpaid) accumulation, and the active pricing snapshot. Used
  // by the live-streaming dashboard balance widget and the membership card.
  async getLiveUsage(username: string): Promise<{
    usage: {
      monthLabel: string;
      totalMinutes: number;
      includedMinutes: number;
      includedMinutesRemaining: number;
      chargedMinutes: number;
      allowanceMinutes: number;
      remainingMinutes: number;
      exhausted: boolean;
      overageMinutes: number;
      overageAmountKrw: number;
      monthlyHardCapMinutes: number;
      monthlyHardCapReached: boolean;
    };
    pricing: {
      includedMinutesPerMonth: number;
      overageRateKrwPerHour: number;
      overageRateKrwPerMinute: number;
      chargeRateKrwPerHour: number;
      liveCommissionRate: number;
      dailyHardCapMinutes: number;
      monthlyHardCapMinutes: number;
      thresholdBillingAmountKrw: number;
    };
  } | null> {
    try {
      const res = await fetch(`/api/live-usage/${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get live usage:', e);
      return null;
    }
  },

  // Prepaid live-time top-up ("시간 충전하기"). After the seller completes a
  // one-time PortOne payment (나이스정보통신/카카오페이) for `hours` of
  // broadcast time at the per-hour rate, the verified `paymentId` is posted here
  // so the server can confirm the payment and add the time. Returns the refreshed
  // usage so the caller can immediately reflect the new remaining time.
  async chargeLiveTime(
    username: string,
    hours: number,
    payment: { paymentId: string; payMethod?: string },
  ): Promise<{
    success: boolean;
    error?: string;
    charged?: { hours: number; minutes: number; amountKrw: number };
    usage?: {
      totalMinutes: number;
      chargedMinutes: number;
      allowanceMinutes: number;
      remainingMinutes: number;
      exhausted: boolean;
      includedMinutesRemaining: number;
      overageMinutes: number;
      overageAmountKrw: number;
      monthLabel: string;
    };
  }> {
    try {
      const res = await fetch(`/api/live-credits/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ hours, paymentId: payment.paymentId, payMethod: payment.payMethod }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data?.error || '충전에 실패했습니다.' };
      return data;
    } catch (e) {
      console.error('[API] Failed to charge live time:', e);
      return { success: false, error: '네트워크 오류로 충전에 실패했습니다.' };
    }
  },

  // Admin Notifications API
  async getAdminNotifications(token: string): Promise<{ notifications: any[]; unreadCount: number }> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/notifications', { credentials: 'same-origin', headers });
      if (!res.ok) return { notifications: [], unreadCount: 0 };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin notifications:', e);
      return { notifications: [], unreadCount: 0 };
    }
  },

  async markNotificationsRead(token: string, ids?: string[], _markAllRead?: boolean): Promise<boolean> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/notifications', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(ids ? { ids } : { markAllRead: true })
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to mark notifications read:', e);
      return false;
    }
  },

  async refreshKakaoCache(username: string): Promise<boolean> {
    try {
      const encodedName = encodeURIComponent(username.toLowerCase());
      const customDomain = 'https://picks-folio.com';
      const originUrl = `${window.location.origin}/${encodedName}`;
      const customUrl = `${customDomain}/${encodedName}`;

      // Flush both the current origin and the custom domain so Kakao picks up new OG data
      const urls = new Set([originUrl, customUrl]);
      const results = await Promise.all(
        [...urls].map((url) =>
          fetch('/api/kakao-cache-refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          }).then((r) => r.ok).catch(() => false)
        )
      );
      return results.some(Boolean);
    } catch (e) {
      console.error('[API] Failed to refresh Kakao cache:', e);
      return false;
    }
  },

  // Seller record (membership + billing state)
  // Returns the last-known value synchronously (from memory, then localStorage)
  // so gated screens can render their real state on the first paint instead of
  // flashing the "멤버십 인증 필요" gate while the network request is in flight.
  getCachedSellerVerification(username: string): SellerVerification | null {
    const key = username.toLowerCase();
    const mem = verificationCache[key];
    if (mem && Date.now() - mem.ts < VERIFICATION_TTL) return mem.data;
    try {
      const raw = localStorage.getItem(verifKey(username));
      if (raw) return JSON.parse(raw) as SellerVerification;
    } catch {
      // ignore parse/storage errors and fall through to a network fetch
    }
    return null;
  },

  async getSellerVerification(username: string): Promise<SellerVerification | null> {
    try {
      const res = await fetch(`/api/seller-verification/${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as SellerVerification;
      writeVerificationCache(username, data);
      return data;
    } catch (e) {
      console.error('[API] Failed to get seller verification:', e);
      return null;
    }
  },

  async saveSellerVerification(username: string, data: Partial<SellerVerification>): Promise<{ success: boolean; error?: string; data?: SellerVerification }> {
    try {
      const res = await fetch(`/api/seller-verification/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) return { success: false, error: json?.error || '저장 실패' };
      if (json.data) writeVerificationCache(username, json.data);
      return { success: true, data: json.data };
    } catch (e) {
      console.error('[API] Failed to save seller verification:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // PortOne V2 — after the browser SDK returns success, verify the payment
  // server-side before activating the membership. Amount validation and
  // blob updates happen on the server.
  async completePortOnePayment(
    username: string,
    paymentId: string,
    payMethod?: string,
  ): Promise<{ success: boolean; error?: string; data?: SellerVerification }> {
    try {
      const res = await fetch('/api/portone-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.toLowerCase(), paymentId, payMethod }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json?.error || '결제 검증 실패' };
      }
      if (json.data) writeVerificationCache(username, json.data);
      return { success: true, data: json.data };
    } catch (e) {
      console.error('[API] Failed to complete PortOne payment:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  async issueBillingKeyPayment(
    username: string,
    billingKey: string,
    tier: MembershipTier,
  ): Promise<{ success: boolean; error?: string; data?: SellerVerification }> {
    try {
      const res = await fetch('/api/billing-issue', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username: username.toLowerCase(), billingKey, tier }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json?.error || '빌링 결제 실패' };
      }
      if (json.data) writeVerificationCache(username, json.data);
      return { success: true, data: json.data };
    } catch (e) {
      console.error('[API] Failed to process billing key payment:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // 카드(신용카드) 매월 자동결제 등록. 멤버십은 월 구독이라 카드도 매월 자동 청구되어야
  // 하는데, PortOne V2 나이스정보통신은 결제창으로 카드 빌링키를 발급할 수 없어(간편결제만
  // 지원) 카드 정기결제는 카드 정보를 서버로 보내 수기(키인) 빌링키를 발급받는다. 카드 정보는
  // 우리 서버에 저장하지 않고 PortOne 으로만 전달하며, 이후에는 발급된 빌링키로 매월
  // 자동결제된다. 첫 달 결제까지 성공해야 멤버십이 활성화된다.
  async subscribeMembershipCard(
    username: string,
    card: {
      number: string;
      expiryYear: string;
      expiryMonth: string;
      birthOrBusinessRegistrationNumber: string;
      passwordTwoDigits: string;
    },
    tier: MembershipTier,
  ): Promise<{ success: boolean; error?: string; data?: SellerVerification }> {
    try {
      const res = await fetch('/api/billing-issue', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username: username.toLowerCase(), card, tier }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json?.error || '카드 등록·결제 실패' };
      }
      if (json.data) writeVerificationCache(username, json.data);
      return { success: true, data: json.data };
    } catch (e) {
      console.error('[API] Failed to subscribe membership by card:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // ── Claude plan credit wallet ───────────────────────────────────────────
  // The premium Claude model in the collaboration AI is metered by a prepaid
  // credit wallet, sold separately from the memberships. These methods read the
  // wallet and grant credits after a verified PortOne payment. The Claude plan is
  // single-payment only (no recurring/auto billing). The public credit shape
  // mirrors `publicCredits` server-side.
  async getClaudeCredits(
    username: string,
    options: { refresh?: boolean } = {},
  ): Promise<ClaudeCreditsResponse | null> {
    try {
      // refresh=1 은 조회 간격을 무시하고 결제 취소(환불) 여부를 즉시 PG 에 확인한다.
      const query = options.refresh ? '?refresh=1' : '';
      const res = await fetch(
        `/api/claude-credits/${encodeURIComponent(username.toLowerCase())}${query}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) return null;
      return (await res.json()) as ClaudeCreditsResponse;
    } catch (e) {
      console.error('[API] Failed to get Claude credits:', e);
      return null;
    }
  },

  async payClaudeCredits(
    username: string,
    payload: {
      kind: 'activation' | 'recharge';
      amountKrw: number;
      paymentId: string;
      payMethod?: string;
    },
  ): Promise<ClaudeCreditsResponse & { success: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/claude-credits/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: data?.error || '크레딧 적립에 실패했습니다.' } as any;
      return data;
    } catch (e) {
      console.error('[API] Failed to pay Claude credits:', e);
      return { success: false, error: '네트워크 오류로 처리에 실패했습니다.' } as any;
    }
  },

  // Verify a live-commerce product purchase server-side after a successful
  // PortOne V2 payment. Stores the order record under the seller's username.
  async completeLiveOrder(data: {
    paymentId: string;
    username: string;
    expectedAmount: number;
    product: {
      id: string;
      name: string;
      link?: string;
      image?: string;
      selectedOptions?: Record<string, string>;
    };
    viewer: {
      viewerId: string;
      nickname?: string;
      profileImage?: string;
    };
    shipping?: ShippingProfile;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch('/api/live-order-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          username: data.username.toLowerCase(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json?.error || '결제 검증 실패' };
      }
      return { success: true };
    } catch (e) {
      console.error('[API] Failed to complete live order:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // Verify a batch (multi-item cart) purchase server-side after a successful
  // single PortOne V2 payment. Records one order per item and clears the
  // viewer's cart on the seller's live cart blob.
  async completeLiveOrderBatch(data: {
    paymentId: string;
    username: string;
    expectedAmount: number;
    items: {
      productId: string;
      productName: string;
      productLink?: string;
      productImage?: string;
      selectedOptions?: Record<string, string>;
      amount: number;
    }[];
    viewer: {
      viewerId: string;
      nickname?: string;
      profileImage?: string;
    };
    shipping?: ShippingProfile;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch('/api/live-order-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          username: data.username.toLowerCase(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json?.error || '결제 검증 실패' };
      }
      return { success: true };
    } catch (e) {
      console.error('[API] Failed to complete batch live order:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // ───────────────────── Live Shipping Profile (orderer + 배송지) ─────────────────────
  // Fetch the viewer's last-used orderer/shipping details so the live checkout
  // form can be pre-filled. Returns null when nothing has been saved yet.
  //
  // `profileKey` 는 이 브라우저에만 저장되는 난수 열쇠다(viewerId 와 다른 값).
  // viewerId 는 판매자 화면에 보이므로 그것을 열쇠로 쓰면 남의 배송지가 열린다.
  async getShippingProfile(profileKey: string): Promise<ShippingProfile | null> {
    try {
      const res = await fetch(`/api/live-shipping-profile?profileKey=${encodeURIComponent(profileKey)}`);
      if (!res.ok) return null;
      const json = await res.json();
      return (json?.profile as ShippingProfile) || null;
    } catch (e) {
      console.error('[API] Failed to load shipping profile:', e);
      return null;
    }
  },

  // Persist the viewer's orderer/shipping details for reuse on their next order.
  async saveShippingProfile(profileKey: string, profile: ShippingProfile): Promise<boolean> {
    try {
      const res = await fetch('/api/live-shipping-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileKey, profile }),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to save shipping profile:', e);
      return false;
    }
  },

  // ───────────────────── Site Data Snapshots & Restore ─────────────────────
  async getSiteDataSnapshots(username: string): Promise<{ snapshots: { id: number; snapshot_reason: string; created_at: string; block_count: number; portfolio_count: number }[] }> {
    try {
      const res = await fetch(`/api/site-restore/${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return { snapshots: [] };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get site data snapshots:', e);
      return { snapshots: [] };
    }
  },

  async restoreSiteDataSnapshot(username: string, snapshotId: number): Promise<boolean> {
    try {
      const res = await fetch(`/api/site-restore/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ snapshot_id: snapshotId })
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to restore site data snapshot:', e);
      return false;
    }
  },

  // ───────────────────── Admin: Influencer management ─────────────────────
  async getAdminInfluencers(token: string): Promise<{
    influencers: any[];
    businesses?: any[];
    liveCustomers?: any[];
    /** 운영자가 직접 부여한 멤버십 목록(활성만). matched=false 면 회원 목록에서 계정을 찾지 못한 부여다. */
    operatorGrants?: any[];
    /** 부여 목록 조회가 실패한 경우의 사유. 실패를 "0명"으로 오해하지 않도록 화면에서 구분해 쓴다. */
    operatorGrantsError?: string | null;
  }> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/influencers', { credentials: 'same-origin', headers });
      if (!res.ok) {
        return {
          influencers: [],
          businesses: [],
          liveCustomers: [],
          operatorGrants: [],
          operatorGrantsError: `회원 목록을 불러오지 못했습니다 (${res.status})`,
        };
      }
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin influencers:', e);
      return {
        influencers: [],
        businesses: [],
        liveCustomers: [],
        operatorGrants: [],
        operatorGrantsError: '회원 목록을 불러오지 못했습니다.',
      };
    }
  },

  async resetAdminLiveNotifySubscribers(
    token: string,
  ): Promise<{ ok: boolean; removedKeys?: number; removedSubscribers?: number; error?: string }> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/live-notify/reset', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
      });
      if (!res.ok) {
        let errorMsg: string | undefined;
        try { errorMsg = (await res.json())?.error; } catch {}
        return { ok: false, error: errorMsg };
      }
      const json = await res.json();
      return { ok: true, removedKeys: json.removedKeys, removedSubscribers: json.removedSubscribers };
    } catch (e) {
      console.error('[API] Failed to reset live-notify subscribers:', e);
      return { ok: false, error: '네트워크 오류' };
    }
  },

  async updateAdminInfluencer(
    token: string,
    username: string,
    body: {
      featured?: boolean;
      featured_note?: string;
      membership_plan?: 'standard' | 'standard_ai' | 'pro' | null;
      auth_user_id?: string;
    }
  ): Promise<{ ok: boolean; error?: string; membership?: any }> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/influencers/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        return { ok: true, membership: json?.membership || undefined };
      }
      let errorMsg: string | undefined;
      try {
        const json = await res.json();
        errorMsg = json?.error;
      } catch {
        // non-JSON response
      }
      return { ok: false, error: errorMsg };
    } catch (e) {
      console.error('[API] Failed to update admin influencer:', e);
      return { ok: false, error: '네트워크 오류' };
    }
  },

  // ───────────────────── Admin: Settlement / revenue ─────────────────────
  async getAdminSettlementsOverview(token: string): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/settlements-overview', { credentials: 'same-origin', headers });
      if (!res.ok) return { settlements: [], summary: null, influencerRanking: [], businessRanking: [] };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin settlements overview:', e);
      return { settlements: [], summary: null, influencerRanking: [], businessRanking: [] };
    }
  },

  // ───────────────────── Admin: Live commerce ─────────────────────
  async getAdminLiveOverview(token: string, opts?: { username?: string; limit?: number }): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const qs = new URLSearchParams();
      if (opts?.username) qs.set('username', opts.username.trim().toLowerCase());
      if (opts?.limit) qs.set('limit', String(opts.limit));
      const url = qs.toString() ? `/api/admin/live-overview?${qs.toString()}` : '/api/admin/live-overview';
      const res = await fetch(url, { credentials: 'same-origin', headers });
      if (!res.ok) return { ongoing: [], history: [] };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin live overview:', e);
      return { ongoing: [], history: [] };
    }
  },

  // Admin per-user live broadcast time + monthly/daily hard cap status
  async getAdminLiveUsage(token: string): Promise<{
    monthLabel: string;
    users: Array<{
      username: string;
      totalMinutes: number;
      todayMinutes: number;
      sessions: number;
      lastStartedAt: string | null;
      includedMinutes: number;
      includedMinutesRemaining: number;
      overageMinutes: number;
      overageAmountKrw: number;
      monthlyHardCapReached: boolean;
      dailyHardCapReached: boolean;
      isLive: boolean;
    }>;
    pricing: {
      includedMinutesPerMonth: number;
      monthlyHardCapMinutes: number;
      dailyHardCapMinutes: number;
      overageRateKrwPerMinute: number;
    };
  } | null> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/live-overview/usage', { credentials: 'same-origin', headers });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin live usage:', e);
      return null;
    }
  },

  async forceEndBroadcast(token: string, username: string, reason: string): Promise<boolean> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/live-overview/${encodeURIComponent(username.toLowerCase())}/end`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ reason }),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to force-end broadcast:', e);
      return false;
    }
  },

  async markBroadcastHighlight(
    token: string,
    username: string,
    recordId: string,
    highlight: boolean,
    note?: string
  ): Promise<boolean> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/live-overview/${encodeURIComponent(username.toLowerCase())}/highlight`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ recordId, highlight, note }),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to mark broadcast highlight:', e);
      return false;
    }
  },

  async getAdminChatModeration(token: string): Promise<{ flagged: any[]; rules: any[] }> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/live-overview/moderation', { credentials: 'same-origin', headers });
      if (!res.ok) return { flagged: [], rules: [] };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get chat moderation:', e);
      return { flagged: [], rules: [] };
    }
  },

  async chatModerationAction(token: string, body: Record<string, any>): Promise<boolean> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/live-overview/moderation', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Chat moderation action failed:', e);
      return false;
    }
  },

  // ───────────────────── Admin: Workflow analytics ─────────────────────
  async getAdminProposalsAnalytics(token: string): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/proposals-analytics', { credentials: 'same-origin', headers });
      if (!res.ok) return { categoryStats: {}, feeBucketStats: [], rejectionStats: [], recentRejectionRate: 0, recentTotal: 0 };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get proposals analytics:', e);
      return { categoryStats: {}, feeBucketStats: [], rejectionStats: [], recentRejectionRate: 0, recentTotal: 0 };
    }
  },

  async getAdminProposalTimeline(token: string, proposalId: string): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/proposals-analytics/timeline/${encodeURIComponent(proposalId)}`, {
        credentials: 'same-origin',
        headers,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get proposal timeline:', e);
      return null;
    }
  },

  // ───────────────────── Admin: Growth metrics ─────────────────────
  async getAdminGrowth(token: string): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/growth', { credentials: 'same-origin', headers });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin growth:', e);
      return null;
    }
  },

  // ───────────────────── Admin: Operator overview ─────────────────────
  /**
   * 운영자 전체 현황. 가입 계정 수, 브랜드 매칭 지원자 현황, 캠페인 예산과
   * 캠페인·AI 순수익을 서버에서 한 번에 집계해 온다. 실패하면 null 을 주고
   * 화면은 나머지 카드만 그린다 — 한 집계가 막혀도 대시보드는 열려야 한다.
   */
  async getAdminOperatorOverview(token: string): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/operator-overview', { credentials: 'same-origin', headers });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get operator overview:', e);
      return null;
    }
  },

  // ───────────────────── Admin: Campaign approval ─────────────────────
  async getAdminCampaigns(token: string, status?: string): Promise<{ campaigns: any[]; pendingCount: number }> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const qs = status ? `?status=${status}` : '';
      const res = await fetch(`/api/admin/campaigns${qs}`, { credentials: 'same-origin', headers });
      if (!res.ok) return { campaigns: [], pendingCount: 0 };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin campaigns:', e);
      return { campaigns: [], pendingCount: 0 };
    }
  },

  async adminCampaignAction(
    token: string,
    id: string,
    action: 'approve' | 'reject' | 'assign_manager',
    reason?: string,
    managerUsername?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/campaigns', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ id, action, reason, managerUsername }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return { success: false, error: json?.error };
      }
      return { success: true };
    } catch (e) {
      console.error('[API] Failed to perform admin campaign action:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // ───────────────────── 담당자 중개 협업 (collab workflow) ─────────────────────
  async getCollabs(
    role: 'brand' | 'influencer' | 'manager',
    opts: { token?: string; mine?: boolean; status?: string } = {},
  ): Promise<{ collabs: any[]; role?: string; error?: string }> {
    try {
      const params = new URLSearchParams({ role });
      if (opts.mine) params.set('mine', '1');
      if (opts.status) params.set('status', opts.status);
      const res = opts.token
        ? await fetch(`/api/collab-workflow?${params.toString()}`, {
            credentials: 'same-origin',
            headers: await collabHeaders(opts.token),
          })
        : await authedGet(`/api/collab-workflow?${params.toString()}`, () => collabHeaders());
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { collabs: [], error: json?.error || '협업 목록을 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get collabs:', e);
      return { collabs: [], error: '네트워크 오류' };
    }
  },

  /**
   * 협업 상세. `role` 은 "어떤 화면에서 열었는지"를 서버에 알려 준다 — 담당자
   * 자격과 당사자 계정을 겹쳐 가진 사람이 있어서, 알려주지 않으면 서버가 역할을
   * 잘못 골라 브랜드에게 지급 단가가 보이거나 담당자 콘솔이 브랜드 화면으로 나온다.
   */
  async getCollabDetail(collabId: string, token?: string, role?: CollabViewerRole): Promise<any> {
    try {
      const path = `/api/collab-workflow/${encodeURIComponent(collabId)}${role ? `?role=${role}` : ''}`;
      const res = token
        ? await fetch(path, {
            credentials: 'same-origin',
            headers: await collabHeaders(token),
          })
        : await authedGet(path, () => collabHeaders());
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '협업 정보를 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get collab detail:', e);
      return { error: '네트워크 오류' };
    }
  },

  /** 단계 제출 · 승인 · 수정요청 · 피드백 · 조건 확정 등 모든 상태 변경의 단일 입구. */
  async collabAction(
    collabId: string,
    action: string,
    payload: Record<string, any> = {},
    token?: string,
    role?: CollabViewerRole,
  ): Promise<{ success?: boolean; error?: string; [k: string]: any }> {
    try {
      const path = `/api/collab-workflow/${encodeURIComponent(collabId)}${role ? `?role=${role}` : ''}`;
      const res = await fetch(path, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify({ action, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '요청을 처리하지 못했습니다.', code: json?.code };
      return json;
    } catch (e) {
      console.error(`[API] Collab action failed (${action}):`, e);
      return { error: '네트워크 오류' };
    }
  },

  /** 담당자 대기 큐 — 지금 담당자가 막고 있는 일만 모아 본다. */
  async getManagerQueue(token: string, mine = false): Promise<any> {
    try {
      const res = await fetch(`/api/manager-queue${mine ? '?mine=1' : ''}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '대기 큐를 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get manager queue:', e);
      return { error: '네트워크 오류' };
    }
  },

  /** 지원자 목록. 브랜드(본인 캠페인)와 담당자 모두 같은 경로를 쓴다. */
  async getCampaignApplicants(campaignId: string, token?: string): Promise<any> {
    try {
      const res = await fetch(`/api/campaign-applicants?campaign_id=${encodeURIComponent(campaignId)}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { applicants: [], error: json?.error || '지원자를 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get campaign applicants:', e);
      return { applicants: [], error: '네트워크 오류' };
    }
  },

  /** 브랜드 의견 표시(추천 · 보류). 선정 권한은 없다 — 담당자에게 전달되는 메모다. */
  async setApplicantPreference(
    applicantId: string,
    brandPreference: '' | 'shortlist' | 'pass',
    note = '',
  ): Promise<{ success?: boolean; error?: string }> {
    try {
      const res = await fetch('/api/campaign-applicants', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: applicantId, brandPreference, brandPreferenceNote: note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '의견을 저장하지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to set applicant preference:', e);
      return { error: '네트워크 오류' };
    }
  },

  /**
   * 담당자가 지원자에게 붙이는 추천 이유.
   *
   * 선정과 분리된 저장이다. 브랜드가 직접 수락하는 캠페인에서는 담당자가 '선정'을
   * 누르지 않으므로, 선정할 때만 적을 수 있게 두면 이유를 남길 자리가 사라진다.
   * 저장한 줄은 브랜드의 지원자 카드에 그대로 보인다.
   */
  async setApplicantManagerNote(
    applicantId: string,
    managerNote: string,
    token?: string,
  ): Promise<{ success?: boolean; managerNote?: string; error?: string }> {
    try {
      const res = await fetch('/api/campaign-applicants', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify({ id: applicantId, managerNote }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '추천 이유를 저장하지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to save applicant manager note:', e);
      return { error: '네트워크 오류' };
    }
  },

  /**
   * 지원자 선정 · 거절.
   *
   * 토큰을 넘기면 담당자 자격으로, 넘기지 않으면 로그인한 브랜드 자격으로 간다.
   * 브랜드는 제품 협찬형·공동구매 캠페인의 '수락'만 할 수 있다(거절은 담당자 몫).
   * 권한이 없으면 서버가 code 로 이유를 준다 — SELECTION_BY_MANAGER(선정 자체가
   * 담당자 몫) / REJECTION_BY_MANAGER(거절만 담당자 몫).
   */
  async decideApplicant(
    applicantId: string,
    status: 'accepted' | 'rejected',
    opts: { token?: string; managerNote?: string } = {},
  ): Promise<{
    success?: boolean;
    collabId?: string;
    threads?: any;
    managerUsername?: string;
    error?: string;
    code?: string;
  }> {
    try {
      const res = await fetch('/api/campaign-applicants', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await collabHeaders(opts.token),
        // 서버가 읽는 필드 이름은 note 다. managerNote 로 보내던 동안 담당자가 적은
        // 선정 메모가 저장되지 않고 사라졌다.
        body: JSON.stringify({ id: applicantId, status, note: opts.managerNote || '' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '처리에 실패했습니다.', code: json?.code };
      return json;
    } catch (e) {
      console.error('[API] Failed to decide applicant:', e);
      return { error: '네트워크 오류' };
    }
  },

  /**
   * 담당자 채널 대화 읽기.
   *
   * 담당자는 운영 콘솔(Netlify Identity)로 로그인해 있어서 서비스 화면의 대화 UI를
   * 그대로 쓸 수 없다. 운영 콘솔 안에서 답장할 수 있도록 같은 대화 API 를 관리자
   * 토큰으로 호출한다.
   */
  async getTimelineThread(proposalId: string, token?: string): Promise<any> {
    try {
      const res = await fetch(`/api/timeline/detail/${encodeURIComponent(proposalId)}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '대화를 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get timeline thread:', e);
      return { error: '네트워크 오류' };
    }
  },

  /** 담당자 채널에 답장. 작성자는 서버가 토큰에서 확인한 본인으로 기록된다. */
  async postTimelineComment(
    proposalId: string,
    content: string,
    token?: string,
  ): Promise<{ success?: boolean; comment?: any; error?: string }> {
    try {
      const res = await fetch(`/api/timeline/comment/${encodeURIComponent(proposalId)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify({ content }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '메시지를 보내지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to post timeline comment:', e);
      return { error: '네트워크 오류' };
    }
  },

  /**
   * 협업 대화를 내 목록에서 내린다(삭제).
   *
   * 방과 메시지는 지우지 않는다 — 상대와 함께 쓰는 기록이라 한쪽이 지우면 상대의
   * 내역까지 사라진다. 내 목록에서만 감추고, 내린 뒤 상대가 새 메시지를 보내면
   * 서버가 다시 살려 준다.
   */
  async hideTimeline(proposalId: string): Promise<{ success?: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/timeline/hide/${encodeURIComponent(proposalId)}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '대화를 삭제하지 못했습니다.' };
      return { success: true };
    } catch (e) {
      console.error('[API] Failed to hide timeline:', e);
      return { error: '네트워크 오류' };
    }
  },

  /** 방금 내린 대화를 되돌린다("되돌리기"). */
  async restoreTimeline(proposalId: string): Promise<{ success?: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/timeline/hide/${encodeURIComponent(proposalId)}`, {
        method: 'POST',
        headers: await authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '대화를 되돌리지 못했습니다.' };
      return { success: true };
    } catch (e) {
      console.error('[API] Failed to restore timeline:', e);
      return { error: '네트워크 오류' };
    }
  },

  // ───────────────────── 리스트업 (후보 명단 · 제안 조율) ─────────────────────

  /**
   * 캠페인 후보 명단. 브랜드는 자기 캠페인의 명단을, 담당자는 명단과 함께
   * `pool` 로 명단에 올릴 후보 풀까지 받는다.
   */
  async getCampaignListup(
    campaignId: string,
    opts: { token?: string; pool?: boolean; q?: string } = {},
  ): Promise<any> {
    try {
      const params = new URLSearchParams({ campaign_id: campaignId });
      if (opts.pool) params.set('pool', '1');
      if (opts.q) params.set('q', opts.q);
      const res = await fetch(`/api/campaign-listup?${params.toString()}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(opts.token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { candidates: [], error: json?.error || '리스트업을 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get campaign listup:', e);
      return { candidates: [], error: '네트워크 오류' };
    }
  },

  /** 인플루언서가 받은 제안 목록. */
  async getMyListupOffers(username: string): Promise<{ offers: any[]; error?: string }> {
    try {
      const res = await authedGet(
        `/api/campaign-listup?influencer=${encodeURIComponent(username)}`,
        () => authHeaders(),
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { offers: [], error: json?.error || '받은 제안을 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get listup offers:', e);
      return { offers: [], error: '네트워크 오류' };
    }
  },

  /** 후보를 명단에 올린다(담당자). */
  async addListupCandidates(
    campaignId: string,
    usernames: string[],
    opts: {
      token?: string;
      note?: string;
      /** 명단 전체에 같은 값을 쓸 때. */
      quote?: Record<string, any>;
      /** 계정별로 다른 견적을 쓸 때. 이쪽이 우선한다. */
      quotes?: Record<string, Record<string, any>>;
      /** 인플루언서에게 지급할 금액. 제시가와의 차액이 우리 수익이 된다. */
      payout?: Record<string, any>;
      /** 계정별 지급액. 이쪽이 우선한다. */
      payouts?: Record<string, Record<string, any>>;
    } = {},
  ): Promise<any> {
    try {
      const res = await fetch('/api/campaign-listup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: await collabHeaders(opts.token),
        body: JSON.stringify({
          campaignId,
          usernames,
          note: opts.note || '',
          quote: opts.quote || undefined,
          quotes: opts.quotes || undefined,
          payout: opts.payout || undefined,
          payouts: opts.payouts || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '명단에 올리지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to add listup candidates:', e);
      return { error: '네트워크 오류' };
    }
  },

  /**
   * 명단 위의 모든 상태 변경. 동작 이름이 권한을 결정한다 —
   * brand_decision 은 브랜드, send_offer/withdraw_offer/note/remove 는 담당자,
   * respond 는 인플루언서(또는 대신 기록하는 담당자).
   */
  async listupAction(
    id: string,
    action:
      | 'brand_decision'
      | 'send_offer'
      | 'withdraw_offer'
      | 'start_collab'
      | 'respond'
      | 'note'
      | 'quote'
      | 'favorite'
      | 'remove',
    payload: Record<string, any> = {},
    token?: string,
  ): Promise<any> {
    try {
      const res = await fetch('/api/campaign-listup', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify({ id, action, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '처리에 실패했습니다.', code: json?.code };
      return json;
    } catch (e) {
      console.error(`[API] Listup action failed (${action}):`, e);
      return { error: '네트워크 오류' };
    }
  },

  /**
   * 브랜드가 명단을 한 번에 확정한다("인플루언서 모두 선택 완료").
   *
   * 고른 사람은 진행 요청, 나머지는 넘김으로 함께 기록된다. 한 건씩 보내면 중간에
   * 끊겼을 때 절반만 확정된 명단이 남고, 브랜드 화면에서는 그게 보이지 않는다.
   */
  async confirmListupSelection(
    campaignId: string,
    ids: string[],
    token?: string,
  ): Promise<any> {
    try {
      const res = await fetch('/api/campaign-listup', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify({ action: 'brand_decision_bulk', campaignId, ids }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '확정에 실패했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to confirm listup selection:', e);
      return { error: '네트워크 오류' };
    }
  },

  // ───────────────────── 담당자 계정 · 담당자 대시보드 ─────────────────────

  /**
   * 내가 담당자인가.
   *
   * 로그인 직후 어느 화면을 띄울지 정하려면 이 한 번의 확인이 필요하다. 실패하면
   * 담당자가 아닌 것으로 본다 — 여는 쪽으로 실패하면 권한 없는 사람에게 담당자
   * 화면이 열린다.
   *
   * 다만 "한 번의 실패"로 끝내면 안 되는 이유가 두 개 있다. 첫째, 이 확인은 로그인
   * 흐름 안에서 기다리는 호출이라 응답이 없으면 대시보드 진입이 멈춘다 — 시간 제한을
   * 둔다. 둘째, 아이디 로그인은 세션을 심는 중에 이 확인이 일어나서 토큰이 아직
   * 준비되지 않은 채 401 이 한 번 날 수 있다. 그 한 번을 최종 답으로 삼으면 담당자가
   * 그 세션 내내 일반 사용자로 남으므로, 짧게 한 번 다시 묻는다.
   */
  async getMyManagerStatus(): Promise<{
    isManager: boolean;
    isAdmin?: boolean;
    /** 서버가 실제로 판정했는지. false 면 "담당자 아님"이 아니라 "아직 모름"이다. */
    checked: boolean;
    username?: string;
    displayName?: string;
  }> {
    const ask = async () => {
      const res = await fetchWithTimeout(
        '/api/managers?me=1',
        { cache: 'no-store', credentials: 'same-origin', headers: await authHeadersWithTimeout() },
        8_000,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {
        ...(json as { isManager: boolean; isAdmin?: boolean; username?: string; displayName?: string }),
        checked: (json as any)?.checked !== false,
      };
    };

    try {
      return await ask();
    } catch (first) {
      await new Promise((r) => setTimeout(r, 700));
      try {
        return await ask();
      } catch (second) {
        console.error('[API] Failed to resolve manager status:', first, second);
        // 확인 실패다. isManager:false 를 확정으로 쓰면 담당자가 일반 대시보드로
        // 떨어지므로, 판정하지 못했다는 사실을 함께 돌려준다.
        return { isManager: false, checked: false };
      }
    }
  },

  /** 담당자 목록(운영자). */
  async getManagers(token?: string): Promise<{ managers?: any[]; error?: string }> {
    try {
      const res = await fetch('/api/managers', {
        credentials: 'same-origin',
        headers: await collabHeaders(token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { managers: [], error: json?.error || '담당자 목록을 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get managers:', e);
      return { managers: [], error: '네트워크 오류' };
    }
  },

  /** 일반 계정을 담당자로 배정한다(운영자). 이미 있는 계정이면 다시 활성화된다. */
  async assignManager(
    payload: { username: string; displayName?: string; email?: string; note?: string },
    token?: string,
  ): Promise<any> {
    try {
      const res = await fetch('/api/managers', {
        method: 'POST',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '담당자로 배정하지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to assign manager:', e);
      return { error: '네트워크 오류' };
    }
  },

  /** 담당자 권한 해제·복구(운영자). 행은 남으므로 지난 배정 이력이 사라지지 않는다. */
  async setManagerActive(username: string, active: boolean, token?: string): Promise<any> {
    try {
      const res = await fetch('/api/managers', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify({ username, active }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '담당자 상태를 바꾸지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to change manager state:', e);
      return { error: '네트워크 오류' };
    }
  },

  /** 픽스폴리오 인플루언서 명부(담당자). 카테고리 집계까지 함께 온다. */
  async getManagerInfluencers(
    opts: { q?: string; category?: string; token?: string } = {},
  ): Promise<{ influencers?: any[]; categories?: any[]; total?: number; error?: string }> {
    try {
      const params = new URLSearchParams();
      if (opts.q) params.set('q', opts.q);
      if (opts.category) params.set('category', opts.category);
      const qs = params.toString();
      const res = await fetch(`/api/manager-influencers${qs ? `?${qs}` : ''}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(opts.token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { influencers: [], categories: [], error: json?.error || '인플루언서 명부를 불러오지 못했습니다.' };
      }
      return json;
    } catch (e) {
      console.error('[API] Failed to get manager influencers:', e);
      return { influencers: [], categories: [], error: '네트워크 오류' };
    }
  },

  /** 담당자가 보는 브랜드 캠페인 목록. 진행 숫자가 함께 온다. */
  /**
   * 캠페인을 올린 브랜드 담당자의 연락처. 담당자 화면이 캠페인 하나를 열었을 때만
   * 부른다 — 목록에 미리 담아 두면 열어 보지도 않은 브랜드의 개인정보까지 내려온다.
   */
  async getBrandContact(
    opts: { campaignId?: string; businessUsername?: string; token?: string },
  ): Promise<{ contact?: any; error?: string }> {
    const params = new URLSearchParams();
    if (opts.campaignId) params.set('campaign', opts.campaignId);
    else if (opts.businessUsername) params.set('business', opts.businessUsername.replace(/^biz\//, ''));
    else return { error: '캠페인 또는 브랜드를 지정해 주세요.' };

    try {
      const res = await fetch(`/api/manager-brand-contact?${params.toString()}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(opts.token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '연락처를 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get brand contact:', e);
      return { error: '네트워크 오류' };
    }
  },

  async getManagerCampaigns(
    opts: { mine?: boolean; token?: string } = {},
  ): Promise<{ campaigns?: any[]; brandPicks?: any[]; managerUsername?: string; error?: string }> {
    try {
      const res = await fetch(`/api/manager-campaigns${opts.mine ? '?mine=1' : ''}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(opts.token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { campaigns: [], brandPicks: [], error: json?.error || '캠페인을 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get manager campaigns:', e);
      return { campaigns: [], brandPicks: [], error: '네트워크 오류' };
    }
  },

  /**
   * 캠페인 성과(게시물 조회수 · 좋아요 · 댓글, 단가).
   *
   * 브랜드 · 담당자 · 인플루언서가 같은 엔드포인트를 부르고, 서버가 부르는 사람에
   * 맞춰 범위를 자른다(인플루언서는 자기 게시물만, 금액 없음). 화면이 역할별로
   * 다른 주소를 부르면 권한 판정이 화면 쪽 논리가 되어 버린다.
   */
  async getCampaignMetrics(
    campaignId: string,
    opts: { token?: string } = {},
  ): Promise<any> {
    try {
      const res = await authedGet(
        `/api/campaign-metrics?campaignId=${encodeURIComponent(campaignId)}`,
        () => collabHeaders(opts.token),
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '캠페인 성과를 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get campaign metrics:', e);
      return { error: '네트워크 오류' };
    }
  },

  /** "지금 수집" — 메타에 다시 물어 성과를 갱신한다. */
  async refreshCampaignMetrics(
    campaignId: string,
    opts: { token?: string } = {},
  ): Promise<any> {
    try {
      const res = await fetch('/api/campaign-metrics', {
        method: 'POST',
        credentials: 'same-origin',
        headers: await collabHeaders(opts.token),
        body: JSON.stringify({ campaignId, action: 'refresh' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '성과를 갱신하지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to refresh campaign metrics:', e);
      return { error: '네트워크 오류' };
    }
  },

  /**
   * 브랜드 일괄 정산금 수납(담당자).
   *
   * 브랜드는 인플루언서 한 명 한 명에게 송금하지 않고 픽스폴리오에 한 번 보낸다.
   * 그 입금이 확인되기 전에 인플루언서 지급을 닫으면 픽스폴리오 돈이 먼저 나가므로,
   * 담당자 정산 화면의 사람별 '정산완료' 버튼이 이 기록으로 잠긴다.
   */
  async getCampaignBrandSettlement(
    campaignId: string,
    opts: { token?: string } = {},
  ): Promise<{ settlement?: any; billing?: any; campaign?: any; error?: string }> {
    try {
      const res = await authedGet(
        `/api/campaign-brand-settlement?campaignId=${encodeURIComponent(campaignId)}`,
        () => collabHeaders(opts.token),
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '브랜드 정산 상태를 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get campaign brand settlement:', e);
      return { error: '네트워크 오류' };
    }
  },

  /** 브랜드 입금 확인 · 확인 되돌리기 · 청구액 저장(담당자). */
  async campaignBrandSettlementAction(
    campaignId: string,
    action: 'mark_received' | 'reopen' | 'save_invoice',
    payload: Record<string, any> = {},
    token?: string,
  ): Promise<{ success?: boolean; settlement?: any; billing?: any; error?: string }> {
    try {
      const res = await fetch('/api/campaign-brand-settlement', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify({ campaignId, action, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '처리에 실패했습니다.' };
      return json;
    } catch (e) {
      console.error(`[API] Brand settlement action failed (${action}):`, e);
      return { error: '네트워크 오류' };
    }
  },

  /** 캠페인 맡기 · 놓기 · 명단 공개(담당자). */
  async managerCampaignAction(
    campaignId: string,
    action: 'claim' | 'release' | 'publish_listup' | 'clear_due',
    payload: Record<string, any> = {},
    token?: string,
  ): Promise<any> {
    try {
      const res = await fetch('/api/manager-campaigns', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify({ campaignId, action, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '처리에 실패했습니다.' };
      return json;
    } catch (e) {
      console.error(`[API] Manager campaign action failed (${action}):`, e);
      return { error: '네트워크 오류' };
    }
  },

  /** 대화방 목록. 담당자는 `type='manager'` 로 배정된 협업의 두 채널을 함께 본다. */
  async getTimelineList(
    username: string,
    type: 'influencer' | 'business' | 'manager' = 'influencer',
    opts: { mine?: boolean; token?: string } = {},
  ): Promise<{ timelines?: any[]; error?: string }> {
    try {
      const params = new URLSearchParams({ type });
      if (opts.mine) params.set('mine', '1');
      const res = await fetch(
        `/api/timeline/list/${encodeURIComponent(username)}?${params.toString()}`,
        { credentials: 'same-origin', headers: await collabHeaders(opts.token) },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { timelines: [], error: json?.error || '대화 목록을 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get timeline list:', e);
      return { timelines: [], error: '네트워크 오류' };
    }
  },


  // ───────────────────── 인플루언서 채널(인스타 계정) 등록 ─────────────────────

  /**
   * 브랜드/인플루언서 매칭 등록서 접수.
   *
   * 로그인 없이도 접수되는 경로지만, 로그인한 사람이 보내면 서버가 본인 확인 후
   * 연동해 둔 인스타 지표(팔로워·팔로잉·릴스 평균 조회수)를 등록서에 붙여 준다.
   * 그래서 인증 헤더를 함께 실어 보낸다.
   */
  async submitCollabDirectory(payload: Record<string, any>): Promise<any> {
    try {
      const res = await fetch('/api/collab-directory', {
        method: 'POST',
        credentials: 'same-origin',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '등록에 실패했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to submit collab directory application:', e);
      return { error: '네트워크 오류' };
    }
  },

  /**
   * 내가 이미 매칭 등록서를 냈는지, 그리고 무엇을 적어 냈는지.
   *
   * 등록 버튼을 감출지 정하고, "수정하기"에서 접수한 내용을 되살리는 데 쓴다. 서버는
   * 본인 확인을 통과한 요청에만 등록서 내용을 실어 준다. 응답을 못 받으면
   * submitted:false 로 둔다: 이미 낸 사람에게 버튼이 한 번 더 보이는 것이,
   * 아직 안 낸 사람에게 버튼이 사라지는 것보다 낫다.
   */
  async getMyCollabDirectory(
    variant: 'influencer' | 'brand',
    username?: string,
  ): Promise<{
    submitted: boolean;
    status?: string;
    createdAt?: string | null;
    application?: Record<string, any> | null;
    error?: string;
  }> {
    try {
      const params = new URLSearchParams({ mine: '1', role: variant });
      if (username) params.set('username', username);
      const res = await fetch(`/api/collab-directory?${params.toString()}`, {
        credentials: 'same-origin',
        headers: await authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { submitted: false, error: json?.error || '확인하지 못했습니다.' };
      return {
        submitted: !!json.submitted,
        status: json.status || '',
        createdAt: json.createdAt || null,
        application: json.application || null,
      };
    } catch (e) {
      console.error('[API] Failed to check collab directory submission:', e);
      return { submitted: false, error: '네트워크 오류' };
    }
  },

  /**
   * 접수한 내 등록서 수정.
   *
   * 광고 단가는 접수한 뒤에도 바뀐다. 취소 후 재등록을 시키면 접수 순서를 잃고
   * 운영자 명단에는 같은 사람이 두 번 지나간 것처럼 보이므로, 제자리에서 고친다.
   * 보내지 않은 칸은 서버가 기존 값을 유지한다.
   */
  async updateMyCollabDirectory(
    variant: 'influencer' | 'brand',
    username: string,
    payload: Record<string, any>,
  ): Promise<{ success?: boolean; application?: Record<string, any> | null; error?: string }> {
    try {
      const params = new URLSearchParams({ mine: '1', role: variant });
      if (username) params.set('username', username);
      const res = await fetch(`/api/collab-directory?${params.toString()}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '수정하지 못했습니다.' };
      return { success: true, application: json?.application || null };
    } catch (e) {
      console.error('[API] Failed to update collab directory application:', e);
      return { error: '네트워크 오류' };
    }
  },

  /**
   * 내 매칭 등록서 취소/삭제.
   */
  async cancelMyCollabDirectory(
    variant: 'influencer' | 'brand',
    username?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const params = new URLSearchParams({ mine: '1', role: variant });
      if (username) params.set('username', username);
      const res = await fetch(`/api/collab-directory?${params.toString()}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: await authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: json?.error || '취소하지 못했습니다.' };
      return { success: true };
    } catch (e) {
      console.error('[API] Failed to cancel collab directory submission:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  async getCreatorChannel(username: string, token?: string): Promise<any> {
    try {
      const res = await fetch(`/api/creator-channel?username=${encodeURIComponent(username)}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '채널 정보를 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get creator channel:', e);
      return { error: '네트워크 오류' };
    }
  },

  /** 본인이 입력한 계정·지표 저장. */
  async saveCreatorChannel(payload: Record<string, any>): Promise<any> {
    try {
      const res = await fetch('/api/creator-channel', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '저장하지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to save creator channel:', e);
      return { error: '네트워크 오류' };
    }
  },

  /** 메타 API 로 최근 릴스·평균 조회수 갱신. 연동 전이면 META_NOT_LINKED 로 답한다. */
  async syncCreatorChannel(username: string, token?: string): Promise<any> {
    try {
      const res = await fetch('/api/creator-channel', {
        method: 'POST',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify({ username, action: 'sync' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '갱신하지 못했습니다.', code: json?.code };
      return json;
    } catch (e) {
      console.error('[API] Failed to sync creator channel:', e);
      return { error: '네트워크 오류' };
    }
  },

  /**
   * 캠페인용 인스타그램 연동 해제.
   *
   * 디엠 자동화 연동(disconnectInstagram)과는 다른 보관함이라 따로 끊는다. 한쪽을
   * 끊는다고 다른 쪽이 끊기면, 사람은 건드린 적 없는 기능이 멈춘 것을 나중에 안다.
   */
  async disconnectCreatorChannel(username: string): Promise<any> {
    try {
      const res = await fetch('/api/creator-channel', {
        method: 'POST',
        credentials: 'same-origin',
        headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: username }),
        body: JSON.stringify({ username: username.toLowerCase(), action: 'disconnect' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '연동을 해제하지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to disconnect creator channel:', e);
      return { error: '네트워크 오류로 연동을 해제하지 못했습니다.' };
    }
  },

  // ─── 인사이트 (인플루언서 본인 화면) ───────────────────────────────────────
  //
  // 새 연동을 만들지 않는다. 캠페인 등록에서 붙여 둔 계정(없으면 디엠 자동화 계정)의
  // 토큰으로 조회만 한다. 서버가 계정별로 굳혀 두므로 화면을 여러 번 열어도 메타를
  // 다시 부르지 않는다 — `refresh` 는 사람이 새로 불러오기를 누른 경우에만 쓴다.

  /** 계정 요약(팔로워·팔로잉·증감) + 최근 릴스 목록. */
  async getCreatorInsights(
    username: string,
    opts: { refresh?: boolean } = {},
  ): Promise<CreatorInsightsResponse> {
    try {
      const params = new URLSearchParams({ username: username.toLowerCase() });
      if (opts.refresh) params.set('refresh', '1');
      const res = await fetch(`/api/creator-insights?${params.toString()}`, {
        credentials: 'same-origin',
        headers: await authHeaders({}, { account: username }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { reels: [], error: json?.error || '인사이트를 불러오지 못했습니다.', code: json?.code };
      }
      return json as CreatorInsightsResponse;
    } catch (e) {
      console.error('[API] Failed to get creator insights:', e);
      return { reels: [], error: '네트워크 오류로 인사이트를 불러오지 못했습니다.' };
    }
  },

  /** 팔로워 증감 추이(일별 스냅샷). 배치를 켠 날부터만 값이 있다. */
  async getCreatorFollowerSeries(
    username: string,
    days: 7 | 30 | 90,
  ): Promise<FollowerSeriesResponse> {
    try {
      const params = new URLSearchParams({ username: username.toLowerCase(), days: String(days) });
      const res = await fetch(`/api/creator-insights/followers?${params.toString()}`, {
        credentials: 'same-origin',
        headers: await authHeaders({}, { account: username }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { days, points: [], collecting: true, error: json?.error || '추이를 불러오지 못했습니다.' };
      }
      return json as FollowerSeriesResponse;
    } catch (e) {
      console.error('[API] Failed to get follower series:', e);
      return { days, points: [], collecting: true, error: '네트워크 오류로 추이를 불러오지 못했습니다.' };
    }
  },

  /**
   * 팔로워의 성별·연령대·국가 분포.
   *
   * 기간 버튼과 무관한 값이라 추이와 따로 부른다. 서버가 여섯 시간 굳혀 두므로
   * 탭을 여닫아도 메타를 다시 부르지 않는다.
   */
  async getCreatorFollowerDemographics(
    username: string,
    opts: { refresh?: boolean } = {},
  ): Promise<FollowerDemographicsResponse> {
    const blank = (error: string): FollowerDemographicsResponse => ({
      age: [],
      gender: [],
      country: [],
      reason: 'error',
      error,
    });
    try {
      const params = new URLSearchParams({ username: username.toLowerCase() });
      if (opts.refresh) params.set('refresh', '1');
      const res = await fetch(`/api/creator-insights/demographics?${params.toString()}`, {
        credentials: 'same-origin',
        headers: await authHeaders({}, { account: username }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return blank(json?.error || '팔로워 분포를 불러오지 못했습니다.');
      return json as FollowerDemographicsResponse;
    } catch (e) {
      console.error('[API] Failed to get follower demographics:', e);
      return blank('네트워크 오류로 팔로워 분포를 불러오지 못했습니다.');
    }
  },

  /**
   * 같은 팔로워 규모 인플루언서들의 평균과 내 값.
   *
   * 메타를 부르지 않는 조회다(우리 DB 의 채널 표만 읽는다). 표본이 최소선 미만이면
   * `collecting: true` 로 오고, 그때 화면은 평균을 그리지 않는다.
   */
  async getCreatorBenchmark(username: string): Promise<BenchmarkResponse> {
    try {
      const params = new URLSearchParams({ username: username.toLowerCase() });
      const res = await fetch(`/api/creator-insights/benchmark?${params.toString()}`, {
        credentials: 'same-origin',
        headers: await authHeaders({}, { account: username }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, reason: 'error', error: json?.error || '비교 데이터를 불러오지 못했습니다.' };
      }
      return json as BenchmarkResponse;
    } catch (e) {
      console.error('[API] Failed to get creator benchmark:', e);
      return { ok: false, reason: 'error', error: '네트워크 오류로 비교 데이터를 불러오지 못했습니다.' };
    }
  },

  // ─── 태그된 콘텐츠 (브랜드 계정 화면) ─────────────────────────────────────
  //
  // 새 연동을 만들지 않는다. 디엠 자동화에서 붙여 둔 브랜드 계정의 토큰으로 조회만
  // 한다. 사용자명은 `biz/` 접두사를 붙인 그대로 보내야 서버가 브랜드 보관함을
  // 찾는다. 서버가 몇 시간 단위로 굳혀 두므로 새로고침해도 매번 다시 부르지 않는다.

  /** 우리 브랜드를 태그·언급한 릴스·게시물 목록. */
  async getBusinessTaggedMedia(
    username: string,
    opts: { refresh?: boolean } = {},
  ): Promise<TaggedMediaResponse> {
    try {
      const params = new URLSearchParams({ username: username.toLowerCase() });
      if (opts.refresh) params.set('refresh', '1');
      const res = await fetch(`/api/business-tagged-media?${params.toString()}`, {
        credentials: 'same-origin',
        headers: await authHeaders({}, { account: username }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          items: [],
          error: json?.error || '태그된 콘텐츠를 불러오지 못했습니다.',
          code: json?.code,
        };
      }
      return json as TaggedMediaResponse;
    } catch (e) {
      console.error('[API] Failed to get tagged media:', e);
      return { items: [], error: '네트워크 오류로 태그된 콘텐츠를 불러오지 못했습니다.' };
    }
  },

  // ─── 함께 방송하기 (co-broadcast) — friends ────────────────────────────────
  // List a creator's accepted co-broadcast friends plus pending friend requests
  // (incoming = others want to be my friend, outgoing = I'm awaiting acceptance).
  async listLiveFriends(owner: string): Promise<{
    friends: { username: string; display_name: string; avatar_url: string }[];
    incoming: { username: string; display_name: string; avatar_url: string }[];
    outgoing: { username: string; display_name: string; avatar_url: string }[];
  }> {
    try {
      const res = await fetch(`/api/live/friends?owner=${encodeURIComponent(owner.toLowerCase())}`);
      if (!res.ok) return { friends: [], incoming: [], outgoing: [] };
      const json = await res.json();
      return {
        friends: Array.isArray(json?.friends) ? json.friends : [],
        incoming: Array.isArray(json?.incoming) ? json.incoming : [],
        outgoing: Array.isArray(json?.outgoing) ? json.outgoing : [],
      };
    } catch (e) {
      console.error('[API] Failed to list live friends:', e);
      return { friends: [], incoming: [], outgoing: [] };
    }
  },

  // Send a friend request. Usernames are unique, so the username is the identity
  // — the server validates the account exists before creating the request. The
  // recipient must accept before the friendship shows in either list. Flags in
  // the response distinguish a fresh request from an auto-accept (when the other
  // person had already requested us) or an already-existing friendship.
  async addLiveFriend(owner: string, friendUsername: string): Promise<{ success: boolean; requested?: boolean; accepted?: boolean; alreadyFriends?: boolean; friend?: { username: string; display_name: string; avatar_url: string }; error?: string }> {
    try {
      const res = await fetch('/api/live/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: owner.toLowerCase(), friendUsername: friendUsername.toLowerCase() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: json?.error || '친구 요청에 실패했습니다.' };
      return { success: true, requested: json?.requested, accepted: json?.accepted, alreadyFriends: json?.alreadyFriends, friend: json?.friend };
    } catch (e) {
      console.error('[API] Failed to add live friend:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // Accept a friend request that `requester` sent to `me`.
  async acceptFriendRequest(me: string, requester: string): Promise<{ success: boolean; friend?: { username: string; display_name: string; avatar_url: string }; error?: string }> {
    try {
      const res = await fetch('/api/live/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: me.toLowerCase(), friendUsername: requester.toLowerCase(), action: 'accept' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: json?.error || '수락에 실패했습니다.' };
      return { success: true, friend: json?.friend };
    } catch (e) {
      console.error('[API] Failed to accept friend request:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // Decline a friend request that `requester` sent to `me`.
  async declineFriendRequest(me: string, requester: string): Promise<boolean> {
    try {
      const res = await fetch('/api/live/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: me.toLowerCase(), friendUsername: requester.toLowerCase(), action: 'decline' }),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to decline friend request:', e);
      return false;
    }
  },

  async removeLiveFriend(owner: string, friend: string): Promise<boolean> {
    try {
      const res = await fetch(
        `/api/live/friends?owner=${encodeURIComponent(owner.toLowerCase())}&friend=${encodeURIComponent(friend.toLowerCase())}`,
        { method: 'DELETE' }
      );
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to remove live friend:', e);
      return false;
    }
  },

  // ─── 함께 방송하기 (co-broadcast) — sessions ───────────────────────────────

  // Host invites a guest (by username) to co-broadcast. Sends an in-app +
  // push invite; returns the created/existing session id.
  async inviteCobroadcast(host: string, guest: string): Promise<{ success: boolean; sessionId?: string; status?: string; error?: string }> {
    try {
      const res = await fetch('/api/cobroadcast', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'invite', host: host.toLowerCase(), guest: guest.toLowerCase() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: json?.error || '초대에 실패했습니다.' };
      return { success: true, sessionId: json?.sessionId, status: json?.status };
    } catch (e) {
      console.error('[API] Failed to invite cobroadcast:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // Pending invites addressed to this user (invitee polls this).
  async getCobroadcastInvites(username: string): Promise<{ id: string; host: string; host_display_name: string; host_avatar_url: string }[]> {
    try {
      const res = await fetch(`/api/cobroadcast?incoming=${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json?.invites) ? json.invites : [];
    } catch {
      return [];
    }
  },

  // The user's own current accepted/live session (host or guest), if any.
  async getActiveCobroadcast(username: string): Promise<{ id: string; status: string; role: 'host' | 'guest'; partner: string; partner_display_name: string; partner_avatar_url: string } | null> {
    try {
      const res = await fetch(`/api/cobroadcast?active=${encodeURIComponent(username.toLowerCase())}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.session || null;
    } catch {
      return null;
    }
  },

  // The live partner channel for a broadcaster (viewers use this for split view).
  async getCobroadcastPartner(channel: string): Promise<{ partner: string; partner_display_name: string; partner_avatar_url: string; sessionId: string } | null> {
    try {
      const res = await fetch(`/api/cobroadcast?channel=${encodeURIComponent(channel.toLowerCase())}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json?.partner ? json : null;
    } catch {
      return null;
    }
  },

  async respondCobroadcast(action: 'accept' | 'decline' | 'live' | 'end', sessionId: string, user: string): Promise<boolean> {
    try {
      const res = await fetch('/api/cobroadcast', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action, sessionId, user: user.toLowerCase() }),
      });
      return res.ok;
    } catch (e) {
      console.error(`[API] Failed to ${action} cobroadcast:`, e);
      return false;
    }
  },

  // ---- Instagram DM 자동화 ----
  //
  // 이 화면은 설정을 받아오기 전까지 스피너만 보여준다. 그래서 실패를 "빈 설정"으로
  // 삼키면 안 된다 — 특히 자격(entitled)을 false 로 내려 버리면, 프로 플랜을 결제한
  // 사용자가 네트워크가 한 번 흔들린 것만으로 "프로 전용 기능입니다" 안내를 보게 된다.
  // 실패는 loadError 로 분명히 알리고, 자격 여부는 모른다는 뜻으로 그대로 둔다.
  async getDmAutomation(username: string): Promise<DmAutomationSettings> {
    try {
      const account = { account: username };
      let lastError: unknown = new Error('DM automation request failed');

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const res = await fetchWithTimeout(`/api/dm-automation/${encodeURIComponent(username.toLowerCase())}`, {
            cache: 'no-store',
            headers: await authHeadersWithTimeout({}, account),
          });
          if (res.ok) return await res.json();

          lastError = new Error(`HTTP ${res.status}`);
          const transient = res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500;
          const refreshableAuth = res.status === 401 && !isBusinessRequest(account);
          if (attempt > 0 || (!transient && !refreshableAuth)) throw lastError;

          if (refreshableAuth) {
            // supabase 클라이언트에 세션이 아예 없으면 refreshSession() 은 손쓸 게
            // 없다. 저장된 리프레시 토큰으로 직접 되살린다.
            await refreshSupabaseSession();
          }
        } catch (error) {
          lastError = error;
          if (error instanceof Error && /^HTTP \d+$/.test(error.message)) throw error;
          if (attempt > 0) throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      throw lastError;
    } catch (e) {
      console.error('[API] Failed to get DM automation:', e);
      return {
        enabled: false, connected: false, igUserId: '', igAccountId: '', igUsername: '',
        hasAccessToken: false, automations: [], requiredTier: 'pro', loadError: true,
      };
    }
  },

  // 연동된 인스타그램 계정의 피드 게시물 목록.
  // 그래프 API 를 여러 페이지 훑기 때문에 다른 호출보다 여유를 둔다.
  async getInstagramMedia(username: string): Promise<InstagramMedia[]> {
    try {
      const res = await fetchWithTimeout(
        `/api/instagram/media/${encodeURIComponent(username.toLowerCase())}`,
        { cache: 'no-store', headers: await authHeadersWithTimeout({}, { account: username }) },
        25_000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.media) ? data.media : [];
    } catch (e) {
      console.error('[API] Failed to get Instagram media:', e);
      return [];
    }
  },

  // 설정 저장.
  //
  // 자동화를 고칠 때는 목록 전체가 아니라 바뀐 한 건만(`action: 'upsertAutomation'`)
  // 보낸다. 목록 전체를 보내면 저장 요청이 겹치거나 응답 순서가 뒤바뀔 때 늦게
  // 도착한 옛 목록이 방금 고친 문구를 되돌려 놓는다(화면은 새 문구인데 DM 은 예전
  // 문구로 나가는 원인이었다). 서버는 저장된 목록을 그대로 돌려주므로, 호출부는
  // 그 값으로 화면 상태를 맞춰 "보이는 내용 = 발송될 내용"을 유지한다.
  async saveDmAutomation(
    username: string,
    settings: Partial<DmAutomationSettings> & {
      action?: 'upsertAutomation' | 'deleteAutomation';
      automation?: DmAutomationItem;
      id?: string;
    },
  ): Promise<{ ok: boolean; error?: string; automations?: DmAutomationItem[]; enabled?: boolean }> {
    try {
      const res = await fetchWithTimeout(`/api/dm-automation/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeadersWithTimeout(
          { 'Content-Type': 'application/json' },
          { account: username },
        ),
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({} as any));
        return {
          ok: true,
          automations: Array.isArray(data?.automations) ? data.automations : undefined,
          // 서버가 확정한 전체 스위치 상태. 화면이 이 값을 따라가야 "켜져 있다고
          // 보이는데 발송은 안 되는" 상태가 생기지 않는다.
          enabled: typeof data?.enabled === 'boolean' ? data.enabled : undefined,
        };
      }
      // 잘못된 버튼 링크처럼 사용자가 고칠 수 있는 오류는 서버 메시지를 그대로 보여준다.
      // 다른 곳에서 먼저 수정된 경우(409 STALE_AUTOMATION)에는 서버가 최신 목록을 함께
      // 내려주므로, 화면이 그 값으로 맞출 수 있게 전달한다.
      const data = await res.json().catch(() => ({} as any));
      return {
        ok: false,
        error: data?.error || `저장에 실패했습니다. (HTTP ${res.status})`,
        automations: Array.isArray(data?.automations) ? data.automations : undefined,
      };
    } catch (e) {
      console.error('[API] Failed to save DM automation:', e);
      return { ok: false, error: '네트워크 오류로 저장에 실패했습니다.' };
    }
  },

  /**
   * 계정별 웹훅 구독을 다시 건다.
   *
   * 댓글 이벤트는 계정별 `subscribed_apps` 구독이 있어야 도착한다. 이 구독은
   * 토큰 재발급·권한 변경으로 조용히 풀릴 수 있고, 그러면 화면상 자동 발송은
   * 켜져 있는데 댓글에 아무 일도 일어나지 않는다. 사용자가 직접 다시 걸 수 있게 한다.
   */
  async resubscribeDmWebhook(
    username: string,
  ): Promise<{ ok: boolean; error?: string; webhookSubscribedAt?: string; webhookFields?: string }> {
    try {
      const res = await fetchWithTimeout(`/api/dm-automation/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeadersWithTimeout(
          { 'Content-Type': 'application/json' },
          { account: username },
        ),
        body: JSON.stringify({ action: 'resubscribeWebhook' }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.success !== true) {
        return { ok: false, error: data?.error || `웹훅 구독에 실패했습니다. (HTTP ${res.status})` };
      }
      return {
        ok: true,
        webhookSubscribedAt: data?.webhookSubscribedAt,
        webhookFields: data?.webhookFields,
      };
    } catch (e) {
      console.error('[API] Failed to resubscribe DM webhook:', e);
      return { ok: false, error: '네트워크 오류로 웹훅 구독을 다시 걸지 못했습니다.' };
    }
  },

  /** 외부에서 나간 자동 DM 안내를 확인 처리(기록 삭제)한다. */
  async dismissExternalDm(username: string): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`/api/dm-automation/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeadersWithTimeout(
          { 'Content-Type': 'application/json' },
          { account: username },
        ),
        body: JSON.stringify({ action: 'dismissExternalDm' }),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to dismiss external DM notice:', e);
      return false;
    }
  },

  // 인스타그램 계정 연동 시작 — 인증된 요청으로 서명된 state 를 받아 authorize URL 을 얻는다.  // (예전처럼 GET 링크로 바로 이동하면 서명 없는 state 라 계정 연동 CSRF 가 성립한다.)
  //
  // returnTo 는 연동을 마친 뒤 돌아올 우리 사이트 내부 경로다. 브랜드 매칭 등록처럼
  // 관리자 화면이 아닌 곳에서 연동을 시작하면 이 값을 넘겨 원래 있던 화면으로 복귀한다.
  //
  // purpose 는 이 연동이 어느 기능의 것인지다. 'collab'(캠페인 등록)로 시작한 연동은
  // 디엠 자동화와 다른 보관함에 저장되고, 인스타그램 로그인도 매번 새로 받는다.
  async instagramConnectUrl(
    username: string,
    returnTo?: string,
    purpose?: 'collab',
  ): Promise<{ url?: string; error?: string }> {
    try {
      const res = await fetch('/api/instagram/oauth/start', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: username }),
        body: JSON.stringify({ username: username.toLowerCase(), returnTo, purpose }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data?.url) {
        return { error: data?.error || `연동을 시작하지 못했습니다. (HTTP ${res.status})` };
      }
      return { url: data.url as string };
    } catch (e) {
      console.error('[API] Failed to start Instagram OAuth:', e);
      return { error: '네트워크 오류로 연동을 시작하지 못했습니다.' };
    }
  },

  // 인스타그램 계정 연동 해제.
  async disconnectInstagram(username: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/dm-automation/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: username }),
        body: JSON.stringify({ action: 'disconnect' }),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to disconnect Instagram:', e);
      return false;
    }
  },

  // 댓글 작성자 일괄 발송은 대상 수에 따라 오래 걸린다. 서버는 시간 예산 안에서
  // 처리할 만큼만 보내고 남은 수(remaining)를 알려주므로, 클라이언트는 그보다
  // 넉넉한 타임아웃을 둔다.
  //
  // 응답을 받지 못한 경우를 "발송 실패"로 단정하면 안 된다. 요청이 끊기기 전까지
  // 이미 발송된 DM 이 있을 수 있고(수신자에게는 도착했다), 그때 화면이 빨간 실패를
  // 띄우면 사용자는 도착한 DM 을 보면서 실패 안내를 읽게 된다. 결과를 알 수 없는
  // 상태는 indeterminate 로 구분해 돌려준다.
  async sendInstagramDm(payload: {
    username: string;
    recipientId?: string;
    mediaId?: string;
    mediaIds?: string[];
    message: string;
    messageType?: 'text' | 'carousel';
    buttons?: DmMessageButton[];
    cards?: DmCarouselCard[];
    /** 캐러셀 앞에 먼저 보낼 인사말(선택). */
    intro?: string;
    /** 댓글에 함께 남길 공개 답글 문구. 비어 있으면 답글은 달지 않는다. */
    replies?: string[];
    ruleId?: string;
    test?: boolean;
  }): Promise<{
    success: boolean;
    connected?: boolean;
    count?: number;
    partialCount?: number;
    alreadyCount?: number;
    failCount?: number;
    /** 공개 답글을 실제로 남긴 댓글 수. */
    replyCount?: number;
    /** 답글을 남기지 못한 댓글 수. */
    replyFailCount?: number;
    remaining?: number;
    total?: number;
    message?: string;
    /** 요청이 거절된 이유(플랜 미충족 등). `message` 가 없을 때 화면에 쓴다. */
    error?: string;
    indeterminate?: boolean;
  }> {
    try {
      const res = await fetchWithTimeout(
        '/api/send-instagram-dm',
        {
          method: 'POST',
          headers: await authHeaders(
            { 'Content-Type': 'application/json' },
            { account: payload.username },
          ),
          body: JSON.stringify({ ...payload, username: payload.username.toLowerCase() }),
        },
        65_000,
      );

      const data = await res.json().catch(() => null);
      if (data && typeof data.success === 'boolean') return data;

      // 서버가 JSON 결과를 주지 못했다(504 타임아웃, 게이트웨이 오류 등).
      return {
        success: false,
        indeterminate: true,
        message:
          '발송 요청이 시간 내에 끝나지 않았습니다. 일부는 이미 발송됐을 수 있으니, 인스타그램 DM 함을 확인한 뒤 다시 발송해 주세요. (이미 받은 사람에게는 중복 발송되지 않습니다.)',
      };
    } catch (e: any) {
      console.error('[API] Failed to send Instagram DM:', e);
      const aborted = e?.name === 'AbortError';
      return {
        success: false,
        indeterminate: true,
        message: aborted
          ? '발송이 아직 진행 중일 수 있습니다. 잠시 뒤 발송 버튼을 다시 누르면 남은 대상에게만 이어서 발송합니다.'
          : '네트워크 오류로 발송 결과를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요. (이미 받은 사람에게는 중복 발송되지 않습니다.)',
      };
    }
  },
};
