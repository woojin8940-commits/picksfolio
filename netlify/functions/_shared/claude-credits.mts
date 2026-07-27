import { getStore } from '@netlify/blobs'
import { lookupPaymentCancellation, type PaymentProvider } from './payment-cancellation.mts'
import { mutateBlobJSON } from './blob-write.mts'

/**
 * Claude (Anthropic) credit wallet for the collaboration AI assistant.
 *
 * The collaboration AI normally runs on Gemini Flash-Lite, which is bundled into
 * the AI-enabled memberships at no extra usage cost. Claude is offered as an
 * OPTIONAL premium model for heavier work (deep analysis, file/contract review)
 * and is sold SEPARATELY from the regular memberships through its own "클로드 플랜":
 *
 *   1. The member activates the Claude plan with a one-time ₩ payment that grants
 *      a base balance of CREDITS (a credit-denominated wallet, NOT ₩). The 9,900원
 *      activation grants 3,000 credits.
 *   2. Each Claude request deducts credits based on the actual tokens it consumed,
 *      with an operator margin baked into the deduction rate — so the credit price
 *      always exceeds the raw inference cost and the feature can never run at a loss.
 *   3. When the balance runs low the member recharges manually with another one-time
 *      ₩ payment, converted to credits at the same rate. The Claude plan is single-
 *      payment only — there is no recurring/auto billing (that is reserved for the
 *      membership tiers).
 *
 * Money vs. credits: amounts the member actually PAYS stay in ₩ (activation price,
 * recharge packs, auto-recharge amount, lifetime charged). The wallet BALANCE and
 * per-request deductions are denominated in CREDITS and are what the UI shows — the
 * member never sees their AI balance in ₩. Credits convert from ₩ at a fixed rate
 * (CREDITS_PER_KRW) anchored on the 9,900원 → 3,000 credit activation grant.
 *
 * Credits are a prepaid wallet (NOT monthly-scoped — unlike live-time credits they
 * carry over until spent). The wallet lives in the Netlify Blobs `claude-credits`
 * store, one document per bare username (the `biz/` prefix is stripped by callers
 * so a business account and an influencer account share one wallet).
 */

// ── Pricing ────────────────────────────────────────────────────────────────
// Claude model used for the premium option. Sonnet is the quality tier that
// justifies the upgrade over Gemini for heavy analysis / document review.
export const CLAUDE_MODEL = 'claude-sonnet-4-6'

export const USD_TO_KRW = 1380

// claude-sonnet-4-6 list price (USD per 1M tokens) as billed through AI Gateway.
const INPUT_USD_PER_MTOK = 3
const OUTPUT_USD_PER_MTOK = 15
// Anthropic cache multipliers: writing the cache costs 1.25× input, reading from
// it costs 0.10× input. We mirror these so the deduction tracks the true cost and
// the member benefits from caching on long conversations (cheaper repeat context).
const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER = 0.1

// Operator margin: the member is charged this multiple of the raw inference cost.
// Because the deduction is always ≥ cost × margin, the wallet can never run a loss.
export const MARGIN_MULTIPLIER = 2.5
// Floor (in credits) so a near-empty request still deducts something sensible.
const MIN_DEDUCTION_CREDITS = 1

// Plan economics. Members PAY in ₩ (activation price, recharge packs) but the
// wallet is denominated in CREDITS. The activation grant anchors the conversion
// rate: 9,900원 buys 3,000 credits. The margin is already inside the per-request
// deduction, so a full wallet costs the operator only its ₩-equivalent / margin in
// real inference.
export const ACTIVATION_PRICE_KRW = 9900
export const ACTIVATION_GRANT_CREDITS = 3000
// Credits granted per ₩ paid. Recharges grant credits proportionally at this rate.
export const CREDITS_PER_KRW = ACTIVATION_GRANT_CREDITS / ACTIVATION_PRICE_KRW
/** Credits granted for a ₩ payment (activation grant rate). */
export const creditsForKrw = (amountKrw: number): number =>
  Math.max(0, Math.round((Number(amountKrw) || 0) * CREDITS_PER_KRW))
