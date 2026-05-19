import { getUser } from '@netlify/identity'

const ADMIN_EMAILS = ['woojin8940@inplace-ad.com']

function decodeJwtClaims(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

export async function requireAdmin(req: Request): Promise<{ ok: true; user: any } | { ok: false; response: Response }> {
  let user = await getUser()

  if (!user) {
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const claims = decodeJwtClaims(token)
      if (claims?.email) {
        user = {
          id: claims.sub || '',
          email: claims.email,
          app_metadata: claims.app_metadata || {},
        } as any
      }
    }
  }

  if (!user) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const roles: string[] = (user as any).app_metadata?.roles || []
  const email = ((user as any).email || '').trim().toLowerCase()
  if (!roles.includes('admin') && !ADMIN_EMAILS.includes(email)) {
    return { ok: false, response: Response.json({ error: 'Forbidden: admin role required' }, { status: 403 }) }
  }

  return { ok: true, user }
}
