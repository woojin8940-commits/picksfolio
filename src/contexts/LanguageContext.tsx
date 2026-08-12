import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import PlatformLanguageBridge from '../components/PlatformLanguageBridge';
import { platformTextPatterns } from './platformTextPatterns';
import { platformTextTranslations } from './platformTextTranslations';

export type Language = 'ko' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, defaultKo?: string, defaultEn?: string) => string;
  translatePlatformText: (value: string) => string;
}

const translations: Record<string, { ko: string; en: string }> = {
  // Navigation & Header
  'nav.home': { ko: '홈', en: 'Home' },
  'nav.dashboard': { ko: '대시보드', en: 'Dashboard' },
  'nav.links': { ko: '링크 관리', en: 'Links' },
  'nav.manage': { ko: '관리', en: 'Manage' },
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
  'dash.welcomeSuffix': { ko: '님!', en: '!' },
  'dash.period': { ko: '기간', en: 'Period' },
  'dash.views': { ko: '조회수', en: 'Views' },
  'dash.clicks': { ko: '클릭수', en: 'Clicks' },
  'dash.ctr': { ko: '클릭률', en: 'CTR' },
  'dash.visitors': { ko: '방문자 수', en: 'Visitors' },
  'dash.ctrLabel': { ko: '링크 클릭률', en: 'Click Through Rate' },
  'dash.realtime': { ko: '실시간', en: 'Real-time' },
  'dash.top3': { ko: '클릭 TOP 3', en: 'Top 3 Clicks' },
  'dash.collecting': { ko: '데이터 수집 중', en: 'Collecting data...' },
  'dash.addPostLink': { ko: '+ 새로운 포스트 & 링크 등록', en: '+ Add New Post & Link' },
  'dash.collabCTA': { ko: '🤝 캠페인 협업하기', en: '🤝 Collaborate on Campaigns' },
  'dash.dataOverview': { ko: '내 데이터 현황', en: 'My Data Overview' },
  'dash.productBlocks': { ko: '상품 블록', en: 'Product Blocks' },
  'dash.aiTrend': { ko: 'AI 트렌드 분석', en: 'AI Trend Analysis' },

  // DM Automation
  'dm.title': { ko: 'DM 자동화', en: 'DM Automation' },
  'dm.desc': { ko: '댓글 반응 자동화, 키워드 답글, 직접 보내기까지 스마트하게 관리하세요.', en: 'Automate comment responses, keyword replies, and send messages manually.' },
  'dm.manualSend': { ko: '보내기', en: 'Send' },
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
  // 수동 발송은 DM 과 댓글 답글을 함께 보낸다. 답글 문구는 선택 입력이다.
  'dm.commentReply': { ko: '댓글 답글 (선택)', en: 'Comment Reply (optional)' },
  'dm.addReply': { ko: '답글 추가', en: 'Add Reply' },
  'dm.commentReplyHint': {
    ko: '입력해 두면 DM과 함께 각 댓글에 공개 답글이 달려요. 여러 개면 무작위로 하나가 달립니다.',
    en: 'If filled in, a public reply is posted on each comment along with the DM. With several, one is picked at random.',
  },
  'dm.replyPlaceholder': { ko: '예: DM 확인해주세요! 📩', en: 'e.g. Check your DMs! 📩' },
  'dm.contentRequired': {
    ko: '보낼 DM 내용이나 댓글 답글 중 하나는 입력해주세요.',
    en: 'Enter a DM message or a comment reply to send.',
  },
  'dm.send': { ko: '보내기', en: 'Send' },
  'dm.buttons': { ko: '버튼 링크', en: 'Link Buttons' },
  'dm.addButton': { ko: '버튼 추가', en: 'Add Button' },
  'dm.sendNow': { ko: '수동 발송하기', en: 'Send DM Now' },
  'dm.cancel': { ko: '취소', en: 'Cancel' },
  'dm.sending': { ko: '발송 중...', en: 'Sending...' },
  'dm.sentAlert': { ko: '보냈습니다!', en: 'Sent!' },
  'dm.sendSuccess': { ko: 'DM이 성공적으로 발송되었습니다!', en: 'DM sent successfully!' },
  'dm.sendFailed': { ko: 'DM 발송에 실패했습니다.', en: 'Failed to send DM.' },

  // Link Management
  'links.title': { ko: '포스트 & 상품 링크', en: 'Posts & Product Links' },
  'links.designTab': { ko: '디자인 & 블록', en: 'Design & Blocks' },
  'links.postsTab': { ko: '포스트 & 상품 링크', en: 'Posts & Product Links' },
  'links.addBlock': { ko: '+ 새 블록 추가', en: '+ Add New Block' },
  'links.manageFolders': { ko: '폴더 관리', en: 'Manage Folders' },
  'links.saveChanges': { ko: '변경사항 저장', en: 'Save Changes' },
  'links.preview': { ko: '미리보기', en: 'Preview' },
  'links.noBlocks': { ko: '등록된 링크가 없습니다. 새 블록을 추가해보세요!', en: 'No links registered yet. Add a new block!' },

  // General Buttons & Status
  'common.save': { ko: '저장', en: 'Save' },
  'common.close': { ko: '닫기', en: 'Close' },
  'common.confirm': { ko: '확인', en: 'Confirm' },
  'common.loading': { ko: '불러오는 중...', en: 'Loading...' },
  'common.active': { ko: '작동 중', en: 'Active' },
  'common.inactive': { ko: '중지됨', en: 'Inactive' },
  'common.proPlanNotice': { ko: '디엠 자동화는 프로 플랜 전용 기능이에요.', en: 'DM Automation is a Pro Plan exclusive feature.' },
  'common.language': { ko: '언어', en: 'Language' },
  'common.items': { ko: '개', en: 'items' },
};

const compiledPlatformTextPatterns = platformTextPatterns.map(pattern => ({
  expression: new RegExp(pattern.source),
  replacement: pattern.replacement,
}));

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('picks_language');
    return (saved === 'en' || saved === 'ko') ? saved : 'ko';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('picks_language', lang);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'ko' ? 'en' : 'ko');
  }, [language, setLanguage]);

  const t = useCallback((key: string, defaultKo?: string, defaultEn?: string): string => {
    const entry = translations[key];
    if (entry) {
      return language === 'en' ? entry.en : entry.ko;
    }
    if (language === 'en') {
      return defaultEn || defaultKo || key;
    }
    return defaultKo || defaultEn || key;
  }, [language]);

  const translatePlatformText = useCallback((value: string): string => {
    if (language !== 'en' || !/[가-힣]/.test(value)) return value;
    const leadingWhitespace = value.match(/^\s*/)?.[0] ?? '';
    const trailingWhitespace = value.match(/\s*$/)?.[0] ?? '';
    const normalized = value.replace(/\s+/g, ' ').trim();
    const translated = platformTextTranslations[normalized];
    if (translated) return `${leadingWhitespace}${translated}${trailingWhitespace}`;
    for (const pattern of compiledPlatformTextPatterns) {
      if (!pattern.expression.test(normalized)) continue;
      return `${leadingWhitespace}${normalized.replace(pattern.expression, pattern.replacement)}${trailingWhitespace}`;
    }
    return value;
  }, [language]);

  const contextValue = useMemo(() => ({
    language,
    setLanguage,
    toggleLanguage,
    t,
    translatePlatformText,
  }), [language, setLanguage, t, toggleLanguage, translatePlatformText]);

  return (
    <LanguageContext.Provider value={contextValue}>
      <PlatformLanguageBridge language={language} translatePlatformText={translatePlatformText} />
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
      translatePlatformText: value => value,
    };
  }
  return context;
};
