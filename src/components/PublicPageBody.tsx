import React from 'react';
import { ExternalLink, Briefcase, Search, Hash } from 'lucide-react';
import { Block, BlockDisplayType, DesignSettings, TemplateType, OpenScheduleItem } from '../types';
import { enabledDefaultButtons } from '../utils/pageButtons';
import PlatformLogo from './PlatformLogo';
import SafeImage from './SafeImage';
import MediaAuto from './MediaAuto';
import { renderPortfolioHtml } from './richText';
import { externalLinkProps, openExternalUrl } from '../utils/externalLink';
import { categoryChipStyle, normalizeHexColor, themeBackgroundOf, themeIsDark } from '../utils/themeColor';

/**
 * 개인페이지의 본문 한 벌.
 *
 * 예전에는 이 화면이 두 곳에 따로 적혀 있었다 — 방문자가 보는 공개 페이지
 * (UserPage)와, 편집 화면 오른쪽 폰 안의 미리보기(PagePreview)다. 미리보기는
 * 폰 크기에 맞춰 글자와 여백을 손으로 줄여 놓은 별개의 구현이라, 공개 페이지를
 * 고칠 때마다 한쪽만 고쳐졌다. 그래서 미리보기에는 있는데 실제 페이지에는 없는
 * 머리글("My Curations")이 남고, 검색바 자리가 뒤바뀌고, 배경색도 서로 달랐다
 * (미리보기 #1E1E2E · 실제 #050a15).
 *
 * 지금은 두 화면이 이 한 파일을 함께 그린다. 미리보기는 폰 프레임 안(약 373px)에
 * 들어가므로 `compact` 로 데스크톱 변형(`md:`)만 쓰지 않는다 — 좁은 폰에서 보이는
 * 그 화면이 그대로 미리보기에 나온다. 글자 크기·여백·순서를 따로 정하는 곳은 더
 * 이상 없다.
 */

export const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1080&q=70';

/**
 * 아직 고르지 않은 디자인 값.
 *
 * 공개 페이지는 저장된 디자인을 이 값 위에 얹어 그린다. 그래서 미리보기도 같은
 * 값 위에 얹어야 한다 — 예전에는 미리보기가 저장된 값만 그렸고, 저장된 값에 없는
 * 칸(커버 색 portfolioHeaderColor 등)은 비어 있는 것으로 봤다. 커버 사진을 아직
 * 올리지 않은 페이지에서 실제 화면은 파란 그라데이션인데 미리보기에는 기본 사진이
 * 깔려 있던 이유다.
 */
export const DEFAULT_PUBLIC_DESIGN: DesignSettings = {
  templateType: TemplateType.SHOPPABLE_GRID,
  theme: 'white',
  accentColor: '#2563EB',
  borderRadius: 'full',
  gridGap: 1,
  gridColumns: 2,
  gridStyle: 'magazine',
  fontFamily: 'Sans',
  buttonStyle: 'solid',
  backgroundType: 'solid',
  customGradient: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
  portfolioHeaderColor: 'linear-gradient(135deg, #2563EB 0%, #4f46e5 100%)',
  profileLayout: 'center',
  homePriority: 'curation',
};

export interface AboutSection {
  id: string;
  title: string;
  content: string;
}

export interface PublicPageProfile {
  full_name?: string;
  bio?: string;
  avatar_url?: string;
  aboutSections?: AboutSection[];
}

/** Supabase 의 link_grid_items 로 들어오는 추천 링크. */
export interface FeaturedLink {
  id: string;
  title: string;
  url: string;
  image?: string;
  category?: string;
}

interface PublicPageBodyProps {
  design: DesignSettings;
  profile: PublicPageProfile | null;
  socials: Record<string, any> | null | undefined;
  blocks: Block[];
  /** 블록에 아직 쓰이지 않은 카테고리까지 포함한 목록. */
  linkGridCategories?: string[];
  openSchedule?: OpenScheduleItem[];
  featuredLinks?: FeaturedLink[];
  /** 비즈니스 제안 버튼이 가는 주소. */
  proposalHref: string;
  language?: string;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  searchQuery: string;
  onSearchQuery: (query: string) => void;
  /** 카드를 눌렀을 때. 상품 서랍은 이 컴포넌트 밖에서 그린다. */
  onSelectBlock: (blockId: string) => void;
  onTrackClick?: (blockId: string) => void;
  /**
   * 폰 프레임 안에 그리는 중인가.
   *
   * 미리보기는 데스크톱 화면에 있지만 폰 폭으로 그려진다. `md:` 변형을 그대로 두면
   * 창 크기를 보고 데스크톱 쪽 값이 걸려서 — 373px 칸에 데스크톱 여백이 들어가
   * 실제 페이지와 어긋난다. 클래스 문자열은 그대로 적어 두고(Tailwind 가 훑어야
   * 한다) 이 깃발이 서면 넘기지 않는다.
   */
  compact?: boolean;
  /** 본문 아래에 함께 그릴 것(푸터 · 상품 서랍 등). */
  children?: React.ReactNode;
}

