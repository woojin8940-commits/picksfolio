/**
 * 판매 연동형(어필리에이트) 캠페인 API 클라이언트.
 *
 * 브랜드가 카페24 자사몰 상품을 올리고 수수료율을 정하면, 승인된 인플루언서가
 * 개인 링크(/go/{code})로 판매하고, 브랜드 몰에 설치된 추적 스크립트가 주문을
 * 알려 온다. 서버는 그 주문을 카페24 주문 API로 다시 조회해 확인한 것만 집계한다.
 *
 * 화면 셋(브랜드 · 인플루언서 · 운영 콘솔)이 이 파일 하나로 서버와 이야기한다.
 * 운영 콘솔 호출은 화면이 가진 운영자 토큰을 `token` 으로 넘긴다(다른 협업 API 와 같다).
 */
import { collabHeaders } from './apiService';

// ───────────────────────────── 타입 ─────────────────────────────

export type AffiliateCampaignStatus = 'pending_approval' | 'active' | 'rejected' | 'ended';
export type AffiliateJoinMode = 'approval' | 'open';
export type ParticipationStatus = 'pending' | 'approved' | 'rejected' | 'revoked' | 'cancelled';
/** 수수료 상태. 예정 / 확정 / 제외 / 정산 완료 + API 로 확인되지 않은 미검증. */
export type CommissionStatus = 'pending' | 'confirmed' | 'excluded' | 'settled' | 'unverified';

export interface PlatformSettings {
  /** 플랫폼 수수료율(%). 캠페인 등록 시점 값이 캠페인에 고정된다. */
  platformRate: number;
  /** 배송완료 후 이 일수가 지나도 구매확정이 오지 않으면 확정으로 본다. */
  autoConfirmDays: number;
  /** 클릭 후 이 일수 안의 구매만 인정한다(현재 7일 고정). */
  attributionDays: number;
  /** 캠페인마다 자동으로 붙는 광고 표기 문구(등록 화면 미리보기용). */
  disclosureText?: string;
  updatedAt?: string | null;
  updatedBy?: string;
  /** 운영자 응답에만: 브랜드 입금 계좌와 약관의 미정산 한도(원). */
  billing?: BillingSettings;
  history?: { key: string; oldValue: string; newValue: string; changedBy: string; changedAt: string }[];
}

export interface BillingSettings {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  unsettledLimit: number;
}

// 브랜드 약관 동의 ------------------------------------------------------------

/** none=동의 전 · agreed=지금 약관에 동의 · outdated=이전 약관에만 동의(재동의 필요) */
export type TermsState = 'none' | 'agreed' | 'outdated';

export interface TermsAgreement {
  id: string;
  businessUsername: string;
  termsVersion: string;
  companyName: string;
  representative: string;
  businessNumber: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  unsettledLimit: number;
  paymentTerms: string;
  depositAccount: string;
  agreedAt: string | null;
}

