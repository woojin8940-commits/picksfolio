import type { Config, Context } from '@netlify/edge-functions'

// Known app routes that are NOT user pages
const RESERVED_PATHS = new Set([
  'signup', 'login', 'admin', 'operator', 'operator-login',
  'terms', 'privacy', 'setup-link', 'api', '.netlify',
])

export default async (req: Request, context: Context) => {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\//, '').split('/')[0].toLowerCase()

  // Skip non-user routes, static assets, and API calls
  if (
    !path ||
    RESERVED_PATHS.has(path) ||
    path.includes('.') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/.netlify/')
  ) {
    return
  }

  // Only intercept for social media crawlers / link preview bots
  const ua = (req.headers.get('user-agent') || '').toLowerCase()
  const isBot =
    ua.includes('facebookexternalhit') ||
    ua.includes('facebot') ||
    ua.includes('twitterbot') ||
    ua.includes('linkedinbot') ||
    ua.includes('slackbot') ||
    ua.includes('telegrambot') ||
    ua.includes('whatsapp') ||
    ua.includes('kakaotalk') ||
    ua.includes('kakaostory') ||
    ua.includes('daumoa') ||
    ua.includes('line') ||
    ua.includes('discord') ||
    ua.includes('googlebot') ||
    ua.includes('bingbot') ||
    ua.includes('yandex') ||
    ua.includes('naver') ||
    ua.includes('daum') ||
    ua.includes('og-image') ||
    ua.includes('preview')

  if (!isBot) {
    return
  }

  // Extract username (handle /username and /username/proposal)
  const username = path

  try {
    // Fetch user site data from the internal API
    const siteDataUrl = new URL(`/api/site/${encodeURIComponent(username)}`, url.origin)
    const res = await fetch(siteDataUrl.toString())

    if (!res.ok) {
      return
    }

    const data = await res.json() as {
      profile?: { name?: string; bio?: string; avatar_url?: string }
      design?: {
        portfolioHeaderImage?: string
        title?: string
        description?: string
      }
      blocks?: Array<{ coverMedia?: string }>
    }

    // Use the OG image proxy endpoint so crawlers always get the latest image
    // via a 302 redirect with no-cache headers. The proxy reads the current
    // cover photo from Blobs on every request.
    const cacheBuster = (data as any).updatedAt
      ? new Date((data as any).updatedAt).getTime()
      : Date.now()
    const ogImage = `${url.origin}/api/og-image/${encodeURIComponent(username)}?v=${cacheBuster}`

    const profileName = data.profile?.name || username
    const ogTitle = data.design?.title || `${profileName} | PICKSFOLIO`
    const ogDescription =
      data.design?.description ||
      data.profile?.bio ||
      `${profileName}님의 큐레이션 페이지`

    // Get the original HTML response
    const response = await context.next()
    const html = await response.text()

    // Replace OG meta tags
    const updatedHtml = html
      .replace(
        /<meta property="og:title" content="[^"]*"\s*\/?>/,
        `<meta property="og:title" content="${escapeAttr(ogTitle)}" />`,
      )
      .replace(
        /<meta property="og:description" content="[^"]*"\s*\/?>/,
        `<meta property="og:description" content="${escapeAttr(ogDescription)}" />`,
      )
      .replace(
        /<meta property="og:image" content="[^"]*"\s*\/?>/,
        `<meta property="og:image" content="${escapeAttr(resolveUrl(ogImage, url.origin))}" />`,
      )
      .replace(
        /<meta property="og:type" content="[^"]*"\s*\/?>/,
        `<meta property="og:type" content="profile" />`,
      )
      .replace(
        /<meta property="og:url" content="[^"]*"\s*\/?>/,
        `<meta property="og:url" content="${escapeAttr(url.origin + url.pathname)}" />`,
      )
      .replace(
        /<meta name="twitter:title" content="[^"]*"\s*\/?>/,
        `<meta name="twitter:title" content="${escapeAttr(ogTitle)}" />`,
      )
      .replace(
        /<meta name="twitter:description" content="[^"]*"\s*\/?>/,
        `<meta name="twitter:description" content="${escapeAttr(ogDescription)}" />`,
      )
      .replace(
        /<meta name="twitter:image" content="[^"]*"\s*\/?>/,
        `<meta name="twitter:image" content="${escapeAttr(resolveUrl(ogImage, url.origin))}" />`,
      )
      .replace(
        /<title>[^<]*<\/title>/,
        `<title>${escapeHtml(ogTitle)}</title>`,
      )

    // Return with no-cache headers so crawlers always get fresh OG tags
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    headers.set('Pragma', 'no-cache')

    return new Response(updatedHtml, {
      status: response.status,
      headers,
    })
  } catch {
    // On any error, fall through to the default HTML
    return
  }
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function resolveUrl(imageUrl: string, origin: string): string {
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl
  }
  if (imageUrl.startsWith('/')) {
    return `${origin}${imageUrl}`
  }
  return `${origin}/${imageUrl}`
}

export const config: Config = {
  path: '/*',
  excludedPath: ['/api/*', '/.netlify/*', '/assets/*', '/src/*'],
  onError: 'bypass',
}
