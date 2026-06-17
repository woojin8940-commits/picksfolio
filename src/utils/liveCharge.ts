import { apiService } from '../services/apiService';
import { toAsciiSafeId } from './formatters';
import { isNativeApp } from './appEnv';
import { startTossCardPayment } from './tossPayments';

// Prepaid live-time top-up ("시간 충전하기") — a ONE-TIME (non-recurring) payment.
// The seller pays for N hours of broadcast time and the verified payment is then
// confirmed server-side (/api/live-credits) before the time is added. Shared by the
// live-streaming dashboard and 라이브 커머스 관리 화면.
//
// Two providers by method:
//   • 토스페이먼츠(카드) → 토스페이먼츠 직접 연동 (PortOne 미사용). The browser redirects
//     through the TossPayments SDK; the return page finalises the top-up.
//   • 토스페이 / 카카오페이 → PortOne V2. storeId·channelKey are public browser
//     identifiers; the V2 API secret lives server-side only.
const PORTONE_STORE_ID = 'store-1e85edf9-8f37-490c-9419-5a1f15db9ab5';
const PORTONE_TOSSPAY_CHANNEL_KEY = 'channel-key-4e4b5bcd-12b4-48b1-ac74-50e634d1a0e2';
const PORTONE_KAKAOPAY_CHANNEL_KEY = 'channel-key-0abb70ff-069a-4a4f-9939-5e0c60298182';

export const CHARGE_RATE_KRW_PER_HOUR = 8900;

export type ChargePayMethod = 'CARD' | 'TOSSPAY' | 'KAKAOPAY';

// Payment options shown in the charge modal, in display order.
export const CHARGE_PAY_METHODS: { id: ChargePayMethod; label: string }[] = [
  { id: 'CARD', label: '토스페이먼츠' },
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

  // 토스페이먼츠(카드) — PortOne 을 거치지 않고 토스페이먼츠 결제창으로 리다이렉트한다.
  // 정상 흐름에서는 페이지가 떠나 돌아오지 않으며, 돌아온 뒤 /toss/return 페이지가 충전을
  // 마무리한다. 시작 전 오류만 여기서 반환된다.
  if (payMethod === 'CARD') {
    return startTossCardPayment({
      type: 'live',
      username,
      hours,
      amountKrw: amount,
      orderName: `라이브 시간 충전 ${hours}시간`,
      payMethod: 'CARD',
      returnPath: window.location.pathname + window.location.search,
    });
  }

  if (typeof window === 'undefined' || !window.PortOne) {
    return { success: false, error: '결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
  }

  const paymentId = `livecredit-${toAsciiSafeId(username)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channelKey =
    payMethod === 'KAKAOPAY' ? PORTONE_KAKAOPAY_CHANNEL_KEY : PORTONE_TOSSPAY_CHANNEL_KEY;

  try {
    const response = await window.PortOne.requestPayment({
      storeId: PORTONE_STORE_ID,
      channelKey,
      paymentId,
      orderName: `라이브 시간 충전 ${hours}시간`,
      totalAmount: amount,
      currency: 'KRW',
      payMethod: 'EASY_PAY',
      easyPay: { easyPayProvider: payMethod },
      customer: { customerId: toAsciiSafeId(username) },
    });

    if (!response || response.code) {
      return {
        success: false,
        error: response?.message || (response?.code ? `결제 실패 (${response.code})` : '결제가 취소되었습니다.'),
      };
    }

    const result = await apiService.chargeLiveTime(username, hours, {
      paymentId: response.paymentId || paymentId,
      payMethod,
    });
    if (!result.success) {
      return { success: false, error: result.error || '충전에 실패했습니다.', result };
    }
    return { success: true, result };
  } catch (e) {
    console.error('[LiveCharge] payment error:', e);
    return { success: false, error: '결제 처리 중 오류가 발생했습니다. 다시 시도해 주세요.' };
  }
}
