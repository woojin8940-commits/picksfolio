import React from 'react';
import { Globe } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface LanguageSwitcherProps {
  className?: string;
  variant?: 'header' | 'dashboard' | 'compact';
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  className = '',
  variant = 'header',
}) => {
  const { language, toggleLanguage, setLanguage } = useLanguage();

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={toggleLanguage}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all border ${
          className || 'bg-white/10 hover:bg-white/20 text-white border-white/20'
        }`}
        title={language === 'ko' ? 'Switch to English' : '한국어로 변경'}
      >
        <Globe size={13} className="shrink-0" />
        <span>{language === 'ko' ? 'EN' : '한국어'}</span>
      </button>
    );
  }

  return (
    <div className={`inline-flex items-center bg-black/20 backdrop-blur-md border border-white/20 rounded-full p-0.5 text-xs font-bold ${className}`}>
      <button
        type="button"
        onClick={() => setLanguage('ko')}
        className={`px-3 py-1 rounded-full transition-all flex items-center gap-1 ${
          language === 'ko'
            ? 'bg-white text-blue-900 shadow-sm font-black'
            : 'text-white/70 hover:text-white'
        }`}
      >
        <span>🇰🇷</span>
        <span>한국어</span>
      </button>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`px-3 py-1 rounded-full transition-all flex items-center gap-1 ${
          language === 'en'
            ? 'bg-white text-blue-900 shadow-sm font-black'
            : 'text-white/70 hover:text-white'
        }`}
      >
        <span>🇺🇸</span>
        <span>English</span>
      </button>
    </div>
  );
};

export default LanguageSwitcher;
