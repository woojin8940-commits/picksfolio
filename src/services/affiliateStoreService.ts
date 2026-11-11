import { collabHeaders } from './apiService';

/** 어필리에이트 스토어(ZVZO 방식) API. 서버: netlify/functions/api-affiliate-store.mts */

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';
export type ProductStatus = 'draft' | 'on_sale' | 'paused';
/** 지금 실제 판매 상태(판매중 상태 + 판매기간 + 재고 + 삭제 여부). */
export type SaleState = 'on_sale' | 'scheduled' | 'ended' | 'sold_out' | 'paused' | 'draft' | 'deleted';
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

/**
 * 선정 뒤 협찬 배송 단계. 선정 → 인플루언서 배송정보 입력(협업 진행 · 링크 열림) → 브랜드 송장 입력.
 * 인플루언서가 반려하면 협업은 진행되지 않는다. '' 는 예전 흐름(선정 즉시 링크 발급)이나 해당 없음.
 */
export type ShippingStatus = 'awaiting_info' | 'info_submitted' | 'shipped' | 'declined';

export const SHIPPING_STATUS_LABEL: Record<ShippingStatus, string> = {
  awaiting_info: '배송정보 입력 대기',
  info_submitted: '발송 대기',
  shipped: '발송 완료',
  declined: '인플루언서 반려',
};
export const SHIPPING_STATUS_STYLE: Record<ShippingStatus, string> = {
  awaiting_info: 'bg-amber-50 text-amber-600',
  info_submitted: 'bg-blue-50 text-blue-600',
  shipped: 'bg-emerald-50 text-emerald-600',
  declined: 'bg-slate-100 text-slate-500',
};

/** 협찬 상품 택배사(서버 목록과 같다). */
/** 국내 택배사 코드(두 자리 · 01~06 주요 택배사, 07~ 중소 · 편의점 택배). 송장 입력 선택지와 엑셀 '택배사 코드' 칸이 같이 쓴다. 한번 정한 번호는 바꾸지 않고 새 택배사는 뒤에 붙인다. 엑셀의 '택배사 코드' 칸에 이 숫자를 적는다. */
export const COURIER_CODES: { code: string; name: string }[] = [
  { code: '01', name: 'CJ대한통운' },
  { code: '02', name: '한진택배' },
  { code: '03', name: '롯데택배' },
  { code: '04', name: '우체국택배' },
  { code: '05', name: '로젠택배' },
  { code: '06', name: '경동택배' },
  { code: '07', name: '대신택배' },
  { code: '08', name: '일양로지스' },
  { code: '09', name: '합동택배' },
  { code: '10', name: '천일택배' },
  { code: '11', name: '건영택배' },
  { code: '12', name: 'CU 편의점택배' },
  { code: '13', name: 'GS25 편의점택배' },
  { code: '14', name: '한의사랑택배' },
  { code: '15', name: 'SLX택배' },
  { code: '16', name: '홈픽' },
  { code: '17', name: '우리택배' },
  { code: '18', name: '용마로지스' },
  { code: '19', name: '농협택배' },
  { code: '20', name: '세방택배' },
];
/** 택배사 이름 목록(송장 입력 선택지). '기타' 없이 코드표의 택배사만 쓴다. */
export const SHIPPING_COURIERS = COURIER_CODES.map(c => c.name);
export const courierCodeOf = (name?: string | null) => COURIER_CODES.find(c => c.name === name)?.code || '';

export interface SelectionShipping {
  recipientName: string;
  recipientPhone: string;
  postcode: string;
  address1: string;
  address2: string;
  memo: string;
  submittedAt: string | null;
}
export type SelectionShippingInput = Omit<SelectionShipping, 'submittedAt'>;

/** 직거래 금지 동의가 필요할 때 서버가 돌려주는 코드. */
export const DIRECT_DEAL_AGREEMENT_REQUIRED = 'DIRECT_DEAL_AGREEMENT_REQUIRED';

