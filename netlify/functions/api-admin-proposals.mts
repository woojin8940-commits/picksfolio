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
    // Don't let a single failed sub-query empty the whole admin dashboard.
    // proposals failure is surfaced as an empty list rather than a 500 so
    // the operator can still see registered accounts in other tabs.
    let allProposals: any[] = []
    {
      const result = await supabase
        .from('business_proposals')
        .select('*')
        .order('created_at', { ascending: false })
      if (result.error) {
        console.warn('[admin-proposals] business_proposals query failed:', result.error.message)
      } else {
        allProposals = result.data || []
      }
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
