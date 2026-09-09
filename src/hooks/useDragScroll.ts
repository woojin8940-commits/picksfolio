import { useEffect, useRef } from 'react';

/**
 * 가로로 늘어선 줄(필터 칩 등)을 마우스로 끌어 넘기게 한다.
 *
 * 칩 줄은 `overflow-x-auto`+`scrollbar-hide` 라서 손가락으로는 잘 넘어가지만,
 * 마우스에는 스크롤바도 없고 세로 휠은 페이지를 움직인다 — 화면 끝에서 잘린 칩을
 * 누를 방법이 없었다. 그래서 끌어서 넘기는 길을 열어 준다.
 *
 * 세 가지를 지킨다.
 *  - 터치는 손대지 않는다. 브라우저의 관성 스크롤이 언제나 더 낫다.
 *  - 다 보이는 줄은 끌리지 않고 손 모양 커서도 뜨지 않는다. 끌 것이 없는데
 *    끌 수 있어 보이면 그것도 거짓말이다.
 *  - 끈 직후의 클릭은 삼킨다. 칩을 잡고 줄을 넘겼을 뿐인데 필터가 바뀌면
 *    끌기가 아니라 오작동으로 읽힌다.
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /** 끌 만큼 넘치는지. 커서 모양이 이 값을 따라간다. */
    const measure = () => {
      const overflowing = el.scrollWidth > el.clientWidth + 1;
      el.classList.toggle('cursor-grab', overflowing);
      if (!overflowing) el.classList.remove('cursor-grabbing');
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    window.addEventListener('resize', measure);

    let activeId: number | null = null;
    let startX = 0;
    let startScroll = 0;
    let farthest = 0;
    let draggedAt = 0;
    const THRESHOLD = 4; // 이만큼 움직이면 클릭이 아니라 끌기로 본다

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (el.scrollWidth <= el.clientWidth + 1) return;
      activeId = e.pointerId;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      farthest = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (activeId !== e.pointerId) return;
      const dx = e.clientX - startX;
      farthest = Math.max(farthest, Math.abs(dx));
      if (farthest <= THRESHOLD) return;
      // 포인터를 잡아 두면 칩 밖으로 나가도 계속 끌린다. 텍스트 선택도 같이 막는다.
      if (!el.hasPointerCapture?.(e.pointerId)) el.setPointerCapture?.(e.pointerId);
      el.classList.add('cursor-grabbing');
      el.scrollLeft = startScroll - dx;
      e.preventDefault();
    };

    const finish = (e: PointerEvent) => {
      if (activeId !== e.pointerId) return;
      activeId = null;
      el.classList.remove('cursor-grabbing');
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture?.(e.pointerId);
      if (farthest > THRESHOLD) draggedAt = Date.now();
    };

    /* 끌기가 끝난 자리에서 올라오는 클릭 한 번만 삼킨다. 끌기 없이 놓았을 때는
       클릭이 그대로 칩에 닿아야 하므로 시간으로 가른다. */
    const swallowClick = (e: MouseEvent) => {
      if (draggedAt && Date.now() - draggedAt < 150) {
        draggedAt = 0;
        e.stopPropagation();
        e.preventDefault();
      }
    };

    const blockNativeDrag = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('click', swallowClick, true);
    el.addEventListener('dragstart', blockNativeDrag);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      el.removeEventListener('click', swallowClick, true);
      el.removeEventListener('dragstart', blockNativeDrag);
    };
  }, []);

  return ref;
}
