import { Block, DesignSettings, BusinessProposal, CollabRecord, ProductFolder, OpenScheduleItem, SellerVerification } from '../types';

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        // Keep the cache in sync with what we just persisted so a subsequent
        // navigation doesn't briefly render pre-save data.
        const key = username.toLowerCase();
        const cached = siteDataCache[key];
        if (cached) {
          siteDataCache[key] = { data: { ...cached.data, ...data }, ts: Date.now() };
        }
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

  async saveLiveState(username: string, state: { isLive: boolean; viewerCount: number; currentProduct?: any; activeMaterial?: any; broadcastTitle?: string; startedAt?: string }): Promise<boolean> {
    try {
      const res = await fetch(`/api/live/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`/api/proposals/${encodeURIComponent(username.toLowerCase())}`);
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
        headers: { 'Content-Type': 'application/json' },
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
        method: 'DELETE'
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

  // AWS IVS Stream Key API
  async getStreamKey(username: string): Promise<{ ingestServer: string; streamKey: string; playbackUrl: string; rtmpUrl: string; capReached?: 'monthly' | 'daily' | 'exhausted'; error?: string } | null> {
    try {
      const res = await fetch(`/api/stream-key/${encodeURIComponent(username.toLowerCase())}`);
      if (res.status === 403) {
        // Hard-cap reached — surface the structured payload to the caller
        // so the UI can show "월 50시간 도달" instead of starting the stream.
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products })
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to save live products:', e);
      return false;
    }
  },

  // Collaboration Records API
  async getCollabRecords(username: string): Promise<CollabRecord[]> {
    try {
      const res = await fetch(`/api/collabs/${encodeURIComponent(username.toLowerCase())}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.records || [];
    } catch (e) {
      console.error('[API] Failed to get collab records:', e);
      return [];
    }
  },

  async createCollabRecord(username: string, record: Omit<CollabRecord, 'id' | 'created_at'>): Promise<CollabRecord | null> {
    try {
      const res = await fetch(`/api/collabs/${encodeURIComponent(username.toLowerCase())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        method: 'DELETE'
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
      const res = await fetch(`/api/live-cart/${encodeURIComponent(username.toLowerCase())}`);
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
        headers: { 'Content-Type': 'application/json' },
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
        method: 'DELETE'
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
  async getBroadcastHistory(username: string): Promise<{ id: string; startedAt: string; endedAt: string; durationMinutes: number; products: any[]; cartStats: any; peakViewers: number; totalMessages: number; hasRecording?: boolean; recordingMime?: string | null; recordingDurationSeconds?: number | null }[]> {
    try {
      const res = await fetch(`/api/broadcast-history/${encodeURIComponent(username.toLowerCase())}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.records || [];
    } catch (e) {
      console.error('[API] Failed to get broadcast history:', e);
      return [];
    }
  },

  // Seller-facing broadcast replay metadata. Returns a short-lived signed
  // URL the <video> element can stream without an Authorization header.
  async getBroadcastReplay(username: string, broadcastId: string): Promise<{
    id: string;
    username: string;
    startedAt: string;
    endedAt: string;
    durationMinutes: number;
    hasRecording: boolean;
    recordingMime: string | null;
    recordingSizeBytes: number | null;
    recordingDurationSeconds: number;
    videoUrl: string | null;
  } | null> {
    try {
      const res = await fetch(
        `/api/broadcast-replay/${encodeURIComponent(username.toLowerCase())}/${encodeURIComponent(broadcastId)}`,
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data?.broadcast || null;
    } catch (e) {
      console.error('[API] Failed to get broadcast replay:', e);
      return null;
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
        headers: { 'Content-Type': 'application/json' },
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
        method: 'DELETE'
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
      const res = await fetch(`/api/live-usage/${encodeURIComponent(username.toLowerCase())}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get live usage:', e);
      return null;
    }
  },

  // Prepaid live-time top-up ("시간 충전하기"). After the seller completes a
  // one-time PortOne payment (토스페이먼츠/토스페이/카카오페이) for `hours` of
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
        headers: { 'Content-Type': 'application/json' },
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
      const res = await fetch(`/api/seller-verification/${encodeURIComponent(username.toLowerCase())}`);
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
        headers: { 'Content-Type': 'application/json' },
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
  ): Promise<{ success: boolean; error?: string; data?: SellerVerification }> {
    try {
      const res = await fetch('/api/portone-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.toLowerCase(), paymentId }),
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
    tier: 'standard' | 'standard_ai' | 'commerce',
  ): Promise<{ success: boolean; error?: string; data?: SellerVerification }> {
    try {
      const res = await fetch('/api/billing-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  async getShippingProfile(viewerId: string): Promise<ShippingProfile | null> {
    try {
      const res = await fetch(`/api/live-shipping-profile?viewerId=${encodeURIComponent(viewerId)}`);
      if (!res.ok) return null;
      const json = await res.json();
      return (json?.profile as ShippingProfile) || null;
    } catch (e) {
      console.error('[API] Failed to load shipping profile:', e);
      return null;
    }
  },

  // Persist the viewer's orderer/shipping details for reuse on their next order.
  async saveShippingProfile(viewerId: string, profile: ShippingProfile): Promise<boolean> {
    try {
      const res = await fetch('/api/live-shipping-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewerId, profile }),
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
      const res = await fetch(`/api/site-restore/${encodeURIComponent(username.toLowerCase())}`);
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_id: snapshotId })
      });
      return res.ok;
    } catch (e) {
      console.error('[API] Failed to restore site data snapshot:', e);
      return false;
    }
  },

  // ───────────────────── Admin: Influencer management ─────────────────────
  async getAdminInfluencers(token: string): Promise<{ influencers: any[]; businesses?: any[]; liveCustomers?: any[] }> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/influencers', { credentials: 'same-origin', headers });
      if (!res.ok) return { influencers: [], businesses: [], liveCustomers: [] };
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin influencers:', e);
      return { influencers: [], businesses: [], liveCustomers: [] };
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
    body: { featured?: boolean; featured_note?: string; membership_plan?: 'standard' | 'standard_ai' | 'commerce' | null }
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

  // Admin: full broadcast replay metadata + payment-density timeline.
  // The video is streamed from a short-lived signed URL returned in the
  // response (`broadcast.videoUrl`) so the <video> element can play it
  // without sending an Authorization header.
  async getAdminBroadcastReplay(token: string, broadcastId: string): Promise<{
    broadcast: {
      id: string;
      username: string;
      startedAt: string;
      endedAt: string;
      durationMinutes: number;
      peakViewers: number;
      totalMessages: number;
      revenue: number;
      products: any[];
      cartStats: any;
      hasRecording: boolean;
      recordingMime: string | null;
      recordingSizeBytes: number | null;
      recordingDurationSeconds: number;
      videoUrl: string | null;
    };
    timeline: {
      bucketSeconds: number;
      totalSeconds: number;
      buckets: Array<{ bucketIndex: number; startOffsetSeconds: number; endOffsetSeconds: number; count: number; amount: number }>;
      peakBucketIndex: number;
      peakBucket: { bucketIndex: number; startOffsetSeconds: number; endOffsetSeconds: number; count: number; amount: number } | null;
      orderCount: number;
      totalAmount: number;
    };
  } | null> {
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/broadcast-replay/${encodeURIComponent(broadcastId)}`, {
        credentials: 'same-origin',
        headers,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('[API] Failed to get admin broadcast replay:', e);
      return null;
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

  async adminCampaignAction(token: string, id: string, action: 'approve' | 'reject', reason?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/campaigns', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ id, action, reason }),
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
};
