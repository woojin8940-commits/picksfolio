import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const { user } = JSON.parse(event.body || '{}')

  const rawRoles = user?.app_metadata?.roles
  const existingRoles: string[] = Array.isArray(rawRoles)
    ? rawRoles.filter((role): role is string => typeof role === 'string') : []
  const roles = existingRoles.length > 0 ? existingRoles : ['member']

  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        ...user?.app_metadata,
        roles,
      },
    }),
  }
}

export { handler }
