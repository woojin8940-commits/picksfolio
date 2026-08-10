import React, { createContext, useContext, useState } from 'react';

export type Language = 'ko' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, defaultKo?: string, defaultEn?: string) => string;
}

const translations: Record<string, { ko: string; en: string }> = {
  // Navigation & Header
  'nav.home': { ko: '홈', en: 'Home' },
  'nav.dashboard': { ko: '대시보드', en: 'Dashboard' },
  'nav.links': { ko: '링크 관리', en: 'Links' },
  'nav.dmAutomation': { ko: 'DM 자동화', en: 'DM Automation' },
  'nav.campaigns': { ko: '캠페인 협업', en: 'Campaigns' },
  'nav.inbox': { ko: '비즈니스 수신함', en: 'Inbox' },
  'nav.timeline': { ko: '협업 타임라인', en: 'Timeline' },
  'nav.calendar': { ko: '협업 현황', en: 'Calendar' },
  'nav.openSchedule': { ko: '오픈 일정', en: 'Open Schedule' },
  'nav.membership': { ko: '멤버십 플랜', en: 'Membership' },
  'nav.login': { ko: '로그인', en: 'Log In' },
  'nav.logout': { ko: '로그아웃', en: 'Log Out' },
  'nav.signup': { ko: '회원가입', en: 'Sign Up' },
  'nav.managerDashboard': { ko: '담당자 대시보드', en: 'Manager Dashboard' },
  'nav.more': { ko: '더보기', en: 'More' },
  'nav.myPage': { ko: '내 페이지 보기', en: 'View My Page' },
  'nav.myLink': { ko: '내 링크', en: 'My Link' },

  // Dashboard Overview
  'dash.welcome': { ko: '반가워요,', en: 'Welcome back,' },
  'dash.period': { ko: '기간', en: 'Period' },
  'dash.views': { ko: '조회수', en: 'Views' },
  'dash.clicks': { ko: '클릭수', en: 'Clicks' },
  'dash.ctr': { ko: '클릭률', en: 'CTR' },
  'dash.aiTrend': { ko: 'AI 트렌드 분석', en: 'AI Trend Analysis' },

  // DM Automation
  'dm.title': { ko: 'DM 자동화', en: 'DM Automation' },
  'dm.desc': { ko: '댓글 반응 자동화, 키워드 답글, 수동 DM 발송까지 스마트하게 관리하세요.', en: 'Automate comment responses, keyword replies, and send manual DMs easily.' },
  'dm.manualSend': { ko: '수동 DM 발송', en: 'Manual DM Send' },
  'dm.addAutomation': { ko: '자동화 추가하기', en: 'Add Automation' },
  'dm.activeAutomation': { ko: '활성 자동화', en: 'Active Rules' },
  'dm.totalAutomation': { ko: '전체 자동화', en: 'Total Rules' },
  'dm.status': { ko: '상태', en: 'Status' },
  'dm.connectedAccount': { ko: '연결된 계정', en: 'Connected Account' },
  'dm.connectInstagram': { ko: '인스타그램 계정 연동하기', en: 'Connect Instagram Account' },
  'dm.disconnect': { ko: '연동 해제', en: 'Disconnect' },
  'dm.myFeed': { ko: '내 피드 게시물', en: 'My Feed Posts' },
  'dm.myAutomations': { ko: '내 자동화', en: 'My Automations' },
  'dm.edit': { ko: '편집', en: 'Edit' },
  'dm.delete': { ko: '삭제', en: 'Delete' },
  'dm.manualModalTitle': { ko: '수동 DM 발송하기', en: 'Send DM Manually' },
  'dm.manualModalDesc': { ko: '원하는 인스타그램 사용자에게 메시지를 수동으로 직접 발송합니다.', en: 'Manually send a DM message to any target Instagram user.' },
  'dm.recipient': { ko: '수신자 IGSID / 사용자 ID', en: 'Recipient IGSID / User ID' },
  'dm.recipientPlaceholder': { ko: '수신자 인스타그램 IGSID 입력', en: 'Enter recipient Instagram IGSID' },
  'dm.selectTemplate': { ko: '기존 자동화 템플릿 불러오기', en: 'Select Existing Template' },
  'dm.customMessage': { ko: '직접 입력', en: 'Custom Message' },
  'dm.messageType': { ko: '메시지 유형', en: 'Message Type' },
  'dm.textType': { ko: '일반 텍스트', en: 'Text Message' },
  'dm.carouselType': { ko: '카드 캐러셀', en: 'Card Carousel' },
  'dm.messageText': { ko: 'DM 메시지 내용', en: 'DM Message Content' },
  'dm.buttons': { ko: '버튼 링크', en: 'Link Buttons' },
  'dm.addButton': { ko: '버튼 추가', en: 'Add Button' },
  'dm.sendNow': { ko: '수동 발송하기', en: 'Send DM Now' },
  'dm.cancel': { ko: '취소', en: 'Cancel' },
  'dm.sending': { ko: '발송 중...', en: 'Sending...' },
  'dm.sendSuccess': { ko: 'DM이 성공적으로 발송되었습니다!', en: 'DM sent successfully!' },
  'dm.sendFailed': { ko: 'DM 발송에 실패했습니다.', en: 'Failed to send DM.' },

  // General Buttons & Status
  'common.save': { ko: '저장', en: 'Save' },
  'common.close': { ko: '닫기', en: 'Close' },
  'common.confirm': { ko: '확인', en: 'Confirm' },
  'common.loading': { ko: '불러오는 중...', en: 'Loading...' },
  'common.active': { ko: '작동 중', en: 'Active' },
  'common.inactive': { ko: '중지됨', en: 'Inactive' },
  'common.proPlanNotice': { ko: '디엠 자동화는 프로 플랜 전용 기능이에요.', en: 'DM Automation is a Pro Plan exclusive feature.' },
  'common.language': { ko: '언어', en: 'Language' },
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('picks_language');
    return (saved === 'en' || saved === 'ko') ? saved : 'ko';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('picks_language', lang);
  };

  const toggleLanguage = () => {
    const nextLang = language === 'ko' ? 'en' : 'ko';
    setLanguage(nextLang);
  };

  const t = (key: string, defaultKo?: string, defaultEn?: string): string => {
    const entry = translations[key];
    if (entry) {
      return language === 'en' ? entry.en : entry.ko;
    }
    if (language === 'en') {
      return defaultEn || defaultKo || key;
    }
    return defaultKo || defaultEn || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    // Fallback if component is outside LanguageProvider
    return {
      language: 'ko',
      setLanguage: () => {},
      toggleLanguage: () => {},
      t: (key, defaultKo, defaultEn) => defaultKo || defaultEn || key,
    };
  }
  return context;
};
