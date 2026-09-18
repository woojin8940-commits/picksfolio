import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface LanguageSwitcherProps {
  className?: string;
  /**
   * 'header'   — 파란/어두운 헤더 위에 얹는 판(로그인 · 가입 화면).
   * 'dashboard' — 종이색(밝은) 배경 위에 얹는 판(홈 헤더 · 홈 대시보드 헤더).
   * 'compact'  — 자리가 좁을 때 쓰는 한 칸 토글(모바일 헤더).
   *
   * 예전에는 밝은 배경에도 'header' 판을 그대로 썼다. 그 판은 비활성 쪽 글씨가
   * text-white/70 이라서 흰 배경 위에서는 고르지 않은 언어가 보이지 않았고,
   * 결과적으로 "영어로 바꾸는 버튼이 없다"로 보였다. 배경별 판을 나눠 둔다.
   */
  variant?: 'header' | 'dashboard' | 'compact';
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  className = '',
  variant = 'header',
}) => {
  const { language, toggleLanguage, setLanguage } = useLanguage();

  if (variant === 'compact') {
    const nextLabel = language === 'ko' ? 'EN' : '한국어';
    return (
      <button
        type="button"
        onClick={toggleLanguage}
        aria-label={language === 'ko' ? 'Switch to English' : '한국어로 변경'}
        title={language === 'ko' ? 'Switch to English' : '한국어로 변경'}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition-all border whitespace-nowrap ${
          className || 'bg-white/10 hover:bg-white/20 text-white border-white/20'
        }`}
      >
        <span aria-hidden="true">🌐</span>
        <span>{nextLabel}</span>
      </button>
    );
  }

  const isLight = variant === 'dashboard';

  const shell = isLight
    ? 'bg-white border-slate-200 shadow-sm'
    : 'bg-black/20 backdrop-blur-md border-white/20';

  const activeBtn = isLight
    ? 'bg-[#2563EB] text-white shadow-sm font-black'
    : 'bg-white text-blue-900 shadow-sm font-black';

  const idleBtn = isLight
    ? 'text-slate-500 hover:text-slate-900'
    : 'text-white/70 hover:text-white';

  return (
    <div
      role="group"
      aria-label={language === 'ko' ? '언어 선택' : 'Language'}
      className={`inline-flex items-center rounded-full p-0.5 border text-xs font-bold ${shell} ${className}`}
    >
      <button
        type="button"
        onClick={() => setLanguage('ko')}
        aria-pressed={language === 'ko'}
        className={`px-2.5 md:px-3 py-1 rounded-full transition-all flex items-center gap-1 whitespace-nowrap ${
          language === 'ko' ? activeBtn : idleBtn
        }`}
      >
        <span aria-hidden="true">🇰🇷</span>
        {/* 좁은 화면에서는 헤더가 날짜 · 버튼과 한 줄을 다투므로 짧은 이름을 쓴다. */}
        <span className="md:hidden">KO</span>
        <span className="hidden md:inline">한국어</span>
      </button>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        aria-pressed={language === 'en'}
        className={`px-2.5 md:px-3 py-1 rounded-full transition-all flex items-center gap-1 whitespace-nowrap ${
          language === 'en' ? activeBtn : idleBtn
        }`}
      >
        <span aria-hidden="true">🇺🇸</span>
        <span className="md:hidden">EN</span>
        <span className="hidden md:inline">English</span>
      </button>
    </div>
  );
};

export default LanguageSwitcher;
