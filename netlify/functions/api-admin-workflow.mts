import { getSupabaseServer } from './_shared/supabase.mts'
import { requireAdmin } from './_shared/admin-auth.mts'
import type { Config, Context } from '@netlify/functions'

// Admin proposal workflow & timeline
// GET /api/admin/proposals-analytics                      → category/fee bucket aggregates + rejection stats
// GET /api/admin/proposals-analytics/timeline/:proposalId → unified timeline (proposal → collab → settlement)
export default async (req: Request, context: Context) => {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = getSupabaseServer()
  const proposalId = (context.params as any).proposalId as string | undefined

  // Timeline view for one proposal
  if (proposalId) {
    try {
      const { data: proposal, error: pe } = await supabase
        .from('business_proposals')
        .select('*')
        .eq('id', proposalId)
        .maybeSingle()
      if (pe) throw pe
      if (!proposal) return Response.json({ error: 'Proposal not found' }, { status: 404 })

      const [{ data: settlements }, { data: collabs }] = await Promise.all([
        supabase.from('settlements').select('*').eq('proposal_id', proposalId),
        supabase
          .from('collab_records')
          .select('*')
          .eq('username', proposal.influencer_username)
          .eq('title', proposal.title),
      ])

      type Event = {
        kind: 'proposal' | 'collab' | 'settlement'
        status: string
        date: string
        title: string
        amount?: number
        meta?: Record<string, any>
      }
      const events: Event[] = []

      events.push({
        kind: 'proposal',
        status: 'created',
        date: proposal.created_at,
        title: '제안 등록',
        amount: Number(proposal.fee) || 0,
        meta: { company: proposal.company_name, category: proposal.category },
      })
      if (proposal.status !== 'pending') {
        events.push({
          kind: 'proposal',
          status: proposal.status,
          date: proposal.updated_at || proposal.created_at,
          title:
            proposal.status === 'accepted'
              ? '제안 수락'
              : proposal.status === 'rejected'
              ? '제안 거절'
              : '제안 완료',
          meta: { reason: proposal.rejection_reason || null },
        })
      }
      for (const c of collabs || []) {
        events.push({
          kind: 'collab',
          status: c.status,
          date: c.date,
          title: `협업: ${c.title}`,
          amount: Number(c.fee) || 0,
          meta: { category: c.category, end_date: c.end_date },
        })
      }
      for (const s of settlements || []) {
        events.push({
          kind: 'settlement',
          status: s.status,
          date: s.completed_at || s.scheduled_date,
          title:
            s.status === 'completed' ? '정산 완료' : s.status === 'pending' ? '정산 진행' : '정산 예정',
          amount: Number(s.amount) || 0,
          meta: { scheduled_date: s.scheduled_date, completed_at: s.completed_at },
        })
      }

      events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

      return Response.json({ proposal, events })
    } catch (e: any) {
      return Response.json({ error: e?.message || 'Failed' }, { status: 500 })
    }
  }

  // Aggregate analytics
  try {
    const { data: proposals } = await supabase
      .from('business_proposals')
      .select('id, category, fee, status, rejection_reason, company_name, business_username, created_at')

    const all = proposals || []

    // Category breakdown
    const categoryStats: Record<string, { total: number; accepted: number; rejected: number; completed: number; totalFee: number }> = {}
    for (const p of all) {
      const c = p.category || '기타'
      if (!categoryStats[c]) categoryStats[c] = { total: 0, accepted: 0, rejected: 0, completed: 0, totalFee: 0 }
      categoryStats[c].total++
      if (p.status === 'accepted') categoryStats[c].accepted++
      if (p.status === 'rejected') categoryStats[c].rejected++
      if (p.status === 'completed') categoryStats[c].completed++
      categoryStats[c].totalFee += Number(p.fee) || 0
    }

    // Fee bucket aggregates
    const buckets = [
      { key: '0-100k', min: 0, max: 100000 },
      { key: '100k-500k', min: 100000, max: 500000 },
      { key: '500k-1M', min: 500000, max: 1000000 },
      { key: '1M-5M', min: 1000000, max: 5000000 },
      { key: '5M+', min: 5000000, max: Infinity },
    ]
    const feeBucketStats = buckets.map(b => {
      const subset = all.filter(p => {
        const f = Number(p.fee) || 0
        return f >= b.min && f < b.max
      })
      return {
        bucket: b.key,
        total: subset.length,
        accepted: subset.filter(p => p.status === 'accepted' || p.status === 'completed').length,
        rejected: subset.filter(p => p.status === 'rejected').length,
        acceptanceRate:
          subset.length > 0
            ? Math.round(
                (subset.filter(p => p.status === 'accepted' || p.status === 'completed').length /
                  subset.length) *
                  100
              )
            : 0,
      }
    })

    // Rejection reason aggregation (group similar reasons)
    const rejectionGroups: Record<string, { count: number; samples: string[] }> = {}
    const keywordMap: { keyword: string; label: string }[] = [
      { keyword: '단가', label: '금액/단가 부족' },
      { keyword: '금액', label: '금액/단가 부족' },
      { keyword: '예산', label: '금액/단가 부족' },
      { keyword: '일정', label: '일정 불일치' },
      { keyword: '시간', label: '일정 불일치' },
      { keyword: '카테고리', label: '카테고리 불일치' },
      { keyword: '맞지', label: '컨셉 불일치' },
      { keyword: '컨셉', label: '컨셉 불일치' },
      { keyword: '바쁨', label: '시간 부족' },
      { keyword: '바빠', label: '시간 부족' },
      { keyword: '브랜드', label: '브랜드 부적합' },
      { keyword: '경쟁', label: '경쟁사 이슈' },
    ]
    for (const p of all) {
      if (p.status !== 'rejected') continue
      const reason = (p.rejection_reason || '').trim()
      if (!reason) {
        rejectionGroups['기타/사유 미기재'] = rejectionGroups['기타/사유 미기재'] || { count: 0, samples: [] }
        rejectionGroups['기타/사유 미기재'].count++
        continue
      }
      const matched = keywordMap.find(k => reason.includes(k.keyword))
      const label = matched?.label || '기타'
      if (!rejectionGroups[label]) rejectionGroups[label] = { count: 0, samples: [] }
      rejectionGroups[label].count++
      if (rejectionGroups[label].samples.length < 5) rejectionGroups[label].samples.push(reason.slice(0, 80))
    }
    const rejectionStats = Object.entries(rejectionGroups)
      .map(([label, v]) => ({ label, count: v.count, samples: v.samples }))
      .sort((a, b) => b.count - a.count)

    // Last-30-day rejection rate
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const recent = all.filter(p => new Date(p.created_at).getTime() >= thirtyDaysAgo)
    const recentRejectionRate =
      recent.length > 0
        ? Math.round((recent.filter(p => p.status === 'rejected').length / recent.length) * 100)
        : 0

    return Response.json({
      categoryStats,
      feeBucketStats,
      rejectionStats,
      recentRejectionRate,
      recentTotal: recent.length,
    })
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}

export const config: Config = {
  path: [
    '/api/admin/proposals-analytics',
    '/api/admin/proposals-analytics/timeline/:proposalId',
  ],
  method: ['GET'],
}
