import React from 'react';

type PhoneFrameSize = 'sm' | 'md' | 'lg' | 'xl';

interface PhoneFrameProps {
  children: React.ReactNode;
  label?: string;
  size?: PhoneFrameSize;
  contentClassName?: string;
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
  liveUrl,
}) => {
  // xl(데스크톱 미리보기)은 세로 가용 공간을 기준으로 크기가 정해진다. 화면 높이에서 라벨/링크 등
  // 주변 여백(약 5.5rem)을 뺀 만큼 높이를 채우고, 그에 맞춰 너비(9/19.5 비율)가 정해진다. 단, 너비는
  // 부모 칼럼 폭(max-w-full)을 넘지 않는다. 이렇게 하면 세로 여백이 남을 땐 기기가 그만큼 더 커지고,
  // 화면이 낮아도 잘리지 않고 통째로 보인다.
  const isXl = size === 'xl';
  return (
    <div className={`flex flex-col items-center ${isXl ? 'w-full' : ''}`}>
      <div
        className={`relative bg-slate-900 rounded-[3rem] p-3 shadow-2xl overflow-hidden flex flex-col ${isXl ? 'w-[min(100%,calc((100vh_-_5.5rem)*9/19.5))] h-auto max-w-full border-0' : `border-[8px] border-slate-800 ${SIZE_CLASS[size]}`}`}
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
        <div className={`flex-1 min-h-0 overflow-y-auto rounded-[2rem] pb-8 ${contentClassName}`}>
          {children}
        </div>
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
