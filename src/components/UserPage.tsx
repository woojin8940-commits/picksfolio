import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Instagram, ExternalLink, Share2, Radio, Users, Briefcase, Search, Bell, Hash } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { Block, BlockDisplayType, DesignSettings, TemplateType, ProductFolder, OpenScheduleItem } from '../types';
import { supabase, withTimeout } from '../services/supabase';
import { trackView, trackClick } from '../services/analyticsService';
import { getLinkGridItems } from '../services/settingsService';
import { apiService } from '../services/apiService';
import { ViewerSignaling } from '../services/webrtcSignaling';
import SafeImage from './SafeImage';
import { DEFAULT_AVATAR } from '../utils/defaultAvatar';
import MediaAuto from './MediaAuto';
import LiveStream from './LiveStream';
import { renderPortfolioHtml } from './richText';

type PortfolioSectionGroup =
  | { kind: 'single'; section: any }
  | { kind: 'imageGrid'; columns: number; sections: any[] };

const groupPortfolioSections = (items: any[]): PortfolioSectionGroup[] => {
  const groups: PortfolioSectionGroup[] = [];
  for (const s of items) {
    if (!s) continue;
    if (s.type === 'image') {
      const raw = Number(s.gridColumns) || 1;
      const cols = Math.min(4, Math.max(1, raw));
      const last = groups[groups.length - 1];
      if (last && last.kind === 'imageGrid' && last.columns === cols) {
        last.sections.push(s);
      } else {
        groups.push({ kind: 'imageGrid', columns: cols, sections: [s] });
      }
    } else {
      groups.push({ kind: 'single', section: s });
    }
  }
  return groups;
};

const legacyFontToPxUP = (size?: string): number => {
  switch (size) {
    case 'sm': return 13;
    case 'lg': return 17;
    case 'xl': return 20;
    default: return 14;
  }
};

const getSectionFontPx = (section: any): number => {
  if (typeof section?.fontSizePx === 'number' && section.fontSizePx > 0) return section.fontSizePx;
  return legacyFontToPxUP(section?.fontSize);
};

const getSectionTextDecoration = (section: any): string | undefined => {
  const parts: string[] = [];
  if (section?.underline) parts.push('underline');
  if (section?.strikethrough) parts.push('line-through');
  return parts.length ? parts.join(' ') : undefined;
};

const chunkSections = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const getSectionImages = (section: any): string[] => {
  const raw = Number(section?.gridColumns) || 1;
  const cols = Math.min(4, Math.max(1, raw));
  const source = Array.isArray(section?.images) && section.images.length > 0
    ? section.images
    : [section?.content || ''];
  const arr = source.slice(0, cols);
  while (arr.length < cols) arr.push('');
  return arr;
};

const flattenSectionImages = (sections: any[]): { key: string; src: string; pos?: { x: number; y: number } }[] =>
  sections.flatMap(s => getSectionImages(s).map((src, i) => ({ key: `${s.id}-${i}`, src, pos: s.imagePositions?.[i] })));

const PORTFOLIO_ALL_LABEL = '전체';

interface PortfolioCategoryDescriptor {
  id: string;
  name: string;
  image?: string;
  description?: string;
}

const collectPortfolioCategories = (items: any[]): PortfolioCategoryDescriptor[] => {
  const out: PortfolioCategoryDescriptor[] = [];
  const seen = new Set<string>();
  for (const it of items || []) {
    if (!it || it.type !== 'category') continue;
    const name = (it.content || '').trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ id: it.id || name, name, image: it.categoryImage, description: it.categoryDescription });
  }
  return out;
};

const filterPortfolioByCategory = (items: any[], categoryName: string): any[] => {
  const out: any[] = [];
  let active: string | null = null;
  const isAll = !categoryName || categoryName === PORTFOLIO_ALL_LABEL;
  for (const it of items || []) {
    if (!it) continue;
    if (it.type === 'category') {
      active = (it.content || '').trim();
      continue;
    }
    if (isAll) {
      if (active === null) out.push(it);
    } else if (active === categoryName) {
      out.push(it);
    }
  }
  return out;
};

