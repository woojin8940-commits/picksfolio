/**
 * 저장하지 않은 입력이 열려 있는지.
 *
 * 화면을 통째로 새로 고치는 동작(새 배포 반영 등)이 이 값을 보고 미룬다. 편집 창이
 * 열려 있는 동안 새로 고치면 입력한 내용이 사라진다.
 *
 * 앱(WebView)에도 알린다. 아이폰 앱은 화면을 아래로 당기면 페이지를 새로 고치는데, 편집
 * 창 머리나 짧은 본문을 끌어내리는 손짓도 그 새로고침이 될 수 있어, 편집하던 창이 사라지고
 * 첫 화면이 다시 뜬다. 앱은 이 알림을 받는 동안 당겨서 새로고침을 꺼 둔다.
 */
const holders = new Set<string>();

const notifyNative = (unsaved: boolean): void => {
  try {
    const bridge = (window as unknown as { ReactNativeWebView?: { postMessage: (data: string) => void } })
      .ReactNativeWebView;
    bridge?.postMessage(JSON.stringify({ type: 'UNSAVED_WORK', payload: { unsaved } }));
  } catch {}
};

export const setUnsavedWork = (key: string, unsaved: boolean): void => {
  const before = holders.size > 0;
  if (unsaved) holders.add(key);
  else holders.delete(key);
  const after = holders.size > 0;
  if (before !== after) notifyNative(after);
};

export const hasUnsavedWork = (): boolean => holders.size > 0;
