import { collabHeaders } from './apiService';

/** 어필리에이트 스토어(ZVZO 방식) API. 서버: netlify/functions/api-affiliate-store.mts */

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';
export type ProductStatus = 'draft' | 'on_sale' | 'paused';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
/** 선정된 신청의 링크 상태. 선정하면 바로 'done'(링크 발급), 운영자가 잠시 닫으면 'contacting'. */
export type ManagerStatus = 'waiting' | 'contacting' | 'done';

export const MANAGER_STATUS_LABEL: Record<ManagerStatus, string> = {
  waiting: '링크 대기',
  contacting: '링크 닫힘',
  done: '링크 발급',
};
export const MANAGER_STATUS_STYLE: Record<ManagerStatus, string> = {
  waiting: 'bg-amber-50 text-amber-600',
  contacting: 'bg-blue-50 text-blue-600',
  done: 'bg-emerald-50 text-emerald-600',
};

/** 담당자 연락 큐 한 줄(운영 콘솔). */
export interface ManagerSelection extends StoreRequest {
  businessUsername: string;
  salePrice: number;
  commissionRate: number;
  managerUsername: string;
  managerNote: string;
  managerUpdatedAt: string | null;
  brandContact: { name: string; phone: string; email: string };
  creatorContact: { name: string; phone: string; instagramUrl: string };
}

export type CreatorStatus = 'approved' | 'pending' | 'rejected' | 'none';
export interface CreatorAccess { status: CreatorStatus; legacy: boolean; approved: boolean; rejectReason: string }
export interface CreatorApplication {
  username: string;
  source: 'application' | 'legacy';
  name: string;
  contact: string;
  instagramUrl: string;
  privacyConsentedAt: string | null;
  status: Exclude<CreatorStatus, 'none'>;
  rejectReason: string;
  reviewedBy: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CreatorApplicationInput { name: string; contact: string; instagramUrl: string; privacyConsent: boolean }

export interface StoreApplication {
  id: string;
  businessUsername: string;
  businessName: string;
  businessNumber: string;
  brandName: string;
  channelUrl: string;
  categories: string[];
  contactName: string;
  contactPosition: string;
  contactPhone: string;
  contactEmail: string;
  ceoName: string;
  businessAddress: string;
  csPhone: string;
  status: ApplicationStatus;
  rejectReason: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  productCount?: number;
}

export interface ApplicationInput {
  businessName: string;
  businessNumber: string;
  brandName: string;
  channelUrl: string;
  categories: string[];
  contactName: string;
  contactPosition: string;
  contactPhone: string;
  contactEmail: string;
  ceoName: string;
  businessAddress: string;
  csPhone: string;
}

/** 브랜드 화면에서는 stock(재고)이 오고, 인플루언서 화면에서는 재고 대신 soldOut(품절 여부)만 온다. */
export interface ProductOption { name: string; stock: number; soldOut?: boolean }

/** 상위 카테고리와 그 하위 카테고리. 서버(TAXONOMY)가 내려준다. */
export interface CategoryNode { name: string; subs: string[] }

export interface StoreBrand {
  username: string;
  brandName: string;
  categories: string[];
  productCount: number;
  thumbs: string[];
}

export interface BrandInfo { username: string; brandName: string; channelUrl: string; categories: string[] }

export interface ProductQuery { category?: string; sub?: string; q?: string; brand?: string; page?: number }

export interface StoreProduct {
  id: string;
  businessUsername: string;
  brandName?: string;
  name: string;
  category: string;
  subcategory: string;
  summary: string;
  description: string;
  imageUrls: string[];
  /** 상세페이지 이미지(위에서 아래로 이어 붙여 보여 준다). */
  detailImageUrls: string[];
  /** 사이즈 가이드(글). 구매 페이지 SIZE GUIDE 칸에 나간다. */
  sizeGuide: string;
  /** 배송 · 교환 · 반품 안내(글). 구매 페이지 DELIVERY GUIDE 칸에 나간다. */
  deliveryGuide: string;
  /** 상품 정보 칸마다 글 아래에 이어 붙여 보여 주는 이미지. */
  descriptionImageUrls: string[];
  sizeGuideImageUrls: string[];
  deliveryGuideImageUrls: string[];
  options: ProductOption[];
  retailPrice: number;
  salePrice: number;
  commissionRate: number;
  stock: number;
  shippingFee: number;
  productUrl: string;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  requestCounts?: { pending: number; approved: number };
}

export type ProductInput = Omit<StoreProduct, 'id' | 'businessUsername' | 'brandName' | 'createdAt' | 'updatedAt' | 'requestCounts'> & { id?: string };

export interface StoreRequest {
  id: string;
  productId: string;
  productName?: string;
  productImage: string;
  brandName?: string;
  influencerUsername: string;
  message: string;
  channelUrl: string;
  status: RequestStatus;
  brandNote: string;
  /** 선정 뒤 담당자 연락 단계. '' 은 해당 없음(대기 · 반려 등). */
  managerStatus: ManagerStatus | '';
  /** 브랜드가 선정하면 바로 생기는 인플루언서 전용 링크 코드(/shop/<코드>). */
  linkCode: string;
  clickCount: number;
  createdAt: string;
  updatedAt: string;
  /** 브랜드 화면에서만 온다 — 지원한 인플루언서의 인스타 프로필 · 최근 릴스(캠페인 지원자와 같은 스냅샷). */
  insights?: Record<string, any> | null;
}

export type OrderStatus = 'pending_payment' | 'paid' | 'preparing' | 'shipped' | 'delivered' | 'confirmed' | 'return_requested' | 'cancelled';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: '결제 대기',
  paid: '결제 완료',
  preparing: '배송 준비',
  shipped: '배송 중',
  delivered: '배송 완료',
  confirmed: '구매확정',
  return_requested: '반품 요청 중',
  cancelled: '취소·환불',
};