/** 담당자 연락 큐 한 줄(운영 콘솔). */
export interface ManagerSelection extends StoreRequest {
  businessUsername: string;
  salePrice: number;
  commissionRate: number;
  managerUsername: string;
  managerNote: string;
  managerUpdatedAt: string | null;
  /** 운영자가 아직 확인하지 않은 새 선정. */
  operatorUnseen?: boolean;
  brandContact: { name: string; phone: string; email: string; csPhone?: string };
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
export interface CreatorApplicationInput { name: string; contact: string; instagramUrl: string; privacyConsent: boolean; directDealAgreement: boolean }

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
  /** 통신판매업 신고번호 */
  mailOrderNumber: string;
  /** 구매자 "문의하기"가 여는 자사몰 · 고객센터 주소(https://) */
  inquiryUrl: string;
  /** 직거래 금지 동의 시각. 없으면 처음 선정할 때 동의받는다. */
  directDealAgreedAt?: string | null;
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
  mailOrderNumber: string;
  inquiryUrl: string;
}

/** 구매자 문의 링크 규칙(서버와 같다): https:// 로 시작하는 주소만. */
export const isHttpsUrl = (v: string) => /^https:\/\/[^\s/?#]+\.[^\s]+$/i.test(v.trim());

/** 판매자 정보 · 문의 링크가 다 채워졌는지(브랜드 화면 상단 등록 요청 배너 기준). */
export const sellerInfoMissing = (a: Pick<StoreApplication, 'ceoName' | 'businessAddress' | 'csPhone' | 'mailOrderNumber' | 'inquiryUrl'>) => {
  const missing: string[] = [];
  if (!isHttpsUrl(a.inquiryUrl || '')) missing.push('고객 문의 링크');
  if (!a.ceoName?.trim()) missing.push('대표자');
  if (!a.businessAddress?.trim()) missing.push('사업장 주소');
  if (!a.csPhone?.trim()) missing.push('고객센터 연락처');
  if (!a.mailOrderNumber?.trim()) missing.push('통신판매업 신고번호');
  return missing;
};

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

export interface ProductQuery { category?: string; sub?: string; q?: string; brand?: string }

/** 목록 커서(최신순). 서버 응답의 nextCursor 를 그대로 다음 요청에 넘긴다. */
export interface ListCursor { cursorAt: string; cursorId: string; cursorAmount?: number }

const withCursor = (p: URLSearchParams, cursor?: ListCursor | null) => {
  if (cursor) {
    p.set('cursorAt', cursor.cursorAt);
    p.set('cursorId', cursor.cursorId);
    if (cursor.cursorAmount !== undefined) p.set('cursorAmount', String(cursor.cursorAmount));
  }
  return p;
};

export interface BrandCounts {
  productTotal: number;
  onSaleTotal: number;
  requestTotal: number;
  pendingRequestCount: number;
  /** 브랜드가 아직 확인하지 않은 검토 대기 신청 수(상품별 신청자 목록을 열면 줄어든다). */
  newRequestCount: number;
  /** 인플루언서가 배송정보를 입력해 협찬 상품을 보내야 하는 선정 수. */
  shipPendingCount?: number;
  opsCounts: { newOrders: number; claimsNeedAction: number; unread: number };
}

export interface BrandOpsSummary {
  orderCounts: { new: number; preparing: number; shipped: number; delivered: number; all: number };
  claimCounts: { all: number; cancel: number; return: number; action: number };
  opsCounts: { newOrders: number; claimsNeedAction: number; unread: number };
  settlement: { payment: number; commission: number; pgFee: number; platformFee: number; amount: number; confirmedAmount: number };
}

export interface BulkResult { id: string; ok: boolean; skipped?: boolean; error?: string }
export type BrandOrderSort = 'latest' | 'oldest' | 'amount_desc' | 'amount_asc';
export const BRAND_ORDER_SORTS: { key: BrandOrderSort; label: string }[] = [
  { key: 'latest', label: '주문일 최신순' },
  { key: 'oldest', label: '주문일 오래된순' },
  { key: 'amount_desc', label: '금액 높은순' },
  { key: 'amount_asc', label: '금액 낮은순' },
];
export type BrandOrderFilter = 'new' | 'preparing' | 'shipped' | 'delivered' | 'all' | 'to_ship';
export type BrandClaimFilter = 'all' | 'cancel' | 'return' | 'action';

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
  /** 배송 · 반품 안내(글). 구매 페이지 "배송 · 반품 안내" 칸에 나간다. */
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
  /** 판매기간(한국 날짜 'YYYY-MM-DD'). 비어 있으면 제한 없음. */
  saleStartDate: string;
  saleEndDate: string;
  /** 서버가 계산한 지금 판매 상태. */
  saleState?: SaleState;
  createdAt: string;
  updatedAt: string;
  requestCounts?: { pending: number; approved: number; rejected?: number; unseen?: number; toShip?: number };
  /** 판매 신청 · 상품별 묶음에서만 온다. */
  lastRequestAt?: string;
}