interface UserPageProps {
  username: string;
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

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=3840&q=100';

const UserPage: React.FC<UserPageProps> = ({ username }) => {
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
    const defaultDesign: DesignSettings = {
      templateType: TemplateType.SHOPPABLE_GRID,
      theme: 'midnight',
      accentColor: '#7c3aed',
      borderRadius: 'full',
      gridGap: 1,
      gridColumns: 2,
      gridStyle: 'magazine',
      fontFamily: 'Sans',
      buttonStyle: 'solid',
      backgroundType: 'solid',
      customGradient: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
      profileLayout: 'center',
      homePriority: 'curation'
    };

    try {
      if (!normalizedUsername) return defaultDesign;
      const saved = localStorage.getItem(`picks_design_${normalizedUsername}`);
      if (saved) return { ...defaultDesign, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return defaultDesign;
  });

  const [portfolioSections, setPortfolioSections] = useState<any[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_portfolio_${normalizedUsername}`);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing portfolio:', e);
    }
    return [];
  });

  const [socials, setSocials] = useState(() => {
    const defaultSocials = { instagram: '', youtube: '', tiktok: '', phone: '', kakao: '', naver: '', businessProposal: false, liveNotify: false };
    try {
      if (!normalizedUsername) return defaultSocials;
      const saved = localStorage.getItem(`picks_socials_${normalizedUsername}`);
      if (saved) return { ...defaultSocials, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Error parsing socials:', e);
    }
    return defaultSocials;
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
  const [selectedPortfolioCategory, setSelectedPortfolioCategory] = useState<string>(PORTFOLIO_ALL_LABEL);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [liveState, setLiveState] = useState<{ isLive: boolean; currentProduct?: any; viewerCount: number; activeMaterial?: any }>({
    isLive: false,
    viewerCount: 0
  });

  // Live notification subscription state
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [, setNotifyPhone] = useState('');
  const [notifySubscribed, setNotifySubscribed] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [notifyError, setNotifyError] = useState('');
  const [notifyConsentRequired, setNotifyConsentRequired] = useState(false);
  const [notifyConsentPrivacy, setNotifyConsentPrivacy] = useState(false);
  const [notifyConsentMarketing, setNotifyConsentMarketing] = useState(false);
  const [showConsentDetail, setShowConsentDetail] = useState<null | 'privacy' | 'marketing'>(null);
  const [notifyShowConsent, setNotifyShowConsent] = useState(false);
  const [notifyPhoneInputMode, setNotifyPhoneInputMode] = useState(false);
  const [notifyPhoneInput, setNotifyPhoneInput] = useState('');
  const [notifyPendingNickname, setNotifyPendingNickname] = useState('');
  const [showUnsubscribeConfirm, setShowUnsubscribeConfirm] = useState(false);


  useEffect(() => {
    const loadData = async () => {
      // Load from localStorage for immediate UI (optimistic display while cloud fetches)
      const savedLive = localStorage.getItem(`picks_live_${normalizedUsername}`);
      if (savedLive) {
        try {
          const parsed = JSON.parse(savedLive);
          setLiveState({
            isLive: parsed.isLive,
            currentProduct: parsed.currentProduct,
            viewerCount: parsed.viewerCount || 0,
            activeMaterial: parsed.activeMaterial
          });
        } catch (e) {
          console.error('Error parsing live:', e);
        }
      }

      // Fetch live state and site data in parallel for faster load
      let apiLiveResult: any = null;
      let apiDataResult: any = null;
      try {
        const [liveRes, siteRes] = await Promise.allSettled([
          apiService.getLiveState(normalizedUsername),
          apiService.getSiteData(normalizedUsername),
        ]);
        if (liveRes.status === 'fulfilled') apiLiveResult = liveRes.value;
        if (siteRes.status === 'fulfilled') apiDataResult = siteRes.value;
      } catch (e) {
        console.warn('[UserPage] Parallel API load failed:', e);
      }

      if (apiLiveResult) {
        setLiveState({
          isLive: apiLiveResult.isLive,
          currentProduct: apiLiveResult.currentProduct,
          viewerCount: apiLiveResult.viewerCount || 0,
          activeMaterial: apiLiveResult.activeMaterial
        });
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
              setSocials((prev: any) => ({ ...prev, ...(apiData.socials as any) }));
              localStorage.setItem(`picks_socials_${normalizedUsername}`, JSON.stringify(apiData.socials));
            }
            // Portfolio: always sync from cloud, even if empty array (content was cleared)
            if (apiData.portfolio !== undefined && apiData.portfolio !== null) {
              const portfolioArr = Array.isArray(apiData.portfolio) ? apiData.portfolio : [];
              setPortfolioSections(portfolioArr);
              localStorage.setItem(`picks_portfolio_${normalizedUsername}`, JSON.stringify(portfolioArr));
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
            const savedPortfolio = localStorage.getItem(`picks_portfolio_${normalizedUsername}`);
            const savedSocials = localStorage.getItem(`picks_socials_${normalizedUsername}`);
            const savedProfile = localStorage.getItem(`picks_profile_${normalizedUsername}`);

            if (savedBlocks) {
              const parsed = JSON.parse(savedBlocks);
              setBlocks(Array.isArray(parsed) ? parsed : []);
            }
            if (savedDesign) setDesign(prev => ({ ...prev, ...JSON.parse(savedDesign) }));
            if (savedPortfolio) {
              const parsed = JSON.parse(savedPortfolio);
              setPortfolioSections(Array.isArray(parsed) ? parsed : []);
            }
            if (savedSocials) setSocials(JSON.parse(savedSocials));
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
                  supabase
                    .from('profiles')
                    .select('id, username, full_name, bio, avatar_url, phone')
                    .eq('username', username)
                    .maybeSingle(),
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
                setProfile(profileData);

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

      // Debounce loadData to prevent rapid re-renders during broadcasting
      const debouncedLoadData = () => {
        if (loadDataTimer) clearTimeout(loadDataTimer);
        loadDataTimer = setTimeout(() => { loadData(); }, 500);
      };

      if (supabase) {
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

  // Poll live state from API so viewers detect broadcasts without Supabase Realtime
  useEffect(() => {
    let active = true;
    const pollLive = async () => {
      try {
        const apiLive = await apiService.getLiveState(normalizedUsername);
        if (active && apiLive) {
          setLiveState((prev) => {
            // Only update if changed to avoid unnecessary re-renders
            const newProductId = apiLive.currentProduct?.id || null;
            const prevProductId = prev.currentProduct?.id || null;
            const newMaterialId = apiLive.activeMaterial?.id || null;
            const prevMaterialId = prev.activeMaterial?.id || null;
            const newMaterialUrl = apiLive.activeMaterial?.url || null;
            const prevMaterialUrl = prev.activeMaterial?.url || null;
            if (
              prev.isLive !== apiLive.isLive ||
              prev.viewerCount !== (apiLive.viewerCount || 0) ||
              prevProductId !== newProductId ||
              prevMaterialId !== newMaterialId ||
              prevMaterialUrl !== newMaterialUrl
            ) {
              return {
                isLive: apiLive.isLive,
                currentProduct: apiLive.currentProduct,
                viewerCount: apiLive.viewerCount || 0,
                activeMaterial: apiLive.activeMaterial,
              };
            }
            return prev;
          });
        }
      } catch {}
    };
    const timer = setInterval(pollLive, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [normalizedUsername]);

  // Pre-connect WebRTC signaling when broadcast is live (before user taps the banner)
  // This eliminates the ~5-15s signaling roundtrip delay when opening the live modal
  const preSignalingRef = useRef<ViewerSignaling | null>(null);
  useEffect(() => {
    if (liveState.isLive && !showLiveModal && !preSignalingRef.current) {
      console.log('[UserPage] Live detected, pre-connecting WebRTC signaling');
      const signaling = new ViewerSignaling(normalizedUsername);
      preSignalingRef.current = signaling;
      signaling.connect();
    }
    // Clean up pre-connection if broadcast ends and modal is not open
    if (!liveState.isLive && !showLiveModal && preSignalingRef.current) {
      console.log('[UserPage] Live ended, cleaning up pre-connected signaling');
      preSignalingRef.current.disconnect();
      preSignalingRef.current = null;
    }
  }, [liveState.isLive, showLiveModal, normalizedUsername]);

  // Preload/decode the active material image so it appears instantly inside
  // the live modal instead of briefly rendering a blank frame while the
  // browser decodes the newly-arrived URL.
  useEffect(() => {
    const url = liveState.activeMaterial?.url;
    if (!url) return;
    const img = new Image();
    try { (img as any).decoding = 'async'; } catch {}
    try { (img as any).fetchPriority = 'high'; } catch {}
    img.src = url;
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {});
    }
  }, [liveState.activeMaterial?.id, liveState.activeMaterial?.url]);

  // When modal closes, clean up the pre-connected signaling (LiveStream handles its own cleanup)
  useEffect(() => {
    if (showLiveModal) {
      // Modal opened — LiveStream takes ownership, clear our ref so we don't double-disconnect
      preSignalingRef.current = null;
    }
  }, [showLiveModal]);

  // Clean up signaling on unmount
  useEffect(() => {
    return () => {
      if (preSignalingRef.current) {
        preSignalingRef.current.disconnect();
        preSignalingRef.current = null;
      }
    };
  }, []);

  // Live broadcast indicator is shown at the top; viewer taps it to open the stream

  // Handle Kakao OAuth callback for viewer login
  useEffect(() => {
    const redirectUsername = localStorage.getItem('picks_live_kakao_redirect');
    if (!redirectUsername || redirectUsername.toLowerCase() !== normalizedUsername) return;
    if (!supabase) {
      localStorage.removeItem('picks_live_kakao_redirect');
      return;
    }

    const processKakaoUser = async (user: any) => {
      const meta = user.user_metadata;
      const kakaoUser = {
        nickname: meta?.full_name || meta?.name || meta?.preferred_username || '카카오 사용자',
        profileImage: meta?.avatar_url || meta?.picture || undefined,
        provider: 'kakao' as const,
      };
      localStorage.setItem('picks_kakao_user', JSON.stringify(kakaoUser));
      localStorage.removeItem('picks_live_kakao_redirect');

      // Sign out from Supabase so the viewer session doesn't interfere with admin login
      await supabase!.auth.signOut();

      // Auto-open live stream modal
      setShowLiveModal(true);
    };

    const initKakaoCallback = async () => {
      // Handle PKCE code exchange for viewer Kakao login
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');

      // === URL 파라미터 디버그 로그 ===
      console.log('[UserPage] === 카카오 리다이렉트 URL 파라미터 점검 ===');
      console.log('[UserPage] 현재 전체 URL:', window.location.href);
      console.log('[UserPage] code 파라미터 존재:', !!code, code ? `(길이: ${code.length})` : '');
      console.log('[UserPage] error 파라미터:', params.get('error') || '(없음)');
      console.log('[UserPage] error_description 파라미터:', params.get('error_description') || '(없음)');
      console.log('[UserPage] state 파라미터:', params.get('state') ? '존재' : '(없음)');
      console.log('[UserPage] 전체 쿼리스트링:', window.location.search || '(비어있음)');
      console.log('[UserPage] === URL 파라미터 점검 끝 ===');

      // === PKCE code_verifier 로컬 스토리지 점검 ===
      console.log('[UserPage] === PKCE code_verifier 점검 ===');
      const storedKeys = Object.keys(localStorage).filter(k =>
        k.includes('code_verifier') || k.includes('pkce') || k.includes('supabase') || k.includes('auth-token')
      );
      console.log('[UserPage] 관련 localStorage 키 목록:', storedKeys);
      storedKeys.forEach(key => {
        const val = localStorage.getItem(key);
        console.log(`[UserPage]   ${key}: ${val ? `존재 (길이: ${val.length})` : '비어있음'}`);
      });
      console.log('[UserPage] === PKCE code_verifier 점검 끝 ===');

      if (code) {
        try {
          const { data, error } = await supabase!.auth.exchangeCodeForSession(code);
          if (error) {
            console.error('[UserPage] OAuth code exchange failed:', error.message);
            console.log('[UserPage] === 에러 상세 출력 (console.dir) ===');
            console.dir(error, { depth: null });
            console.log('[UserPage] 에러 status:', (error as any).status || '(없음)');
            console.log('[UserPage] 에러 code:', (error as any).code || '(없음)');
            console.log('[UserPage] === 에러 상세 출력 끝 ===');
          } else {
            console.log('[UserPage] OAuth 코드 교환 성공, 세션:', !!data?.session);
          }
          // Clean up the URL
          const cleanUrl = window.location.pathname + window.location.hash;
          window.history.replaceState(null, '', cleanUrl);
        } catch (e) {
          console.error('[UserPage] OAuth code exchange error:', e);
          console.log('[UserPage] === catch 에러 상세 출력 (console.dir) ===');
          console.dir(e, { depth: null });
          console.log('[UserPage] === catch 에러 상세 출력 끝 ===');
        }
      }

      // Try getting existing session
      const { data: { session } } = await supabase!.auth.getSession();
      if (session?.user) {
        processKakaoUser(session.user);
        return true;
      }
      return false;
    };

    let subscriptionRef: any = null;

    initKakaoCallback().then((handled) => {
      if (handled) return;

      // Fallback: listen for auth state change (only fresh sign-ins, not existing sessions)
      const { data: { subscription } } = supabase!.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          processKakaoUser(session.user);
          subscription.unsubscribe();
        }
      });
      subscriptionRef = subscription;
    });

    // Clean up after 10 seconds if no auth event
    const cleanupTimer = setTimeout(() => {
      localStorage.removeItem('picks_live_kakao_redirect');
      if (subscriptionRef) subscriptionRef.unsubscribe();
    }, 10000);

    return () => {
      clearTimeout(cleanupTimer);
      if (subscriptionRef) subscriptionRef.unsubscribe();
    };
  }, [normalizedUsername]);

  const categories = useMemo(() => {
    const catSet = new Set<string>(linkGridCategories);
    for (let i = blocks.length - 1; i >= 0; i--) {
      const c = blocks[i].category;
      if (c) catSet.add(c);
    }
    return ['전체', ...Array.from(catSet)];
  }, [blocks, linkGridCategories]);

  const filteredBlocks = useMemo(() => {
    let result = blocks;
    // Apply category filter
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

  const activeScheduleItems = useMemo(() => {
    return openSchedule.filter(item => item.isActive && new Date(item.date) >= new Date(new Date().toDateString()));
  }, [openSchedule]);

  const selectedBlock = useMemo(() => blocks.find(b => b.id === selectedBlockId), [blocks, selectedBlockId]);

  const ensureAbsoluteUrl = (url: string) => {
    if (!url || url === '#' || url.trim() === '') return '#';
    // Remove any stray # characters that might have been saved
    const trimmed = url.trim().replace(/#/g, '');
    if (trimmed === '') return '#';
    
    if (trimmed.startsWith('tel:') || trimmed.startsWith('mailto:')) return trimmed;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return `${window.location.origin}${trimmed}`;
    if (trimmed.startsWith('//')) return `https:${trimmed}`;

    // Handle cases like naver.com or www.naver.com
    return `https://${trimmed}`;
  };

  const openLink = (url: string) => {
    const absoluteUrl = ensureAbsoluteUrl(url);
    if (absoluteUrl === '#') return;

    console.info('Opening link in new tab:', absoluteUrl);

    if (absoluteUrl.startsWith('tel:')) {
      window.location.href = absoluteUrl;
    } else {
      // Use an anchor element to reliably open in a new tab without navigating the current page
      const a = document.createElement('a');
      a.href = absoluteUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // Subscription is per-influencer; the button reflects backend state for
  // THIS influencer. `picks_notify_phone` is the shared phone the viewer
  // last subscribed with, used to verify status on first visit to another
  // influencer page.
  useEffect(() => {
    let cancelled = false;
    const perInfluencerPhone = localStorage.getItem(`picks_notify_phone_${normalizedUsername}`);
    const sharedPhone = localStorage.getItem('picks_notify_phone') || '';
    const phoneToCheck = perInfluencerPhone || sharedPhone;

    if (perInfluencerPhone) {
      setNotifySubscribed(true);
      setNotifyPhone(perInfluencerPhone);
    }

    if (!phoneToCheck) return;

    (async () => {
      try {
        const res = await fetch(
          `/api/live-notify?influencer=${encodeURIComponent(normalizedUsername)}&phone=${encodeURIComponent(phoneToCheck)}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (data?.subscribed) {
          setNotifySubscribed(true);
          setNotifyPhone(phoneToCheck);
          localStorage.setItem(`picks_notify_phone_${normalizedUsername}`, phoneToCheck);
        } else {
          setNotifySubscribed(false);
          if (perInfluencerPhone) {
            localStorage.removeItem(`picks_notify_phone_${normalizedUsername}`);
          }
        }
      } catch {}
    })();

    return () => { cancelled = true; };
  }, [normalizedUsername]);

  const handleNotifyClick = () => {
    if (notifySubscribed) {
      // Already subscribed - show confirmation before unsubscribing
      setShowUnsubscribeConfirm(true);
      return;
    }
    // Go directly to Kakao OAuth - Kakao's own consent screen handles the agreement UI
    setNotifyError('');
    setNotifyConsentRequired(false);
    setNotifyConsentPrivacy(true);
    setNotifyConsentMarketing(true);
    setNotifyShowConsent(false);
    handleNotifyKakaoLogin();
  };

  const handleNotifyKakaoLogin = async () => {
    setNotifyConsentRequired(false);
    setNotifyError('');
    if (!supabase) {
      setNotifyError('서비스가 초기화되지 않았습니다.');
      setShowNotifyModal(true);
      return;
    }
    try {
      localStorage.setItem('picks_notify_kakao_redirect', normalizedUsername);
      localStorage.setItem(
        'picks_notify_consent',
        JSON.stringify({
          privacy: true,
          marketing: true,
          at: new Date().toISOString(),
        })
      );
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'kakao',
        options: {
          redirectTo: window.location.origin + '/' + normalizedUsername,
          scopes: 'openid profile_nickname account_email phone_number name',
          queryParams: {
            prompt: 'login',
            auth_type: 'reauthenticate',
          },
        },
      });
      if (error) {
        localStorage.removeItem('picks_notify_kakao_redirect');
        setNotifyError('카카오 로그인 실패: ' + error.message);
        setShowNotifyModal(true);
      }
    } catch (e: any) {
      localStorage.removeItem('picks_notify_kakao_redirect');
      setNotifyError('카카오 로그인 중 오류가 발생했습니다.');
      setShowNotifyModal(true);
    }
  };

  const handleNotifyUnsubscribe = async () => {
    const phone = localStorage.getItem(`picks_notify_phone_${normalizedUsername}`);
    if (!phone) {
      setShowUnsubscribeConfirm(false);
      return;
    }
    setNotifyLoading(true);
    try {
      await fetch(`/api/live-notify?influencer=${normalizedUsername}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      setNotifySubscribed(false);
      localStorage.removeItem(`picks_notify_phone_${normalizedUsername}`);
    } catch {} finally {
      setNotifyLoading(false);
      setShowUnsubscribeConfirm(false);
    }
  };

  // Subscribe a viewer to live notifications. Used by both the auto-subscribe
  // path (after Kakao login when phone is available) and the manual phone-input
  // fallback path (when Kakao does not return a phone number).
  const submitNotifySubscribe = async (phone: string, nickname: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/live-notify?influencer=${normalizedUsername}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, nickname }),
      });
      const data = await res.json();
      if (data.success) {
        setNotifySubscribed(true);
        if (phone) {
          localStorage.setItem(`picks_notify_phone_${normalizedUsername}`, phone);
          localStorage.setItem('picks_notify_phone', phone);
          setNotifyPhone(phone);
        }
        if (nickname) {
          localStorage.setItem('picks_kakao_user', JSON.stringify({ nickname }));
        }
        setShowNotifyModal(false);
        setNotifyPhoneInputMode(false);
        setNotifyError('');
        return true;
      }
      setNotifyError(data.error || '알림 등록에 실패했습니다.');
      return false;
    } catch {
      setNotifyError('네트워크 오류가 발생했습니다.');
      return false;
    }
  };

  // Handle Kakao OAuth callback for notification signup - auto-subscribe with Kakao phone
  useEffect(() => {
    const redirectUsername = localStorage.getItem('picks_notify_kakao_redirect');
    if (!redirectUsername || redirectUsername.toLowerCase() !== normalizedUsername) return;
    if (!supabase) {
      localStorage.removeItem('picks_notify_kakao_redirect');
      return;
    }

    let cancelled = false;
    let unsub: (() => void) | null = null;

    const extractFromSession = (user: any) => {
      const meta = user?.user_metadata || {};
      const identities = user?.identities || [];
      const kakaoIdentity = identities.find((i: any) => i.provider === 'kakao');
      const idData = kakaoIdentity?.identity_data || {};
      const rawPhone =
        meta?.phone_number || meta?.phone ||
        meta?.kakao_account?.phone_number ||
        idData?.phone_number || idData?.kakao_account?.phone_number || '';
      const phone = rawPhone ? rawPhone.replace(/[^0-9]/g, '').replace(/^82/, '0') : '';
      const nickname =
        meta?.full_name || meta?.name || meta?.preferred_username ||
        idData?.name || idData?.full_name || idData?.kakao_account?.profile?.nickname || '카카오 사용자';
      return { phone, nickname };
    };

    const handleSession = async (user: any, session: any = null) => {
      if (cancelled) return;
      localStorage.removeItem('picks_notify_kakao_redirect');
      let { phone, nickname } = extractFromSession(user);
      setNotifyPendingNickname(nickname);

      setNotifyLoading(true);
      try {
        // If Kakao did not surface phone via OIDC claims/user_metadata,
        // ask the server to resolve it (provider_token → Kakao API, with
        // KAKAO_ADMIN_KEY fallback). This mirrors the main app login path
        // and avoids forcing the viewer to re-enter a phone they already
        // consented to share through Kakao's own consent screen.
        if (!phone) {
          try {
            const providerToken =
              session?.provider_token ||
              sessionStorage.getItem('kakao_provider_token') ||
              '';
            const setupRes = await fetch('/.netlify/functions/kakao-profile-setup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: user.id,
                user_metadata: user.user_metadata || {},
                identities: user.identities || [],
                email: user.email || '',
                provider_token: providerToken,
              }),
            });
            const setupJson = await setupRes.json();
            const fetchedPhone = setupJson?.profile?.phone || '';
            if (fetchedPhone) {
              phone = fetchedPhone.replace(/[^0-9]/g, '').replace(/^82/, '0');
            }
            if (!nickname || nickname === '카카오 사용자') {
              const fetchedName = setupJson?.profile?.full_name;
              if (fetchedName) {
                nickname = fetchedName;
                setNotifyPendingNickname(fetchedName);
              }
            }
          } catch (e) {
            console.warn('[UserPage] kakao-profile-setup fallback failed:', e);
          }
        }

        if (phone) {
          const ok = await submitNotifySubscribe(phone, nickname);
          if (!ok) {
            // Auto-subscribe failed (e.g. invalid phone) — fall back to manual entry
            setNotifyPhoneInputMode(true);
            setShowNotifyModal(true);
          }
        } else {
          // Kakao did not return a phone number (common when the Kakao app
          // hasn't been granted phone_number scope). Ask the viewer to enter
          // their phone manually so they actually receive alimtalk.
          setNotifyPhoneInputMode(true);
          setShowNotifyModal(true);
        }
      } finally {
        setNotifyLoading(false);
      }

      // Clean up the viewer's Supabase session so it doesn't interfere with
      // a subsequent admin login on the same device.
      try { await supabase!.auth.signOut(); } catch {}
    };

    const init = async () => {
      // The OAuth code exchange may not have completed yet when this effect
      // runs. Poll for an active session for up to ~5s, then fall back to
      // listening for a SIGNED_IN event.
      for (let i = 0; i < 25 && !cancelled; i++) {
        const { data } = await supabase!.auth.getSession();
        if (data.session?.user) {
          await handleSession(data.session.user, data.session);
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      if (cancelled) return;
      const { data: { subscription } } = supabase!.auth.onAuthStateChange(async (event, session) => {
        if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
          subscription.unsubscribe();
          await handleSession(session.user, session);
        }
      });
      unsub = () => subscription.unsubscribe();
    };

    init();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [normalizedUsername]);

  const getFontStyle = () => {
    if (design.fontFamily === 'Serif') return 'font-serif tracking-tight';
    if (design.fontFamily === 'Mono') return 'font-mono uppercase tracking-tighter';
    return 'font-sans tracking-tight';
  };

  const themeBg = design.theme === 'custom' ? (design.customGradient || 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)') : 
                design.theme === 'midnight' ? '#050a15' : 
                design.theme === 'white' ? '#F8FAFC' : '#f3f0ff';
  
  const isDark = design.theme === 'midnight' || design.theme === 'custom';
  const textColor = isDark ? 'text-white' : 'text-slate-900';
  const subTextColor = isDark ? 'text-white/60' : 'text-slate-500';

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
            className={`group rounded-xl border transition-all ${isDark ? 'bg-white/5 border-white/10' : 'bg-white/80 border-slate-200/50'}`}
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

  const backgroundStyle = (design.background_image) ? {
    backgroundImage: `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url(${design.background_image})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed'
  } : { background: themeBg };

  return (
    <div className={`min-h-screen ${getFontStyle()} ${textColor} userpage-root`} style={backgroundStyle}>
      {/* PC: Full-width vertical layout */}
      <div className="min-h-screen">
        <div className="max-w-md md:max-w-2xl mx-auto min-h-screen flex flex-col relative px-4 md:px-8" style={backgroundStyle}>

        {design.homePriority === 'portfolio' ? (
          /* PORTFOLIO LAYOUT */
          <div className="flex-1 flex flex-col">
            {/* Live Broadcast Top Banner - Portfolio */}
            {liveState.isLive && (
              <div
                onClick={() => setShowLiveModal(true)}
                className="relative cursor-pointer overflow-hidden group w-screen left-1/2 -translate-x-1/2"
              >
                <div className="bg-gradient-to-r from-red-600 via-red-500 to-orange-500 px-4 py-3">
                  <div className="flex items-center justify-between max-w-2xl mx-auto">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-8 h-8 rounded-full border-2 border-white/80 overflow-hidden">
                          <SafeImage src={profile?.avatar_url || DEFAULT_AVATAR} className="w-full h-full object-cover" />
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-red-600 rounded-full border-2 border-white flex items-center justify-center">
                          <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="bg-white/20 backdrop-blur-sm text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse">LIVE</span>
                          <span className="text-white text-xs font-black">라이브 방송 중</span>
                        </div>
                        <span className="text-white/70 text-[10px] font-medium">탭하여 시청하기</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-2.5 py-1">
                        <Users size={12} className="text-white" />
                        <span className="text-white text-[10px] font-bold">{liveState.viewerCount.toLocaleString()}</span>
                      </div>
                      <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-all">
                        <Radio size={14} className="text-white" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent"></div>
              </div>
            )}

            <div
              className="relative h-[55vh] md:h-[60vh] flex-shrink-0 -mx-4 md:-mx-8"
              style={{
                background: design.portfolioHeaderColor || 'linear-gradient(to br, #9333ea, #4f46e5)'
              }}
            >
              {design.portfolioHeaderImage && (
                <MediaAuto
                  src={design.portfolioHeaderImage}
                  className="w-full h-full object-cover"
                  style={{ objectPosition: `center ${design.portfolioHeaderImagePosition || '50'}%` }}
                />
              )}
              {!design.portfolioHeaderImage && !design.portfolioHeaderColor && (
                <SafeImage
                  src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=3840&q=100"
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-inherit via-transparent to-transparent" style={{ background: `linear-gradient(to top, ${themeBg || '#ffffff'} 0%, ${themeBg || '#ffffff'}88 15%, transparent 50%)` }}></div>
              <div className="absolute bottom-6 left-6 right-6">
                 <h3 className={`text-2xl md:text-3xl font-black tracking-tighter mb-1 ${textColor}`}>{profile?.full_name || username}</h3>
                 <p className={`font-black uppercase tracking-[0.3em] ${
                   design.portfolioFontSize === 'small' ? 'text-[8px]' :
                   design.portfolioFontSize === 'large' ? 'text-sm' :
                   'text-[10px]'
                 }`} style={{ color: design.accentColor }}>{profile?.bio || 'Visual Storyteller'}</p>
              </div>
            </div>

            <div className="px-4 pt-4 pb-8 space-y-12">
              {/* Social & Contact Links */}
              <div className="flex gap-2.5 pt-4 pb-1 overflow-x-auto scrollbar-hide justify-center flex-wrap">
                {socials.phone?.trim() && (
                  <button onClick={() => openLink(`tel:${socials.phone.trim()}`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-[#3B82F6] text-white hover:brightness-110 shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    전화
                  </button>
                )}
                {socials.kakao?.trim() && (
                  <button onClick={() => openLink(socials.kakao.trim().startsWith('http') ? socials.kakao.trim() : `https://pf.kakao.com/${socials.kakao.trim()}`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-[#FEE500] text-[#3C1E1E] hover:brightness-95 shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.477 3 2 6.463 2 10.691c0 2.734 1.811 5.13 4.537 6.478-.147.543-.535 1.965-.612 2.272-.097.387.142.382.298.278.123-.082 1.96-1.311 2.756-1.843.654.097 1.327.148 2.021.148 5.523 0 10-3.463 10-7.691S17.523 3 12 3z"/></svg>
                    카카오톡
                  </button>
                )}
                {socials.naver?.trim() && (
                  <button onClick={() => openLink(socials.naver.trim())} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-[#03C75A] text-white hover:brightness-110 shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727v12.845z"/></svg>
                    네이버
                  </button>
                )}
                {socials.instagram?.trim() && (
                  <button onClick={() => openLink(`https://instagram.com/${socials.instagram.trim().replace('@', '')}`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 text-white hover:brightness-110 shadow-sm" style={{ background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)' }}>
                    <Instagram size={14} strokeWidth={2.5} />
                    인스타그램
                  </button>
                )}
                {socials.youtube?.trim() && (
                  <button onClick={() => openLink(socials.youtube.trim().startsWith('http') ? socials.youtube.trim() : `https://youtube.com/${socials.youtube.trim()}`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-[#FF0000] text-white hover:brightness-110 shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                    유튜브
                  </button>
                )}
                {socials.tiktok?.trim() && (
                  <button onClick={() => openLink(`https://tiktok.com/@${socials.tiktok.trim().replace('@', '')}`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-black text-white hover:brightness-125 shadow-sm border border-white/10">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.72a8.2 8.2 0 0 0 4.76 1.52V6.79a4.83 4.83 0 0 1-1-.1z"/></svg>
                    틱톡
                  </button>
                )}
                {socials.businessProposal && (
                  <button onClick={() => openLink(`/${normalizedUsername}/proposal`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-bold hover:brightness-110 transition-all shadow-sm whitespace-nowrap shrink-0" style={{ backgroundColor: design.accentColor }}>
                    <Briefcase size={14} strokeWidth={2.5} />
                    비즈니스 제안
                  </button>
                )}
                {socials.liveNotify && (
                <button
                  onClick={handleNotifyClick}
                  disabled={notifyLoading}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm whitespace-nowrap shrink-0 ${
                    notifySubscribed
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                      : 'bg-purple-primary text-white hover:bg-purple-secondary'
                  }`}
                >
                  <Bell size={14} strokeWidth={2.5} />
                  {notifySubscribed ? '구독중' : '라이브 알림받기'}
                </button>
                )}
              </div>

              {aboutSectionsBlock}

              {/* Open Schedule Section - Portfolio Layout */}
              {activeScheduleItems.length > 0 && (
                <div className="mt-6 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-[1px]" style={{ backgroundColor: design.accentColor }}></div>
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: design.accentColor }}>Upcoming Schedule</h4>
                  </div>
                  <div className="space-y-1.5">
                    {activeScheduleItems.map(item => (
                      <div
                        key={item.id}
                        className={`rounded-xl px-3 py-2.5 border transition-all ${isDark ? 'bg-white/5 border-white/10' : 'bg-white/80 border-slate-200/50'}`}
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
                </div>
              )}

              {/* Portfolio Sections - callout blocks */}
              {portfolioSections.length > 0 && (() => {
                const portfolioCategories = collectPortfolioCategories(portfolioSections);
                const tabLabels = [PORTFOLIO_ALL_LABEL, ...portfolioCategories.map(c => c.name)];
                const activeName = tabLabels.includes(selectedPortfolioCategory) ? selectedPortfolioCategory : PORTFOLIO_ALL_LABEL;
                const visibleSections = filterPortfolioByCategory(portfolioSections, activeName);
                return (
                <div className="space-y-3 md:space-y-4">
                  {portfolioCategories.length > 0 && (
                    <div className="space-y-3 -mx-2">
                      <div className="overflow-x-auto scrollbar-hide flex gap-3 px-2 pb-1">
                        {tabLabels.map(label => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setSelectedPortfolioCategory(label)}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-black whitespace-nowrap border transition-all ${
                              activeName === label
                                ? 'text-white border-transparent'
                                : isDark
                                ? 'bg-white/10 border-white/20 text-white/50'
                                : 'bg-white border-slate-200 text-slate-400'
                            }`}
                            style={activeName === label ? { backgroundColor: design.accentColor } : undefined}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {groupPortfolioSections(visibleSections).map((group, gi) => {
                    if (group.kind === 'single') {
                      const section = group.section;
                      if (section.type === 'category') {
                        return (
                          <div key={section.id} className="pt-4 pb-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <Hash size={16} className={isDark ? 'text-purple-300 shrink-0' : 'text-purple-500 shrink-0'} />
                              <h4 className={`text-base md:text-lg font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
                                {section.content || '카테고리'}
                              </h4>
                            </div>
                          </div>
                        );
                      }
                      const px = getSectionFontPx(section);
                      const highlight = section.highlight && section.highlight !== 'transparent' ? section.highlight : null;
                      return (
                        <div key={section.id}>
                          <div
                            className={`rounded-2xl border px-5 py-5 md:px-6 md:py-6 transition-colors ${
                              highlight
                                ? 'border-transparent'
                                : isDark
                                ? 'bg-white/[0.04] border-white/10'
                                : 'bg-slate-100 border-slate-200'
                            }`}
                            style={highlight ? { backgroundColor: highlight } : undefined}
                          >
                            <p
                              className={`whitespace-pre-wrap ${section.bold ? 'font-bold' : 'font-medium'}`}
                              style={{
                                color: section.color || (isDark ? 'rgba(255,255,255,0.8)' : '#37352f'),
                                fontSize: `${px}px`,
                                lineHeight: 1.75,
                                fontStyle: section.italic ? 'italic' : undefined,
                                textDecoration: getSectionTextDecoration(section)
                              }}
                              dangerouslySetInnerHTML={{ __html: renderPortfolioHtml(section.content || '') }}
                            />
                          </div>
                        </div>
                      );
                    }

                    const tileBorder = isDark ? 'border-white/10' : 'border-slate-200';
                    const flatImgs = flattenSectionImages(group.sections);

                    if (group.columns === 1) {
                      return (
                        <div key={`pgrid-${gi}`} className="space-y-3 md:space-y-4 -mx-4 md:-mx-8">
                          {flatImgs.map(img => (
                            <div key={img.key} className="relative">
                              <div className={`relative overflow-hidden rounded-2xl border ${tileBorder}`}>
                                <MediaAuto src={img.src} className="w-full h-auto block" style={{ maxWidth: '100%', ...(img.pos ? { objectPosition: `${img.pos.x}% ${img.pos.y}%` } : {}) }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    if (group.columns === 3) {
                      const chunks = chunkSections(flatImgs, 3);
                      return (
                        <div key={`pgrid-${gi}`} className="space-y-2 md:space-y-3 -mx-4 md:-mx-8">
                          {chunks.map((ck, ci) => (
                            ck.length === 3 ? (
                              <div key={`mg-${ci}`} className="grid grid-cols-2 grid-rows-2 gap-2 md:gap-3 aspect-[4/3]">
                                <div className={`row-span-2 relative overflow-hidden rounded-2xl border ${tileBorder}`}>
                                  <MediaAuto src={ck[0].src} className="w-full h-full object-cover block" style={ck[0].pos ? { objectPosition: `${ck[0].pos.x}% ${ck[0].pos.y}%` } : undefined} />
                                </div>
                                <div className={`relative overflow-hidden rounded-2xl border ${tileBorder}`}>
                                  <MediaAuto src={ck[1].src} className="w-full h-full object-cover block" style={ck[1].pos ? { objectPosition: `${ck[1].pos.x}% ${ck[1].pos.y}%` } : undefined} />
                                </div>
                                <div className={`relative overflow-hidden rounded-2xl border ${tileBorder}`}>
                                  <MediaAuto src={ck[2].src} className="w-full h-full object-cover block" style={ck[2].pos ? { objectPosition: `${ck[2].pos.x}% ${ck[2].pos.y}%` } : undefined} />
                                </div>
                              </div>
                            ) : (
                              <div key={`mg-${ci}`} className={`grid gap-2 md:gap-3 ${ck.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                {ck.map(img => (
                                  <div key={img.key} className={`relative overflow-hidden rounded-2xl border aspect-square ${tileBorder}`}>
                                    <MediaAuto src={img.src} className="w-full h-full object-cover block" style={img.pos ? { objectPosition: `${img.pos.x}% ${img.pos.y}%` } : undefined} />
                                  </div>
                                ))}
                              </div>
                            )
                          ))}
                        </div>
                      );
                    }

                    if (group.columns === 4) {
                      return (
                        <div key={`pgrid-${gi}`} className="grid grid-cols-2 gap-2 md:gap-3 -mx-4 md:-mx-8">
                          {flatImgs.map(img => (
                            <div key={img.key} className={`relative overflow-hidden rounded-2xl border aspect-square ${tileBorder}`}>
                              <MediaAuto src={img.src} className="w-full h-full object-cover block" style={img.pos ? { objectPosition: `${img.pos.x}% ${img.pos.y}%` } : undefined} />
                            </div>
                          ))}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`pgrid-${gi}`}
                        className="grid gap-2 md:gap-3 -mx-4 md:-mx-8"
                        style={{ gridTemplateColumns: `repeat(${group.columns}, minmax(0, 1fr))` }}
                      >
                        {flatImgs.map(img => (
                          <div key={img.key} className={`relative overflow-hidden rounded-2xl border aspect-square ${tileBorder}`}>
                            <MediaAuto src={img.src} className="w-full h-full object-cover block" style={img.pos ? { objectPosition: `${img.pos.x}% ${img.pos.y}%` } : undefined} />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                );
              })()}

            </div>

            <div id="curation-section" className="pt-8 px-4">
               <div className="flex justify-between items-end mb-8 px-4">
                 <div>
                   <h4 className="text-[10px] font-black uppercase tracking-[0.2em] mb-1" style={{ color: design.accentColor }}>My Curations</h4>
                   <h3 className="text-2xl font-black tracking-tighter">Explore My Picks</h3>
                 </div>
                 <div className="text-[10px] font-black opacity-30 uppercase tracking-widest">{filteredBlocks.length} Items</div>
               </div>

               {/* Product Search Bar */}
               <div className="px-4 mb-6">
                 <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${isDark ? 'bg-white/5 border-white/10 focus-within:border-white/30' : 'bg-white border-slate-200 focus-within:border-purple-300'}`}>
                   <Search size={16} className={`flex-shrink-0 ${isDark ? 'text-white/40' : 'text-slate-400'}`} />
                   <input
                     type="text"
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                     placeholder="상품명 검색..."
                     className={`flex-1 bg-transparent text-sm font-medium outline-none placeholder:opacity-50 ${isDark ? 'text-white placeholder:text-white/40' : 'text-slate-900 placeholder:text-slate-400'}`}
                   />
                   {searchQuery && (
                     <button onClick={() => setSearchQuery('')} className={`text-xs font-black px-2 py-1 rounded-lg transition-all ${isDark ? 'bg-white/10 text-white/60 hover:bg-white/20' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                       ✕
                     </button>
                   )}
                 </div>
               </div>

               <div className="mb-8 overflow-x-auto scrollbar-hide flex gap-2 px-4 md:px-8 -mx-4 md:-mx-8">
                 {categories.map(cat => (
                   <button
                     key={cat}
                     onClick={() => setSelectedCategory(cat)}
                     className={`px-3 py-1.5 text-[11px] font-black whitespace-nowrap transition-all rounded-full border ${selectedCategory === cat ? 'text-white border-transparent' : isDark ? 'bg-white/10 border-white/20 text-white/50' : 'bg-white border-slate-200 text-slate-400'}`}
                     style={selectedCategory === cat ? { backgroundColor: design.accentColor } : {}}
                   >
                     {cat}
                   </button>
                 ))}
               </div>

               {design.templateType === TemplateType.SHOPPABLE_GRID ? (
                 <div className="w-full -mx-4 md:-mx-8">
                 <div
                    className="grid grid-flow-dense transition-all duration-500"
                    style={{
                      gridTemplateColumns: 'repeat(6, 1fr)',
                      gap: `${Math.max(design.gridGap, 4)}px`,
                      paddingBottom: '100px'
                    }}
                  >
                    {filteredBlocks.length > 0 ? filteredBlocks.map((block) => {
                      const colSpanVal = block.displayType === 'grid' ? (block.colSpan || 1) : 1;
                      const gridSpan = colSpanVal === 1 ? 6 : colSpanVal === 2 ? 3 : 2;
                      const blockDisplay: BlockDisplayType = block.displayType || 'grid';

                      if (blockDisplay === 'text') {
                        return (
                          <div
                            key={block.id}
                            className={`relative overflow-hidden group transition-all shadow-sm flex flex-col justify-center p-4 md:p-6 ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-slate-100'}`}
                            style={{
                              gridColumn: `span ${gridSpan}`,
                              borderRadius: design.borderRadius === 'none' ? '0' : '1rem',
                              minHeight: '80px',
                              backgroundColor: (block.highlight && block.highlight !== 'transparent') ? block.highlight : undefined,
                            }}
                          >
                            {block.textContent ? (
                              <div
                                className="leading-relaxed whitespace-pre-wrap"
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
                            onClick={() => {
                              setSelectedBlockId(block.id);
                              trackClick(username, block.id);
                            }}
                            className={`relative overflow-hidden group cursor-pointer transition-all active:scale-[0.98] shadow-sm ${isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-slate-100'}`}
                            style={{
                              gridColumn: `span ${gridSpan}`,
                              borderRadius: design.borderRadius === 'none' ? '0' : '1rem'
                            }}
                          >
                            {block.coverMedia && (
                              <div className="aspect-[16/10] overflow-hidden">
                                <MediaAuto
                                  src={block.coverMedia || FALLBACK_IMAGE}
                                  className="w-full h-full object-cover opacity-90 transition-transform duration-1000 group-hover:scale-105"
                                  style={block.coverMediaPosition ? { objectPosition: `${block.coverMediaPosition.x}% ${block.coverMediaPosition.y}%` } : undefined}
                                />
                              </div>
                            )}
                            <div className="p-3 md:p-4">
                              <div className="text-xs font-black truncate uppercase tracking-tight">{block.title}</div>
                              <div className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: design.accentColor }}>{block.category}</div>
                            </div>
                            {(block.products?.length || 0) > 0 && (
                              <div className="absolute top-3 right-3">
                                <span className="bg-black/60 backdrop-blur-md text-[10px] font-black px-2 py-1 rounded-lg text-white border border-white/10 shadow-lg">{block.products.length}</span>
                              </div>
                            )}
                          </div>
                        );
                      }

                      return (
                        <div
                          key={block.id}
                          onClick={() => {
                            setSelectedBlockId(block.id);
                            trackClick(username, block.id);
                          }}
                          className={`relative overflow-hidden group cursor-pointer transition-all active:scale-[0.98] shadow-sm aspect-square`}
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
                    }) : null}
                  </div>
                  </div>
               ) : (
                <div className="flex flex-col gap-3 pb-32">
                   {filteredBlocks.map((block) => (
                     (block.products || []).map(p => (
                       <a 
                         key={p.id}
                         href={ensureAbsoluteUrl(p.link)}
                         target="_blank"
                         rel="noopener noreferrer"
                         onClick={() => trackClick(username, block.id)}
                         className={`w-full flex items-center justify-between p-4 group cursor-pointer border transition-all hover:scale-[1.01] shadow-sm ${isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-white border-slate-100 hover:border-purple-200'}`} 
                         style={{ borderRadius: design.borderRadius === 'none' ? '0' : design.borderRadius === 'md' ? '1rem' : '2rem' }}
                       >
                         <div className="flex items-center gap-4 flex-1 min-w-0 mr-4">
                           {/* Small Product Image */}
                           <div className={`w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0 border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                             <MediaAuto src={p.image || (p as any).imageUrl || (p as any).manual_image_url || block.coverMedia || FALLBACK_IMAGE} className="w-full h-full object-cover" />
                           </div>
                           <div className="flex-1 min-w-0">
                             <h4 className="text-sm font-black truncate">{p.name}</h4>
                           </div>
                         </div>
                         <div className="w-8 h-8 rounded-full flex items-center justify-center opacity-100 md:opacity-20 md:group-hover:opacity-100 transition-all shrink-0" style={{ backgroundColor: design.accentColor, color: '#fff' }}>
                           <ExternalLink size={12} />
                         </div>
                       </a>
                     ))
                   ))}
                 </div>
               )}
            </div>

          </div>
        ) : (
          /* CURATION LAYOUT */
          <div className="flex-1 flex flex-col">
            {/* Live Broadcast Top Banner */}
            {liveState.isLive && (
              <div
                onClick={() => setShowLiveModal(true)}
                className="relative cursor-pointer overflow-hidden group w-screen left-1/2 -translate-x-1/2"
              >
                <div className="bg-gradient-to-r from-red-600 via-red-500 to-orange-500 px-4 py-3">
                  <div className="flex items-center justify-between max-w-2xl mx-auto">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-8 h-8 rounded-full border-2 border-white/80 overflow-hidden">
                          <SafeImage src={profile?.avatar_url || DEFAULT_AVATAR} className="w-full h-full object-cover" />
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-red-600 rounded-full border-2 border-white flex items-center justify-center">
                          <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="bg-white/20 backdrop-blur-sm text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse">LIVE</span>
                          <span className="text-white text-xs font-black">라이브 방송 중</span>
                        </div>
                        <span className="text-white/70 text-[10px] font-medium">탭하여 시청하기</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-2.5 py-1">
                        <Users size={12} className="text-white" />
                        <span className="text-white text-[10px] font-bold">{liveState.viewerCount.toLocaleString()}</span>
                      </div>
                      <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-all">
                        <Radio size={14} className="text-white" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent"></div>
              </div>
            )}

            {/* Large Cover Image for Curation Layout - same style as Portfolio */}
            <div
              className="relative h-[55vh] md:h-[60vh] flex-shrink-0 -mx-4 md:-mx-8"
              style={{
                background: design.portfolioHeaderColor || 'linear-gradient(to br, #9333ea, #4f46e5)'
              }}
            >
              {(design.portfolioHeaderImage || (!design.portfolioHeaderImage && !design.portfolioHeaderColor)) && (
                <MediaAuto
                  src={design.portfolioHeaderImage || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=3840&q=100"}
                  className="w-full h-full object-cover"
                  style={{ objectPosition: `center ${design.portfolioHeaderImagePosition || '50'}%` }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-inherit via-transparent to-transparent" style={{ background: `linear-gradient(to top, ${themeBg || '#ffffff'} 0%, ${themeBg || '#ffffff'}88 15%, transparent 50%)` }}></div>
              <div className="absolute bottom-6 left-6 right-6">
                 <h3 className={`text-2xl md:text-3xl font-black tracking-tighter mb-1 ${textColor}`}>{profile?.full_name || username}</h3>
                 <p className={`font-black uppercase tracking-[0.3em] ${
                   design.portfolioFontSize === 'small' ? 'text-[8px]' :
                   design.portfolioFontSize === 'large' ? 'text-sm' :
                   'text-[10px]'
                 }`} style={{ color: design.accentColor }}>{profile?.bio || 'Visual Storyteller'}</p>
              </div>
            </div>

            <header className="relative pt-4 pb-6 px-6 text-center shrink-0 overflow-hidden -mx-4 md:-mx-8">

              <div className="flex gap-2.5 overflow-x-auto scrollbar-hide justify-center flex-wrap">
                {socials.phone?.trim() && (
                  <button onClick={() => openLink(`tel:${socials.phone.trim()}`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-[#3B82F6] text-white hover:brightness-110 shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    전화
                  </button>
                )}
                {socials.kakao?.trim() && (
                  <button onClick={() => openLink(socials.kakao.trim().startsWith('http') ? socials.kakao.trim() : `https://pf.kakao.com/${socials.kakao.trim()}`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-[#FEE500] text-[#3C1E1E] hover:brightness-95 shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.477 3 2 6.463 2 10.691c0 2.734 1.811 5.13 4.537 6.478-.147.543-.535 1.965-.612 2.272-.097.387.142.382.298.278.123-.082 1.96-1.311 2.756-1.843.654.097 1.327.148 2.021.148 5.523 0 10-3.463 10-7.691S17.523 3 12 3z"/></svg>
                    카카오톡
                  </button>
                )}
                {socials.naver?.trim() && (
                  <button onClick={() => openLink(socials.naver.trim())} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-[#03C75A] text-white hover:brightness-110 shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727v12.845z"/></svg>
                    네이버
                  </button>
                )}
                {socials.instagram?.trim() && (
                  <button onClick={() => openLink(`https://instagram.com/${socials.instagram.trim().replace('@', '')}`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 text-white hover:brightness-110 shadow-sm" style={{ background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)' }}>
                    <Instagram size={14} strokeWidth={2.5} />
                    인스타그램
                  </button>
                )}
                {socials.youtube?.trim() && (
                  <button onClick={() => openLink(socials.youtube.trim().startsWith('http') ? socials.youtube.trim() : `https://youtube.com/${socials.youtube.trim()}`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-[#FF0000] text-white hover:brightness-110 shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                    유튜브
                  </button>
                )}
                {socials.tiktok?.trim() && (
                  <button onClick={() => openLink(`https://tiktok.com/@${socials.tiktok.trim().replace('@', '')}`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-black text-white hover:brightness-125 shadow-sm border border-white/10">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.72a8.2 8.2 0 0 0 4.76 1.52V6.79a4.83 4.83 0 0 1-1-.1z"/></svg>
                    틱톡
                  </button>
                )}
                {socials.businessProposal && (
                  <button onClick={() => openLink(`/${normalizedUsername}/proposal`)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-bold hover:brightness-110 transition-all shadow-sm whitespace-nowrap shrink-0" style={{ backgroundColor: design.accentColor }}>
                    <Briefcase size={14} strokeWidth={2.5} />
                    비즈니스 제안
                  </button>
                )}
                {socials.liveNotify && (
                <button
                  onClick={handleNotifyClick}
                  disabled={notifyLoading}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm whitespace-nowrap shrink-0 ${
                    notifySubscribed
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                      : 'bg-purple-primary text-white hover:bg-purple-secondary'
                  }`}
                >
                  <Bell size={14} strokeWidth={2.5} />
                  {notifySubscribed ? '구독중' : '라이브 알림받기'}
                </button>
                )}
              </div>

              {aboutSectionsBlock}

              {/* Open Schedule Section - Curation Layout */}
              {activeScheduleItems.length > 0 && (
                <div className="mt-6 px-2 space-y-2">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] px-2" style={{ color: design.accentColor }}>Upcoming Schedule</h4>
                  <div className="space-y-1.5">
                    {activeScheduleItems.map(item => (
                      <div
                        key={item.id}
                        className={`rounded-xl px-3 py-2.5 border transition-all ${isDark ? 'bg-white/5 border-white/10' : 'bg-white/80 border-slate-200/50'}`}
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
                </div>
              )}

            </header>

            <div className="sticky top-0 z-30 pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-4 overflow-x-auto scrollbar-hide flex gap-2 px-4 md:px-8 backdrop-blur-md -mx-4 md:-mx-8">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 text-[11px] font-black whitespace-nowrap transition-all rounded-full border ${selectedCategory === cat ? 'text-white border-transparent' : isDark ? 'bg-white/10 border-white/20 text-white/50' : 'bg-white border-slate-200 text-slate-400'}`}
                  style={selectedCategory === cat ? { backgroundColor: design.accentColor } : {}}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Product Search Bar */}
            <div className="px-6 mb-2">
              <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${isDark ? 'bg-white/5 border-white/10 focus-within:border-white/30' : 'bg-white border-slate-200 focus-within:border-purple-300'}`}>
                <Search size={16} className={`flex-shrink-0 ${isDark ? 'text-white/40' : 'text-slate-400'}`} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="상품명 검색..."
                  className={`flex-1 bg-transparent text-sm font-medium outline-none placeholder:opacity-50 ${isDark ? 'text-white placeholder:text-white/40' : 'text-slate-900 placeholder:text-slate-400'}`}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className={`text-xs font-black px-2 py-1 rounded-lg transition-all ${isDark ? 'bg-white/10 text-white/60 hover:bg-white/20' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    ✕
                  </button>
                )}
              </div>
            </div>

            <main className="flex-1 px-4 py-6">
              {/* Supabase Links Grid */}
              {links.length > 0 && (
                <div className="grid grid-cols-1 gap-4 mb-10">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] px-2" style={{ color: design.accentColor }}>Featured Links</h4>
                  <div className={design.templateType === TemplateType.SHOPPABLE_GRID ? "grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6" : "flex flex-col gap-3 md:gap-4"}>
                    {links.map((link) => (
                      <a 
                        href={ensureAbsoluteUrl(link.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          trackClick(username, link.id);
                          openLink(link.url);
                        }}
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
                            <ExternalLink size={14} className="opacity-100 md:opacity-20 md:group-hover:opacity-100 transition-opacity" />
                          </>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {design.templateType === TemplateType.SHOPPABLE_GRID ? (
                <div className="w-full">
                <div
                  className="grid grid-flow-dense"
                  style={{
                    gridTemplateColumns: 'repeat(6, 1fr)',
                    gap: `${Math.max(design.gridGap, 4)}px`,
                    paddingBottom: '100px'
                  }}
                >
                  {filteredBlocks.length > 0 ? filteredBlocks.map((block) => {
                    const colSpanVal = block.displayType === 'grid' ? (block.colSpan || 1) : 1;
                    const gridSpan = colSpanVal === 1 ? 6 : colSpanVal === 2 ? 3 : 2;
                    const blockDisplay: BlockDisplayType = block.displayType || 'grid';

                    if (blockDisplay === 'text') {
                      return (
                        <div
                          key={block.id}
                          onClick={() => {
                            setSelectedBlockId(block.id);
                            trackClick(username, block.id);
                          }}
                          className={`relative overflow-hidden group cursor-pointer transition-all active:scale-[0.98] shadow-sm flex flex-col justify-center p-4 md:p-6 border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-100'}`}
                          style={{
                            gridColumn: `span ${gridSpan}`,
                            borderRadius: design.borderRadius === 'none' ? '0' : '1rem',
                            minHeight: '80px',
                            backgroundColor: (block.highlight && block.highlight !== 'transparent') ? block.highlight : undefined,
                          }}
                        >
                          {block.textContent ? (
                            <div
                              className="leading-relaxed whitespace-pre-wrap"
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
                          onClick={() => {
                            setSelectedBlockId(block.id);
                            trackClick(username, block.id);
                          }}
                          className={`relative overflow-hidden group cursor-pointer transition-all active:scale-[0.98] shadow-sm border ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-100'}`}
                          style={{
                            gridColumn: `span ${gridSpan}`,
                            borderRadius: design.borderRadius === 'none' ? '0' : '1rem'
                          }}
                        >
                          {block.coverMedia && (
                            <div className="aspect-[16/10] overflow-hidden">
                              <MediaAuto
                                src={block.coverMedia || FALLBACK_IMAGE}
                                className="w-full h-full object-cover opacity-90 transition-transform duration-1000 group-hover:scale-105"
                                style={block.coverMediaPosition ? { objectPosition: `${block.coverMediaPosition.x}% ${block.coverMediaPosition.y}%` } : undefined}
                              />
                            </div>
                          )}
                          <div className="p-3 md:p-4">
                            <div className="text-xs font-black truncate uppercase tracking-tight">{block.title}</div>
                            <div className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: design.accentColor }}>{block.category}</div>
                          </div>
                          {(block.products?.length || 0) > 0 && (
                            <div className="absolute top-3 right-3">
                              <span className="bg-black/60 backdrop-blur-md text-[10px] font-black px-2 py-1 rounded-lg text-white border border-white/10 shadow-lg">{block.products.length}</span>
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={block.id}
                        onClick={() => {
                          setSelectedBlockId(block.id);
                          trackClick(username, block.id);
                        }}
                        className={`relative overflow-hidden group cursor-pointer transition-all active:scale-[0.98] shadow-sm border ${isDark ? 'border-white/5' : 'border-slate-100'} aspect-square`}
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
                  }) : null}
                </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 pb-32">
                  {filteredBlocks.map((block) => (
                    (block.products || []).map(p => (
                      <a
                        key={p.id}
                        href={ensureAbsoluteUrl(p.link)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          trackClick(username, block.id);
                          openLink(p.link);
                        }}
                        className={`w-full flex items-center justify-between p-4 group cursor-pointer border transition-all hover:scale-[1.01] shadow-sm ${isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-white border-slate-100 hover:border-purple-200'}`} 
                        style={{ borderRadius: design.borderRadius === 'none' ? '0' : design.borderRadius === 'md' ? '1rem' : '2rem' }}
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0 mr-4">
                          {/* Small Product Image */}
                          <div className={`w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0 border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                            <MediaAuto src={p.image || (p as any).imageUrl || (p as any).manual_image_url || block.coverMedia || FALLBACK_IMAGE} className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-black truncate">{p.name}</h4>
                          </div>
                        </div>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center opacity-100 md:opacity-20 md:group-hover:opacity-100 transition-all shrink-0" style={{ backgroundColor: design.accentColor, color: '#fff' }}>
                          <ExternalLink size={12} />
                        </div>
                      </a>
                    ))
                  ))}
                </div>
              )}
            </main>

            {/* Portfolio Sections - callout blocks */}
            {portfolioSections.length > 0 && (() => {
              const portfolioCategories = collectPortfolioCategories(portfolioSections);
              const tabLabels = [PORTFOLIO_ALL_LABEL, ...portfolioCategories.map(c => c.name)];
              const activeName = tabLabels.includes(selectedPortfolioCategory) ? selectedPortfolioCategory : PORTFOLIO_ALL_LABEL;
              const visibleSections = filterPortfolioByCategory(portfolioSections, activeName);
              return (
              <>
                <div className="px-6 pt-8 pb-2 flex items-center gap-3">
                  <div className="flex-1 h-[1px]" style={{ backgroundColor: design.accentColor, opacity: 0.3 }}></div>
                  <h4 className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: design.accentColor }}>Portfolio</h4>
                  <div className="flex-1 h-[1px]" style={{ backgroundColor: design.accentColor, opacity: 0.3 }}></div>
                </div>
                {portfolioCategories.length > 0 && (
                  <div className="px-4 pt-2 space-y-3">
                    <div className="overflow-x-auto scrollbar-hide flex gap-3 pb-1">
                      {tabLabels.map(label => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setSelectedPortfolioCategory(label)}
                          className={`px-3 py-1.5 rounded-full text-[11px] font-black whitespace-nowrap border transition-all ${
                            activeName === label
                              ? 'text-white border-transparent'
                              : isDark
                              ? 'bg-white/10 border-white/20 text-white/50'
                              : 'bg-white border-slate-200 text-slate-400'
                          }`}
                          style={activeName === label ? { backgroundColor: design.accentColor } : undefined}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="px-4 pt-2 pb-4 space-y-3 md:space-y-4">
                {groupPortfolioSections(visibleSections).map((group, gi) => {
                  if (group.kind === 'single') {
                    const section = group.section;
                    if (section.type === 'category') {
                      return (
                        <div key={section.id} className="pt-4 pb-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Hash size={16} className={isDark ? 'text-purple-300 shrink-0' : 'text-purple-500 shrink-0'} />
                            <h4 className={`text-base md:text-lg font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
                              {section.content || '카테고리'}
                            </h4>
                          </div>
                        </div>
                      );
                    }
                    const px = getSectionFontPx(section);
                    const highlight = section.highlight && section.highlight !== 'transparent' ? section.highlight : null;
                    return (
                      <div key={section.id}>
                        <div
                          className={`rounded-2xl border px-5 py-5 md:px-6 md:py-6 transition-colors ${
                            highlight
                              ? 'border-transparent'
                              : isDark
                              ? 'bg-white/[0.04] border-white/10'
                              : 'bg-slate-100 border-slate-200'
                          }`}
                          style={highlight ? { backgroundColor: highlight } : undefined}
                        >
                          <p
                            className={`whitespace-pre-wrap ${section.bold ? 'font-bold' : 'font-medium'}`}
                            style={{
                              color: section.color || (isDark ? 'rgba(255,255,255,0.8)' : '#37352f'),
                              fontSize: `${px}px`,
                              lineHeight: 1.75,
                              fontStyle: section.italic ? 'italic' : undefined,
                              textDecoration: getSectionTextDecoration(section)
                            }}
                            dangerouslySetInnerHTML={{ __html: renderPortfolioHtml(section.content || '') }}
                          />
                        </div>
                      </div>
                    );
                  }

                  const tileBorder = isDark ? 'border-white/10' : 'border-slate-200';
                  const flatImgs = flattenSectionImages(group.sections);

                  if (group.columns === 1) {
                    return (
                      <div key={`pgrid-${gi}`} className="space-y-3 md:space-y-4">
                        {flatImgs.map(img => (
                          <div key={img.key} className="relative">
                            <div className={`relative overflow-hidden rounded-2xl border ${tileBorder}`}>
                              <MediaAuto src={img.src} className="w-full h-auto block" style={img.pos ? { objectPosition: `${img.pos.x}% ${img.pos.y}%` } : undefined} />
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }

                  if (group.columns === 3) {
                    const chunks = chunkSections(flatImgs, 3);
                    return (
                      <div key={`pgrid-${gi}`} className="space-y-2 md:space-y-3">
                        {chunks.map((ck, ci) => (
                          ck.length === 3 ? (
                            <div key={`mg-${ci}`} className="grid grid-cols-2 grid-rows-2 gap-2 md:gap-3 aspect-[4/3]">
                              <div className={`row-span-2 relative overflow-hidden rounded-2xl border ${tileBorder}`}>
                                <MediaAuto src={ck[0].src} className="w-full h-full object-cover block" style={ck[0].pos ? { objectPosition: `${ck[0].pos.x}% ${ck[0].pos.y}%` } : undefined} />
                              </div>
                              <div className={`relative overflow-hidden rounded-2xl border ${tileBorder}`}>
                                <MediaAuto src={ck[1].src} className="w-full h-full object-cover block" style={ck[1].pos ? { objectPosition: `${ck[1].pos.x}% ${ck[1].pos.y}%` } : undefined} />
                              </div>
                              <div className={`relative overflow-hidden rounded-2xl border ${tileBorder}`}>
                                <MediaAuto src={ck[2].src} className="w-full h-full object-cover block" style={ck[2].pos ? { objectPosition: `${ck[2].pos.x}% ${ck[2].pos.y}%` } : undefined} />
                              </div>
                            </div>
                          ) : (
                            <div key={`mg-${ci}`} className={`grid gap-2 md:gap-3 ${ck.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                              {ck.map(img => (
                                <div key={img.key} className={`relative overflow-hidden rounded-2xl border aspect-square ${tileBorder}`}>
                                  <MediaAuto src={img.src} className="w-full h-full object-cover block" style={img.pos ? { objectPosition: `${img.pos.x}% ${img.pos.y}%` } : undefined} />
                                </div>
                              ))}
                            </div>
                          )
                        ))}
                      </div>
                    );
                  }

                  if (group.columns === 4) {
                    return (
                      <div key={`pgrid-${gi}`} className="grid grid-cols-2 gap-2 md:gap-3">
                        {flatImgs.map(img => (
                          <div key={img.key} className={`relative overflow-hidden rounded-2xl border aspect-square ${tileBorder}`}>
                            <MediaAuto src={img.src} className="w-full h-full object-cover block" style={img.pos ? { objectPosition: `${img.pos.x}% ${img.pos.y}%` } : undefined} />
                          </div>
                        ))}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={`pgrid-${gi}`}
                      className="grid gap-2 md:gap-3"
                      style={{ gridTemplateColumns: `repeat(${group.columns}, minmax(0, 1fr))` }}
                    >
                      {flatImgs.map(img => (
                        <div key={img.key} className={`relative overflow-hidden rounded-2xl border aspect-square ${tileBorder}`}>
                          <MediaAuto src={img.src} className="w-full h-full object-cover block" style={img.pos ? { objectPosition: `${img.pos.x}% ${img.pos.y}%` } : undefined} />
                        </div>
                      ))}
                    </div>
                  );
                })}
                </div>
              </>
              );
            })()}
          </div>
        )}

        {/* Footer */}
        <footer className="py-12 flex flex-col items-center space-y-6 shrink-0">
          <button 
            onClick={() => {
              navigator.share({
                title: `${username}님의 픽스폴리오`,
                url: window.location.href
              }).catch(() => {
                navigator.clipboard.writeText(window.location.href);
                alert('링크가 복사되었습니다!');
              });
            }}
            className="flex items-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-[2rem] font-black text-sm hover:scale-105 transition-all shadow-2xl"
          >
            <Share2 size={18} />
            페이지 공유하기
          </button>
          
          <div className="flex items-center gap-2 opacity-30 grayscale hover:grayscale-0 transition-all cursor-pointer">
            <span className="text-[10px] font-black tracking-tighter">POWERED BY</span>
            <span className="text-sm font-black text-purple-600 tracking-tighter">PICKSFOLIO</span>
          </div>
        </footer>

        {/* Product Detail Drawer */}
        <div className={`fixed bottom-0 left-0 right-0 max-w-3xl mx-auto p-6 sm:p-8 md:p-10 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] rounded-t-[2.5rem] sm:rounded-t-[3rem] transition-transform duration-500 z-[110] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] ${selectedBlockId ? 'translate-y-0' : 'translate-y-full'} ${isDark ? 'bg-[#0f172a] text-white' : 'bg-white text-slate-900'}`}>
          <div className={`w-12 h-1 rounded-full mx-auto mb-8 cursor-pointer ${isDark ? 'bg-white/20' : 'bg-slate-200'}`} onClick={() => setSelectedBlockId(null)}></div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h4 className="font-black text-[10px] uppercase tracking-[0.2em] text-purple-600 mb-1">Shop the Selection</h4>
              <h3 className="text-lg font-black tracking-tight">{selectedBlock?.title}</h3>
            </div>
            <button onClick={() => setSelectedBlockId(null)} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isDark ? 'bg-white/10 text-white/40 hover:text-white' : 'bg-slate-100 text-slate-400 hover:text-slate-900'}`}>✕</button>
          </div>
          <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-2 scrollbar-hide pb-4">
            {selectedBlock?.products.map((p) => (
              <div 
                key={p.id} 
                className={`flex items-center justify-between p-5 rounded-2xl border group shadow-sm transition-all ${isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:border-purple-200'}`}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0 mr-4">
                  {/* Product Thumbnail */}
                  <div className={`w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0 border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                    <MediaAuto src={p.image || (p as any).imageUrl || (p as any).manual_image_url || selectedBlock?.coverMedia || FALLBACK_IMAGE} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <a
                        href={ensureAbsoluteUrl(p.link)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          trackClick(username, selectedBlockId || '');
                        }}
                        className={`text-sm font-black truncate hover:underline cursor-pointer ${isDark ? 'text-white' : 'text-slate-900'}`}
                      >
                        {p.name}
                      </a>
                    </div>
                    <span className={`text-[9px] font-bold truncate opacity-60 block ${isDark ? 'text-white/40' : 'text-slate-400'}`}>{p.link.replace('https://', '').replace('http://', '').split('/')[0]}</span>
                  </div>
                </div>
                <a 
                  href={ensureAbsoluteUrl(p.link)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    trackClick(username, selectedBlockId || '');
                  }}
                  className="px-5 py-2.5 rounded-xl text-[10px] font-black text-white shadow-md active:scale-90 transition-all shrink-0 flex items-center justify-center" 
                  style={{ backgroundColor: design.accentColor }}
                >
                  구매하기
                </a>
              </div>
            ))}
          </div>
        </div>
        {selectedBlockId && <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[90] transition-opacity" onClick={() => setSelectedBlockId(null)}></div>}
        
        {/* Live Commerce Modal - keep mounted once opened, only close on user action */}
        <AnimatePresence>
          {showLiveModal && (
            <LiveStream
              username={username}
              currentProduct={liveState.currentProduct}
              activeMaterial={liveState.activeMaterial}
              viewerCount={liveState.viewerCount}
              onClose={() => setShowLiveModal(false)}
              preConnectedSignaling={preSignalingRef.current}
            />
          )}
        </AnimatePresence>

        {/* Live Notification Error Modal */}
        {showUnsubscribeConfirm && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => !notifyLoading && setShowUnsubscribeConfirm(false)}
            ></div>
            <div className="relative bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl text-center animate-in fade-in zoom-in-95 duration-300">
              <button
                onClick={() => setShowUnsubscribeConfirm(false)}
                disabled={notifyLoading}
                className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 text-xl font-bold disabled:opacity-40"
              >
                ×
              </button>
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Bell size={28} className="text-slate-500" />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">알림 받기 해지</h3>
              <p className="text-slate-500 text-sm font-medium mb-6">
                이제 알림 안 받으시겠습니까?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowUnsubscribeConfirm(false)}
                  disabled={notifyLoading}
                  className="flex-1 py-3 rounded-2xl font-black text-base bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  취소
                </button>
                <button
                  onClick={handleNotifyUnsubscribe}
                  disabled={notifyLoading}
                  className="flex-1 py-3 rounded-2xl font-black text-base bg-red-500 text-white hover:bg-red-600 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {notifyLoading ? '해지 중...' : '해지'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showNotifyModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNotifyModal(false)}></div>
            <div className="relative bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl text-center animate-in fade-in zoom-in-95 duration-300">
              <button onClick={() => setShowNotifyModal(false)} className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
              <div className="w-16 h-16 bg-[#FEE500] rounded-full flex items-center justify-center mx-auto mb-4">
                <Bell size={28} className="text-[#3C1E1E]" />
              </div>

              {notifyPhoneInputMode ? (
                <>
                  <h3 className="text-xl font-black text-slate-900 mb-2">전화번호 입력</h3>
                  <p className="text-slate-500 text-sm font-medium mb-6">
                    카카오에서 전화번호를 받지 못했습니다.<br />
                    알림톡을 받을 휴대폰 번호를 입력해주세요.
                  </p>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="010-1234-5678"
                    value={notifyPhoneInput}
                    onChange={(e) => setNotifyPhoneInput(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-purple-primary focus:ring-2 focus:ring-purple-primary/20 outline-none text-center text-base font-bold text-slate-900 mb-3"
                  />

                  {notifyError && (
                    <p className="text-red-500 text-xs font-bold mb-4 bg-red-50 rounded-xl py-2 px-3">{notifyError}</p>
                  )}

                  <button
                    onClick={async () => {
                      const cleaned = notifyPhoneInput.replace(/[^0-9]/g, '');
                      if (cleaned.length < 10) {
                        setNotifyError('올바른 휴대폰 번호를 입력해주세요.');
                        return;
                      }
                      setNotifyError('');
                      setNotifyLoading(true);
                      try {
                        await submitNotifySubscribe(cleaned, notifyPendingNickname || '카카오 사용자');
                      } finally {
                        setNotifyLoading(false);
                      }
                    }}
                    disabled={notifyLoading || notifyPhoneInput.replace(/[^0-9]/g, '').length < 10}
                    className="w-full py-4 rounded-2xl font-black text-base bg-purple-primary text-white hover:bg-purple-secondary transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {notifyLoading ? '등록 중...' : '알림 받기'}
                  </button>

                  <button
                    onClick={() => setShowNotifyModal(false)}
                    className="w-full text-slate-400 font-bold text-sm py-2 mt-3 hover:text-slate-600 transition-all"
                  >
                    닫기
                  </button>
                </>
              ) : (
                <>
                  <h3 className="text-xl font-black text-slate-900 mb-2">카카오 로그인</h3>
                  <p className="text-slate-500 text-sm font-medium mb-6">라이브 알림을 받으려면<br />카카오 로그인이 필요합니다.</p>

              {/* Consent items */}
              {notifyShowConsent && (
              <div className={`mb-4 rounded-xl border text-left ${notifyConsentRequired && !notifyConsentPrivacy ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'} p-3 space-y-2`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyConsentPrivacy && notifyConsentMarketing}
                    onChange={(e) => {
                      setNotifyConsentPrivacy(e.target.checked);
                      setNotifyConsentMarketing(e.target.checked);
                      if (e.target.checked) setNotifyConsentRequired(false);
                    }}
                    className="mt-0.5 w-4 h-4 accent-yellow-500"
                  />
                  <span className="text-sm font-bold text-slate-900">전체 동의하기</span>
                </label>
                <div className="border-t border-slate-200 my-1"></div>
                <div className="flex items-start gap-2">
                  <label className="flex items-start gap-2 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={notifyConsentPrivacy}
                      onChange={(e) => {
                        setNotifyConsentPrivacy(e.target.checked);
                        if (e.target.checked) setNotifyConsentRequired(false);
                      }}
                      className="mt-0.5 w-4 h-4 accent-yellow-500"
                    />
                    <span className="text-xs text-slate-700">
                      <span className="font-bold text-yellow-600">[필수]</span> 개인정보 수집·이용 동의 (닉네임, 전화번호)
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowConsentDetail('privacy')}
                    className="text-xs text-slate-400 underline shrink-0"
                  >
                    보기
                  </button>
                </div>
                <div className="flex items-start gap-2">
                  <label className="flex items-start gap-2 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={notifyConsentMarketing}
                      onChange={(e) => setNotifyConsentMarketing(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-yellow-500"
                    />
                    <span className="text-xs text-slate-700">
                      <span className="font-bold text-slate-500">[선택]</span> 라이브 알림톡 수신 동의
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowConsentDetail('marketing')}
                    className="text-xs text-slate-400 underline shrink-0"
                  >
                    보기
                  </button>
                </div>
              </div>
              )}

              {notifyError && (
                <p className="text-red-500 text-xs font-bold mb-4 bg-red-50 rounded-xl py-2 px-3">{notifyError}</p>
              )}

              <button
                onClick={() => {
                  if (!notifyShowConsent) {
                    setNotifyError('');
                    setNotifyConsentRequired(false);
                    setNotifyShowConsent(true);
                    return;
                  }
                  handleNotifyKakaoLogin();
                }}
                disabled={notifyLoading || (notifyShowConsent && !notifyConsentPrivacy)}
                className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-black text-base hover:opacity-90 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#FEE500', color: '#000000' }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3C6.48 3 2 6.36 2 10.44c0 2.62 1.72 4.92 4.32 6.24-.14.52-.92 3.36-.96 3.58 0 0-.02.16.08.22.1.06.22.02.22.02.3-.04 3.44-2.26 3.98-2.64.76.1 1.56.16 2.36.16 5.52 0 10-3.36 10-7.58C22 6.36 17.52 3 12 3z" fill="#000000"/>
                </svg>
                {notifyLoading ? '등록 중...' : (notifyShowConsent ? '동의하고 카카오로 시작하기' : '카카오로 가입하기')}
              </button>

              <button
                onClick={() => setShowNotifyModal(false)}
                className="w-full text-slate-400 font-bold text-sm py-2 mt-3 hover:text-slate-600 transition-all"
              >
                닫기
              </button>
                </>
              )}
            </div>

            {/* Consent detail sub-modal */}
            {showConsentDetail && (
              <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowConsentDetail(null)}></div>
                <div className="relative bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl max-h-[80vh] overflow-y-auto text-left">
                  <button onClick={() => setShowConsentDetail(null)} className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
                  {showConsentDetail === 'privacy' ? (
                    <div>
                      <h4 className="text-base font-black text-slate-900 mb-3">개인정보 수집·이용 동의 (필수)</h4>
                      <div className="text-xs text-slate-700 space-y-2 leading-relaxed">
                        <p><span className="font-bold">수집 항목:</span> 카카오 닉네임, 전화번호</p>
                        <p><span className="font-bold">수집 목적:</span> 라이브 방송 시작 시 카카오 알림톡 발송</p>
                        <p><span className="font-bold">보유 기간:</span> 알림 수신 해지 시까지</p>
                        <p className="text-slate-500">동의를 거부할 권리가 있으며, 거부 시 라이브 알림 서비스를 이용할 수 없습니다.</p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h4 className="text-base font-black text-slate-900 mb-3">라이브 알림톡 수신 동의 (선택)</h4>
                      <div className="text-xs text-slate-700 space-y-2 leading-relaxed">
                        <p><span className="font-bold">수신 채널:</span> 카카오 알림톡</p>
                        <p><span className="font-bold">발송 내용:</span> 구독한 인플루언서의 라이브 시작 알림</p>
                        <p><span className="font-bold">철회 방법:</span> 라이브 알림받기 버튼을 다시 눌러 해지</p>
                        <p className="text-slate-500">선택 동의 항목으로, 거부하셔도 라이브 알림 서비스 이용이 가능합니다.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        </div>
      </div>
    </div>
  );
};

export default UserPage;
