import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const { user } = JSON.parse(event.body || '{}')

  const adminEmails = ['woojin8940@inplace-ad.com']
  const existingRoles: string[] = user.app_metadata?.roles || []

  let roles: string[]
  if (adminEmails.includes(user.email) || existingRoles.includes('admin')) {
    roles = ['admin']
  } else {
    roles = existingRoles.length > 0 ? existingRoles : ['member']
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
