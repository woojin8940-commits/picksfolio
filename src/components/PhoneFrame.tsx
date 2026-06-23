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
  // xl(데스크톱 미리보기)은 너비를 기준으로 크기가 정해진다. 높이에만 맞추면 화면이 낮은(작은)
  // 모니터에서 기기가 지나치게 작아지므로, 너비를 최소 380px 보장하고(작은 화면에서도 크게 보임)
  // 화면이 클수록 높이에 맞춰 최대 540px까지 커진다. 기기가 화면보다 높으면 칼럼이 세로 스크롤된다.
  const isXl = size === 'xl';
  return (
    <div className={`flex flex-col items-center ${isXl ? 'w-full' : ''}`}>
      <div
        className={`relative bg-slate-900 rounded-[3rem] p-3 shadow-2xl overflow-hidden flex flex-col ${isXl ? 'w-[min(540px,max(380px,calc((100vh_-_6rem)*9/19.5)))] h-auto max-w-full border-0' : `border-[8px] border-slate-800 ${SIZE_CLASS[size]}`}`}
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

        {/* Phone Content — flex-1 + min-h-0 으로 남은 공간을 정확히 채워 하단이 잘리지 않게 한다.
            하단 홈 인디케이터에 가리지 않도록 pb 로 여유만 둔다. */}
        <div className={`flex-1 min-h-0 overflow-y-auto rounded-[2rem] pb-8 ${contentClassName}`}>
          {children}
        </div>

        {/* Bottom Notch — 콘텐츠 위에 살짝 떠 있는 홈 인디케이터. 경계선처럼 보이지 않도록 반투명 처리. */}
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 w-20 h-1 bg-white/25 rounded-full" />
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
