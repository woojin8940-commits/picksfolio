import { toAsciiSafeId } from './formatters';

/**
 * 토스페이먼츠 직접 연동 (카드 결제 · "토스페이먼츠" 결제수단).
 *
 * 카드 결제는 PortOne(포트원)을 거치지 않고 토스페이먼츠와 직접 연동한다. (토스페이 /
 * 카카오페이 간편결제는 그대로 PortOne 사용 — claudeCharge / liveCharge / MembershipPlan
 * 의 CARD 분기에서 이 모듈을 호출한다.)
 *
 * 토스페이먼츠 결제창은 PortOne 처럼 팝업으로 결과를 즉시 돌려주지 않고 전체 페이지를
 * 리다이렉트한다. 그래서:
 *   1. 결제/빌링 요청 직전에 "결제 후 무엇을 할지"(intent)를 sessionStorage 에 저장하고
 *   2. successUrl(`/toss/return`)로 돌아오면 그 intent + 토스가 붙여준 쿼리로 서버 처리를
 *      마저 수행한다. (public/toss-return.html)
 */

// 브라우저 공개용 클라이언트 키. 운영 키는 VITE_TOSS_CLIENT_KEY 로 주입하고, 미설정 시
// 토스 공식 문서의 공개 테스트 키(샌드박스)로 동작한다. (시크릿 키는 서버 전용.)
//
// ⚠️ 토스페이먼츠 클라이언트 키는 두 종류가 있고 서로 호환되지 않는다:
//   - "API 개별 연동 키"  : test_ck_... / live_ck_...  → 이 standard SDK(payment().requestPayment)용
//   - "결제위젯 연동 키"  : test_gck_... / live_gck_... → 결제위젯(payment-widget) 전용
// 위젯 키(_gck_)를 standard SDK 에 넘기면 토스가
// "API 개별 연동 키의 클라이언트 키로 SDK를 연동해주세요. 결제위젯 연동 키는 지원하지 않습니다."
// 라며 거부한다. 그래서 폴백 테스트 키도 반드시 API 개별 연동 키(test_ck_...)를 쓴다.
const TOSS_CLIENT_KEY =
  (import.meta.env.VITE_TOSS_CLIENT_KEY as string | undefined) ||
  'test_ck_docs_Ovk5rk1EwkEbP0W43n07xlzm';

// 잘못된 위젯 키(_gck_)가 주입됐는지 미리 확인해 SDK 호출 전에 명확한 한국어 오류를 돌려준다.
const widgetKeyError = (): string | null =>
  /_gck_/.test(TOSS_CLIENT_KEY)
    ? '토스페이먼츠 클라이언트 키가 "결제위젯 연동 키"로 설정돼 있습니다. 토스페이먼츠 개발자센터에서 "API 개별 연동 키"의 클라이언트 키(test_ck_… / live_ck_…)로 VITE_TOSS_CLIENT_KEY 를 다시 설정해주세요.'
    : null;

const SDK_URL = 'https://js.tosspayments.com/v2/standard';
const INTENT_KEY = 'toss_pending_intent';

export type TossIntentType = 'live' | 'claude' | 'membership' | 'claude-billing';

export interface TossIntent {
  type: TossIntentType;
  username: string;
  orderName: string;
  payMethod: 'CARD';
  // Where to send the user back inside the SPA after the server finalises.
  returnPath: string;
  // One-time payment amount (live/claude). For billing flows this is the first charge.
  amountKrw?: number;
  // live-time top-up
  hours?: number;
  // claude credit grant
  kind?: 'activation' | 'recharge';
  // membership subscription tier
  tier?: 'standard' | 'standard_ai' | 'commerce';
  // claude auto-recharge billing registration
  autoRechargeAmountKrw?: number;
}

const genId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

let sdkPromise: Promise<void> | null = null;

