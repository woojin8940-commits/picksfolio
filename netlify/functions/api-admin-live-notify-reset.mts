import { getStore } from '@netlify/blobs'
import { requireAdmin } from './_shared/admin-auth.mts'
import type { Config, Context } from '@netlify/functions'

// Wipes every entry in the `live-notify-subscribers` blob store, removing
// all live-notification subscribers across every influencer in one shot.
// Admin-only.
export default async (req: Request, _context: Context) => {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const store = getStore({ name: 'live-notify-subscribers', consistency: 'strong' })

  let removedKeys = 0
  let removedSubscribers = 0

  try {
    const { blobs } = await store.list()
    await Promise.all(
      (blobs || []).map(async ({ key }) => {
        const data = (await store.get(key, { type: 'json' })) as
          | { subscribers?: Array<{ phone: string }> }
          | null
        removedSubscribers += data?.subscribers?.length || 0
        await store.delete(key)
        removedKeys += 1
      }),
    )
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Reset failed' }, { status: 500 })
  }

  return Response.json({ success: true, removedKeys, removedSubscribers })
}

export const config: Config = {
  path: '/api/admin/live-notify/reset',
  method: ['POST'],
}