export const RECHARGE_PACKS_KRW = [4900, 9900, 19900]

export interface ClaudeTokenUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

/** Raw inference cost (₩) for a single Claude response, mirroring gateway billing. */
export const rawCostKrw = (usage: ClaudeTokenUsage): number => {
  const input = Math.max(0, Number(usage.input_tokens) || 0)
  const cacheWrite = Math.max(0, Number(usage.cache_creation_input_tokens) || 0)
  const cacheRead = Math.max(0, Number(usage.cache_read_input_tokens) || 0)
  const output = Math.max(0, Number(usage.output_tokens) || 0)
  const inputUsd =
    ((input + cacheWrite * CACHE_WRITE_MULTIPLIER + cacheRead * CACHE_READ_MULTIPLIER) /
      1_000_000) *
    INPUT_USD_PER_MTOK
  const outputUsd = (output / 1_000_000) * OUTPUT_USD_PER_MTOK
  return (inputUsd + outputUsd) * USD_TO_KRW
}

/** Credits to deduct for a response = raw cost × margin, converted to credits
 * at the activation rate (with a small floor so every answer costs something). */
export const deductionCredits = (usage: ClaudeTokenUsage): number =>
  Math.max(
    MIN_DEDUCTION_CREDITS,
    Math.round(rawCostKrw(usage) * MARGIN_MULTIPLIER * CREDITS_PER_KRW),
  )

// ── Wallet storage ───────────────────────────────────────────────────────────
export interface ClaudeGrant {
  at: string
  // ₩ actually paid for this grant (real money).
  amountKrw: number
  // Credits added to the wallet for this grant.
  credits: number
  kind: 'activation' | 'recharge' | 'auto'
  paymentId?: string
  payMethod?: string
  // Which PG processed the payment — decides where a refund is looked up.
  provider?: PaymentProvider
  // Refund bookkeeping. Set when the payment behind this grant was cancelled in
  // the PG console and the granted credits were clawed back (see syncClaudeRefunds).
  refundedAt?: string
  refundedKrw?: number
  refundedCredits?: number
}

export interface ClaudeUsageEntry {
  at: string
  model: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  // Raw inference cost (₩) kept for operator bookkeeping; the member is charged
  // in credits (chargedCredits).
  costKrw: number
  chargedCredits: number
}

export interface ClaudeCredits {
  planActive: boolean
  planActivatedAt: string | null
  // Wallet balance in CREDITS (the unit shown to the member), not ₩.
  balanceCredits: number
  grants: ClaudeGrant[]
  usage: ClaudeUsageEntry[]
  // Lifetime ₩ actually paid (real money) and lifetime credits spent.
  lifetimeChargedKrw: number
  lifetimeSpentCredits: number
  // Lifetime ₩ refunded and credits clawed back for those refunds.
  lifetimeRefundedKrw: number
  lifetimeRefundedCredits: number
  // Last time the PG was asked whether any grant payment had been cancelled.
  lastRefundSyncAt: string | null
}

const STORE = 'claude-credits'
const creditsKey = (username: string) => `credits_${username}`
const COMPLIMENTARY_CLAUDE_BALANCE_CREDITS = ACTIVATION_GRANT_CREDITS
const COMPLIMENTARY_CLAUDE_USERS = new Set(['dnwlsdnwls'])

const blank = (): ClaudeCredits => ({
  planActive: false,
  planActivatedAt: null,
  balanceCredits: 0,
  grants: [],
  usage: [],
  lifetimeChargedKrw: 0,
  lifetimeSpentCredits: 0,
  lifetimeRefundedKrw: 0,
  lifetimeRefundedCredits: 0,
  lastRefundSyncAt: null,
})

