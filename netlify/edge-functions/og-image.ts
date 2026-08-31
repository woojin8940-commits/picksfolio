import type { Config, Context } from '@netlify/edge-functions'

// Known app routes that are NOT user pages
/**
 * 크리에이터 아이디가 될 수 없는 주소. src/App.tsx 의 같은 이름 목록과 짝이다.
 *
 * 비즈니스 · 담당자 · 결제 복귀 주소가 빠져 있어서, 크롤러가 그 주소를 읽으면
 * "business-login 이라는 크리에이터" 의 미리보기 카드를 만들려 들었다.
 */
const RESERVED_PATHS = new Set([
  'signup', 'login', 'admin', 'operator', 'operator-login',
  'terms', 'privacy', 'setup-link', 'api', '.netlify',
  'business', 'business-login', 'business-signup', 'business-admin',
  'manager', 'membership', 'settings',
  'checkout', 'success', 'fail', 'toss', 'portone', 'profile',
  'assets', 'vendor', 'robots.txt', 'sitemap.xml',
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

  /**
   * 미리보기 카드를 만드는 크롤러만 가로챈다.
   *
   * 예전 목록에는 'kakaotalk' · 'naver' · 'daum' · 'line' · 'preview' 같은 조각이
   * 들어 있었다. 그 문자열은 크롤러뿐 아니라 **실제 인앱 브라우저의 User-Agent 에도**
   * 들어 있다. 그래서 카카오톡이나 네이버 앱에서 링크를 눌러 들어온 진짜 사용자도
   * 이 경로를 탔다. 화면은 정상으로 보였지만(context.next 가 앱 HTML 을 돌려준다)
   * 대가가 있었다 — /api/site 를 먼저 직렬로 한 번 더 부르고, 응답에
   * `no-cache, no-store` 를 붙여 문서 캐시를 껐다. 실측 TTFB 는 일반 브라우저
   * 0.057초, 카카오톡 0.266초, 네이버 0.260초였고 재방문에도 개선되지 않았다.
   * 한국 링크인바이오 서비스에서 트래픽이 가장 많이 들어오는 통로가 바로 그곳이다.
   *
   * 그래서 카카오 · 네이버 · 다음은 실제 크롤러 토큰으로 좁혔다.
   *   · 카카오 링크 크롤러: `kakaotalk-scrap`
   *   · 네이버 검색 크롤러: `yeti`
   *   · 다음 크롤러: `daumoa`
   * 짧고 흔한 조각('line' 은 'inline' · 'Cmdline' 등에도 걸린다)은 뺐다.
   */
  const ua = (req.headers.get('user-agent') || '').toLowerCase()
  const BOT_TOKENS = [
    'facebookexternalhit',
    'facebot',
    'twitterbot',
    'linkedinbot',
    'slackbot',
    'telegrambot',
    'whatsapp',
    'discordbot',
    'googlebot',
    'bingbot',
    'yandexbot',
    'applebot',
    'kakaotalk-scrap',
    'kakaostory',
    'daumoa',
    'yeti',
    'linebot',
    'linespider',
    'pinterest',
    'redditbot',
    'skypeuripreview',
    'embedly',
    'quora link preview',
    'nuzzel',
    'vkshare',
    'og-image',
  ]
  const isBot = BOT_TOKENS.some((token) => ua.includes(token))

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

    // Resolve the actual image URL directly instead of using the redirect proxy,
    // because KakaoTalk's crawler does not follow 302 redirects for og:image.
    const directImage =
      data.design?.portfolioHeaderImage ||
      data.blocks?.[0]?.coverMedia ||
      data.profile?.avatar_url

    const ogImage = directImage || `${url.origin}/og-image.png`

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
