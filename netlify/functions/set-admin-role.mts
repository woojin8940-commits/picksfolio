import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'

const TARGET_EMAIL = 'woojin8940@inplace-ad.com'

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Accept both GET and PUT
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'PUT') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
  }

  const identity = (context as any).clientContext?.identity
  if (!identity?.url || !identity?.token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Identity 서비스를 사용할 수 없습니다. Netlify Identity가 활성화되어 있는지 확인하세요.' }),
    }
  }

  // Use email from body (PUT) or default to TARGET_EMAIL (GET)
  let email = TARGET_EMAIL
  if (event.httpMethod === 'PUT' && event.body) {
    try {
      const body = JSON.parse(event.body)
      if (body.email) email = body.email
    } catch {
      // use default
    }
  }

  const identityUrl = identity.url
  const adminToken = identity.token

  try {
    // Find the user by email
    const searchRes = await fetch(`${identityUrl}/admin/users?filter=email:${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })

    if (!searchRes.ok) {
      return {
        statusCode: searchRes.status,
        body: JSON.stringify({ error: `사용자 검색 실패: ${await searchRes.text()}` }),
      }
    }

    const data = await searchRes.json()
    const users = data.users || []
    const user = users.find((u: any) => u.email === email)

    if (!user) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: `사용자를 찾을 수 없습니다: ${email}`,
          hint: '먼저 Netlify Identity에서 해당 이메일로 사용자를 초대하고, 초대 수락 후 다시 시도하세요.',
        }),
      }
    }

    // Check if already admin
    if (user.app_metadata?.roles?.includes('admin')) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `${email} 사용자는 이미 admin 역할입니다.`,
          roles: user.app_metadata.roles,
        }),
      }
    }

    // Update the user's role to admin
    const updateRes = await fetch(`${identityUrl}/admin/users/${user.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_metadata: {
          ...user.app_metadata,
          roles: ['admin'],
        },
      }),
    })

    if (!updateRes.ok) {
      return {
        statusCode: updateRes.status,
        body: JSON.stringify({ error: `역할 업데이트 실패: ${await updateRes.text()}` }),
      }
    }

    const updatedUser = await updateRes.json()
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `${email} 사용자를 admin 역할로 변경했습니다!`,
        roles: updatedUser.app_metadata?.roles,
      }),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}

export { handler }
