import React, { useEffect, useState, useMemo } from 'react';
import { Share2 } from 'lucide-react';
import { Block, DesignSettings, ProductFolder, OpenScheduleItem } from '../types';
import { getPublicProfileByUsername, supabase, withTimeout } from '../services/supabase';
import { trackView, trackClick } from '../services/analyticsService';
import { getLinkGridItems } from '../services/settingsService';
import { themeIsDark } from '../utils/themeColor';
import { apiService } from '../services/apiService';
import { shareOrCopy } from '../utils/clipboard';
import PublicPageBody, { DEFAULT_PUBLIC_DESIGN } from './PublicPageBody';
import ProductSheet from './ProductSheet';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * socials 의 기본값.
 *
 * liveNotify 는 남겨 둔다 — 예전에 저장된 socials 에 들어 있는 값이라, 없애도
 * 화면에 영향이 없지만 저장된 JSON 을 덮어쓸 때 키가 사라지는 것을 막기 위해
 * 기본값에는 그대로 둔다.
 */
const DEFAULT_SOCIALS = { instagram: '', youtube: '', tiktok: '', phone: '', kakao: '', naver: '', businessProposal: false, liveNotify: false };

interface UserPageProps {
  username: string;
  onBackToDashboard?: () => void;
}

interface AboutSection {
  id: string;
  title: string;
  content: string;
}

interface ProfileData {
  full_name: string;
  bio: string;
  avatar_url?: string;
  aboutSections?: AboutSection[];
}

interface LinkData {
  id: string;
  title: string;
  url: string;
  image?: string;
  category?: string;
}

const ENABLE_SUPABASE_REALTIME = import.meta.env.VITE_ENABLE_SUPABASE_REALTIME === '1';

