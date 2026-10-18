/**
 * 판매 연동형 캠페인의 브랜드 약관 동의와 입금 조건.
 *
 * 결제는 브랜드 자사몰에서 끝나고, 픽스폴리오는 월 청구서로 수수료를 받는다. 카드
 * 자동결제가 없으니 "언제까지 · 얼마를 · 어디로" 보낸다는 조건에 브랜드가 동의해야 한다.
 * 브랜드는 판매 캠페인을 심사 요청하기 전에 판매 수수료 이용약관에 동의한다
 * (api-affiliate-campaigns 가 termsGate 로 막는다).
 *
 * 약관 문안을 바꾸면 TERMS_VERSION 을 올린다. 이전 버전에 동의한 브랜드는 진행 중인
 * 캠페인은 그대로 두고, 다음 캠페인을 등록할 때 새 약관에 다시 동의한다.
 */
import { hashValue, newId } from "./affiliate.mts";

/** 약관 문안 버전. 문안을 바꾸면 날짜를 올린다. */
export const TERMS_VERSION = "2026-10-18";

/** 정산월 다음 달 이 날짜까지 입금한다. */
export const PAYMENT_DUE_DAY = 15;
export const PAYMENT_TERMS_TEXT = `매월 말일 마감, 익월 ${PAYMENT_DUE_DAY}일까지 입금`;

// ── 설정 ──────────────────────────────────────────────────────────────────

export const BILLING_KEYS = {
  bankName: "deposit_bank_name",
  accountNumber: "deposit_account_number",
  accountHolder: "deposit_account_holder",
  unsettledLimit: "affiliate_unsettled_limit",
} as const;

export type BillingSettings = {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  /** 미정산 한도(원). 약관에 들어간다. 0 이면 아직 정하지 않은 것. */
  unsettledLimit: number;
};

export async function loadBillingSettings(db: any): Promise<BillingSettings> {
  try {
    const rows = (await db.sql`
      SELECT key, value FROM platform_settings WHERE key = ANY(${Object.values(BILLING_KEYS)}::text[])
    `) as any[];
    const v = new Map(rows.map((r) => [r.key, String(r.value || "")]));
    return {
      bankName: v.get(BILLING_KEYS.bankName) || "",
      accountNumber: v.get(BILLING_KEYS.accountNumber) || "",
      accountHolder: v.get(BILLING_KEYS.accountHolder) || "",
      unsettledLimit: Math.max(0, Math.round(Number(v.get(BILLING_KEYS.unsettledLimit) || 0)) || 0),
    };
  } catch {
    return { bankName: "", accountNumber: "", accountHolder: "", unsettledLimit: 0 };
  }
}

export const depositAccountText = (b: BillingSettings) =>
  b.bankName && b.accountNumber ? `${b.bankName} ${b.accountNumber} (예금주 ${b.accountHolder || "-"})` : "";

// ── 날짜 ──────────────────────────────────────────────────────────────────

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** 'YYYY-MM' 정산월의 브랜드 입금 기한: 다음 달 15일. */
export function paymentDueDate(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? ymd(y + 1, 1, PAYMENT_DUE_DAY) : ymd(y, m + 1, PAYMENT_DUE_DAY);
}

/** 'YYYY-MM' 정산월의 인플루언서 지급 예정일: 다음 달 말일. */
export function creatorPayoutDate(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m 은 1-based → 다음 달의 0일 = 다음 달 말일
  return m === 12 ? ymd(y + 1, 1, last) : ymd(y, m + 1, last);
}

// ── 약관 ──────────────────────────────────────────────────────────────────

/** 화면에 그대로 보여 주는 약관 조항. 지금 설정값(계좌 · 한도)이 문안에 들어간다. */
export function termsSections(b: BillingSettings): { title: string; body: string }[] {
  const account = depositAccountText(b) || "월 청구서에 안내되는 픽스폴리오 명의 계좌";
  const limit = b.unsettledLimit > 0 ? `${b.unsettledLimit.toLocaleString("ko-KR")}원` : "픽스폴리오가 별도로 안내하는 금액";
  return [
    {
      title: "제1조 (목적)",
      body: "이 약관은 브랜드가 픽스폴리오의 판매 연동형(어필리에이트) 캠페인을 이용하면서 인플루언서 판매에 대한 수수료를 정산 · 지급하는 조건을 정합니다.",
    },
    {
      title: "제2조 (결제와 판매 집계)",
      body: "상품 결제는 브랜드 자사몰에서 이루어집니다. 픽스폴리오는 추적 링크로 유입된 주문을 자사몰 주문 API로 확인해 집계하며, 구매확정(또는 배송완료 후 정해진 기간 경과)된 주문만 수수료 대상으로 봅니다. 취소 · 반품된 주문은 제외하고, 마감 뒤 발생한 반품은 다음 달 청구에서 차감합니다.",
    },
    {
      title: "제3조 (수수료와 청구)",
      body: "수수료는 확정된 판매액에 캠페인 등록 시 정한 수수료율을 곱한 금액이며, 부가가치세는 별도입니다. 픽스폴리오는 매월 말일에 마감해 브랜드별 월 청구서를 발행하고, 브랜드는 청구서 내용을 확인 · 승인합니다.",
    },
    {
      title: "제4조 (입금)",
      body: `브랜드는 정산월 다음 달 ${PAYMENT_DUE_DAY}일까지 청구 합계(수수료 + 부가가치세)를 ${account}로 입금합니다. 입금자명은 상호로 합니다. 픽스폴리오는 입금을 확인한 뒤 인플루언서에게 수수료를 지급합니다.`,
    },
    {
      title: "제5조 (미정산 한도와 연체)",
      body: `입금되지 않은 청구 금액의 합계는 ${limit}을 넘을 수 없습니다. 입금 기한이 지나거나 미정산 금액이 한도를 넘으면 픽스폴리오는 새 캠페인 심사와 진행 중인 캠페인의 판매 링크를 멈출 수 있으며, 연체된 금액은 계속 청구됩니다.`,
    },
    {
      title: "제6조 (약관 변경)",
      body: "픽스폴리오가 이 약관을 바꾸면 브랜드는 다음 판매 캠페인을 등록할 때 바뀐 약관에 다시 동의해야 합니다. 이미 진행 중인 캠페인은 동의 당시의 조건을 따릅니다.",
    },
  ];
}

