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
  // xl(데스크톱)은 기기 높이를 뷰포트 기준(93vh)으로 최대한 키워 미리보기 칼럼의 상·하단에
  // 거의 닿게 한다(라벨/링크 자리만큼만 여백). 너비는 9/19.5 비율로 자동 계산되고, 칼럼 폭을
  // 기기 너비에 맞춰 좁혀 두었기 때문에 좌·우 여백도 거의 남지 않는다. 칼럼이 justify-center 로
  // 세로 가운데 정렬하므로 기기가 칼럼 한가운데에 꽉 차게 위치한다.
  const isXl = size === 'xl';
  return (
    <div className={`flex flex-col items-center ${isXl ? 'w-full' : ''}`}>
      <div
        className={`relative bg-slate-900 rounded-[3rem] p-3 shadow-2xl border-[8px] border-slate-800 overflow-hidden ${isXl ? 'h-[93vh] max-h-[1240px] max-w-full' : SIZE_CLASS[size]}`}
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
      <p className="text-center mt-1.5 text-slate-400 text-[10px] font-black uppercase tracking-widest">
        {label}
      </p>
      {liveUrl && (
        <a
          href={liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-0.5 rounded-lg bg-slate-900 text-white text-[10px] font-black hover:bg-slate-800 transition-all shadow-md"
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
