import type { Config, Context } from '@netlify/functions'
import { confirmTossPayment } from './_shared/toss-payments.mts'
import { verifyLivePortOnePayment } from './_shared/portone-live-payment.mts'
import {
  ACTIVATION_GRANT_CREDITS,
  ACTIVATION_PRICE_KRW,
  CREDITS_PER_KRW,
  MARGIN_MULTIPLIER,
  RECHARGE_PACKS_KRW,
  creditsForKrw,
  readClaudeCredits,
  readClaudeCreditsSynced,
  syncClaudeRefunds,
  writeClaudeCredits,
  publicCredits,
  type ClaudeCredits,
  type ClaudeGrant,
} from './_shared/claude-credits.mts'

// Claude plan credit wallet API.
//
//   GET   /api/claude-credits/:username
//         → { credits, activationPriceKrw, activationGrantCredits, rechargePacksKrw, creditsPerKrw }
//
//   POST  /api/claude-credits/:username
//         body { kind: 'activation' | 'recharge', amountKrw, paymentId, payMethod }
//         Verifies a ONE-TIME PortOne payment server-side (status PAID, KRW, amount
//         matches) before granting credits — identical guarantee to live-time top-up.
//         The member pays in ₩; the wallet is credited in CREDITS at CREDITS_PER_KRW.
//         'activation' marks the plan active and grants the base 3,000 credits;
//         'recharge' tops up an already-active wallet with credits proportional to the
//         ₩ pack paid. The Claude plan is single-payment only — there is no recurring
//         or auto billing (recurring billing is reserved for the membership tiers).
//
// The Claude plan is independent of the membership tiers: activating it grants
// Claude access on its own, regardless of which (if any) membership the account holds.
const verifyPortOnePayment = async (
  paymentId: string,
  expectedKrw: number,
  payMethod: string,
): Promise<{ ok: boolean; error?: string }> => {
  const verified = await verifyLivePortOnePayment({ paymentId, expectedKrw, payMethod })
  return verified.ok ? { ok: true } : { ok: false, error: verified.error }
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
      // 잔액을 내려주기 전에 환불(결제 취소)된 충전분을 먼저 회수한다. 환불은 PG 콘솔에서
      // 처리되어 우리 서버를 거치지 않으므로, 이 시점에 확인해야 "환불했는데 포인트가 그대로"
      // 남는 상태가 생기지 않는다. `?refresh=1` 이면 조회 간격을 무시하고 즉시 확인한다.
      const force = new URL(req.url).searchParams.get('refresh') === '1'
      if (force) {
        const { credits: synced } = await syncClaudeRefunds(
          username,
          await readClaudeCredits(username),
          { force: true },
        ).catch(async () => ({ credits: await readClaudeCredits(username), revokedCredits: 0 }))
        return respond(synced)
      }
      return respond(await readClaudeCreditsSynced(username))
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const kind: 'activation' | 'recharge' =
        (body as any)?.kind === 'recharge' ? 'recharge' : 'activation'
      const payMethod = String((body as any)?.payMethod || '').trim()
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
      if (!isToss && !['CARD', 'TOSSPAY', 'KAKAOPAY'].includes(payMethod)) {
        return Response.json({ error: '유효한 결제 수단이 필요합니다.' }, { status: 400 })
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
        const verified = await verifyPortOnePayment(paymentId, amountKrw, payMethod)
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
      const grant: ClaudeGrant = {
        at: new Date().toISOString(),
        amountKrw,
        credits: grantCredits,
        kind,
        paymentId,
        payMethod,
        // 환불 조회를 어느 PG 에 해야 하는지 기록해 둔다(포트원 paymentId / 토스 paymentKey).
        provider: isToss ? 'toss' : 'portone',
      }
      credits.grants = [grant, ...credits.grants].slice(0, 100)

      await writeClaudeCredits(username, credits)
      return respond(credits, { granted: { credits: grantCredits, amountKrw, kind } })
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