const UserPage: React.FC<UserPageProps> = ({ username, onBackToDashboard }) => {
  const { language } = useLanguage();
  const normalizedUsername = useMemo(() => (username || '').toLowerCase(), [username]);

  const [blocks, setBlocks] = useState<Block[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_blocks_${normalizedUsername}`);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing blocks:', e);
    }
    return [];
  });

  const [design, setDesign] = useState<DesignSettings>(() => {
    /* 기본값은 미리보기와 함께 쓴다(components/PublicPageBody). */
    const defaultDesign = DEFAULT_PUBLIC_DESIGN;

    try {
      if (!normalizedUsername) return defaultDesign;
      const saved = localStorage.getItem(`picks_design_${normalizedUsername}`);
      if (saved) return { ...defaultDesign, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return defaultDesign;
  });

  const [socials, setSocials] = useState(() => {
    try {
      if (!normalizedUsername) return DEFAULT_SOCIALS;
      const saved = localStorage.getItem(`picks_socials_${normalizedUsername}`);
      if (saved) return { ...DEFAULT_SOCIALS, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Error parsing socials:', e);
    }
    return DEFAULT_SOCIALS;
  });

  const [_productFolders, setProductFolders] = useState<ProductFolder[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_folders_${normalizedUsername}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [openSchedule, setOpenSchedule] = useState<OpenScheduleItem[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_schedule_${normalizedUsername}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [linkGridCategories, setLinkGridCategories] = useState<string[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_categories_${normalizedUsername}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [profile, setProfile] = useState<ProfileData | null>(() => {
    try {
      if (!normalizedUsername) return null;
      const saved = localStorage.getItem(`picks_profile_${normalizedUsername}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          full_name: parsed.name,
          bio: parsed.bio,
          avatar_url: parsed.avatar_url,
          aboutSections: Array.isArray(parsed.aboutSections) ? parsed.aboutSections : []
        };
      }
    } catch (e) {
      console.error('Error parsing profile:', e);
    }
    return null;
  });
  const [links, setLinks] = useState<LinkData[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('전체');
  const [searchQuery, setSearchQuery] = useState<string>('');

  /**
   * 개인페이지가 열려 있는 동안 body 를 흰 종이색으로 둔다.
   *
   * 배경색은 상단 커버와 같은 폭(가운데 칸)까지만 칠하고 그 바깥은 흰 여백이다.
   * 그 여백을 그리는 칸은 화면 크기만큼만 있어서, iOS 의 overscroll 되돌림 구간과
   * 데스크톱 축소(zoom)가 남기는 바깥 여백에는 body 색이 비친다 — 기본 body 는
   * 어두운 색이라 흰 페이지 위아래로 검은 띠가 스쳤다. 떠날 때 되돌려 놓는다.
   */
  useEffect(() => {
    document.body.classList.add('userpage-canvas');
    return () => document.body.classList.remove('userpage-canvas');
  }, []);

  useEffect(() => {
    const loadData = async () => {
      let apiDataResult: any = null;
      try {
        apiDataResult = await apiService.getSiteData(normalizedUsername);
      } catch (e) {
        console.warn('[UserPage] Site API load failed:', e);
      }

      try {
        // 0. Netlify Blobs API에서 데이터 로드 (최우선 클라우드 스토리지)
        let apiLoaded = false;
        try {
          const apiData = apiDataResult;
          if (apiData) {
            apiLoaded = true;
            // Cloud is source of truth: use cloud data even if empty (admin may have cleared it)
            if (Array.isArray(apiData.blocks)) {
              setBlocks(apiData.blocks);
              localStorage.setItem(`picks_blocks_${normalizedUsername}`, JSON.stringify(apiData.blocks));
            }
            if (apiData.design) {
              setDesign(prev => ({ ...prev, ...(apiData.design as any) }));
              localStorage.setItem(`picks_design_${normalizedUsername}`, JSON.stringify(apiData.design));
            }
            if (apiData.profile) {
              setProfile({
                full_name: apiData.profile.name || '',
                bio: apiData.profile.bio || '',
                avatar_url: apiData.profile.avatar_url,
                aboutSections: Array.isArray(apiData.profile.aboutSections)
                  ? apiData.profile.aboutSections
                  : []
              });
              try {
                const existingProfile = JSON.parse(localStorage.getItem(`picks_profile_${normalizedUsername}`) || '{}');
                localStorage.setItem(`picks_profile_${normalizedUsername}`, JSON.stringify({ ...existingProfile, ...apiData.profile }));
              } catch { localStorage.setItem(`picks_profile_${normalizedUsername}`, JSON.stringify(apiData.profile)); }
            }
            if (apiData.socials) {
              /* 서버 값으로 갈아 끼운다(먼저 그려 둔 localStorage 값 위에 덮지 않는다).
                 켜 둔 값만 저장되는 칸이 있어서 — 검색바는 껐을 때만 hideSearchBar 가
                 남는다 — 두 벌을 겹치면 서버에서 지워진 값이 예전 localStorage 에서
                 살아남는다. 검색바를 다시 켜도 이 기기에서만 계속 숨어 있던 이유다. */
              setSocials({ ...DEFAULT_SOCIALS, ...(apiData.socials as any) });
              localStorage.setItem(`picks_socials_${normalizedUsername}`, JSON.stringify(apiData.socials));
            }
            if (apiData.productFolders) {
              setProductFolders(apiData.productFolders);
              localStorage.setItem(`picks_folders_${normalizedUsername}`, JSON.stringify(apiData.productFolders));
            }
            if (apiData.openSchedule) {
              setOpenSchedule(apiData.openSchedule);
              localStorage.setItem(`picks_schedule_${normalizedUsername}`, JSON.stringify(apiData.openSchedule));
            }
            if (Array.isArray(apiData.linkGridCategories)) {
              setLinkGridCategories(apiData.linkGridCategories);
              localStorage.setItem(`picks_categories_${normalizedUsername}`, JSON.stringify(apiData.linkGridCategories));
            }
          }
        } catch (apiError) {
          console.warn('[UserPage] API 데이터 로드 실패, Supabase로 폴백:', apiError);
        }

        // If API failed, fall back to localStorage for immediate display
        if (!apiLoaded) {
          try {
            const savedBlocks = localStorage.getItem(`picks_blocks_${normalizedUsername}`);
            const savedDesign = localStorage.getItem(`picks_design_${normalizedUsername}`);
            const savedSocials = localStorage.getItem(`picks_socials_${normalizedUsername}`);
            const savedProfile = localStorage.getItem(`picks_profile_${normalizedUsername}`);

            if (savedBlocks) {
              const parsed = JSON.parse(savedBlocks);
              setBlocks(Array.isArray(parsed) ? parsed : []);
            }
            if (savedDesign) setDesign(prev => ({ ...prev, ...JSON.parse(savedDesign) }));
            if (savedSocials) setSocials({ ...DEFAULT_SOCIALS, ...JSON.parse(savedSocials) });
            if (savedProfile) {
              const parsed = JSON.parse(savedProfile);
              setProfile({
                full_name: parsed.name,
                bio: parsed.bio,
                avatar_url: parsed.avatar_url,
                aboutSections: Array.isArray(parsed.aboutSections) ? parsed.aboutSections : []
              });
            }
          } catch (e) {
            console.error('Error loading from localStorage:', e);
          }
        }

        // 1. Supabase에서 데이터 로드 (API에서 못 불러온 경우에만 폴백)
        // API(Netlify Blobs)에서 이미 데이터를 로드했으면 Supabase 조회를 건너뛴다
        if (!apiLoaded) {
          try {
            if (supabase) {
              let profileData: any = null;
              let profileError: any = null;

              try {
                const result = await withTimeout(
                  getPublicProfileByUsername(username, 'id, username, full_name, bio, avatar_url'),
                  5000,
                  'UserPage 프로필 조회'
                );
                profileData = result?.data ?? null;
                profileError = result?.error ?? null;
              } catch (profileFetchErr: any) {
                // site_data column missing, timeout, or any other DB error — use defaults
                console.warn('[UserPage] 프로필 조회 예외 (기본값 사용):', profileFetchErr?.message || profileFetchErr);
                profileData = null;
                profileError = profileFetchErr;
              }

              if (profileError) {
                console.warn('[UserPage] 프로필 조회 오류:', profileError?.message || profileError);
              }

              if (!profileError && profileData) {
                // 이 화면의 profile.full_name 은 "표시 이름"이다(위의 API 경로는
                // site_data 의 profile.name 을 여기에 넣는다). profiles.full_name
                // 은 가입 폼의 실명이라 그대로 넣으면 site_data 를 못 읽은 방문에만
                // 커버 사진 위의 이름이 실명으로 바뀐다. 표시 이름의 기본값은
                // 가입 시점과 같은 아이디다(netlify/functions/auth-signup).
                setProfile({ ...profileData, full_name: profileData.username || '' });

                // Fetch Link Grid Items (New Source of Truth for Blocks)
                const cloudBlocks = await getLinkGridItems(username);
                if (cloudBlocks && cloudBlocks.length > 0) {
                  setBlocks(cloudBlocks);
                  localStorage.setItem(`picks_blocks_${normalizedUsername}`, JSON.stringify(cloudBlocks));
                }
              }

              // Fetch link_grid_items (replaces non-existent 'links' table)
              try {
                if (profileData?.id) {
                  const { data: linksData, error: linksError } = await supabase
                    .from('link_grid_items')
                    .select('id, title, price, image_url, link, display_order')
                    .eq('user_id', profileData.id)
                    .order('display_order', { ascending: true });

                  if (!linksError && linksData) {
                    setLinks(linksData.map((l: any) => ({
                      id: l.id,
                      title: l.title,
                      url: l.link,
                      image: l.image_url,
                    })));
                  }
                }
              } catch {
                // Table may not exist yet — silently ignore
              }
            }
          } catch (supabaseError) {
            console.warn('[UserPage] Supabase 데이터 로드 실패 (API 데이터는 유지됨):', supabaseError);
          }
        }
      } catch (e) {
        console.error("Error loading user data:", e);
      }
    };

    loadData();
    trackView(username);

      // 4. Supabase Realtime Subscription
      // This ensures that when data changes on PC, the mobile browser updates immediately without cache issues.
      let profileChannel: any = null;
      let gridChannel: any = null;
      let loadDataTimer: ReturnType<typeof setTimeout> | null = null;

      // Debounce loadData so a burst of realtime events re-renders the page once.
      const debouncedLoadData = () => {
        if (loadDataTimer) clearTimeout(loadDataTimer);
        loadDataTimer = setTimeout(() => { loadData(); }, 500);
      };

      if (supabase && ENABLE_SUPABASE_REALTIME) {
        // Listen to link grid items changes (filtered to this user only)
        gridChannel = supabase
          .channel('public:link_grid_items')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'link_grid_items',
              filter: `username=eq.${username}`
            },
            () => {
              console.info('Realtime Sync: Link grid items updated for', username);
              debouncedLoadData();
            }
          )
          .subscribe();

        // Listen to profile changes
        profileChannel = supabase
          .channel('public:profiles')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'profiles',
              filter: `username=eq.${username}`
            },
            () => {
              console.info('Realtime Sync: Profile updated for', username);
              debouncedLoadData();
            }
          )
          .subscribe();
      }

      // Listen for changes from other tabs (Admin Dashboard)
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key?.toLowerCase().includes(normalizedUsername)) {
          debouncedLoadData();
        }
      };

      window.addEventListener('storage', handleStorageChange);
      return () => {
        window.removeEventListener('storage', handleStorageChange);
        if (loadDataTimer) clearTimeout(loadDataTimer);
        if (profileChannel && supabase) supabase.removeChannel(profileChannel);
        if (gridChannel && supabase) supabase.removeChannel(gridChannel);
      };
  }, [normalizedUsername, username]);

  const selectedBlock = useMemo(() => blocks.find(b => b.id === selectedBlockId), [blocks, selectedBlockId]);

  /**
   * 본문(커버 · 버튼 · 카테고리 · 카드)은 PublicPageBody 가, 상품 서랍은
   * ProductSheet 가 그린다 — 편집 화면 오른쪽의 미리보기가 같은 컴포넌트를 쓴다.
   * 여기 남은 값은 본문 아래의 푸터가 쓰는 것뿐이다.
   */
  const isDark = themeIsDark(design);
  const subTextColor = isDark ? 'text-white/60' : 'text-slate-500';

  return (
    <>
      {onBackToDashboard && (
        <button
          type="button"
          onClick={onBackToDashboard}
          className="fixed left-3 z-[80] flex items-center gap-2 rounded-full border border-white/20 bg-slate-950/85 px-4 py-2.5 text-xs font-black text-white shadow-xl backdrop-blur-md transition active:scale-95 md:left-5 md:top-5"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          aria-label="홈 대시보드로 돌아가기"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          대시보드
        </button>
      )}
      <PublicPageBody
        design={design}
        profile={profile}
        socials={socials}
        blocks={blocks}
        linkGridCategories={linkGridCategories}
        openSchedule={openSchedule}
        featuredLinks={links}
        proposalHref={`/${normalizedUsername}/proposal`}
        language={language}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        searchQuery={searchQuery}
        onSearchQuery={setSearchQuery}
        onSelectBlock={setSelectedBlockId}
        onTrackClick={(blockId) => trackClick(username, blockId)}
      >

        {/* Footer */}
        <footer className="py-12 flex flex-col items-center space-y-6 shrink-0">
          <button 
            onClick={async () => {
              // 공유 API 가 없는 환경(데스크톱, 구형 인앱 브라우저)에서는
              // navigator.share 호출 자체가 TypeError 라 버튼이 죽어 있었다.
              // 시트를 닫은 것도 실패로 받아 "복사되었습니다"를 띄웠다.
              const result = await shareOrCopy({
                title: `${username}님의 픽스폴리오`,
                url: window.location.href,
              });
              if (result === 'copied') alert('링크가 복사되었습니다!');
              else if (result === 'failed') alert('공유할 수 없습니다. 주소창의 링크를 복사해 주세요.');
            }}
            className="flex items-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-[2rem] font-black text-sm hover:scale-105 transition-all shadow-2xl"
          >
            <Share2 size={18} />
            페이지 공유하기
          </button>
          
          <div className="flex items-center gap-2 opacity-30 grayscale hover:grayscale-0 transition-all cursor-pointer">
            <span className="text-[10px] font-black tracking-tighter">POWERED BY</span>
            <span className="text-sm font-black text-blue-600 tracking-tighter">PICKSFOLIO</span>
          </div>

          {/* 통신판매중개자 사업자 정보 및 고객센터 (전자상거래법 제20조 / 결제 연동 심사 대응) */}
          <div className={`w-full max-w-md mx-auto pt-6 mt-2 border-t text-center space-y-1.5 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
            <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
              본 페이지의 거래는 통신판매중개 플랫폼 픽스폴리오(Picksfolio)를 통해 이루어집니다.
            </p>
            <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
              상호명 픽스폴리오(Picksfolio) | 대표자 신우진
            </p>
            <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
              사업자등록번호 220-26-01995 | 통신판매업신고 제 2026-부천원미-0846 호
            </p>
            <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
              경기도 부천시 원미구 부일로199번길 26, 7층 2호(상동, 서련코아)
            </p>
            <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
              고객센터 070-7954-8452 | woojin8940@inplace-ad.com
            </p>
            <div className="flex items-center justify-center gap-3 pt-1">
              <a href="/terms" className={`text-[11px] font-bold underline underline-offset-2 transition-colors ${isDark ? 'text-white/70 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                이용약관
              </a>
              <span className={subTextColor}>|</span>
              <a href="/privacy" className={`text-[11px] font-bold underline underline-offset-2 transition-colors ${isDark ? 'text-white/70 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                개인정보처리방침 · 취소/환불/배송 안내
              </a>
            </div>
          </div>
        </footer>

        {/* Product Detail Drawer */}
        <ProductSheet
          block={selectedBlock || null}
          design={design}
          onClose={() => setSelectedBlockId(null)}
          onProductClick={() => trackClick(username, selectedBlockId || '')}
        />
        
      </PublicPageBody>
    </>
  );
};

export default UserPage;
