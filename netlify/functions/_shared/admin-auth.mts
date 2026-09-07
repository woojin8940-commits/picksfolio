import { getUser } from '@netlify/identity'
import { requireSignedInUser } from './user-auth.mts'

const ADMIN_EMAILS = ['woojin8940@inplace-ad.com', 'picksfolio@picks.me']

export async function requireAdmin(req: Request): Promise<{ ok: true; user: any } | { ok: false; response: Response }> {
  const identityUser = await getUser()
  if (identityUser) {
    const roles: string[] = (identityUser as any).app_metadata?.roles || []
    const email = ((identityUser as any).email || '').trim().toLowerCase()
    if (roles.includes('admin') || ADMIN_EMAILS.includes(email)) {
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
