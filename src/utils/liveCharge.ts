import { apiService } from '../services/apiService';
import { toAsciiSafeId } from './formatters';

// Prepaid live-time top-up ("시간 충전하기") — a ONE-TIME (non-recurring) payment.
// The seller pays for N hours of broadcast time through PortOne and the verified
// paymentId is then confirmed server-side (/api/live-credits) before the time is
// added. Shared by the live-streaming dashboard and 라이브 커머스 관리 화면.
//
// PortOne V2 — storeId and channelKey are public browser identifiers; the V2 API
// secret lives server-side only. The TossPayments channel handles 토스페이먼츠(카드)
// and 토스페이; the KakaoPay channel handles 카카오페이.
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
  if (typeof window === 'undefined' || !window.PortOne) {
    return { success: false, error: '결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' };
  }

  const amount = hours * CHARGE_RATE_KRW_PER_HOUR;
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
      payMethod: payMethod === 'CARD' ? 'CARD' : 'EASY_PAY',
      ...(payMethod !== 'CARD' && { easyPay: { easyPayProvider: payMethod } }),
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