export type ProductInput = Omit<StoreProduct, 'id' | 'businessUsername' | 'brandName' | 'createdAt' | 'updatedAt' | 'requestCounts' | 'saleState' | 'lastRequestAt'> & { id?: string };

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
  /** 상품의 지금 판매 상태(내 신청 목록 등). */
  productState?: SaleState;
  /** 브랜드가 아직 확인하지 않은 신청. */
  unseen?: boolean;
  createdAt: string;
  updatedAt: string;
  /** 선정 뒤 협찬 배송 단계('' = 예전 흐름 · 해당 없음). */
  shippingStatus?: ShippingStatus | '';
  /** 인플루언서가 입력한 배송지(그 신청의 브랜드 · 인플루언서 본인 · 운영자에게만). */
  shipping?: SelectionShipping | null;
  trackingCompany?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  shippedAt?: string | null;
  declinedReason?: string;
  declinedAt?: string | null;
  /** 협찬 상품 수령 시각(인플루언서 수령 확인 · 송장 조회 배송 완료 · 발송 5일 뒤 자동). */
  deliveredAt?: string | null;
  /** 업로드 마감(수령 + 10일). 수령 전이면 null. */
  uploadDeadline?: string | null;
  /** 인플루언서가 올린 콘텐츠 링크 · 브랜디드 콘텐츠 파트너십 코드. */
  contentUrl?: string;
  partnershipCode?: string;
  contentSubmittedAt?: string | null;
  /** 브랜드 화면에서만 온다 — 지원한 인플루언서의 인스타 프로필 · 최근 릴스(캠페인 지원자와 같은 스냅샷). */
  insights?: Record<string, any> | null;
}

export type OrderStatus = 'pending_payment' | 'expired' | 'paid' | 'preparing' | 'shipped' | 'delivered' | 'confirmed' | 'return_requested' | 'cancelled';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: '결제 대기',
  expired: '결제 안 됨',
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
  refundAmount?: number; shippingDeduction?: number;
  /** 단순 변심 반품이라 왕복 배송비를 빼고 부분 환불할 수 있는지 */
  partialAllowed?: boolean;
}

export interface StoreNotification { id: number; kind: string; title: string; body: string; read_at: string | null; created_at: string }