// Inject the TossPayments standard SDK once and resolve when window.TossPayments
// is available. (index.html only loads the PortOne SDK; Toss is loaded on demand.)
const loadTossSdk = (): Promise<void> => {
  if (typeof window !== 'undefined' && (window as any).TossPayments) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('SDK load failed')));
      if ((window as any).TossPayments) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('SDK load failed'));
    document.head.appendChild(script);
  });
  return sdkPromise;
};

const saveIntent = (intent: TossIntent) => {
  try {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    // sessionStorage may be unavailable (private mode); the return page will then
    // surface a clear error instead of finalising the wrong action.
  }
};

const origin = () => window.location.origin;

/**
 * 토스페이먼츠 카드 단건 결제. intent 를 저장하고 결제창으로 리다이렉트한다. 정상 흐름에서는
 * 페이지가 떠나므로 resolve 되지 않으며, 요청을 시작하기 전에 오류(SDK 로드 실패, 사용자
 * 취소 등)가 나면 { success:false }로 반환된다.
 */
export async function startTossCardPayment(
  intent: TossIntent & { amountKrw: number },
): Promise<{ success: boolean; error?: string }> {
  if (typeof window === 'undefined') {
    return { success: false, error: '브라우저 환경에서만 결제할 수 있습니다.' };
  }
  const keyError = widgetKeyError();
  if (keyError) return { success: false, error: keyError };
  saveIntent(intent);
  try {
    await loadTossSdk();
    const TossPayments = (window as any).TossPayments;
    const tossPayments = TossPayments(TOSS_CLIENT_KEY);
    const payment = tossPayments.payment({ customerKey: TossPayments.ANONYMOUS });
    await payment.requestPayment({
      method: 'CARD',
      amount: { currency: 'KRW', value: intent.amountKrw },
      orderId: genId('order'),
      orderName: intent.orderName,
      successUrl: `${origin()}/toss/return`,
      failUrl: `${origin()}/toss/fail`,
      card: { useEscrow: false, flowMode: 'DEFAULT', useCardPoint: false, useAppCardOnly: false },
    });
    // Redirect happened; this line is normally not reached.
    return { success: true };
  } catch (e: any) {
    sessionStorage.removeItem(INTENT_KEY);
    return { success: false, error: e?.message || '결제 요청을 시작하지 못했습니다.' };
  }
}

/**
 * 토스페이먼츠 카드 자동결제(빌링) 등록. 멤버십 정기결제와 클로드 자동충전 결제수단 등록에
 * 사용한다. requestBillingAuth 후 successUrl 로 authKey·customerKey 가 돌아오면 서버에서
 * 빌링키로 교환한다.
 */
export async function startTossCardBilling(
  intent: TossIntent,
): Promise<{ success: boolean; error?: string }> {
  if (typeof window === 'undefined') {
    return { success: false, error: '브라우저 환경에서만 결제할 수 있습니다.' };
  }
  const keyError = widgetKeyError();
  if (keyError) return { success: false, error: keyError };
  saveIntent(intent);
  try {
    await loadTossSdk();
    const TossPayments = (window as any).TossPayments;
    const tossPayments = TossPayments(TOSS_CLIENT_KEY);
    // 회원마다 고유하고 추측하기 어려운 customerKey. 빌링키 발급·결제에 일관되게 쓰인다.
    // TossPayments 가 허용하는 문자(영문/숫자/-_=.@)만 남긴다.
    const safeUser = toAsciiSafeId(intent.username).replace(/[^A-Za-z0-9_=.@-]/g, '');
    const customerKey = `${safeUser}_${genId('c')}`.replace(/[^A-Za-z0-9_=.@-]/g, '').slice(0, 50);
    const payment = tossPayments.payment({ customerKey });
    await payment.requestBillingAuth({
      method: 'CARD',
      successUrl: `${origin()}/toss/return`,
      failUrl: `${origin()}/toss/fail`,
    });
    return { success: true };
  } catch (e: any) {
    sessionStorage.removeItem(INTENT_KEY);
    return { success: false, error: e?.message || '결제수단 등록을 시작하지 못했습니다.' };
  }
}
