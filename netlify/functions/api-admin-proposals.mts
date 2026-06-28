import { getSupabaseServer } from './_shared/supabase.mts'
import { getUser } from '@netlify/identity'
import type { Config, Context } from '@netlify/functions'

const ADMIN_EMAILS = ['woojin8940@inplace-ad.com', 'picksfolio@picks.me']

function decodeJwtClaims(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload
  } catch {
    return null
  }
}

export default async (req: Request, context: Context) => {
  let user = await getUser()

  if (!user) {
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const claims = decodeJwtClaims(token)
      if (claims?.email) {
        user = {
          id: claims.sub || '',
          email: claims.email,
          app_metadata: claims.app_metadata || {},
        } as any
      }
    }
  }

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const roles: string[] = (user as any).app_metadata?.roles || []
  const email = ((user as any).email || '').trim().toLowerCase()
  if (!roles.includes('admin') && !ADMIN_EMAILS.includes(email)) {
    return Response.json({ error: 'Forbidden: admin role required' }, { status: 403 })
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = getSupabaseServer()

  try {
    // Proposals are written to Netlify Postgres (`proposals`) and, for accepted
    // campaign collaborations, derivable from `campaign_applications`. Read from
    // those authoritative sources rather than the Supabase `business_proposals`
    // mirror that the creation flows never populate. A query failure surfaces as
    // an empty list rather than a 500 so other admin tabs still render.
    let allProposals: any[] = []
    try {
      const { getDatabase } = await import('@netlify/database')
      const db = getDatabase()
      const [sqlProposals, campaignRows] = await Promise.all([
        (async () => {
          try {
            return (await db.sql`
              SELECT * FROM proposals ORDER BY created_at DESC
            `) as any[]
          } catch (e) {
            console.warn('[admin-proposals] proposals query failed:', (e as any)?.message)
            return []
          }
        })(),
        (async () => {
          try {
            return (await db.sql`
              SELECT ca.*, c.title AS campaign_title, c.business_username AS biz_user, c.brand_name,
                     c.type AS campaign_type, c.description, c.start_date, c.end_date, c.reward_amount
              FROM campaign_applications ca
              JOIN campaigns c ON c.id = ca.campaign_id
              WHERE ca.status = 'accepted'
              ORDER BY ca.created_at DESC
            `) as any[]
          } catch (e) {
            console.warn('[admin-proposals] campaign query failed:', (e as any)?.message)
            return []
          }
        })(),
      ])

      const seenIds = new Set<string>()
      for (const row of sqlProposals || []) {
        if (seenIds.has(row.id)) continue
        seenIds.add(row.id)
        allProposals.push({
          id: row.id,
          influencer_username: row.influencer_username || row.username || '',
          category: row.category || '광고',
          company_name: row.company_name || '',
          title: row.title || '',
          content: row.content || row.description || '',
          start_date: row.start_date || '',
          end_date: row.end_date || '',
          fee: parseInt(row.fee) || 0,
          contact_email: row.contact_email || '',
          contact_person: row.contact_person || '',
          contact_phone: row.contact_phone || '',
          business_username: (row.business_username || '').toLowerCase().replace(/^biz\//, ''),
          status: row.status || 'pending',
          rejection_reason: row.rejection_reason || '',
          created_at: row.created_at || new Date().toISOString(),
          createdAt: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || '',
        })
      }
      for (const row of campaignRows || []) {
        const proposalId = `campaign_${row.campaign_id}_${(row.applicant_username || '').toLowerCase()}`
        if (seenIds.has(proposalId)) continue
        seenIds.add(proposalId)
        allProposals.push({
          id: proposalId,
          influencer_username: (row.applicant_username || '').toLowerCase(),
          category: row.campaign_type === 'group_buy' ? '커머스' : '광고',
          company_name: row.brand_name || '',
          title: row.campaign_title || '',
          content: row.description || '',
          start_date: row.start_date || '',
          end_date: row.end_date || '',
          fee: parseInt(row.reward_amount) || 0,
          business_username: (row.biz_user || '').toLowerCase().replace(/^biz\//, ''),
          status: 'accepted',
          rejection_reason: '',
          created_at: row.created_at || new Date().toISOString(),
          createdAt: row.created_at || new Date().toISOString(),
          updated_at: row.updated_at || '',
        })
      }
    } catch (e) {
      console.warn('[admin-proposals] database unavailable:', (e as any)?.message)
    }

    const proposals = allProposals.map(p => ({
      ...p,
      _username: p.influencer_username,
    }))

    // Pull every registered influencer (role='user' or NULL) from profiles so
    // that newly signed-up users appear in the operator dashboard even when
    // they have not yet received a business proposal. Legacy NULL roles are
    // included for the same reason as in api-admin-influencers. If the
    // role-filtered query fails (e.g. role column missing), retry without the
    // filter so the dashboard still surfaces accounts.
    let profileRows: any[] = []
    {
      const filtered = await supabase
        .from('profiles')
        .select('username, created_at')
        .or('role.is.null,role.eq.user')
        .order('created_at', { ascending: false })
      if (filtered.error) {
        console.warn('[admin-proposals] role-filtered profiles query failed, retrying without role filter:', filtered.error.message)
        const all = await supabase
          .from('profiles')
          .select('username, created_at')
          .order('created_at', { ascending: false })
        if (!all.error) {
          profileRows = (all.data || []).filter((p: any) => !String(p.username || '').startsWith('biz/'))
        }
      } else {
        profileRows = filtered.data || []
      }
    }

    const influencerSet = new Set<string>()
    for (const p of profileRows || []) {
      const u = (p as any).username
      if (u) influencerSet.add(u)
    }
    for (const p of proposals) {
      if (p.influencer_username) influencerSet.add(p.influencer_username)
    }
    const influencers = [...influencerSet]

    return Response.json({
      influencers,
      proposals,
      stats: {
        totalInfluencers: influencers.length,
        totalProposals: proposals.length,
        pending: proposals.filter(p => p.status === 'pending').length,
        accepted: proposals.filter(p => p.status === 'accepted').length,
        completed: proposals.filter(p => p.status === 'completed').length,
        rejected: proposals.filter(p => p.status === 'rejected').length,
      }
    })
  } catch (e) {
    return Response.json({ error: 'Failed to fetch proposals' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/admin/proposals',
  method: ['GET']
}