export interface AdminIssues {
  returns: { orderId: string; brand: string; brandName: string; productName: string; totalAmount: number; buyerName: string; status: string; reason: string; memo: string; requestedAt: string; decidedAt: string | null; businessDays: number }[];
  inquiries: { id: string; brand: string; brandName: string; productName: string; orderId: string; body: string; createdAt: string; businessDays: number }[];
  operatorActions: { order_id: string; actor: string; action: string; note: string; created_at: string }[];
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
  settlement?: { payment: number; product: number; shipping: number; commission: number; pgFee: number; platformFee: number; amount: number; included: boolean; partialRefund?: number };
  /** 브랜드가 '배송 완료'를 누를 수 있는 시각(송장 입력 후 하루). */
  deliverableAt?: string | null;
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

/** 상품을 받은 뒤 콘텐츠를 올려 판매를 시작해야 하는 기한(일). 서버(UPLOAD_DAYS)와 같다. */
export const UPLOAD_DAYS = 10;

/** 업로드 일정 한 줄. 수령 전 · D-n · 오늘 마감 · n일 지남 · 업로드 완료. */
export function uploadScheduleOf(r: Pick<StoreRequest, 'shippingStatus' | 'deliveredAt' | 'uploadDeadline' | 'contentUrl' | 'shippedAt'>, now = Date.now()) {
  if (r.contentUrl) return { tone: 'done' as const, label: '업로드 완료' };
  if (!r.uploadDeadline) {
    if (r.shippingStatus === 'shipped') return { tone: 'wait' as const, label: `수령 후 ${UPLOAD_DAYS}일 이내 업로드` };
    return { tone: 'wait' as const, label: '상품 발송 전' };
  }
  const left = Math.ceil((new Date(r.uploadDeadline).getTime() - now) / 86_400_000);
  if (left > 0) return { tone: left <= 3 ? 'soon' as const : 'ok' as const, label: `업로드 마감 D-${left}` };
  if (left === 0) return { tone: 'soon' as const, label: '오늘 업로드 마감' };
  return { tone: 'late' as const, label: `업로드 마감 ${-left}일 지남` };
}
export const UPLOAD_TONE_STYLE: Record<'done' | 'wait' | 'ok' | 'soon' | 'late', string> = {
  done: 'bg-emerald-50 text-emerald-600',
  wait: 'bg-slate-100 text-slate-500',
  ok: 'bg-blue-50 text-blue-600',
  soon: 'bg-amber-50 text-amber-600',
  late: 'bg-red-50 text-red-500',
};
export const shortDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
};

export interface ProductSalesRow {
  influencerUsername: string;
  clicks: number;
  contentUrl: string;
  orders: number;
  units: number;
  sales: number;
  commission: number;
  lastOrderAt: string | null;
}
export interface ProductSalesTotals { clicks: number; orders: number; units: number; sales: number; commission: number; sellers: number }

export interface MyAffiliateItem extends StoreRequest {
  salePrice: number;
  commissionRate: number;
  /** 지금 구매할 수 있는지(판매중 · 재고 있음). */
  live: boolean;
  /** 인플루언서가 '진행 상품'에서 내린 시각(진행 이력 탭에만 보인다). */
  hiddenAt?: string | null;
  stats: { orders: number; units: number; sales: number; commission: number; pending: number; confirmed: number };
}

/** 인플루언서 전용 상품 링크. */
export const shopLink = (code: string) => `${window.location.origin}/shop/${code}`;

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: '임시저장',
  on_sale: '판매중',
  paused: '판매중지',
};

/** 인플루언서 · 브랜드에게 보여 주는 판매 상태 이름. */
export const SALE_STATE_LABEL: Record<SaleState, string> = {
  on_sale: '판매중',
  scheduled: '판매 예정',
  ended: '판매 기간 종료',
  sold_out: '품절',
  paused: '판매 중지',
  draft: '판매 중지',
  deleted: '판매 종료',
};
export const SALE_STATE_STYLE: Record<SaleState, string> = {
  on_sale: 'bg-emerald-50 text-emerald-600',
  scheduled: 'bg-blue-50 text-blue-600',
  ended: 'bg-slate-100 text-slate-500',
  sold_out: 'bg-orange-50 text-orange-600',
  paused: 'bg-red-50 text-red-500',
  draft: 'bg-red-50 text-red-500',
  deleted: 'bg-slate-100 text-slate-500',
};

