import type { Config } from '@netlify/functions'

// Send Instagram DM via Graph API
export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.json()
    const { user_id, recipient_id, message } = body

    if (!user_id || !recipient_id || !message) {
      return new Response(JSON.stringify({
        error: 'user_id, recipient_id, message가 필요합니다.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://rjksilpewohjvtbxrsvu.supabase.co'
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: '서버 설정 오류' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get user's Instagram access token from Supabase
    const tokenRes = await fetch(
      `${supabaseUrl}/rest/v1/instagram_accounts?user_id=eq.${user_id}&select=instagram_user_id,page_access_token,token_expires_at`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        }
      }
    )
    const accounts = await tokenRes.json()

    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({
        error: 'Instagram 계정이 연동되지 않았습니다.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const account = accounts[0]

    // Check token expiry
    if (new Date(account.token_expires_at) < new Date()) {
      return new Response(JSON.stringify({
        error: 'Instagram 토큰이 만료되었습니다. 다시 연동해주세요.'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Send DM via Instagram Graph API
    const igUserId = account.instagram_user_id
    const accessToken = account.page_access_token

    const dmRes = await fetch(
      `https://graph.instagram.com/v21.0/${igUserId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipient_id },
          message: { text: message },
          access_token: accessToken,
        })
      }
    )

    const dmData = await dmRes.json()

    if (dmData.error) {
      console.error('Instagram DM error:', dmData.error)
      return new Response(JSON.stringify({
        error: 'DM 발송에 실패했습니다.',
        detail: dmData.error.message
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Log the sent DM to Supabase
    await fetch(`${supabaseUrl}/rest/v1/dm_send_logs`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id,
        recipient_ig_id: recipient_id,
        message_content: message,
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
    })

    return new Response(JSON.stringify({
      success: true,
      message_id: dmData.message_id || dmData.id
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('Send DM error:', err)
    return new Response(JSON.stringify({
      error: '서버 에러',
      message: err.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

export const config: Config = {
  path: '/api/send-dm'
}
