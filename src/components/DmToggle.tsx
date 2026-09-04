import React from 'react';

/**
 * 켜기/끄기 스위치.
 *
 * 디엠 자동화 화면과 그 하위 기능 화면(자주 묻는 질문 · DM 자동 응답 · 예약 발송)이
 * 같은 스위치를 쓴다. 한쪽에서만 모양이 바뀌면 같은 화면 안에서 서로 다른 스위치가
 * 섞여 보이므로 파일 하나로 둔다.
 */
const DmToggle: React.FC<{
  on: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
}> = ({ on, onClick, size = 'md', disabled = false }) => {
  const s = size === 'sm'
    ? { w: 'w-10', h: 'h-6', k: 'w-4 h-4', on: 'left-5', off: 'left-1' }
    : { w: 'w-12', h: 'h-7', k: 'w-5 h-5', on: 'left-6', off: 'left-1' };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={`relative ${s.w} ${s.h} rounded-full transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${on ? 'bg-pink-500' : 'bg-slate-300'}`}
      aria-label="켜기/끄기"
    >
      <span className={`absolute top-1 ${s.k} bg-white rounded-full shadow transition-all ${on ? s.on : s.off}`} />
    </button>
  );
};

export default DmToggle;
