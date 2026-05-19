import { getSupabaseServer } from './_shared/supabase.mts'
import { requireAdmin } from './_shared/admin-auth.mts'
import type { Config, Context } from '@netlify/functions'

// Admin growth metrics
// GET /api/admin/growth
// Returns:
// - newInfluencersDaily / Weekly / 30d total
// - DAU (active users today by analytics views/clicks > 0)
// - MAU (last 30d distinct active usernames)
// - acceptanceRate (overall + 30d)
export default async (req: Request, _context: Context) => {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = getSupabaseServer()

  try {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10)
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10)

    // Influencer signups. Include NULL role so legacy profiles
    // count toward growth metrics alongside explicitly-tagged users.
    const { data: influencerProfiles } = await supabase
      .from('profiles')
      .select('username, created_at, last_login_at')
      .or('role.is.null,role.eq.user')

    const newInfluencers30d = (influencerProfiles || []).filter(
      p => p.created_at && new Date(p.created_at) >= thirtyDaysAgo
    ).length
    const newInfluencers7d = (influencerProfiles || []).filter(
      p => p.created_at && new Date(p.created_at) >= sevenDaysAgo
    ).length
    const newInfluencersToday = (influencerProfiles || []).filter(
      p => p.created_at && p.created_at.startsWith(todayStr)
    ).length

    // Active users from analytics (DAU/MAU)
    const { data: analyticsRecent } = await supabase
      .from('analytics')
      .select('username, date, views, clicks')
      .gte('date', thirtyDaysAgoStr)

    const activeToday = new Set<string>()
    const activeMonth = new Set<string>()
    const activeWeek = new Set<string>()
    for (const a of analyticsRecent || []) {
      const u = (a as any).username
      const d = (a as any).date as string
      const v = ((a as any).views || 0) + ((a as any).clicks || 0)
      if (v <= 0) continue
      activeMonth.add(u)
      if (d >= sevenDaysAgoStr) activeWeek.add(u)
      if (d === todayStr) activeToday.add(u)
    }

    // Augment DAU with logins today (last_login_at)
    for (const p of influencerProfiles || []) {
      if (p.last_login_at && p.last_login_at.startsWith(todayStr)) activeToday.add(p.username)
    }

    // Acceptance rate (proposals)
    const { data: proposals } = await supabase
      .from('business_proposals')
      .select('status, created_at')

    const all = proposals || []
    const totalProposals = all.length
    const accepted = all.filter(p => p.status === 'accepted' || p.status === 'completed').length
    const acceptanceRate = totalProposals > 0 ? Math.round((accepted / totalProposals) * 100) : 0

    const recent = all.filter(p => new Date(p.created_at) >= thirtyDaysAgo)
    const recentAccepted = recent.filter(p => p.status === 'accepted' || p.status === 'completed').length
    const recent30dAcceptanceRate = recent.length > 0 ? Math.round((recentAccepted / recent.length) * 100) : 0

    return Response.json({
      newInfluencers: {
        today: newInfluencersToday,
        last7d: newInfluencers7d,
        last30d: newInfluencers30d,
        total: (influencerProfiles || []).length,
      },
      activity: {
        dau: activeToday.size,
        wau: activeWeek.size,
        mau: activeMonth.size,
      },
      acceptance: {
        overall: acceptanceRate,
        last30d: recent30dAcceptanceRate,
        recentTotal: recent.length,
      },
    })
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/admin/growth',
  method: ['GET'],
}
