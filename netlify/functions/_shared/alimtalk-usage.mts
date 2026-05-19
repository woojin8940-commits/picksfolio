import { getStore } from '@netlify/blobs'

export interface AlimtalkUsageStats {
  monthlySent: number
  monthlyQuota: number
  resetAt: string
  totalSent: number
  costPerMessage: number
}

export const DEFAULT_USAGE: AlimtalkUsageStats = {
  monthlySent: 0,
  monthlyQuota: 100,
  resetAt: '',
  totalSent: 0,
  costPerMessage: 15,
}

const currentMonthKey = () => {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const nextMonthIso = () => {
  const d = new Date()
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  return next.toISOString()
}

export async function readAlimtalkUsage(user: string): Promise<AlimtalkUsageStats> {
  const store = getStore({ name: 'alimtalk-usage', consistency: 'strong' })
  const stored = (await store.get(user, { type: 'json' })) as (AlimtalkUsageStats & { month?: string }) | null
  const month = currentMonthKey()
  if (!stored || stored.month !== month) {
    return {
      ...DEFAULT_USAGE,
      totalSent: stored?.totalSent ?? 0,
      monthlyQuota: stored?.monthlyQuota ?? DEFAULT_USAGE.monthlyQuota,
      costPerMessage: stored?.costPerMessage ?? DEFAULT_USAGE.costPerMessage,
      resetAt: nextMonthIso(),
    }
  }
  return { ...DEFAULT_USAGE, ...stored }
}

/** Increment monthly + total counters. Call when the send-message function actually dispatches a message. */
export async function incrementAlimtalkUsage(user: string, delta = 1): Promise<AlimtalkUsageStats> {
  if (!user || delta <= 0) return DEFAULT_USAGE
  const key = user.toLowerCase()
  const store = getStore({ name: 'alimtalk-usage', consistency: 'strong' })
  const current = await readAlimtalkUsage(key)
  const next: AlimtalkUsageStats & { month: string } = {
    ...current,
    month: currentMonthKey(),
    monthlySent: current.monthlySent + delta,
    totalSent: current.totalSent + delta,
    resetAt: current.resetAt || nextMonthIso(),
  }
  await store.setJSON(key, next)
  return next
}