const applyComplimentaryClaudePlan = (username: string, credits: ClaudeCredits): ClaudeCredits => {
  const clean = username.toLowerCase().replace(/^biz\//, '')
  if (!COMPLIMENTARY_CLAUDE_USERS.has(clean)) return credits
  return {
    ...credits,
    planActive: true,
    planActivatedAt: credits.planActivatedAt || new Date().toISOString(),
    balanceCredits: Math.max(credits.balanceCredits, COMPLIMENTARY_CLAUDE_BALANCE_CREDITS),
  }
}

/** 저장된 원본(구버전 ₩ 필드 포함)을 현재 스키마로 맞춘다. */
type StoredCredits =
  | (Partial<ClaudeCredits> & {
      // Legacy ₩-denominated fields, migrated to credits on read (see below).
      balanceKrw?: number
      lifetimeSpentKrw?: number
    })
  | null

const normalizeStoredCredits = (username: string, stored: StoredCredits): ClaudeCredits => {
  if (!stored) return applyComplimentaryClaudePlan(username, blank())
  const base = blank()
  // Migrate wallets written before the ₩→credit switch: their balance was held in
  // ₩, so convert at the activation rate (9,900원 → 3,000 credits).
  const balanceCredits =
    stored.balanceCredits != null
      ? Math.max(0, Math.floor(Number(stored.balanceCredits) || 0))
      : creditsForKrw(Number(stored.balanceKrw) || 0)
  const lifetimeSpentCredits =
    stored.lifetimeSpentCredits != null
      ? Math.max(0, Math.floor(Number(stored.lifetimeSpentCredits) || 0))
      : creditsForKrw(Number(stored.lifetimeSpentKrw) || 0)
  return applyComplimentaryClaudePlan(username, {
    ...base,
    ...stored,
    balanceCredits,
    lifetimeSpentCredits,
    grants: Array.isArray(stored.grants) ? stored.grants : [],
    usage: Array.isArray(stored.usage) ? stored.usage : [],
  })
}

export const readClaudeCredits = async (username: string): Promise<ClaudeCredits> => {
  const store = getStore(STORE)
  const stored = (await store
    .get(creditsKey(username), { type: 'json' })
    .catch(() => null)) as StoredCredits
  return normalizeStoredCredits(username, stored)
}

export const writeClaudeCredits = async (
  username: string,
  credits: ClaudeCredits,
): Promise<void> => {
  const store = getStore(STORE)
  await store.setJSON(creditsKey(username), credits)
}

/**
 * 지갑을 "읽고 → 고치고 → 쓰는" 안전한 방법.
 *
 * 이 지갑은 세 곳에서 동시에 고쳐진다: AI 호출 시 차감, 크레딧 충전, 환불 반영.
 * 통째로 읽고 다시 쓰면 그 사이 일어난 다른 변경이 사라진다(충전과 차감이 겹치면
 * 충전분이 날아가거나 차감이 무시된다). 저장 직전에 값이 그대로인지 확인하고,
 * 바뀌었으면 최신 값으로 다시 계산한다.
 *
 * mutate 는 최신 지갑을 받아 새 지갑을 반환한다. null 을 반환하면 쓰지 않는다.
 */
export const mutateClaudeCredits = async (
  username: string,
  mutate: (credits: ClaudeCredits) => ClaudeCredits | null,
): Promise<ClaudeCredits> => {
  const result = await mutateBlobJSON<any>(STORE, creditsKey(username), (raw) =>
    mutate(normalizeStoredCredits(username, raw as StoredCredits)),
  )
  return normalizeStoredCredits(username, result as StoredCredits)
}

// ── Refunds ──────────────────────────────────────────────────────────────────
/**
 * 환불(결제 취소) 반영.
 *
 * 크레딧 충전 결제가 취소되면 지급된 크레딧도 같은 금액만큼 사라져야 한다. 그런데 환불은
 * 우리 서버를 거치지 않고 PG 관리자 콘솔에서 처리되는 경우가 많아, 지갑은 결제 취소 사실을
 * 스스로 알 수 없다. 그래서 지갑을 읽는 시점(잔액 조회, 클로드 호출 직전)에 아직 환불 반영이
 * 끝나지 않은 지급 건의 결제 상태를 PG 에 물어보고, 취소된 금액만큼 크레딧을 환수한다.
 *
 * - 부분 취소도 취소 금액 비율만큼만 환수한다(₩ 대비 크레딧 비례).
 * - 이미 써버린 크레딧 때문에 잔액이 음수가 되는 일은 없다(0 에서 멈춘다). 남은 잔액이
 *   환수액보다 적으면 그만큼만 줄어들고, 초과분은 회수하지 않는다.
 * - 지급 건별 환수 누적액(refundedKrw/refundedCredits)을 기록해 두 번 환수하지 않는다.
 * - 플랜 시작 결제(activation)가 전액 취소되면 클로드 플랜도 비활성으로 되돌린다.
 */
// 지갑을 읽을 때마다 PG 를 호출하면 응답이 느려지므로 최소 간격을 둔다.
const REFUND_SYNC_INTERVAL_MS = 5 * 60 * 1000
// 한 번의 동기화에서 조회할 결제 건수 상한(오래된 지갑에 지급 기록이 많을 수 있다).
const REFUND_SYNC_MAX_LOOKUPS = 8
// 결제 후 이 기간이 지난 건은 더 이상 조회하지 않는다(카드사 취소 가능 기간을 넉넉히 커버).
const REFUND_SYNC_WINDOW_MS = 180 * 24 * 60 * 60 * 1000

const isRefundSyncCandidate = (grant: ClaudeGrant, now: number): boolean => {
  if (!grant.paymentId) return false // 결제 없이 지급된 건(운영 지급 등)은 환불 대상이 아니다.
  if ((grant.refundedKrw || 0) >= (Number(grant.amountKrw) || 0)) return false // 이미 전액 환수
  const at = Date.parse(grant.at || '')
  if (Number.isFinite(at) && now - at > REFUND_SYNC_WINDOW_MS) return false
  return true
}

/** 지급 건 하나에 취소 금액을 반영하고, 환수한 크레딧 수를 돌려준다. */
const applyGrantRefund = (
  credits: ClaudeCredits,
  grant: ClaudeGrant,
  cancelledKrw: number,
): number => {
  const amountKrw = Math.max(0, Number(grant.amountKrw) || 0)
  const grantedCredits = Math.max(0, Number(grant.credits) || 0)
  const refundedKrwSoFar = Math.max(0, Number(grant.refundedKrw) || 0)
  // 이 지급 건에 해당하는 취소 금액만 인정한다(결제 총액을 넘을 수 없다).
  const newlyRefundedKrw = Math.min(amountKrw, Math.max(0, cancelledKrw)) - refundedKrwSoFar
  if (newlyRefundedKrw <= 0) return 0

  const refundedCreditsSoFar = Math.max(0, Number(grant.refundedCredits) || 0)
  const share = amountKrw > 0 ? newlyRefundedKrw / amountKrw : 0
  const revoke = Math.min(
    Math.max(0, grantedCredits - refundedCreditsSoFar),
    Math.round(grantedCredits * share),
  )

  // 이미 사용한 크레딧까지 회수하지는 못하므로 잔액은 0 에서 멈춘다.
  credits.balanceCredits = Math.max(0, credits.balanceCredits - revoke)
  credits.lifetimeChargedKrw = Math.max(0, (credits.lifetimeChargedKrw || 0) - newlyRefundedKrw)
  credits.lifetimeRefundedKrw = (credits.lifetimeRefundedKrw || 0) + newlyRefundedKrw
  credits.lifetimeRefundedCredits = (credits.lifetimeRefundedCredits || 0) + revoke

  grant.refundedKrw = refundedKrwSoFar + newlyRefundedKrw
  grant.refundedCredits = refundedCreditsSoFar + revoke
  grant.refundedAt = new Date().toISOString()
  return revoke
}

/**
 * 아직 환불 반영이 끝나지 않은 지급 건의 결제 취소 여부를 PG 에서 확인하고 크레딧을 환수한다.
 * 변경이 있으면 지갑을 저장하고, 반영된 지갑을 돌려준다.
 */
export const syncClaudeRefunds = async (
  username: string,
  credits: ClaudeCredits,
  options: { force?: boolean } = {},
): Promise<{ credits: ClaudeCredits; revokedCredits: number }> => {
  const now = Date.now()
  const lastSync = Date.parse(credits.lastRefundSyncAt || '')
  if (
    !options.force &&
    Number.isFinite(lastSync) &&
    now - lastSync < REFUND_SYNC_INTERVAL_MS
  ) {
    return { credits, revokedCredits: 0 }
  }

  const candidates = credits.grants.filter((g) => isRefundSyncCandidate(g, now))
  if (candidates.length === 0) {
    // 확인할 결제가 없으면 저장까지 할 필요는 없다(다음 요청에서 다시 훑어도 저렴하다).
    return { credits, revokedCredits: 0 }
  }

  const targets = candidates.slice(0, REFUND_SYNC_MAX_LOOKUPS)

  let revokedCredits = 0
  let checked = 0
  // PG 조회 결과(지급 건별 취소 금액)를 먼저 모은다. 실제 지갑 반영은 조건부 쓰기
  // 안에서 최신 값에 대고 다시 계산해야, 그 사이 일어난 충전·차감이 사라지지 않는다.
  const cancellations: { paymentId: string; cancelledKrw: number }[] = []
  for (const grant of targets) {
    const lookup = await lookupPaymentCancellation(grant.paymentId!, grant.provider)
    if (!lookup.ok) continue // 조회 실패/미확인 건은 건드리지 않는다(오차감 방지).
    checked += 1
    if (lookup.cancelledKrw > 0) {
      cancellations.push({ paymentId: grant.paymentId!, cancelledKrw: lookup.cancelledKrw })
    }
  }

  if (checked === 0) {
    // PG 조회가 전부 실패했다면 동기화 시각을 갱신하지 않고 다음 요청에서 다시 시도한다.
    return { credits, revokedCredits: 0 }
  }

  const saved = await mutateClaudeCredits(username, (latest) => {
    const draft: ClaudeCredits = {
      ...latest,
      grants: latest.grants.map((g) => ({ ...g })),
    }

    revokedCredits = 0
    for (const { paymentId, cancelledKrw } of cancellations) {
      const grant = draft.grants.find((g) => g.paymentId === paymentId)
      if (grant) revokedCredits += applyGrantRefund(draft, grant, cancelledKrw)
    }

    draft.lastRefundSyncAt = new Date().toISOString()

    // 플랜 시작 결제가 전액 취소되면 클로드 플랜 자체를 비활성으로 되돌린다.
    const activationGrants = draft.grants.filter((g) => g.kind === 'activation' && g.paymentId)
    const activationFullyRefunded =
      activationGrants.length > 0 &&
      activationGrants.every((g) => (g.refundedKrw || 0) >= (Number(g.amountKrw) || 0))
    if (activationFullyRefunded && draft.planActive) {
      draft.planActive = false
      draft.planActivatedAt = null
    }

    return draft
  })

  // 무료 제공 계정은 환불과 무관하게 플랜/잔액이 유지되어야 하므로 오버레이를 다시 적용한다.
  return { credits: applyComplimentaryClaudePlan(username, saved), revokedCredits }
}

/** 지갑을 읽고 환불 반영까지 마친 상태를 돌려준다. */
export const readClaudeCreditsSynced = async (username: string): Promise<ClaudeCredits> => {
  const credits = await readClaudeCredits(username)
  try {
    const { credits: synced } = await syncClaudeRefunds(username, credits)
    return synced
  } catch (e) {
    // 환불 동기화 실패가 잔액 조회나 AI 응답을 막아서는 안 된다.
    console.warn('[ClaudeCredits] refund sync failed:', (e as Error)?.message)
    return credits
  }
}

/** Public-facing summary. */
export const publicCredits = (c: ClaudeCredits) => ({
  planActive: c.planActive,
  planActivatedAt: c.planActivatedAt,
  balanceCredits: c.balanceCredits,
  recentUsage: c.usage.slice(0, 10),
  // 환불로 회수된 크레딧(누적) — 잔액이 줄어든 이유를 화면에서 안내할 수 있게 함께 내려준다.
  refundedCredits: c.lifetimeRefundedCredits || 0,
  refundedKrw: c.lifetimeRefundedKrw || 0,
})
