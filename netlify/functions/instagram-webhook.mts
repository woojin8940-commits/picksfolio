import type { Config } from '@netlify/functions'

// Instagram Webhook - Receives comment/message events from Instagram
// This handles the webhook verification and incoming events
export default async (req: Request) => {
  const url = new URL(req.url)

  // GET - Webhook verification (Facebook requires this)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    const verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || 'picks-folio-webhook-verify'

    if (mode === 'subscribe' && token === verifyToken) {
      return new Response(challenge, { status: 200 })
    }

    return new Response('Forbidden', { status: 403 })
  }

  // POST - Incoming webhook events
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://rjksilpewohjvtbxrsvu.supabase.co'
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

      if (!supabaseUrl || !supabaseKey) {
        return new Response('OK', { status: 200 })
      }

      const headers = {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      }

      // Process each entry
      if (body.entry) {
        for (const entry of body.entry) {
          // Handle comments on posts/reels
          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.field === 'comments') {
                await handleComment(change.value, entry.id, supabaseUrl, headers)
              }
              if (change.field === 'messages') {
                await handleDirectMessage(change.value, entry.id, supabaseUrl, headers)
              }
            }
          }

          // Handle messaging events
          if (entry.messaging) {
            for (const event of entry.messaging) {
              if (event.message) {
                await handleDirectMessage(event, entry.id, supabaseUrl, headers)
              }
            }
          }
        }
      }

      return new Response('OK', { status: 200 })
    } catch (err) {
      console.error('Webhook processing error:', err)
      return new Response('OK', { status: 200 }) // Always return 200 to prevent retries
    }
  }

  return new Response('Method not allowed', { status: 405 })
}

async function handleComment(
  commentData: any,
  igAccountId: string,
  supabaseUrl: string,
  headers: Record<string, string>
) {
  const commentText = commentData.text || ''
  const commenterId = commentData.from?.id || ''
  const mediaId = commentData.media?.id || ''

  // Find the account and active materials
  const accountRes = await fetch(
    `${supabaseUrl}/rest/v1/instagram_accounts?instagram_user_id=eq.${igAccountId}&select=user_id,page_access_token,instagram_user_id`,
    { headers }
  )
  const accounts = await accountRes.json()
  if (!accounts || accounts.length === 0) return

  const account = accounts[0]

  // Get active materials for this user
  const materialsRes = await fetch(
    `${supabaseUrl}/rest/v1/dm_materials?user_id=eq.${account.user_id}&status=eq.active&order=updated_at.desc`,
    { headers }
  )
  const materials = await materialsRes.json()
  if (!materials || materials.length === 0) return

  // Find matching material based on keywords
  for (const material of materials) {
    const keywords: string[] = material.keywords || []
    const excludeKeywords: string[] = material.exclude_keywords || []

    // Check exclude keywords first
    const hasExclude = excludeKeywords.some(k => commentText.includes(k))
    if (hasExclude) continue

    // Check include keywords (OR condition)
    const hasInclude = keywords.length === 0 || keywords.some(k => commentText.includes(k))
    if (!hasInclude) continue

    // Check post condition
    if (material.send_condition === 'selected' && material.selected_posts) {
      const selectedPostIds = material.selected_posts.map((p: any) => p.id)
      if (!selectedPostIds.includes(mediaId)) continue
    }

    // Check if we already sent a DM to this user recently (prevent duplicates)
    const recentCheck = await fetch(
      `${supabaseUrl}/rest/v1/dm_send_logs?user_id=eq.${account.user_id}&recipient_ig_id=eq.${commenterId}&sent_at=gte.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}&limit=1`,
      { headers }
    )
    const recentLogs = await recentCheck.json()
    if (recentLogs && recentLogs.length > 0) break // Already sent recently

    // Send DM
    const messageContent = material.message_content || '안녕하세요! 관심 가져주셔서 감사합니다.'

    const dmRes = await fetch(
      `https://graph.instagram.com/v21.0/${account.instagram_user_id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: commenterId },
          message: { text: messageContent },
          access_token: account.page_access_token,
        })
      }
    )

    const dmResult = await dmRes.json()

    // Log the DM
    await fetch(`${supabaseUrl}/rest/v1/dm_send_logs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: account.user_id,
        material_id: material.id,
        recipient_ig_id: commenterId,
        message_content: messageContent,
        trigger_type: 'comment',
        trigger_comment: commentText,
        status: dmResult.error ? 'failed' : 'sent',
        error_message: dmResult.error?.message || null,
        sent_at: new Date().toISOString(),
      })
    })

    break // Send only from the first matching material
  }
}

async function handleDirectMessage(
  messageData: any,
  igAccountId: string,
  supabaseUrl: string,
  headers: Record<string, string>
) {
  const messageText = messageData.message?.text || messageData.text || ''
  const senderId = messageData.sender?.id || messageData.from?.id || ''

  if (!messageText || !senderId) return

  // Find the account
  const accountRes = await fetch(
    `${supabaseUrl}/rest/v1/instagram_accounts?instagram_user_id=eq.${igAccountId}&select=user_id,page_access_token,instagram_user_id`,
    { headers }
  )
  const accounts = await accountRes.json()
  if (!accounts || accounts.length === 0) return

  const account = accounts[0]

  // Don't reply to our own messages
  if (senderId === account.instagram_user_id) return

  // Check active materials for DM keyword match
  const materialsRes = await fetch(
    `${supabaseUrl}/rest/v1/dm_materials?user_id=eq.${account.user_id}&status=eq.active&order=updated_at.desc`,
    { headers }
  )
  const materials = await materialsRes.json()
  if (!materials || materials.length === 0) return

  for (const material of materials) {
    const dmKeyword = material.dm_keyword || ''
    if (!dmKeyword) continue

    // Check if the incoming message matches the DM keyword
    if (messageText.trim().toLowerCase() === dmKeyword.toLowerCase()) {
      const replyContent = material.message_content || material.dm_body_template || '안녕하세요!'

      const dmRes = await fetch(
        `https://graph.facebook.com/v21.0/${account.instagram_user_id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: senderId },
            message: { text: replyContent },
            access_token: account.page_access_token,
          })
        }
      )

      const dmResult = await dmRes.json()

      // Log the DM
      await fetch(`${supabaseUrl}/rest/v1/dm_send_logs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: account.user_id,
          material_id: material.id,
          recipient_ig_id: senderId,
          message_content: replyContent,
          trigger_type: 'dm_keyword',
          trigger_comment: messageText,
          status: dmResult.error ? 'failed' : 'sent',
          error_message: dmResult.error?.message || null,
          sent_at: new Date().toISOString(),
        })
      })

      break
    }
  }
}

export const config: Config = {
  path: '/api/instagram-webhook'
}
