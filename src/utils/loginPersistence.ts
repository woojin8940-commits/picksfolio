/**
 * "로그인 정보 저장" — 한 번 저장하면 계속 저장된다.
 *
 * 두 가지를 함께 기억한다.
 *
 *   1. 아이디. 다음에 로그인 화면을 열면 그대로 채워져 있다. 비밀번호는 저장하지
 *      않는다 — 브라우저 저장소에 평문으로 남는 값이 되고, 그 역할은 이미
 *      브라우저·OS 의 비밀번호 관리자(입력란의 autoComplete)가 안전하게 한다.
 *   2. "로그인 유지" 여부. 켜져 있으면 데스크톱의 2시간 자동 로그아웃
 *      (App.tsx 의 비활동 타이머, `isPersistentLoginEnv`)을 건너뛴다. 즉 직접
 *      로그아웃을 누를 때까지 로그인이 유지된다 — Supabase 세션은 리프레시
 *      토큰으로 계속 갱신되므로 브라우저를 닫았다 열어도 그대로다.
 *
 * 두 값은 로그아웃해도 지우지 않는다. 그래서 App.tsx 의 저장소 청소가 이 키들을
 * 항상 제외한다(`LOGIN_PERSISTENCE_KEYS`). "저장하면 계속 저장"이 이 기능의 전부라
 * 로그아웃 한 번에 사라지면 의미가 없다. 체크를 끄면 그 자리에서 지운다.
 *
 * 탭 슬롯(utils/accountScope)으로 나누지 않는다. 이건 계정 세션이 아니라 이 기기
 * 사용자의 취향이고, 로그인 화면은 슬롯이 정해지기 전에 열린다.
 */

/** 아이디·비밀번호로 들어오는 두 종류의 로그인. 카카오 로그인은 'user' 쪽이다. */
export type LoginKind = 'user' | 'business';

const SAVED_ID_KEYS: Record<LoginKind, string> = {
  user: 'picks_saved_login_id',
  business: 'picks_saved_business_id',
};

const KEEP_LOGIN_KEYS: Record<LoginKind, string> = {
  user: 'picks_keep_login',
  business: 'picks_keep_business_login',
};

/**
 * 로그아웃·계정 전환 때 지우면 안 되는 키들. localStorage 를 쓸어내는 쪽이
 * 제외 목록으로 쓴다.
 */
export const LOGIN_PERSISTENCE_KEYS: string[] = [
  ...Object.values(SAVED_ID_KEYS),
  ...Object.values(KEEP_LOGIN_KEYS),
];

function read(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    // 사파리 프라이빗 등 저장소가 막힌 환경. 저장 안 한 것으로 본다.
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // 저장 실패가 로그인을 막지는 않는다.
  }
}

/** 저장해 둔 아이디. 없으면 빈 문자열. */
export function getSavedLoginId(kind: LoginKind = 'user'): string {
  return read(SAVED_ID_KEYS[kind]);
}

/** 아이디를 저장한다. 빈 값이면 지운다. */
export function setSavedLoginId(kind: LoginKind, id: string): void {
  write(SAVED_ID_KEYS[kind], id.trim());
}

/** 로그인 유지가 켜져 있는지. */
export function isKeepLoginEnabled(kind: LoginKind = 'user'): boolean {
  return read(KEEP_LOGIN_KEYS[kind]) === '1';
}

/**
 * "로그인 정보 저장" 체크를 켜거나 끈다. 끄면 저장해 둔 아이디까지 같이 지운다 —
 * 사용자가 이 브라우저에 아무것도 남기지 않기로 한 것이므로.
 *
 * 체크 상태는 로그인이 성공하기 전에 기록한다. 카카오 간편로그인은 이 화면을
 * 떠나 카카오로 갔다 오기 때문에, 성공한 뒤에 기록하려 하면 기록할 순간이 없다.
 */
export function setKeepLogin(kind: LoginKind, enabled: boolean): void {
  write(KEEP_LOGIN_KEYS[kind], enabled ? '1' : '');
  if (!enabled) setSavedLoginId(kind, '');
}

/** 로그인에 성공했다. 체크가 켜져 있으면 이번에 쓴 아이디를 남긴다. */
export function rememberLoginId(kind: LoginKind, id: string): void {
  if (isKeepLoginEnabled(kind)) setSavedLoginId(kind, id);
}