const PublicPageBody: React.FC<PublicPageBodyProps> = ({
  design,
  profile,
  socials,
  blocks,
  linkGridCategories = [],
  openSchedule = [],
  featuredLinks = [],
  proposalHref,
  language,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  onSearchQuery,
  onSelectBlock,
  onTrackClick,
  compact = false,
  children,
}) => {
  /** 데스크톱 변형을 쓸 자리인지. 미리보기(폰 프레임)에서는 통째로 빠진다. */
  const w = (cls: string) => (compact ? '' : cls);

  const categories = React.useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const b of blocks) {
      const c = b.category;
      if (c && !seen.has(c)) { seen.add(c); ordered.push(c); }
    }
    for (const c of linkGridCategories) {
      if (!seen.has(c)) { seen.add(c); ordered.push(c); }
    }
    return ['전체', ...ordered];
  }, [blocks, linkGridCategories]);

  const filteredBlocks = React.useMemo(() => {
    let result = blocks;
    if (selectedCategory !== '전체') {
      result = result.filter(b => b.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(b =>
        b.title?.toLowerCase().includes(q) ||
        b.products?.some(p => p.name?.toLowerCase().includes(q))
      );
    }
    return result;
  }, [blocks, selectedCategory, searchQuery]);

  const orderedCategoryGroups = React.useMemo(() => {
    if (selectedCategory !== '전체') return [];
    const seen = new Set<string>();
    const order: string[] = [];
    for (const b of filteredBlocks) {
      const cat = b.category || '';
      if (!seen.has(cat)) { seen.add(cat); order.push(cat); }
    }
    return order.map(cat => ({
      category: cat,
      blocks: filteredBlocks.filter(b => (b.category || '') === cat),
    }));
  }, [filteredBlocks, selectedCategory]);

  /**
   * 실제로 그릴 묶음. 카테고리를 고르지 않았으면 카테고리별로 나눠 그리고, 골랐으면
   * 그 카테고리의 카드만 한 묶음으로 그린다.
   */
  const displayGroups = React.useMemo(
    () => (selectedCategory === '전체' && orderedCategoryGroups.length > 0
      ? orderedCategoryGroups
      : [{ category: '', blocks: filteredBlocks }]),
    [selectedCategory, orderedCategoryGroups, filteredBlocks],
  );

  const activeScheduleItems = React.useMemo(
    () => openSchedule.filter(item => item.isActive && new Date(item.date) >= new Date(new Date().toDateString())),
    [openSchedule],
  );

  /**
   * 카드 전체가 눌리는 자리(일정 블록처럼 `<a>` 로 감쌀 수 없는 곳)에서만 쓴다.
   * 링크로 그릴 수 있는 버튼은 externalLinkProps 로 진짜 `<a>` 를 만든다 —
   * 스크립트로 새 탭을 여는 건 팝업으로 취급돼 조용히 막히기 때문이다.
   */
  const openLink = (url: string) => {
    openExternalUrl(url);
  };

  const fontClass = design.fontFamily === 'Serif'
    ? 'font-serif tracking-tight'
    : design.fontFamily === 'Mono'
      ? 'font-mono uppercase tracking-tighter'
      : 'font-sans tracking-tight';

  // 배경과 명암은 utils/themeColor 한 곳에서 정한다. 자유 배경(theme: 'custom')은
  // 고른 색의 밝기로 어두운 테마인지를 판단하므로, 크림색을 골라도 글자가 검게 나온다.
  const themeBg = themeBackgroundOf(design);
  const isDark = themeIsDark(design);
  /**
   * 커버 사진 아래를 배경색으로 자연스럽게 녹이는 그라데이션.
   *
   * 배경이 색으로 읽히지 않는 값(예전 커스텀 배경의 `linear-gradient(...)`)이면
   * 알파를 붙인 문자열이 CSS 에서 통째로 무효가 되어 덮개가 사라진다. 색으로
   * 읽히는 값만 쓰고, 아니면 테마 명암에 맞는 색으로 대체한다.
   */
  const coverFadeHex = normalizeHexColor(themeBg) || (isDark ? '#050A15' : '#FFFFFF');
  const coverFade = `linear-gradient(to top, ${coverFadeHex} 0%, ${coverFadeHex}88 15%, transparent 50%)`;
  /**
   * 커버 사진이 뜨기 전에 그 자리를 채우는 배경. 사진이 있는 페이지는 테마 배경색으로
   * 두어(기본 design 의 파란 그라데이션이 한 번 스치지 않게) 사진이 스며들게 한다.
   */
  const coverPlaceholder = design.portfolioHeaderImage
    ? coverFadeHex
    : design.portfolioHeaderColor || 'linear-gradient(135deg, #2563EB 0%, #4f46e5 100%)';
  const textColor = isDark ? 'text-white' : 'text-slate-900';
  const subTextColor = isDark ? 'text-white/60' : 'text-slate-500';

  /** 선과 그림자는 메인 홈페이지와 같은 것을 쓴다(카드 · 버튼 · 검색줄 공통). */
  const hairline = isDark ? 'border-white/15' : 'border-[#0B0F1A]/10';
  const softShadow = isDark
    ? 'shadow-[0_12px_28px_-18px_rgba(0,0,0,0.75)]'
    : 'shadow-[0_12px_28px_-18px_rgba(11,15,26,0.45)]';

  /**
   * 카테고리 버튼. 홈의 알약 버튼과 같은 규격이다 — 흰 바탕, 머리카락 선, 아래로
   * 옅게 깔리는 그림자. 색을 직접 고른 페이지는 categoryChipStyle 이 배경·글자·선색을
   * 인라인으로 덮어쓰므로, 여기서 정하는 것은 고르지 않았을 때의 기본값이다.
   */
  const categoryChipClass = (active: boolean) => [
    'shrink-0 px-4 py-2 text-[11px] font-black whitespace-nowrap rounded-full border transition-all duration-200 active:scale-95',
    active
      ? 'text-white border-transparent shadow-[0_10px_22px_-12px_rgba(11,15,26,0.6)]'
      : isDark
        ? 'bg-white/[0.07] border-white/15 text-white/70 hover:bg-white/[0.12] hover:border-white/25'
        : 'bg-white border-[#0B0F1A]/10 text-[#39415C] shadow-[0_2px_8px_-5px_rgba(11,15,26,0.4)] hover:border-[#0B0F1A]/20 hover:shadow-[0_8px_18px_-10px_rgba(11,15,26,0.45)]',
  ].join(' ');

  /**
   * 상품명 검색바를 보여 줄지.
   *
   * 편집기의 버튼 칸에서 끌 수 있다. 끈 상태만 저장되므로(hideSearchBar), 예전에
   * 저장된 페이지에는 이 값이 없고 검색바는 지금까지처럼 그대로 나온다. 끄면 두
   * 레이아웃(포트폴리오 · 큐레이션) 양쪽에서 함께 사라진다.
   */
  const showSearchBar = !socials?.hideSearchBar;

  /**
   * 상단 커버와 카테고리 버튼 사이를 좁게 둘지.
   *
   * 검색바를 끈 페이지에서는 그 사이가 빈 채로 넓게 남았다 — 버튼도 소개도 없는
   * 페이지라면 커버 사진 아래로 아무것도 없는 띠가 70px 가까이 이어졌다. 검색바가
   * 없을 때만 그 여백을 절반으로 줄인다(켜 둔 페이지는 지금까지와 같은 간격이다).
   */
  const tightTopGap = !showSearchBar;

  const defaultButtons = enabledDefaultButtons(socials);
  const customButtons: any[] = (socials?.customButtons || []).filter(
    (b: any) => b.label?.trim() && b.url?.trim()
  );
  /**
   * 버튼 줄을 그릴 만한 버튼이 하나라도 있는지.
   *
   * 예전에는 버튼이 하나도 없어도 줄 자체는 그려져서, 위아래 여백만 남은 빈 칸이
   * 커버 사진과 카테고리 버튼 사이에 끼어 있었다.
   */
  const hasActionButtons = !!socials?.businessProposal || defaultButtons.length > 0 || customButtons.length > 0;

  /**
   * 기본 버튼(카카오톡 · 유튜브 · 틱톡 · 네이버) · 비즈니스 제안 · 커스텀 버튼.
   *
   * 두 레이아웃(포트폴리오 · 큐레이션)이 같은 조각을 쓴다 — 예전에 버튼 줄을 두 곳에
   * 따로 적어 두었더니 한쪽만 고쳐져서 레이아웃을 바꾸면 버튼이 달라지는 일이 있었다.
   *
   * 기본 버튼 바탕은 일부러 심심하게 둔다. 강조색(accentColor)은 비즈니스 제안 버튼
   * 하나만 쓰고, 나머지는 테마에 맞춘 흰/투명 배경 + 얇은 선으로만 구분한다. 대신
   * 이름 앞에 플랫폼 로고를 붙인다(components/PlatformLogo).
   */
  const actionButtons = (
    <>
      {socials?.businessProposal && (
        <a {...externalLinkProps(proposalHref)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-bold hover:brightness-110 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-95 transition-all duration-200 shadow-sm whitespace-nowrap shrink-0 cursor-pointer" style={{ backgroundColor: normalizeHexColor(socials?.businessProposalBg) || design.accentColor, color: normalizeHexColor(socials?.businessProposalText) || '#FFFFFF' }}>
          <Briefcase size={14} strokeWidth={2.5} />
          {language === 'en' ? 'Business Proposal' : '비즈니스 제안'}
        </a>
      )}
      {defaultButtons.map(btn => (
        <a
          key={btn.key}
          {...externalLinkProps(btn.url)}
          className={`flex items-center px-4 py-2.5 rounded-xl text-xs font-bold border transition-all duration-200 whitespace-nowrap shrink-0 cursor-pointer hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${softShadow} ${
            isDark
              ? 'bg-white/[0.07] border-white/15 text-white hover:bg-white/[0.12] hover:border-white/25'
              : 'bg-white border-[#0B0F1A]/10 text-[#39415C] hover:border-[#0B0F1A]/20'
          }`}
          /* 색을 직접 고른 버튼만 인라인으로 덮어쓴다 — 고르지 않았으면 위의 테마 색 그대로. */
          style={{
            backgroundColor: normalizeHexColor(btn.bg) || undefined,
            color: normalizeHexColor(btn.text) || undefined,
            borderColor: btn.bg ? 'transparent' : undefined,
          }}
        >
          <PlatformLogo platform={btn.key} size={16} className="mr-2" />
          {btn.label}
        </a>
      ))}
      {customButtons.map((btn: any) => (
        <a key={btn.id} {...externalLinkProps(btn.url)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-bold hover:brightness-110 transition-all shadow-sm whitespace-nowrap shrink-0" style={{ backgroundColor: btn.color || '#2563EB', color: normalizeHexColor(btn.textColor) || '#FFFFFF' }}>
          <ExternalLink size={14} strokeWidth={2.5} />
          {btn.label}
        </a>
      ))}
    </>
  );

  /**
   * 커버 사진 위, 이름 아래의 한 줄 소개. 비어 있으면 아무것도 그리지 않는다 —
   * 적지 않은 사람의 페이지에 시스템 문구가 뜨면 지울 방법이 없었다.
   */
  const bioLine = (profile?.bio || '').trim() ? (
    <p className={`font-black uppercase tracking-[0.3em] ${
      design.portfolioFontSize === 'small' ? 'text-[8px]' :
      design.portfolioFontSize === 'large' ? 'text-sm' :
      'text-[10px]'
    }`} style={{ color: design.accentColor }}>{profile?.bio}</p>
  ) : null;

  /**
   * 커버 사진 위에 얹히는 이름 · 소개 묶음. 이름도 소개와 같다 — 적지 않았으면
   * 아무것도 그리지 않고, 둘 다 비면 이 자리는 통째로 사라져 커버 사진만 남는다.
   */
  const coverIdentity = ((profile?.full_name || '').trim() || (profile?.bio || '').trim()) ? (
    <div className="absolute bottom-6 left-6 right-6">
      {(profile?.full_name || '').trim() && (
        <h3 className={`text-2xl ${w('md:text-3xl')} font-black tracking-tighter mb-1 ${textColor}`}>{profile?.full_name}</h3>
      )}
      {bioLine}
    </div>
  ) : null;

  const visibleAboutSections = (profile?.aboutSections || []).filter(
    s => (s.title || '').trim() || (s.content || '').trim()
  );
  const aboutSectionsBlock = visibleAboutSections.length > 0 ? (
    <div className="mt-6 space-y-2">
      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] px-2" style={{ color: design.accentColor }}>About</h4>
      <div className="space-y-2">
        {visibleAboutSections.map(section => (
          <details
            key={section.id}
            className={`group rounded-xl border transition-all ${hairline} ${isDark ? 'bg-white/[0.06]' : 'bg-white/90'}`}
          >
            <summary className={`flex items-center justify-between cursor-pointer px-4 py-3 list-none ${textColor}`}>
              <span className="text-xs font-black truncate pr-3">{section.title || '소개'}</span>
              <svg className="w-3 h-3 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <div className={`px-4 pb-4 -mt-1 text-xs font-medium whitespace-pre-wrap ${subTextColor}`} style={{ lineHeight: 1.75 }}>
              {section.content}
            </div>
          </details>
        ))}
      </div>
    </div>
  ) : null;

  /** 오픈 일정. 두 레이아웃이 같은 조각을 쓴다(감싸는 칸의 여백만 다르다). */
  const scheduleItemsBlock = (
    <div className="space-y-1.5">
      {activeScheduleItems.map(item => (
        <div
          key={item.id}
          className={`rounded-xl px-3 py-2.5 border transition-all ${hairline} ${isDark ? 'bg-white/[0.06]' : 'bg-white/90'}`}
          onClick={() => item.link && openLink(item.link)}
          style={{ cursor: item.link ? 'pointer' : 'default' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 text-white font-black" style={{ backgroundColor: design.accentColor }}>
              <div className="text-center leading-none">
                <div className="text-[13px] font-black">{new Date(item.date).getDate()}</div>
                <div className="text-[7px] uppercase opacity-80 mt-0.5">{new Date(item.date).toLocaleString('ko-KR', { month: 'short' })}</div>
              </div>
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <h5 className={`text-xs font-black truncate ${textColor}`}>{item.title}</h5>
              <span className={`text-xs font-bold truncate whitespace-nowrap ${subTextColor}`}>
                {new Date(item.date).toLocaleDateString('ko-KR', { weekday: 'short', month: 'long', day: 'numeric' })}{item.time ? ` ${item.time}` : ''}
              </span>
              {item.description && <p className={`text-[9px] font-medium mt-0.5 truncate ${subTextColor}`}>{item.description}</p>}
            </div>
            {item.link && (
              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${design.accentColor}20` }}>
                <ExternalLink size={9} style={{ color: design.accentColor }} />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  /** 상품명 검색줄. 좁은 화면에서는 한 단계 얇게 둔다(py-2.5). */
  const searchBarRow = (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${w('md:py-3')} rounded-2xl border transition-all ${hairline} ${softShadow} ${isDark ? 'bg-white/[0.06] focus-within:border-white/30' : 'bg-white focus-within:border-[#0B0F1A]/25'}`}>
      <Search size={16} className={`flex-shrink-0 ${isDark ? 'text-white/40' : 'text-slate-400'}`} />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchQuery(e.target.value)}
        placeholder="상품명 검색..."
        className={`flex-1 bg-transparent text-sm font-medium outline-none placeholder:opacity-50 ${isDark ? 'text-white placeholder:text-white/40' : 'text-slate-900 placeholder:text-slate-400'}`}
      />
      {searchQuery && (
        <button onClick={() => onSearchQuery('')} className={`text-xs font-black px-2 py-1 rounded-lg transition-all ${isDark ? 'bg-white/10 text-white/60 hover:bg-white/20' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
          ✕
        </button>
      )}
    </div>
  );

  const categoryChipsRow = categories.map(cat => (
    <button
      key={cat}
      onClick={() => onSelectCategory(cat)}
      className={categoryChipClass(selectedCategory === cat)}
      style={categoryChipStyle(design, selectedCategory === cat, design.accentColor)}
    >
      {cat}
    </button>
  ));

  /** 카테고리 이름 줄(카테고리를 고르지 않았을 때 묶음마다 하나). */
  const groupHeading = (category: string, count: number, topPad: string) => (
    <div className={`flex items-center gap-3 ${topPad} pb-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>
      <Hash size={14} style={{ color: design.accentColor }} />
      <span className="text-sm font-black uppercase tracking-wider">{category}</span>
      <span className={`text-[10px] font-bold ${isDark ? 'text-white/30' : 'text-slate-400'}`}>{count}</span>
      <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-[#0B0F1A]/10'}`} />
    </div>
  );

  /** 카드 한 장(그리드 · 최소 · 텍스트). 두 레이아웃이 같은 카드를 쓴다. */
  const renderBlockCard = (block: Block) => {
    const colSpanVal = block.displayType === 'grid' ? (block.colSpan || 1) : 1;
    const gridSpan = colSpanVal === 1 ? 6 : colSpanVal === 2 ? 3 : 2;
    const blockDisplay: BlockDisplayType = block.displayType || 'grid';

    if (blockDisplay === 'text') {
      return (
        <div
          key={block.id}
          className={`relative overflow-hidden group transition-all flex flex-col justify-center p-4 ${w('md:p-6')} min-w-0`}
          style={{
            gridColumn: `span ${gridSpan}`,
            borderRadius: design.borderRadius === 'none' ? '0' : '1rem',
            minHeight: '80px',
            backgroundColor: (block.highlight && block.highlight !== 'transparent') ? block.highlight : undefined,
          }}
        >
          {block.textContent ? (
            <div
              className="leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-w-full overflow-hidden [&_*]:max-w-full [&_*]:break-words [&_*]:[overflow-wrap:anywhere]"
              style={{
                fontSize: `${block.fontSizePx || 14}px`,
                fontWeight: block.bold ? 'bold' : undefined,
                fontStyle: block.italic ? 'italic' : undefined,
                textDecoration: [block.underline ? 'underline' : '', block.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
                color: block.color || (isDark ? 'rgba(255,255,255,0.8)' : '#37352f'),
              }}
              dangerouslySetInnerHTML={{ __html: renderPortfolioHtml(block.textContent) }}
            />
          ) : (
            <div className={`text-sm opacity-50 ${isDark ? 'text-white/40' : 'text-slate-300'}`}>텍스트를 입력하세요</div>
          )}
        </div>
      );
    }

    if (blockDisplay === 'minimal') {
      return (
        <div
          key={block.id}
          onClick={() => { onSelectBlock(block.id); onTrackClick?.(block.id); }}
          className={`relative flex items-center min-h-[64px] px-5 py-3 group cursor-pointer transition-all active:scale-[0.98] border ${hairline} ${softShadow} ${isDark ? 'bg-white/[0.07]' : 'bg-white'}`}
          style={{
            gridColumn: `span ${gridSpan}`,
            borderRadius: design.borderRadius === 'none' ? '0' : '1rem'
          }}
        >
          {block.coverMedia && (
            <div className={`absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 overflow-hidden shrink-0 ${design.borderRadius === 'none' ? '' : 'rounded-xl'} border ${hairline}`}>
              <MediaAuto
                src={block.coverMedia || FALLBACK_IMAGE}
                className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                style={block.coverMediaPosition ? { objectPosition: `${block.coverMediaPosition.x}% ${block.coverMediaPosition.y}%` } : undefined}
              />
            </div>
          )}
          <div className="w-full min-w-0 text-center px-14">
            <div className={`text-[13px] font-semibold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>{block.title}</div>
          </div>
          {(block.products?.length || 0) > 0 && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <span className="bg-black/60 backdrop-blur-md text-[10px] font-black px-2 py-1 rounded-lg text-white border border-white/10 shadow-lg">{block.products.length}</span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={block.id}
        onClick={() => { onSelectBlock(block.id); onTrackClick?.(block.id); }}
        className={`relative overflow-hidden group cursor-pointer transition-all active:scale-[0.98] border ${hairline} ${softShadow} aspect-square`}
        style={{
          gridColumn: `span ${gridSpan}`,
          borderRadius: design.borderRadius === 'none' ? '0' : '1rem'
        }}
      >
        <MediaAuto src={block.coverMedia || FALLBACK_IMAGE} className="w-full h-full object-cover opacity-90 transition-transform duration-1000 group-hover:scale-105" style={block.coverMediaPosition ? { objectPosition: `${block.coverMediaPosition.x}% ${block.coverMediaPosition.y}%` } : undefined} />
        <div className="absolute top-3 right-3">
          <span className="bg-black/60 backdrop-blur-md text-[10px] font-black px-2 py-1 rounded-lg text-white border border-white/10 shadow-lg">{block.products?.length || 0}</span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
          <div className="text-xs font-black truncate text-white uppercase tracking-tight">{block.title}</div>
          <div className="text-[9px] font-bold text-white/50 uppercase tracking-widest mt-0.5">{block.category}</div>
        </div>
      </div>
    );
  };

  /** 목록형(LINK_LIST) 한 줄. */
  const renderProductRow = (block: Block) => (
    (block.products || []).map(p => (
      <a
        key={p.id}
        {...externalLinkProps(p.link)}
        onClick={() => onTrackClick?.(block.id)}
        className={`w-full flex items-center justify-between p-4 group cursor-pointer border transition-all hover:scale-[1.01] ${hairline} ${softShadow} ${isDark ? 'bg-white/[0.07] hover:bg-white/[0.12] hover:border-white/25' : 'bg-white hover:border-[#0B0F1A]/20'}`}
        style={{ borderRadius: design.borderRadius === 'none' ? '0' : design.borderRadius === 'md' ? '1rem' : '2rem' }}
      >
        <div className="flex items-center gap-4 flex-1 min-w-0 mr-4">
          <div className={`w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0 border ${hairline}`}>
            <MediaAuto src={p.image || (p as any).imageUrl || (p as any).manual_image_url || block.coverMedia || FALLBACK_IMAGE} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-black truncate">{p.name}</h4>
          </div>
        </div>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center opacity-100 ${w('md:opacity-20 md:group-hover:opacity-100')} transition-all shrink-0`} style={{ backgroundColor: design.accentColor, color: '#fff' }}>
          <ExternalLink size={12} />
        </div>
      </a>
    ))
  );

  const backgroundStyle = (design.background_image) ? {
    backgroundImage: `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url(${design.background_image})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed'
  } : { background: themeBg };

  /**
   * 가운데 칸 바깥(넓은 화면의 좌우 여백)에 깔리는 색.
   *
   * 배경색은 커버와 같은 폭까지만 칠하고 좌우 여백은 흰 종이로 둔다 — 커버의 좌우
   * 경계가 곧 배경색의 경계다. 폰 프레임 안(미리보기)은 그 바깥이 없으므로 칠하지
   * 않는다.
   */
  const pageCanvasStyle = compact ? undefined : { backgroundColor: '#FFFFFF' };

  return (
    <div
      className={`${compact ? 'userpage-preview' : 'min-h-screen userpage-root'} ${fontClass} ${textColor}`}
      style={pageCanvasStyle}
    >
      <div className={compact ? '' : 'min-h-screen'}>
        {/* 좌우 여백은 세 겹으로 겹쳐 있다 — 가운데 칸(px-3/md:px-6) · 큐레이션
            묶음(px-2) · 그리드 칸(px-1). 모바일 20px · 데스크톱 40px 로 맞춘다.
            카테고리 줄의 음수 마진(-mx-*)도 가운데 칸과 같은 값을 써야 칸 끝까지
            스크롤된다. */}
        <div
          className={`${compact ? 'w-full' : 'max-w-md md:max-w-2xl mx-auto min-h-screen'} flex flex-col relative px-3 ${w('md:px-6')}`}
          style={backgroundStyle}
        >

        {design.homePriority === 'portfolio' ? (
          /* PORTFOLIO LAYOUT */
          <div className="flex-1 flex flex-col">
            <div
              className={`relative aspect-[4/5] flex-shrink-0 -mx-3 ${w('md:-mx-6')}`}
              style={{ background: coverPlaceholder }}
            >
              {design.portfolioHeaderImage && (
                <MediaAuto
                  src={design.portfolioHeaderImage}
                  priority
                  fadeIn
                  width={1280}
                  className="w-full h-full object-cover"
                  style={{ objectPosition: `center ${design.portfolioHeaderImagePosition || '50'}%` }}
                />
              )}
              {/* 커버도 색도 정하지 않은 페이지의 기본 사진. 아래 큐레이션 커버와 같은
                  컴포넌트로 그린다 — 예전에는 이 한 곳만 SafeImage 라서, 같은 사진이
                  레이아웃에 따라 한쪽은 번쩍이고 한쪽은 스며들었다. */}
              {!design.portfolioHeaderImage && !design.portfolioHeaderColor && (
                <MediaAuto
                  src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1280&q=70"
                  priority
                  fadeIn
                  width={1280}
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-inherit via-transparent to-transparent" style={{ background: coverFade }}></div>
              {coverIdentity}
            </div>

            <div className={`px-2 ${w('md:px-4')} ${tightTopGap ? 'pt-2 pb-4' : 'pt-4 pb-8'} space-y-12`}>
              {/* Social & Contact Links */}
              {/* 버튼은 마우스를 올리면 2px 떠오르고 그림자가 생긴다. 이 줄에
                  overflow-x-auto 를 걸면(가로 스크롤을 켜면 세로도 함께 잘린다)
                  떠오른 만큼 위가 잘리고 그림자는 아래가 잘렸다 — 버튼 줄 바로 위가
                  상단 커버 사진이라 위쪽이 사진에 걸려 잘린 것처럼 보였다. 버튼은
                  flex-wrap 으로 이미 줄바꿈되니 가로 스크롤은 필요하지 않다.
                  버튼이 하나도 없으면 줄 자체를 그리지 않는다 — 빈 줄의 위아래
                  여백만 남아 커버와 카테고리 버튼 사이가 벌어졌다. */}
              {hasActionButtons && (
                <div className={`flex gap-2.5 ${tightTopGap ? 'pt-2 pb-1' : 'pt-4 pb-2'} justify-center flex-wrap`}>
                  {actionButtons}
                </div>
              )}

              {aboutSectionsBlock}

              {/* Open Schedule Section - Portfolio Layout */}
              {activeScheduleItems.length > 0 && (
                <div className="mt-6 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-[1px]" style={{ backgroundColor: design.accentColor }}></div>
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: design.accentColor }}>Upcoming Schedule</h4>
                  </div>
                  {scheduleItemsBlock}
                </div>
              )}

            </div>

            <div id="curation-section" className={`${tightTopGap ? 'pt-4' : 'pt-8'} px-1 ${w('md:px-2')}`}>
               <div className={`flex justify-between items-end ${tightTopGap ? 'mb-4' : 'mb-8'} px-1 ${w('md:px-2')}`}>
                 <div>
                   <h4 className="text-[10px] font-black uppercase tracking-[0.2em] mb-1" style={{ color: design.accentColor }}>My Curations</h4>
                   <h3 className="text-2xl font-black tracking-tighter">Explore My Picks</h3>
                 </div>
                 <div className="text-[10px] font-black opacity-30 uppercase tracking-widest">{filteredBlocks.length} Items</div>
               </div>

               {/* Product Search Bar */}
               {showSearchBar && (
                 <div className={`px-1 ${w('md:px-2')} mb-6`}>
                   {searchBarRow}
                 </div>
               )}

               <div className={`mb-7 py-1.5 overflow-x-auto scrollbar-hide flex gap-2 px-4 ${w('md:px-8')} -mx-3 ${w('md:-mx-6')}`}>
                 {categoryChipsRow}
               </div>

               {design.templateType === TemplateType.SHOPPABLE_GRID ? (
                 <div className={`w-full px-1 ${w('md:px-2')}`} style={{ paddingBottom: '100px' }}>
                   {displayGroups.map((group) => (
                     <div key={group.category || '__all'}>
                       {selectedCategory === '전체' && group.category && groupHeading(group.category, group.blocks.length, 'pt-6')}
                       <div
                         className="grid grid-flow-dense transition-all duration-500"
                         style={{
                           gridTemplateColumns: 'repeat(6, 1fr)',
                           gap: `${Math.max(design.gridGap, 4)}px`,
                         }}
                       >
                         {group.blocks.map(renderBlockCard)}
                       </div>
                     </div>
                   ))}
                  </div>
               ) : (
                <div className="flex flex-col gap-3 pb-32">
                  {displayGroups.map((group) => (
                    <div key={group.category || '__all'}>
                      {selectedCategory === '전체' && group.category && groupHeading(group.category, group.blocks.length, 'pt-5')}
                      {group.blocks.map(renderProductRow)}
                    </div>
                  ))}
                 </div>
               )}
            </div>

          </div>
        ) : (
          /* CURATION LAYOUT */
          <div className="flex-1 flex flex-col">
            {/* Large Cover Image for Curation Layout - same style as Portfolio */}
            <div
              className={`relative aspect-[4/5] flex-shrink-0 -mx-3 ${w('md:-mx-6')}`}
              style={{ background: coverPlaceholder }}
            >
              {(design.portfolioHeaderImage || (!design.portfolioHeaderImage && !design.portfolioHeaderColor)) && (
                <MediaAuto
                  src={design.portfolioHeaderImage || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1280&q=70"}
                  priority
                  fadeIn
                  width={1280}
                  className="w-full h-full object-cover"
                  style={{ objectPosition: `center ${design.portfolioHeaderImagePosition || '50'}%` }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-inherit via-transparent to-transparent" style={{ background: coverFade }}></div>
              {coverIdentity}
            </div>

            <header className={`relative ${tightTopGap ? 'pt-2 pb-4' : 'pt-4 pb-6'} px-5 ${w('md:px-10')} text-center shrink-0 overflow-hidden -mx-3 ${w('md:-mx-6')}`}>

              {/* 위 포트폴리오 레이아웃과 같은 이유로 가로 스크롤을 걷어 냈다. 이쪽은
                  줄 자체에 위아래 여백이 없어서 떠오르는 모션과 그림자가 더 잘렸다. */}
              {hasActionButtons && (
                <div className="flex gap-2.5 py-1.5 justify-center flex-wrap">
                  {actionButtons}
                </div>
              )}

              {aboutSectionsBlock}

              {/* Open Schedule Section - Curation Layout */}
              {activeScheduleItems.length > 0 && (
                <div className="mt-6 px-2 space-y-2">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] px-2" style={{ color: design.accentColor }}>Upcoming Schedule</h4>
                  {scheduleItemsBlock}
                </div>
              )}

            </header>

            <div className={`sticky top-0 z-30 ${tightTopGap ? 'pt-[calc(env(safe-area-inset-top,0px)+0.5rem)]' : 'pt-[calc(env(safe-area-inset-top,0px)+1rem)]'} pb-4 overflow-x-auto scrollbar-hide flex gap-2 px-5 ${w('md:px-10')} backdrop-blur-md -mx-3 ${w('md:-mx-6')}`}>
              {categoryChipsRow}
            </div>

            {/* Product Search Bar */}
            {showSearchBar && (
              <div className={`px-2 ${w('md:px-4')} mb-2`}>
                {searchBarRow}
              </div>
            )}

            <main className={`flex-1 px-2 ${w('md:px-4')} py-6`}>
              {/* Supabase Links Grid */}
              {featuredLinks.length > 0 && (
                <div className="grid grid-cols-1 gap-4 mb-10">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] px-2" style={{ color: design.accentColor }}>Featured Links</h4>
                  <div className={design.templateType === TemplateType.SHOPPABLE_GRID ? `grid grid-cols-2 ${w('md:grid-cols-3')} gap-4 ${w('md:gap-6')}` : `flex flex-col gap-3 ${w('md:gap-4')}`}>
                    {featuredLinks.map((link) => (
                      <a
                        key={link.id}
                        {...externalLinkProps(link.url)}
                        onClick={() => onTrackClick?.(link.id)}
                        className={`group relative overflow-hidden transition-all hover:scale-[1.02] shadow-xl ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-100'} ${design.templateType === TemplateType.SHOPPABLE_GRID ? 'rounded-[2rem] aspect-square border' : 'rounded-2xl p-4 flex items-center gap-4 border'}`}
                      >
                        {design.templateType === TemplateType.SHOPPABLE_GRID ? (
                          <>
                            <SafeImage src={link.image || FALLBACK_IMAGE} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt={link.title} />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-5">
                              <p className="text-white text-xs font-black truncate">{link.title}</p>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-slate-100 dark:bg-slate-800 border border-white/10">
                              <SafeImage src={link.image || FALLBACK_IMAGE} className="w-full h-full object-cover" alt={link.title} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-black truncate">{link.title}</p>
                              <p className="text-[10px] opacity-40 font-bold truncate">{link.url.replace('https://', '').replace('http://', '')}</p>
                            </div>
                            <ExternalLink size={14} className={`opacity-100 ${w('md:opacity-20 md:group-hover:opacity-100')} transition-opacity`} />
                          </>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {design.templateType === TemplateType.SHOPPABLE_GRID ? (
                <div className="w-full" style={{ paddingBottom: '100px' }}>
                  {displayGroups.map((group) => (
                    <div key={group.category || '__all'}>
                      {selectedCategory === '전체' && group.category && groupHeading(group.category, group.blocks.length, 'pt-6')}
                      <div
                        className="grid grid-flow-dense"
                        style={{
                          gridTemplateColumns: 'repeat(6, 1fr)',
                          gap: `${Math.max(design.gridGap, 4)}px`,
                        }}
                      >
                        {group.blocks.map(renderBlockCard)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3 pb-32">
                  {displayGroups.map((group) => (
                    <div key={group.category || '__all'}>
                      {selectedCategory === '전체' && group.category && groupHeading(group.category, group.blocks.length, 'pt-5')}
                      {group.blocks.map(renderProductRow)}
                    </div>
                  ))}
                </div>
              )}
            </main>

          </div>
        )}

        {children}

        </div>
      </div>
    </div>
  );
};

export default PublicPageBody;
