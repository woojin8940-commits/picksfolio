import { collabHeaders } from './apiService';

/**
 * 어필리에이트 스토어 정산(계좌 등록 · 지급 신청 · 운영자 지급 처리) API.
 * 서버: netlify/functions/api-affiliate-payouts.mts
 *
 * 주민등록번호 · 계좌번호 원문은 저장할 때 한 번 보내기만 하고, 서버는 가린 값만 돌려준다.
 */

export type PayoutParty = 'brand' | 'influencer';
export type PayoutStatus = 'requested' | 'paid' | 'rejected' | 'cancelled';

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  requested: '지급 대기',
  paid: '지급 완료',
  rejected: '반려',
  cancelled: '신청 취소',
};
export const PAYOUT_STATUS_STYLE: Record<PayoutStatus, string> = {
  requested: 'bg-amber-50 text-amber-600',
  paid: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-red-50 text-red-500',
  cancelled: 'bg-slate-100 text-slate-400',
};

export interface PayoutRequest {
  id: string;
  partyType: PayoutParty;
  party: string;
  status: PayoutStatus;
  orderAmount: number;
  deductionAmount: number;
  grossAmount: number;
  incomeTax: number;
  localTax: number;
  netAmount: number;
  scheduledDate: string;
  legalName: string;
  bankName: string;
  accountMasked: string;
  accountHolder: string;
  holderMismatch: boolean;
  payoutMethod: string;
  requestedAt: string;
  paidAt: string | null;
  paidDate: string;
  paidBy: string;
  rejectedAt: string | null;
  rejectReason: string;
  cancelledAt: string | null;
  items: { orderId: string; productName: string; amount: number; confirmedAt: string | null }[];
  deductions: { orderId: string; amount: number; reason: string; createdAt: string }[];
  displayName?: string;
}

export interface InfluencerPayoutAccount {
  legalName: string;
  rrnMasked: string;
  bankName: string;
  accountMasked: string;
  accountHolder: string;
  privacyConsentedAt: string | null;
  submittedAt: string;
  updatedAt: string;
}
export interface BrandPayoutAccount {
  bankName: string;
  accountMasked: string;
  accountHolder: string;
  hasBankbook: boolean;
  taxInvoiceEmail: string;
  holderMismatch: boolean;
  submittedAt: string;
  updatedAt: string;
}

export interface PayoutSummary {
  available: number;
  availableOrderAmount: number;
  availableDeductionAmount: number;
  availableOrders: { id: string; productName: string; amount: number; confirmedAt: string | null }[];
  availableDeductions: { id: number; orderId: string; amount: number; reason: string; createdAt: string }[];
  pending: number;
  pendingCount: number;
  requested: number;
  requestedNet: number;
  requestedCount: number;
  paidGross: number;
  paid: number;
}

export interface PartyPayoutData {
  partyType: PayoutParty;
  account: InfluencerPayoutAccount | BrandPayoutAccount | null;
  summary: PayoutSummary;
  preview: { gross: number; incomeTax: number; localTax: number; net: number } | null;
  requests: PayoutRequest[];
  minAmount: number;
  nextScheduledDate: string;
  banks: string[];
  brandNames: { businessName: string; ceoName: string } | null;
}

export interface AdminPayoutData {
  requests: PayoutRequest[];
  settings: { minInfluencer: number; minBrand: number };
  waiting: Partial<Record<PayoutParty, number>>;
  scheduledDates: string[];
  nextScheduledDate: string;
}

/** 원천징수 3.3% 계산(화면 미리 보기용 — 서버와 같은 식). */
export function withholdingPreview(gross: number) {
  const g = Math.max(0, Math.floor(gross || 0));
  const incomeTax = Math.floor((g * 3) / 100);
  const localTax = Math.floor(incomeTax / 10);
  return { gross: g, incomeTax, localTax, net: g - incomeTax - localTax };
}

/** 'YYYY-MM-DD' → '2026년 12월 10일 (목)' */
export function scheduleText(date: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return date || '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  return `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일 (${wd})`;
}

type Result<T> = T & { error?: string; code?: string };
const URL_BASE = '/api/affiliate-payouts';

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
  } catch {
    return { error: '네트워크 오류가 발생했습니다.' } as Result<T>;
  }
}

/** 인증 헤더를 붙여 파일(CSV · 이미지)을 받는다. */
async function fetchBlob(url: string, opts: { token?: string; account?: string } = {}): Promise<{ blob?: Blob; filename?: string; error?: string }> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', headers: await collabHeaders(opts.token, opts.account ? { account: opts.account } : {}) });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { error: json?.error || '파일을 받지 못했습니다.' };
    }
    const cd = res.headers.get('Content-Disposition') || '';
    const filename = /filename="([^"]+)"/.exec(cd)?.[1];
    return { blob: await res.blob(), filename };
  } catch {
    return { error: '네트워크 오류가 발생했습니다.' };
  }
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export const affiliatePayoutService = {
  get(as: PayoutParty, account?: string) {
    return call<PartyPayoutData>('GET', `${URL_BASE}?as=${as}`, undefined, { account });
  },
  saveInfluencerAccount(input: { legalName: string; rrn: string; bankName: string; accountNumber: string; accountHolder: string; privacyConsent: boolean }) {
    return call<{ account: InfluencerPayoutAccount }>('POST', URL_BASE, { as: 'influencer', action: 'save_account', ...input });
  },
  saveBrandAccount(account: string, input: { bankName: string; accountNumber: string; accountHolder: string; taxInvoiceEmail: string; bankbookImage?: string }) {
    return call<{ account: BrandPayoutAccount }>('POST', URL_BASE, { as: 'brand', action: 'save_account', ...input }, { account });
  },
  request(as: PayoutParty, account?: string) {
    return call<{ request: PayoutRequest }>('POST', URL_BASE, { as, action: 'request' }, { account });
  },
  cancel(as: PayoutParty, id: string, account?: string) {
    return call<{ ok: true }>('POST', URL_BASE, { as, action: 'cancel', id }, { account });
  },
  myBankbook(account: string) {
    return fetchBlob(`${URL_BASE}?as=brand&scope=bankbook`, { account });
  },

  // 운영자
  adminList(token: string, filter: { partyType?: PayoutParty; status?: PayoutStatus | ''; scheduledDate?: string } = {}) {
    const p = new URLSearchParams({ scope: 'admin' });
    for (const [k, v] of Object.entries(filter)) if (v) p.set(k, String(v));
    return call<AdminPayoutData>('GET', `${URL_BASE}?${p.toString()}`, undefined, { token });
  },
  adminAction(token: string, action: 'admin_mark_paid' | 'admin_reject' | 'admin_set_settings', payload: Record<string, unknown>) {
    return call<{ ok?: true; settings?: AdminPayoutData['settings'] }>('POST', URL_BASE, { action, ...payload }, { token });
  },
  adminViewRrn(token: string, username: string) {
    return call<{ rrn: string; legalName: string }>('POST', URL_BASE, { action: 'admin_view_rrn', username }, { token });
  },
  adminTransferCsv(token: string, scheduledDate: string) {
    return fetchBlob(`${URL_BASE}?scope=admin-transfer-csv&scheduledDate=${encodeURIComponent(scheduledDate)}`, { token });
  },
  adminWithholdingCsv(token: string, month: string) {
    return fetchBlob(`${URL_BASE}?scope=admin-withholding-csv&month=${encodeURIComponent(month)}`, { token });
  },
  adminBankbook(token: string, party: string) {
    return fetchBlob(`${URL_BASE}?scope=admin-bankbook&party=${encodeURIComponent(party)}`, { token });
  },
};
