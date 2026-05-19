import { getSupabaseServer } from './_shared/supabase.mts'
import { requireAdmin } from './_shared/admin-auth.mts'
import type { Config, Context } from '@netlify/functions'

// Admin settlement & revenue console
// GET /api/admin/settlements-overview
//   returns: { settlements, summary, influencerRanking, businessRanking }
export default async (req: Request, _context: Context) => {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = getSupabaseServer()

  try {
    const { data: settlements, error } = await supabase
      .from('settlements')
      .select('*')
      .order('scheduled_date', { ascending: false })
    if (error) throw error

    // Pull cumulative gross from completed proposals as additional revenue source
    const { data: completedProposals } = await supabase
      .from('business_proposals')
      .select('influencer_username, business_username, company_name, fee, status')
      .in('status', ['accepted', 'completed'])

    const list = settlements || []
    const summary = {
      total: list.length,
      scheduled: list.filter(s => s.status === 'scheduled').length,
      pending: list.filter(s => s.status === 'pending').length,
      completed: list.filter(s => s.status === 'completed').length,
      totalAmount: list.reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
      paidAmount: list.filter(s => s.status === 'completed').reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
      pendingAmount: list.filter(s => s.status !== 'completed').reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
    }

    // Influencer ranking (cumulative GMV from settlements + accepted proposals)
    const influencerMap: Record<string, { username: string; settlementAmount: number; proposalAmount: number; settlementCount: number; paidAmount: number }> = {}
    for (const s of list) {
      const u = s.influencer_username
      if (!influencerMap[u]) influencerMap[u] = { username: u, settlementAmount: 0, proposalAmount: 0, settlementCount: 0, paidAmount: 0 }
      influencerMap[u].settlementAmount += Number(s.amount) || 0
      influencerMap[u].settlementCount++
      if (s.status === 'completed') influencerMap[u].paidAmount += Number(s.amount) || 0
    }
    for (const p of completedProposals || []) {
      const u = (p as any).influencer_username
      if (!influencerMap[u]) influencerMap[u] = { username: u, settlementAmount: 0, proposalAmount: 0, settlementCount: 0, paidAmount: 0 }
      influencerMap[u].proposalAmount += Number((p as any).fee) || 0
    }
    const influencerRanking = Object.values(influencerMap)
      .map(r => ({ ...r, totalAmount: r.settlementAmount + r.proposalAmount }))
      .sort((a, b) => b.totalAmount - a.totalAmount)

    // Business (advertiser) ranking
    const businessMap: Record<string, { key: string; companyName: string; settlementAmount: number; proposalAmount: number; paidAmount: number; pendingAmount: number; count: number }> = {}
    for (const s of list) {
      const key = (s.business_username || s.company_name || 'unknown').toLowerCase()
      if (!businessMap[key]) businessMap[key] = { key, companyName: s.company_name || s.business_username || 'unknown', settlementAmount: 0, proposalAmount: 0, paidAmount: 0, pendingAmount: 0, count: 0 }
      businessMap[key].settlementAmount += Number(s.amount) || 0
      businessMap[key].count++
      if (s.status === 'completed') businessMap[key].paidAmount += Number(s.amount) || 0
      else businessMap[key].pendingAmount += Number(s.amount) || 0
    }
    for (const p of completedProposals || []) {
      const key = ((p as any).business_username || (p as any).company_name || 'unknown').toLowerCase()
      if (!businessMap[key]) businessMap[key] = { key, companyName: (p as any).company_name || (p as any).business_username || 'unknown', settlementAmount: 0, proposalAmount: 0, paidAmount: 0, pendingAmount: 0, count: 0 }
      businessMap[key].proposalAmount += Number((p as any).fee) || 0
    }
    const businessRanking = Object.values(businessMap)
      .map(r => ({ ...r, totalAmount: r.settlementAmount + r.proposalAmount }))
      .sort((a, b) => b.totalAmount - a.totalAmount)

    return Response.json({
      settlements: list,
      summary,
      influencerRanking,
      businessRanking,
    })
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Failed to fetch settlements overview' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/admin/settlements-overview',
  method: ['GET'],
}
