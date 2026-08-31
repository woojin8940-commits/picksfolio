/**
 * 외부 스크립트를 필요한 화면에서만 불러온다.
 *
 * 예전에는 video.js(183KB)와 포트원 결제 SDK(77KB)가 index.html 의 일반
 * `<script>` 태그로 박혀 있었다. 문제는 순서다 — 앱 진입점은
 * `<script type="module">` 이고 모듈 스크립트는 규격상 defer 로 동작해서 문서
 * 파싱이 끝난 뒤에 실행된다. 그런데 파싱은 그 아래의 일반 `<script>` 두 개가
 * 내려오고 실행될 때까지 끝나지 않는다. 즉 라이브도 결제도 쓰지 않는 방문자까지
 * 260KB 를 기다린 뒤에야 리액트가 처음 그려졌다.
 *
 * 두 스크립트는 각각 라이브 재생과 결제에서만 쓰인다. 그래서 그 자리에서 부른다.
 * 같은 스크립트를 두 번 넣지 않도록 약속(Promise)을 기억해 두고, 이미 로드된
 * 경우(예: 예전 캐시된 HTML)에도 바로 통과한다.
 */

declare global {
  interface Window {
    videojs?: any;
    PortOne?: any;
    /** vendor/ivs-player-overlay.js 가 노출한다. IVS Player SDK 를 받아 videojs 를 감싼다. */
    __picksInstallIvsOverlay?: () => Promise<boolean>;
  }
}

const VIDEOJS_VERSION = '8.10.0';
const VIDEOJS_JS = `https://vjs.zencdn.net/${VIDEOJS_VERSION}/video.min.js`;
const VIDEOJS_CSS = `https://vjs.zencdn.net/${VIDEOJS_VERSION}/video-js.css`;
const PORTONE_JS = 'https://cdn.portone.io/v2/browser-sdk.js';

/** 로드 상한. 넘기면 거부한다 — 호출부가 폴백(대체 재생 경로 · 안내문)으로 갈 수 있어야 한다. */
const LOAD_TIMEOUT = 15000;

const pending = new Map<string, Promise<void>>();

function injectStyle(href: string): void {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function injectScript(src: string): Promise<void> {
  const existing = pending.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    // 같은 src 의 태그가 이미 문서에 있으면(캐시된 예전 HTML 등) 그 태그를 기다린다.
    const already = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const el = already ?? document.createElement('script');

    const timer = window.setTimeout(() => {
      cleanup();
      // 실패한 약속은 지운다 — 다음 시도에서 다시 받아볼 수 있어야 한다.
      pending.delete(src);
      reject(new Error(`스크립트 로드 시간이 초과되었습니다: ${src}`));
    }, LOAD_TIMEOUT);

    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      pending.delete(src);
      reject(new Error(`스크립트를 불러올 수 없습니다: ${src}`));
    };
    function cleanup() {
      window.clearTimeout(timer);
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
    }

    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);

    if (!already) {
      el.src = src;
      el.async = true;
      document.head.appendChild(el);
    }
  });

  pending.set(src, promise);
  return promise;
}

/** 라이브 HLS 폴백 재생기. 스타일시트도 이때 같이 넣는다(라이브 화면에서만 필요하다). */
export async function loadVideoJs(): Promise<any> {
  if (!window.videojs) {
    injectStyle(VIDEOJS_CSS);
    await injectScript(VIDEOJS_JS);
    if (!window.videojs) throw new Error('video.js 를 초기화할 수 없습니다.');
  }

  // IVS 오버레이가 videojs 를 감싸야 IVS 채널 주소를 저지연 재생기로 넘길 수 있다.
  // SDK 를 못 받아도 videojs 자체는 쓸 수 있으므로 실패는 삼킨다.
  try {
    await window.__picksInstallIvsOverlay?.();
  } catch (err) {
    console.warn('[externalScripts] IVS 오버레이 설치 실패 — video.js 로 재생한다', err);
  }

  return window.videojs;
}

/** 포트원 결제 SDK. 결제 버튼을 누른 뒤에 불러도 늦지 않다. */
export async function loadPortOne(): Promise<any> {
  if (window.PortOne) return window.PortOne;
  await injectScript(PORTONE_JS);
  if (!window.PortOne) throw new Error('결제 모듈을 초기화할 수 없습니다.');
  return window.PortOne;
}
