import { getStore } from '@netlify/blobs'
import { getSupabaseServer } from './_shared/supabase.mts'
import { requireAdmin } from './_shared/admin-auth.mts'
import {
  INCLUDED_MINUTES_PER_MONTH,
  OVERAGE_RATE_KRW_PER_MINUTE,
  MONTHLY_HARD_CAP_MINUTES,
  DAILY_HARD_CAP_MINUTES,
} from './_shared/live-pricing.mts'
import type { Config, Context } from '@netlify/functions'

// Admin live commerce console
// GET  /api/admin/live-overview                 → ongoing broadcasts + recent history
// GET  /api/admin/live-overview/usage           → per-user monthly broadcast time + cap status
// POST /api/admin/live-overview/:username/end   → force-end broadcast (toggle isLive=false)
//   body: { reason: string }
// POST /api/admin/live-overview/:username/highlight
//   body: { recordId: string, highlight: boolean, note?: string }
// GET  /api/admin/live-overview/moderation      → flagged chat messages + banned-word rules
// POST /api/admin/live-overview/moderation
//   body: { action: 'review', id: string, status: 'allowed'|'blocked'|'hidden' }
//   body: { action: 'add_rule', word: string, severity?: 'flag'|'block' }
//   body: { action: 'delete_rule', id: string }
//   body: { action: 'flag', broadcast_username, viewer_id?, viewer_user?, message, matched_word? }
export default async (req: Request, context: Context) => {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const supabase = getSupabaseServer()
  const username = (context.params as any).username?.toLowerCase()
  const action = (context.params as any).action || ''
  const url = new URL(req.url)
  const isModeration = url.pathname.endsWith('/moderation')
  const isUsage = url.pathname.endsWith('/usage')

  if (isUsage && req.method === 'GET') {
    try {
      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()

      const { data, error } = await supabase
        .from('broadcast_history')
        .select('username, started_at, duration_minutes')
        .gte('started_at', monthStart)

      if (error && !(error.code === '42P01' || error.message?.includes('does not exist'))) {
        return Response.json({ error: error.message }, { status: 500 })
      }

      const records = (data || []) as Array<{ username: string; started_at: string; duration_minutes: number | null }>
      const byUser = new Map<string, { totalMinutes: number; todayMinutes: number; sessions: number; lastStartedAt: string | null }>()
      for (const r of records) {
        const u = (r.username || '').toLowerCase()
        if (!u) continue
        const mins = Math.max(0, Math.floor(Number(r.duration_minutes) || 0))
        const isToday = r.started_at && r.started_at >= dayStart
        const cur = byUser.get(u) || { totalMinutes: 0, todayMinutes: 0, sessions: 0, lastStartedAt: null }
        cur.totalMinutes += mins
        if (isToday) cur.todayMinutes += mins
        cur.sessions += 1
        if (!cur.lastStartedAt || (r.started_at && r.started_at > cur.lastStartedAt)) {
          cur.lastStartedAt = r.started_at
        }
        byUser.set(u, cur)
      }

      // Pull liveness flags from blobs so admin can see who is currently broadcasting.
      const liveStore = getStore({ name: 'live-state', consistency: 'strong' })
      const liveSet = new Set<string>()
      try {
        const { blobs } = await liveStore.list()
        for (const b of blobs || []) {
          const data = (await liveStore.get(b.key, { type: 'json' })) as Record<string, any> | null
          if (data?.isLive) liveSet.add(b.key.toLowerCase())
        }
      } catch {}

      const usersInfo = Array.from(byUser.entries()).map(([u, agg]) => {
        const overageMinutes = Math.max(0, agg.totalMinutes - INCLUDED_MINUTES_PER_MONTH)
        return {
          username: u,
          totalMinutes: agg.totalMinutes,
          todayMinutes: agg.todayMinutes,
          sessions: agg.sessions,
          lastStartedAt: agg.lastStartedAt,
          includedMinutes: Math.min(agg.totalMinutes, INCLUDED_MINUTES_PER_MONTH),
          includedMinutesRemaining: Math.max(0, INCLUDED_MINUTES_PER_MONTH - agg.totalMinutes),
          overageMinutes,
          overageAmountKrw: Math.round(overageMinutes * OVERAGE_RATE_KRW_PER_MINUTE),
          monthlyHardCapReached: agg.totalMinutes >= MONTHLY_HARD_CAP_MINUTES,
          dailyHardCapReached: agg.todayMinutes >= DAILY_HARD_CAP_MINUTES,
          isLive: liveSet.has(u),
        }
      })
      // Surface live-but-no-history rows too (rare race between live flag and history insert)
      for (const liveUser of liveSet) {
        if (!byUser.has(liveUser)) {
          usersInfo.push({
            username: liveUser,
            totalMinutes: 0,
            todayMinutes: 0,
            sessions: 0,
            lastStartedAt: null,
            includedMinutes: 0,
            includedMinutesRemaining: INCLUDED_MINUTES_PER_MONTH,
            overageMinutes: 0,
            overageAmountKrw: 0,
            monthlyHardCapReached: false,
            dailyHardCapReached: false,
            isLive: true,
          })
        }
      }

      usersInfo.sort((a, b) => b.totalMinutes - a.totalMinutes)

      return Response.json({
        monthLabel: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
        users: usersInfo,
        pricing: {
          includedMinutesPerMonth: INCLUDED_MINUTES_PER_MONTH,
          monthlyHardCapMinutes: MONTHLY_HARD_CAP_MINUTES,
          dailyHardCapMinutes: DAILY_HARD_CAP_MINUTES,
          overageRateKrwPerMinute: OVERAGE_RATE_KRW_PER_MINUTE,
        },
      })
    } catch (e: any) {
      return Response.json({ error: e?.message || 'Failed' }, { status: 500 })
    }
  }

  // Moderation read/write
  if (isModeration) {
    if (req.method === 'GET') {
      try {
        const [{ data: flagged }, { data: rules }] = await Promise.all([
          supabase.from('chat_moderation_log').select('*').order('created_at', { ascending: false }).limit(200),
          supabase.from('chat_moderation_rules').select('*').order('created_at', { ascending: false }),
        ])
        return Response.json({ flagged: flagged || [], rules: rules || [] })
      } catch (e: any) {
        return Response.json({ error: e?.message || 'Failed' }, { status: 500 })
      }
    }
    if (req.method === 'POST') {
      const body = await req.json() as Record<string, any>
      try {
        if (body.action === 'review' && body.id && body.status) {
          const { error } = await supabase
            .from('chat_moderation_log')
            .update({
              status: body.status,
              reviewed_by: (auth.user as any).email || 'admin',
              reviewed_at: new Date().toISOString(),
            })
            .eq('id', body.id)
          if (error) throw error
          return Response.json({ success: true })
        }
        if (body.action === 'add_rule' && body.word) {
          const id = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          const { error } = await supabase.from('chat_moderation_rules').insert({
            id,
            word: String(body.word).trim().toLowerCase(),
            severity: body.severity === 'block' ? 'block' : 'flag',
            created_by: (auth.user as any).email || 'admin',
          })
          if (error) throw error
          return Response.json({ success: true, id })
        }
        if (body.action === 'delete_rule' && body.id) {
          const { error } = await supabase.from('chat_moderation_rules').delete().eq('id', body.id)
          if (error) throw error
          return Response.json({ success: true })
        }
        if (body.action === 'flag' && body.broadcast_username && body.message) {
          const id = `flag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          const { error } = await supabase.from('chat_moderation_log').insert({
            id,
            broadcast_username: String(body.broadcast_username).toLowerCase(),
            viewer_id: body.viewer_id || null,
            viewer_user: body.viewer_user || null,
            message: String(body.message).slice(0, 500),
            matched_word: body.matched_word || null,
            reason: body.reason || null,
            status: 'flagged',
          })
          if (error) throw error
          return Response.json({ success: true, id })
        }
        return Response.json({ error: 'Unknown action' }, { status: 400 })
      } catch (e: any) {
        return Response.json({ error: e?.message || 'Failed' }, { status: 500 })
      }
    }
    return new Response('Method not allowed', { status: 405 })
  }

  // Per-username actions
  if (req.method === 'POST' && username && action === 'end') {
    try {
      const body = await req.json().catch(() => ({})) as Record<string, any>
      const reason = body.reason || '운영자 강제 종료'

      const liveStore = getStore({ name: 'live-state', consistency: 'strong' })
      const viewerStore = getStore({ name: 'live-viewers', consistency: 'strong' })

      const prev = (await liveStore.get(username, { type: 'json' })) as Record<string, any> | null
      await liveStore.setJSON(username, {
        ...(prev || {}),
        isLive: false,
        viewerCount: 0,
        currentProduct: null,
        forceEndedBy: (auth.user as any).email || 'admin',
        forceEndReason: reason,
        updatedAt: new Date().toISOString(),
      })
      try { await viewerStore.setJSON(username, {}) } catch {}

      // Tag the most recent broadcast_history entry within 24h with the reason
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      await supabase
        .from('broadcast_history')
        .update({
          force_ended_by: (auth.user as any).email || 'admin',
          force_end_reason: reason,
        })
        .eq('username', username)
        .gte('started_at', since)

      return Response.json({ success: true })
    } catch (e: any) {
      return Response.json({ error: e?.message || 'Failed to force-end' }, { status: 500 })
    }
  }

  if (req.method === 'POST' && username && action === 'highlight') {
    try {
      const body = await req.json() as { recordId: string; highlight: boolean; note?: string }
      if (!body.recordId) return Response.json({ error: 'recordId required' }, { status: 400 })
      const { error } = await supabase
        .from('broadcast_history')
        .update({
          highlight: !!body.highlight,
          highlight_note: body.note || null,
        })
        .eq('id', body.recordId)
        .eq('username', username)
      if (error) throw error
      return Response.json({ success: true })
    } catch (e: any) {
      return Response.json({ error: e?.message || 'Failed' }, { status: 500 })
    }
  }

  // GET overview: all currently-live broadcasts + recent history
  if (req.method === 'GET') {
    try {
      const liveStore = getStore({ name: 'live-state', consistency: 'strong' })
      const viewerStore = getStore({ name: 'live-viewers', consistency: 'strong' })

      const { blobs } = await liveStore.list()
      const ongoing: any[] = []
      const now = Date.now()
      const HEARTBEAT_TIMEOUT = 30000

      for (const b of blobs || []) {
        const data = (await liveStore.get(b.key, { type: 'json' })) as Record<string, any> | null
        if (!data?.isLive) continue
        let activeViewers = 0
        try {
          const vd = (await viewerStore.get(b.key, { type: 'json' })) as Record<string, number> | null
          if (vd) activeViewers = Object.values(vd).filter(ts => now - ts < HEARTBEAT_TIMEOUT).length
        } catch {}
        ongoing.push({
          username: b.key,
          isLive: true,
          viewerCount: activeViewers,
          currentProduct: data.currentProduct || null,
          activeMaterial: data.activeMaterial || null,
          updatedAt: data.updatedAt || null,
        })
      }

      // Estimate revenue per live username from completed live orders (live-orders blob)
      // (Best-effort; if blob missing, revenue stays 0.)
      try {
        const ordersStore = getStore({ name: 'live-orders', consistency: 'eventual' })
        for (const room of ongoing) {
          try {
            const orders = (await ordersStore.get(room.username, { type: 'json' })) as any[] | null
            if (Array.isArray(orders)) {
              const sinceTs = new Date(room.updatedAt || Date.now() - 24 * 3600 * 1000).getTime() - 24 * 3600 * 1000
              room.revenue = orders
                .filter(o => new Date(o.completed_at || o.created_at || 0).getTime() >= sinceTs)
                .reduce((s, o) => s + (Number(o.amount) || 0), 0)
            } else {
              room.revenue = 0
            }
          } catch { room.revenue = 0 }
        }
      } catch {}

      const { data: history } = await (() => {
        // Optional ?username= filter for searching replays/history by seller.
        // Matched as case-insensitive prefix so "joh" finds "john", "johnny", …
        const usernameQuery = (url.searchParams.get('username') || '').trim().toLowerCase()
        const limitRaw = Number(url.searchParams.get('limit') || 50)
        const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50))
        let q = supabase
          .from('broadcast_history')
          .select('*')
          .order('started_at', { ascending: false })
          .limit(limit)
        if (usernameQuery) {
          // ilike with sanitized pattern; strip wildcard chars to avoid abuse.
          const safe = usernameQuery.replace(/[%_]/g, '')
          q = q.ilike('username', `${safe}%`)
        }
        return q
      })()

      return Response.json({
        ongoing,
        history: history || [],
      })
    } catch (e: any) {
      return Response.json({ error: e?.message || 'Failed' }, { status: 500 })
    }
  }

  return new Response('Method not allowed', { status: 405 })
}

export const config: Config = {
  path: [
    '/api/admin/live-overview',
    '/api/admin/live-overview/usage',
    '/api/admin/live-overview/moderation',
    '/api/admin/live-overview/:username/:action',
  ],
  method: ['GET', 'POST'],
}
