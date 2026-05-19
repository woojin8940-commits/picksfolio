import type { Config } from '@netlify/functions'

// DM Statistics API - Fetch analytics data from dm_send_logs
export default async (req: Request) => {
  const url = new URL(req.url)
  const userId = url.searchParams.get('user_id')

  if (!userId) {
    return new Response(JSON.stringify({ error: 'user_id가 필요합니다.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://rjksilpewohjvtbxrsvu.supabase.co'
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: '서버 설정 오류' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  }

  try {
    // Total sent
    const totalRes = await fetch(
      `${supabaseUrl}/rest/v1/dm_send_logs?user_id=eq.${userId}&select=id&status=eq.sent`,
      { headers: { ...headers, 'Prefer': 'count=exact' } }
    )
    const totalCount = parseInt(totalRes.headers.get('content-range')?.split('/')[1] || '0')

    // Today's sent
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayRes = await fetch(
      `${supabaseUrl}/rest/v1/dm_send_logs?user_id=eq.${userId}&status=eq.sent&sent_at=gte.${todayStart.toISOString()}&select=id`,
      { headers: { ...headers, 'Prefer': 'count=exact' } }
    )
    const todayCount = parseInt(todayRes.headers.get('content-range')?.split('/')[1] || '0')

    // Weekly data (last 7 days)
    const weeklyData = []
    const dayNames = ['일', '월', '화', '수', '목', '금', '토']
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date()
      dayStart.setDate(dayStart.getDate() - i)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)

      const dayRes = await fetch(
        `${supabaseUrl}/rest/v1/dm_send_logs?user_id=eq.${userId}&status=eq.sent&sent_at=gte.${dayStart.toISOString()}&sent_at=lt.${dayEnd.toISOString()}&select=id`,
        { headers: { ...headers, 'Prefer': 'count=exact' } }
      )
      const dayCount = parseInt(dayRes.headers.get('content-range')?.split('/')[1] || '0')

      weeklyData.push({
        day: dayNames[dayStart.getDay()],
        sent: dayCount,
        clicks: 0,
      })
    }

    // Failed count
    const failedRes = await fetch(
      `${supabaseUrl}/rest/v1/dm_send_logs?user_id=eq.${userId}&status=eq.failed&select=id`,
      { headers: { ...headers, 'Prefer': 'count=exact' } }
    )
    const failedCount = parseInt(failedRes.headers.get('content-range')?.split('/')[1] || '0')

    const responseRate = totalCount + failedCount > 0
      ? Math.round((totalCount / (totalCount + failedCount)) * 100)
      : 0

    return new Response(JSON.stringify({
      totalSent: totalCount,
      todaySent: todayCount,
      clickRate: 0,
      responseRate,
      savedHours: Math.round(totalCount * 0.5 * 10) / 10, // ~30sec per DM saved
      conversionRate: 0,
      weeklyData,
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('Stats error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

export const config: Config = {
  path: '/api/dm-stats'
}
