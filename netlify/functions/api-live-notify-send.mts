import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { SolapiMessageService } from 'solapi'
import { incrementAlimtalkUsage } from './_shared/alimtalk-usage.mts'

/**
 * 라이브 시작 시 구독자에게 알림톡 발송
 * POST /api/live-notify-send
 * body: { influencer: string }
 */

interface Subscriber {
  phone: string
  nickname: string
  subscribedAt: string
}

interface SubscriberList {
  subscribers: Subscriber[]
}

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const body = await req.json() as { influencer: string; broadcastTitle?: string; startedAt?: string }
  const influencer = body.influencer?.toLowerCase()
  const broadcastTitle = (body.broadcastTitle || '').trim() || '라이브 방송'
  const startedAtIso = body.startedAt || new Date().toISOString()

  if (!influencer) {
    return Response.json({ error: 'influencer is required' }, { status: 400 })
  }

  // Format start time in Korean (e.g. "4월 27일 오후 8:30")
  let startedAtLabel = startedAtIso
  try {
    const d = new Date(startedAtIso)
    startedAtLabel = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d)
  } catch {}

  const store = getStore({ name: 'live-notify-subscribers', consistency: 'strong' })
  const data = await store.get(influencer, { type: 'json' }) as SubscriberList | null
  const subscribers = data?.subscribers || []

  if (subscribers.length === 0) {
    return Response.json({ success: true, sent: 0, message: 'No subscribers' })
  }

  // Get influencer profile name
  let influencerName = influencer
  const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (supabaseUrl && serviceRoleKey) {
    try {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('username', influencer)
        .maybeSingle()
      if (profile?.full_name) {
        influencerName = profile.full_name
      }
    } catch {}
  }

  const apiKey = process.env.SOLAPI_API_KEY || ''
  const apiSecret = process.env.SOLAPI_API_SECRET || ''
  const fromNumber = process.env.SOLAPI_FROM_NUMBER || ''
  const kakaoPfId = process.env.SOLAPI_KAKAO_PFID || ''
  const liveNotifyTemplateId = process.env.SOLAPI_KAKAO_LIVE_NOTIFY_TEMPLATE_ID || ''

  if (!apiKey || !apiSecret) {
    console.error('[live-notify-send] Solapi API keys not configured')
    return Response.json({ error: 'Notification service not configured' }, { status: 500 })
  }

  const messageService = new SolapiMessageService(apiKey, apiSecret)
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || ''
  // Personal page of the broadcaster (e.g. https://picks-folio.com/<username>).
  // This is the destination for the "라이브 보러가기" link in the alimtalk —
  // the link must lead to the broadcasting person's personal page, not their name.
  const liveUrl = `${siteUrl}/${influencer}`

  let sentCount = 0
  let failCount = 0

  for (const subscriber of subscribers) {
    try {
      const toNumber = subscriber.phone.replace(/[^0-9]/g, '')
      const customerName = subscriber.nickname || ''
      const message = `${customerName ? customerName + '님, ' : ''}${influencerName}님이 라이브를 시작했습니다!\n방송: ${broadcastTitle}\n시작: ${startedAtLabel}\n${liveUrl}`

      if (kakaoPfId && liveNotifyTemplateId) {
        // Try Kakao alimtalk first.
        // The registered template's "라이브 보러가기" button URL is
        // https://picks-folio.com/#{username} (mobile + PC) — only #{username}
        // needs substitution for the link to resolve to the broadcaster's
        // personal page. No buttons override is sent: Kakao Business does not
        // allow per-message button URL changes outside the approved template,
        // and overriding here would cause the registered URL to fall back.
        try {
          await messageService.sendOne({
            to: toNumber,
            from: fromNumber,
            text: message,
            kakaoOptions: {
              pfId: kakaoPfId,
              templateId: liveNotifyTemplateId,
              variables: {
                '#{고객명}': customerName,
                '#{인플루언서명}': influencerName,
                '#{라이브제목}': broadcastTitle,
                '#{시작시간}': startedAtLabel,
                '#{username}': influencer,
              },
            },
          })
          sentCount++
          continue
        } catch (kakaoErr) {
          console.warn('[live-notify-send] Alimtalk failed for', toNumber, kakaoErr)
        }
      }

      // Fallback to SMS
      if (fromNumber) {
        await messageService.sendOne({
          to: toNumber,
          from: fromNumber,
          text: message,
        })
        sentCount++
      } else {
        failCount++
      }
    } catch (err) {
      console.error('[live-notify-send] Failed to send to subscriber:', err)
      failCount++
    }
  }

  console.log(`[live-notify-send] ${influencer}: sent=${sentCount}, failed=${failCount}, total=${subscribers.length}`)

  // Record usage for billing/quota tracking
  if (sentCount > 0) {
    try {
      await incrementAlimtalkUsage(influencer, sentCount)
    } catch (usageErr) {
      console.warn('[live-notify-send] Failed to record usage:', usageErr)
    }
  }

  return Response.json({
    success: true,
    sent: sentCount,
    failed: failCount,
    total: subscribers.length,
  })
}

export const config: Config = {
  path: '/api/live-notify-send',
  method: ['POST'],
}
