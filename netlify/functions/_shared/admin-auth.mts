import { getUser } from '@netlify/identity'
import { requireSignedInUser } from './user-auth.mts'

export async function requireAdmin(req: Request): Promise<{ ok: true; user: any } | { ok: false; response: Response }> {
  const identityUser = await getUser()
  if (identityUser) {
    const values = [(identityUser as any).roles, (identityUser as any).appMetadata?.roles, (identityUser as any).app_metadata?.roles]
    const roles = values.flatMap((value) => Array.isArray(value) ? value.filter((role): role is string => typeof role === 'string') : [])
    if (identityUser.role === 'admin' || roles.includes('admin')) {
      return { ok: true, user: identityUser }
    }
  }

  const account = await requireSignedInUser(req)
  if (account.ok && account.isAdmin) {
    return {
      ok: true,
      user: {
        id: account.userId,
        email: `${account.username}@picks.me`,
        app_metadata: { roles: ['admin'] },
      },
    }
  }

  return {
    ok: false,
    response: Response.json(
      { error: identityUser ? 'Forbidden: admin role required' : 'Unauthorized' },
      { status: identityUser ? 403 : 401 },
    ),
  }
}