export type TermsInput = {
  companyName: string;
  representative: string;
  businessNumber: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
};

const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);

export function shapeAgreement(a: any) {
  if (!a) return null;
  return {
    id: String(a.id),
    businessUsername: String(a.business_username),
    termsVersion: String(a.terms_version || ""),
    companyName: String(a.company_name || ""),
    representative: String(a.representative || ""),
    businessNumber: String(a.business_number || ""),
    contactName: String(a.contact_name || ""),
    contactPhone: String(a.contact_phone || ""),
    contactEmail: String(a.contact_email || ""),
    unsettledLimit: Number(a.unsettled_limit || 0),
    paymentTerms: String(a.payment_terms || ""),
    depositAccount: String(a.deposit_account || ""),
    agreedAt: iso(a.agreed_at),
  };
}

/**
 * 브랜드의 약관 동의 요약.
 *   valid    지금 버전에 동의했다(심사 요청 가능)
 *   state    none(동의 전) · agreed · outdated(이전 버전에만 동의 — 재동의 필요)
 */
export async function termsSummary(db: any, business: string) {
  const rows = (await db.sql`
    SELECT * FROM affiliate_brand_terms_agreements WHERE business_username = ${business}
    ORDER BY agreed_at DESC LIMIT 20
  `) as any[];
  const current = rows.find((r) => r.terms_version === TERMS_VERSION) || null;
  const latest = rows[0] || null;
  const billing = await loadBillingSettings(db);
  return {
    valid: Boolean(current),
    state: current ? "agreed" : latest ? "outdated" : "none",
    currentVersion: TERMS_VERSION,
    agreement: shapeAgreement(current || latest),
    terms: {
      version: TERMS_VERSION,
      sections: termsSections(billing),
      unsettledLimit: billing.unsettledLimit,
      paymentTerms: PAYMENT_TERMS_TEXT,
      depositAccount: depositAccountText(billing),
    },
  };
}

/** 심사 요청 전에 부른다. 지금 버전 약관에 동의하지 않았으면 막는다. */
export async function termsGate(db: any, business: string): Promise<Response | null> {
  const rows = (await db.sql`
    SELECT terms_version FROM affiliate_brand_terms_agreements WHERE business_username = ${business}
    ORDER BY agreed_at DESC LIMIT 20
  `) as any[];
  if (rows.some((r) => r.terms_version === TERMS_VERSION)) return null;
  return Response.json(
    {
      error: rows.length
        ? "판매 수수료 이용약관이 바뀌었습니다. 새 약관에 동의한 뒤 심사를 요청할 수 있습니다."
        : "판매 캠페인 심사를 요청하려면 먼저 판매 수수료 이용약관에 동의해 주세요.",
      code: "terms_required",
    },
    { status: 409 },
  );
}

/** 지금 버전 약관 동의를 기록한다. 동의 당시 조건(한도 · 계좌)을 함께 남긴다. */
export async function recordAgreement(db: any, business: string, input: TermsInput, ip: string) {
  const billing = await loadBillingSettings(db);
  await db.sql`
    INSERT INTO affiliate_brand_terms_agreements
      (id, business_username, terms_version, company_name, representative, business_number,
       contact_name, contact_phone, contact_email, unsettled_limit, payment_terms, deposit_account, ip_hash)
    VALUES (${newId("abt")}, ${business}, ${TERMS_VERSION}, ${input.companyName}, ${input.representative},
      ${input.businessNumber}, ${input.contactName}, ${input.contactPhone}, ${input.contactEmail},
      ${billing.unsettledLimit}, ${PAYMENT_TERMS_TEXT}, ${depositAccountText(billing)}, ${ip ? hashValue(ip) : ""})
  `;
}
