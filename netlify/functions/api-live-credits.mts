import {
  computeLiveUsage,
  readLiveCredits,
  writeLiveCredits,
} from './_shared/live-usage.mts'
import {
  CHARGE_RATE_KRW_PER_HOUR,
  MINUTES_PER_CHARGE_HOUR,
  MONTHLY_HARD_CAP_MINUTES,
  INCLUDED_MINUTES_PER_MONTH,
} from './_shared/live-pricing.mts'
import type { Config, Context } from '@netlify/functions'
import { confirmTossPayment } from './_shared/toss-payments.mts'

// Prepaid live-time top-up ("시간 충전하기").
//   GET  /api/live-credits/:username                          → current month balance + usage
//   POST /api/live-credits/:username  { hours, paymentId,
//                                       payMethod }            → charge N hours (시간당 8,900원)
//
// Charging is a ONE-TIME (non-recurring) payment. Two providers, by method:
//   • 토스페이먼츠(카드) → 토스페이먼츠 직접 연동. The client redirects through the
//     TossPayments SDK and posts { provider:'toss', paymentKey, orderId } here; this
//     endpoint CONFIRMS the payment with TossPayments (실제 매입) and checks the amount.
//   • 토스페이 / 카카오페이 → PortOne. The client runs PortOne.requestPayment and posts
//     the resulting paymentId; this endpoint verifies it against the PortOne REST API
//     (status PAID, KRW, amount == hours × rate).
// Either way no time is added without a real, matching payment. Charged hours extend
// the monthly broadcast allowance so a seller can keep streaming after the included
// 3 hours are spent. Time is monthly-scoped and resets with the calendar month,
// matching the included allowance.
const PORTONE_API_BASE = 'https://api.portone.io'

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase()
  if (!username) {
    return Response.json({ error: 'Missing username' }, { status: 400 })
  }

  try {
    const now = new Date()

    if (req.method === 'GET') {
      const [credits, usage] = await Promise.all([
        readLiveCredits(username, now),
        computeLiveUsage(username, now),
      ])
      return Response.json({
        credits,
        usage,
        chargeRateKrwPerHour: CHARGE_RATE_KRW_PER_HOUR,
      })
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const hours = Math.floor(Number((body as any)?.hours) || 0)
      const payMethod = String((body as any)?.payMethod || '').trim()
      const provider = String((body as any)?.provider || '').trim().toLowerCase()
      const isToss = provider === 'toss'
      // PortOne identifies a payment by paymentId; TossPayments by paymentKey. We use
      // whichever is present as the idempotency/record key for this charge.
      const paymentKey = String((body as any)?.paymentKey || '').trim()
      const orderId = String((body as any)?.orderId || '').trim()
      const paymentId = isToss ? paymentKey : String((body as any)?.paymentId || '').trim()
      if (!hours || hours < 1) {
        return Response.json({ error: '충전할 시간을 1시간 이상 선택해주세요.' }, { status: 400 })
      }
      if (hours > 50) {
        return Response.json({ error: '한 번에 최대 50시간까지 충전할 수 있습니다.' }, { status: 400 })
      }
      if (!paymentId) {
        return Response.json({ error: '결제 정보(paymentId)가 필요합니다.' }, { status: 400 })
      }
      if (isToss && !orderId) {
        return Response.json({ error: '결제 정보(orderId)가 필요합니다.' }, { status: 400 })
      }

      const credits = await readLiveCredits(username, now)

      // Idempotency: never credit the same PortOne payment twice (e.g. on a
      // double-submit or a retried request after a transient network error).
      if ((credits.charges || []).some((c) => c.paymentId === paymentId)) {
        const usage = await computeLiveUsage(username, now)
        return Response.json({ success: true, alreadyProcessed: true, credits, usage })
      }

      const addedMinutes = hours * MINUTES_PER_CHARGE_HOUR
      const amountKrw = hours * CHARGE_RATE_KRW_PER_HOUR

      // Don't let charged allowance push the monthly cap past the 50h hard cap.
      const projectedAllowance =
        INCLUDED_MINUTES_PER_MONTH + credits.chargedMinutes + addedMinutes
      if (projectedAllowance > MONTHLY_HARD_CAP_MINUTES) {
        return Response.json(
          { error: '월 송출 한도(50시간)를 초과하여 충전할 수 없습니다.' },
          { status: 400 },
        )
      }

      // Verify the one-time payment server-side before crediting time.
      if (isToss) {
        // 토스페이먼츠(카드) — confirm the payment (실제 매입) and match the amount.
        const confirm = await confirmTossPayment(paymentKey, orderId, amountKrw)
        if (!confirm.ok) {
          return Response.json({ error: confirm.error || '토스페이먼츠 결제 승인에 실패했습니다.' }, { status: 400 })
        }
        if ((confirm.amountKrw ?? 0) !== amountKrw) {
          return Response.json(
            { error: `결제 금액이 일치하지 않습니다. (기대: ${amountKrw}, 실제: ${confirm.amountKrw})` },
            { status: 400 },
          )
        }
      } else {
        const apiSecret = process.env.PORTONE_V2_API_SECRET
        if (!apiSecret) {
          return Response.json(
            { error: 'PORTONE_V2_API_SECRET 환경 변수가 설정되지 않았습니다.' },
            { status: 500 },
          )
        }

        let portoneRes: Response
        try {
          portoneRes = await fetch(
            `${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`,
            { method: 'GET', headers: { Authorization: `PortOne ${apiSecret}` } },
          )
        } catch {
          return Response.json({ error: 'PortOne 결제 조회에 실패했습니다.' }, { status: 502 })
        }
        if (!portoneRes.ok) {
          const errText = await portoneRes.text().catch(() => '')
          return Response.json(
            { error: `PortOne 결제 조회 실패 (${portoneRes.status}): ${errText.slice(0, 200)}` },
            { status: 502 },
          )
        }

        const payment = (await portoneRes.json()) as {
          status?: string
          amount?: { total?: number; paid?: number }
          currency?: string
        }
        if (payment.status !== 'PAID') {
          return Response.json(
            { error: `결제가 완료되지 않았습니다. (상태: ${payment.status || 'UNKNOWN'})` },
            { status: 400 },
          )
        }
        const paidAmount = payment.amount?.total ?? payment.amount?.paid ?? 0
        if (paidAmount !== amountKrw) {
          return Response.json(
            { error: `결제 금액이 일치하지 않습니다. (기대: ${amountKrw}, 실제: ${paidAmount})` },
            { status: 400 },
          )
        }
        if (payment.currency && payment.currency !== 'KRW') {
          return Response.json(
            { error: `통화가 일치하지 않습니다. (${payment.currency})` },
            { status: 400 },
          )
        }
      }

      // Payment verified — credit the time.
      credits.chargedMinutes += addedMinutes
      credits.charges = [
        { at: now.toISOString(), hours, minutes: addedMinutes, amountKrw, paymentId, payMethod },
        ...(credits.charges || []),
      ].slice(0, 100)

      await writeLiveCredits(username, credits)

      const usage = await computeLiveUsage(username, now)
      return Response.json({
        success: true,
        charged: { hours, minutes: addedMinutes, amountKrw },
        credits,
        usage,
      })
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Failed to charge live time' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/live-credits/:username',
}
