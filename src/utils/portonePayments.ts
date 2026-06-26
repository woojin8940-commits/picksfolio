/**
 * PortOne(포트원) V2 결제 — 카드(나이스정보통신) / 토스페이 / 카카오페이.
 *
 * 카드 결제는 PortOne V2 의 **나이스정보통신(신모듈)** 채널로 처리한다(payMethod: 'CARD').
 * 예전에는 토스페이먼츠와 직접 연동했으나, 카드 PG 를 나이스정보통신으로 전환하면서 토스페이·
 * 카카오페이 간편결제와 동일하게 PortOne V2 를 통해 결제·검증한다. (PortOne V2 NICE 연동 문서:
 * https://developers.portone.io/opi/ko/integration/pg/v2/nice-v2)
 *
 * 토스페이는 PortOne 에서 **리다이렉트 전용** PG 다. 결제창을 promise 로만 호출하면(=
 * redirectUrl 없이) 모바일에서 결제창이 아예 뜨지 않거나, 떠도 결제 후 가맹점으로 돌아오지
 * 못해 "결제가 안 되는" 것처럼 보인다. 그래서 모든 PortOne 결제는 redirectUrl 을 넣어
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
export const PORTONE_TOSSPAY_CHANNEL_KEY = 'channel-key-c110d840-4ee3-417d-9731-6f358e38e5c2';
export const PORTONE_KAKAOPAY_CHANNEL_KEY = 'channel-key-0abb70ff-069a-4a4f-9939-5e0c60298182';
// 카드 결제용 나이스정보통신(신모듈) 채널 키. 사용자에게는 '카드결제'로 노출하지만, 실제 PG 는
// PortOne V2 의 나이스정보통신(신모듈) 채널이다.
//
// 현재 값은 나이스정보통신 **테스트 연동** 채널 키다. PortOne 콘솔 →
//   결제 연동 > 연동 정보 > 채널 관리 > 채널 추가 에서
//   · 연동 모드: 테스트 연동
//   · 결제대행사: 나이스정보통신
//   · 모듈: 신모듈 / PG상점아이디(MID): iamport00m (일반결제 결제창)  ← 테스트 키는 별도 발급 없이 자동 적용
//   로 채널을 추가하면 발급되는 채널 키(channel-key-…, 브라우저 공개 식별자)다.
//   (테스트 모드는 실제 출금되지만 매일 23:00~23:50 자동 취소되며, 전체취소만 가능하다.
//    NH농협·KB국민 신용카드와 KT 휴대폰 소액결제는 테스트 환경에서 사용할 수 없다.)
//
// 운영(실연동) 전환 시에는 운영 채널 키로 교체한다. 토스페이·카카오페이 키처럼 소스에 직접
// 박아도 되고, VITE_PORTONE_NICE_CHANNEL_KEY 환경변수로 주입해도 된다(환경변수가 우선).
export const PORTONE_NICE_CHANNEL_KEY =
  (import.meta.env.VITE_PORTONE_NICE_CHANNEL_KEY as string | undefined) ||
  'channel-key-1be85e63-512b-499e-a9df-b477d8590f06';

// CARD = 나이스정보통신(신모듈) 카드 결제, TOSSPAY/KAKAOPAY = 간편결제.
export type PortOnePayMethod = 'CARD' | 'TOSSPAY' | 'KAKAOPAY';

const INTENT_KEY = 'portone_pending_intent';

export interface PortOneIntent {
  type: 'live' | 'claude' | 'membership' | 'live-order' | 'live-order-batch';
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
  // 멤버십 카드결제를 빌링키(정기) 대신 단건 결제로 처리할 때 true. 카드(나이스정보통신)
  // 빌링키 발급은 본인인증(휴대폰 인증)을 강제하므로, 클로드 플랜과 동일하게 단건 결제로
  // 첫 달을 즉시 결제해 본인인증 없이 카드만 입력하도록 한다.
  oneTime?: boolean;
  // 라이브 커머스 시청자 주문 본문(paymentId 제외). 리다이렉트 전후로 주문 맥락(상품·배송지·
  // 시청자)을 보존해 돌아온 페이지가 그대로 서버에 전달한다.
  order?: Record<string, unknown>;
}

export const channelKeyFor = (m: PortOnePayMethod) =>
  m === 'KAKAOPAY'
    ? PORTONE_KAKAOPAY_CHANNEL_KEY
    : m === 'TOSSPAY'
      ? PORTONE_TOSSPAY_CHANNEL_KEY
      : PORTONE_NICE_CHANNEL_KEY; // CARD → 나이스정보통신(신모듈)

// requestPayment 의 payMethod. 카드(나이스정보통신)는 'CARD', 간편결제는 'EASY_PAY'.
export const portonePayMethod = (m: PortOnePayMethod): 'CARD' | 'EASY_PAY' =>
  m === 'CARD' ? 'CARD' : 'EASY_PAY';

// requestIssueBillingKey 의 billingKeyMethod. 카드(나이스정보통신)는 'CARD', 간편결제는 'EASY_PAY'.
export const portoneBillingKeyMethod = (m: PortOnePayMethod): 'CARD' | 'EASY_PAY' =>
  m === 'CARD' ? 'CARD' : 'EASY_PAY';

// PortOne V2 간편결제(EASY_PAY)는 채널 키와 함께 호출할 간편결제 서비스를 easyPayProvider 로
// 지정해야 한다. 토스페이(신모듈 tosspay_v2 포함)는 'TOSSPAY', 카카오페이는 'KAKAOPAY' 다.
// (토스페이에서 easyPayProvider 를 비우면 채널만으로 PG 가 확정되지 않아 결제창이 뜨지 않거나
//  결제가 시작되지 않는다 — PortOne V2 공식 문서 기준.)
// 카드(나이스정보통신, payMethod 'CARD')는 간편결제가 아니므로 easyPay 파라미터를 넣지 않는다.
export const easyPayParam = (m: PortOnePayMethod) =>
  m === 'CARD'
    ? {}
    : m === 'KAKAOPAY'
      ? { easyPay: { easyPayProvider: 'KAKAOPAY' } }
      : { easyPay: { easyPayProvider: 'TOSSPAY' } };

// 나이스정보통신(신모듈) 카드 결제 파라미터. NICE V2 는 카드 결제 시 고정 할부 개월수를
// 요구한다(미지정 시 결제창이 즉시 오류로 닫혀 "결제 처리 중 오류"로 보인다). 결제 금액이
// 대부분 할부 가능 기준(보통 5만원) 미만이므로 일시불(fixedMonth: 0)로 호출한다.
// 간편결제(토스페이/카카오페이)에는 카드 옵션을 넣지 않는다. — PortOne V2 NICE 문서 기준.
export const cardParam = (m: PortOnePayMethod) =>
  m === 'CARD' ? { card: { installment: { monthOption: { fixedMonth: 0 } } } } : {};

// 나이스정보통신 채널 키가 실제 값으로 설정되었는지. 자리표시자(REPLACE) 상태면 결제가
// 무조건 실패하므로, 카드 결제 호출 전에 이 값으로 사전 점검해 명확한 안내를 띄운다.
// PortOne 콘솔에서 발급한 NICE(신모듈) 채널 키를 VITE_PORTONE_NICE_CHANNEL_KEY 로 주입하면
// 활성화된다. (테스트 결제는 콘솔에서 해당 채널을 '테스트' 모드로 두면 된다.)
export const isNiceCardConfigured = () =>
  !!PORTONE_NICE_CHANNEL_KEY && !PORTONE_NICE_CHANNEL_KEY.includes('REPLACE');

// 카드(나이스정보통신) 채널 미설정 시 사용자에게 보여줄 안내 메시지.
// 사용자에게는 PG사명(나이스정보통신) 대신 '카드 결제'로만 노출한다.
export const NICE_NOT_CONFIGURED_MESSAGE =
  '카드 결제 채널이 아직 연결되지 않았습니다. 토스페이·카카오페이로 결제하거나 관리자에게 문의해 주세요.';

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
