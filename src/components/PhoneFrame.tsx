import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * xl(데스크톱 미리보기)이 그리는 화면의 실제 폭. 휴대폰(390px)과 같은 폭으로 그린 뒤
 * 프레임 크기에 맞춰 통째로 줄이거나 키운다 — 창 크기가 바뀌어도 글자 · 여백 · 줄바꿈
 * 비율이 실제 개인페이지와 같게 보인다.
 */
const XL_VIEWPORT_WIDTH = 390;

type PhoneFrameSize = 'sm' | 'md' | 'lg' | 'xl';

interface PhoneFrameProps {
  children: React.ReactNode;
  label?: string;
  size?: PhoneFrameSize;
  contentClassName?: string;
  /** 클래스로 못 적는 배경(팔레트에서 고른 임의의 색)을 그릴 때 쓴다. */
  contentStyle?: React.CSSProperties;
  liveUrl?: string;
}

const SIZE_CLASS: Record<PhoneFrameSize, string> = {
  sm: 'w-[220px] xl:w-[240px]',
  md: 'w-[260px] xl:w-[300px]',
  lg: 'w-[300px] xl:w-[340px]',
  // xl(데스크톱 미리보기)은 아래 flex-fill 로직으로 별도 처리한다.
  xl: '',
};

const PhoneFrame: React.FC<PhoneFrameProps> = ({
  children,
  label = '실시간 미리보기',
  size = 'sm',
  contentClassName = '',
  contentStyle,
  liveUrl,
}) => {
  // xl(데스크톱 미리보기)은 세로 가용 공간을 기준으로 크기가 정해진다. 화면 높이에서 라벨/링크 등
  // 주변 여백(약 2.5rem)만 뺀 만큼 높이를 최대한 채우고, 그에 맞춰 너비(9/19.5 비율)가 정해진다.
  // 너비는 부모 칼럼 폭(max-w-full)을 넘지 않는다. 여백을 최소화해 기기가 미리보기 영역을 가능한 한
  // 크게 채우도록 하되, 화면이 낮아도 잘리지 않고 통째로 보인다.
  const isXl = size === 'xl';
  const screenRef = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!isXl || !screenRef.current) return;
    const el = screenRef.current;
    const measure = () => setScreen({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isXl]);
  const scale = screen.width > 0 ? screen.width / XL_VIEWPORT_WIDTH : 1;
  return (
    <div className={`flex flex-col items-center ${isXl ? 'w-full' : ''}`}>
      <div
        className={`relative bg-slate-900 rounded-[3rem] p-3 shadow-2xl overflow-hidden flex flex-col ${isXl ? 'w-[min(100%,calc((100vh_-_2.5rem)*9/19.5))] h-auto max-w-full border-0' : `border-[8px] border-slate-800 ${SIZE_CLASS[size]}`}`}
        style={{ aspectRatio: '9/19.5' }}
      >
        {/* Status Bar */}
        <div className="h-5 flex justify-between items-center px-5 mb-2 flex-shrink-0">
          <span className="text-[9px] font-black text-white/40">9:41</span>
          <div className="flex gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
          </div>
        </div>

        {/* Phone Content — flex-1 + min-h-0 으로 남은 공간을 정확히 채워 하단이 잘리지 않게 한다. */}
        {isXl ? (
          /* 바깥 칸은 프레임 안 크기만 잰다. 안쪽 칸이 390px 폭으로 그려지고 transform 으로
             맞춰진다 — transform 이 걸린 칸이 상품 서랍(absolute)의 기준이 되므로 서랍은
             예전처럼 화면 아래에 붙는다. 스크롤 칸에는 position 을 주지 않는다. */
          <div ref={screenRef} className={`relative flex-1 min-h-0 overflow-hidden rounded-[2rem] ${contentClassName}`} style={contentStyle}>
            {screen.width > 0 && (
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{
                  width: XL_VIEWPORT_WIDTH,
                  height: screen.height / scale,
                  transform: `scale(${scale})`,
                }}
              >
                <div className="h-full overflow-y-auto pb-8">
                  {children}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={`flex-1 min-h-0 overflow-y-auto rounded-[2rem] pb-8 ${contentClassName}`} style={contentStyle}>
            {children}
          </div>
        )}
      </div>
      <p className="text-center mt-1 text-slate-400 text-[9px] font-black uppercase tracking-widest leading-none">
        {label}
      </p>
      {liveUrl && (
        <a
          href={liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 inline-flex items-center gap-1.5 px-3 py-0.5 rounded-lg bg-slate-900 text-white text-[9px] font-black hover:bg-slate-800 transition-all shadow-md"
        >
          실제 페이지 확인하기
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
};

export default PhoneFrame;
