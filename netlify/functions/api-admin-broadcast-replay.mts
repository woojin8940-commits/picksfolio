import { getStore } from '@netlify/blobs'
import { getSupabaseServer } from './_shared/supabase.mts'
import { requireAdmin } from './_shared/admin-auth.mts'
import type { Config, Context } from '@netlify/functions'

/**
 * Admin-only broadcast replay.
 *
 * GET /api/admin/broadcast-replay/:broadcastId
 *   → JSON metadata: broadcast row + recording info + payment timeline
 *     bucketed into 60-second windows from started_at to ended_at + 30min.
 *     Includes the peak-payment bucket (highest revenue) so the UI can
 *     overlay a marker on the video timeline. Also returns `videoUrl`
 *     containing a short-lived HMAC signature so the <video> element can
 *     stream the recording without an Authorization header.
 *
 * GET /api/admin/broadcast-replay/:broadcastId/video?exp=…&sig=…
 *   → Streams the recorded video bytes from Netlify Blobs. The <video>
 *     element cannot attach a Bearer token, so this endpoint accepts a
 *     signed URL issued by the metadata endpoint above. Falls back to
 *     `requireAdmin` if no signature is present (e.g. for direct testing).
 */

const BUCKET_SECONDS = 60
const POST_BROADCAST_WINDOW_SECONDS = 30 * 60
const VIDEO_TOKEN_TTL_SECONDS = 60 * 60 // 1 hour, plenty for a single replay session

interface OrderRecord {
  paymentId: string
  amount: number
  paidAt: string
  product?: { name?: string }
}

function getSigningSecret(): string {
  // Reuse an existing server-only secret. We never expose it; we only emit
  // HMAC signatures derived from it. Falling back to an empty string would
  // accept any signature, so refuse to sign instead.
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!s) throw new Error('signing secret not configured')
  return s
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function signVideoUrl(broadcastId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + VIDEO_TOKEN_TTL_SECONDS
  const sig = await hmacHex(`${broadcastId}.${exp}`, getSigningSecret())
  return `/api/admin/broadcast-replay/${encodeURIComponent(broadcastId)}/video?exp=${exp}&sig=${sig}`
}

