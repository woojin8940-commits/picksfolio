import { getStore } from '@netlify/blobs'
import {
  summarizeMonthlyLiveTime,
  monthLabelFor,
  type BroadcastRecordLite,
  type LiveTimeUsage,
} from './live-pricing.mts'

/**
 * Single source of truth for a seller's monthly live-broadcast time usage.
 *
 * Broadcast sessions are persisted to the Netlify Blobs `broadcast-history`
 * store on every live stop (see `api-broadcast-history`), and prepaid top-up
 * hours bought via "시간 충전하기" live in the `live-time-credits` store. This
 * helper reads BOTH and produces the combined usage summary so the seller
 * dashboard, the charge endpoint, and the stream-key gate all agree.
 *
 * (Historically `api-live-usage` queried a Supabase `broadcast_history` table
 * that nothing ever wrote to — and on a column that didn't exist — so used
 * minutes always read as zero and remaining time never decreased.)
 */

export interface ChargeEntry {
  at: string // ISO timestamp
  hours: number
  minutes: number
  amountKrw: number
}

export interface LiveCredits {
  monthLabel: string
  chargedMinutes: number
  charges: ChargeEntry[]
}

const HISTORY_STORE = 'broadcast-history'
const CREDITS_STORE = 'live-time-credits'

const historyKey = (username: string) => `history_${username}`
const creditsKey = (username: string) => `credits_${username}`

/** Read this seller's broadcast records (camelCase blob shape). */
export const readBroadcastRecords = async (
  username: string,
): Promise<BroadcastRecordLite[]> => {
  const store = getStore(HISTORY_STORE)
  const data = (await store.get(historyKey(username), { type: 'json' })) as
    | BroadcastRecordLite[]
    | null
  return Array.isArray(data) ? data : []
}

/**
 * Read this seller's prepaid charge balance for the month containing `ref`.
 * Charged time is monthly-scoped: a stored balance from a previous month is
 * treated as zero (the included allowance resets each calendar month too).
 */
export const readLiveCredits = async (
  username: string,
  ref: Date = new Date(),
): Promise<LiveCredits> => {
  const monthLabel = monthLabelFor(ref)
  const store = getStore(CREDITS_STORE)
  const stored = (await store.get(creditsKey(username), { type: 'json' })) as
    | LiveCredits
    | null
  if (!stored || stored.monthLabel !== monthLabel) {
    return { monthLabel, chargedMinutes: 0, charges: [] }
  }
  return {
    monthLabel,
    chargedMinutes: Math.max(0, Math.floor(Number(stored.chargedMinutes) || 0)),
    charges: Array.isArray(stored.charges) ? stored.charges : [],
  }
}

export const writeLiveCredits = async (
  username: string,
  credits: LiveCredits,
): Promise<void> => {
  const store = getStore(CREDITS_STORE)
  await store.setJSON(creditsKey(username), credits)
}

/** Combined usage summary for a seller (broadcast minutes + prepaid charge). */
export const computeLiveUsage = async (
  username: string,
  ref: Date = new Date(),
): Promise<LiveTimeUsage> => {
  const [records, credits] = await Promise.all([
    readBroadcastRecords(username),
    readLiveCredits(username, ref),
  ])
  return summarizeMonthlyLiveTime(records, ref, credits.chargedMinutes)
}
