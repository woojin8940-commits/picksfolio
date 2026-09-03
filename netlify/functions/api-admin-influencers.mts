import { getStore } from '@netlify/blobs'
import { getSupabaseServer } from './_shared/supabase.mts'
import { requireAdmin } from './_shared/admin-auth.mts'
import { applyComplimentaryMembership } from './_shared/complimentary-memberships.mts'
import {
  applyOperatorMembershipGrant,
  listOperatorMembershipGrants,
  setOperatorMembershipGrant,
  type OperatorMembershipGrant,
} from './_shared/operator-membership-grants.mts'
import type { Config, Context } from '@netlify/functions'

type MembershipPlan = 'standard' | 'standard_ai' | 'commerce' | 'pro' | 'live'

interface SellerVerificationBlob {
  membership_active?: boolean
  membership_plan?: MembershipPlan | null
  membership_started_at?: string | null
  updated_at?: string
  [key: string]: any
}

async function readSellerMembership(
  store: ReturnType<typeof getStore>,
  username: string,
): Promise<SellerVerificationBlob | null> {
  const clean = username.toLowerCase()
  const canonicalKey = `seller_${clean}`
  const canonical = (await store.get(canonicalKey, { type: 'json' })) as SellerVerificationBlob | null
  if (canonical) return canonical

  const legacy = (await store.get(clean, { type: 'json' })) as SellerVerificationBlob | null
  if (!legacy) return null
  await store.setJSON(canonicalKey, legacy)
  try { await store.delete(clean) } catch {}
  return legacy
}

function membershipSource(
  stored: SellerVerificationBlob | null,
  complimentary: SellerVerificationBlob | null,
  grant: OperatorMembershipGrant | null,
): 'operator' | 'complimentary' | 'paid' | null {
  if (grant?.active) return 'operator'
  if (complimentary?.membership_active && !stored?.membership_active) return 'complimentary'
  if (stored?.membership_active) return 'paid'
  return null
}

