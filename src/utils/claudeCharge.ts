import { apiService } from '../services/apiService';
import { toAsciiSafeId } from './formatters';
import { isNativeApp } from './appEnv';
import {
  PORTONE_STORE_ID,
  channelKeyFor,
  easyPayParam,
  cardParam,
  isNiceCardConfigured,
  NICE_NOT_CONFIGURED_MESSAGE,
  portonePayMethod,
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


// Claude plan payments. A single one-time payment (requestPayment) through PortOne
// V2 is used to ACTIVATE the Claude plan and to manually RECHARGE the credit wallet.
// It is verified server-side before credits are granted (identical guarantee to the
// live-time top-up flow). The Claude plan is single-payment only — there is no
// auto/recurring billing (that is reserved for the membership tiers).
//
// storeId and channelKey are public browser identifiers; the V2 API secret lives
// server-side only. PG 심사 요건상 클로드 플랜은 간편결제 없이 카드 결제만 허용한다.
export type ClaudePayMethod = 'CARD';

export const CLAUDE_PAY_METHODS: { id: ClaudePayMethod; label: string }[] = [
  { id: 'CARD', label: '신용카드' },
];

export interface ClaudePayOutcome {
  success: boolean;
  error?: string;
  result?: Awaited<ReturnType<typeof apiService.payClaudeCredits>>;
}

/**
 * Run a one-time PortOne payment for `amountKrw` (activation or recharge) and, on
 * success, confirm it server-side so the credits are granted.
 */
export async function payClaudePlan(
  username: string,
  kind: 'activation' | 'recharge',
  amountKrw: number,
  payMethod: ClaudePayMethod,
): Promise<ClaudePayOutcome> {
  if (isNativeApp()) {
    return { success: false, error: NATIVE_BLOCK_MESSAGE };
  }

  const orderName = kind === 'activation' ? '클로드 플랜 시작' : `클로드 크레딧 충전 ${amountKrw.toLocaleString()}원`;

  if (typeof window === 'undefined' || !window.PortOne) {
    return { success: false, error: '결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
  }

  // 카드(나이스정보통신) 채널이 아직 연결되지 않았으면 PortOne 호출이 무조건 실패하므로,
  // 일반 오류 대신 원인을 분명히 알려준다.
  if (payMethod === 'CARD' && !isNiceCardConfigured()) {
    return { success: false, error: NICE_NOT_CONFIGURED_MESSAGE };
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
      ...cardParam(ppMethod),
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
