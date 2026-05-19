import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const { user } = JSON.parse(event.body || '{}')

  const existingRoles: string[] = user.app_metadata?.roles || []

  // Admin is granted when:
  // 1. User was invited (invite flow is admin-only, so all invited users are admins)
  // 2. User email is explicitly listed as admin
  // 3. User already has admin role
  const adminEmails = ['woojin8940@inplace-ad.com']
  const isInvitedUser = user.invited || false
  let roles: string[]
  if (isInvitedUser || existingRoles.includes('admin') || adminEmails.includes(user.email)) {
    roles = ['admin']
  } else if (existingRoles.length > 0) {
    roles = existingRoles
  } else {
    roles = ['member']
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        ...user.app_metadata,
        roles,
      },
    }),
  }
}

export { handler }
