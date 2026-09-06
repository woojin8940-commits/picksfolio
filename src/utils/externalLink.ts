/**
 * 공개 페이지에서 밖으로 나가는 링크를 여는 한 곳.
 *
 * 원래는 UserPage 안에서 직접 `<a>` 를 만들어 `target="_blank"` 로 click() 하고
 * 곧바로 지웠다. 데스크톱 크롬에서는 잘 됐지만, 눌러도 아무 일이 없다는 신고가
 * 꾸준히 들어왔다. 원인은 하나가 아니라 셋이었다.
 *
 * 1. 팝업 차단. 스크립트가 만든 링크를 눌러 새 탭을 여는 건 브라우저 눈에는
 *    팝업이다. 사파리와 인앱 브라우저는 이걸 조용히 막는다 — 예외도, 콘솔
 *    경고도 없어서 "가끔 안 눌린다"로만 보였다.
 * 2. 인앱 브라우저에 새 탭이 없다. 개인페이지는 대부분 카카오톡으로 공유돼서
 *    카카오톡·네이버·인스타 인앱 브라우저로 열린다. 여기서 target="_blank" 는
 *    할 일이 없어 그냥 무시된다.
 * 3. click() 직후 `removeChild` 로 링크를 지웠다. 아직 이동이 시작되지 않은
 *    상태에서 링크가 문서에서 사라지면 이동이 함께 취소된다.
 *
 * 그래서 두 갈래로 정리했다. 누를 것이 링크로 만들 수 있으면 `externalLinkProps`
 * 로 진짜 `<a href>` 를 그린다 — 브라우저가 사용자의 탭 동작을 직접 처리하니
 * 팝업 판정 자체가 없다. 링크로 만들 수 없는 자리(카드 전체가 눌리는 일정
 * 블록처럼)는 `openExternalUrl` 을 쓰고, 새 탭이 막히면 현재 창에서 연다.
 * 아무 일도 일어나지 않는 것보다 이동하는 편이 낫다.
 */

import { isNativeApp } from './appEnv';

/**
 * 앱으로 넘겨야 하는 스킴.
 *
 * 새 탭에서 열면 빈 탭만 남고 앱이 뜨지 않는 경우가 많아, 이건 항상 현재 창의
 * 주소를 바꿔서 OS 에 넘긴다. 스킴은 일부러 나열한다 — `^[a-z]+:` 로 잡으면
 * `example.com:3000` 같은 포트가 붙은 주소를 스킴으로 잘못 읽는다.
 */
const APP_SCHEME =
  /^(tel|mailto|sms|kakaotalk|kakaolink|kakaoplus|kakaostory|intent|market|itms-apps|itms-appss|line|naverapp|naversearchapp):/i;

/**
 * 새 탭 개념이 없는 인앱 브라우저.
 *
 * 개인페이지가 실제로 열리는 곳이 대부분 여기다(카카오톡 공유 → 카카오톡 인앱
 * 브라우저). 이 안에서는 새 탭을 시도하지 않고 바로 현재 창에서 연다.
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /KAKAOTALK|NAVER\(inapp|NAVER \(inapp|DaumApps|Instagram|FBAN|FBAV|FB_IAB|Line\/|band_|everytimeApp|Snapchat|TwitterAndroid|KAKAOSTORY/i.test(
    ua,
  );
}

/** 새 탭이 아니라 현재 창에서 열어야 하는 환경인지. */
function prefersSameWindow(url: string): boolean {
  return APP_SCHEME.test(url) || isNativeApp() || isInAppBrowser();
}

/**
 * 저장된 값을 열 수 있는 절대 주소로 만든다.
 *
 * 인플루언서는 주소를 복사해 오기도 하고("https://youtube.com/@me") 도메인만
 * 적기도 한다("youtube.com/@me"). https:// 를 안 붙이면 브라우저가 상대 경로로
 * 읽어서 /사용자이름/youtube.com 같은 없는 곳으로 간다.
 *
 * 예전에는 여기서 `#` 을 전부 지웠다. 자리표시용으로 저장된 "#" 하나를 걷어내려
 * 만든 코드였는데, 주소 안의 조각(#)까지 같이 지워서 youtube.com/@me#featured 가
 * youtube.com/@mefeatured 로 바뀌었다 — 눌러도 엉뚱한 곳으로 가거나 404 가 났다.
 * 이제 의미 없는 `#` 만 걷어내고 조각은 그대로 둔다.
 *
 * 열 주소가 없으면 빈 문자열을 준다. '#' 을 돌려주면 눌렀을 때 페이지가 맨 위로
 * 튀어서, 안 눌린 것처럼 보이면서 자리만 차지한다.
 */
