import { Block, DesignSettings, BusinessProposal, CollabRecord, ProductFolder, OpenScheduleItem, SellerVerification, Settlement } from '../types';
import type { BillingPlan, MembershipTier } from '../utils/membershipTiers';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

const BIZ_SESSION_KEY = 'picks_business_session';
const BIZ_TOKEN_KEY = 'picks_business_access_token';
const BIZ_REFRESH_KEY = 'picks_business_refresh_token';

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

export interface AuthHeaderOptions {
  /**
   * 이 요청이 다루는 계정. 비즈니스 계정이면 그 계정 토큰으로 보낸다.
   * 생략하면 지금 켜져 있는 비즈니스 대시보드의 계정으로 판단한다.
   */
  account?: string;
}

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
  let token = '';

  const target = normalizeAccount(opts.account) || activeBusinessAccount;
  const businessName = normalizeAccount(readLocal(BIZ_SESSION_KEY));
  const useBusinessToken = !!target && !!businessName && target === businessName;

  if (useBusinessToken) {
    token = await businessAccessToken();
  }

  if (!token) {
    try {
      const { data } = (await supabase?.auth.getSession()) || { data: null };
      token = data?.session?.access_token || '';
    } catch {
      // 세션 조회 실패 시 아래 비즈니스 토큰으로 폴백한다.
    }
  }
  if (!token) {
    token = readLocal(BIZ_TOKEN_KEY);
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    lastKnownToken = token;
  }
  return headers;
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
 * 또 `navigator.sendBeacon` 은 헤더를 실을 수 없어서 인증이 필요한 경로에
 * 쓸 수 없다. 그래서 평소 호출에서 얻은 토큰을 캐싱해 두고, 언로드 때는 이 값으로
 * `fetch(..., { keepalive: true })` 를 쏜다.
 */
let lastKnownToken = '';

/** 동기적으로 즉시 쓸 수 있는 인증 헤더(언로드 전용). 없으면 빈 객체. */
export function syncAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  let token = lastKnownToken;
  if (!token) {
    try {
      token = localStorage.getItem('picks_business_access_token') || '';
    } catch {
      token = '';
    }
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
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
  rules?: DmRule[];
  /** 인스타그램 장기 토큰 만료 시각(ISO). 만료되면 재연동이 필요하다. */
  tokenExpiresAt?: string;
  updatedAt?: string;
  // 디엠 자동화는 프로 플랜 전용 — 서버가 계정 자격을 함께 내려준다.
  entitled?: boolean;
  requiredTier?: MembershipTier;
}

// 인포크 링크식 "댓글 → DM" 자동화 항목.
export interface DmMessageButton {
  id: string;
  label: string;
  url: string;
}

