import { authHeaders } from './apiService';
import { startKakaoLogin } from '../utils/kakaoLogin';

/**
 * 어필리에이트 스토어 구매자 API(/api/affiliate-buyer, /api/affiliate-shop).
 *
 * 구매자는 카카오 로그인한 계정(Supabase 세션)으로 구분한다. 인플루언서 계정도 같은 세션이다.
 * 브랜드 계정은 비즈니스 로그인 토큰만 남아 있을 수 있어, Supabase 세션이 없으면 그 토큰으로 보낸다.
 * 로그인은 기존 카카오 로그인(startKakaoLogin)을 그대로 호출만 한다.
 */

export async function buyerHeaders(json = true): Promise<Record<string, string>> {
  const base: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  const h = await authHeaders(base);
  if (h.Authorization) return h;
  let biz = '';
  try { biz = (localStorage.getItem('picks_business_session') || '').trim(); } catch { /* 저장소 없음 */ }
  if (biz) {
    const b = await authHeaders(base, { account: biz.startsWith('biz/') ? biz : `biz/${biz}` });
    if (b.Authorization) return b;
  }
  return h;
}

export async function isSignedIn(): Promise<boolean> {
  return !!(await buyerHeaders()).Authorization;
}

/**
 * 구매 경로 로그인의 복귀 주소(returnTo). 우리 사이트 안의 구매 경로만 허용한다(오픈 리다이렉트 방지):
 *   /shop/<코드>  ·  /my  ·  /my/orders  ·  /my/orders/<주문ID>  ·  /my/inquiries
 * 그 밖의 값(외부 주소, //evil.com, /\evil.com, javascript: …)은 버리고 /my/orders 로 돌아온다.
 *
 * 로그인 뒤 어디로 갈지는 이 복귀 주소로 정해진다. 구매 경로에서 시작한 로그인은 구매 화면으로
 * 돌아오므로 아이디가 없어도 setup-link 로 가지 않는다. 메인 · 로그인 · 가입 버튼에서 시작한
 * 로그인은 이 함수를 거치지 않고 지금과 똑같이 동작한다(아이디가 없으면 setup-link).
 */
export function safeBuyerReturnTo(raw: string | null | undefined, fallback = '/my/orders'): string {
  const v = String(raw || '').trim();
  if (!v || v.length > 300) return fallback;
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\u0000-\u001f]/.test(v)) return fallback;
  const path = v.split(/[?#]/)[0];
  const ok = /^\/shop\/[A-Za-z0-9]{6,32}\/?$/.test(path)
    || /^\/my(\/(orders(\/[A-Za-z0-9_\-%.]{1,120})?|inquiries)?)?\/?$/.test(path);
  return ok ? path : fallback;
}

/** 구매 경로에서 카카오 로그인을 시작한다. 로그인 처리는 기존 카카오 로그인을 그대로 부른다. */
export function loginWithKakao(returnTo: string) {
  return startKakaoLogin(safeBuyerReturnTo(returnTo));
}

type Result<T> = T & { error?: string; status?: number };

async function call<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: await buyerHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ...(json || {}), status: res.status, error: json?.error || '요청을 처리하지 못했습니다.' } as Result<T>;
    return json as Result<T>;
  } catch {
    return { error: '네트워크 오류가 발생했습니다.' } as Result<T>;
  }
}

export type BuyerOrderStatus =
  | 'paid' | 'preparing' | 'shipped' | 'delivered' | 'confirmed' | 'return_requested' | 'cancelled';

export const BUYER_STATUS_LABEL: Record<BuyerOrderStatus, string> = {
  paid: '결제 완료',
  preparing: '배송 준비',
  shipped: '배송 중',
  delivered: '배송 완료',
  confirmed: '구매확정',
  return_requested: '반품 요청 중',
  cancelled: '취소·환불 완료',
};

export const BUYER_STATUS_STYLE: Record<string, string> = {
  paid: 'bg-blue-50 text-blue-600',
  preparing: 'bg-indigo-50 text-indigo-600',
  shipped: 'bg-amber-50 text-amber-600',
  delivered: 'bg-emerald-50 text-emerald-600',
  confirmed: 'bg-slate-900 text-white',
  return_requested: 'bg-orange-50 text-orange-600',
  cancelled: 'bg-slate-100 text-slate-500',
};