export interface TermsInput {
  companyName: string;
  representative: string;
  businessNumber: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

export interface TermsSummary {
  /** 지금 버전 약관에 동의해 심사 요청이 가능한지. */
  valid: boolean;
  state: TermsState;
  currentVersion: string;
  agreement: TermsAgreement | null;
  terms: {
    version: string;
    sections: { title: string; body: string }[];
    unsettledLimit: number;
    paymentTerms: string;
    depositAccount: string;
  };
  /** 브랜드 응답에만: 입력 기본값. */
  defaults?: TermsInput;
}

export interface AdminBrandTerms extends Omit<TermsSummary, 'terms' | 'defaults'> {
  businessUsername: string;
  companyName: string;
  campaigns: number;
}

export interface ShopConnectionStatus {
  shopType: 'cafe24' | 'imweb';
  /** connected=연결됨 · reconnect=재연동 필요(토큰 만료·권한 부족) · none=미연결 · unavailable=준비 중 */
  state: 'connected' | 'reconnect' | 'none' | 'unavailable';
  mallId: string;
  shopName: string;
  shopDomain: string;
  /** 연동에 필요한 권한 중 빠진 것(재연동 사유). */
  missingScopes: string[];
  script: {
    /** auto=ScriptTags 로 자동 설치됨 · manual=브랜드가 직접 붙임 · none=미설치 */
    mode: 'auto' | 'manual' | 'none';
    installedAt: string | null;
    lastError: string;
    /** 수동 설치용 코드(전체 페이지 공통 영역에 붙인다). */
    snippet: string;
  };
  /** 최근 24시간 동안 이 몰에서 주문 신호를 받은 건수와 마지막 수신 시각. */
  received24h: number;
  lastReceivedAt: string | null;
  /** 최근 24시간 추적 링크 클릭(몰로 보낸 방문) 수. 수신 0건 판단을 돕는다. */
  clicks24h: number;
}

export interface ShopConnectionResponse {
  connections: ShopConnectionStatus[];
  /** 카페24 연동(OAuth) 시작 경로(/api/cafe24-oauth-start). */
  cafe24ConnectUrl: string;
  /** 간편결제 등 추적 한계 안내 문구(화면에 그대로 보여 준다). */
  trackingNotice: string;
  error?: string;
}

export interface ShopProduct {
  shopProductId: string;
  name: string;
  price: number;
  imageUrl: string;
  productUrl: string;
  selling: boolean;
  display: boolean;
}

export interface AffiliateProduct {
  id: string;
  shopProductId: string;
  name: string;
  price: number;
  imageUrl: string;
  productUrl: string;
  active: boolean;
}

export interface AffiliateCampaign {
  id: string;
  businessUsername: string;
  companyName: string;
  shopType: 'cafe24' | 'imweb';
  mallId: string;
  title: string;
  description: string;
  category: string;
  /** 브랜드가 내는 총 수수료율(%). 브랜드·운영 응답에만 실린다. */
  commissionRate?: number;
  /** 등록 시점에 고정된 플랫폼 수수료율(%). 브랜드·운영 응답에만 실린다. */
  platformRate?: number;
  /** 인플루언서 몫(%) = 총 수수료율 − 플랫폼 수수료율. 모든 응답에 실린다. */
  creatorRate: number;
  startDate: string;
  endDate: string;
  joinMode: AffiliateJoinMode;
  sampleOffered: boolean;
  sampleNote: string;
  followerDiscount: string;
  contentGuide: string;
  bannedPhrases: string;
  /** 자동 포함되는 광고 표기 안내 문구. */
  disclosureText: string;
  status: AffiliateCampaignStatus;
  rejectReason: string;
  products: AffiliateProduct[];
  createdAt: string;
  /** 브랜드 목록 응답에만: 신청 대기 · 승인 인원 · 간단 성과. */
  counts?: { pending: number; approved: number; clicks: number; orders: number; sales: number; cancelled: number };
  /** 인플루언서 둘러보기 응답에만: 내 참여 상태. */
  myParticipation?: { id: string; status: ParticipationStatus } | null;
}

export interface CreateAffiliateCampaignInput {
  mallId: string;
  companyName: string;
  title: string;
  description: string;
  category: string;
  commissionRate: number;
  startDate: string;
  endDate: string;
  joinMode: AffiliateJoinMode;
  sampleOffered: boolean;
  sampleNote: string;
  followerDiscount: string;
  contentGuide: string;
  bannedPhrases: string;
  products: { shopProductId: string; name: string; price: number; imageUrl: string; productUrl: string }[];
}

export interface AffiliateLink {
  code: string;
  productId: string;
  productName: string;
  productImage: string;
  price: number;
  /** 공유용 추적 링크(https://picks-folio.com/go/{code}). 스토리·DM 에 그대로 쓴다. */
  url: string;
  status: 'active' | 'paused' | 'revoked';
}

export interface Participation {
  id: string;
  campaignId: string;
  influencerUsername: string;
  message: string;
  /** 신청할 때 적은 성함 · 연락처(브랜드 · 본인 응답). */
  applicantName?: string;
  applicantContact?: string;
  /** 신청할 때 남긴 틱톡 · 유튜브 등 다른 채널 링크. */
  channelLinks?: ChannelLink[];
  status: ParticipationStatus;
  rejectReason: string;
  decidedAt: string | null;
  createdAt: string;
  /** 인플루언서 본인 응답에만. */
  campaign?: AffiliateCampaign;
  links?: AffiliateLink[];
  /** 브랜드 신청자 목록 응답에만: 채널 요약. */
  profile?: {
    displayName: string;
    profileImage: string;
    followers: number;
    instagramHandle?: string;
    instagramUrl: string;
    category: string;
  };
}

/** 판매 캠페인 신청 자격. 브랜드 매칭받기 등록 + 인스타 연동이 모두 있어야 한다. */
export interface AffiliateEligibility {
  registered: boolean;
  instagramConnected: boolean;
  eligible: boolean;
  /** 매칭받기 등록서의 성함 · 연락처. 신청서 기본값으로 쓴다. */
  name: string;
  contact: string;
  links: ChannelLink[];
  instagram: { handle: string; url: string; profileImage: string; followers: number } | null;
}

export type ChannelLinkType = 'tiktok' | 'youtube' | 'other';
export interface ChannelLink {
  type: ChannelLinkType;
  url: string;
}

export const CHANNEL_LINK_LABEL: Record<ChannelLinkType, string> = {
  tiktok: '틱톡',
  youtube: '유튜브',
  other: '기타',
};

export interface StatRow {
  key: string;
  label: string;
  imageUrl?: string;
  clicks: number;
  orders: number;
  sales: number;
  cancelled: number;
  /** 인플루언서 응답: 예정 · 확정 · 정산 완료 수수료(인플루언서 몫). 브랜드 응답: 브랜드 부담 수수료. */
  pendingFee: number;
  confirmedFee: number;
  settledFee: number;
  excludedFee: number;
}

export interface AffiliateStats {
  totals: StatRow;
  byProduct: StatRow[];
  /** 브랜드 응답에만: 인플루언서별 판매 순위(매출 순). */
  byInfluencer?: StatRow[];
  /** 브랜드 응답에만: 캠페인별 요약. */
  byCampaign?: StatRow[];
  /** 들어왔지만 아직 쇼핑몰에서 결제가 확인되지 않은 주문 수(위 집계에는 빠져 있다). */
  waiting?: { orders: number; awaitingPayment: number };
}

export interface AffiliateOrder {
  id: string;
  /** 주문번호는 일부를 가려서 내려온다(운영 콘솔은 전체). */
  orderNo: string;
  campaignId: string;
  campaignTitle: string;
  influencerUsername: string;
  orderedAt: string | null;
  commissionBase: number;
  refundedAmount: number;
  /** 화면 표시 상태. */
  commissionStatus: CommissionStatus;
  /** 보는 사람 기준 수수료(브랜드=부담액, 인플루언서=몫, 운영=셋 다). */
  fee: number;
  brandFee?: number;
  platformFee?: number;
  influencerFee?: number;
  verification: 'unverified' | 'verified' | 'failed';
  reason: string;
}

export type BatchStatus = 'draft' | 'brand_approved' | 'paid_in' | 'completed';

export interface SettlementLine {
  id: string;
  influencerUsername: string;
  salesAmount: number;
  brandFee: number;
  platformFee: number;
  influencerGross: number;
  incomeTax: number;
  localTax: number;
  withholding: number;
  influencerNet: number;
  status: 'pending' | 'paid';
  paidAt: string | null;
  /** 운영 콘솔에만: 지급 정보 제출 여부와 가린 요약. 원문은 revealPayoutAccount 로 연다. */
  payoutAccount?: { submitted: boolean; legalName: string; rrnMasked: string; bankName: string; accountTail: string };
}

export interface SettlementBatch {
  id: string;
  period: string;
  businessUsername: string;
  companyName: string;
  status: BatchStatus;
  totalSales: number;
  brandFee: number;
  vat: number;
  billedTotal: number;
  platformFee: number;
  influencerGross: number;
  brandApprovedAt: string | null;
  paidInAt: string | null;
  paidInAmount: number;
  /** 운영자가 확인한 실제 입금일(YYYY-MM-DD). */
  paidInDate: string | null;
  paidInBy: string;
  paidInMemo: string;
  /** 입금 기한: 정산월 다음 달 15일. */
  dueDate: string;
  /** 기한이 지났는데 입금 확인 전. */
  overdue: boolean;
  /** 인플루언서 지급 예정일: 정산월 다음 달 말일. */
  creatorPayoutDate: string;
  invoiceNo: string;
  memo: string;
  orderCount: number;
  lines: SettlementLine[];
}

/** 브랜드가 청구 금액을 보내는 픽스폴리오 계좌. */
export interface DepositAccount {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

/** 판매 수수료 지급 정보. 성명 · 주민등록번호 · 계좌만 받는다(신분증 사본 없음). */
export interface PayoutAccount {
  /** 성명 = 원천징수 신고 이름 = 예금주 */
  legalName: string;
  /** 서버는 주민등록번호 원문을 돌려주지 않는다. '900101-1******' 꼴. */
  rrnMasked: string;
  bankName: string;
  accountNumber: string;
  submittedAt: string | null;
  /** 협업 정산에서 낸 계좌로 미리 채운 값인지(주민등록번호는 비어 있다). */
  prefilled?: boolean;
}

export interface PayoutAccountInput {
  legalName: string;
  /** 비우면 이미 낸 번호를 그대로 둔다. */
  rrn: string;
  bankName: string;
  accountNumber: string;
}

// ───────────────────────────── 공통 ─────────────────────────────

type Result<T> = T & { error?: string };

async function call<T>(
  method: string,
  url: string,
  body?: unknown,
  token?: string,
): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: await collabHeaders(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ...(json || {}), error: json?.error || '요청을 처리하지 못했습니다.' } as Result<T>;
    return json as Result<T>;
  } catch (e) {
    console.error(`[affiliate] ${method} ${url.split('?')[0]} failed:`, e);
    return { error: '네트워크 오류가 발생했습니다.' } as Result<T>;
  }
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : '';
};

