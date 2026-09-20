import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import PlatformLanguageBridge from '../components/PlatformLanguageBridge';
import { setDisplayLocale } from '../utils/formatters';

export type Language = 'ko' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, defaultKo?: string, defaultEn?: string) => string;
  translatePlatformText: (value: string) => string;
}

type PlatformTextPattern = {
  source: string;
  replacement: string;
};

type PatternGlue = {
  /** 왼쪽이 한글 글자에 공백 없이 맞닿아 있는 캡처 자리의 번호. */
  left: ReadonlySet<number>;
  /** 오른쪽이 한글 글자에 공백 없이 맞닿아 있는 캡처 자리의 번호. */
  right: ReadonlySet<number>;
};

type CompiledPlatformTextPattern = {
  expression: RegExp;
  replacement: string;
  glue: PatternGlue;
};

type PlatformTextBundle = {
  translations: Readonly<Record<string, string>>;
  patterns: readonly PlatformTextPattern[];
};

const HANGUL_PATTERN = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;

/** 캡처 안에 한글이 남았을 때 그 조각을 다시 번역해 보는 깊이 한계. */
const MAX_PLATFORM_TEXT_DEPTH = 4;

/**
 * 패턴에서 한글 글자에 공백 없이 맞닿아 있는 캡처 자리를 미리 찾아 둔다.
 *
 * `^(.+?)원$` 의 '원' 처럼 캡처 바로 옆에 붙은 한글은 단위 글자다. 이런 자리는
 * 숫자가 오는 것을 전제로 쓴 것이므로, 맞닿은 쪽에 한글이 들어오면 그것은
 * '3,000원' 의 숫자 자리가 아니라 낱말을 가운데서 자른 것이다.
 *
 * 패턴은 문자열로 들어오므로 여는 괄호 바로 앞과 닫는 괄호 바로 뒤 글자만 보면
 * 된다. 백슬래시로 escape 한 괄호(`\\(선택\\)`)와 문자 클래스(`[\\d,]`) 안쪽은
 * 캡처가 아니므로 건너뛴다.
 */
const findPatternGlue = (source: string): PatternGlue => {
  const left = new Set<number>();
  const right = new Set<number>();
  const openGroups: { index: number; start: number }[] = [];
  let groupCount = 0;
  let inCharacterClass = false;

  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '\\') {
      cursor += 1;
      continue;
    }
    if (inCharacterClass) {
      if (char === ']') inCharacterClass = false;
      continue;
    }
    if (char === '[') {
      inCharacterClass = true;
      continue;
    }
    if (char === '(') {
      groupCount += 1;
      openGroups.push({ index: groupCount, start: cursor });
      continue;
    }
    if (char === ')') {
      const group = openGroups.pop();
      if (!group) continue;
      if (HANGUL_PATTERN.test(source[group.start - 1] ?? '')) left.add(group.index);
      if (HANGUL_PATTERN.test(source[cursor + 1] ?? '')) right.add(group.index);
    }
  }

  return { left, right };
};

const applyReplacement = (replacement: string, groups: readonly string[]) => (
  replacement.replace(/\$(\d)/g, (token, digit: string) => {
    const group = groups[Number(digit) - 1];
    return group === undefined ? token : group;
  })
);

/**
 * 사전에 없는 문구를 패턴으로 옮긴다. 옮겼으면 영어 문구, 못했으면 null.
 *
 * 캡처한 조각을 그대로 끼워 넣으면 '광고 현황' 이 'Ad 현황' 처럼 반만 영어가
 * 된다. 그래서 조각에 한글이 남아 있으면 그 조각을 한 번 더 번역해서 끼운다.
 * 사전에 없는 조각은 한글로 남지만, 그건 대개 사람 이름이나 캠페인 제목처럼
 * 사용자가 적은 값이므로 그대로 두는 것이 맞다.
 *
 * 한 글자만 남은 조각은 다시 번역하지 않는다. 홀로 놓인 한 음절은 무엇을
 * 가리키는지 알 수 없어서 — '금' 은 요일이기도 금속이기도 하다 — 사전을 찾으면
 * 십중팔구 엉뚱한 낱말이 나온다. '10월 4일 (금)' 이 '(Gold)' 가 되는 식이다.
 */
