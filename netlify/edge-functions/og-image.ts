import type { Config, Context } from '@netlify/edge-functions'

// Known app routes that are NOT user pages
/**
 * 크리에이터 아이디가 될 수 없는 주소. src/App.tsx 의 같은 이름 목록과 짝이다.
 *
 * 비즈니스 · 담당자 · 결제 복귀 주소가 빠져 있어서, 크롤러가 그 주소를 읽으면
 * "business-login 이라는 크리에이터" 의 미리보기 카드를 만들려 들었다.
 */
/**
 * index.html 의 #root 안에 들어 있는 정적 제목 마크업(<h1 id="static-home-title">).
 * 자바스크립트 없이도 메인 HTML 에 서비스명이 보이게 넣어 둔 것이라, 크롤러용으로
 * #root 를 갈아 끼울 때는 이 자리를 통째로 찾아 바꾼다. index.html 과 짝이다.
 */
const STATIC_ROOT = /<div id="root"><h1 id="static-home-title"[\s\S]*?<\/h1><\/div>/

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

  // 메인 홈(/)은 검색 크롤러에게만 읽을 수 있는 본문을 채워 준다(아래 renderHomeForCrawler).
  if (url.pathname === '/') {
    return isCrawler(req) ? renderHomeForCrawler(context, url) : undefined
  }

  // Skip non-user routes, static assets, and API calls
  if (
    !path ||
    RESERVED_PATHS.has(path) ||
    path.includes('.') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/.netlify/') ||
    // 브랜드 영업용 링크(/pick/<토큰>)는 사용자 페이지가 아니다.
    url.pathname.startsWith('/pick/')
  ) {
    return
  }

  const isBot = isCrawler(req)

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
    // 영상(.mp4 등)이나 편집 중 남은 blob: 주소는 미리보기 이미지가 될 수 없다 —
    // 그런 값이면 다음 후보로 넘어간다.
    const usableImage = (value?: string) =>
      typeof value === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(value) && !/\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(value)
        ? value
        : undefined
    const directImage =
      usableImage(data.design?.portfolioHeaderImage) ||
      usableImage(data.blocks?.[0]?.coverMedia) ||
      usableImage(data.profile?.avatar_url)

    const ogImage = directImage || `${url.origin}/og-image.png?v=3`

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
      // index.html 의 <meta name="description"> 은 홈 소개글이다. 크리에이터
      // 페이지를 검색 결과에 그대로 실으면 모든 개인페이지가 홈과 똑같은
      // 설명을 달고 나가므로, 여기서 본인 소개글로 바꿔 준다.
      .replace(
        /<meta name="description" content="[^"]*"\s*\/?>/,
        `<meta name="description" content="${escapeAttr(ogDescription)}" />`,
      )
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
      // 홈의 정적 제목과 회사 소개(JSON-LD)는 개인페이지의 것이 아니다.
      .replace(STATIC_ROOT, '<div id="root"></div>')
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/, '')

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

/**
 * 검색 크롤러에게 보내는 메인 홈.
 *
 * 홈은 리액트가 그리는 화면이라 index.html 의 #root 에는 정적 제목 한 줄뿐이다. 네이버 검색 로봇
 * (Yeti)은 자바스크립트를 거의 실행하지 않으므로 홈에서 읽을 글이 하나도 없었고,
 * 같은 도메인에서 글이 가득한 정적 페이지인 이용약관(/terms)이 "픽스폴리오" 검색의
 * 대표 결과로 잡혔다. 그래서 홈 화면(Hero · 실시간 트렌드 보드 · 캠페인 소개)이
 * 실제로 하는 말을 그대로 정적 본문으로 #root 에 넣어 준다. 문구를 바꾸면 홈과
 * 같이 맞춰야 한다 — 크롤러에게만 다른 말을 하면 검색엔진이 문제 삼는다.
 *
 * 사람의 브라우저는 이 경로를 타지 않으므로 화면이 깜빡이거나 바뀌지 않는다.
 * canonical 은 여기서만 단다. index.html 에 두면 모든 개인페이지가 같은 문서를
 * 쓰기 때문에 개인페이지까지 "홈의 사본"으로 표시된다.
 */