export const toAbsoluteUrl = (raw: string | null | undefined): string => {
  const value = sanitizeLinkValue(raw);
  if (!value) return '';
  if (APP_SCHEME.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  // 프로토콜 상대 주소(//example.com)는 https 로 고정한다.
  if (value.startsWith('//')) return `https:${value}`;
  // 사이트 안의 경로(/이름/proposal)는 지금 도메인에 붙인다.
  if (value.startsWith('/')) {
    return typeof window === 'undefined' ? value : `${window.location.origin}${value}`;
  }
  return `https://${value.replace(/^\/+/, '')}`;
};

/**
 * 입력·저장 단계에서 링크값을 다듬는다.
 *
 * 지우는 것은 두 가지뿐이다 — `#` 만 들어 있는 값(빈 링크의 자리표시), 그리고
 * 끝에 붙은 알맹이 없는 `#`. 조각이 있는 주소는 건드리지 않는다.
 */
export const sanitizeLinkValue = (raw: string | null | undefined): string => {
  const value = (raw || '').trim();
  if (!value || /^#+$/.test(value)) return '';
  return value.replace(/#+$/, '');
};

/**
 * 진짜 `<a>` 에 펼쳐 넣을 속성.
 *
 * 이게 기본 수단이다. 브라우저가 사용자의 탭을 직접 이동으로 처리하므로 팝업
 * 차단에 걸리지 않고, 길게 눌러 "새 탭으로 열기"나 주소 복사도 된다.
 * 열 주소가 없으면 href 를 빼서, 눌리지 않는 상태로 그린다.
 */
export const externalLinkProps = (
  raw: string | null | undefined,
): { href?: string; target?: '_blank'; rel?: string } => {
  const href = toAbsoluteUrl(raw);
  if (!href) return {};
  if (prefersSameWindow(href)) return { href, rel: 'noopener noreferrer' };
  return { href, target: '_blank', rel: 'noopener noreferrer' };
};

/**
 * 스크립트에서 링크를 연다. 카드 전체가 눌리는 자리처럼 `<a>` 로 만들 수 없을
 * 때만 쓴다.
 *
 * 새 탭이 막히면(팝업 차단) `window.open` 이 null 을 준다. 그때는 현재 창에서
 * 연다 — 눌렀는데 아무 일도 없는 것이 제일 나쁘다.
 *
 * `noopener` 를 open 의 세 번째 인자로 넘기지 않는 것은 의도다. 그렇게 하면
 * 규격상 성공해도 null 이 돌아와서 차단과 구분할 수 없고, 결국 새 탭이 열린 뒤
 * 현재 창까지 같은 곳으로 옮겨가 버린다. 대신 열린 창의 opener 를 끊는다.
 *
 * @returns 이동을 시작했으면 true, 열 주소가 없으면 false.
 */
export const openExternalUrl = (raw: string | null | undefined): boolean => {
  const url = toAbsoluteUrl(raw);
  if (!url || typeof window === 'undefined') return false;

  if (prefersSameWindow(url)) {
    window.location.href = url;
    return true;
  }

  try {
    const opened = window.open(url, '_blank');
    if (opened) {
      try {
        opened.opener = null;
      } catch {
        // 이동이 이미 시작돼 다른 출처가 된 창은 손댈 수 없다. 여는 데는 성공했다.
      }
      return true;
    }
  } catch {
    // window.open 자체를 막고 예외를 던지는 브라우저도 있다.
  }

  // 새 탭이 막혔다 — 현재 창에서 연다.
  window.location.href = url;
  return true;
};
