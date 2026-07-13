const PORTONE_API_BASE = 'https://api.portone.io'

export type PortOnePayment = {
  id?: string
  status?: string
  currency?: string
  amount?: {
    total?: number
    paid?: number
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
}

export type PortOneVerification =
  | { ok: true; payment: PortOnePayment; paidAmount: number }
  | { ok: false; error: string; status: number }

const normalize = (value: unknown) => String(value || '').trim().toUpperCase()

const isNiceProvider = (payment: PortOnePayment) => {
  const provider = normalize(payment.channel?.pgProvider || payment.pgProvider)
  return provider === 'NICE_V2'
}

export const verifyLivePortOnePayment = async ({
  paymentId,
  expectedKrw,
  payMethod,
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
