/**
 * 외부 스크립트를 필요한 화면에서만 불러온다.
 *
 * 예전에는 포트원 결제 SDK(77KB)가 index.html 의 일반 `<script>` 태그로 박혀
 * 있었다. 문제는 순서다 — 앱 진입점은 `<script type="module">` 이고 모듈
 * 스크립트는 규격상 defer 로 동작해서 문서 파싱이 끝난 뒤에 실행된다. 그런데
 * 파싱은 그 아래의 일반 `<script>` 가 내려오고 실행될 때까지 끝나지 않는다.
 * 즉 결제를 쓰지 않는 방문자까지 그 대기를 물은 뒤에야 리액트가 처음 그려졌다.
 *
 * 결제 SDK 와 카카오 SDK 는 각각 결제와 로그인에서만 쓰인다. 그래서 그 자리에서
 * 부른다. 같은 스크립트를 두 번 넣지 않도록 약속(Promise)을 기억해 두고, 이미
 * 로드된 경우(예: 예전 캐시된 HTML)에도 바로 통과한다.
 */

declare global {
  interface Window {
    PortOne?: any;
    /** 카카오 JS SDK. 카카오톡 앱 연동 간편로그인(`Kakao.Auth.authorize`)에 쓴다. */
    Kakao?: {
      init: (javascriptKey: string) => void;
      isInitialized: () => boolean;
      cleanup?: () => void;
      Auth?: {
        authorize: (settings: {
          redirectUri: string;
          scope?: string;
          state?: string;
          prompt?: string;
          throughTalk?: boolean;
        }) => void;
      };
    };
  }
}

const PORTONE_JS = 'https://cdn.portone.io/v2/browser-sdk.js';

const KAKAO_SDK_VERSION = '2.8.3';
const KAKAO_SDK_JS = `https://t1.kakaocdn.net/kakao_js_sdk/${KAKAO_SDK_VERSION}/kakao.min.js`;
/** 위 버전 파일의 실제 해시. 로그인에 쓰는 스크립트라 무결성까지 확인한다. */
const KAKAO_SDK_INTEGRITY = 'sha384-oroumrnFVE0xtgqyDZJARgERibXg2C28380uaUZz2kHDS5CR7tu20eGiOU6GkTpy';

/** 로드 상한. 넘기면 거부한다 — 호출부가 폴백(안내문 · 기존 경로)으로 갈 수 있어야 한다. */
const LOAD_TIMEOUT = 15000;

const pending = new Map<string, Promise<void>>();

function injectScript(src: string, integrity?: string): Promise<void> {
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
      if (integrity) {
        el.integrity = integrity;
        el.crossOrigin = 'anonymous';
      }
      document.head.appendChild(el);
    }
  });

  pending.set(src, promise);
  return promise;
}

/** 포트원 결제 SDK. 결제 버튼을 누른 뒤에 불러도 늦지 않다. */
export async function loadPortOne(): Promise<any> {
  if (window.PortOne) return window.PortOne;
  await injectScript(PORTONE_JS);
  if (!window.PortOne) throw new Error('결제 모듈을 초기화할 수 없습니다.');
  return window.PortOne;
}

/**
 * 카카오 JS SDK. 카카오 로그인 버튼을 누른 뒤에 부른다.
 *
 * 초기화에는 자바스크립트 키를 쓴다(REST API 키가 아니다). 이 키는 브라우저에
 * 공개되는 클라이언트 식별자라서 번들에 들어가도 문제가 없다 — 실제 보호는
 * 카카오 콘솔의 플랫폼(도메인) 등록과 Redirect URI 화이트리스트가 한다.
 * 키가 설정돼 있지 않으면 `null` 을 돌려준다: 호출부가 기존 로그인 경로로
 * 폴백할 수 있어야 하므로 예외를 던지지 않는다.
 */
export async function loadKakaoSdk(): Promise<NonNullable<Window['Kakao']> | null> {
  const javascriptKey = (import.meta.env.VITE_KAKAO_JS_KEY as string | undefined)?.trim();
  if (!javascriptKey) return null;

  try {
    await injectScript(KAKAO_SDK_JS, KAKAO_SDK_INTEGRITY);
  } catch (err) {
    console.warn('[externalScripts] 카카오 SDK 를 불러오지 못했습니다', err);
    return null;
  }

  const kakao = window.Kakao;
  if (!kakao) return null;
  try {
    if (!kakao.isInitialized()) kakao.init(javascriptKey);
  } catch (err) {
    console.warn('[externalScripts] 카카오 SDK 초기화 실패', err);
    return null;
  }
  return kakao;
}
