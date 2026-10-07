/**
 * 오래 열어 둔 화면이 새 배포를 받아오게 한다.
 *
 * 휴대폰 브라우저 탭과 앱 WebView 는 백그라운드에 며칠씩 살아 있다가 그대로
 * 돌아오므로, 새로고침을 하지 않는 한 예전 배포의 코드를 계속 실행한다. PC 에서는
 * 보이는 기능(예: 자동 DM 설정의 예고 메시지)이 휴대폰에서만 안 보이는 이유가 이것이다.
 * 이미 받아 둔 화면 청크는 사라진 파일을 다시 요청하지 않으므로 chunkReload 로는
 * 잡히지 않는다.
 *
 * 그래서 오래 숨겨져 있던 화면이 다시 보일 때 서버의 index.html 이 가리키는 진입
 * 스크립트와 지금 실행 중인 것을 비교하고, 다르면 한 번 새로고침한다. 잠깐 다른
 * 앱에 다녀온 경우(링크 복사 등)는 입력 중인 내용을 잃지 않도록 건드리지 않는다.
 * 저장하지 않은 편집 창이 열려 있으면 오래 다녀왔어도 이번에는 넘긴다.
 */

import { hasUnsavedWork } from './unsavedWork';

const MIN_HIDDEN_MS = 10 * 60 * 1000;
const ENTRY_RE = /\/assets\/index-[\w-]+\.js/;

const runningEntry = (): string | null => {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  for (const s of scripts) {
    const m = s.getAttribute('src')?.match(ENTRY_RE);
    if (m) return m[0];
  }
  return null;
};

export const installStaleBuildReload = (): void => {
  if (!import.meta.env.PROD || typeof document === 'undefined') return;
  const current = runningEntry();
  if (!current) return;

  let hiddenAt = 0;
  let checking = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    if (!hiddenAt || Date.now() - hiddenAt < MIN_HIDDEN_MS || checking) return;
    hiddenAt = 0;
    checking = true;
    fetch('/', { cache: 'no-store', credentials: 'same-origin' })
      .then((res) => (res.ok ? res.text() : ''))
      .then((html) => {
        const latest = html.match(ENTRY_RE)?.[0];
        if (latest && latest !== current && !hasUnsavedWork()) window.location.reload();
      })
      .catch(() => {})
      .finally(() => { checking = false; });
  });
};
