import { getStore } from '@netlify/blobs'
import { requireAdmin } from './_shared/admin-auth.mts'
import type { Config, Context } from '@netlify/functions'

// Admin settlement & revenue console
// GET /api/admin/settlements-overview
//   returns: { settlements, summary, proposalSummary, influencerRanking, businessRanking }
//
// Settlements live in Netlify Blobs (the `settlements` store, keyed
// `settlements_biz_<biz>` / `settlements_inf_<inf>`) and proposals live in
// Netlify Postgres (`proposals` table) plus accepted `campaign_applications`.
// These are the authoritative sources the user-facing flows write to, so the
// admin console reads from them directly rather than from Supabase mirrors that
// the creation paths never populate.

async function getRecords(store: ReturnType<typeof getStore>, key: string) {
  const data = (await store.get(key, { type: 'json' }).catch(() => null)) as any
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.records)) return data.records
  if (data && Array.isArray(data.settlements)) return data.settlements
  return []
}

export default async (req: Request, _context: Context) => {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    // 1) Pull every settlement from Blobs. Each settlement is mirrored under both
    // the business and influencer key, so collect from both prefixes and dedupe
    // by id (settlements with no business_username only exist under the inf key).
    const store = getStore('settlements')
    const seen = new Set<string>()
    const settlements: any[] = []
    for (const prefix of ['settlements_biz_', 'settlements_inf_']) {
      const { blobs } = await store.list({ prefix })
      const lists = await Promise.all(blobs.map((b) => getRecords(store, b.key)))
      for (const recs of lists) {
        for (const s of recs) {
          const id = s?.id || `${s?.proposal_id || ''}_${s?.influencer_username || ''}`
          if (!id || seen.has(id)) continue
          seen.add(id)
          settlements.push(s)
        }
      }
    }

    // 2) Pull proposals from Postgres: the `proposals` table plus accepted
    // campaign applications (campaign acceptances are written to Blobs and are
    // derivable from the SQL join, mirroring api-business-proposals).
    let proposalRows: any[] = []
    try {
      const { getDatabase } = await import('@netlify/database')
      const db = getDatabase()
      const [sqlProposals, campaignRows] = await Promise.all([
        (async () => {
          try {
            return (await db.sql`
              SELECT influencer_username, username, business_username, company_name, fee, status
              FROM proposals
            `) as any[]
          } catch (e) {
            console.warn('[admin-settlements] proposals query failed:', (e as any)?.message)
            return []
          }
        })(),
        (async () => {
          try {
            return (await db.sql`
              SELECT ca.applicant_username, c.business_username AS biz_user, c.brand_name, c.reward_amount
              FROM campaign_applications ca
              JOIN campaigns c ON c.id = ca.campaign_id
              WHERE ca.status = 'accepted'
            `) as any[]
          } catch (e) {
            console.warn('[admin-settlements] campaign query failed:', (e as any)?.message)
            return []
          }
        })(),
      ])

      for (const row of sqlProposals || []) {
        proposalRows.push({
          influencer_username: row.influencer_username || row.username || '',
          business_username: (row.business_username || '').toLowerCase().replace(/^biz\//, ''),
          company_name: row.company_name || '',
          fee: parseInt(row.fee) || 0,
          status: row.status || 'pending',
        })
      }
      for (const row of campaignRows || []) {
        proposalRows.push({
          influencer_username: (row.applicant_username || '').toLowerCase(),
          business_username: (row.biz_user || '').toLowerCase().replace(/^biz\//, ''),
          company_name: row.brand_name || '',
          fee: parseInt(row.reward_amount) || 0,
          status: 'accepted',
        })
      }
    } catch (e) {
      console.warn('[admin-settlements] database unavailable:', (e as any)?.message)
    }

    const acceptedProposals = proposalRows.filter((p) => p.status === 'accepted' || p.status === 'completed')

    // Deal-flow summary by the influencer's decision (approved / pending /
    // rejected). Only the approved bucket feeds revenue elsewhere.
    const sumFee = (rows: any[]) => rows.reduce((s, p) => s + (Number(p.fee) || 0), 0)
    const pendingProposals = proposalRows.filter((p) => p.status === 'pending')
    const rejectedProposals = proposalRows.filter((p) => p.status === 'rejected')
    const proposalSummary = {
      approvedAmount: sumFee(acceptedProposals),
      approvedCount: acceptedProposals.length,
      pendingAmount: sumFee(pendingProposals),
      pendingCount: pendingProposals.length,
      rejectedAmount: sumFee(rejectedProposals),
      rejectedCount: rejectedProposals.length,
    }

    const list = settlements || []
    const summary = {
      total: list.length,
      scheduled: list.filter((s) => s.status === 'scheduled').length,
      pending: list.filter((s) => s.status === 'pending').length,
      completed: list.filter((s) => s.status === 'completed').length,
      totalAmount: list.reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
      paidAmount: list.filter((s) => s.status === 'completed').reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
      pendingAmount: list.filter((s) => s.status !== 'completed').reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
    }

    // Influencer ranking (cumulative GMV from settlements + accepted proposals)
    const influencerMap: Record<string, { username: string; settlementAmount: number; proposalAmount: number; settlementCount: number; paidAmount: number }> = {}
    for (const s of list) {
      const u = s.influencer_username
      if (!u) continue
      if (!influencerMap[u]) influencerMap[u] = { username: u, settlementAmount: 0, proposalAmount: 0, settlementCount: 0, paidAmount: 0 }
      influencerMap[u].settlementAmount += Number(s.amount) || 0
      influencerMap[u].settlementCount++
      if (s.status === 'completed') influencerMap[u].paidAmount += Number(s.amount) || 0
    }
    for (const p of acceptedProposals) {
      const u = p.influencer_username
      if (!u) continue
      if (!influencerMap[u]) influencerMap[u] = { username: u, settlementAmount: 0, proposalAmount: 0, settlementCount: 0, paidAmount: 0 }
      influencerMap[u].proposalAmount += Number(p.fee) || 0
    }
    const influencerRanking = Object.values(influencerMap)
      .map((r) => ({ ...r, totalAmount: r.settlementAmount + r.proposalAmount }))
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
    for (const p of acceptedProposals) {
      const key = (p.business_username || p.company_name || 'unknown').toLowerCase()
      if (!businessMap[key]) businessMap[key] = { key, companyName: p.company_name || p.business_username || 'unknown', settlementAmount: 0, proposalAmount: 0, paidAmount: 0, pendingAmount: 0, count: 0 }
      businessMap[key].proposalAmount += Number(p.fee) || 0
    }
    const businessRanking = Object.values(businessMap)
      .map((r) => ({ ...r, totalAmount: r.settlementAmount + r.proposalAmount }))
      .sort((a, b) => b.totalAmount - a.totalAmount)

    return Response.json({
      settlements: list,
      summary,
      proposalSummary,
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