// 캐러셀(제네릭 템플릿) 카드 — 이미지 + 제목/설명 + 버튼.
export interface DmCarouselCard {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  buttonLabel: string;
  buttonUrl: string;
}

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
  createdAt: string;
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

  async saveSiteData(username: string, data: Partial<SiteData>): Promise<boolean> {
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
      }
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to save site data:', e);
      return false;
    }
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

  async uploadProposalAttachment(username: string, file: File): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append('image', file, file.name);
      formData.append('username', `proposals-${username.toLowerCase()}`);

      const res = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) return null;
      const { url } = await res.json();
      return url;
    } catch (e) {
      console.error('[API] Failed to upload proposal attachment:', e);
      return null;
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

  // Seller verification (business registration + settlement account + membership)
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
    tier: BillingPlan,
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

  // 카드(신용카드) 정기결제 등록. NICE V2 는 브라우저 SDK 로 카드 빌링키를 발급할 수 없어
  // (간편결제만 지원), 카드 정보를 서버로 보내 수기(키인) 방식으로 빌링키를 발급받고 첫 달을
  // 즉시 결제한다. 이후에는 발급된 빌링키로 매월 자동결제된다. 카드 정보는 저장하지 않고
  // PortOne 으로만 전달된다. (토스페이·카카오페이는 기존 SDK 빌링키 경로를 그대로 사용한다.)
  async subscribeMembershipCard(
    username: string,
    tier: BillingPlan,
    card: {
      number: string;
      expiryMonth: string;
      expiryYear: string;
      birthOrBusinessRegistrationNumber: string;
      passwordTwoDigits: string;
    },
  ): Promise<{ success: boolean; error?: string; data?: SellerVerification }> {
    try {
      const res = await fetch('/api/billing-issue', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username: username.toLowerCase(), tier, card }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json?.error || '카드 정기결제 등록 실패' };
      }
      if (json.data) writeVerificationCache(username, json.data);
      return { success: true, data: json.data };
    } catch (e) {
      console.error('[API] Failed to subscribe membership with card:', e);
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
  async getAdminInfluencers(token: string): Promise<{ influencers: any[]; businesses?: any[] }> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/influencers', { credentials: 'same-origin', headers });
      if (!res.ok) return { influencers: [], businesses: [] };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin influencers:', e);
      return { influencers: [], businesses: [] };
    }
  },

  async updateAdminInfluencer(
    token: string,
    username: string,
    body: { featured?: boolean; featured_note?: string; membership_plan?: 'standard' | 'standard_ai' | 'commerce' | 'pro' | null }
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/influencers/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };
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
      const res = await fetch(`/api/collab-workflow?${params.toString()}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(opts.token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { collabs: [], error: json?.error || '협업 목록을 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get collabs:', e);
      return { collabs: [], error: '네트워크 오류' };
    }
  },

  async getCollabDetail(collabId: string, token?: string): Promise<any> {
    try {
      const res = await fetch(`/api/collab-workflow/${encodeURIComponent(collabId)}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(token),
      });
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
  ): Promise<{ success?: boolean; error?: string; [k: string]: any }> {
    try {
      const res = await fetch(`/api/collab-workflow/${encodeURIComponent(collabId)}`, {
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
      const res = await fetch(`/api/campaign-listup?influencer=${encodeURIComponent(username)}`, {
        credentials: 'same-origin',
        headers: await authHeaders(),
      });
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
   */
  async getMyManagerStatus(): Promise<{
    isManager: boolean;
    isAdmin?: boolean;
    username?: string;
    displayName?: string;
  }> {
    try {
      const res = await fetch('/api/managers?me=1', {
        credentials: 'same-origin',
        headers: await authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { isManager: false };
      return json;
    } catch {
      return { isManager: false };
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
  async getManagerCampaigns(
    opts: { mine?: boolean; token?: string } = {},
  ): Promise<{ campaigns?: any[]; managerUsername?: string; error?: string }> {
    try {
      const res = await fetch(`/api/manager-campaigns${opts.mine ? '?mine=1' : ''}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(opts.token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { campaigns: [], error: json?.error || '캠페인을 불러오지 못했습니다.' };
      return json;
    } catch (e) {
      console.error('[API] Failed to get manager campaigns:', e);
      return { campaigns: [], error: '네트워크 오류' };
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

  // ─── 셀러 사업자등록증 수동 심사 (관리자) ──────────────────────────────────

  async getAdminSellerVerifications(token: string, status?: string): Promise<{ items: any[]; pendingCount: number }> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const qs = status ? `?status=${status}` : '';
      const res = await fetch(`/api/admin/seller-verifications${qs}`, { credentials: 'same-origin', headers });
      if (!res.ok) return { items: [], pendingCount: 0 };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin seller verifications:', e);
      return { items: [], pendingCount: 0 };
    }
  },

  async adminSellerVerificationAction(token: string, username: string, action: 'approve' | 'reject', reason?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/seller-verifications', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ username: username.toLowerCase(), action, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: json?.error };
      return { success: true };
    } catch (e) {
      console.error('[API] Failed to perform admin seller verification action:', e);
      return { success: false, error: '네트워크 오류' };
    }
  },

  // ---- Instagram DM 자동화 ----
  async getDmAutomation(username: string): Promise<DmAutomationSettings> {
    try {
      const res = await fetch(`/api/dm-automation/${encodeURIComponent(username.toLowerCase())}`, {
        cache: 'no-store',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get DM automation:', e);
      return { enabled: false, connected: false, igUserId: '', igAccountId: '', igUsername: '', hasAccessToken: false, automations: [], entitled: false, requiredTier: 'pro' };
    }
  },

  // 연동된 인스타그램 계정의 피드 게시물 목록.
  async getInstagramMedia(username: string): Promise<InstagramMedia[]> {
    try {
      const res = await fetch(`/api/instagram/media/${encodeURIComponent(username.toLowerCase())}`, {
        cache: 'no-store',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.media) ? data.media : [];
    } catch (e) {
      console.error('[API] Failed to get Instagram media:', e);
      return [];
    }
  },

  async saveDmAutomation(
    username: string,
    settings: Partial<DmAutomationSettings>,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/dm-automation/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(settings),
      });
      if (res.ok) return { ok: true };
      // 잘못된 버튼 링크처럼 사용자가 고칠 수 있는 오류는 서버 메시지를 그대로 보여준다.
      const data = await res.json().catch(() => ({} as any));
      return { ok: false, error: data?.error || `저장에 실패했습니다. (HTTP ${res.status})` };
    } catch (e) {
      console.error('[API] Failed to save DM automation:', e);
      return { ok: false, error: '네트워크 오류로 저장에 실패했습니다.' };
    }
  },

  // 인스타그램 계정 연동 시작 — 인증된 요청으로 서명된 state 를 받아 authorize URL 을 얻는다.
  // (예전처럼 GET 링크로 바로 이동하면 서명 없는 state 라 계정 연동 CSRF 가 성립한다.)
  //
  // returnTo 는 연동을 마친 뒤 돌아올 우리 사이트 내부 경로다. 브랜드 매칭 등록처럼
  // 관리자 화면이 아닌 곳에서 연동을 시작하면 이 값을 넘겨 원래 있던 화면으로 복귀한다.
  async instagramConnectUrl(username: string, returnTo?: string): Promise<{ url?: string; error?: string }> {
    try {
      const res = await fetch('/api/instagram/oauth/start', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username: username.toLowerCase(), returnTo }),
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
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'disconnect' }),
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to disconnect Instagram:', e);
      return false;
    }
  },

  async sendInstagramDm(payload: { username: string; recipientId: string; message: string; buttons?: DmMessageButton[]; ruleId?: string; test?: boolean }): Promise<{ success: boolean; connected?: boolean; message?: string }> {
    try {
      const res = await fetch('/api/send-instagram-dm', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...payload, username: payload.username.toLowerCase() }),
      });
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to send Instagram DM:', e);
      return { success: false, message: '네트워크 오류로 발송에 실패했습니다.' };
    }
  },
};