// Admin member management:
// - GET /api/admin/influencers          → list influencer profiles (role='user' or NULL) with aggregate stats + membership,
//                                         plus the business profiles (role='business') and the live-notify customers
//                                         (people who subscribed to a live broadcaster) so the operator dashboard can
//                                         render three segments: 유저 / 비즈니스 / 라이브 고객.
// - POST /api/admin/influencers/:username → toggle featured / update note / grant or revoke membership
//   body: { featured?: boolean, featured_note?: string, membership_plan?: 'standard' | 'commerce' | null }
export default async (req: Request, context: Context) => {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const supabase = getSupabaseServer()
  const username = context.params.username?.toLowerCase()
  const sellerStore = getStore({ name: 'seller-verification', consistency: 'strong' })
  const liveSubscriberStore = getStore({ name: 'live-notify-subscribers', consistency: 'strong' })

  if (req.method === 'GET' && !username) {
    try {
      // 1) All influencer profiles. Treat NULL role as influencer too —
      //    legacy accounts created before the role column was populated
      //    (or via flows that didn't stamp it) would otherwise be invisible
      //    to the admin dashboard. Business and admin roles are excluded.
      //
      //    Don't let a profile-query failure tank the whole endpoint:
      //    treat it as "no profiles" and rely on the auth.users backfill
      //    below to surface accounts. Otherwise a transient DB error or a
      //    schema drift on the role column makes the operator dashboard
      //    look completely empty.
      let profiles: any[] = []
      {
        const filtered = await supabase
          .from('profiles')
          .select('id, username, full_name, email, phone, role, kakao_id, featured, featured_at, featured_note, last_login_at, login_count, created_at')
          .or('role.is.null,role.eq.user')
          .order('created_at', { ascending: false })

        if (filtered.error) {
          console.warn('[admin-influencers] role-filtered profiles query failed, retrying without role filter:', filtered.error.message)
          // Fallback: maybe the role column is missing or has unexpected
          // values. Pull every profile and filter business accounts (which
          // use a `biz/` username prefix) out client-side.
          const all = await supabase
            .from('profiles')
            .select('id, username, full_name, email, phone, kakao_id, featured, featured_at, featured_note, last_login_at, login_count, created_at')
            .order('created_at', { ascending: false })
          if (all.error) {
            console.warn('[admin-influencers] unfiltered profiles query also failed:', all.error.message)
          } else {
            profiles = (all.data || []).filter((p: any) => !String(p.username || '').startsWith('biz/'))
          }
        } else {
          profiles = filtered.data || []
        }
      }

      // 2) Aggregate analytics (total clicks/views per username)
      const { data: analyticsRows } = await supabase
        .from('analytics')
        .select('username, views, clicks')

      const analyticsMap: Record<string, { views: number; clicks: number }> = {}
      for (const r of analyticsRows || []) {
        const u = (r as any).username
        if (!analyticsMap[u]) analyticsMap[u] = { views: 0, clicks: 0 }
        analyticsMap[u].views += (r as any).views || 0
        analyticsMap[u].clicks += (r as any).clicks || 0
      }

      // 3) Proposal counts per influencer
      const { data: proposalRows } = await supabase
        .from('business_proposals')
        .select('influencer_username, status')

      const proposalMap: Record<string, { total: number; accepted: number; rejected: number; pending: number; completed: number }> = {}
      for (const p of proposalRows || []) {
        const u = (p as any).influencer_username
        if (!proposalMap[u]) proposalMap[u] = { total: 0, accepted: 0, rejected: 0, pending: 0, completed: 0 }
        proposalMap[u].total++
        const s = (p as any).status as 'pending' | 'accepted' | 'rejected' | 'completed'
        if (s in proposalMap[u]) (proposalMap[u] as any)[s]++
      }

      const operatorGrants = await listOperatorMembershipGrants().catch((error) => {
        console.warn('[admin-influencers] operator membership grants query failed:', error)
        return []
      })
      const grantByUserId = new Map(operatorGrants.map((grant) => [grant.auth_user_id, grant]))

      const canonicalUsernames = new Set<string>(
        (profiles || [])
          .map((p: any) => String(p.username || '').toLowerCase())
          .filter(Boolean),
      )

      const influencers = await Promise.all(
        (profiles || []).map(async (p: any) => {
          const a = analyticsMap[p.username] || { views: 0, clicks: 0 }
          const pr = proposalMap[p.username] || { total: 0, accepted: 0, rejected: 0, pending: 0, completed: 0 }
          const acceptanceRate = pr.total > 0 ? Math.round((pr.accepted + pr.completed) / pr.total * 100) : 0

          // Normalize to the same lowercase key used by the write path
          // (POST below + apiService.getSellerVerification on the user side).
          // Without this, a legacy mixed-case profile.username makes the admin
          // panel display a stale "not granted" status even though the grant
          // itself landed under the correct lowercase key.
          const blobKey = String(p.username || '').toLowerCase()
          let stored = await readSellerMembership(sellerStore, blobKey)
          // Heal orphaned membership grants. Earlier flows (or admins clicking
          // before profile.username was set) could have written the blob under
          // a synthesized fallback key — email-local, auth.id slice, or the
          // Kakao provider id — instead of the canonical profile.username.
          // When that happened, the user-side `getSellerVerification(username)`
          // read returns nothing and the membership appears not to apply.
          // If the canonical key has no active membership but a synthesized
          // alternate does, migrate the blob into the canonical key (and
          // delete the orphan) so future reads succeed.
          if (!stored?.membership_active && blobKey) {
            const altKeys: string[] = []
            const emailLocal = String(p.email || '').split('@')[0].trim().toLowerCase()
            if (emailLocal) altKeys.push(emailLocal)
            const idSlice = String(p.id || '').slice(0, 8).toLowerCase()
            if (idSlice) altKeys.push(idSlice)
            if (p.kakao_id) altKeys.push(String(p.kakao_id).toLowerCase())

            for (const fk of altKeys) {
              if (!fk || fk === blobKey) continue
              // Don't hijack another user's canonical key.
              if (canonicalUsernames.has(fk)) continue
              try {
                const fallbackSv = await readSellerMembership(sellerStore, fk)
                if (fallbackSv?.membership_active) {
                  const migrated: SellerVerificationBlob = {
                    ...fallbackSv,
                    updated_at: new Date().toISOString(),
                  }
                  await sellerStore.setJSON(`seller_${blobKey}`, migrated)
                  try { await sellerStore.delete(`seller_${fk}`) } catch {}
                  stored = migrated
                  console.log(`[admin-influencers] migrated membership "${fk}" → "${blobKey}" for @${p.username}`)
                  break
                }
              } catch (e) {
                console.warn(`[admin-influencers] alt-key probe failed for "${fk}":`, e)
              }
            }
          }

          // Apply complimentary memberships so admin display matches what
          // the user sees on their account (the user-side read overlays the
          // same allowlist).
          const complimentary = applyComplimentaryMembership(blobKey, stored) as SellerVerificationBlob | null
          const operatorGrant = grantByUserId.get(String(p.id)) || null
          const effective = applyOperatorMembershipGrant(complimentary, operatorGrant) as SellerVerificationBlob | null

          return {
            id: p.id,
            username: p.username,
            has_profile: true,
            full_name: p.full_name,
            email: p.email,
            phone: p.phone,
            featured: !!p.featured,
            featured_at: p.featured_at,
            featured_note: p.featured_note,
            last_login_at: p.last_login_at,
            login_count: p.login_count || 0,
            created_at: p.created_at,
            views: a.views,
            clicks: a.clicks,
            proposals_total: pr.total,
            proposals_accepted: pr.accepted,
            proposals_rejected: pr.rejected,
            proposals_pending: pr.pending,
            proposals_completed: pr.completed,
            acceptance_rate: acceptanceRate,
            membership_active: !!effective?.membership_active,
            // Surface legacy 'live' as 'commerce' so the panel renders the current tier name.
            membership_plan: effective?.membership_plan === 'live' ? 'commerce' : (effective?.membership_plan || null),
            membership_started_at: effective?.membership_started_at || null,
            membership_source: membershipSource(stored, complimentary, operatorGrant),
            paid_membership_plan: stored?.membership_active
              ? (stored.membership_plan === 'live' ? 'commerce' : stored.membership_plan || null)
              : null,
            operator_membership_plan: operatorGrant?.active ? operatorGrant.plan : null,
          }
        }),
      )

      // 4) Business accounts. They live in the same `profiles` table with a
      //    `biz/` prefix on the username and `role='business'`. Surface them
      //    so the operator dashboard can list 비즈니스 회원 separately.
      //    Fall back to a username-prefix filter if the role column query
      //    fails so business accounts still appear.
      let businessProfiles: any[] = []
      {
        const byRole = await supabase
          .from('profiles')
          .select('id, username, full_name, email, phone, last_login_at, login_count, created_at')
          .eq('role', 'business')
          .order('created_at', { ascending: false })

        if (byRole.error) {
          console.warn('[admin-influencers] role=business query failed, falling back to biz/ prefix:', byRole.error.message)
          const byPrefix = await supabase
            .from('profiles')
            .select('id, username, full_name, email, phone, last_login_at, login_count, created_at')
            .like('username', 'biz/%')
            .order('created_at', { ascending: false })
          if (byPrefix.error) {
            console.warn('[admin-influencers] biz/ prefix fallback failed:', byPrefix.error.message)
          } else {
            businessProfiles = byPrefix.data || []
          }
        } else {
          businessProfiles = byRole.data || []
        }
      }

      // 4.5) Backfill from auth.users. Some signups land in `auth.users` without
      //      a matching `profiles` row (e.g. OAuth flows or partially-completed
      //      registrations where the profile insert didn't fire). Pull every
      //      auth user via the admin API and append the orphans as 유저 rows so
      //      the operator can still see and act on them.
      try {
        const profileIds = new Set<string>([
          ...((profiles || []).map((p: any) => p.id)),
          ...((businessProfiles || []).map((p: any) => p.id)),
        ])
        const seenUsernames = new Set<string>(
          (profiles || []).map((p: any) => String(p.username || '').toLowerCase()),
        )

        let page = 1
        const perPage = 1000
        while (true) {
          const { data: authData, error: authErr } = await supabase.auth.admin.listUsers({
            page,
            perPage,
          })
          if (authErr) throw authErr
          const users = authData?.users || []
          for (const u of users) {
            if (profileIds.has(u.id)) continue
            const meta = (u.user_metadata || {}) as Record<string, any>
            const emailLocal = (u.email || '').split('@')[0] || ''
            let username = String(meta.username || emailLocal || u.id.slice(0, 8)).toLowerCase()
            if (seenUsernames.has(username)) username = `${username}-${u.id.slice(0, 4)}`
            seenUsernames.add(username)

            const stored = await readSellerMembership(sellerStore, username)
            const complimentary = applyComplimentaryMembership(
              username,
              stored,
            ) as SellerVerificationBlob | null
            const operatorGrant = grantByUserId.get(String(u.id)) || null
            const effective = applyOperatorMembershipGrant(complimentary, operatorGrant) as SellerVerificationBlob | null

            influencers.push({
              id: u.id,
              username,
              has_profile: false,
              full_name: meta.full_name || meta.name || null,
              email: u.email || null,
              phone: u.phone || meta.phone || null,
              featured: false,
              featured_at: null,
              featured_note: null,
              last_login_at: u.last_sign_in_at || null,
              login_count: 0,
              created_at: u.created_at,
              views: 0,
              clicks: 0,
              proposals_total: 0,
              proposals_accepted: 0,
              proposals_rejected: 0,
              proposals_pending: 0,
              proposals_completed: 0,
              acceptance_rate: 0,
              membership_active: !!effective?.membership_active,
              membership_plan: effective?.membership_plan === 'live' ? 'commerce' : (effective?.membership_plan || null),
              membership_started_at: effective?.membership_started_at || null,
              membership_source: membershipSource(stored, complimentary, operatorGrant),
              paid_membership_plan: stored?.membership_active
                ? (stored.membership_plan === 'live' ? 'commerce' : stored.membership_plan || null)
                : null,
              operator_membership_plan: operatorGrant?.active ? operatorGrant.plan : null,
            })
          }
          if (users.length < perPage) break
          page++
        }

        influencers.sort((a, b) => {
          const ta = new Date(a.created_at || 0).getTime()
          const tb = new Date(b.created_at || 0).getTime()
          return tb - ta
        })
      } catch (e) {
        console.warn('[admin-influencers] auth.admin.listUsers failed:', e)
      }

      const businesses = (businessProfiles || []).map((p: any) => ({
        id: p.id,
        username: (p.username || '').replace(/^biz\//, ''),
        raw_username: p.username,
        full_name: p.full_name,
        email: p.email,
        phone: p.phone,
        last_login_at: p.last_login_at,
        login_count: p.login_count || 0,
        created_at: p.created_at,
      }))

      // 5) Live customers. People who subscribed to a creator's live-broadcast
      //    notifications via `/api/live-notify`. The subscriber list is stored
      //    per-influencer as a Netlify Blob; flatten into one customer-per-row.
      const liveCustomers: Array<{
        phone: string
        nickname: string
        subscribed_to: string
        subscribed_at: string
      }> = []
      try {
        const { blobs } = await liveSubscriberStore.list()
        await Promise.all(
          (blobs || []).map(async ({ key }) => {
            const data = (await liveSubscriberStore.get(key, { type: 'json' })) as
              | { subscribers?: Array<{ phone: string; nickname: string; subscribedAt: string }> }
              | null
            for (const s of data?.subscribers || []) {
              liveCustomers.push({
                phone: s.phone,
                nickname: s.nickname,
                subscribed_to: key,
                subscribed_at: s.subscribedAt,
              })
            }
          }),
        )
      } catch (e) {
        // If the blob store hasn't been seeded yet, treat as empty.
        console.warn('[admin-influencers] live-notify-subscribers list failed:', e)
      }

      liveCustomers.sort((a, b) => {
        const ta = new Date(a.subscribed_at).getTime() || 0
        const tb = new Date(b.subscribed_at).getTime() || 0
        return tb - ta
      })

      return Response.json({ influencers, businesses, liveCustomers })
    } catch (e: any) {
      return Response.json({ error: e?.message || 'Failed to fetch influencers' }, { status: 500 })
    }
  }

  if (req.method === 'POST' && username) {
    try {
      const body = (await req.json()) as {
        featured?: boolean
        featured_note?: string
        membership_plan?: 'standard' | 'standard_ai' | 'commerce' | 'pro' | null
        auth_user_id?: string
      }

      const profileUpdate: Record<string, any> = {}
      if (typeof body.featured === 'boolean') {
        profileUpdate.featured = body.featured
        profileUpdate.featured_at = body.featured ? new Date().toISOString() : null
      }
      if (typeof body.featured_note === 'string') {
        profileUpdate.featured_note = body.featured_note
      }

      const membershipProvided = Object.prototype.hasOwnProperty.call(body, 'membership_plan')

      if (Object.keys(profileUpdate).length === 0 && !membershipProvided) {
        return Response.json({ error: 'No fields to update' }, { status: 400 })
      }

      let profileRow: any = null
      if (Object.keys(profileUpdate).length > 0) {
        const { data, error } = await supabase
          .from('profiles')
          .update(profileUpdate)
          .eq('username', username)
          .select('username, featured, featured_at, featured_note')
          .maybeSingle()

        if (error) throw error
        if (!data) return Response.json({ error: 'Influencer not found' }, { status: 404 })
        profileRow = data
      }

      let membershipResult: {
        membership_active: boolean
        membership_plan: 'standard' | 'standard_ai' | 'commerce' | 'pro' | null
        membership_started_at: string | null
        membership_source: 'operator' | 'complimentary' | 'paid' | null
        paid_membership_plan: MembershipPlan | null
        operator_membership_plan: 'standard' | 'standard_ai' | 'commerce' | 'pro' | null
      } | null = null

      if (membershipProvided) {
        const tier = body.membership_plan
        if (
          tier !== null &&
          tier !== 'standard' &&
          tier !== 'standard_ai' &&
          tier !== 'commerce' &&
          tier !== 'pro'
        ) {
          return Response.json(
            { error: 'membership_plan must be "standard", "standard_ai", "commerce", "pro", or null' },
            { status: 400 },
          )
        }

        const authUserId = String(body.auth_user_id || '').trim()
        if (!authUserId) {
          return Response.json({ error: 'auth_user_id is required for membership updates' }, { status: 400 })
        }

        const { data: targetAuth, error: targetAuthError } = await supabase.auth.admin.getUserById(authUserId)
        if (targetAuthError || !targetAuth?.user) {
          return Response.json({ error: '회원 계정을 찾을 수 없습니다.' }, { status: 404 })
        }

        const { data: targetProfile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', authUserId)
          .maybeSingle()
        const grantUsername = String(targetProfile?.username || username).toLowerCase()
        const grant = await setOperatorMembershipGrant({
          authUserId,
          username: grantUsername,
          plan: tier,
          grantedBy: String((auth.user as any)?.email || (auth.user as any)?.id || ''),
        })
        const stored = targetProfile?.username
          ? await readSellerMembership(sellerStore, grantUsername)
          : null
        const complimentary = applyComplimentaryMembership(grantUsername, stored) as SellerVerificationBlob | null
        const effective = applyOperatorMembershipGrant(complimentary, grant) as SellerVerificationBlob | null
        membershipResult = {
          membership_active: !!effective?.membership_active,
          membership_plan: (effective?.membership_plan || null) as 'standard' | 'standard_ai' | 'commerce' | 'pro' | null,
          membership_started_at: effective?.membership_started_at || null,
          membership_source: membershipSource(stored, complimentary, grant),
          paid_membership_plan: stored?.membership_active
            ? (stored.membership_plan === 'live' ? 'commerce' : stored.membership_plan || null)
            : null,
          operator_membership_plan: grant.active ? grant.plan : null,
        }
      }

      return Response.json({
        success: true,
        influencer: profileRow,
        membership: membershipResult,
      })
    } catch (e: any) {
      return Response.json({ error: e?.message || 'Failed to update' }, { status: 500 })
    }
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: ['/api/admin/influencers', '/api/admin/influencers/:username'],
  method: ['GET', 'POST']
}
