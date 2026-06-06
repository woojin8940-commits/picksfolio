import type { Config, Context } from '@netlify/functions'
import {
  ACTIVATION_GRANT_KRW,
  ACTIVATION_PRICE_KRW,
  AUTO_RECHARGE_DEFAULT_KRW,
  MARGIN_MULTIPLIER,
  RECHARGE_PACKS_KRW,
  readClaudeCredits,
  writeClaudeCredits,
  publicCredits,
  type ClaudeCredits,
} from './_shared/claude-credits.mts'

// Claude plan credit wallet API.
//
//   GET   /api/claude-credits/:username
//         → { credits, activationPriceKrw, activationGrantKrw, rechargePacksKrw }
//
//   POST  /api/claude-credits/:username
//         body { kind: 'activation' | 'recharge', amountKrw, paymentId, payMethod, billingKey? }
//         Verifies a ONE-TIME PortOne payment server-side (status PAID, KRW, amount
//         matches) before granting credits — identical guarantee to live-time top-up.
//         'activation' marks the plan active and grants the base credits; 'recharge'
//         tops up an already-active wallet. A billingKey may be supplied to enable
//         auto-recharge in the same step.
//
//   PATCH /api/claude-credits/:username
//         body { autoRecharge?, autoRechargeAmountKrw?, billingKey? }
//         Updates auto-recharge settings / stored billing key.
//
// The Claude plan is independent of the membership tiers: activating it grants
// Claude access on its own, regardless of which (if any) membership the account holds.
const PORTONE_API_BASE = 'https://api.portone.io'

const verifyPortOnePayment = async (
  paymentId: string,
  expectedKrw: number,
): Promise<{ ok: boolean; error?: string }> => {
  const apiSecret = process.env.PORTONE_V2_API_SECRET
  if (!apiSecret) return { ok: false, error: 'PORTONE_V2_API_SECRET 환경 변수가 설정되지 않았습니다.' }

  let res: Response
  try {
    res = await fetch(`${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      method: 'GET',
      headers: { Authorization: `PortOne ${apiSecret}` },
    })
  } catch {
    return { ok: false, error: 'PortOne 결제 조회에 실패했습니다.' }
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, error: `PortOne 결제 조회 실패 (${res.status}): ${detail.slice(0, 200)}` }
  }
  const payment = (await res.json()) as {
    status?: string
    amount?: { total?: number; paid?: number }
    currency?: string
  }
  if (payment.status !== 'PAID') {
    return { ok: false, error: `결제가 완료되지 않았습니다. (상태: ${payment.status || 'UNKNOWN'})` }
  }
  const paid = payment.amount?.total ?? payment.amount?.paid ?? 0
  if (paid !== expectedKrw) {
    return { ok: false, error: `결제 금액이 일치하지 않습니다. (기대: ${expectedKrw}, 실제: ${paid})` }
  }
  if (payment.currency && payment.currency !== 'KRW') {
    return { ok: false, error: `통화가 일치하지 않습니다. (${payment.currency})` }
  }
  return { ok: true }
}

const respond = (credits: ClaudeCredits, extra: Record<string, unknown> = {}) =>
  Response.json({
    success: true,
    credits: publicCredits(credits),
    activationPriceKrw: ACTIVATION_PRICE_KRW,
    activationGrantKrw: ACTIVATION_GRANT_KRW,
    rechargePacksKrw: RECHARGE_PACKS_KRW,
    marginMultiplier: MARGIN_MULTIPLIER,
    ...extra,
  })

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase().replace(/^biz\//, '')
  if (!username) {
    return Response.json({ error: '사용자 정보가 필요합니다.' }, { status: 400 })
  }

  try {
    if (req.method === 'GET') {
      const credits = await readClaudeCredits(username)
      return respond(credits)
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const kind: 'activation' | 'recharge' =
        (body as any)?.kind === 'recharge' ? 'recharge' : 'activation'
      const paymentId = String((body as any)?.paymentId || '').trim()
      const payMethod = String((body as any)?.payMethod || '').trim()
      const billingKey = String((body as any)?.billingKey || '').trim()
      const requestedAmount = Math.floor(Number((body as any)?.amountKrw) || 0)

      if (!paymentId) {
        return Response.json({ error: '결제 정보(paymentId)가 필요합니다.' }, { status: 400 })
      }

      // Activation is a fixed price; recharge must be one of the offered packs.
      const amountKrw = kind === 'activation' ? ACTIVATION_PRICE_KRW : requestedAmount
      if (kind === 'recharge' && !RECHARGE_PACKS_KRW.includes(amountKrw)) {
        return Response.json({ error: '유효하지 않은 충전 금액입니다.' }, { status: 400 })
      }

      const credits = await readClaudeCredits(username)

      // Idempotency: never credit the same PortOne payment twice.
      if (credits.grants.some((g) => g.paymentId && g.paymentId === paymentId)) {
        return respond(credits, { alreadyProcessed: true })
      }

      const verified = await verifyPortOnePayment(paymentId, amountKrw)
      if (!verified.ok) {
        return Response.json({ error: verified.error }, { status: 400 })
      }

      // Payment verified — grant credits 1:1 with the amount paid.
      const grantKrw = kind === 'activation' ? ACTIVATION_GRANT_KRW : amountKrw
      credits.balanceKrw += grantKrw
      credits.lifetimeChargedKrw += amountKrw
      if (kind === 'activation') {
        credits.planActive = true
        if (!credits.planActivatedAt) credits.planActivatedAt = new Date().toISOString()
      }
      if (billingKey) {
        credits.billingKey = billingKey
        credits.autoRecharge = true
      }
      credits.grants = [
        { at: new Date().toISOString(), amountKrw: grantKrw, kind, paymentId, payMethod },
        ...credits.grants,
      ].slice(0, 100)

      await writeClaudeCredits(username, credits)
      return respond(credits, { granted: { amountKrw: grantKrw, kind } })
    }

    if (req.method === 'PATCH') {
      const body = await req.json().catch(() => ({}))
      const credits = await readClaudeCredits(username)

      if (typeof (body as any)?.autoRecharge === 'boolean') {
        credits.autoRecharge = (body as any).autoRecharge
      }
      const amt = Math.floor(Number((body as any)?.autoRechargeAmountKrw) || 0)
      if (amt && RECHARGE_PACKS_KRW.includes(amt)) {
        credits.autoRechargeAmountKrw = amt
      }
      const billingKey = String((body as any)?.billingKey || '').trim()
      if (billingKey) credits.billingKey = billingKey
      // Turning auto-recharge on without a billing key is meaningless — reject it
      // so the client knows it must capture a billing key first.
      if (credits.autoRecharge && !credits.billingKey) {
        return Response.json(
          { error: '자동충전을 사용하려면 결제 수단(빌링키)을 먼저 등록해야 합니다.' },
          { status: 400 },
        )
      }

      await writeClaudeCredits(username, credits)
      return respond(credits)
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (e: any) {
    return Response.json(
      { error: e?.message || '클로드 크레딧 처리 중 오류가 발생했습니다.' },
      { status: 500 },
    )
  }
}

export const config: Config = {
  path: '/api/claude-credits/:username',
}
