import type { Config } from '@netlify/functions'

// Instagram OAuth - Step 1: Redirect user to Instagram login
export default async (req: Request) => {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  const clientId = process.env.INSTAGRAM_APP_ID
  const clientSecret = process.env.INSTAGRAM_APP_SECRET
  const siteUrl = (process.env.URL || 'https://picks-folio.com').replace(/\/+$/, '')
  const redirectUri = `${siteUrl}/api/instagram-callback`

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({
      error: 'Instagram 앱이 설정되지 않았습니다. 환경 변수를 확인해주세요.',
      detail: 'INSTAGRAM_APP_ID와 INSTAGRAM_APP_SECRET 환경변수가 필요합니다.'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (action === 'login') {
    // Redirect to Instagram OAuth (uses Instagram's own login page)
    const scope = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments'
    const state = url.searchParams.get('user_id') || ''
    const authUrl = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=code&state=${encodeURIComponent(state)}`

    return new Response(null, {
      status: 302,
      headers: { Location: authUrl }
    })
  }

  if (action === 'status') {
    // Check if user has connected Instagram
    const userId = url.searchParams.get('user_id')
    if (!userId) {
      return new Response(JSON.stringify({ connected: false }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // We'll check Supabase for token presence
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://rjksilpewohjvtbxrsvu.supabase.co'
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ connected: false }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/instagram_accounts?user_id=eq.${userId}&select=id,instagram_user_id,instagram_username,connected_at`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      }
    })

    const data = await res.json()
    if (data && data.length > 0) {
      return new Response(JSON.stringify({
        connected: true,
        instagram_username: data[0].instagram_username,
        instagram_user_id: data[0].instagram_user_id,
        connected_at: data[0].connected_at,
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ connected: false }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  if (action === 'disconnect') {
    const userId = url.searchParams.get('user_id')
    if (!userId) {
      return new Response(JSON.stringify({ error: 'user_id가 필요합니다.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://rjksilpewohjvtbxrsvu.supabase.co'
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (supabaseUrl && supabaseKey) {
      await fetch(`${supabaseUrl}/rest/v1/instagram_accounts?user_id=eq.${userId}`, {
        method: 'DELETE',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        }
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ error: 'Invalid action' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  })
}

export const config: Config = {
  path: '/api/instagram-auth'
}
