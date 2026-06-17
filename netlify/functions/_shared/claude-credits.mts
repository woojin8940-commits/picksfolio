import { getStore } from '@netlify/blobs'
import { chargeTossBillingKey } from './toss-payments.mts'

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
 *   3. When the balance runs low the member either recharges manually (another
 *      one-time ₩ payment, converted to credits at the same rate) or, if they opted
 *      in, the server auto-recharges via a stored PortOne billing key.
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
export const AUTO_RECHARGE_DEFAULT_KRW = 9900
// When the credit balance falls below this after a request, auto-recharge (if
// enabled) tops the wallet back up using the stored billing key.
export const AUTO_RECHARGE_THRESHOLD_CREDITS = 300
// Safety cap: never auto-recharge more than this many times per calendar day, so
// a runaway loop or abuse cannot rack up unbounded billing-key charges.
export const AUTO_RECHARGE_DAILY_CAP = 5

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
  autoRecharge: boolean
  // Auto-recharge tops up by PAYING this many ₩ (a recharge pack); the resulting
  // credits are granted at CREDITS_PER_KRW.
  autoRechargeAmountKrw: number
  // Stored billing key used for auto-recharge. Held in the wallet (not the
  // membership record) so the Claude plan stays independent of the membership.
  billingKey: string | null
  // Which provider issued the billing key: 'portone' (토스페이/카카오페이) or 'toss'
  // (토스페이먼츠 카드, 토스페이먼츠 직접 연동). Defaults to 'portone' for legacy keys.
  billingProvider?: 'portone' | 'toss'
  // TossPayments billing requires the customerKey used at issue time on every charge.
  billingCustomerKey?: string | null
  // Per-day count of automatic recharges, used to enforce AUTO_RECHARGE_DAILY_CAP.
  autoRechargeDay: string | null
  autoRechargeCountToday: number
  grants: ClaudeGrant[]
  usage: ClaudeUsageEntry[]
  // Lifetime ₩ actually paid (real money) and lifetime credits spent.
  lifetimeChargedKrw: number
  lifetimeSpentCredits: number
}

const STORE = 'claude-credits'
const creditsKey = (username: string) => `credits_${username}`

const blank = (): ClaudeCredits => ({
  planActive: false,
  planActivatedAt: null,
  balanceCredits: 0,
  autoRecharge: false,
  autoRechargeAmountKrw: AUTO_RECHARGE_DEFAULT_KRW,
  billingKey: null,
  billingProvider: 'portone',
  billingCustomerKey: null,
  autoRechargeDay: null,
  autoRechargeCountToday: 0,
  grants: [],
  usage: [],
  lifetimeChargedKrw: 0,
  lifetimeSpentCredits: 0,
})

export const readClaudeCredits = async (username: string): Promise<ClaudeCredits> => {
  const store = getStore(STORE)
  const stored = (await store
    .get(creditsKey(username), { type: 'json' })
    .catch(() => null)) as (Partial<ClaudeCredits> & {
    // Legacy ₩-denominated fields, migrated to credits on read (see below).
    balanceKrw?: number
    lifetimeSpentKrw?: number
  }) | null
  if (!stored) return blank()
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
  return {
    ...base,
    ...stored,
    balanceCredits,
    lifetimeSpentCredits,
    autoRechargeAmountKrw:
      Math.floor(Number(stored.autoRechargeAmountKrw) || 0) || AUTO_RECHARGE_DEFAULT_KRW,
    grants: Array.isArray(stored.grants) ? stored.grants : [],
    usage: Array.isArray(stored.usage) ? stored.usage : [],
  }
}

export const writeClaudeCredits = async (
  username: string,
  credits: ClaudeCredits,
): Promise<void> => {
  const store = getStore(STORE)
  await store.setJSON(creditsKey(username), credits)
}

/** Public-facing summary (omits the billing key; exposes only whether one exists). */
export const publicCredits = (c: ClaudeCredits) => ({
  planActive: c.planActive,
  planActivatedAt: c.planActivatedAt,
  balanceCredits: c.balanceCredits,
  autoRecharge: c.autoRecharge,
  autoRechargeAmountKrw: c.autoRechargeAmountKrw,
  hasBillingKey: !!c.billingKey,
  recentUsage: c.usage.slice(0, 10),
})

// ── PortOne billing-key charge (auto-recharge) ────────────────────────────────
// storeId is a public PortOne V2 identifier (same one the browser SDK uses for
// one-time payments); the API secret is server-only.
const PORTONE_API_BASE = 'https://api.portone.io'
const PORTONE_STORE_ID = 'store-1e85edf9-8f37-490c-9419-5a1f15db9ab5'

const asciiSafe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'user'

/**
 * Charge `amountKrw` against a stored billing key (used for auto-recharge, which has
 * no interactive payment window). Branches by provider: 'toss' uses the TossPayments
 * billing API (토스페이먼츠 카드), anything else uses PortOne (토스페이/카카오페이).
 * Returns the verified payment id on success. Fails softly — the caller skips the
 * top-up and asks the member to recharge manually rather than blocking their request.
 */
export const chargeBillingKey = async (
  username: string,
  billingKey: string,
  amountKrw: number,
  opts?: { provider?: 'portone' | 'toss'; customerKey?: string | null },
): Promise<{ success: boolean; paymentId?: string; error?: string }> => {
  const paymentId = `claudeauto-${asciiSafe(username)}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`

  if (opts?.provider === 'toss') {
    if (!opts.customerKey) return { success: false, error: '토스페이먼츠 customerKey 누락' }
    const charge = await chargeTossBillingKey(
      billingKey,
      opts.customerKey,
      amountKrw,
      paymentId,
      `클로드 크레딧 자동충전 ${amountKrw.toLocaleString()}원`,
    )
    if (!charge.ok) return { success: false, error: charge.error }
    return { success: true, paymentId: charge.paymentKey || paymentId }
  }

  const apiSecret = process.env.PORTONE_V2_API_SECRET
  if (!apiSecret) return { success: false, error: 'PORTONE_V2_API_SECRET 미설정' }

  try {
    const res = await fetch(
      `${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}/billing-key`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `PortOne ${apiSecret}`,
        },
        body: JSON.stringify({
          billingKey,
          storeId: PORTONE_STORE_ID,
          orderName: `클로드 크레딧 자동충전 ${amountKrw.toLocaleString()}원`,
          customer: { customerId: asciiSafe(username) },
          amount: { total: amountKrw },
          currency: 'KRW',
        }),
      },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { success: false, error: `PortOne ${res.status}: ${detail.slice(0, 200)}` }
    }
    return { success: true, paymentId }
  } catch (e: any) {
    return { success: false, error: e?.message || 'PortOne 자동충전 요청 실패' }
  }
}