async function verifyVideoSignature(broadcastId: string, expRaw: string | null, sig: string | null): Promise<boolean> {
  if (!expRaw || !sig) return false
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false
  let expected: string
  try {
    expected = await hmacHex(`${broadcastId}.${exp}`, getSigningSecret())
  } catch {
    return false
  }
  if (expected.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0
}

export default async (req: Request, context: Context) => {
  const broadcastId = (context.params as any).broadcastId
  const sub = (context.params as any).sub || ''
  if (!broadcastId) {
    return Response.json({ error: 'broadcastId required' }, { status: 400 })
  }

  const url = new URL(req.url)

  // Video stream: accept a signed URL (browser <video> element cannot send
  // the Authorization header), otherwise fall back to admin auth.
  if (sub === 'video') {
    const sigOk = await verifyVideoSignature(
      broadcastId,
      url.searchParams.get('exp'),
      url.searchParams.get('sig'),
    )
    if (!sigOk) {
      const auth = await requireAdmin(req)
      if (!auth.ok) return auth.response
    }

    const supabase = getSupabaseServer()
    const { data: broadcast, error } = await supabase
      .from('broadcast_history')
      .select('username, recording_blob_key, recording_mime, recording_size_bytes')
      .eq('id', broadcastId)
      .maybeSingle()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!broadcast) return Response.json({ error: 'broadcast not found' }, { status: 404 })

    const store = getStore({ name: 'broadcast-recordings', consistency: 'eventual' })

    // Prefer the back-filled blob key, but fall back to the deterministic
    // {username}/{broadcastId} layout used by the upload function. This
    // recovers from the rare case where the upload's DB back-fill failed
    // (e.g. the broadcast_history row didn't exist yet at upload time).
    const candidates: string[] = []
    if (broadcast.recording_blob_key) candidates.push(broadcast.recording_blob_key)
    if (broadcast.username) candidates.push(`${String(broadcast.username).toLowerCase()}/${broadcastId}`)

    let stream: ReadableStream | null = null
    let mime = broadcast.recording_mime || 'video/webm'
    let sizeBytes = broadcast.recording_size_bytes || null
    for (const key of candidates) {
      const result = await store.getWithMetadata(key, { type: 'stream' }).catch(() => null)
      if (result?.data) {
        stream = result.data as any
        const m = (result.metadata || {}) as Record<string, any>
        if (!broadcast.recording_mime && typeof m.mime === 'string') mime = m.mime
        if (!sizeBytes && m.sizeBytes) sizeBytes = Number(m.sizeBytes) || sizeBytes
        break
      }
    }
    if (!stream) {
      return Response.json({ error: 'no recording for this broadcast' }, { status: 404 })
    }

    return new Response(stream as any, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=300',
        ...(sizeBytes ? { 'Content-Length': String(sizeBytes) } : {}),
      },
    })
  }

  // Metadata: admin only.
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const supabase = getSupabaseServer()
  const { data: broadcast, error } = await supabase
    .from('broadcast_history')
    .select('*')
    .eq('id', broadcastId)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!broadcast) return Response.json({ error: 'broadcast not found' }, { status: 404 })

  // If the DB doesn't have the recording key yet, check the blob store
  // directly using the deterministic {username}/{broadcastId} layout —
  // covers the upload-before-DB-insert race.
  let hasRecording = !!broadcast.recording_blob_key
  let recordingMime = broadcast.recording_mime as string | null
  let recordingSizeBytes = broadcast.recording_size_bytes as number | null
  if (!hasRecording && broadcast.username) {
    try {
      const store = getStore({ name: 'broadcast-recordings', consistency: 'eventual' })
      const fallbackKey = `${String(broadcast.username).toLowerCase()}/${broadcastId}`
      const meta = await store.getMetadata(fallbackKey).catch(() => null)
      if (meta) {
        hasRecording = true
        const m = (meta.metadata || {}) as Record<string, any>
        if (!recordingMime && typeof m.mime === 'string') recordingMime = m.mime
        if (!recordingSizeBytes && m.sizeBytes) recordingSizeBytes = Number(m.sizeBytes) || null
        // Heal the DB so future requests don't hit this fallback.
        try {
          await supabase
            .from('broadcast_history')
            .update({
              recording_blob_key: fallbackKey,
              recording_mime: recordingMime,
              recording_size_bytes: recordingSizeBytes,
            })
            .eq('id', broadcastId)
        } catch {}
      }
    } catch {}
  }

  // Build payment timeline from the live-orders blob for this seller.
  const username = (broadcast.username || '').toLowerCase()
  const startedAt = new Date(broadcast.started_at).getTime()
  const endedAt = broadcast.ended_at
    ? new Date(broadcast.ended_at).getTime()
    : startedAt + (Number(broadcast.duration_minutes) || 0) * 60_000
  const windowEnd = endedAt + POST_BROADCAST_WINDOW_SECONDS * 1000

  const ordersStore = getStore({ name: 'live-orders', consistency: 'eventual' })
  const ordersData = (await ordersStore.get(username, { type: 'json' })) as
    | { orders?: OrderRecord[] }
    | OrderRecord[]
    | null

  const orders: OrderRecord[] = Array.isArray(ordersData)
    ? (ordersData as OrderRecord[])
    : ordersData?.orders || []

  const inWindowOrders = orders.filter(o => {
    const t = new Date(o.paidAt || 0).getTime()
    return Number.isFinite(t) && t >= startedAt && t <= windowEnd
  })

  // Bucket orders into 60-second windows since broadcast start.
  const totalSeconds = Math.max(60, Math.round((windowEnd - startedAt) / 1000))
  const bucketCount = Math.ceil(totalSeconds / BUCKET_SECONDS)
  const buckets: Array<{
    bucketIndex: number
    startOffsetSeconds: number
    endOffsetSeconds: number
    count: number
    amount: number
  }> = []
  for (let i = 0; i < bucketCount; i++) {
    buckets.push({
      bucketIndex: i,
      startOffsetSeconds: i * BUCKET_SECONDS,
      endOffsetSeconds: (i + 1) * BUCKET_SECONDS,
      count: 0,
      amount: 0,
    })
  }
  for (const o of inWindowOrders) {
    const offsetSec = (new Date(o.paidAt).getTime() - startedAt) / 1000
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(offsetSec / BUCKET_SECONDS)))
    buckets[idx].count += 1
    buckets[idx].amount += Number(o.amount) || 0
  }

  // Peak bucket: highest revenue, tie-break by count.
  let peakIndex = -1
  let peakScore = 0
  buckets.forEach((b, i) => {
    const score = b.amount + b.count * 0.0001
    if (score > peakScore) {
      peakScore = score
      peakIndex = i
    }
  })
  const peakBucket = peakIndex >= 0 ? buckets[peakIndex] : null

  const recordingDurationSeconds =
    Number(broadcast.recording_duration_seconds) ||
    Math.max(0, Math.round((endedAt - startedAt) / 1000))

  // Sign a short-lived video URL so the <video> element can stream the
  // recording without sending an Authorization header.
  let videoUrl: string | null = null
  if (hasRecording) {
    try {
      videoUrl = await signVideoUrl(broadcastId)
    } catch {
      videoUrl = null
    }
  }

  return Response.json({
    broadcast: {
      id: broadcast.id,
      username: broadcast.username,
      startedAt: broadcast.started_at,
      endedAt: broadcast.ended_at,
      durationMinutes: broadcast.duration_minutes,
      peakViewers: broadcast.peak_viewers,
      totalMessages: broadcast.total_messages,
      revenue: broadcast.revenue,
      products: broadcast.products,
      cartStats: broadcast.cart_stats,
      hasRecording,
      recordingMime,
      recordingSizeBytes,
      recordingDurationSeconds,
      videoUrl,
    },
    timeline: {
      bucketSeconds: BUCKET_SECONDS,
      totalSeconds,
      buckets,
      peakBucketIndex: peakIndex,
      peakBucket,
      orderCount: inWindowOrders.length,
      totalAmount: inWindowOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0),
    },
  })
}

export const config: Config = {
  path: [
    '/api/admin/broadcast-replay/:broadcastId',
    '/api/admin/broadcast-replay/:broadcastId/:sub',
  ],
  method: ['GET'],
}
