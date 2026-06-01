import { computeLiveUsage } from './_shared/live-usage.mts'
import {
  INCLUDED_MINUTES_PER_MONTH,
  OVERAGE_RATE_KRW_PER_HOUR,
  OVERAGE_RATE_KRW_PER_MINUTE,
  CHARGE_RATE_KRW_PER_HOUR,
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
    // Aggregate from the Netlify Blobs broadcast-history store (the source the
    // live dashboard actually writes to) plus any prepaid charge balance.
    const usage = await computeLiveUsage(username, new Date())

    return Response.json({
      usage,
      pricing: {
        includedMinutesPerMonth: INCLUDED_MINUTES_PER_MONTH,
        overageRateKrwPerHour: OVERAGE_RATE_KRW_PER_HOUR,
        overageRateKrwPerMinute: OVERAGE_RATE_KRW_PER_MINUTE,
        chargeRateKrwPerHour: CHARGE_RATE_KRW_PER_HOUR,
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
