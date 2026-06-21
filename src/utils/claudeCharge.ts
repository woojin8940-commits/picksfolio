import { apiService } from '../services/apiService';
import { toAsciiSafeId } from './formatters';
import { isNativeApp } from './appEnv';
import {
  PORTONE_STORE_ID,
  channelKeyFor,
  easyPayParam,
  portonePayMethod,
  portoneBillingKeyMethod,
  portoneRedirectUrl,
  savePortOneIntent,
  clearPortOneIntent,
  genPortOneId,
} from './portonePayments';

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
// server-side only. 카드(나이스정보통신) / 토스페이 / 카카오페이 모두 PortOne V2 리다이렉트
// 방식으로 호출한다(portonePayments).
export type ClaudePayMethod = 'CARD' | 'TOSSPAY' | 'KAKAOPAY';

export const CLAUDE_PAY_METHODS: { id: ClaudePayMethod; label: string }[] = [
  { id: 'CARD', label: '나이스정보통신' },
  { id: 'TOSSPAY', label: '토스페이' },
  { id: 'KAKAOPAY', label: '카카오페이' },
];

export interface ClaudePayOutcome {
  success: boolean;
  error?: string;
  result?: Awaited<ReturnType<typeof apiService.payClaudeCredits>>;
}

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

  if (typeof window === 'undefined' || !window.PortOne) {
    return { success: false, error: '결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
  }

  const paymentId = genPortOneId(`claude-${kind}`, username);
  // 카드(나이스정보통신) / 토스페이 / 카카오페이 모두 PortOne V2 로 처리한다.
  const ppMethod = payMethod;

  // 모두 리다이렉트 방식으로 호출한다. redirectUrl 을 넣어 결제창으로 페이지를 넘기고, 돌아온
  // /portone/return 페이지가 paymentId 로 서버 검증·크레딧 적립을 마무리한다. (PC 팝업으로
  // promise 가 resolve 되면 아래 인라인 처리도 동작한다.)
  savePortOneIntent({
    type: 'claude',
    username,
    payMethod: ppMethod,
    kind,
    amountKrw,
    orderName,
    returnPath: window.location.pathname + window.location.search,
  });

  try {
    const response = await window.PortOne.requestPayment({
      storeId: PORTONE_STORE_ID,
      channelKey: channelKeyFor(ppMethod),
      paymentId,
      orderName,
      totalAmount: amountKrw,
      currency: 'KRW',
      payMethod: portonePayMethod(ppMethod),
      redirectUrl: portoneRedirectUrl(),
      ...easyPayParam(ppMethod),
      customer: { customerId: toAsciiSafeId(username) },
    });

    if (!response || response.code) {
      clearPortOneIntent();
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
    clearPortOneIntent();
    if (!result.success) {
      return { success: false, error: result.error || '크레딧 적립에 실패했습니다.', result };
    }
    return { success: true, result };
  } catch (e) {
    clearPortOneIntent();
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

  // 카드(나이스정보통신) 자동충전 결제수단 등록 — 토스페이 / 카카오페이와 동일하게 PortOne
  // V2 빌링키 발급창으로 리다이렉트한다. 돌아온 뒤 /portone/return 페이지가 자동충전 설정을
  // 마무리한다.

  if (typeof window === 'undefined' || !window.PortOne) {
    return { success: false, error: '결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
  }

  const safeUserName = toAsciiSafeId(username);
  const issueId = genPortOneId('claudebilling', username);
  // 카드(나이스정보통신) / 토스페이 / 카카오페이 모두 PortOne V2 로 처리한다.
  const ppMethod = payMethod;

  // 모두 리다이렉트 방식으로 호출한다. redirectUrl 을 넣어 빌링 인증창으로 페이지를 넘기고,
  // 돌아온 /portone/return 페이지가 발급된 billingKey 로 자동충전을 켠다. (PC 팝업으로
  // promise 가 resolve 되면 아래 인라인 처리로 호출부가 billingKey 를 받아 처리한다.)
  savePortOneIntent({
    type: 'claude-billing',
    username,
    payMethod: ppMethod,
    orderName: '클로드 크레딧 자동충전 결제수단 등록',
    returnPath: window.location.pathname + window.location.search,
  });

  try {
    const response = await window.PortOne.requestIssueBillingKey({
      storeId: PORTONE_STORE_ID,
      channelKey: channelKeyFor(ppMethod),
      billingKeyMethod: portoneBillingKeyMethod(ppMethod),
      issueId,
      issueName: '클로드 크레딧 자동충전 결제수단 등록',
      currency: 'KRW',
      redirectUrl: portoneRedirectUrl(),
      ...easyPayParam(ppMethod),
      customer: { customerId: safeUserName },
    });

    if (!response || response.code || !response.billingKey) {
      clearPortOneIntent();
      return {
        success: false,
        error:
          response?.message ||
          (response?.code ? `결제수단 등록 실패 (${response.code})` : '결제수단 등록이 취소되었습니다.'),
      };
    }
    clearPortOneIntent();
    return { success: true, billingKey: response.billingKey };
  } catch (e) {
    clearPortOneIntent();
    console.error('[ClaudeCharge] billing key error:', e);
    return { success: false, error: '결제수단 등록 중 오류가 발생했습니다. 다시 시도해 주세요.' };
  }
}
