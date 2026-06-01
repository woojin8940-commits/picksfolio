import {
  computeLiveUsage,
  readLiveCredits,
  writeLiveCredits,
} from './_shared/live-usage.mts'
import {
  CHARGE_RATE_KRW_PER_HOUR,
  MINUTES_PER_CHARGE_HOUR,
  MONTHLY_HARD_CAP_MINUTES,
  INCLUDED_MINUTES_PER_MONTH,
} from './_shared/live-pricing.mts'
import type { Config, Context } from '@netlify/functions'

// Prepaid live-time top-up ("시간 충전하기").
//   GET  /api/live-credits/:username           → current month balance + usage
//   POST /api/live-credits/:username  { hours } → charge N hours (시간당 8,900원)
//
// Charged hours extend the monthly broadcast allowance so a seller can keep
// streaming after the included 3 hours are spent. Time is monthly-scoped and
// resets with the calendar month, matching the included allowance.
export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase()
  if (!username) {
    return Response.json({ error: 'Missing username' }, { status: 400 })
  }

  try {
    const now = new Date()

    if (req.method === 'GET') {
      const [credits, usage] = await Promise.all([
        readLiveCredits(username, now),
        computeLiveUsage(username, now),
      ])
      return Response.json({
        credits,
        usage,
        chargeRateKrwPerHour: CHARGE_RATE_KRW_PER_HOUR,
      })
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const hours = Math.floor(Number((body as any)?.hours) || 0)
      if (!hours || hours < 1) {
        return Response.json({ error: '충전할 시간을 1시간 이상 선택해주세요.' }, { status: 400 })
      }
      if (hours > 50) {
        return Response.json({ error: '한 번에 최대 50시간까지 충전할 수 있습니다.' }, { status: 400 })
      }

      const credits = await readLiveCredits(username, now)

      // Don't let charged allowance push the monthly cap past the 50h hard cap.
      const addedMinutes = hours * MINUTES_PER_CHARGE_HOUR
      const projectedAllowance =
        INCLUDED_MINUTES_PER_MONTH + credits.chargedMinutes + addedMinutes
      if (projectedAllowance > MONTHLY_HARD_CAP_MINUTES) {
        return Response.json(
          { error: '월 송출 한도(50시간)를 초과하여 충전할 수 없습니다.' },
          { status: 400 },
        )
      }

      const amountKrw = hours * CHARGE_RATE_KRW_PER_HOUR
      credits.chargedMinutes += addedMinutes
      credits.charges = [
        { at: now.toISOString(), hours, minutes: addedMinutes, amountKrw },
        ...(credits.charges || []),
      ].slice(0, 100)

      await writeLiveCredits(username, credits)

      const usage = await computeLiveUsage(username, now)
      return Response.json({
        success: true,
        charged: { hours, minutes: addedMinutes, amountKrw },
        credits,
        usage,
      })
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Failed to charge live time' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/live-credits/:username',
}
