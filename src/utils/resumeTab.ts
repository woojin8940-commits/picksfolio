/**
 * 다시 뜬 페이지가 보던 대시보드 탭으로 돌아가게 한다.
 *
 * 대시보드 탭은 주소가 아니라 화면 상태라서, 페이지가 통째로 다시 뜨면 늘 첫 탭으로
 * 돌아갔다. 자동 디엠 설정을 고치다 당겨서 새로고침이 되거나, 사진을 고르는 사이 시스템이
 * 화면을 정리해 앱이 페이지를 새로 띄우면 대시보드 첫 화면이 떠 있어서, 사람에게는 설정
 * 화면이 "튕긴" 것으로 보인다.
 *
 * 두 경우를 나눠 되살린다.
 *  - 새로고침: 브라우저가 지금 히스토리 항목의 state 를 그대로 돌려준다. 그 항목에 적어 둔
 *    탭을 쓴다. 탭마다 항목에 따로 적히므로 여러 탭을 띄워 둬도 서로 섞이지 않는다.
 *  - 앱이 페이지를 새로 띄운 경우: 히스토리가 남지 않는다. 앱이 주소에 `picks_resume=1` 을
 *    붙여 알려 주면, 이 기기에 마지막으로 적어 둔 탭을 쓴다. 오래된 기록은 쓰지 않는다.
 */

type Board = 'creator' | 'business';

const RESUME_PARAM = 'picks_resume';
/** 크리에이터와 브랜드 대시보드는 한 페이지에서 함께 뜰 수 있어 따로 적는다. */
const resumeKey = (board: Board) => `picks_resume_tab_${board}`;
const RESUME_TTL_MS = 30 * 60 * 1000;

/** 앱이 남긴 표시. 페이지가 뜰 때 한 번 읽고 주소에서 지운다. */
const resumeRequested: boolean = (() => {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(RESUME_PARAM) !== '1') return false;
    url.searchParams.delete(RESUME_PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    return true;
  } catch {
    return false;
  }
})();

/** 지금 보는 탭을 지금 히스토리 항목과 이 기기에 적어 둔다. */
export function rememberTab(board: Board, stateKey: string, tab: string): void {
  try {
    const state = (window.history.state || {}) as Record<string, unknown>;
    if (state[stateKey] !== tab) {
      window.history.replaceState(
        { ...state, [stateKey]: tab },
        '',
        window.location.pathname + window.location.search + window.location.hash,
      );
    }
  } catch {}
  try {
    localStorage.setItem(resumeKey(board), JSON.stringify({ tab, at: Date.now() }));
  } catch {}
}

/** 다시 뜬 페이지가 이어서 보여 줄 탭. 되살릴 것이 없으면 null. */
export function resumedTab<T extends string>(board: Board, stateKey: string, allowed: readonly T[]): T | null {
  try {
    const fromHistory = ((window.history.state || {}) as Record<string, unknown>)[stateKey];
    if (typeof fromHistory === 'string' && allowed.includes(fromHistory as T)) return fromHistory as T;
    if (!resumeRequested) return null;
    const stored = JSON.parse(localStorage.getItem(resumeKey(board)) || 'null') as
      | { tab?: unknown; at?: unknown }
      | null;
    if (!stored || !(Date.now() - Number(stored.at) < RESUME_TTL_MS)) return null;
    return typeof stored.tab === 'string' && allowed.includes(stored.tab as T) ? (stored.tab as T) : null;
  } catch {
    return null;
  }
}