// ───────────────────────────── API ─────────────────────────────

export const affiliateService = {
  // 플랫폼 설정 -------------------------------------------------------------
  /** 누구나 읽을 수 있다(등록 화면이 인플루언서 몫을 계산해 보여 준다). token 을 넘기면 변경 이력까지 온다. */
  getPlatformSettings(token?: string) {
    return call<{ settings: PlatformSettings }>('GET', `/api/platform-settings${token ? '?history=1' : ''}`, undefined, token);
  },
  /** 운영자 전용. */
  updatePlatformSettings(
    token: string,
    patch: { platformRate?: number; autoConfirmDays?: number } & Partial<BillingSettings>,
  ) {
    return call<{ settings: PlatformSettings }>('PUT', '/api/platform-settings', patch, token);
  },

  // 브랜드 약관 동의 --------------------------------------------------------
  getTerms() {
    return call<TermsSummary>('GET', '/api/affiliate-terms');
  },
  agreeTerms(input: TermsInput) {
    return call<TermsSummary>('POST', '/api/affiliate-terms', { ...input, agree: true });
  },
  /** 운영 콘솔: 브랜드별 약관 동의 상태. */
  listTermsForAdmin(token: string) {
    return call<{ brands: AdminBrandTerms[]; currentVersion: string }>('GET', '/api/affiliate-terms?scope=admin', undefined, token);
  },

  // 쇼핑몰 연동(브랜드) ------------------------------------------------------
  getShopConnections() {
    return call<ShopConnectionResponse>('GET', '/api/shop-connection');
  },
  /** install_script: ScriptTags 자동 설치 · remove_script: 제거 · mark_manual: 직접 붙였다고 표시 */
  shopConnectionAction(action: 'install_script' | 'remove_script' | 'mark_manual', mallId: string) {
    return call<{ connection: ShopConnectionStatus }>('POST', '/api/shop-connection', { action, mallId });
  },
  /**
   * 카페24 연동 시작. 로그인 확인 후 1회용 state 를 발급받아 이동할 주소(url)를 돌려준다.
   * launch 는 카페24 관리자에서 앱을 실행했을 때 서버가 넘겨준 서명 값이다.
   * 이미 문제없이 연결된 몰을 앱에서 다시 열면 alreadyConnected 만 온다.
   */
  startCafe24Connect(input: { mallId?: string; launch?: string }) {
    return call<{ url?: string; alreadyConnected?: boolean; mallId?: string; code?: string }>(
      'POST',
      '/api/cafe24-oauth-start',
      input.launch ? { launch: input.launch } : { mall_id: input.mallId },
    );
  },
  /** 연동 해제: 추적 스크립트 제거 → 카페24 토큰 폐기 → 연결 해제. */
  disconnectShop(mallId: string) {
    return call<{ disconnected: boolean; mallId: string; scriptRemoved: boolean }>(
      'POST',
      '/api/shop-connection',
      { action: 'disconnect', mallId },
    );
  },
  listShopProducts(mallId: string, opts: { q?: string; offset?: number } = {}) {
    return call<{ products: ShopProduct[]; hasMore: boolean }>(
      'GET',
      `/api/shop-connection/products${qs({ mallId, q: opts.q, offset: opts.offset })}`,
    );
  },

  // 캠페인 -----------------------------------------------------------------
  /** 인플루언서 둘러보기: 모집 중인 판매 캠페인(인플루언서 몫 수수료율만 보인다). */
  browseCampaigns(opts: { category?: string; q?: string } = {}) {
    return call<{ campaigns: AffiliateCampaign[] }>('GET', `/api/affiliate-campaigns${qs({ scope: 'browse', ...opts })}`);
  },
  /** 브랜드: 내 판매 캠페인. */
  listMyCampaigns() {
    return call<{ campaigns: AffiliateCampaign[] }>('GET', '/api/affiliate-campaigns?scope=brand');
  },
  /** 운영 콘솔: 전체(상태 필터). */
  listCampaignsForAdmin(token: string, status?: AffiliateCampaignStatus | 'all') {
    return call<{ campaigns: AffiliateCampaign[] }>('GET', `/api/affiliate-campaigns${qs({ scope: 'admin', status })}`, undefined, token);
  },
  getCampaign(id: string, scope: 'browse' | 'brand' | 'admin' = 'browse', token?: string) {
    return call<{ campaign: AffiliateCampaign }>('GET', `/api/affiliate-campaigns/${encodeURIComponent(id)}${qs({ scope })}`, undefined, token);
  },
  createCampaign(input: CreateAffiliateCampaignInput) {
    return call<{ campaign: AffiliateCampaign }>('POST', '/api/affiliate-campaigns', input);
  },
  /** 브랜드: 반려된 캠페인 수정 후 재심사 요청(수수료율·상품 포함), 또는 판매 종료. */
  updateCampaign(id: string, patch: Partial<CreateAffiliateCampaignInput> & { action: 'resubmit' | 'end' }) {
    return call<{ campaign: AffiliateCampaign }>('PATCH', `/api/affiliate-campaigns/${encodeURIComponent(id)}`, patch);
  },
  /** 운영 콘솔: 승인 / 반려. */
  reviewCampaign(token: string, id: string, action: 'approve' | 'reject', reason = '') {
    return call<{ campaign: AffiliateCampaign }>('PATCH', `/api/affiliate-campaigns/${encodeURIComponent(id)}`, { action, reason }, token);
  },

  // 참여 -------------------------------------------------------------------
  /** 인플루언서: 내 참여 목록(링크 포함). */
  myParticipations() {
    return call<{ participations: Participation[] }>('GET', '/api/affiliate-participations?scope=mine');
  },
  /** 브랜드: 캠페인 신청자. */
  campaignParticipants(campaignId: string) {
    return call<{ participations: Participation[] }>('GET', `/api/affiliate-participations${qs({ scope: 'brand', campaignId })}`);
  },
  /** 인플루언서: 신청 자격과 신청서 기본값(성함 · 연락처 · 연동한 인스타 프로필). */
  eligibility() {
    return call<AffiliateEligibility>('GET', '/api/affiliate-participations?scope=eligibility');
  },
  apply(campaignId: string, applicant: { message?: string; name: string; contact: string; links?: ChannelLink[] }) {
    return call<{ participation: Participation }>('POST', '/api/affiliate-participations', { campaignId, ...applicant });
  },
  /** 브랜드: approve / reject / revoke(참여 중단). */
  decideParticipation(id: string, action: 'approve' | 'reject' | 'revoke', reason = '') {
    return call<{ participation: Participation }>('PATCH', `/api/affiliate-participations/${encodeURIComponent(id)}`, { action, reason });
  },
  /** 인플루언서: 신청 취소 · 판매 중단. */
  updateMyParticipation(id: string, action: 'cancel') {
    return call<{ participation: Participation }>('PATCH', `/api/affiliate-participations/${encodeURIComponent(id)}`, { action });
  },

  // 성과 · 주문 -------------------------------------------------------------
  /** scope=brand(campaignId 선택) · creator. 기간은 YYYY-MM-DD. */
  getStats(scope: 'brand' | 'creator', opts: { campaignId?: string; from?: string; to?: string } = {}) {
    return call<AffiliateStats>('GET', `/api/affiliate-stats${qs({ scope, ...opts })}`);
  },
  listOrders(
    scope: 'brand' | 'creator' | 'admin',
    opts: { campaignId?: string; status?: CommissionStatus | 'all'; verification?: 'unverified' | 'failed'; limit?: number; offset?: number } = {},
    token?: string,
  ) {
    return call<{ orders: AffiliateOrder[]; hasMore: boolean }>('GET', `/api/affiliate-orders${qs({ scope, ...opts })}`, undefined, token);
  },
  /** 운영 콘솔: 미검증 주문을 카페24 에서 다시 조회. */
  reverifyOrder(token: string, orderId: string) {
    return call<{ order: AffiliateOrder }>('PATCH', '/api/affiliate-orders', { action: 'reverify', orderId }, token);
  },

  // 정산 -------------------------------------------------------------------
  /** brand: 내 월별 청구서 · admin: 전체(기간 필터) · creator: 내 지급 내역. */
  listSettlements(scope: 'brand' | 'admin' | 'creator', opts: { period?: string; status?: BatchStatus } = {}, token?: string) {
    return call<{ batches: SettlementBatch[]; depositAccount?: DepositAccount | null }>(
      'GET',
      `/api/affiliate-settlements${qs({ scope, ...opts })}`,
      undefined,
      token,
    );
  },
  /** 브랜드: 청구서 확인·승인. */
  approveBatch(batchId: string) {
    return call<{ batch: SettlementBatch }>('PATCH', '/api/affiliate-settlements', { action: 'brand_approve', batchId });
  },
  /** 운영 콘솔: 지급 정보 원문 열람(열람 기록이 남는다). */
  revealPayoutAccount(token: string, lineId: string) {
    return call<{ account: { legalName: string; rrn: string; bankName: string; accountNumber: string } }>(
      'PATCH',
      '/api/affiliate-settlements',
      { action: 'reveal_account', lineId },
      token,
    );
  },
  /** 운영 콘솔: 입금 확인 · 인플루언서 지급 · 메모 · 월 마감 수동 실행. */
  adminSettlementAction(
    token: string,
    action: 'mark_paid_in' | 'pay_line' | 'save_memo' | 'run_close',
    payload: {
      batchId?: string;
      lineId?: string;
      amount?: number;
      /** mark_paid_in: 실제 입금일(YYYY-MM-DD) */
      paidDate?: string;
      memo?: string;
      invoiceNo?: string;
      period?: string;
    },
  ) {
    return call<{ batch?: SettlementBatch; batches?: SettlementBatch[]; created?: number }>(
      'PATCH',
      '/api/affiliate-settlements',
      { action, ...payload },
      token,
    );
  },

  // 지급 계좌(인플루언서) -----------------------------------------------------
  getPayoutAccount() {
    return call<{ account: PayoutAccount | null }>('GET', '/api/affiliate-payout-account');
  },
  savePayoutAccount(input: PayoutAccountInput) {
    return call<{ account: PayoutAccount }>('PUT', '/api/affiliate-payout-account', input);
  },
};

