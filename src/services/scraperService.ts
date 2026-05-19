
/**
 * Scraper Service for extracting product information from various e-commerce platforms.
 * Supports smart parsing of OG tags and fallback price extraction.
 */

export interface ScrapedProduct {
  name: string;
  price: string;
  image: string;
  description?: string;
}

const PROXIES = [
  (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url: string) => `https://cors.bridged.cc/${url}`,
  (url: string) => `https://cors-anywhere.herokuapp.com/${url}`,
  (url: string) => `https://proxy.cors.sh/${url}`,
  (url: string) => `https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all`, // Not a direct proxy but for context
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
];

/**
 * Cleans Coupang URL by removing unnecessary parameters.
 */
export function cleanCoupangUrl(url: string): string {
  if (!url.includes('coupang.com')) return url;
  try {
    const urlObj = new URL(url);
    // Keep only essential path, remove all query params for cleaner access
    return `${urlObj.origin}${urlObj.pathname}`;
  } catch (e) {
    return url;
  }
}

/**
 * Fetches HTML content using multiple proxies to bypass CORS.
 */
async function fetchHtml(url: string): Promise<string> {
  let lastError: Error | null = null;
  const cleanedUrl = cleanCoupangUrl(url);

  for (let i = 0; i < PROXIES.length; i++) {
    const proxyFn = PROXIES[i];
    try {
      const proxyUrl = proxyFn(cleanedUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout per proxy

      const response = await fetch(proxyUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENTS[i % USER_AGENTS.length],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`Proxy failed with status ${response.status}`);

      let html = '';
      const contentType = response.headers.get('content-type');
      
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        html = data.contents || data.result || data.data || (typeof data === 'string' ? data : JSON.stringify(data));
      } else {
        html = await response.text();
      }
      
      if (typeof html === 'string' && html.length > 200) {
        // Check for common "blocked" patterns
        const blockedPatterns = [
          'Access Denied', 'Cloudflare', 'Robot Check', 'Captcha', 
          '보안 확인', '봇 감지', 'human verification', 'unusual activity',
          'coupang.com/np/error/captcha', 'Forbidden', 'Not Found',
          'IP has been blocked', 'Checking your browser'
        ];
        const isBlocked = blockedPatterns.some(p => html.toLowerCase().includes(p.toLowerCase()));
        
        // Also check if it's just a tiny HTML shell
        if (!isBlocked && html.length > 500) {
          return html;
        }
        console.warn(`Proxy ${proxyUrl} returned blocked or insufficient content.`);
      }
    } catch (err) {
      console.warn(`Proxy failed: ${err instanceof Error ? err.message : String(err)}`);
      lastError = err as Error;
    }
  }

  throw lastError || new Error("All proxies failed to fetch the URL.");
}

/**
 * Extracts metadata from HTML string.
 */
