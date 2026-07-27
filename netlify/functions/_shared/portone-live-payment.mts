const PORTONE_API_BASE = 'https://api.portone.io'

export type PortOnePayment = {
  id?: string
  status?: string
  currency?: string
  amount?: {
    total?: number
    paid?: number
  }
  customer?: {
    id?: string
  }
  channel?: {
    type?: string
    pgProvider?: string
  }
  pgProvider?: string
  pgTxId?: string
  paidAt?: string
  orderName?: string
}

type VerifyOptions = {
  paymentId: string
  expectedKrw?: number
  payMethod?: string
  /**
   * 이 결제의 주인으로 기대하는 계정(정규화된 username).
   * 주면 결제자 확인까지 한다 — 같은 결제번호를 다른 계정이 가져다 쓰는 것을 막는다.
   * 결제자가 우리 회원이 아닌 경우(라이브 시청자 주문 등)에는 넘기지 않는다.
   */
  expectedOwner?: string
}

export type PortOneVerification =
  | { ok: true; payment: PortOnePayment; paidAmount: number }
  | { ok: false; error: string; status: number }

const normalize = (value: unknown) => String(value || '').trim().toUpperCase()

const isNiceProvider = (payment: PortOnePayment) => {
  const provider = normalize(payment.channel?.pgProvider || payment.pgProvider)
  return provider === 'NICE_V2'
}

/**
 * 프론트엔드 `toAsciiSafeId`(src/utils/formatters.ts)와 같은 규칙.
 * PortOne 의 paymentId·customerId 는 ASCII 만 허용해서 한글 아이디를 인코딩해 넣는다.
 */
const toAsciiSafeId = (value: string) =>
  value.replace(/[^\x00-\x7F]/g, (ch) => `_${(ch.codePointAt(0) ?? 0).toString(36)}`)

const ownerToken = (username: string) =>
  toAsciiSafeId(String(username || '').trim().toLowerCase().replace(/^biz\//, ''))

/**
 * 결제 주인 확인 — 남의 결제번호를 자기 지갑에 넣는 재사용을 막는다.
 *
 * 결제 상태·금액만 맞으면 통과시키면, 유출된 결제번호(예: 결제 후 돌아오는 주소창에
 * 그대로 찍힌다)를 다른 계정이 제출해 결제 1건으로 충전이 2번 일어날 수 있다.
 *
 * 결제를 요청할 때 우리는 계정 아이디를 두 곳에 심는다.
 *   paymentId   : `<용도>-<아이디>-<시각>-<난수>`  (src/utils/portonePayments.ts genPortOneId)
 *   customer.id : `<아이디>`                      (PortOne 결제 건에 함께 저장된다)
 * 하나라도 다른 사람 것이면 거절한다. 자기 아이디가 박힌 번호를 쓰려면 실제로
 * 자기 돈으로 결제해야 하므로 주워온 번호는 쓸 수 없다.
 */
const isOwnerMismatch = (
  payment: PortOnePayment,
  paymentId: string,
  expectedOwner: string,
): boolean => {
  const expected = ownerToken(expectedOwner)
  if (!expected) return false

  const customerId = ownerToken(payment.customer?.id || '')
  if (customerId) return customerId !== expected

  // customer.id 가 비어 있는 결제(예전 결제·PG 응답 누락)는 결제번호에 심은 아이디로 확인한다.
  // 구분자까지 포함해 대조해야 아이디가 짧을 때 우연히 다른 구간에 걸리지 않는다.
  return !paymentId.toLowerCase().includes(`-${expected}-`)
}

export const verifyLivePortOnePayment = async ({
  paymentId,
  expectedKrw,
  payMethod,
  expectedOwner,
}: VerifyOptions): Promise<PortOneVerification> => {
  const apiSecret = process.env.PORTONE_V2_API_SECRET
  if (!apiSecret) {
    return { ok: false, error: '결제 검증 설정이 완료되지 않았습니다.', status: 503 }
  }

  let response: Response
  try {
    response = await fetch(`${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      method: 'GET',
      headers: { Authorization: `PortOne ${apiSecret}` },
    })
  } catch {
    return { ok: false, error: 'PortOne 결제 조회에 실패했습니다.', status: 502 }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: response.status === 404 ? '결제 정보를 확인할 수 없습니다.' : 'PortOne 결제 조회에 실패했습니다.',
      status: response.status === 404 ? 404 : 502,
    }
  }

  const payment = (await response.json()) as PortOnePayment

  // 결제 주인 먼저 확인한다(남의 결제 상태·금액이 오류 메시지로 새어나가지 않게).
  if (expectedOwner && isOwnerMismatch(payment, paymentId, expectedOwner)) {
    return { ok: false, error: '본인이 결제한 건이 아닙니다.', status: 403 }
  }

  if (payment.status !== 'PAID') {
    return { ok: false, error: '결제가 완료되지 않았습니다.', status: 400 }
  }

  if (normalize(payment.channel?.type) !== 'LIVE') {
    return { ok: false, error: '테스트 결제는 처리할 수 없습니다. 운영 결제 채널을 이용해 주세요.', status: 400 }
  }

  if (payment.currency && payment.currency !== 'KRW') {
    return { ok: false, error: '결제 통화가 올바르지 않습니다.', status: 400 }
  }

  const paidAmount = payment.amount?.total ?? payment.amount?.paid ?? 0
  if (expectedKrw !== undefined && paidAmount !== expectedKrw) {
    return { ok: false, error: '결제 금액이 일치하지 않습니다.', status: 400 }
  }

  if (normalize(payMethod) === 'CARD' && !isNiceProvider(payment)) {
    return { ok: false, error: '나이스페이 운영 카드 결제가 아닙니다.', status: 400 }
  }

  return { ok: true, payment, paidAmount }
}
