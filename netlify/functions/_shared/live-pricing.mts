/**
 * Pickfolio live commerce pricing constants and helpers.
 *
 * Commerce membership (월 13,900원) includes 3 hours of live broadcast time
 * per calendar month. Overage is billed postpaid at 8,900원/시간 (≈148.33원/분).
 * Live sales carry an 8.5% commission (PG fee included; Pickfolio nets ≈5.5%).
 *
 * Hard caps (advisory in this module — enforcement is layered separately):
 *   일 송출 한도 8시간 / 월 송출 한도 50시간.
 *
 * The aggregation helpers here read from `broadcast_history.duration_minutes`
 * which is already populated by `api-broadcast-history` on every live stop.
 */

export const INCLUDED_MINUTES_PER_MONTH = 180 // 3 hours
export const OVERAGE_RATE_KRW_PER_HOUR = 8900
export const OVERAGE_RATE_KRW_PER_MINUTE = OVERAGE_RATE_KRW_PER_HOUR / 60 // ≈148.33

export const DAILY_HARD_CAP_MINUTES = 8 * 60 // 480
export const MONTHLY_HARD_CAP_MINUTES = 50 * 60 // 3000
export const THRESHOLD_BILLING_AMOUNT_KRW = 30000

export const LIVE_COMMISSION_RATE = 0.085 // 8.5% — PG fee included
export const PG_FEE_RATE_ESTIMATE = 0.03 // ≈3% — used for net split estimate only

export interface LiveTimeUsage {
  monthLabel: string // YYYY-MM
  totalMinutes: number
  includedMinutes: number
  includedMinutesRemaining: number
  overageMinutes: number
  overageAmountKrw: number
  monthlyHardCapMinutes: number
  monthlyHardCapReached: boolean
}

export interface BroadcastRecordLite {
  started_at?: string | null
  ended_at?: string | null
  duration_minutes?: number | null
}

export const monthLabelFor = (d: Date): string => {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export const isInMonth = (iso: string | null | undefined, ref: Date): boolean => {
  if (!iso) return false
  const d = new Date(iso)
  if (isNaN(d.getTime())) return false
  return d.getUTCFullYear() === ref.getUTCFullYear() && d.getUTCMonth() === ref.getUTCMonth()
}

/**
 * Aggregate broadcast records for the calendar month containing `ref`,
 * matching on started_at first then created_at fallback (caller passes the
 * record shape they have).
 */
export const summarizeMonthlyLiveTime = (
  records: BroadcastRecordLite[],
  ref: Date = new Date(),
): LiveTimeUsage => {
  const monthRecords = records.filter((r) => isInMonth(r.started_at, ref))
  const totalMinutes = monthRecords.reduce(
    (sum, r) => sum + Math.max(0, Math.floor(Number(r.duration_minutes) || 0)),
    0,
  )

  const includedMinutes = Math.min(totalMinutes, INCLUDED_MINUTES_PER_MONTH)
  const includedMinutesRemaining = Math.max(0, INCLUDED_MINUTES_PER_MONTH - totalMinutes)
  const overageMinutes = Math.max(0, totalMinutes - INCLUDED_MINUTES_PER_MONTH)
  const overageAmountKrw = Math.round(overageMinutes * OVERAGE_RATE_KRW_PER_MINUTE)

  return {
    monthLabel: monthLabelFor(ref),
    totalMinutes,
    includedMinutes,
    includedMinutesRemaining,
    overageMinutes,
    overageAmountKrw,
    monthlyHardCapMinutes: MONTHLY_HARD_CAP_MINUTES,
    monthlyHardCapReached: totalMinutes >= MONTHLY_HARD_CAP_MINUTES,
  }
}

export interface LiveCommissionSplit {
  grossAmount: number
  commissionRate: number // 0.085
  commissionAmount: number // 8.5% — Pickfolio collects this from the order total
  sellerNetAmount: number // grossAmount - commissionAmount
  pgFeeEstimate: number // ≈3% of gross — informational only
  pickfolioNetEstimate: number // commission - PG fee (≈5.5% of gross)
}

/**
 * Compute the 8.5% live-commerce commission split for a single order amount.
 * `commissionAmount` is what Pickfolio retains from the order; `sellerNetAmount`
 * is what should reach the seller's settlement account. The PG-fee/Pickfolio
 * net values are estimates surfaced for reporting — they don't affect splitting.
 */
export const splitLiveCommission = (grossAmount: number): LiveCommissionSplit => {
  const safe = Math.max(0, Math.floor(Number(grossAmount) || 0))
  const commissionAmount = Math.round(safe * LIVE_COMMISSION_RATE)
  const sellerNetAmount = safe - commissionAmount
  const pgFeeEstimate = Math.round(safe * PG_FEE_RATE_ESTIMATE)
  const pickfolioNetEstimate = Math.max(0, commissionAmount - pgFeeEstimate)
  return {
    grossAmount: safe,
    commissionRate: LIVE_COMMISSION_RATE,
    commissionAmount,
    sellerNetAmount,
    pgFeeEstimate,
    pickfolioNetEstimate,
  }
}
