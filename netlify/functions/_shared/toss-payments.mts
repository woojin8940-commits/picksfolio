/**
 * TossPayments direct integration (서버 전용).
 *
 * 결제수단 중 "토스페이먼츠(카드)" 는 PortOne(포트원) 어그리게이터를 거치지 않고
 * 토스페이먼츠와 직접 연동한다. (토스페이 / 카카오페이 간편결제는 여전히 PortOne 사용.)
 *
 * 시크릿 키는 서버에서만 사용하며 브라우저로 절대 노출하지 않는다. 운영 키는 Netlify
 * 환경변수 TOSS_SECRET_KEY 로 주입하고, 미설정 시 토스 공식 문서의 공개 테스트 시크릿
 * 키(샌드박스)로 동작한다. 인증은 Basic base64(`${시크릿키}:`) — 콜론 뒤 비밀번호는 비움.
 */

const API_BASE = 'https://api.tosspayments.com/v1'
const CONFIRM_URL = `${API_BASE}/payments/confirm`
const BILLING_AUTH_ISSUE_URL = `${API_BASE}/billing/authorizations/issue`

// 토스 공식 문서 공개 테스트 시크릿 키. 운영 전환 시 TOSS_SECRET_KEY 를 반드시 설정할 것.
const TEST_SECRET_KEY = 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6'

const secretKey = () => process.env.TOSS_SECRET_KEY || TEST_SECRET_KEY
const authHeader = () => `Basic ${Buffer.from(`${secretKey()}:`).toString('base64')}`

export interface TossConfirmResult {
  ok: boolean
  amountKrw?: number
  method?: string
  orderName?: string
  status?: string
  error?: string
}

/**
 * 토스페이먼츠 단건 결제 승인. 결제위젯/SDK 가 successUrl 로 붙여준 paymentKey·orderId·
 * amount 로 결제를 최종 승인(=실제 매입)한다. Idempotency-Key 로 같은 주문의 중복 승인을
 * 막으므로 여러 번 호출해도 안전하다. 승인된 결제 정보를 함께 반환한다.
 */
export const confirmTossPayment = async (
  paymentKey: string,
  orderId: string,
  amountKrw: number,
): Promise<TossConfirmResult> => {
  try {
    const res = await fetch(CONFIRM_URL, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        'Idempotency-Key': `confirm-${orderId}`,
      },
      body: JSON.stringify({ paymentKey, orderId, amount: amountKrw }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok) {
      return { ok: false, error: `${data?.code || res.status}: ${data?.message || '결제 승인 실패'}` }
    }
    if (data?.status !== 'DONE') {
      return { ok: false, status: data?.status, error: `결제가 완료되지 않았습니다. (상태: ${data?.status || 'UNKNOWN'})` }
    }
    return {
      ok: true,
      amountKrw: Number(data?.totalAmount ?? amountKrw),
      method: data?.method,
      orderName: data?.orderName,
      status: data?.status,
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || '토스페이먼츠 결제 승인 중 오류가 발생했습니다.' }
  }
}

/**
 * 토스페이먼츠 빌링(자동결제) 키 발급. requestBillingAuth 후 successUrl 로 돌아온 authKey·
 * customerKey 를 서버에서 교환해 billingKey 를 얻는다. 이후 정기/자동 결제에 사용한다.
 */
export const issueTossBillingKey = async (
  authKey: string,
  customerKey: string,
): Promise<{ ok: boolean; billingKey?: string; error?: string }> => {
  try {
    const res = await fetch(BILLING_AUTH_ISSUE_URL, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ authKey, customerKey }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok || !data?.billingKey) {
      return { ok: false, error: `${data?.code || res.status}: ${data?.message || '빌링키 발급 실패'}` }
    }
    return { ok: true, billingKey: data.billingKey }
  } catch (e: any) {
    return { ok: false, error: e?.message || '토스페이먼츠 빌링키 발급 중 오류가 발생했습니다.' }
  }
}

/**
 * 발급된 토스페이먼츠 빌링키로 `amountKrw` 를 결제(자동결제 1회). 멤버십 정기결제와 클로드
 * 크레딧 자동충전에 공통으로 쓰인다. 성공 시 결제키(paymentKey)를 반환한다.
 */
export const chargeTossBillingKey = async (
  billingKey: string,
  customerKey: string,
  amountKrw: number,
  orderId: string,
  orderName: string,
): Promise<{ ok: boolean; paymentKey?: string; error?: string }> => {
  try {
    const res = await fetch(`${API_BASE}/billing/${encodeURIComponent(billingKey)}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        'Idempotency-Key': `billing-${orderId}`,
      },
      body: JSON.stringify({
        customerKey,
        amount: amountKrw,
        orderId,
        orderName,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok || data?.status !== 'DONE') {
      return { ok: false, error: `${data?.code || res.status}: ${data?.message || '자동결제 실패'}` }
    }
    return { ok: true, paymentKey: data?.paymentKey }
  } catch (e: any) {
    return { ok: false, error: e?.message || '토스페이먼츠 자동결제 중 오류가 발생했습니다.' }
  }
}
