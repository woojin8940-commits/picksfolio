import type { Config } from '@netlify/functions'

// Instagram OAuth Callback - Step 2: Exchange code for token (Instagram Login flow)
export default async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') // user_id
  const error = url.searchParams.get('error')

  const clientId = process.env.INSTAGRAM_APP_ID!
  const clientSecret = process.env.INSTAGRAM_APP_SECRET!
  const siteUrl = (process.env.URL || 'https://picks-folio.com').replace(/\/+$/, '')
  const redirectUri = `${siteUrl}/api/instagram-callback`

  if (error) {
    return new Response(redirectHtml(siteUrl, 'error', 'Instagram 연동이 취소되었습니다.'), {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  if (!code) {
    return new Response(redirectHtml(siteUrl, 'error', '인증 코드가 없습니다.'), {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  try {
    // Exchange code for short-lived token via Instagram API
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      })
    })

    const tokenData = await tokenRes.json()

    if (tokenData.error_type || tokenData.error_message) {
      console.error('Token exchange error:', JSON.stringify(tokenData))
      const errorMsg = tokenData.error_message || '토큰 교환에 실패했습니다.'
      return new Response(redirectHtml(siteUrl, 'error', `오류: ${errorMsg}`), {
        headers: { 'Content-Type': 'text/html' }
      })
    }

    const shortToken = tokenData.access_token
    const igUserIdFromToken = tokenData.user_id

    if (!shortToken) {
      return new Response(redirectHtml(siteUrl, 'error', '액세스 토큰을 받지 못했습니다.'), {
        headers: { 'Content-Type': 'text/html' }
      })
    }

    // Exchange for long-lived token (60 days) via Instagram Graph API
    const longTokenRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${shortToken}`
    )
    const longTokenData = await longTokenRes.json()
    const longToken = longTokenData.access_token || shortToken

    // Get Instagram user profile info
    const profileRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=user_id,username,name&access_token=${longToken}`
    )
    const profileData = await profileRes.json()

    const igUserId = profileData.user_id || igUserIdFromToken?.toString() || ''
    const igUsername = profileData.username || ''

    if (!igUserId) {
      return new Response(redirectHtml(siteUrl, 'error', 'Instagram 계정 정보를 가져올 수 없습니다.'), {
        headers: { 'Content-Type': 'text/html' }
      })
    }

    // Save to Supabase
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://rjksilpewohjvtbxrsvu.supabase.co'
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (supabaseUrl && supabaseKey && state) {
      // Upsert the instagram account
      await fetch(`${supabaseUrl}/rest/v1/instagram_accounts`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          user_id: state,
          instagram_user_id: igUserId,
          instagram_username: igUsername,
          access_token: longToken,
          page_access_token: longToken, // Instagram Login uses the same token for messaging
          token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days
          connected_at: new Date().toISOString(),
        })
      })
    }

    return new Response(redirectHtml(siteUrl, 'success', `@${igUsername} 계정이 성공적으로 연동되었습니다!`), {
      headers: { 'Content-Type': 'text/html' }
    })

  } catch (err: any) {
    console.error('Instagram callback error:', err)
    return new Response(redirectHtml(siteUrl, 'error', '연동 중 오류가 발생했습니다.'), {
      headers: { 'Content-Type': 'text/html' }
    })
  }
}

function redirectHtml(siteUrl: string, status: string, message: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Instagram 연동</title></head>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'instagram-auth', status: '${status}', message: '${message.replace(/'/g, "\\'")}' }, '${siteUrl}');
    window.close();
  } else {
    window.location.href = '${siteUrl}/admin?ig_status=${status}&ig_message=${encodeURIComponent(message)}';
  }
</script>
<p>${message}</p>
<p>이 창이 자동으로 닫히지 않으면 <a href="${siteUrl}/admin">여기를 클릭</a>해주세요.</p>
</body>
</html>`
}

export const config: Config = {
  path: '/api/instagram-callback'
}
