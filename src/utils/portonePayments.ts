/**
 * PortOne(포트원) V2 간편결제 — 토스페이 / 카카오페이.
 *
 * 토스페이는 PortOne 에서 **리다이렉트 전용** PG 다. 결제창을 promise 로만 호출하면(=
 * redirectUrl 없이) 모바일에서 결제창이 아예 뜨지 않거나, 떠도 결제 후 가맹점으로 돌아오지
 * 못해 "결제가 안 되는" 것처럼 보인다. 그래서 모든 PortOne 간편결제는 redirectUrl 을 넣어
 * 리다이렉트 방식으로 호출하고, 돌아온 `/portone/return` 페이지가 서버 검증·적립을 마무리한다.
 *
 *   1. 결제/빌링 요청 직전에 "결제 후 무엇을 할지"(intent)를 sessionStorage 에 저장하고
 *   2. redirectUrl(`/portone/return`)로 돌아오면 그 intent + PortOne 이 붙여준 쿼리
 *      (paymentId / billingKey / code)로 서버 처리를 마저 수행한다. (public/portone-return.html)
 *
 * PC 환경에서 PG 가 리다이렉트 대신 팝업으로 떠 promise 가 즉시 resolve 되는 경우도 있으므로,
 * 호출부는 promise 결과도 그대로 처리한다(인라인 적립). 서버 멱등 처리로 이중 적립은 없다.
 *
 * storeId·channelKey 는 브라우저에 공개되는 식별자이며, V2 API 시크릿은 서버 전용이다.
 */

import { toAsciiSafeId } from './formatters';

// PortOne V2 공개 식별자 (브라우저 노출용). 라이브 충전 / 클로드 / 멤버십 결제가 공유한다.
export const PORTONE_STORE_ID = 'store-1e85edf9-8f37-490c-9419-5a1f15db9ab5';
export const PORTONE_TOSSPAY_CHANNEL_KEY = 'channel-key-4e4b5bcd-12b4-48b1-ac74-50e634d1a0e2';
export const PORTONE_KAKAOPAY_CHANNEL_KEY = 'channel-key-0abb70ff-069a-4a4f-9939-5e0c60298182';

export type PortOnePayMethod = 'TOSSPAY' | 'KAKAOPAY';

const INTENT_KEY = 'portone_pending_intent';

export interface PortOneIntent {
  type: 'live' | 'claude' | 'membership' | 'claude-billing' | 'live-order' | 'live-order-batch';
  username: string;
  payMethod: PortOnePayMethod;
  // Where to send the user back inside the SPA after the server finalises.
  returnPath: string;
  orderName: string;
  // live top-up
  hours?: number;
  // claude one-time payment amount
  amountKrw?: number;
  // claude credit grant kind
  kind?: 'activation' | 'recharge';
  // membership subscription tier
  tier?: 'standard' | 'standard_ai' | 'commerce';
  // 라이브 커머스 시청자 주문 본문(paymentId 제외). 리다이렉트 전후로 주문 맥락(상품·배송지·
  // 시청자)을 보존해 돌아온 페이지가 그대로 서버에 전달한다.
  order?: Record<string, unknown>;
}

export const channelKeyFor = (m: PortOnePayMethod) =>
  m === 'KAKAOPAY' ? PORTONE_KAKAOPAY_CHANNEL_KEY : PORTONE_TOSSPAY_CHANNEL_KEY;

// PortOne V2 간편결제(EASY_PAY)는 채널 키와 함께 호출할 간편결제 서비스를 easyPayProvider 로
// 지정해야 한다. 토스페이(신모듈 tosspay_v2 포함)는 'TOSSPAY', 카카오페이는 'KAKAOPAY' 다.
// (토스페이에서 easyPayProvider 를 비우면 채널만으로 PG 가 확정되지 않아 결제창이 뜨지 않거나
//  결제가 시작되지 않는다 — PortOne V2 공식 문서 기준.)
export const easyPayParam = (m: PortOnePayMethod) =>
  m === 'KAKAOPAY'
    ? { easyPay: { easyPayProvider: 'KAKAOPAY' } }
    : { easyPay: { easyPayProvider: 'TOSSPAY' } };

const origin = () => window.location.origin;

export const portoneRedirectUrl = () => `${origin()}/portone/return`;

export const savePortOneIntent = (intent: PortOneIntent) => {
  try {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    // sessionStorage may be unavailable (private mode); the return page will then
    // surface a clear error instead of finalising the wrong action.
  }
};

export const clearPortOneIntent = () => {
  try {
    sessionStorage.removeItem(INTENT_KEY);
  } catch {
    /* ignore */
  }
};

export const genPortOneId = (prefix: string, username: string) =>
  `${prefix}-${toAsciiSafeId(username)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
