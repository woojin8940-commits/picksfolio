import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const { user } = JSON.parse(event.body || '{}')

  const existingRoles: string[] = user.app_metadata?.roles || []

  // Grant admin role if:
  // 1. The user was invited (has invited_at) but doesn't have admin role yet
  // 2. The user's email is explicitly listed as an admin
  const adminEmails = ['woojin8940@inplace-ad.com', 'picksfolio@picks.me']
  const shouldBeAdmin = (user.invited_at && !existingRoles.includes('admin')) ||
    (adminEmails.includes(user.email) && !existingRoles.includes('admin'))

  if (shouldBeAdmin) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        app_metadata: {
          ...user.app_metadata,
          roles: ['admin'],
        },
      }),
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({}),
  }
}

export { handler }
