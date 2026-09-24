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

/**
 * 메타 광고 계정 연동 진단 결과 — 콜백(`meta-ads-oauth-callback`)이 남긴 그대로다.
 *
 * 화면이 쓰는 값이 여기 다 들어 있다: 연동한 메타 계정, 접근 가능한 광고 계정 목록,
 * 그리고 동의 화면에서 실제로 승인·거부된 권한. 토큰은 저장하지 않으므로 없다.
 */
export interface MetaAdsProbePayload {
  ok: boolean;
  status: number;
  count?: number;
  error?: string;
  errorCode?: number;
  accountId?: string;
}

export interface MetaAdsDiagnosisPayload {
  connected: true;
  connectedAt: string;
  metaUserId: string;
  metaUserName: string;
  scopesRequested: string[];
  granted: string[];
  declined: string[];
  accounts: {
    id: string;
    name: string;
    businessName: string;
    currency: string;
    accountStatus?: number;
  }[];
  businesses: { id: string; name: string }[];
  probes: {
    me: MetaAdsProbePayload;
    permissions: MetaAdsProbePayload;
    adaccounts: MetaAdsProbePayload;
    businesses: MetaAdsProbePayload;
    campaigns: MetaAdsProbePayload;
  };
  tokenStored: false;
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
    token = persistedSupabaseToken();
    if (!token) token = usableToken(lastKnownSupabaseToken);
    if (!token) {
      try {
        const { data } = (await supabase?.auth.getSession()) || { data: null };
        token = data?.session?.access_token || '';
      } catch {
        token = '';
      }
    }
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
  /** 화면을 벗어나면 취소할 수 있게 — 주기적으로 부르는 조회가 쓴다. */
  opts: { signal?: AbortSignal } = {},
): Promise<Response> {
  const res = await fetchWithTimeout(
    url,
    { credentials: 'same-origin', headers: await build(), signal: opts.signal },
  );
  if (res.status !== 401) return res;

  const refreshed = await refreshSupabaseSession();
  if (!refreshed) return res;
  return await fetchWithTimeout(
    url,
    { credentials: 'same-origin', headers: await build(), signal: opts.signal },
  );
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
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
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

/** 가입 직후 "나만의 링크"(아이디) 만들기 결과. */
export interface ClaimUsernameResult {
  ok: boolean;
  /** 실제로 저장된 아이디. 실패면 빈 문자열. */
  username: string;
  /** 사람이 읽을 수 있는 실패 이유. 성공이면 빈 문자열. */
  error: string;
  /**
   * 서버가 분류한 이유. 화면이 안내를 다르게 해야 하는 값만 쓴다 —
   * `taken`(다른 이름), `auth`(다시 로그인), 그 외는 "잠시 후 다시 시도".
   */
  reason: string;
}

/**
 * 가입 직후 정하는 "나만의 링크" 를 저장한다.
 *
 * 예전에는 화면(SetupLink)이 수파베이스 `profiles` 로 직접 upsert 했다. 그 경로에서는
 * 무엇이 잘못됐는지 화면이 알 수 없어 전부 "저장 중 오류가 발생했습니다." 였다 —
 * 이름이 이미 쓰이고 있어도, 세션이 아직 복구되지 않아 사용자 ID 가 비어 있어도,
 * RLS 가 막아도 같은 한 줄이었다. 지금은 서버가 이유를 붙여 답한다.
 *
 * 401 은 한 번 되살려 다시 보낸다. 링크를 만드는 화면은 인스타그램 연동과 마찬가지로
 * 로그인 직후(세션 복구와 경합하는 시점)에 열리므로, 토큰이 잠깐 준비되지 않은 것이
 * "다시 로그인" 으로 끝나면 안 된다. 같은 이름으로 다시 보내도 결과가 같으므로
 * (서버가 이미 내 것이면 성공으로 답한다) 재시도가 안전하다.
 */
export async function claimUsername(username: string): Promise<ClaimUsernameResult> {
  const body = JSON.stringify({ username });
  const generic = '링크를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const last = attempt === 1;
    try {
      const res = await fetchWithTimeout(
        '/.netlify/functions/auth-claim-username',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: await authHeadersWithTimeout({ 'Content-Type': 'application/json' }),
          body,
        },
        20_000,
      );

      if (res.status === 401 && !last) {
        const refreshed = await refreshSupabaseSession();
        if (refreshed) continue;
      }

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        return { ok: true, username: String(data.username || username), error: '', reason: '' };
      }
      // 이미 링크가 있는 계정이었다. 그 링크로 그대로 들어가면 된다 — 이 화면에
      // 갇히는 것보다 낫다. 어느 이름이 쓰였는지는 대시보드가 보여준다.
      if (data?.reason === 'already_set' && data?.username) {
        return { ok: true, username: String(data.username), error: '', reason: 'already_set' };
      }
      if (res.status === 401) {
        return {
          ok: false,
          username: '',
          error: String(data?.error || '로그인이 만료되었습니다. 다시 로그인해 주세요.'),
          reason: 'auth',
        };
      }
      // 서버가 이유를 준 실패(이미 쓰는 이름 · 예약어 · 형식)는 다시 보내도 같다.
      if (isRetryableStatus(res.status) && !last) continue;

      return {
        ok: false,
        username: '',
        error: String(data?.error || generic),
        reason: String(data?.reason || 'error'),
      };
    } catch (e) {
      if (!last) continue;
      console.error('[API] 링크 저장 실패:', e);
      return { ok: false, username: '', error: generic, reason: 'network' };
    }
  }

  return { ok: false, username: '', error: generic, reason: 'error' };
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
  /**
   * 프로 플랜 자격. 인사이트는 디엠 자동화와 같은 프로 플랜 전용 기능이다.
   *
   * 없으면(undefined) 자격이 있는 것으로 본다 — 서버는 막을 때만 이 값을 내려보내고,
   * 자격이 있는 응답에는 붙이지 않는다. 디엠 자동화 설정 응답과 같은 규칙이다.
   */
  entitled?: boolean;
  requiredTier?: MembershipTier;
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