export const COMMISSION_STATUS_LABEL: Record<string, string> = { pending: '정산 예정', confirmed: '정산 확정', cancelled: '정산 취소' };
export const COMMISSION_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600', confirmed: 'bg-emerald-50 text-emerald-600', cancelled: 'bg-slate-100 text-slate-400',
};

export interface OrderReturn {
  status: 'requested' | 'approved' | 'rejected' | 'refunded';
  reason: string; memo: string; photoUrls: string[];
  returnAddress: string; pickupMessage: string; rejectReason: string;
  requestedAt: string; decidedAt: string | null; refundedAt: string | null;
}

export interface BrandInquiry {
  id: string; buyerName: string; productName: string; orderId: string; body: string;
  answer: string; answeredAt: string | null; createdAt: string;
}

export interface StoreNotification { id: number; kind: string; title: string; body: string; read_at: string | null; created_at: string }

export interface AdminIssues {
  returns: { orderId: string; brand: string; brandName: string; productName: string; totalAmount: number; buyerName: string; status: string; reason: string; memo: string; requestedAt: string; decidedAt: string | null; businessDays: number }[];
  inquiries: { id: string; brand: string; brandName: string; productName: string; orderId: string; body: string; createdAt: string; businessDays: number }[];
  operatorActions: { order_id: string; actor: string; action: string; note: string; created_at: string }[];
  checkoutOpen: boolean;
  feeRates: FeeRates;
  feeHistory: { key: string; oldValue: string; newValue: string; changedBy: string; changedAt: string }[];
}

/** 수수료율(%). 플랫폼 · PG(결제 수단별). */
export interface FeeRates { platform: number; pgCard: number; pgKakaopay: number }

export const FEE_KEY_LABEL: Record<string, string> = {
  affiliate_platform_rate: '플랫폼 수수료',
  affiliate_pg_rate_card: 'PG 수수료(카드)',
  affiliate_pg_rate_kakaopay: 'PG 수수료(카카오페이)',
};