export const translateNormalizedPlatformText = (
  normalized: string,
  translations: Readonly<Record<string, string>>,
  patterns: readonly CompiledPlatformTextPattern[],
  depth = 0,
): string | null => {
  const exact = translations[normalized];
  if (exact) return exact;
  if (depth >= MAX_PLATFORM_TEXT_DEPTH) return null;

  for (const pattern of patterns) {
    const match = normalized.match(pattern.expression);
    if (!match) continue;

    const resolved: string[] = [];
    let splitsAWord = false;

    for (let index = 1; index < match.length; index += 1) {
      const captured = match[index] ?? '';
      const trimmed = captured.trim();

      /**
       * 단위 글자와 맞닿은 쪽에 한글이 왔으면 이 패턴은 낱말을 자르고 있다.
       *
       * '강원' 을 `^(.+?)원$` 으로 읽으면 '강 KRW', '경기·인천' 을 `^(.+?)천$`
       * 으로 읽으면 '경기·인 thousand' 가 된다. 그럴 때는 이 패턴을 버리고 다음
       * 패턴을 보고, 끝까지 맞는 것이 없으면 한국어를 그대로 둔다. 반쯤 옮겨 놓은
       * '강 KRW' 보다 한국어 '강원' 이 읽을 수 있는 화면이다.
       *
       * 조각을 먼저 번역해 보고 판단하면 안 된다. '브랜드 회원' 의 '브랜드 회' 는
       * 'Brand times' 로 옮겨져 한글이 사라지므로, 낱말을 자른 자리가 멀쩡한
       * 영어로 위장한 채 통과한다.
       */
      if (pattern.glue.left.has(index) && HANGUL_PATTERN.test(trimmed.slice(0, 1))) {
        splitsAWord = true;
        break;
      }
      if (pattern.glue.right.has(index) && HANGUL_PATTERN.test(trimmed.slice(-1))) {
        splitsAWord = true;
        break;
      }

      let piece = captured;
      if (HANGUL_PATTERN.test(captured) && trimmed.length > 1 && trimmed !== normalized) {
        const inner = translateNormalizedPlatformText(
          trimmed.replace(/\s+/g, ' '),
          translations,
          patterns,
          depth + 1,
        );
        if (inner) piece = inner;
      }
      resolved.push(piece);
    }

    if (splitsAWord) continue;
    return applyReplacement(pattern.replacement, resolved);
  }

  return null;
};

export const compilePlatformTextPatterns = (
  patterns: readonly PlatformTextPattern[],
): CompiledPlatformTextPattern[] => patterns.map(pattern => ({
  expression: new RegExp(pattern.source),
  replacement: pattern.replacement,
  glue: findPatternGlue(pattern.source),
}));

let platformTextBundlePromise: Promise<PlatformTextBundle> | null = null;

const loadPlatformTextBundle = () => {
  if (!platformTextBundlePromise) {
    platformTextBundlePromise = Promise.all([
      import('./platformTextTranslations'),
      import('./platformTextPatterns'),
    ]).then(([translationsModule, patternsModule]) => ({
      translations: translationsModule.platformTextTranslations,
      patterns: patternsModule.platformTextPatterns,
    }));
  }
  return platformTextBundlePromise!;
};