export interface DmAutomationSettings {
  enabled: boolean;
  connected: boolean;
  igUserId: string;
  igAccountId: string;
  igUsername: string;
  hasAccessToken: boolean;
  automations: DmAutomationItem[];
  /** DM 창 첫 화면의 "자주 묻는 질문"(인스타그램 아이스브레이커). */
  faq?: DmFaqSettings;
  /** DM 수신을 트리거로 쓰는 자동화(첫 인사말 · 키워드 자동 답장). */
  direct?: DmDirectSettings;
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
  /** 계정별 웹훅 구독(`subscribed_apps`)을 마친 시각. 비어 있으면 구독 자체가 없다. */
  webhookSubscribedAt?: string;
  /**
   * 실제로 구독에 성공한 웹훅 필드 목록.
   *
   * 화면은 이 값으로 경고를 띄우지 않는다 — 구독은 설정을 불러올 때 서버가 스스로
   * 다시 건다(api-dm-automation 의 healWebhookSubscription). 진단용으로만 읽는다.
   */
  webhookFields?: string;
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

/**
 * DM 창 첫 화면에 보이는 "자주 묻는 질문" 한 건.
 *
 * 인스타그램 아이스브레이커로 등록된다. 등록되는 것은 `question`(버튼 문구)이고,
 * 사람이 버튼을 누르면 `answer` 가 자동으로 발송된다.
 */
export interface DmFaqItem {
  id: string;
  question: string;
  answer: string;
  buttons: DmMessageButton[];
}

export interface DmFaqSettings {
  enabled: boolean;
  items: DmFaqItem[];
  /**
   * 인스타그램에 등록을 마친 시각. 비어 있으면 저장은 됐지만 DM 창에는 아직
   * 보이지 않는 상태다(대개 연동이 끊겼거나 권한이 부족한 경우).
   */
  syncedAt?: string;
  /** 등록 실패 이유. */
  syncError?: string;
}

/** 처음 DM 을 받았을 때 자동으로 보낼 인사말. */
export interface DmGreetingSettings {
  enabled: boolean;
  message: string;
  buttons: DmMessageButton[];
  /** 처음 대화하는 사람에게만 보낼지. 끄면 24시간 넘게 끊겼던 대화가 다시 시작될 때도 보낸다. */
  onlyFirstContact: boolean;
}

/** 받은 DM 에 특정 단어가 있을 때 보낼 자동 답장. */
export interface DmKeywordReply {
  id: string;
  name: string;
  enabled: boolean;
  keywords: string[];
  message: string;
  buttons: DmMessageButton[];
  createdAt: string;
  updatedAt?: string;
}

export interface DmDirectSettings {
  greeting: DmGreetingSettings;
  replies: DmKeywordReply[];
}

/** 인스타그램이 허용하는 "자주 묻는 질문" 최대 개수. 우리가 늘릴 수 없는 값이다. */
export const DM_FAQ_MAX = 4;
/** 질문 버튼 문구 길이 제한. */
export const DM_FAQ_QUESTION_MAX = 80;

/**
 * 예약 발송 대상 — 이 계정에 DM 을 보낸 적이 있는 사람.
 *
 * 인스타그램은 상대가 마지막으로 메시지를 보낸 뒤 24시간 안에만 자유 형식 DM 을
 * 허용하므로, 예약 발송 대상은 이 명단에서만 고를 수 있다(임의의 계정에 먼저 말을
 * 거는 발송은 정책 위반이다).
 */
export interface DmContact {
  igsid: string;
  name?: string;
  username?: string;
  firstAt: string;
  lastAt: string;
  lastText?: string;
  count: number;
  /** 지금 자유 형식 DM 을 보낼 수 있는지. */
  open: boolean;
  /** 이 시각까지만 보낼 수 있다(상대의 마지막 메시지 + 24시간). */
  openUntil: string;
}

/** 예약 DM 한 건. */
export interface DmScheduledJob {
  id: string;
  username: string;
  recipientId: string;
  recipientName?: string;
  sendAt: string;
  message: string;
  buttons: { label: string; url: string }[];
  createdAt: string;
  status: 'pending' | 'sent' | 'failed' | 'canceled' | 'uncertain';
  sentAt?: string;
  error?: string;
  errorKind?: string;
  contactLastAt?: string;
  /**
   * 이 예약을 누가 만들었는지.
   *  `manual`(기본) — 예약 발송 화면에서 직접 만든 예약.
   *  `comment`      — 게시물 자동화를 "예약 발송"으로 설정해 둔 덕에, 댓글이 달린
   *                   순간 대기열에 들어온 예약.
   */
  source?: 'manual' | 'comment';
  /** 발송 형식. 값이 없으면 텍스트(예전 예약 호환). */
  messageType?: 'text' | 'carousel';
  /** 캐러셀 카드(형식이 carousel 일 때). */
  cards?: DmCarouselCard[];
  /** 댓글에서 만들어진 예약이면 그 댓글 ID(비공개 답장으로 나간다). */
  commentId?: string;
  /** 댓글이 달린 시각. 비공개 답장은 이 시각부터 7일 안에만 보낼 수 있다. */
  commentAt?: string;
  /** 이 예약을 만든 자동화. */
  ruleId?: string;
  ruleName?: string;
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
  buttons: DmMessageButton[];
  cards: DmCarouselCard[];
  /**
   * 조건에 맞는 댓글을 받았을 때 DM 을 언제 보낼지.
   *  `instant`(기본) — 곧바로 보낸다.
   *  `scheduled`     — `scheduledAt` 까지 기다렸다가 보낸다.
   */
  sendMode?: 'instant' | 'scheduled';
  /** 예약 발송 시각(ISO). 즉시 발송이면 빈 문자열. */
  scheduledAt?: string;
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

/**
 * 게시물 목록 조회 결과.
 *
 * 목록만으로는 "게시물이 없는 계정"과 "받아오지 못했다"를 구별할 수 없어서, 화면이
 * 둘에게 같은 말을 하게 된다. 사유를 함께 들고 다닌다.
 */
export interface InstagramMediaResult {
  media: InstagramMedia[];
  /** 인스타그램 계정이 연동돼 있는지. 연동 전이면 목록이 비어 있는 게 정상이다. */
  connected: boolean;
  /** 더 받을 게 남았을 때의 이어보기 커서. 다 받았으면 빈 문자열. */
  nextCursor: string;
  /** 사람에게 보여줄 실패 사유. 성공이면 빈 문자열. */
  error: string;
  /** 연동이 만료돼 다시 동의가 필요한 상태. */
  needsReauth: boolean;
  /** 지금 받아오지 못해 예전에 보관해 둔 목록을 보여주는 중. */
  stale: boolean;
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
const siteDataVersions: Record<string, symbol> = {};
const siteDataSaveQueues = new Map<string, Promise<unknown>>();

function serializeSiteDataSave<T>(username: string, task: () => Promise<T>): Promise<T> {
  const key = username.toLowerCase();
  const previous = siteDataSaveQueues.get(key) || Promise.resolve();
  const current = previous.then(task, task);
  siteDataSaveQueues.set(key, current);
  current.finally(() => {
    if (siteDataSaveQueues.get(key) === current) siteDataSaveQueues.delete(key);
  }).catch(() => {});
  return current;
}

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

type MemoryEntry<T> = { value?: T; inFlight?: Promise<T>; expiresAt: number };
const requestMemory = new Map<string, MemoryEntry<unknown>>();

function readMemory<T>(key: string, ttlMs: number, loader: () => Promise<T>, refresh = false): Promise<T> {
  const now = Date.now();
  const hit = requestMemory.get(key) as MemoryEntry<T> | undefined;
  if (!refresh && hit?.value !== undefined && hit.expiresAt > now) {
    return Promise.resolve(hit.value);
  }
  if (!refresh && hit?.inFlight) return hit.inFlight;
  const inFlight = loader()
    .then((value) => {
      if (requestMemory.get(key)?.inFlight === inFlight) {
        if (value == null || (typeof value === 'object' && 'error' in value && value.error)) {
          requestMemory.delete(key);
        } else {
          requestMemory.set(key, { value, expiresAt: Date.now() + ttlMs });
        }
      }
      return value;
    })
    .catch((error) => {
      if (requestMemory.get(key)?.inFlight === inFlight) requestMemory.delete(key);
      throw error;
    });
  for (const [entryKey, entry] of requestMemory) {
    if (!entry.inFlight && entry.expiresAt <= now) requestMemory.delete(entryKey);
  }
  if (requestMemory.size >= 100) {
    const oldest = requestMemory.keys().next().value;
    if (oldest !== undefined) requestMemory.delete(oldest);
  }
  requestMemory.set(key, { inFlight, expiresAt: now + ttlMs });
  return inFlight;
}

function clearMemory(prefix: string): void {
  for (const key of requestMemory.keys()) {
    if (key.startsWith(prefix)) requestMemory.delete(key);
  }
}

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

