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
  mutateClaudeCredits,
  readClaudeCredits,
  readClaudeCreditsSynced,
  syncClaudeRefunds,
  publicCredits,
  type ClaudeCredits,
  type ClaudeGrant,
} from './_shared/claude-credits.mts'
import { requireAccountOwner } from './_shared/user-auth.mts'

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
  expectedOwner: string,
): Promise<{ ok: boolean; error?: string }> => {
  const verified = await verifyLivePortOnePayment({
    paymentId,
    expectedKrw,
    payMethod,
    // 남의 결제번호를 주워와 자기 지갑에 적립하는 것을 막는다.
    expectedOwner,
  })
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

  // 지갑 잔액·결제 이력이며, 쓰기는 크레딧을 지급한다. 본인(또는 관리자)만.
  const auth = await requireAccountOwner(req, username)
  if (!auth.ok) return auth.response

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
      // (이 확인은 PG 검증 전에 하는 빠른 차단용이다. 두 요청이 동시에 들어오면 둘 다
      //  통과할 수 있으므로, 실제 지급 직전에 최신 지갑으로 한 번 더 확인한다.)
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
        const verified = await verifyPortOnePayment(paymentId, amountKrw, payMethod, username)
        if (!verified.ok) {
          return Response.json({ error: verified.error }, { status: 400 })
        }
      }

      // Payment verified — grant credits. Activation grants the fixed base; a
      // recharge grants credits proportional to the ₩ paid. lifetimeChargedKrw
      // tracks real money; the wallet balance tracks credits.
      const grantCredits =
        kind === 'activation' ? ACTIVATION_GRANT_CREDITS : creditsForKrw(amountKrw)
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

      // 지급은 최신 지갑에 대고 조건부로 쓴다. 그래야 (1) 결제 확인에 걸리는 시간 동안
      // 겹쳐 들어온 같은 결제가 두 번 지급되지 않고, (2) 그 사이 AI 사용으로 차감된
      // 크레딧이 되살아나지 않는다.
      let duplicated = false
      const saved = await mutateClaudeCredits(username, (latest) => {
        if (latest.grants.some((g) => g.paymentId && g.paymentId === paymentId)) {
          duplicated = true
          return null
        }
        duplicated = false

        const next: ClaudeCredits = {
          ...latest,
          balanceCredits: latest.balanceCredits + grantCredits,
          lifetimeChargedKrw: latest.lifetimeChargedKrw + amountKrw,
          grants: [grant, ...latest.grants].slice(0, 100),
        }
        if (kind === 'activation') {
          next.planActive = true
          if (!next.planActivatedAt) next.planActivatedAt = grant.at
        }
        return next
      })

      if (duplicated) {
        return respond(saved, { alreadyProcessed: true })
      }
      return respond(saved, { granted: { credits: grantCredits, amountKrw, kind } })
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
