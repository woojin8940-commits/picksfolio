import React, { useCallback, useEffect, useRef } from 'react';

/**
 * 내용만큼 늘어나는 글상자.
 *
 * 장면 설명은 세 줄로 끝나지 않는다. 고정 `rows` 로 두면 넉 줄째부터 칸 안에서 잘려
 * 나가고, 모바일에서는 그 칸 안을 다시 스크롤해야 뒷문장을 읽을 수 있다 — 두 손가락
 * 크기의 칸 안에서 스크롤을 시작하면 페이지가 같이 흔들려서, 실제로는 "몇 줄 보이다가
 * 안 보이는" 화면이 된다. 그래서 값이 바뀔 때마다 내용 높이(scrollHeight)로 늘린다.
 *
 * `rows` 는 빈 칸일 때의 최소 높이로만 쓴다. 화면 폭이 바뀌면 같은 글이 차지하는 줄
 * 수도 달라지므로(가로 세로 전환) 리사이즈에도 한 번 다시 잰다.
 */
const SceneTextarea: React.FC<
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }
> = ({ value, onChange, rows = 2, className, ...rest }) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = useCallback(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  useEffect(() => {
    fit();
  }, [fit, value]);

  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={rows}
      onChange={e => {
        onChange?.(e);
        fit();
      }}
      className={className}
      {...rest}
    />
  );
};

export default SceneTextarea;
