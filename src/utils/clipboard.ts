/**
 * 복사·공유를 한 곳에서 처리한다.
 *
 * 화면마다 `navigator.clipboard.writeText(...)` 를 직접 불렀는데, 모바일 웹에서
 * 세 가지가 어긋났다.
 *
 * 1. `navigator.clipboard` 가 아예 없는 환경이 있다. 클립보드 API 는 보안 컨텍스트
 *    (https)에서만 주어지고, 카카오톡·인스타 인앱 브라우저의 구버전 웹뷰에는
 *    없다. `navigator.clipboard.writeText(...)` 는 그때 그 자리에서 TypeError 를
 *    던진다 — 버튼을 눌러도 아무 일이 없고, 뒤따르는 코드(성공 알림)도 실행되지
 *    않는다.
 * 2. 결과를 기다리지 않고 성공을 알렸다. writeText 는 프라미스인데 `await` 없이
 *    부르고 바로 "복사했습니다"를 띄우면, 권한이 거절돼도 복사됐다고 말한다.
 *    게다가 거절된 프라미스를 아무도 받지 않아 unhandled rejection 이 된다.
 * 3. 공유 시트를 닫은 것을 실패로 봤다. `navigator.share` 는 사용자가 취소하면
 *    AbortError 로 거절한다. 그것을 실패로 받아 "링크가 복사되었습니다"를 띄우면,
 *    공유를 그만둔 사람에게 하지도 않은 일을 했다고 말하는 셈이다.
 *
 * 그래서 성공·실패를 boolean 으로 돌려주고, 클립보드 API 가 없으면 숨긴
 * textarea + `execCommand('copy')` 로 한 번 더 시도한다. 옛 방식이지만 인앱
 * 브라우저에서 유일하게 되는 길이라 남겨 둔다.
 */

/** 클립보드 API 가 없을 때 쓰는 옛 방식. 사용자 제스처 안에서만 동작한다. */
const copyByExecCommand = (text: string): boolean => {
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  // 화면 밖으로 밀되 display:none 은 쓰지 않는다 — 안 보이는 요소는 선택이 안 된다.
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  // iOS 사파리는 폰트가 작으면 선택 시 화면을 확대한다. 16px 이면 확대하지 않는다.
  area.style.fontSize = '16px';
  document.body.appendChild(area);
  try {
    area.select();
    // iOS 는 select() 만으로 범위가 잡히지 않는 경우가 있어 범위를 직접 준다.
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
};

/**
 * 글자를 클립보드에 넣는다.
 *
 * @returns 복사됐으면 true. 이 값을 보고 알림을 띄워야 한다 — 부르기만 하고
 *   성공을 단정하면 안 되는 자리가 모바일에는 흔하다.
 */
export const copyText = async (text: string): Promise<boolean> => {
  const value = String(text ?? '');
  if (!value) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // 권한 거절, 포커스 없는 문서, 인앱 웹뷰의 미구현 — 아래 방식으로 한 번 더.
    }
  }

  return copyByExecCommand(value);
};

/** `shareOrCopy` 의 결과. 취소는 실패가 아니라 아무 일도 없었던 것이다. */
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * 공유 시트를 열고, 없으면 링크를 복사한다.
 *
 * 공유 API 는 모바일에만 있고 https 에서만 주어진다. 없으면 바로 복사로 간다.
 * 사용자가 시트를 닫으면 'cancelled' 를 준다 — 부르는 쪽은 그때 아무 알림도
 * 띄우지 않아야 한다.
 */
export const shareOrCopy = async (data: { title?: string; text?: string; url: string }): Promise<ShareResult> => {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  if (canShare) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      // 시트를 닫은 것(AbortError)과 진짜 실패를 구분한다. 이름이 없는 거절도
      // 있어 메시지까지 함께 본다.
      const err = e as { name?: string; message?: string } | null;
      const aborted = err?.name === 'AbortError' || /abort|cancel/i.test(String(err?.message || ''));
      if (aborted) return 'cancelled';
      // 공유가 막힌 환경(권한 정책 등)에서는 복사로 물러난다.
    }
  }

  return (await copyText(data.url)) ? 'copied' : 'failed';
};
