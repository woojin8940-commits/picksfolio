import { apiService } from '../services/apiService';
import { toAsciiSafeId } from './formatters';
import { isNativeApp } from './appEnv';
import {
  PORTONE_STORE_ID,
  channelKeyFor,
  easyPayParam,
  portonePayMethod,
  portoneRedirectUrl,
  savePortOneIntent,
  clearPortOneIntent,
  genPortOneId,
} from './portonePayments';

// Prepaid live-time top-up ("시간 충전하기") — a ONE-TIME (non-recurring) payment.
// The seller pays for N hours of broadcast time and the verified payment is then
// confirmed server-side (/api/live-credits) before the time is added. Shared by the
// live-streaming dashboard and 라이브 커머스 관리 화면.
//
// 모든 결제수단은 PortOne V2 (리다이렉트 방식)로 처리한다:
//   • 나이스정보통신(카드) → PortOne V2 NICE 채널 (payMethod 'CARD')
//   • 토스페이 / 카카오페이 → PortOne V2 간편결제 (payMethod 'EASY_PAY')
// storeId·channelKey are public browser identifiers; the V2 API secret lives
// server-side only.

export const CHARGE_RATE_KRW_PER_HOUR = 8900;

export type ChargePayMethod = 'CARD' | 'TOSSPAY' | 'KAKAOPAY';

// Payment options shown in the charge modal, in display order.
export const CHARGE_PAY_METHODS: { id: ChargePayMethod; label: string }[] = [
  { id: 'CARD', label: '나이스정보통신' },
  { id: 'TOSSPAY', label: '토스페이' },
  { id: 'KAKAOPAY', label: '카카오페이' },
];

export interface ChargeOutcome {
  success: boolean;
  error?: string;
  result?: Awaited<ReturnType<typeof apiService.chargeLiveTime>>;
}

/**
 * Run the PortOne one-time payment for `hours` of broadcast time and, on
 * success, confirm it server-side so the charged time is credited. Returns a
 * normalized outcome the caller can surface in the charge modal.
 */
export async function payAndChargeLiveTime(
  username: string,
  hours: number,
  payMethod: ChargePayMethod,
): Promise<ChargeOutcome> {
  if (isNativeApp()) {
    // Broadcast-time top-up is a digital-goods purchase, sold on the website
    // only. Hard backstop — the charge UI is already hidden inside the app.
    return { success: false, error: '이 결제는 앱에서 지원되지 않습니다.' };
  }

  const amount = hours * CHARGE_RATE_KRW_PER_HOUR;

  if (typeof window === 'undefined' || !window.PortOne) {
    return { success: false, error: '결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
  }

  const paymentId = genPortOneId('livecredit', username);
  // 카드(나이스정보통신) / 토스페이 / 카카오페이 모두 PortOne V2 로 처리한다.
  const ppMethod = payMethod;

  // 모두 리다이렉트 방식으로 호출한다. redirectUrl 을 넣어 결제창으로 페이지를 넘기고,
  // 돌아온 /portone/return 페이지가 paymentId 로 서버 검증·시간 충전을 마무리한다. intent 를
  // 미리 저장해 둔다. (PC 에서 팝업으로 떠 promise 가 resolve 되면 아래 인라인 처리도 동작한다.)
  savePortOneIntent({
    type: 'live',
    username,
    payMethod: ppMethod,
    hours,
    orderName: `라이브 시간 충전 ${hours}시간`,
    returnPath: window.location.pathname + window.location.search,
  });

  try {
    const response = await window.PortOne.requestPayment({
      storeId: PORTONE_STORE_ID,
      channelKey: channelKeyFor(ppMethod),
      paymentId,
      orderName: `라이브 시간 충전 ${hours}시간`,
      totalAmount: amount,
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
        error: response?.message || (response?.code ? `결제 실패 (${response.code})` : '결제가 취소되었습니다.'),
      };
    }

    const result = await apiService.chargeLiveTime(username, hours, {
      paymentId: response.paymentId || paymentId,
      payMethod,
    });
    clearPortOneIntent();
    if (!result.success) {
      return { success: false, error: result.error || '충전에 실패했습니다.', result };
    }
    return { success: true, result };
  } catch (e) {
    clearPortOneIntent();
    console.error('[LiveCharge] payment error:', e);
    return { success: false, error: '결제 처리 중 오류가 발생했습니다. 다시 시도해 주세요.' };
  }
}
