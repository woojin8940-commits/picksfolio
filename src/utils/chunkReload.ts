/**
 * 지연 로딩 청크(dynamic import) 실패에서 회복하기 위한 공용 장치.
 *
 * 배포가 새로 올라가면 브라우저에 열려 있던 예전 index.html 은 사라진 해시 파일명
 * (`/assets/DmAutomation-a1b2c3.js`)을 계속 가리킨다. 그 파일을 못 받으면 그 화면은
 * 영구히 열리지 않는다 — 한 번 새로고침해서 새 매니페스트를 받아오면 끝나는 문제다.
 *
 * 다만 새로고침으로 고쳐지지 않는 실패(네트워크 차단, 정말로 깨진 배포)도 있어서,
 * 무조건 새로고침하면 흰 화면에서 무한히 다시 로드되는 쪽이 더 나쁜 상태가 된다.
 * 그래서 "한 번만" 새로고침한다는 약속을 sessionStorage 에 남긴다.
 *
 * 예전에는 이 표시를 앱이 뜰 때마다(App 의 mount effect) 지웠는데, 새로고침 직후에도
 * 앱은 항상 뜨기 때문에 표시가 매번 사라졌다. 결과적으로 "한 번만"이 지켜지지 않아
 * 실패한 청크가 있으면 새로고침이 계속 반복될 수 있었다. 이제는 지우지 않고
 * **시각을 기록**해서, 방금 새로고침했다면 다시 새로고침하지 않고(쿨다운),
 * 시간이 충분히 지난 뒤(다음 배포)에는 다시 회복을 시도한다.
 */

const CHUNK_RELOAD_KEY = 'picks_chunk_reload';

/**
 * 직전 자동 새로고침 이후 이만큼 지나기 전에는 다시 새로고침하지 않는다.
 * 새로고침으로 고쳐지는 문제라면 이 시간 안에 해결되고, 고쳐지지 않는 문제라면
 * 사용자는 반복 새로고침 대신 "다시 시도" 버튼이 있는 화면을 보게 된다.
 */
const RELOAD_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * import() 실패로 볼 수 있는 오류인지. 브라우저마다 메시지가 달라서 이름과 문구를
 * 모두 본다. 청크가 사라진 경우 외에도, SPA catch-all 이 index.html(text/html)을
 * 돌려주면 "MIME type" 오류로 나타난다.
 */
export const isChunkLoadError = (error: unknown): boolean => {
  const name = (error as { name?: string })?.name || '';
  const message = (error as { message?: string })?.message || '';
  return (
    name === 'ChunkLoadError' ||
    /Loading (CSS )?chunk [\d]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /expected a JavaScript(-or-Wasm)? module/i.test(message) ||
    /MIME type/i.test(message) ||
    /import\(\) failed/i.test(message)
  );
};

const lastReloadAt = (): number => {
  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    if (!raw) return 0;
    // 예전 버전은 '1' 을 넣었다. 값이 숫자가 아니면 "아주 최근"으로 보고 쿨다운을
    // 적용한다 — 실패 직후 새로고침을 한 번 더 하는 것보다 안내 화면이 낫다.
    const at = Number.parseInt(raw, 10);
    return Number.isFinite(at) && at > 0 ? at : Date.now();
  } catch {
    return 0;
  }
};

/** 지금 자동 새로고침을 해도 되는지(쿨다운 밖인지). */
export const chunkReloadAllowed = (): boolean => {
  const at = lastReloadAt();
  return at === 0 || Date.now() - at > RELOAD_COOLDOWN_MS;
};

/**
 * 청크 오류에서 자동 회복을 시도한다. 새로고침을 시작했으면 true.
 *
 * 호출한 쪽은 true 를 받아도 그대로 진행해야 한다 — 새로고침은 즉시 일어나지
 * 않으므로, 화면을 멈춘 상태로 기다리면 새로고침이 막힌 환경(일부 인앱 브라우저)에서
 * 영원히 로딩 중이 된다.
 */
export const attemptChunkReload = (): boolean => {
  if (!chunkReloadAllowed()) return false;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage 를 못 쓰는 환경(사파리 프라이빗 등)에서는 반복 새로고침을
    // 막을 방법이 없으므로 아예 시도하지 않는다.
    return false;
  }
  try {
    window.location.reload();
    return true;
  } catch {
    return false;
  }
};

/**
 * 회복 기록을 지운다. 사용자가 직접 "다시 시도"를 눌렀을 때처럼, 다음 실패에서
 * 자동 회복을 한 번 더 허용하고 싶을 때만 쓴다.
 */
export const clearChunkReloadFlag = () => {
  try { sessionStorage.removeItem(CHUNK_RELOAD_KEY); } catch {}
};
