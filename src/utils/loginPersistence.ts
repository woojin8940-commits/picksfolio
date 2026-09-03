/**
 * "간편로그인 저장" — 카카오 간편로그인에만 있는 옵션.
 *
 * 켜 두면 데스크톱의 2시간 자동 로그아웃(App.tsx 의 비활동 타이머,
 * `isPersistentLoginEnv`)을 건너뛴다. 즉 직접 로그아웃을 누를 때까지 로그인이
 * 유지된다 — Supabase 세션은 리프레시 토큰으로 계속 갱신되므로 브라우저를 닫았다
 * 열어도 그대로다.
 *
 * 아이디/비밀번호 로그인과 비즈니스 로그인에는 저장 옵션이 없다. 그 화면들은
 * 아이디도 저장하지 않는다 — 아이디·비밀번호를 채워 주는 일은 브라우저·OS 의
 * 비밀번호 관리자(입력란의 autoComplete)가 이미 안전하게 한다. 저장이 남는 건
 * 카카오 간편로그인처럼 기기에 묶인 개인 로그인 하나뿐이다.
 *
 * 이 값은 로그아웃해도 지우지 않는다. 그래서 App.tsx 의 저장소 청소가 이 키를
 * 항상 제외한다(`LOGIN_PERSISTENCE_KEYS`). "저장하면 계속 저장"이 이 기능의 전부라
 * 로그아웃 한 번에 사라지면 의미가 없다. 체크를 끄면 그 자리에서 지운다.
 *
 * 탭 슬롯(utils/accountScope)으로 나누지 않는다. 이건 계정 세션이 아니라 이 기기
 * 사용자의 취향이고, 로그인 화면은 슬롯이 정해지기 전에 열린다.
 */

/** 카카오 간편로그인 저장 여부를 담는 키. */
const KAKAO_KEEP_LOGIN_KEY = 'picks_keep_login';

/**
 * 예전 "로그인 정보 저장"(아이디 저장 · 비즈니스 로그인 유지)이 남긴 키들.
 * 기능이 없어졌으므로 이 모듈을 불러오는 시점에 한 번 지운다 — 저장 옵션을 껐는데
 * 브라우저에 아이디가 계속 남아 있으면 안 된다.
 */
const LEGACY_KEYS = [
  'picks_saved_login_id',
  'picks_saved_business_id',
  'picks_keep_business_login',
];

/**
 * 로그아웃·계정 전환 때 지우면 안 되는 키들. localStorage 를 쓸어내는 쪽이
 * 제외 목록으로 쓴다.
 */
export const LOGIN_PERSISTENCE_KEYS: string[] = [KAKAO_KEEP_LOGIN_KEY];

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

try {
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
} catch {
  // 저장소가 막힌 환경이면 남은 값도 없다.
}

/** 카카오 간편로그인 저장이 켜져 있는지. */
export function isKakaoKeepLoginEnabled(): boolean {
  return read(KAKAO_KEEP_LOGIN_KEY) === '1';
}

/**
 * "간편로그인 저장" 체크를 켜거나 끈다.
 *
 * 체크 상태는 로그인이 성공하기 전에 기록한다. 카카오 간편로그인은 이 화면을
 * 떠나 카카오로 갔다 오기 때문에, 성공한 뒤에 기록하려 하면 기록할 순간이 없다.
 */
export function setKakaoKeepLogin(enabled: boolean): void {
  write(KAKAO_KEEP_LOGIN_KEY, enabled ? '1' : '');
}