export interface StoreOrder {
  id: string;
  productId: string;
  productName: string;
  optionName: string;
  quantity: number;
  unitPrice: number;
  shippingFee: number;
  totalAmount: number;
  commissionRate: number;
  commissionAmount: number;
  influencerUsername: string;
  status: OrderStatus;
  paidAt: string | null;
  trackingCompany: string;
  trackingNumber: string;
  trackingUrl?: string;
  shippedAt: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string;
  cancelReason?: string;
  cancelMemo?: string;
  refundAmount?: number;
  commissionStatus?: 'pending' | 'confirmed' | 'cancelled' | string;
  platformRate?: number;
  pgRate?: number;
  payMethod?: string;
  /** 브랜드 정산 예정액(표시만). 취소 · 환불 주문은 included=false, 모든 값 0. */
  settlement?: { payment: number; product: number; shipping: number; commission: number; pgFee: number; platformFee: number; amount: number; included: boolean };
  isNew?: boolean;
  returnRequest?: OrderReturn | null;
  createdAt: string;
  // 브랜드에게만 내려온다
  buyerName?: string;
  buyerPhone?: string;
  buyerEmail?: string;
  recipientName?: string;
  recipientPhone?: string;
  postcode?: string;
  address1?: string;
  address2?: string;
  deliveryMemo?: string;
}

export interface MyAffiliateItem extends StoreRequest {
  salePrice: number;
  commissionRate: number;
  /** 지금 구매할 수 있는지(판매중 · 재고 있음). */
  live: boolean;
  stats: { orders: number; units: number; sales: number; commission: number; pending: number; confirmed: number };
}

/** 인플루언서 전용 상품 링크. */
export const shopLink = (code: string) => `${window.location.origin}/shop/${code}`;

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: '임시저장',
  on_sale: '판매중',
  paused: '판매중지',
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: '검토 대기',
  approved: '선정',
  rejected: '반려',
  cancelled: '취소',
};

export const won = (n: number) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;

type Result<T> = T & { error?: string };

async function call<T>(method: 'GET' | 'POST', url: string, body?: unknown, opts: { token?: string; account?: string } = {}): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: await collabHeaders(opts.token, opts.account ? { account: opts.account } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ...(json || {}), error: json?.error || '요청을 처리하지 못했습니다.' } as Result<T>;
    return json as Result<T>;
  } catch (e) {
    console.error(`[affiliate-store] ${method} failed:`, e);
    return { error: '네트워크 오류가 발생했습니다.' } as Result<T>;
  }
}

const URL_BASE = '/api/affiliate-store';
const OPS = '/api/affiliate-store-ops';
const CREATOR_URL = '/api/creator-application';