    const version = Symbol();
    siteDataVersions[key] = version;
    const request = (async () => {
      try {
        const res = await fetchWithTimeout(`/api/site/${encodeURIComponent(key)}`);
        if (!res.ok) return null;
        const data = (await res.json()) as SiteData;
        if (siteDataVersions[key] !== version) return siteDataCache[key]?.data || null;
        siteDataCache[key] = { data, ts: Date.now() };
        return data;
      } catch (e) {
        console.error('[API] Failed to get site data:', e);
        return null;
      } finally {
        if (siteDataVersions[key] === version) delete siteDataInflight[key];
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
  async saveSiteDataResult(username: string, data: Partial<SiteData>, opts?: { force?: boolean }): Promise<SaveResult> {
    return serializeSiteDataSave(username, async () => {
      try {
        const query = opts?.force ? '?force=true' : '';
        const res = await fetch(`/api/site/${encodeURIComponent(username.toLowerCase())}${query}`, {
          method: 'POST',
          headers: await authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(data)
        });
        if (res.ok) {
          // Keep the cache in sync with what we just persisted so a subsequent
          // navigation doesn't briefly render pre-save data. Create the entry even
          // when nothing was cached yet, so the very next read is immediately fresh.
          const key = username.toLowerCase();
          delete siteDataVersions[key];
          delete siteDataInflight[key];
          const cached = siteDataCache[key];
          const base = (cached?.data || {}) as SiteData;
          if (cached) {
            siteDataCache[key] = {
              data: {
                ...base, ...data,
                ...(data.profile ? { profile: { ...base.profile, ...data.profile } } : {}),
                ...(data.design ? { design: { ...base.design, ...data.design } } : {}),
                ...(data.socials ? { socials: { ...base.socials, ...data.socials } } : {}),
              },
              ts: Date.now(),
            };
          } else {
            delete siteDataCache[key];
          }
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
    });
  },

  async saveSiteData(username: string, data: Partial<SiteData>, opts?: { force?: boolean }): Promise<boolean> {
    return (await apiService.saveSiteDataResult(username, data, opts)).ok;
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
        headers: await authHeaders({}, { account: username }),
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

  // Business Proposals API
  async submitProposal(username: string, proposal: Omit<BusinessProposal, 'id' | 'influencer_username' | 'status' | 'created_at'>): Promise<boolean> {
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders(
          { 'Content-Type': 'application/json' },
          { account: `biz/${proposal.business_username}` },
        ),
        body: JSON.stringify(proposal)
      });
      if (res.ok) {
        clearMemory('proposals:');
        clearMemory('businessProposals:');
      }
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to submit proposal:', e);
      return false;
    }
  },

  async getBusinessProposals(username: string): Promise<{
    proposals: BusinessProposal[];
    hiddenIds: string[];
    error?: string;
  }> {
    const account = normalizeAccount(username);
    return readMemory(`businessProposals:${account}`, 20_000, async () => {
      try {
        const res = await fetchWithTimeout(`/api/business-proposals/${encodeURIComponent(account)}`, {
          headers: await authHeaders({}, { account }),
        }, 15_000);
        const data = await res.json();
        if (!res.ok) return { proposals: [], hiddenIds: [], error: data.error || '제안을 불러오지 못했습니다.' };
        return {
          proposals: Array.isArray(data.proposals) ? data.proposals : [],
          hiddenIds: Array.isArray(data.hiddenIds) ? data.hiddenIds : [],
        };
      } catch {
        return { proposals: [], hiddenIds: [], error: '네트워크 오류' };
      }
    });
  },

  async getProposals(username: string): Promise<BusinessProposal[]> {
    const key = normalizeAccount(username);
    return (await readMemory<BusinessProposal[] | null>(`proposals:${key}`, 30_000, async () => {
      try {
        const res = await fetchWithTimeout(`/api/proposals/${encodeURIComponent(username.toLowerCase())}`, {
          headers: await authHeaders(),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.proposals || [];
      } catch (e) {
        console.error('[API] Failed to get proposals:', e);
        return null;
      }
    })) || [];
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
      if (res.ok) {
        clearMemory(`proposals:${normalizeAccount(username)}`);
        clearMemory(`settlements:${normalizeAccount(username)}:`);
        clearMemory('businessProposals:');
        clearMemory('collabRecords:');
        clearMemory('collabs:');
      }
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
      if (res.ok) {
        clearMemory('proposals:');
        clearMemory('businessProposals:');
        clearMemory('settlements:');
        clearMemory('collabRecords:');
        clearMemory('collabs:');
      }
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
      if (res.ok) {
        clearMemory('businessProposals:');
        if (scope !== 'hide') {
          clearMemory('proposals:');
          clearMemory('settlements:');
          clearMemory('collabRecords:');
          clearMemory('collabs:');
        }
      }
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
        headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: username }),
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

  // Collaboration Records API
  async getCollabRecords(username: string): Promise<CollabRecord[]> {
    const key = normalizeAccount(username);
    return (await readMemory<CollabRecord[] | null>(`collabRecords:${key}`, 30_000, async () => {
      try {
        const res = await fetchWithTimeout(`/api/collabs/${encodeURIComponent(username.toLowerCase())}`, {
          headers: await authHeaders(),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.records || [];
      } catch (e) {
        console.error('[API] Failed to get collab records:', e);
        return null;
      }
    })) || [];
  },

  // Settlements created from accepted proposals. The influencer view of the
  // 협업 현황 page reads these so completed settlements also surface in 협업 내역.
  // 브랜드 쪽(role='business')은 같은 정산을 지급하는 입장에서 읽는다 — 캠페인
  // 상세의 정산 탭이 이 값을 캠페인별로 걸러 보여 준다.
  async getSettlements(username: string, role: 'influencer' | 'business' = 'influencer'): Promise<Settlement[]> {
    const key = normalizeAccount(username);
    return (await readMemory<Settlement[] | null>(`settlements:${key}:${role}`, 30_000, async () => {
      try {
        const res = await fetchWithTimeout(`/api/settlements/${encodeURIComponent(username.toLowerCase())}?role=${role}`, {
          headers: await authHeaders(),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.settlements || [];
      } catch (e) {
        console.error('[API] Failed to get settlements:', e);
        return null;
      }
    })) || [];
  },

  /**
   * 정산 한 건을 완료로 닫는다.
   *
   * 비즈니스 제안으로 성사된 협업은 브랜드가 인플루언서에게 직접 지급하므로, 입금
   * 사실을 아는 사람이 그 두 사람뿐이다. 어느 한쪽이 완료를 누르면 완료이고, 서버가
   * 상대방 목록에도 같은 값을 미러링한다.
   *
   * 담당자가 관리하는 캠페인 정산은 서버가 거절한다(403) — 그 건의 지급은 담당자가
   * 브랜드 입금을 확인한 뒤 처리한다. 오류 문구를 그대로 돌려주므로 화면이 이유를
   * 보여 줄 수 있다.
   */
  async completeSettlement(
    username: string,
    settlementId: string,
    role: 'influencer' | 'business' = 'business',
  ): Promise<{ ok: boolean; settlement?: Settlement; error?: string }> {
    try {
      const res = await fetch(
        `/api/settlements/${encodeURIComponent(username.toLowerCase())}/${encodeURIComponent(settlementId)}?role=${role}`,
        {
          method: 'PATCH',
          headers: await authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ status: 'completed' }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error || '정산 완료 처리에 실패했습니다.' };
      clearMemory(`settlements:${normalizeAccount(username)}:`);
      return { ok: true, settlement: data.settlement };
    } catch (e) {
      console.error('[API] Failed to complete settlement:', e);
      return { ok: false, error: '정산 완료 처리에 실패했습니다.' };
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
      clearMemory(`collabRecords:${normalizeAccount(username)}`);
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
      if (res.ok) clearMemory(`collabRecords:${normalizeAccount(username)}`);
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
      if (res.ok) clearMemory(`collabRecords:${normalizeAccount(username)}`);
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to delete collab record:', e);
      return false;
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
    const key = normalizeAccount(username);
    return readMemory(`sellerVerification:${key}`, 60_000, async () => {
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
    });
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
      clearMemory(`sellerVerification:${normalizeAccount(username)}`);
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
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
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
    promoCode?: string,
  ): Promise<{
    success: boolean;
    error?: string;
    data?: SellerVerification;
    promo?: { code: string; freeMonths: number; freeUntil: string; plan: MembershipTier };
  }> {
    try {
      const res = await fetch('/api/billing-issue', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username: username.toLowerCase(), billingKey, tier, promoCode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json?.error || '빌링 결제 실패' };
      }
      if (json.data) writeVerificationCache(username, json.data);
      return { success: true, data: json.data, promo: json.promo };
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
  // promoCode(출시 혜택 코드)를 함께 보내면 첫 달 결제 없이 구독이 시작되고, 코드에 적힌
  // 무료 기간이 끝나는 날부터 등록한 카드로 정상 결제가 이어진다.
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
    promoCode?: string,
  ): Promise<{
    success: boolean;
    error?: string;
    data?: SellerVerification;
    promo?: { code: string; freeMonths: number; freeUntil: string; plan: MembershipTier };
  }> {
    try {
      const res = await fetch('/api/billing-issue', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          username: username.toLowerCase(),
          card,
          tier,
          ...(promoCode ? { promoCode } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json?.error || '카드 등록·결제 실패' };
      }
      if (json.data) writeVerificationCache(username, json.data);
      return { success: true, data: json.data, promo: json.promo };
    } catch (e) {
      console.error('[API] Failed to subscribe membership by card:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // 출시 혜택 코드 확인. 카드 정보를 넣기 전에 코드가 무엇을 주는지 먼저 보여주는 용도이며,
  // 여기서 코드가 소진되지는 않는다(등록은 구독 결제 요청에서 함께 처리된다).
  async checkMembershipPromoCode(
    username: string,
    code: string,
  ): Promise<{
    success: boolean;
    error?: string;
    promo?: {
      plan: MembershipTier;
      planLabel: string;
      freeMonths: number;
      freeUntil: string;
      monthlyPriceKrw: number;
    };
  }> {
    try {
      const res = await fetch('/api/membership-promo', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username: username.toLowerCase(), code }),
      });
      const json = await res.json();
      if (!json?.success) {
        return { success: false, error: json?.error || '사용할 수 없는 코드입니다.' };
      }
      return { success: true, promo: json.promo };
    } catch (e) {
      console.error('[API] Failed to check membership promo code:', e);
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
    const key = normalizeAccount(username);
    return readMemory(`claudeCredits:${key}:${options.refresh ? 'refresh' : 'normal'}`, 60_000, async () => {
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
    }, options.refresh);
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
        operatorGrants: [],
        operatorGrantsError: '회원 목록을 불러오지 못했습니다.',
      };
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
    opts: { token?: string; mine?: boolean; status?: string; refresh?: boolean } = {},
  ): Promise<{ collabs: any[]; role?: string; error?: string }> {
    const account = JSON.stringify(await collabHeaders(opts.token));
    const key = `collabs:${account}:${role}:${opts.mine ? 'mine' : 'all'}:${opts.status || 'any'}`;
    const loader = async () => {
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
    };
    if (opts.token || role === 'manager') return loader();
    return readMemory(key, 25_000, loader, opts.refresh);
  },

  /**
   * 진행사항의 안 읽은 수만 묻는다(메뉴 · 캠페인 카드의 빨간 표시).
   *
   * 협업 목록을 통째로 받아 세지 않는 이유는 하나다 — 이 값은 대시보드가 2분에
   * 한 번씩 부르는데, 목록 응답에는 단계 · 제출물 · 배송 · 캠페인 표지가 다 들어
   * 있어서 표시 하나를 위해 화면이 쓰지도 않는 값을 계속 받아야 한다. 협업
   * 타임라인의 안 읽은 수와 같은 방식이다(합계만 돌려주는 조회).
   *
   * 캐시하지 않는다. 안 읽은 수는 "지금 상대가 움직였는가"라서, 25초 전 값을
   * 되돌려 주면 표시가 늦게 뜨고 늦게 사라진다.
   */
  async getCollabUnread(
    role: 'brand' | 'influencer' | 'manager',
    opts: { signal?: AbortSignal } = {},
  ): Promise<{ unreadTotal: number; byCampaign: Record<string, number>; byCollab: Record<string, number> }> {
    const empty = { unreadTotal: 0, byCampaign: {}, byCollab: {} };
    try {
      const res = await authedGet(
        `/api/collab-workflow?role=${role}&unread=1`,
        () => collabHeaders(),
        { signal: opts.signal },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return empty;
      return {
        unreadTotal: Number(json?.unreadTotal || 0),
        byCampaign: json?.byCampaign || {},
        byCollab: json?.byCollab || {},
      };
    } catch {
      return empty;
    }
  },

  /**
   * 진행사항을 열었다고 알린다 → 그 협업의 빨간 표시가 사라진다.
   *
   * 실패해도 화면은 그대로 진행한다. 표시가 한 번 더 남는 것은 다음 조회에서
   * 정리되지만, 여기서 막히면 진행사항 자체가 열리지 않는다.
   */
  async markCollabEventsSeen(collabId: string, role: CollabViewerRole): Promise<void> {
    if (!collabId) return;
    try {
      await this.collabAction(collabId, 'mark_events_seen', {}, undefined, role);
    } catch {}
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
      clearMemory('collabs:');
      clearMemory('settlements:');
      clearMemory('collabRecords:');
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
  async getCampaignApplicants(
    campaignId: string,
    token?: string,
    // 담당자 화면인지. 운영 콘솔 토큰을 가진 사람이 자기 브랜드 캠페인을 열면
    // 기본은 브랜드 화면이므로(서버 주석 참고), 담당자 화면은 그 뜻을 밝혀야 한다.
    // 이 값이 있어야 응답에 연락처(contact_card)가 실린다.
    viewer?: 'manager',
  ): Promise<any> {
    const headers = await collabHeaders(token);
    return readMemory(`campaignApplicants:${JSON.stringify(headers)}:${campaignId}:${viewer || ''}`, token ? 0 : 10_000, async () => {
    try {
      const res = await fetch(
        `/api/campaign-applicants?campaign_id=${encodeURIComponent(campaignId)}${viewer ? `&viewer=${viewer}` : ''}`,
        { credentials: 'same-origin', headers },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { applicants: [], error: json?.error || '지원자를 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get campaign applicants:', e);
      return { applicants: [], error: '네트워크 오류' };
    }
    });
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
      clearMemory('campaignApplicants:');
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
      clearMemory('campaignApplicants:');
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
      clearMemory('campaignApplicants:');
      clearMemory('campaignListup:');
      clearMemory('collabs:');
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
  async getTimelineThread(
    proposalId: string,
    token?: string,
    options: { signal?: AbortSignal; etag?: string } = {},
  ): Promise<any> {
    try {
      const headers = new Headers(await collabHeaders(token));
      if (options.etag) headers.set('If-None-Match', options.etag);
      const res = await fetch(`/api/timeline/detail/${encodeURIComponent(proposalId)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: options.signal,
        headers,
      });
      if (res.status === 304) return { notModified: true };
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '대화를 불러오지 못했습니다.' };
      return { ...json, etag: res.headers.get('etag') || '' };
    } catch (e) {
      if (options.signal?.aborted) return { aborted: true };
      console.error('[API] Failed to get timeline thread:', e);
      return { error: '네트워크 오류' };
    }
  },

  async markTimelineRead(proposalId: string, token?: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/timeline/read/${encodeURIComponent(proposalId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: '{}',
      });
      return res.ok;
    } catch {
      return false;
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
    const headers = await collabHeaders(opts.token);
    const key = `campaignListup:${JSON.stringify(headers)}:${campaignId}:${opts.pool ? 'pool' : 'list'}:${opts.q || ''}`;
    return readMemory(key, opts.token || opts.pool ? 0 : 10_000, async () => {
    try {
      const params = new URLSearchParams({ campaign_id: campaignId });
      if (opts.pool) params.set('pool', '1');
      if (opts.q) params.set('q', opts.q);
      const res = await fetch(`/api/campaign-listup?${params.toString()}`, {
        credentials: 'same-origin',
        headers,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { candidates: [], error: json?.error || '리스트업을 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get campaign listup:', e);
      return { candidates: [], error: '네트워크 오류' };
    }
    });
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
      clearMemory('campaignListup:');
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
      clearMemory('campaignListup:');
      clearMemory('campaignApplicants:');
      clearMemory('collabs:');
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
      clearMemory('campaignListup:');
      clearMemory('collabs:');
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
      const headers = await collabHeaders(opts.token);
      return await readMemory(`managerCampaigns:${JSON.stringify(headers)}:${!!opts.mine}`, 0, async () => {
        const res = await fetch(`/api/manager-campaigns${opts.mine ? '?mine=1' : ''}`, {
          credentials: 'same-origin',
          headers,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { campaigns: [], brandPicks: [], error: json?.error || '캠페인을 불러오지 못했습니다.' };
        return json;
      });
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
      const headers = await collabHeaders(opts.token);
      return await readMemory(`campaignMetrics:${JSON.stringify(headers)}:${campaignId}`, 0, async () => {
        const res = await authedGet(
          `/api/campaign-metrics?campaignId=${encodeURIComponent(campaignId)}`,
          () => collabHeaders(opts.token),
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { error: json?.error || '캠페인 성과를 불러오지 못했습니다.' };
        return json;
      });
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
   * 브랜드 일괄 정산금 수납.
   *
   * 브랜드는 인플루언서 한 명 한 명에게 송금하지 않고 픽스폴리오에 한 번 보낸다.
   * 그 입금이 확인되기 전에 인플루언서 지급을 닫으면 픽스폴리오 돈이 먼저 나가므로,
   * 담당자 정산 화면의 사람별 '정산완료' 버튼이 이 기록으로 잠긴다.
   *
   * 그 캠페인의 브랜드 계정도 읽을 수 있다. 담당자에게는 청구 근거(billing)와 캠페인
   * 정보가 함께 오고, 브랜드에게는 보낼 금액·수납 여부와 그 근거 인원(basis)만 온다 —
   * 사람별 지급 진행은 브랜드 응답에 담기지 않는다.
   */
  async getCampaignBrandSettlement(
    campaignId: string,
    opts: { token?: string } = {},
  ): Promise<{ settlement?: any; billing?: any; basis?: any; campaign?: any; error?: string }> {
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
    opts: { mine?: boolean; token?: string; signal?: AbortSignal } = {},
  ): Promise<{ timelines?: any[]; error?: string }> {
    try {
      const params = new URLSearchParams({ type });
      if (opts.mine) params.set('mine', '1');
      const res = await fetch(
        `/api/timeline/list/${encodeURIComponent(username)}?${params.toString()}`,
        { credentials: 'same-origin', cache: 'no-store', signal: opts.signal, headers: await collabHeaders(opts.token) },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { timelines: [], error: json?.error || '대화 목록을 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      if (opts.signal?.aborted) return {};
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
   * 브랜드 매칭받기 기능의 인스타그램 연동 해제.
   *
   * 연동 자체는 자동 디엠·인사이트와 하나를 함께 쓰지만, 끊기는 것은 이 기능
   * 하나다(disconnectInstagram 은 자동 디엠 하나를 끊는다). 한쪽을 끊는다고 다른
   * 쪽이 끊기면, 사람은 건드린 적 없는 기능이 멈춘 것을 나중에 안다.
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
    const key = normalizeAccount(username);
    return readMemory(`creatorInsights:${key}`, 60_000, async () => {
      try {
        const params = new URLSearchParams({ username: username.toLowerCase() });
        if (opts.refresh) params.set('refresh', '1');
        const res = await fetch(`/api/creator-insights?${params.toString()}`, {
          credentials: 'same-origin',
          headers: await authHeaders({}, { account: username }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          // 자격(entitled)은 실패 응답에서도 살려 둔다. 삼키면 화면이 플랜 안내
          // 대신 "불러오지 못했습니다"를 띄우고, 사람은 새로고침만 반복한다.
          return {
            reels: [],
            error: json?.error || '인사이트를 불러오지 못했습니다.',
            code: json?.code,
            entitled: json?.entitled,
            requiredTier: json?.requiredTier,
          };
        }
        return json as CreatorInsightsResponse;
      } catch (e) {
        console.error('[API] Failed to get creator insights:', e);
        return { reels: [], error: '네트워크 오류로 인사이트를 불러오지 못했습니다.' };
      }
    }, opts.refresh);
  },

  /** 팔로워 증감 추이(일별 스냅샷). 배치를 켠 날부터만 값이 있다. */
  async getCreatorFollowerSeries(
    username: string,
    days: 7 | 30 | 90,
  ): Promise<FollowerSeriesResponse> {
    const key = normalizeAccount(username);
    return readMemory(`creatorFollowers:${key}:${days}`, 60_000, async () => {
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
    });
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
    const key = normalizeAccount(username);
    return readMemory(`creatorDemographics:${key}`, 120_000, async () => {
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
    }, opts.refresh);
  },

  /**
   * 같은 팔로워 규모 인플루언서들의 평균과 내 값.
   *
   * 메타를 부르지 않는 조회다(우리 DB 의 채널 표만 읽는다). 표본이 최소선 미만이면
   * `collecting: true` 로 오고, 그때 화면은 평균을 그리지 않는다.
   */
  async getCreatorBenchmark(username: string): Promise<BenchmarkResponse> {
    const key = normalizeAccount(username);
    return readMemory(`creatorBenchmark:${key}`, 120_000, async () => {
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
    });
  },

  // ─── 태그된 콘텐츠 (브랜드 계정 화면) ─────────────────────────────────────
  //
  // 새 연동을 만들지 않는다. 디엠 자동화에서 붙여 둔 브랜드 계정의 토큰으로 조회만
  // 한다. 사용자명은 접두사 없는 평문을 그대로 보낸다 — 서버 블롭 키가 그 이름으로
  // 잡혀 있어 `biz/` 를 붙이면 오히려 어긋난다. 서버가 몇 시간 단위로 굳혀 두므로
  // 새로고침해도 매번 다시 부르지 않는다.
  //
  // 자동 디엠 연동을 해제했거나 프로 플랜이 없어도 이 조회는 열려 있다.

  /** 우리 브랜드를 태그·언급한 릴스·게시물 목록. */
  async getBusinessTaggedMedia(
    username: string,
    opts: { refresh?: boolean } = {},
  ): Promise<TaggedMediaResponse> {
    const key = normalizeAccount(username);
    return readMemory(`businessTagged:${key}`, 60_000, async () => {
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
    }, opts.refresh);
  },

  // ---- Instagram DM 자동화 ----
  //
  // 이 화면은 설정을 받아오기 전까지 스피너만 보여준다. 그래서 실패를 "빈 설정"으로
  // 삼키면 안 된다 — 특히 자격(entitled)을 false 로 내려 버리면, 프로 플랜을 결제한
  // 사용자가 네트워크가 한 번 흔들린 것만으로 "프로 전용 기능입니다" 안내를 보게 된다.
  // 실패는 loadError 로 분명히 알리고, 자격 여부는 모른다는 뜻으로 그대로 둔다.
  async getDmAutomation(username: string): Promise<DmAutomationSettings> {
    const key = normalizeAccount(username);
    const fallback = (): DmAutomationSettings => ({
      enabled: false, connected: false, igUserId: '', igAccountId: '', igUsername: '',
      hasAccessToken: false, automations: [], requiredTier: 'pro', loadError: true,
    });
    try {
      return await readMemory(`dmAutomation:${key}`, 30_000, async () => {
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
      });
    } catch (e) {
      console.error('[API] Failed to get DM automation:', e);
      clearMemory(`dmAutomation:${key}`);
      return fallback();
    }
  },

  /**
   * 연동된 인스타그램 계정의 피드 게시물 목록.
   *
   * 예전에는 배열만 돌려줬고, 무슨 일이 생기든 빈 배열로 끝났다. 그래서 로그인
   * 세션이 잠깐 준비되지 않아 401 을 받은 것도, 인스타그램 쪽이 잠시 막힌 것도,
   * 연동이 만료된 것도 화면에는 전부 "게시물이 없어요"로 보였다 — 게시물이 있는
   * 사람에게 게시물이 없다고 말하면서, 다시 시도할 방법도 주지 않았다.
   *
   * 지금은 결과와 실패 사유를 함께 돌려주고, 화면이 그에 맞는 안내와 "다시 시도"를
   * 보여준다. 이어보기 커서(`nextCursor`)가 함께 오면 나머지 게시물은 화면이
   * 배경에서 마저 받는다 — 첫 화면을 몇 초 늦추는 것보다 먼저 보여주는 편이 낫다.
   *
   * 401 은 한 번 세션을 되살려 다시 시도한다. 인스타그램 연동을 마치고 돌아오면
   * 페이지가 통째로 새로 뜨는데, 그 직후에는 세션 복원이 아직 끝나지 않아 첫
   * 요청이 401 을 받는 일이 잦다(회선이 느린 모바일에서 특히). 설정 조회
   * (`getDmAutomation`)는 이미 같은 이유로 재시도를 하고 있었고, 이 호출만 빠져
   * 있어서 "연동은 됐는데 게시물만 안 나오는" 화면이 만들어졌다.
   */
  async getInstagramMedia(
    username: string,
    opts: { after?: string; refresh?: boolean } = {},
  ): Promise<InstagramMediaResult> {
    const key = normalizeAccount(username);
    const after = opts.after || '';
    const load = async (): Promise<InstagramMediaResult> => {
      const account = { account: username };
      const query = new URLSearchParams();
      if (after) query.set('after', after);
      if (opts.refresh) query.set('refresh', '1');
      const path =
        `/api/instagram/media/${encodeURIComponent(username.toLowerCase())}` +
        (query.toString() ? `?${query}` : '');

      let lastError: unknown = new Error('Instagram media request failed');
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const res = await fetchWithTimeout(
            path,
            { cache: 'no-store', headers: await authHeadersWithTimeout({}, account) },
            20_000,
          );
          if (res.ok) {
            const data = await res.json();
            return {
              media: Array.isArray(data?.media) ? (data.media as InstagramMedia[]) : [],
              connected: data?.connected !== false,
              nextCursor: String(data?.nextCursor || ''),
              error: String(data?.error || ''),
              needsReauth: Boolean(data?.needsReauth),
              stale: Boolean(data?.stale),
            };
          }

          lastError = new Error(`HTTP ${res.status}`);
          const transient = res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500;
          const refreshableAuth = res.status === 401 && !isBusinessRequest(account);
          if (attempt > 0 || (!transient && !refreshableAuth)) throw lastError;
          if (refreshableAuth) await refreshSupabaseSession();
        } catch (error) {
          lastError = error;
          if (attempt > 0) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw lastError;
    };

    try {
      // 이어보기는 커서마다 다른 응답이라 기억해 둘 이유가 없다. 첫 페이지만
      // 잠깐 기억해 화면 두 곳이 동시에 물어볼 때의 중복 왕복을 막는다.
      if (after) return await load();
      return await readMemory(`instagramMedia:${key}`, 120_000, load, Boolean(opts.refresh));
    } catch (e) {
      console.error('[API] Failed to get Instagram media:', e);
      clearMemory(`instagramMedia:${key}`);
      return {
        media: [],
        connected: true,
        nextCursor: '',
        error: '게시물을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        needsReauth: false,
        stale: false,
      };
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
  ): Promise<{
    ok: boolean; error?: string; automations?: DmAutomationItem[]; enabled?: boolean;
    faq?: DmFaqSettings; direct?: DmDirectSettings; backfillWarning?: string;
  }> {
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
        clearMemory(`dmAutomation:${normalizeAccount(username)}`);
        return {
          ok: true,
          automations: Array.isArray(data?.automations) ? data.automations : undefined,
          // 서버가 확정한 전체 스위치 상태. 화면이 이 값을 따라가야 "켜져 있다고
          // 보이는데 발송은 안 되는" 상태가 생기지 않는다.
          enabled: typeof data?.enabled === 'boolean' ? data.enabled : undefined,
          // 전체 스위치를 끄면 서버가 인스타그램에 올려둔 질문 버튼도 함께 내린다
          // (버튼은 남아 있는데 답변이 안 나가면 받는 사람만 헛걸음한다). 등록 시각·
          // 실패 이유가 그 응답에 실려 오므로 화면이 그대로 따라가야 한다.
          faq: data?.faq && typeof data.faq === 'object' ? data.faq : undefined,
          direct: data?.direct && typeof data.direct === 'object' ? data.direct : undefined,
          backfillWarning: typeof data?.backfillWarning === 'string' ? data.backfillWarning : undefined,
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

  async backfillDmComments(username: string, ruleId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetchWithTimeout(`/api/dm-comment-backfill/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeadersWithTimeout(
          { 'Content-Type': 'application/json' },
          { account: username },
        ),
        body: JSON.stringify({ ruleId }),
      });
      return res.ok
        ? { ok: true }
        : { ok: false, error: '이전 댓글 확인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    } catch {
      return { ok: false, error: '네트워크 오류로 이전 댓글 확인을 시작하지 못했습니다.' };
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
      clearMemory(`dmAutomation:${normalizeAccount(username)}`);
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

  /**
   * "자주 묻는 질문"(아이스브레이커) 저장.
   *
   * 이 설정은 우리 서버가 아니라 **인스타그램 프로필**에 등록돼야 DM 창에 보인다.
   * 서버가 저장과 등록을 함께 처리하고 그 결과(`faq.syncedAt` / `faq.syncError`)를
   * 돌려주므로, 화면은 그 값으로 "실제로 보이는 상태"를 표시한다.
   */
  async saveDmFaq(
    username: string,
    faq: DmFaqSettings,
  ): Promise<{ ok: boolean; error?: string; warning?: string; faq?: DmFaqSettings }> {
    try {
      const res = await fetchWithTimeout(`/api/dm-automation/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeadersWithTimeout(
          { 'Content-Type': 'application/json' },
          { account: username },
        ),
        body: JSON.stringify({ action: 'saveFaq', faq }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        return { ok: false, error: data?.error || `저장에 실패했습니다. (HTTP ${res.status})` };
      }
      clearMemory(`dmAutomation:${normalizeAccount(username)}`);
      // 저장은 됐지만 인스타그램 등록이 실패한 경우도 있다(success: false). 그때도
      // 입력한 내용은 보관되므로 faq 를 함께 돌려준다.
      return {
        ok: data?.success === true,
        error: data?.error,
        warning: data?.warning,
        faq: data?.faq,
      };
    } catch (e) {
      console.error('[API] Failed to save DM FAQ:', e);
      return { ok: false, error: '네트워크 오류로 저장에 실패했습니다.' };
    }
  },

  /** DM 트리거 자동화(첫 인사말 · 키워드 자동 답장) 저장. */
  async saveDmTriggers(
    username: string,
    direct: DmDirectSettings,
  ): Promise<{ ok: boolean; error?: string; direct?: DmDirectSettings }> {
    try {
      const res = await fetchWithTimeout(`/api/dm-automation/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeadersWithTimeout(
          { 'Content-Type': 'application/json' },
          { account: username },
        ),
        body: JSON.stringify({ action: 'saveDmTriggers', direct }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.success !== true) {
        return { ok: false, error: data?.error || `저장에 실패했습니다. (HTTP ${res.status})` };
      }
      clearMemory(`dmAutomation:${normalizeAccount(username)}`);
      return { ok: true, direct: data?.direct };
    } catch (e) {
      console.error('[API] Failed to save DM triggers:', e);
      return { ok: false, error: '네트워크 오류로 저장에 실패했습니다.' };
    }
  },

  /** 예약 DM 목록과 보낼 수 있는 대상 명단. */
  async getDmSchedule(username: string): Promise<{
    jobs: DmScheduledJob[];
    contacts: DmContact[];
    connected: boolean;
    masterEnabled: boolean;
    loadError?: boolean;
  }> {
    try {
      const res = await fetchWithTimeout(`/api/dm-schedule/${encodeURIComponent(username.toLowerCase())}`, {
        cache: 'no-store',
        headers: await authHeadersWithTimeout({}, { account: username }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return {
        jobs: Array.isArray(data?.jobs) ? data.jobs : [],
        contacts: Array.isArray(data?.contacts) ? data.contacts : [],
        connected: Boolean(data?.connected),
        masterEnabled: Boolean(data?.masterEnabled),
      };
    } catch (e) {
      console.error('[API] Failed to load DM schedule:', e);
      return { jobs: [], contacts: [], connected: false, masterEnabled: false, loadError: true };
    }
  },

  /**
   * 예약 DM 을 만든다.
   *
   * `sendAt` 은 ISO 문자열이다. 서버는 상대가 명단에 있는지(= 먼저 DM 을 보낸 적이
   * 있는지)와 시각의 범위만 확인하고, 24시간 창을 넘긴 예약은 막지 않고 `warning`
   * 으로 알려준다 — 그 사이 상대가 다시 메시지를 보내면 정상 발송되기 때문이다.
   */
  async createDmSchedule(
    username: string,
    job: { recipientId: string; sendAt: string; message: string; buttons?: { label: string; url: string }[] },
  ): Promise<{ ok: boolean; error?: string; warning?: string; jobs?: DmScheduledJob[] }> {
    try {
      const res = await fetchWithTimeout(`/api/dm-schedule/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeadersWithTimeout(
          { 'Content-Type': 'application/json' },
          { account: username },
        ),
        body: JSON.stringify({ action: 'create', ...job }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.success !== true) {
        return { ok: false, error: data?.error || `예약에 실패했습니다. (HTTP ${res.status})` };
      }
      return { ok: true, warning: data?.warning, jobs: data?.jobs };
    } catch (e) {
      console.error('[API] Failed to create DM schedule:', e);
      return { ok: false, error: '네트워크 오류로 예약에 실패했습니다.' };
    }
  },

  /** 아직 나가지 않은 예약을 취소한다. */
  async cancelDmSchedule(
    username: string,
    id: string,
  ): Promise<{ ok: boolean; error?: string; jobs?: DmScheduledJob[] }> {
    try {
      const res = await fetchWithTimeout(`/api/dm-schedule/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeadersWithTimeout(
          { 'Content-Type': 'application/json' },
          { account: username },
        ),
        body: JSON.stringify({ action: 'cancel', id }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.success !== true) {
        return { ok: false, error: data?.error || `취소에 실패했습니다. (HTTP ${res.status})`, jobs: data?.jobs };
      }
      return { ok: true, jobs: data?.jobs };
    } catch (e) {
      console.error('[API] Failed to cancel DM schedule:', e);
      return { ok: false, error: '네트워크 오류로 취소에 실패했습니다.' };
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
      if (res.ok) clearMemory(`dmAutomation:${normalizeAccount(username)}`);
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
  // 자동 디엠 · 인사이트 · 브랜드 매칭받기는 연동 하나를 함께 쓴다. 어느 화면에서
  // 시작해도 같은 보관함에 저장되므로 purpose 는 넘기지 않는다 — 'collab' 은 옛
  // 캠페인 전용 보관함으로 보내는 값이라, 넘기면 그 화면만의 연동이 다시 생긴다.
  //
  // forceReauth 는 인스타그램 로그인 화면을 매번 새로 띄운다. 브랜드 매칭 등록처럼
  // "지금 이 계정으로 등록한다"를 그 자리에서 확인해야 하는 화면이 쓴다.
  //
  // feature 는 연동을 시작한 화면의 기능이다. 해제는 누른 화면의 기능만 끄기 때문에,
  // 다시 연동할 때 되살릴 기능도 그 하나여야 한다 — 넘기지 않으면(인사이트) 꺼 둔
  // 기능은 그대로 꺼진 채 연동만 되살아난다.
  async instagramConnectUrl(
    username: string,
    returnTo?: string,
    opts?: { forceReauth?: boolean },
  ): Promise<{ url?: string; error?: string }> {
    try {
      const res = await fetch('/api/instagram/oauth/start', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: username }),
        body: JSON.stringify({
          username: username.toLowerCase(),
          returnTo,
          forceReauth: opts?.forceReauth === true,
        }),
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

  /**
   * 메타 광고 계정 연동 시작 — 서명된 authorize URL 을 받는다.
   *
   * 광고 현황의 'Meta 계정 연동하기' 가 쓰는 경로다. 인스타그램 연동과 같은 이유로
   * 인증된 POST 로만 URL 을 받는다(서명 없는 state 는 계정 연동 CSRF 가 된다).
   * 돌려받은 URL 은 facebook.com 의 로그인 대화상자이고, 화면은 그 주소로 이동한다.
   *
   * returnTo 는 동의를 마친 뒤 돌아올 내부 경로다. 광고 현황은 URL 이 아니라 화면
   * 상태로 열리는 하위 화면이라, 이 값이 없으면 대시보드 첫 화면에 떨어진다.
   */
  async metaAdsConnectUrl(
    username: string,
    returnTo?: string,
  ): Promise<{ url?: string; scopes?: string[]; error?: string }> {
    try {
      const res = await fetch('/api/meta-ads/oauth/start', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: username }),
        body: JSON.stringify({ username: normalizeAccount(username), returnTo }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data?.url) {
        return { error: data?.error || `연동을 시작하지 못했습니다. (HTTP ${res.status})` };
      }
      return { url: data.url as string, scopes: Array.isArray(data.scopes) ? data.scopes : [] };
    } catch (e) {
      console.error('[API] Failed to start Meta ads OAuth:', e);
      return { error: '네트워크 오류로 연동을 시작하지 못했습니다.' };
    }
  },

  /**
   * 메타 광고 계정 연동 상태(진단 결과) 조회.
   *
   * 화면이 "연동됨"을 스스로 적지 않고 여기서 읽는다 — 연동 여부와 광고 계정 목록,
   * 권한 승인 상태는 모두 콜백이 메타에 실제로 물어본 결과다. 토큰은 저장하지
   * 않으므로 이 응답에도 없다.
   */
  async metaAdsConnection(username: string): Promise<{
    connection: MetaAdsDiagnosisPayload | null;
    scopes: string[];
    appConfigured: boolean;
    error?: string;
  }> {
    try {
      const res = await fetchWithTimeout(
        `/api/meta-ads/connection/${encodeURIComponent(normalizeAccount(username))}`,
        { headers: await authHeaders({}, { account: username }) },
      );
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        return {
          connection: null,
          scopes: [],
          appConfigured: true,
          error: data?.error || `연동 상태를 읽지 못했습니다. (HTTP ${res.status})`,
        };
      }
      return {
        connection: (data?.connection as MetaAdsDiagnosisPayload) || null,
        scopes: Array.isArray(data?.scopes) ? data.scopes : [],
        appConfigured: data?.appConfigured !== false,
      };
    } catch (e) {
      console.error('[API] Failed to read Meta ads connection:', e);
      return {
        connection: null,
        scopes: [],
        appConfigured: true,
        error: '네트워크 오류로 연동 상태를 읽지 못했습니다.',
      };
    }
  },

  /**
   * 메타 광고 계정 연동 해제 — 남겨 둔 진단 결과를 지운다.
   *
   * 저장한 토큰이 없으므로 지울 것은 진단 결과뿐이다. 메타 쪽에 남은 앱 권한까지
   * 회수하려면 페이스북 계정 설정에서 앱을 삭제해야 한다(화면에 그렇게 적어 둔다).
   */
  async metaAdsDisconnect(username: string): Promise<boolean> {
    try {
      const res = await fetch(
        `/api/meta-ads/connection/${encodeURIComponent(normalizeAccount(username))}`,
        {
          method: 'POST',
          headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: username }),
          body: JSON.stringify({ action: 'disconnect' }),
        },
      );
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to disconnect Meta ads:', e);
      return false;
    }
  },

  // 자동 디엠 화면의 인스타그램 연동 해제.
  //
  // 끊기는 것은 자동 디엠과 인사이트다. 둘 다 내 인스타그램을 읽는 기능이고,
  // 인사이트에는 해제 버튼이 따로 없다. 브랜드 매칭받기는 그대로 남는다
  // (그쪽은 disconnectCreatorChannel 로 끊는다).
  async disconnectInstagram(username: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/dm-automation/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: username }),
        body: JSON.stringify({ action: 'disconnect' }),
      });
      if (res.ok) {
        clearMemory(`dmAutomation:${normalizeAccount(username)}`);
        clearMemory(`instagramMedia:${normalizeAccount(username)}`);
        clearMemory(`businessTagged:${normalizeAccount(username)}`);
      }
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
    replyAlreadyCount?: number;
    remaining?: number;
    total?: number;
    message?: string;
    /** 요청이 거절된 이유(플랜 미충족 등). `message` 가 없을 때 화면에 쓴다. */
    error?: string;
    indeterminate?: boolean;
    incomplete?: boolean;
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
