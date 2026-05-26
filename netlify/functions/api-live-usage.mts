import { getSupabaseServer } from './_shared/supabase.mts'
import {
  summarizeMonthlyLiveTime,
  INCLUDED_MINUTES_PER_MONTH,
  OVERAGE_RATE_KRW_PER_HOUR,
  OVERAGE_RATE_KRW_PER_MINUTE,
  LIVE_COMMISSION_RATE,
  DAILY_HARD_CAP_MINUTES,
  MONTHLY_HARD_CAP_MINUTES,
  THRESHOLD_BILLING_AMOUNT_KRW,
} from './_shared/live-pricing.mts'
import type { Config, Context } from '@netlify/functions'

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase()
  if (!username) {
    return Response.json({ error: 'Missing username' }, { status: 400 })
  }

  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const supabase = getSupabaseServer()
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

    const { data, error } = await supabase
      .from('broadcast_history')
      .select('started_at, duration_minutes')
      .eq('username', username)
      .gte('started_at', monthStart)

    if (error && !(error.code === '42P01' || error.message?.includes('does not exist'))) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    const records = (data || []) as Array<{ started_at: string; duration_minutes: number | null }>
    const usage = summarizeMonthlyLiveTime(records, now)

    return Response.json({
      usage,
      pricing: {
        includedMinutesPerMonth: INCLUDED_MINUTES_PER_MONTH,
        overageRateKrwPerHour: OVERAGE_RATE_KRW_PER_HOUR,
        overageRateKrwPerMinute: OVERAGE_RATE_KRW_PER_MINUTE,
        liveCommissionRate: LIVE_COMMISSION_RATE,
        dailyHardCapMinutes: DAILY_HARD_CAP_MINUTES,
        monthlyHardCapMinutes: MONTHLY_HARD_CAP_MINUTES,
        thresholdBillingAmountKrw: THRESHOLD_BILLING_AMOUNT_KRW,
      },
    })
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Failed to fetch live usage' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/live-usage/:username',
}
