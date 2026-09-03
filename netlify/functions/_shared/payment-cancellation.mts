/**
 * 결제 취소(환불) 조회 — 서버 전용.
 *
 * 환불은 우리 서비스 화면이 아니라 PG 관리자 콘솔(포트원)이나 카드사 취소로 처리되는 경우가
 * 많다. 그래서 "결제는 취소됐는데 지급된 크레딧(포인트)은 그대로 남아 있는" 상태가 생긴다.
 * 이 모듈은 결제건 하나의 취소 금액을 PG 에 물어보는 단일 창구를 제공하고, 크레딧
 * 지갑(claude-credits)이 이를 이용해 지급분을 환수한다.
 *
 * 결제는 모두 포트원(카드 = 나이스정보통신 / 간편결제 = 카카오페이)으로 처리하므로 결제건은
 * 포트원 paymentId 로만 조회한다.
 */

export type PaymentProvider = 'portone'

export interface PaymentCancellation {
  /** 조회 성공 여부. false 면 취소 금액을 신뢰할 수 없으므로 환수하지 않는다. */
  ok: boolean
  /** 지금까지 취소(환불)된 금액(₩). 전액 취소면 결제 총액과 같다. */
  cancelledKrw: number
  /** PG 가 보고한 결제 상태 문자열(로그/디버깅용). */
  status?: string
  /** 해당 PG 에서 결제건을 찾을 수 없었다(다른 PG 로 결제된 건일 수 있다). */
  notFound?: boolean
  error?: string
}

const PORTONE_API_BASE = 'https://api.portone.io'

/** 포트원 V2 결제건의 취소 금액. */
export const lookupPortOneCancellation = async (
  paymentId: string,
): Promise<PaymentCancellation> => {
  const apiSecret = process.env.PORTONE_V2_API_SECRET
  if (!apiSecret) return { ok: false, cancelledKrw: 0, error: 'PORTONE_V2_API_SECRET 미설정' }

  try {
    const res = await fetch(`${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      method: 'GET',
      headers: { Authorization: `PortOne ${apiSecret}` },
    })
    if (res.status === 404) return { ok: false, cancelledKrw: 0, notFound: true }
    if (!res.ok) return { ok: false, cancelledKrw: 0, error: `PortOne ${res.status}` }

    const payment = (await res.json()) as {
      status?: string
      amount?: { total?: number; paid?: number; cancelled?: number }
    }
    const status = String(payment.status || '')
    const total = Number(payment.amount?.total ?? payment.amount?.paid ?? 0) || 0
    // PARTIAL_CANCELLED 는 amount.cancelled 에 부분 취소 금액이 담긴다. 전액 취소(CANCELLED)는
    // amount.cancelled 가 비어 있는 응답도 있어 결제 총액으로 보정한다.
    const reported = Number(payment.amount?.cancelled ?? 0) || 0
    const cancelledKrw = status === 'CANCELLED' ? Math.max(reported, total) : reported
    return { ok: true, cancelledKrw, status }
  } catch (e: any) {
    return { ok: false, cancelledKrw: 0, error: e?.message || 'PortOne 결제 조회 실패' }
  }
}

/**
 * 결제건의 취소 금액을 조회한다. 결제는 모두 포트원을 거치므로 provider 는 기록용이며,
 * 포트원에서 찾지 못하면 notFound 로 알린다(= 환수하지 않는다).
 */
export const lookupPaymentCancellation = async (
  paymentId: string,
  _provider?: PaymentProvider | string | null,
): Promise<PaymentCancellation> => {
  if (!paymentId) return { ok: false, cancelledKrw: 0, notFound: true }
  return lookupPortOneCancellation(paymentId)
}