export const affiliateStoreService = {
  // 브랜드
  getBrand(account: string) {
    return call<{ application: StoreApplication | null; products: StoreProduct[]; requests: StoreRequest[]; orders?: StoreOrder[]; categories: string[]; taxonomy: CategoryNode[]; feeRates?: FeeRates }>(
      'GET', `${URL_BASE}?scope=brand`, undefined, { account },
    );
  },
  apply(account: string, input: ApplicationInput) {
    return call<{ application: StoreApplication }>('POST', URL_BASE, { action: 'apply', ...input }, { account });
  },
  saveProduct(account: string, product: ProductInput) {
    return call<{ product: StoreProduct }>('POST', URL_BASE, { action: 'save_product', product }, { account });
  },
  deleteProduct(account: string, id: string) {
    return call<{ ok: true }>('POST', URL_BASE, { action: 'delete_product', id }, { account });
  },
  reviewRequest(account: string, id: string, decision: 'approve' | 'reject', note = '') {
    return call<{ request: StoreRequest }>('POST', URL_BASE, { action: 'review_request', id, decision, note }, { account });
  },

  updateSeller(account: string, input: { ceoName: string; businessAddress: string; csPhone: string }) {
    return call<{ application: StoreApplication }>('POST', URL_BASE, { action: 'update_seller_info', ...input }, { account });
  },

  // 브랜드 주문 운영(/api/affiliate-store-ops)
  brandOps(account: string) {
    return call<{ orders: StoreOrder[]; inquiries: BrandInquiry[]; notifications: StoreNotification[] }>('GET', `${OPS}?scope=brand`, undefined, { account });
  },
  orderAction(account: string, action: string, payload: Record<string, unknown>) {
    return call<{ ok: true }>('POST', OPS, { action, ...payload }, { account });
  },

  // 운영자 미처리 목록
  adminIssues(token: string) {
    return call<AdminIssues>('GET', `${OPS}?scope=admin-issues`, undefined, { token });
  },
  adminAction(token: string, action: 'admin_refund' | 'admin_remind' | 'set_checkout_open' | 'set_fee_rates', payload: Record<string, unknown>) {
    return call<{ ok: true; checkoutOpen?: boolean; feeRates?: FeeRates }>('POST', OPS, { action, ...payload }, { token });
  },

  // 인플루언서
  myAffiliate() {
    return call<{ items: MyAffiliateItem[]; totals: { clicks: number; orders: number; sales: number; commission: number; pending: number; confirmed: number; cancelled: number }; orders: StoreOrder[] }>(
      'GET', `${URL_BASE}?scope=my-affiliate`,
    );
  },
  listProducts(query: ProductQuery = {}) {
    const p = new URLSearchParams({ scope: 'creator' });
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
    return call<{ products: StoreProduct[]; total: number; page: number; hasMore: boolean; brand: BrandInfo | null; taxonomy: CategoryNode[] }>(
      'GET', `${URL_BASE}?${p.toString()}`,
    );
  },
  listBrands(q = '', page = 1) {
    const p = new URLSearchParams({ scope: 'brands', page: String(page) });
    if (q) p.set('q', q);
    return call<{ brands: StoreBrand[]; total: number; page: number; hasMore: boolean }>('GET', `${URL_BASE}?${p.toString()}`);
  },
  myRequests() {
    return call<{ requests: StoreRequest[] }>('GET', `${URL_BASE}?scope=my-requests`);
  },
  request(productId: string, message: string, channelUrl: string) {
    return call<{ request: StoreRequest }>('POST', URL_BASE, { action: 'request', productId, message, channelUrl });
  },
  cancelRequest(id: string) {
    return call<{ ok: true }>('POST', URL_BASE, { action: 'cancel_request', id });
  },

  // 담당자 — 브랜드가 선정한 신청의 연락 진행
  listSelections(token: string) {
    return call<{ selections: ManagerSelection[] }>('GET', `${URL_BASE}?scope=selections`, undefined, { token });
  },
  updateSelection(token: string, id: string, managerStatus: ManagerStatus, note?: string) {
    return call<{ request: StoreRequest }>('POST', URL_BASE, { action: 'manager_update', id, managerStatus, note }, { token });
  },

  // 크리에이터 지원 · 승인(/api/creator-application)
  creatorAccess() {
    return call<{ access: CreatorAccess; application: CreatorApplication | null }>('GET', CREATOR_URL);
  },
  applyCreator(input: CreatorApplicationInput) {
    return call<{ application: CreatorApplication }>('POST', CREATOR_URL, { action: 'apply', ...input });
  },
  listCreatorApplications(token: string) {
    return call<{ applications: CreatorApplication[] }>('GET', `${CREATOR_URL}?scope=admin`, undefined, { token });
  },
  reviewCreator(token: string, username: string, decision: 'approve' | 'reject', reason = '') {
    return call<{ application: CreatorApplication }>('POST', CREATOR_URL, { action: 'review', username, decision, reason }, { token });
  },

  // 운영자
  listApplications(token: string) {
    return call<{ applications: StoreApplication[] }>('GET', `${URL_BASE}?scope=admin`, undefined, { token });
  },
  reviewApplication(token: string, id: string, decision: 'approve' | 'reject', reason = '') {
    return call<{ application: StoreApplication }>('POST', URL_BASE, { action: 'review_application', id, decision, reason }, { token });
  },
};