const translations: Record<string, { ko: string; en: string }> = {
  // Navigation & Header
  'nav.home': { ko: '홈', en: 'Home' },
  'nav.dashboard': { ko: '대시보드', en: 'Dashboard' },
  'nav.links': { ko: '링크 관리', en: 'Links' },
  'nav.manage': { ko: '관리', en: 'Manage' },
  'nav.dmAutomation': { ko: 'DM 자동화', en: 'DM Automation' },
  'nav.insights': { ko: '인사이트', en: 'Insights' },
  // 캠페인은 새 캠페인을 찾아 지원하는 자리, 협업 캠페인은 선정된 캠페인을 굴리는
  // 자리다. 둘 다 '캠페인'으로 부르던 때에는 진행하러 들어온 사람이 남의
  // 캠페인 목록에서 자기 캠페인을 찾아야 했다.
  'nav.campaigns': { ko: '캠페인', en: 'Campaigns' },
  'nav.myCollabs': { ko: '협업 캠페인', en: 'Collab Campaigns' },
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
  /* 모바일 아래 막대용 짧은 이름. 막대는 가로로 넘겨 보는 한 줄이라 칸 하나에
     들어가는 글자 수가 얼마 안 된다 — 사이드바의 긴 이름('비즈니스 수신함',
     '협업 타임라인')을 그대로 쓰면 칸 두세 개 너비를 혼자 차지해서, 한 화면에
     보이는 메뉴가 두 개로 줄어든다. */
  'nav.barDm': { ko: '자동DM', en: 'DM' },
  'nav.barCollabs': { ko: '협업', en: 'Collabs' },
  'nav.barInbox': { ko: '수신함', en: 'Inbox' },
  'nav.barTimeline': { ko: '타임라인', en: 'Timeline' },
  'nav.barCalendar': { ko: '협업현황', en: 'Calendar' },
  'nav.barSchedule': { ko: '오픈일정', en: 'Schedule' },
  'nav.barMembership': { ko: '멤버십', en: 'Plan' },
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
  'dash.collabCTA': { ko: '🤝 캠페인 지원하기', en: '🤝 Find Campaigns' },
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
  // 수동 발송 결과는 '완료' 한 줄이다. 건수·중복 건너뜀 같은 집계 문장은
  // 보내는 사람이 조치할 것이 없는데도 발송이 잘못된 것처럼 읽혀서 쓰지 않는다.
  'dm.sendDone': { ko: '완료', en: 'Done' },
  'dm.sendPartialFailed': {
    ko: '일부 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    en: 'Some messages failed to send. Please try again in a moment.',
  },
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

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('picks_language');
      return (saved === 'en' || saved === 'ko') ? saved : 'ko';
    } catch {
      return 'ko';
    }
  });
  const [platformTextBundle, setPlatformTextBundle] = useState<PlatformTextBundle | null>(null);

  /**
   * 금액 서식을 이 렌더 전에 맞춰 둔다.
   *
   * effect 로 미루면 언어를 바꾼 직후 한 번은 옛 표기로 그려지고, 다시 그릴
   * 일이 없으면 '3,000만원' 이 영어 화면에 그대로 남는다. 자식보다 먼저 도는
   * 이 자리에서 맞춰 두면 같은 렌더에서 올바른 표기가 나온다.
   */
  setDisplayLocale(language);

  useEffect(() => {
    if (language !== 'en' || platformTextBundle) return;
    let cancelled = false;
    loadPlatformTextBundle()
      .then(bundle => {
        if (!cancelled) setPlatformTextBundle(bundle);
      })
      .catch(error => {
        console.warn('[Language] Failed to load platform translations:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [language, platformTextBundle]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try { localStorage.setItem('picks_language', lang); } catch {}
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

  const compiledPlatformTextPatterns = useMemo(
    () => compilePlatformTextPatterns(platformTextBundle?.patterns || []),
    [platformTextBundle],
  );

  /**
   * 문구 하나를 번역한 결과를 기억해 둔다. 못 옮긴 문구는 null 로 기억한다.
   *
   * 화면 문구는 DOM 이 바뀔 때마다 다시 들어오고, 같은 문구가 목록 줄 수만큼
   * 반복된다. 패턴이 400 개가 넘는데 캡처까지 다시 번역하므로, 기억해 두지 않으면
   * 목록을 그릴 때마다 같은 계산을 되풀이한다. 못 옮긴 문구가 가장 비싸다 —
   * 패턴을 끝까지 다 보고 나서야 없다는 것을 알기 때문이다.
   */
  const platformTextCache = useMemo(() => new Map<string, string | null>(), [compiledPlatformTextPatterns]);

  const translatePlatformText = useCallback((value: string): string => {
    if (language !== 'en' || !HANGUL_PATTERN.test(value)) return value;
    const leadingWhitespace = value.match(/^\s*/)?.[0] ?? '';
    const trailingWhitespace = value.match(/\s*$/)?.[0] ?? '';
    const normalized = value.replace(/\s+/g, ' ').trim();

    let translated = platformTextCache.get(normalized);
    if (translated === undefined) {
      translated = translateNormalizedPlatformText(
        normalized,
        platformTextBundle?.translations || {},
        compiledPlatformTextPatterns,
      );
      platformTextCache.set(normalized, translated);
    }
    if (translated === null) return value;

    return `${leadingWhitespace}${translated}${trailingWhitespace}`;
  }, [compiledPlatformTextPatterns, language, platformTextBundle, platformTextCache]);

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
