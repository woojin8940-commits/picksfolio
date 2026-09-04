/**
 * 로그인 저장 옵션의 뒷정리.
 *
 * 로그인 화면에는 "저장" 옵션이 하나도 없다.
 *
 * - 아이디/비밀번호 로그인과 비즈니스 로그인은 아이디를 저장하지 않는다 —
 *   아이디·비밀번호를 채워 주는 일은 브라우저·OS 의 비밀번호 관리자(입력란의
 *   autoComplete)가 이미 안전하게 한다.
 * - 카카오 간편로그인의 "간편로그인 저장" 체크도 없앴다. 카카오 로그인 화면이
 *   이미 자기 "간편로그인 저장"을 제공하는데 우리 화면에 같은 이름의 체크를 하나
 *   더 두면 무엇을 저장하는 건지 알 수 없다. 저장은 카카오 쪽 체크에 맡긴다 —
 *   그쪽을 켜 두면 다음부터 카카오 버튼 한 번으로 아무것도 묻지 않고 돌아온다.
 *
 * 그래서 PC 의 2시간 비활동 자동 로그아웃(App.tsx 의 타이머, `isPersistentLoginEnv`)은
 * 이제 모든 로그인에 예외 없이 적용된다. 휴대폰·앱은 그대로 계속 유지된다.
 *
 * 남은 일은 예전 저장 옵션들이 브라우저에 남겨 둔 키를 지우는 것뿐이다. 저장
 * 기능이 없어졌는데 값이 계속 남아 있으면 안 된다.
 */

/** 없어진 저장 옵션들이 남긴 키. 탭 슬롯(utils/accountScope)으로 나누지 않았다. */
const REMOVED_KEYS = [
  // "간편로그인 저장"(카카오 로그인 유지)
  'picks_keep_login',
  // 그보다 앞선 "로그인 정보 저장"(아이디 저장 · 비즈니스 로그인 유지)
  'picks_saved_login_id',
  'picks_saved_business_id',
  'picks_keep_business_login',
];

/**
 * 없어진 저장 옵션이 남긴 값을 지운다. 앱을 그리기 전에 한 번 부른다(main.tsx).
 */
export function purgeRemovedLoginSaveKeys(): void {
  try {
    REMOVED_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // 사파리 프라이빗 등 저장소가 막힌 환경이면 남은 값도 없다.
  }
}
