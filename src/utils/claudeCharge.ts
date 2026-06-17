import { apiService } from '../services/apiService';
import { toAsciiSafeId } from './formatters';
import { isNativeApp } from './appEnv';
import { startTossCardPayment, startTossCardBilling } from './tossPayments';

// Digital-goods purchases (membership, Claude credits) are sold on the website
// only; the native app never triggers them. This message is a hard backstop in
// case any entry point is reached inside the app — the UI that opens these flows
// is already hidden there.
const NATIVE_BLOCK_MESSAGE = '이 결제는 앱에서 지원되지 않습니다.';


// Claude plan payments. Two flavours, both through PortOne V2:
//   • One-time payment (requestPayment) — used to ACTIVATE the Claude plan and to
//     manually RECHARGE the credit wallet. Verified server-side before credits
//     are granted (identical guarantee to the live-time top-up flow).
//   • Billing-key issue (requestIssueBillingKey) — used to register a payment
//     method for AUTO-RECHARGE, so the server can top the wallet back up without
//     a payment window when the balance runs low.
//
// storeId and channelKey are public browser identifiers; the V2 API secret lives
// server-side only.
const PORTONE_STORE_ID = 'store-1e85edf9-8f37-490c-9419-5a1f15db9ab5';
const PORTONE_TOSSPAY_CHANNEL_KEY = 'channel-key-4e4b5bcd-12b4-48b1-ac74-50e634d1a0e2';
const PORTONE_KAKAOPAY_CHANNEL_KEY = 'channel-key-0abb70ff-069a-4a4f-9939-5e0c60298182';

export type ClaudePayMethod = 'CARD' | 'TOSSPAY' | 'KAKAOPAY';

export const CLAUDE_PAY_METHODS: { id: ClaudePayMethod; label: string }[] = [
  { id: 'CARD', label: '토스페이먼츠' },
  { id: 'TOSSPAY', label: '토스페이' },
  { id: 'KAKAOPAY', label: '카카오페이' },
];

export interface ClaudePayOutcome {
  success: boolean;
  error?: string;
  result?: Awaited<ReturnType<typeof apiService.payClaudeCredits>>;
}

const channelFor = (m: ClaudePayMethod) =>
  m === 'KAKAOPAY' ? PORTONE_KAKAOPAY_CHANNEL_KEY : PORTONE_TOSSPAY_CHANNEL_KEY;

/**
 * Run a one-time PortOne payment for `amountKrw` (activation or recharge) and, on
 * success, confirm it server-side so the credits are granted. When `billingKey`
 * is supplied (captured separately), it is registered to enable auto-recharge.
 */
export async function payClaudePlan(
  username: string,
  kind: 'activation' | 'recharge',
  amountKrw: number,
  payMethod: ClaudePayMethod,
  billingKey?: string,
): Promise<ClaudePayOutcome> {
  if (isNativeApp()) {
    return { success: false, error: NATIVE_BLOCK_MESSAGE };
  }

  const orderName = kind === 'activation' ? '클로드 플랜 시작' : `클로드 크레딧 충전 ${amountKrw.toLocaleString()}원`;

  // 토스페이먼츠(카드) — PortOne 을 거치지 않고 토스페이먼츠 결제창으로 리다이렉트한다.
  // 돌아온 뒤 /toss/return 페이지가 크레딧 적립을 마무리한다.
  if (payMethod === 'CARD') {
    return startTossCardPayment({
      type: 'claude',
      username,
      kind,
      amountKrw,
      orderName,
      payMethod: 'CARD',
      returnPath: window.location.pathname + window.location.search,
    });
  }

  if (typeof window === 'undefined' || !window.PortOne) {
    return { success: false, error: '결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
  }

  const paymentId = `claude-${kind}-${toAsciiSafeId(username)}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  try {
    const response = await window.PortOne.requestPayment({
      storeId: PORTONE_STORE_ID,
      channelKey: channelFor(payMethod),
      paymentId,
      orderName,
      totalAmount: amountKrw,
      currency: 'KRW',
      payMethod: 'EASY_PAY',
      easyPay: { easyPayProvider: payMethod },
      customer: { customerId: toAsciiSafeId(username) },
    });

    if (!response || response.code) {
      return {
        success: false,
        error:
          response?.message ||
          (response?.code ? `결제 실패 (${response.code})` : '결제가 취소되었습니다.'),
      };
    }

    const result = await apiService.payClaudeCredits(username, {
      kind,
      amountKrw,
      paymentId: response.paymentId || paymentId,
      payMethod,
      billingKey,
    });
    if (!result.success) {
      return { success: false, error: result.error || '크레딧 적립에 실패했습니다.', result };
    }
    return { success: true, result };
  } catch (e) {
    console.error('[ClaudeCharge] payment error:', e);
    return { success: false, error: '결제 처리 중 오류가 발생했습니다. 다시 시도해 주세요.' };
  }
}

/**
 * Capture a PortOne billing key for auto-recharge. Returns the key string; the
 * caller passes it to the server (via payClaudePlan or setClaudeAutoRecharge) so
 * the wallet can be topped up automatically later.
 */
export async function issueClaudeBillingKey(
  username: string,
  payMethod: ClaudePayMethod,
): Promise<{ success: boolean; billingKey?: string; error?: string }> {
  if (isNativeApp()) {
    return { success: false, error: NATIVE_BLOCK_MESSAGE };
  }

  // 토스페이먼츠(카드) 자동충전 결제수단 등록 — 토스페이먼츠 빌링 인증창으로 리다이렉트한다.
  // 돌아온 뒤 /toss/return 페이지가 빌링키 발급·자동충전 설정을 마무리한다.
  if (payMethod === 'CARD') {
    return startTossCardBilling({
      type: 'claude-billing',
      username,
      orderName: '클로드 크레딧 자동충전 결제수단 등록',
      payMethod: 'CARD',
      returnPath: window.location.pathname + window.location.search,
    });
  }

  if (typeof window === 'undefined' || !window.PortOne) {
    return { success: false, error: '결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
  }

  const safeUserName = toAsciiSafeId(username);
  const issueId = `claudebilling-${safeUserName}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  try {
    const response = await window.PortOne.requestIssueBillingKey({
      storeId: PORTONE_STORE_ID,
      channelKey: channelFor(payMethod),
      billingKeyMethod: 'EASY_PAY',
      issueId,
      issueName: '클로드 크레딧 자동충전 결제수단 등록',
      currency: 'KRW',
      easyPay: { easyPayProvider: payMethod },
      customer: { customerId: safeUserName },
    });

    if (!response || response.code || !response.billingKey) {
      return {
        success: false,
        error:
          response?.message ||
          (response?.code ? `결제수단 등록 실패 (${response.code})` : '결제수단 등록이 취소되었습니다.'),
      };
    }
    return { success: true, billingKey: response.billingKey };
  } catch (e) {
    console.error('[ClaudeCharge] billing key error:', e);
    return { success: false, error: '결제수단 등록 중 오류가 발생했습니다. 다시 시도해 주세요.' };
  }
}