export interface SavedAddress {
  buyerName: string; buyerPhone: string; buyerEmail: string;
  recipientName: string; recipientPhone: string; postcode: string;
  address1: string; address2: string; deliveryMemo: string;
}

export interface BuyerOrderListItem {
  id: string; createdAt: string; paidAt: string | null; productName: string; productImage: string;
  optionName: string; quantity: number; totalAmount: number; status: BuyerOrderStatus;
}

export interface SellerInfo { brandName?: string; businessName: string; businessNumber: string; ceoName: string; phone: string; address: string }

export interface BuyerOrderDetail extends BuyerOrderListItem {
  code: string; productId: string; unitPrice: number; productAmount: number; shippingFee: number; payMethod: string;
  recipientName: string; recipientPhone: string; postcode: string; address1: string; address2: string; deliveryMemo: string;
  trackingCompany: string; trackingNumber: string; trackingUrl: string;
  shippedAt: string | null; deliveredAt: string | null; confirmedAt: string | null; cancelledAt: string | null;
  cancelledBy: string; cancelReason: string; refundAmount: number; influencer: string; seller: SellerInfo;
  canCancel: boolean; canReturn: boolean; returnExpired: boolean; canConfirm: boolean;
}

export interface ReturnRequestInfo {
  reason: string; memo: string; photoUrls: string[]; status: 'requested' | 'approved' | 'rejected' | 'refunded';
  returnAddress: string; pickupMessage: string; rejectReason: string;
  requestedAt: string; decidedAt: string | null; refundedAt: string | null;
}

export interface OrderEvent { actorType: string; action: string; note: string; createdAt: string }

export interface BuyerInquiry {
  id: string; productName: string; orderId: string; body: string; answer: string;
  answeredAt: string | null; createdAt: string; brandName?: string;
}

export const CANCEL_REASONS = ['단순 변심', '옵션 잘못 선택', '배송 지연', '기타'];
export const RETURN_REASONS = ['단순 변심', '상품 불량', '오배송', '기타'];

export const buyerService = {
  me() {
    return call<{ username: string; unreadNotifications: number; saved: SavedAddress }>('GET', '/api/affiliate-buyer?scope=me');
  },
  orders() {
    return call<{ orders: BuyerOrderListItem[] }>('GET', '/api/affiliate-buyer?scope=orders');
  },
  order(id: string) {
    return call<{ order: BuyerOrderDetail; events: OrderEvent[]; returnRequest: ReturnRequestInfo | null; inquiries: BuyerInquiry[] }>(
      'GET', `/api/affiliate-buyer?scope=order&id=${encodeURIComponent(id)}`,
    );
  },
  inquiries() {
    return call<{ inquiries: BuyerInquiry[] }>('GET', '/api/affiliate-buyer?scope=inquiries');
  },
  notifications() {
    return call<{ notifications: { id: number; kind: string; title: string; body: string; link: string; read_at: string | null; created_at: string }[] }>(
      'GET', '/api/affiliate-buyer?scope=notifications',
    );
  },
  readNotifications() {
    return call<{ ok: true }>('POST', '/api/affiliate-buyer', { action: 'read_notifications' });
  },
  cancel(id: string, reason: string, memo: string) {
    return call<{ ok: true }>('POST', '/api/affiliate-buyer', { action: 'cancel', id, reason, memo });
  },
  confirm(id: string) {
    return call<{ ok: true }>('POST', '/api/affiliate-buyer', { action: 'confirm', id });
  },
  requestReturn(id: string, reason: string, memo: string, photoUrls: string[]) {
    return call<{ ok: true }>('POST', '/api/affiliate-buyer', { action: 'return_request', id, reason, memo, photoUrls });
  },
  inquire(input: { body: string; orderId?: string; code?: string }) {
    return call<{ ok: true; id: string }>('POST', '/api/affiliate-buyer', { action: 'inquiry', ...input });
  },
  async uploadPhoto(file: File): Promise<{ url?: string; error?: string }> {
    try {
      const form = new FormData();
      form.append('photo', file, file.name);
      const res = await fetch('/api/affiliate-buyer', { method: 'POST', headers: await buyerHeaders(false), body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json?.error || '사진을 올리지 못했습니다.' };
      return json;
    } catch {
      return { error: '네트워크 오류가 발생했습니다.' };
    }
  },
};
