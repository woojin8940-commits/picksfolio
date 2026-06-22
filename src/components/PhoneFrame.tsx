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
  // 데스크톱 미리보기(인포크링크 스타일): 폰 전체가 한 화면 안에 "한눈에" 들어와야
  // 한다. 폰 아래에는 라벨·"실제 페이지 확인하기" 링크가 함께 쌓이므로, 화면 높이에서
  // 그 주변 UI(여백·라벨·링크)가 차지하는 공간(~7rem)을 미리 빼고 남는 높이에 맞춰
  // 폰을 최대한 크게 키운다. 너비는 9/19.5 비율로 자동 계산되며, 어떤 화면에서도
  // 기기 전체가 잘리지 않고 중앙에 균형 있게, 그리고 훨씬 크게 보인다.
  xl: 'h-[min(1040px,calc(100vh_-_7rem))] w-auto',
};

const PhoneFrame: React.FC<PhoneFrameProps> = ({
  children,
  label = '실시간 미리보기',
  size = 'sm',
  contentClassName = '',
  liveUrl,
}) => {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`relative bg-slate-900 rounded-[3rem] p-3 shadow-2xl border-[8px] border-slate-800 ${SIZE_CLASS[size]} overflow-hidden`}
        style={{ aspectRatio: '9/19.5' }}
      >
        {/* Status Bar */}
        <div className="h-5 flex justify-between items-center px-5 mb-2">
          <span className="text-[9px] font-black text-white/40">9:41</span>
          <div className="flex gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
            <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
          </div>
        </div>

        {/* Phone Content */}
        <div className={`h-[calc(100%-2rem)] overflow-y-auto rounded-[2rem] pb-16 ${contentClassName}`}>
          {children}
        </div>

        {/* Bottom Notch */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-20 h-1 bg-slate-200 rounded-full" />
      </div>
      <p className="text-center mt-4 text-slate-400 text-[10px] font-black uppercase tracking-widest">
        {label}
      </p>
      {liveUrl && (
        <a
          href={liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black hover:bg-slate-800 transition-all shadow-md"
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
