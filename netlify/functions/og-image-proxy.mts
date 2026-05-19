import { getStore } from '@netlify/blobs'
import type { Config, Context } from '@netlify/functions'

/**
 * OG Image proxy — returns the user's current cover image via 302 redirect.
 * Social crawlers follow this redirect each time they scrape, so the OG image
 * always reflects the latest cover photo without relying on query-param cache busters.
 */
export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase()
  if (!username) {
    return new Response('Not found', { status: 404 })
  }

  const store = getStore({ name: 'site-data', consistency: 'strong' })
  const data = (await store.get(username, { type: 'json' })) as Record<string, any> | null

  const imageUrl =
    data?.design?.portfolioHeaderImage ||
    data?.blocks?.[0]?.coverMedia ||
    data?.profile?.avatar_url

  if (!imageUrl) {
    // Fallback to the default OG image
    const origin = new URL(req.url).origin
    return Response.redirect(`${origin}/og-image.png`, 302)
  }

  // 302 redirect with aggressive no-cache so crawlers always follow the redirect
  return new Response(null, {
    status: 302,
    headers: {
      Location: imageUrl,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}

export const config: Config = {
  path: '/api/og-image/:username',
  method: ['GET'],
}