/** 화면 공통 라벨. */
export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  pending: '예정',
  confirmed: '확정',
  excluded: '제외',
  settled: '정산 완료',
  unverified: '미검증',
};

/** 성과 화면의 "아직 집계 전 주문" 안내 문구. */
export const waitingText = (w: { orders: number; awaitingPayment: number }) =>
  w.awaitingPayment > 0
    ? `확인 대기 주문 ${w.orders.toLocaleString('ko-KR')}건 (무통장 입금 대기 ${w.awaitingPayment.toLocaleString('ko-KR')}건) — 쇼핑몰에서 결제가 확인되면 1시간 안에 위 집계에 더해집니다.`
    : `확인 대기 주문 ${w.orders.toLocaleString('ko-KR')}건 — 쇼핑몰 주문 API 로 확인되면 위 집계에 더해집니다.`;

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  draft: '브랜드 확인 대기',
  brand_approved: '입금 대기',
  paid_in: '입금 확인 · 지급 중',
  completed: '지급 완료',
};

export const PARTICIPATION_STATUS_LABEL: Record<ParticipationStatus, string> = {
  pending: '승인 대기',
  approved: '판매 중',
  rejected: '거절됨',
  revoked: '참여 중단',
  cancelled: '취소함',
};

/** 원 단위 표기. */
export const won = (n: number) => `₩${Math.round(Number(n) || 0).toLocaleString('ko-KR')}`;

export const TERMS_STATE_LABEL: Record<TermsState, string> = {
  none: '미동의',
  agreed: '동의 완료',
  outdated: '재동의 필요',
};

/** 인플루언서 지급 일정 안내(참여 신청 · 협업 캠페인 화면 공통). */
export const CREATOR_PAYOUT_NOTICE = '판매 수수료는 이번 달 확정된 수익을 정산해 다음 달 말일에 지급됩니다.';

/** 'YYYY-MM-DD' → 'M월 D일'. */
export const monthDay = (ymd: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : '';
};

/** 'YYYY-MM' 정산월의 인플루언서 지급 예정일(다음 달 말일) → 'M월 D일'. */
export const creatorPayoutLabel = (period: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return '';
  const month = Number(m[2]);
  const next = month === 12 ? 1 : month + 1;
  const last = new Date(Date.UTC(Number(m[1]), month + 1, 0)).getUTCDate();
  return `${next}월 ${last}일`;
};
