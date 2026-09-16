import { useEffect, useRef } from 'react';

type OverlayState = { picksOverlay?: number } | null;

/** 겹쳐 열린 창을 구분하기 위한 번호. 열릴 때마다 하나씩 올라간다. */
let overlaySeq = 0;

/**
 * 열려 있는 동안 히스토리 항목을 하나 잡아 두고, 뒤로가기를 그 창을 닫는 동작으로 쓴다.
 *
 * 휴대폰에서 덮인 화면을 닫는 첫 반응은 뒤로가기(제스처나 하드웨어 버튼)다. 그런데
 * 창은 주소를 바꾸지 않으니 뒤로가기는 창을 닫는 대신 그 화면 자체를 떠나 버렸다.
 * 작은 화면에서 닫기 버튼이 접힌 영역에 들어가 있으면(내용이 길어 위로 밀려났거나
 * 손이 닿기 어려운 구석에 있으면) 남는 길이 "앱 밖으로 나가기" 뿐이라, 사용자는
 * 갇혔다고 느낀다.
 *
 * 그래서 창이 열릴 때 주소를 그대로 둔 채 항목만 하나 쌓고, 그 항목이 사라지는
 * 순간을 "닫아 달라" 는 뜻으로 읽는다. 화면 안의 버튼으로 닫힌 경우에는 쌓아 둔
 * 항목을 되돌려 놓는다 — 그러지 않으면 뒤로가기 한 번이 아무 일도 하지 않는
 * 빈 동작이 되어, 사용자는 뒤로가기가 고장 난 줄 안다.
 *
 * onClose 는 ref 에 담아 둔다. 대부분 렌더마다 새로 만들어지는 화살표 함수가
 * 들어오는데, 그게 의존성에 들어가면 창이 열린 채로 항목을 다시 쌓는다.
 */
export function useCloseOnBack(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = ++overlaySeq;
    const url = window.location.pathname + window.location.search + window.location.hash;
    // 밑에 있던 항목의 내용(대시보드 탭 등)을 그대로 물려받는다. 뒤로가기로 이
    // 항목을 벗어날 때 탭까지 함께 바뀌어 버리면 안 되기 때문이다.
    window.history.pushState({ ...(window.history.state || {}), picksOverlay: id }, '', url);

    let closedByBack = false;
    const onPop = () => {
      // 창이 겹쳐 열렸을 때 뒤로가기 한 번은 맨 위 창만 닫아야 한다. 아직 내
      // 항목이 맨 위에 남아 있다면 지금 사라진 것은 내 위에 쌓인 창이다.
      if ((window.history.state as OverlayState)?.picksOverlay === id) return;
      closedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      if (closedByBack) return;
      // 버튼으로 닫혔다면 내 항목이 아직 맨 위에 있다. 거둬 간다. 화면이 통째로
      // 바뀌어(탭 이동 등) 이미 다른 항목이 쌓였다면 건드리지 않는다 — 그 상황에서
      // back() 을 부르면 사용자가 방금 이동한 화면에서 끌려 나온다.
      if ((window.history.state as OverlayState)?.picksOverlay === id) {
        window.history.back();
      }
    };
  }, [open]);
}