/** 'YYYY-MM-DD' → '2026.11.10' */
export const periodDate = (d: string) => (d ? d.replace(/-/g, '.') : '');
/** 판매기간 한 줄. 둘 다 비어 있으면 '상시 판매'. */
export const salePeriodText = (start?: string, end?: string) =>
  !start && !end ? '상시 판매' : `${start ? periodDate(start) : '등록일'} ~ ${end ? periodDate(end) : '종료일 없음'}`;

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
  /** 브랜드 첫 화면(커서 없음: 신청서 · 숫자 · 상품 첫 페이지) 또는 상품 "더 보기"(커서: 상품만). */
  getBrand(account: string, cursor?: ListCursor | null) {
    const p = withCursor(new URLSearchParams({ scope: 'brand' }), cursor);
    return call<Partial<BrandCounts> & {
      application?: StoreApplication | null;
      products: StoreProduct[];
      productHasMore: boolean;
      productNextCursor: ListCursor | null;
      categories?: string[];
      taxonomy?: CategoryNode[];
      feeRates?: FeeRates;
    }>('GET', `${URL_BASE}?${p.toString()}`, undefined, { account });
  },
  /** 상단 숫자 · 탭 배지만 새로 받는다(상품 삭제 · 판매 상태 변경 뒤). */
  getBrandCounts(account: string) {
    return call<BrandCounts>('GET', `${URL_BASE}?scope=brand&section=counts`, undefined, { account });
  },
  /** 판매 신청 — 신청을 받은 상품별 묶음(대기 · 선정 · 반려 · 새 신청 수). */
  getBrandRequestProducts(account: string) {
    return call<{ products: StoreProduct[] }>('GET', `${URL_BASE}?scope=brand&section=request-products`, undefined, { account });
  },
  /** 상품의 신청자 목록을 열었을 때 그 상품의 새 신청 알림을 끈다. 응답에 새 숫자가 온다. */
  markRequestsSeen(account: string, productId: string) {
    return call<BrandCounts & { ok: true }>('POST', URL_BASE, { action: 'mark_requests_seen', productId }, { account });
  },
  getBrandRequests(account: string, cursor?: ListCursor | null, filter: { productId?: string; status?: 'pending' | 'approved' | 'rejected' | '' } = {}) {
    const p = withCursor(new URLSearchParams({ scope: 'brand', section: 'requests' }), cursor);
    if (filter.productId) p.set('productId', filter.productId);
    if (filter.status) p.set('status', filter.status);
    return call<{ requests: StoreRequest[]; requestHasMore: boolean; requestNextCursor: ListCursor | null; requestTotal?: number; pendingRequestCount?: number }>(
      'GET', `${URL_BASE}?${p.toString()}`, undefined, { account },
    );
  },
  apply(account: string, input: ApplicationInput & { directDealAgreement: boolean }) {
    return call<{ application: StoreApplication }>('POST', URL_BASE, { action: 'apply', ...input }, { account });
  },
  saveProduct(account: string, product: ProductInput) {
    return call<{ product: StoreProduct }>('POST', URL_BASE, { action: 'save_product', product }, { account });
  },
  deleteProduct(account: string, id: string) {
    return call<{ ok: true }>('POST', URL_BASE, { action: 'delete_product', id }, { account });
  },
  reviewRequest(account: string, id: string, decision: 'approve' | 'reject', note = '', directDealAgreement?: boolean) {
    return call<{ request: StoreRequest; code?: string }>('POST', URL_BASE, { action: 'review_request', id, decision, note, directDealAgreement }, { account });
  },
  /** 진행관리 › 진행 단계: 선정된 인플루언서의 배송 · 업로드 일정 · 업로드 링크 · 파트너십 코드. */
  getBrandProgress(account: string, productId: string) {
    const p = new URLSearchParams({ scope: 'brand', section: 'progress', productId });
    return call<{ requests: StoreRequest[] }>('GET', `${URL_BASE}?${p.toString()}`, undefined, { account });
  },
  /** 진행관리 › 판매 현황: 인플루언서별 판매 · 상품 전체 판매(픽스폴리오 전용 링크). */
  getBrandSales(account: string, productId: string) {
    const p = new URLSearchParams({ scope: 'brand', section: 'sales', productId });
    return call<{ influencers: ProductSalesRow[]; totals: ProductSalesTotals }>('GET', `${URL_BASE}?${p.toString()}`, undefined, { account });
  },
  /** 인플루언서가 입력한 배송지로 협찬 상품을 보내고 송장번호를 입력한다(다시 부르면 고친다). */
  shipSelection(account: string, id: string, trackingCompany: string, trackingNumber: string) {
    return call<{ request: StoreRequest }>('POST', URL_BASE, { action: 'ship_selection', id, trackingCompany, trackingNumber }, { account });
  },

  updateSeller(account: string, input: { ceoName: string; businessAddress: string; csPhone: string; mailOrderNumber: string; inquiryUrl: string }) {
    return call<{ application: StoreApplication }>('POST', URL_BASE, { action: 'update_seller_info', ...input }, { account });
  },

  // 브랜드 주문 운영(/api/affiliate-store-ops)
  /**
   * 브랜드 주문 운영(/api/affiliate-store-ops). 필터는 서버에서 거른다.
   * summary: false 면 숫자 · 정산 합계 · 알림 없이 목록만 받는다(필터만 바꿀 때). 커서가 있으면 항상 목록만.
   */
  brandOps(account: string, opt: {
    view?: 'orders' | 'claims';
    filter?: BrandOrderFilter;
    claim?: BrandClaimFilter;
    sort?: BrandOrderSort;
    cursor?: ListCursor | null;
    orderId?: string;
    summary?: boolean;
  } = {}) {
    const p = withCursor(new URLSearchParams({ scope: 'brand', view: opt.view || 'orders' }), opt.cursor);
    if (opt.filter) p.set('filter', opt.filter);
    if (opt.claim) p.set('claim', opt.claim);
    if (opt.sort) p.set('sort', opt.sort);
    if (opt.orderId) p.set('orderId', opt.orderId);
    if (opt.summary === false) p.set('summary', '0');
    return call<{
      orders: StoreOrder[];
      notifications?: StoreNotification[];
      hasMore: boolean;
      nextCursor: ListCursor | null;
      summary?: BrandOpsSummary;
    }>('GET', `${OPS}?${p.toString()}`, undefined, { account });
  },
  orderAction(account: string, action: string, payload: Record<string, unknown>) {
    return call<{ ok: true }>('POST', OPS, { action, ...payload }, { account });
  },
  /** 엑셀 내려받기용: 고른 필터의 주문 전부(최대 3,000건). hasMore 면 잘린 것. */
  brandOrdersExport(account: string, filter: BrandOrderFilter, sort: BrandOrderSort = 'latest') {
    const p = new URLSearchParams({ scope: 'brand', view: 'orders', filter, sort, export: '1' });
    return call<{ orders: StoreOrder[]; hasMore: boolean }>('GET', `${OPS}?${p.toString()}`, undefined, { account });
  },
  /** 일괄 처리(한 번에 100건까지 · 줄마다 결과). */
  bulkOrderAction(account: string, action: 'bulk_ship' | 'bulk_prepare', payload: { items?: { id: string; trackingCompany: string; trackingNumber: string }[]; ids?: string[] }) {
    return call<{ ok: true; results: BulkResult[] }>('POST', OPS, { action, ...payload }, { account });
  },

  // 운영자 미처리 목록
  adminIssues(token: string) {
    return call<AdminIssues>('GET', `${OPS}?scope=admin-issues`, undefined, { token });
  },
  adminAction(token: string, action: 'admin_refund' | 'admin_remind' | 'admin_return_reject' | 'set_fee_rates', payload: Record<string, unknown>) {
    return call<{ ok: true; feeRates?: FeeRates }>('POST', OPS, { action, ...payload }, { token });
  },

  // 인플루언서
  myAffiliate() {
    return call<{ items: MyAffiliateItem[]; preparing?: MyAffiliateItem[]; totals: { clicks: number; orders: number; sales: number; commission: number; pending: number; confirmed: number; cancelled: number }; orderCount: number }>(
      'GET', `${URL_BASE}?scope=my-affiliate`,
    );
  },
  myAffiliateOrders(cursor?: ListCursor | null) {
    const p = withCursor(new URLSearchParams({ scope: 'my-affiliate-orders' }), cursor);
    return call<{ orders: StoreOrder[]; hasMore: boolean; nextCursor: ListCursor | null }>(
      'GET', `${URL_BASE}?${p.toString()}`,
    );
  },
  /** 상품 둘러보기. 첫 페이지(커서 없음)에만 total 이 온다. */
  listProducts(query: ProductQuery = {}, cursor?: ListCursor | null) {
    const p = withCursor(new URLSearchParams({ scope: 'creator' }), cursor);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
    return call<{ products: StoreProduct[]; total?: number; hasMore: boolean; nextCursor: ListCursor | null; brand: BrandInfo | null; taxonomy: CategoryNode[] }>(
      'GET', `${URL_BASE}?${p.toString()}`,
    );
  },
  productDetail(id: string) {
    const p = new URLSearchParams({ scope: 'product-detail', id });
    return call<{ product: StoreProduct }>('GET', `${URL_BASE}?${p.toString()}`);
  },
  listBrands(q = '', page = 1) {
    const p = new URLSearchParams({ scope: 'brands', page: String(page) });
    if (q) p.set('q', q);
    return call<{ brands: StoreBrand[]; total: number; page: number; hasMore: boolean }>('GET', `${URL_BASE}?${p.toString()}`);
  },
  /** "내 신청" 전체 건수 + 지정한 상품(최대 100개)의 신청 상태. */
  myRequestStatuses(productIds: string[] = []) {
    const p = new URLSearchParams({ scope: 'my-request-status' });
    if (productIds.length) p.set('ids', productIds.slice(0, 100).join(','));
    return call<{
      total: number;
      awaitingShippingCount?: number;
      directDealAgreed?: boolean;
      requests: Pick<StoreRequest, 'productId' | 'status' | 'managerStatus' | 'shippingStatus'>[];
    }>('GET', `${URL_BASE}?${p.toString()}`);
  },
  myRequests(cursor?: ListCursor | null) {
    const p = withCursor(new URLSearchParams({ scope: 'my-requests' }), cursor);
    return call<{ requests: StoreRequest[]; hasMore: boolean; nextCursor: ListCursor | null }>('GET', `${URL_BASE}?${p.toString()}`);
  },
  request(productId: string, message: string, channelUrl: string, directDealAgreement?: boolean) {
    return call<{ request: StoreRequest; code?: string }>('POST', URL_BASE, { action: 'request', productId, message, channelUrl, directDealAgreement });
  },
  /** 선정된 협업의 협찬 상품 배송정보 입력(발송 전까지 고칠 수 있다). 입력하면 협업이 진행된다. */
  submitShipping(id: string, input: SelectionShippingInput) {
    return call<{ request: StoreRequest }>('POST', URL_BASE, { action: 'submit_shipping', id, ...input });
  },
  /** 선정된 협업 반려(배송정보 입력 전만). 협업은 진행되지 않는다. */
  declineSelection(id: string, reason: string) {
    return call<{ request: StoreRequest }>('POST', URL_BASE, { action: 'decline_selection', id, reason });
  },
  /** 협찬 상품 수령 확인. 이때부터 10일 안에 콘텐츠를 올려 판매를 시작한다. */
  confirmReceived(id: string) {
    return call<{ request: StoreRequest }>('POST', URL_BASE, { action: 'confirm_received', id });
  },
  /** 업로드한 콘텐츠 링크 · 파트너십 코드 올리기(고치기). */
  /** 판매 중지 · 종료된 상품을 MY 어필리에이트 진행 상품에서 내린다(hidden=false 면 다시 보이게). */
  hideMyAffiliate(id: string, hidden = true) {
    return call<{ ok: true; hiddenAt: string | null }>('POST', URL_BASE, { action: 'hide_my_affiliate', id, hidden });
  },
  submitContent(id: string, contentUrl: string, partnershipCode: string) {
    return call<{ request: StoreRequest }>('POST', URL_BASE, { action: 'submit_content', id, contentUrl, partnershipCode });
  },
  cancelRequest(id: string) {
    return call<{ ok: true }>('POST', URL_BASE, { action: 'cancel_request', id });
  },

  // 담당자 — 브랜드가 선정한 신청의 연락 진행
  listSelections(token: string) {
    return call<{ selections: ManagerSelection[]; newCount: number }>('GET', `${URL_BASE}?scope=selections`, undefined, { token });
  },
  /** 운영 콘솔 메뉴 배지: 브랜드가 새로 선정했는데 운영자가 아직 확인하지 않은 협업 수. */
  selectionsNewCount(token: string) {
    return call<{ newCount: number }>('GET', `${URL_BASE}?scope=selections&countOnly=1`, undefined, { token });
  },
  markSelectionsSeen(token: string, ids: string[]) {
    return call<{ ok: true; newCount: number }>('POST', URL_BASE, { action: 'manager_mark_seen', ids }, { token });
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
