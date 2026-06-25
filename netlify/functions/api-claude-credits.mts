import type { Config, Context } from '@netlify/functions'
import { confirmTossPayment, issueTossBillingKey } from './_shared/toss-payments.mts'
import {
  ACTIVATION_GRANT_CREDITS,
  ACTIVATION_PRICE_KRW,
  AUTO_RECHARGE_DEFAULT_KRW,
  CREDITS_PER_KRW,
  MARGIN_MULTIPLIER,
  RECHARGE_PACKS_KRW,
  creditsForKrw,
  chargeBillingKey,
  readClaudeCredits,
  writeClaudeCredits,
  publicCredits,
  type ClaudeCredits,
} from './_shared/claude-credits.mts'

// Claude plan credit wallet API.
//
//   GET   /api/claude-credits/:username
//         → { credits, activationPriceKrw, activationGrantCredits, rechargePacksKrw, creditsPerKrw }
//
//   POST  /api/claude-credits/:username
//         body { kind: 'activation' | 'recharge', amountKrw, paymentId, payMethod, billingKey? }
//         Verifies a ONE-TIME PortOne payment server-side (status PAID, KRW, amount
//         matches) before granting credits — identical guarantee to live-time top-up.
//         The member pays in ₩; the wallet is credited in CREDITS at CREDITS_PER_KRW.
//         'activation' marks the plan active and grants the base 3,000 credits;
//         'recharge' tops up an already-active wallet with credits proportional to the
//         ₩ pack paid. A billingKey may be supplied to enable auto-recharge in the
//         same step.
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
    activationGrantCredits: ACTIVATION_GRANT_CREDITS,
    rechargePacksKrw: RECHARGE_PACKS_KRW,
    creditsPerKrw: CREDITS_PER_KRW,
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
      const payMethod = String((body as any)?.payMethod || '').trim()
      const billingKey = String((body as any)?.billingKey || '').trim()
      const requestedAmount = Math.floor(Number((body as any)?.amountKrw) || 0)
      const provider = String((body as any)?.provider || '').trim().toLowerCase()
      const isToss = provider === 'toss'
      // PortOne identifies a one-time payment by paymentId; TossPayments by paymentKey.
      const paymentKey = String((body as any)?.paymentKey || '').trim()
      const orderId = String((body as any)?.orderId || '').trim()
      const paymentId = isToss ? paymentKey : String((body as any)?.paymentId || '').trim()

      if (payMethod !== 'CARD') {
        return Response.json(
          { error: '클로드 플랜은 신용/체크카드 결제만 가능합니다. 간편결제는 지원하지 않습니다.' },
          { status: 400 },
        )
      }
      if (!paymentId) {
        return Response.json({ error: '결제 정보(paymentId)가 필요합니다.' }, { status: 400 })
      }
      if (isToss && !orderId) {
        return Response.json({ error: '결제 정보(orderId)가 필요합니다.' }, { status: 400 })
      }

      // Activation is a fixed price; recharge must be one of the offered packs.
      const amountKrw = kind === 'activation' ? ACTIVATION_PRICE_KRW : requestedAmount
      if (kind === 'recharge' && !RECHARGE_PACKS_KRW.includes(amountKrw)) {
        return Response.json({ error: '유효하지 않은 충전 금액입니다.' }, { status: 400 })
      }

      const credits = await readClaudeCredits(username)

      // Idempotency: never credit the same payment twice.
      if (credits.grants.some((g) => g.paymentId && g.paymentId === paymentId)) {
        return respond(credits, { alreadyProcessed: true })
      }

      if (isToss) {
        // 토스페이먼츠(카드) — confirm (실제 매입) and match the amount.
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
        const verified = await verifyPortOnePayment(paymentId, amountKrw)
        if (!verified.ok) {
          return Response.json({ error: verified.error }, { status: 400 })
        }
      }

      // Payment verified — grant credits. Activation grants the fixed base; a
      // recharge grants credits proportional to the ₩ paid. lifetimeChargedKrw
      // tracks real money; the wallet balance tracks credits.
      const grantCredits =
        kind === 'activation' ? ACTIVATION_GRANT_CREDITS : creditsForKrw(amountKrw)
      credits.balanceCredits += grantCredits
      credits.lifetimeChargedKrw += amountKrw
      if (kind === 'activation') {
        credits.planActive = true
        if (!credits.planActivatedAt) credits.planActivatedAt = new Date().toISOString()
      }
      if (billingKey) {
        // A billing key supplied alongside a one-time payment is always a PortOne
        // (토스페이/카카오페이) key — TossPayments card billing is registered via the
        // PATCH/authKey path, never here.
        credits.billingKey = billingKey
        credits.billingProvider = 'portone'
        credits.billingCustomerKey = null
        credits.autoRecharge = true
      }
      credits.grants = [
        {
          at: new Date().toISOString(),
          amountKrw,
          credits: grantCredits,
          kind,
          paymentId,
          payMethod,
        },
        ...credits.grants,
      ].slice(0, 100)

      await writeClaudeCredits(username, credits)
      return respond(credits, { granted: { credits: grantCredits, amountKrw, kind } })
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

      const provider = String((body as any)?.provider || '').trim().toLowerCase()
      if (provider === 'toss') {
        // 토스페이먼츠(카드) 자동충전 — requestBillingAuth 후 받은 authKey·customerKey 를
        // 서버에서 빌링키로 교환해 저장한다. (토스페이/카카오페이는 PortOne billingKey 사용.)
        const authKey = String((body as any)?.authKey || '').trim()
        const customerKey = String((body as any)?.customerKey || '').trim()
        if (!authKey || !customerKey) {
          return Response.json({ error: '결제수단 등록 정보(authKey)가 필요합니다.' }, { status: 400 })
        }
        const issued = await issueTossBillingKey(authKey, customerKey)
        if (!issued.ok || !issued.billingKey) {
          return Response.json({ error: issued.error || '토스페이먼츠 결제수단 등록에 실패했습니다.' }, { status: 400 })
        }
        credits.billingKey = issued.billingKey
        credits.billingProvider = 'toss'
        credits.billingCustomerKey = customerKey
      } else {
        const billingKey = String((body as any)?.billingKey || '').trim()
        if (billingKey) {
          credits.billingKey = billingKey
          credits.billingProvider = 'portone'
          credits.billingCustomerKey = null
        }
      }
      // Turning auto-recharge on without a billing key is meaningless — reject it
      // so the client knows it must capture a billing key first.
      if (credits.autoRecharge && !credits.billingKey) {
        return Response.json(
          { error: '자동충전을 사용하려면 결제 수단(빌링키)을 먼저 등록해야 합니다.' },
          { status: 400 },
        )
      }

      if ((body as any)?.activatePlan && !credits.planActive) {
        if (!credits.billingKey) {
          return Response.json(
            { error: '클로드 플랜 첫 결제를 위해 카드 자동결제 수단을 먼저 등록해야 합니다.' },
            { status: 400 },
          )
        }
        const charged = await chargeBillingKey(username, credits.billingKey, ACTIVATION_PRICE_KRW, {
          provider: credits.billingProvider,
          customerKey: credits.billingCustomerKey,
        })
        if (!charged.success) {
          return Response.json(
            { error: charged.error || '클로드 플랜 첫 결제에 실패했습니다. 카드를 확인해 주세요.' },
            { status: 400 },
          )
        }

        credits.planActive = true
        credits.planActivatedAt = new Date().toISOString()
        credits.balanceCredits += ACTIVATION_GRANT_CREDITS
        credits.lifetimeChargedKrw += ACTIVATION_PRICE_KRW
        credits.autoRecharge = true
        credits.grants = [
          {
            at: new Date().toISOString(),
            amountKrw: ACTIVATION_PRICE_KRW,
            credits: ACTIVATION_GRANT_CREDITS,
            kind: 'activation',
            paymentId: charged.paymentId,
            payMethod: 'CARD',
          },
          ...credits.grants,
        ].slice(0, 100)
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