function parseMetadata(html: string, url: string): Partial<ScrapedProduct> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const getMeta = (name: string) => {
    return doc.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ||
           doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ||
           doc.querySelector(`meta[property="og:${name}"]`)?.getAttribute('content') ||
           doc.querySelector(`meta[name="og:${name}"]`)?.getAttribute('content');
  };

  let name = '';
  let price = '';
  let image = '';

  // 1순위: OG 태그 (User Priority)
  name = getMeta('og:title') || getMeta('title') || '';
  image = getMeta('og:image') || '';
  price = getMeta('product:price:amount') || getMeta('og:price:amount') || getMeta('og:price') || '';

  // 2순위: JSON-LD (If OG is missing or for better accuracy)
  if (!name || !price || !image) {
    try {
      const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (const script of jsonLdScripts) {
        const data = JSON.parse(script.textContent || '{}');
        const items = Array.isArray(data) ? data : [data];
        
        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type'] === 'http://schema.org/Product') {
            if (!name) name = item.name || '';
            if (!image) image = Array.isArray(item.image) ? item.image[0] : (item.image?.url || item.image || '');
            if (!price) price = item.offers?.price || item.offers?.[0]?.price || '';
          }
        }
      }
    } catch (e) {
      console.warn("JSON-LD parsing failed", e);
    }
  }

  // 3순위: 커스텀 셀렉터 (Platform-specific)
  if (!name || !price || !image) {
    if (url.includes('coupang.com')) {
      if (!name) name = doc.querySelector('.prod-buy-header__title')?.textContent || 
                         doc.querySelector('h2.prod-buy-header__title')?.textContent || '';
      if (!price) price = doc.querySelector('.total-price .value')?.textContent || 
                          doc.querySelector('span.total-price')?.textContent ||
                          doc.querySelector('span.major_price')?.textContent ||
                          doc.querySelector('.discount-price .price-value')?.textContent || '';
      if (!image) image = doc.querySelector('.prod-image__detail')?.getAttribute('src') || 
                          doc.querySelector('.prod-main-image img')?.getAttribute('src') || '';
    } else if (url.includes('oliveyoung.co.kr')) {
      if (!name) name = doc.querySelector('.prd_name')?.textContent || 
                         doc.querySelector('#GoodsName')?.textContent || '';
      if (!price) price = doc.querySelector('span.price-2')?.textContent ||
                          doc.querySelector('span.tx_cur')?.textContent ||
                          doc.querySelector('span.price')?.textContent ||
                          doc.querySelector('.price-2 .val')?.textContent || 
                          doc.querySelector('.price .val')?.textContent || '';
      if (!image) image = doc.querySelector('#mainImg')?.getAttribute('src') || 
                          doc.querySelector('.prd_detail_box .thumb img')?.getAttribute('src') || '';
    } else if (url.includes('musinsa.com')) {
      if (!name) name = doc.querySelector('.product-detail__item-name')?.textContent || 
                         doc.querySelector('.product_title')?.textContent || '';
      if (!price) price = doc.querySelector('.product-detail__price-value')?.textContent || 
                          doc.querySelector('#goods_price')?.textContent || '';
      if (!image) image = doc.querySelector('.product-detail__main-image img')?.getAttribute('src') || 
                          doc.querySelector('#bigimg')?.getAttribute('src') || '';
    }
  }

  // Extra check for Musinsa (New Layout / Script Data)
  if (url.includes('musinsa.com') && (!name || !price || !image)) {
    try {
      const scripts = Array.from(doc.querySelectorAll('script'));
      
      // Try __NEXT_DATA__
      const nextDataScript = scripts.find(s => s.id === '__NEXT_DATA__');
      if (nextDataScript && nextDataScript.textContent) {
        const data = JSON.parse(nextDataScript.textContent);
        const productData = data.props?.pageProps?.productData || data.props?.pageProps?.goodsData;
        if (productData) {
          name = productData.goodsNm || productData.name || name;
          price = productData.goodsPrice || productData.price || price;
          image = productData.goodsImg || productData.imageUrl || image;
        }
      }

      // Try __MSS_PRODUCT_DETAIL__
      if (!name) {
        const dataScript = scripts.find(s => s.textContent?.includes('__MSS_PRODUCT_DETAIL__'));
        if (dataScript && dataScript.textContent) {
          const match = dataScript.textContent.match(/__MSS_PRODUCT_DETAIL__\s*=\s*({.*?});/s);
          if (match) {
            const data = JSON.parse(match[1]);
            name = data.goodsNm || name;
            price = data.goodsPrice || price;
            image = data.goodsImg || image;
          }
        }
      }
    } catch (e) {
      console.warn("Musinsa script parsing failed", e);
    }
  }

  // 2. Fallback to Smart Parsing: Open Graph
  name = name.trim() || getMeta('og:title') || doc.title;
  image = image.trim() || getMeta('og:image');
  price = price.trim() || getMeta('product:price:amount') || getMeta('og:price');

  // 3. Clean Name (Remove site names often appended to titles)
  if (name) {
    name = name.split(' | ')[0].split(' - ')[0].split(' : ')[0].trim();
    // Remove common suffixes
    const suffixes = [' : 올리브영', ' - 쿠팡!', ' | 무신사', ' | 29CM'];
    suffixes.forEach(s => {
      if (name.endsWith(s)) name = name.replace(s, '');
    });
  }

  // 4. Advanced Price Extraction Logic
  if (!price || price === '0') {
    const priceSelectors = [
      '.price', '.sale-price', '.current-price', '.total-price', 
      '[class*="price"]', '[class*="Price"]', '.amount', '.totalPrice'
    ];
    
    for (const selector of priceSelectors) {
      const el = doc.querySelector(selector);
      if (el && el.textContent) {
        const text = el.textContent.trim();
        const match = text.replace(/[^0-9]/g, '');
        if (match && match.length >= 3) {
          price = match;
          break;
        }
      }
    }
  }

  // 5. Final fallback for price: Search for "원" pattern
  if (!price || price === '0') {
    const bodyText = doc.body.innerText;
    const wonRegex = /([0-9,]{3,})\s*원/g;
    const matches = [...bodyText.matchAll(wonRegex)];
    if (matches.length > 0) {
      price = matches[0][1].replace(/,/g, '');
    }
  }

  // 6. Handle relative image URLs and protocol-less URLs
  let finalImage = image || '';
  
  // Check for lazy-loaded images if main image is empty
  if (!finalImage) {
    const lazyImg = doc.querySelector('img[data-original], img[data-src], img[src*="goods_img"], img[src*="prd_img"], .prod-image__detail');
    finalImage = lazyImg?.getAttribute('data-original') || 
                 lazyImg?.getAttribute('data-src') || 
                 lazyImg?.getAttribute('src') || '';
  }

  if (finalImage.startsWith('//')) {
    finalImage = 'https:' + finalImage;
  } else if (finalImage && !finalImage.startsWith('http')) {
    try {
      const baseUrl = new URL(url);
      finalImage = new URL(finalImage, baseUrl.origin).toString();
    } catch (e) {
      console.error("Failed to resolve image URL", e);
    }
  }

  return {
    name: name?.trim(),
    price: price?.replace(/[^0-9]/g, ''),
    image: finalImage,
  };
}

/**
 * Main entry point for scraping product info.
 */
export async function scrapeProductInfo(url: string): Promise<Partial<ScrapedProduct>> {
  try {
    const cleanedUrl = cleanCoupangUrl(url);
    const html = await fetchHtml(cleanedUrl);
    const metadata = parseMetadata(html, cleanedUrl);
    
    // Basic validation
    if (!metadata.name && !metadata.price) {
      throw new Error("Failed to extract meaningful data");
    }
    
    return metadata;
  } catch (error) {
    console.error("Scraping error:", error);
    // Fallback to a placeholder or re-throw
    return {
      name: "상품 정보를 가져오지 못했습니다",
      price: "0",
      image: "https://picsum.photos/seed/error/400/400"
    };
  }
}