async function renderHomeForCrawler(context: Context, url: URL): Promise<Response | undefined> {
  try {
    const response = await context.next()
    const html = await response.text()
    const origin = url.origin

    // Organization 은 index.html 에 정적으로 들어 있으므로 여기서는 WebSite 만 더한다.
    const jsonLd = JSON.stringify([
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: '픽스폴리오',
        alternateName: ['PICKSFOLIO', 'Picksfolio', 'picks-folio'],
        url: `${origin}/`,
        inLanguage: 'ko-KR',
      },
    ]).replace(/</g, '\\u003c')

    const headTags =
      `<link rel="canonical" href="${origin}/" />\n` +
      `    <script type="application/ld+json">${jsonLd}</script>\n`

    const body = `<main>
      <header>
        <h1>픽스폴리오 - 인플루언서·브랜드 협업 플랫폼 | PICKSFOLIO</h1>
        <p>픽스폴리오는 인플루언서와 브랜드를 연결해요. 자동 DM, 브랜드 매칭, 개인 페이지, 판매 연동까지 한 곳에서.</p>
        <p>오늘의 트렌드로 픽하고 개인 링크 하나로 연결하세요.</p>
        <p>인기검색어를 분야별로 매일 정리해 보여줍니다. 나만의 프로필링크에 담아 소개해보세요.</p>
        <p>주소만 정하면 내 페이지가 바로 열립니다. <a href="${origin}/signup">바로 만들기</a></p>
        <ul>
          <li>네이버 데이터랩 트렌드</li>
          <li>개인 링크 · 홈페이지</li>
          <li>비즈니스 제안 수신</li>
        </ul>
      </header>
      <section>
        <h2>실시간 트렌드 보드</h2>
        <p>네이버 데이터랩 쇼핑인사이트 분야별 인기검색어 TOP 5. 매일 오후 2시 업데이트.</p>
      </section>
      <section>
        <h2>브랜드 광고 협업</h2>
        <p>채널마다 담당자가 배정됩니다. 담당자가 맞는 브랜드를 찾아 광고비와 업무 범위까지 정리해 제안하고, 협의부터 진행 관리와 정산까지 함께 챙깁니다.</p>
        <h3>채널을 보고 매칭</h3>
        <p>담당자가 채널 성격과 시청자, 단가를 확인한 뒤 맞는 브랜드를 골라 연결합니다.</p>
        <h3>광고 제안이 도착</h3>
        <p>광고비와 업무 범위, 일정이 적힌 제안이 도착합니다. 수락할지만 정하면 됩니다.</p>
        <h3>진행·정산까지 관리</h3>
        <p>수정 요청과 일정, 정산까지 담당자가 브랜드와 조율합니다.</p>
        <p><a href="${origin}/signup">가입하고 담당자 매칭받기</a></p>
      </section>
      <nav>
        <a href="${origin}/signup">크리에이터 회원가입</a>
        <a href="${origin}/login">로그인</a>
        <a href="${origin}/business/signup">브랜드 회원가입</a>
        <a href="${origin}/business/login">브랜드 로그인</a>
        <a href="${origin}/terms">이용약관</a>
        <a href="${origin}/privacy">개인정보처리방침</a>
      </nav>
    </main>`

    const headers = new Headers(response.headers)
    headers.delete('content-length')
    if (!STATIC_ROOT.test(html)) {
      return new Response(html, { status: response.status, headers })
    }

    const updatedHtml = html
      .replace('</head>', `    ${headTags}</head>`)
      .replace(STATIC_ROOT, () => `<div id="root">${body}</div>`)

    return new Response(updatedHtml, { status: response.status, headers })
  } catch {
    return undefined
  }
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
function isCrawler(req: Request): boolean {
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
  return BOT_TOKENS.some((token) => ua.includes(token))
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
